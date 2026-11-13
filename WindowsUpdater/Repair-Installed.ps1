#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
$KnownNames = @('Google Calendar 주말 컬러', 'Google Calendar 커스터마이저')
$DataDir = Join-Path $env:LOCALAPPDATA 'GCalCustomizerUpdater'
$ConfigFile = Join-Path $DataDir 'config.json'
$Required = @('manifest.json','content.js','content.css','popup.html','popup.css','popup.js','event-borders.js','background.js')

function Read-Object([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Write-Object([string]$Path, $Object) {
    $content = $Object | ConvertTo-Json -Depth 24
    [IO.File]::WriteAllText($Path, $content + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}
function Normalize-Folder([string]$InputPath) {
    $path = [Environment]::ExpandEnvironmentVariables(([string]$InputPath).Trim().Trim('"').Trim())
    if (-not $path) { throw '폴더 경로가 입력되지 않았습니다.' }
    try { $path = [IO.Path]::GetFullPath($path) }
    catch { throw "유효하지 않은 폴더 경로: $InputPath" }
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "폴더를 찾을 수 없습니다: $path" }
    return $path.TrimEnd('\')
}
function Get-Manifest([string]$Folder) {
    $m = Read-Object (Join-Path $Folder 'manifest.json')
    if (-not $m -or $m.manifest_version -ne 3 -or $KnownNames -notcontains [string]$m.name) {
        throw "캘린더 커스터마이저 폴더가 아닙니다: $Folder"
    }
    if ([string]$m.version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw "버전 형식 오류: $Folder" }
    return $m
}
function Find-RegisteredExtensions {
    $results = New-Object 'System.Collections.Generic.List[object]'
    $browsers = @(
        @{ Name='Chrome'; Root=(Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') },
        @{ Name='Edge'; Root=(Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data') }
    )
    foreach ($b in $browsers) {
        if (-not (Test-Path -LiteralPath $b.Root)) { continue }
        $profiles = @(Get-ChildItem -LiteralPath $b.Root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -match '^Profile \d+$' })
        foreach ($profile in $profiles) {
            $prefPath = Join-Path $profile.FullName 'Preferences'
            if (-not (Test-Path -LiteralPath $prefPath -PathType Leaf)) { continue }
            try {
                $prefs = Read-Object $prefPath
                if (-not $prefs -or -not $prefs.extensions -or -not $prefs.extensions.settings) { continue }
                foreach ($item in $prefs.extensions.settings.PSObject.Properties) {
                    $raw = [string]$item.Value.path
                    if (-not $raw) { continue }
                    try {
                        $folder = $raw
                        if (-not [IO.Path]::IsPathRooted($folder)) { $folder = Join-Path $profile.FullName $folder }
                        $folder = Normalize-Folder $folder
                        $manifest = Get-Manifest $folder
                        $key = "$($b.Name)|$($profile.Name)|$($item.Name)"
                        $results.Add([pscustomobject]@{
                            Browser=$b.Name; Profile=$profile.Name; ExtensionId=$item.Name;
                            Path=$folder; Version=[string]$manifest.version; Key=$key
                        })
                    } catch { }
                }
            } catch { Write-Warning "브라우저 설정을 읽을 수 없습니다: $prefPath" }
        }
    }
    return @($results.ToArray())
}
function Ask-Target($Candidates) {
    Write-Host ''
    Write-Host 'Chrome / Edge에서 실제 로드 중인 설치 폴더:' -ForegroundColor Cyan
    if ($Candidates.Count -gt 0) {
        for ($i=0; $i -lt $Candidates.Count; $i++) {
            $c = $Candidates[$i]
            Write-Host "  $($i+1). $($c.Browser) [$($c.Profile)]  v$($c.Version)"
            Write-Host "     $($c.Path)" -ForegroundColor Gray
        }
    } else {
        Write-Host '  자동 감지된 확장프로그램이 없습니다.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'Chrome chrome://extensions > 확장프로그램 세부정보에서 로드된 경로를 확인할 수 있습니다.'
    $choice = Read-Host '설치 대상 번호 선택 (직접 경로 입력은 P, 취소는 Q)'
    if ($choice -match '^[Qq]$') { throw '사용자가 취소했습니다.' }
    if ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $Candidates.Count) {
        return $Candidates[[int]$choice-1].Path
    }
    if ($choice -match '^[Pp]$' -or ($choice -eq '' -and $Candidates.Count -eq 0)) {
        $manual = Read-Host 'Chrome에 등록된 기존 확장프로그램 폴더의 전체 경로'
        return (Normalize-Folder $manual)
    }
    throw '올바른 번호 또는 P를 선택해 주세요. (잘못된 폴더로의 설치 방지)'
}
function Copy-Verified([string]$Source, [string]$Target) {
    $sourceManifest = Get-Manifest $Source
    $targetManifest = Get-Manifest $Target
    $sourceVersion = [version]$sourceManifest.version
    $targetVersion = [version]$targetManifest.version
    if ($targetVersion -gt $sourceVersion) { throw "설치된 버전이 더 최신입니다. 기존: $targetVersion / 패키지: $sourceVersion" }
    if ([string]::Equals($Source,$Target,[StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "이미 설치 위치가 v$sourceVersion 입니다: $Target" -ForegroundColor Green
        return
    }
    foreach ($required in $Required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Source $required) -PathType Leaf)) {
            throw "업데이트 패키지 파일 누락: $required"
        }
    }
    $backup = Join-Path $DataDir ('repair-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
    $null = New-Item -ItemType Directory -Path $backup -Force
    $changed = New-Object 'System.Collections.Generic.List[string]'
    $added = New-Object 'System.Collections.Generic.List[string]'
    $ignore = @('update-source.json','updater-status.json','updater-version.json')
    $staging = Join-Path $env:TEMP ('GCalCustomizerRepair_' + [guid]::NewGuid().ToString('N'))
    try {
        $null = New-Item -ItemType Directory -Path $staging -Force
        foreach ($f in (Get-ChildItem -LiteralPath $Source -File -Recurse)) {
            $relative = $f.FullName.Substring($Source.Length).TrimStart('\','/')
            if ($ignore -contains $relative) { continue }
            $stageFile = Join-Path $staging $relative
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $stageFile) -Force
            Copy-Item -LiteralPath $f.FullName -Destination $stageFile -Force
        }
        $newManifest = Get-Manifest $staging
        # API 사용 중단: 기존 OAuth 식별자를 새 매니페스트에 다시 추가하지 않습니다.
        if ($targetManifest.PSObject.Properties['key']) {
            $newManifest | Add-Member -MemberType NoteProperty -Name key -Value $targetManifest.key -Force
        }
        Write-Object (Join-Path $staging 'manifest.json') $newManifest
        foreach ($file in (Get-ChildItem -LiteralPath $staging -File -Recurse)) {
            $relative = $file.FullName.Substring($staging.Length).TrimStart('\','/')
            $dest = Join-Path $Target $relative
            $backupFile = Join-Path $backup $relative
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force
            if (Test-Path -LiteralPath $dest -PathType Leaf) {
                $null = New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force
                Copy-Item -LiteralPath $dest -Destination $backupFile -Force
                $changed.Add($relative)
            } else { $added.Add($relative) }
            Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
        }
        # Retire scripts from earlier releases; keep backups for rollback.
        foreach ($obsolete in @('time-shortcut.js','quick-edit.js','hover-preview.js')) {
            $oldPath = Join-Path $Target $obsolete
            if (Test-Path -LiteralPath $oldPath -PathType Leaf) {
                $backupOld = Join-Path $backup $obsolete
                Copy-Item -LiteralPath $oldPath -Destination $backupOld -Force
                $changed.Add($obsolete)
                Remove-Item -LiteralPath $oldPath -Force
            }
        }
        $after = Get-Manifest $Target
        if ([string]$after.version -ne [string]$sourceVersion) { throw "업데이트 후 버전 검증 실패 (실제: $($after.version))" }
        $check = @('popup.js','content.js','event-borders.js')
        foreach ($file in $check) {
            $a = (Get-FileHash -LiteralPath (Join-Path $Source $file) -Algorithm SHA256).Hash
            $b = (Get-FileHash -LiteralPath (Join-Path $Target $file) -Algorithm SHA256).Hash
            if ($a -ne $b) { throw "업데이트 파일 검증 실패: $file" }
        }
        $stamp = @{version=[string]$sourceVersion; updatedAt=(Get-Date).ToUniversalTime().ToString('o'); method='repair' }
        Write-Object (Join-Path $Target 'updater-version.json') $stamp
        if (-not (Test-Path -LiteralPath (Join-Path $Target 'update-source.json'))) {
            Copy-Item -LiteralPath (Join-Path $Source 'update-source.json') -Destination (Join-Path $Target 'update-source.json')
        }
        $cfg = Read-Object $ConfigFile
        if ($cfg) {
            $cfg.installPath = $Target
            Write-Object $ConfigFile $cfg
        }
        Write-Host ''
        Write-Host "파일 업데이트 및 검증 성공: v$targetVersion -> v$sourceVersion" -ForegroundColor Green
        Write-Host "실제 업데이트 경로: $Target" -ForegroundColor Green
        Write-Host '확장프로그램 관리 화면에서 [새로고침]을 눌러야 Chrome 표시 버전이 갱신됩니다.' -ForegroundColor Yellow
        Write-Host '다음으로 Google Calendar 탭에서도 Ctrl+Shift+R을 눌러 주세요.'
        Write-Host "복구 백업: $backup"
    } catch {
        foreach ($file in $added) { Remove-Item -LiteralPath (Join-Path $Target $file) -Force -ErrorAction SilentlyContinue }
        foreach ($file in $changed) { Copy-Item -LiteralPath (Join-Path $backup $file) -Destination (Join-Path $Target $file) -Force -ErrorAction SilentlyContinue }
        throw
    } finally { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
try {
    $SourceDirectory = Normalize-Folder $SourceDirectory
    $sourceVersion = [string](Get-Manifest $SourceDirectory).version
    $null = New-Item -ItemType Directory -Path $DataDir -Force
    Write-Host "Google Calendar Customizer v$sourceVersion | 설치 경로 복구" -ForegroundColor Cyan
    $found = @(Find-RegisteredExtensions)
    $target = Normalize-Folder (Ask-Target $found)
    $null = Get-Manifest $target
    # Confirm a manually selected folder, especially if not present in Chrome preferences.
    if (@($found | Where-Object { $_.Path -eq $target }).Count -eq 0) {
        Write-Host '주의: 이 폴더가 Chrome/Edge에 등록되었는지 자동 확인되지 않았습니다.' -ForegroundColor Yellow
        Write-Host "선택 폴더: $target"
        $ok = Read-Host '이 경로를 업데이트하시겠습니까? (YES 입력 시에만 실행)'
        if ($ok -ne 'YES') { throw '미확인 폴더 업데이트를 취소했습니다.' }
    }
    Copy-Verified $SourceDirectory $target
    exit 0
} catch {
    Write-Host "오류: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
