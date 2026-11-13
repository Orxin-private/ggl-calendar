﻿#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Setup,
    [switch]$Auto,
    [switch]$Manual,
    [string]$SourceDirectory = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$AppName = 'Google Calendar 커스터마이저'
$TaskName = 'GoogleCalendarCustomizerAutoUpdate'
$DataDir = Join-Path $env:LOCALAPPDATA 'GCalCustomizerUpdater'
$ConfigPath = Join-Path $DataDir 'config.json'
$null = New-Item -ItemType Directory -Path $DataDir -Force

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Save-Json([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
}
function Resolve-DirectoryPath([string]$RawPath, [string]$Label) {
    # Normalize a folder pasted from Chrome/Explorer and tolerate stray outer quotes.
    $value = [Environment]::ExpandEnvironmentVariables(([string]$RawPath).Trim())
    $value = $value.Trim('"').Trim()
    if (-not $value) { throw "$Label 경로가 비어 있습니다." }
    try {
        $full = [IO.Path]::GetFullPath($value)
    } catch {
        throw "$Label 경로가 올바르지 않습니다. 폴더 경로만 복사해 입력하세요. 입력값: $value"
    }
    if (-not (Test-Path -LiteralPath $full -PathType Container)) {
        throw "$Label 폴더를 찾을 수 없습니다: $full"
    }
    return $full
}
function Get-AppVersion([string]$Folder) {
    $manifest = Read-Json (Join-Path $Folder 'manifest.json')
    # v1.0.0 was distributed under a different extension display name.
    $knownNames = @($AppName, 'Google Calendar 주말 컬러')
    if ($null -eq $manifest -or $manifest.manifest_version -ne 3 -or ($knownNames -notcontains [string]$manifest.name)) {
        throw "올바른 $AppName 폴더가 아닙니다: $Folder"
    }
    if ($manifest.version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {
        throw 'manifest.json의 버전 형식이 올바르지 않습니다.'
    }
    return [version]$manifest.version
}
function Find-InstalledFolders {
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')
    )
    $found = New-Object 'System.Collections.Generic.List[string]'
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($profile in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            if ($profile.Name -ne 'Default' -and $profile.Name -notmatch '^Profile \d+$') { continue }
            $pref = Join-Path $profile.FullName 'Preferences'
            if (-not (Test-Path -LiteralPath $pref)) { continue }
            try {
                $prefs = Read-Json $pref
                $settings = $prefs.extensions.settings
                if ($null -eq $settings) { continue }
                foreach ($setting in $settings.PSObject.Properties) {
                    $folder = [string]$setting.Value.path
                    if (-not $folder -or -not (Test-Path -LiteralPath (Join-Path $folder 'manifest.json'))) { continue }
                    try { $null = Get-AppVersion $folder; if (-not $found.Contains($folder)) {$found.Add($folder)} }
                    catch { }
                }
            } catch { }
        }
    }
    return $found.ToArray()
}
function Read-TargetFolder {
    $found = @(Find-InstalledFolders)
    if ($found.Count -eq 1) {
        Write-Host "설치된 확장프로그램 발견: $($found[0])" -ForegroundColor Cyan
        $answer = Read-Host '이 폴더를 업데이트할까요? (Y/n)'
        if ($answer -eq '' -or $answer -match '^[Yy]') { return $found[0] }
    }
    if ($found.Count -gt 1) {
        Write-Host '발견된 설치 폴더:' -ForegroundColor Cyan
        for ($i=0; $i -lt $found.Count; $i++) { Write-Host "  $($i+1). $($found[$i])" }
        $selection = Read-Host '번호 선택 (직접 입력하려면 Enter)'
        if ($selection -match '^\d+$' -and [int]$selection -ge 1 -and [int]$selection -le $found.Count) { return $found[[int]$selection-1] }
    }
    $inputPath = Read-Host 'Chrome/Edge에 이미 등록된 확장프로그램 폴더 경로를 입력해 주세요'
    $folder = Resolve-DirectoryPath $inputPath '확장프로그램 설치'
    $null = Get-AppVersion $folder
    return $folder
}
function Update-SourceFile($Config) {
    $target = $Config.installPath
    Save-Json (Join-Path $target 'update-source.json') @{
        repository = $Config.repository
        automatic = [bool]$Config.automatic
        scheduleHours = 6
    }
}
function Write-Status($Config, [string]$Status, [string]$Message) {
    $output = @{
        status = $Status
        message = $Message
        checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    }
    if ($Config -and (Test-Path -LiteralPath $Config.installPath -PathType Container)) {
        Save-Json (Join-Path $Config.installPath 'updater-status.json') $output
    }
    Save-Json (Join-Path $DataDir 'last-status.json') $output
}
function Get-PackageFolder([string]$ZipFile, [string]$ExpectedVersion = '') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stage = Join-Path $env:TEMP ('GCalCustStage_' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $stage
    try {
        # Reject path traversals and absolute paths before extraction.
        $archive = [IO.Compression.ZipFile]::OpenRead($ZipFile)
        try {
            foreach ($entry in $archive.Entries) {
                $name = $entry.FullName.Replace('\','/')
                if ($name -match '(^/|(^|/)\.\.?(/|$)|^[A-Za-z]:|:)' -or $name.EndsWith('/') -eq $false -and $name -eq '') {
                    throw "안전하지 않은 ZIP 경로입니다: $name"
                }
                $dest = [IO.Path]::GetFullPath((Join-Path $stage ($name.Replace('/',[IO.Path]::DirectorySeparatorChar))))
                if (-not $dest.StartsWith($stage + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
                    throw "안전하지 않은 ZIP 경로입니다: $name"
                }
            }
        } finally { $archive.Dispose() }
        [IO.Compression.ZipFile]::ExtractToDirectory($ZipFile,$stage)
        $folder = $stage
        if (-not (Test-Path -LiteralPath (Join-Path $folder 'manifest.json'))) {
            $children = @(Get-ChildItem -LiteralPath $stage -Directory)
            if ($children.Count -ne 1) { throw '압축파일에서 확장프로그램 루트를 찾지 못했습니다.' }
            $folder = $children[0].FullName
        }
        $version = Get-AppVersion $folder
        if ($ExpectedVersion -and [version]$ExpectedVersion -ne $version) {
            throw "릴리스 버전과 압축파일 버전이 일치하지 않습니다. ($ExpectedVersion / $version)"
        }
        foreach ($required in @('content.js','content.css','popup.html','popup.js','background.js','event-borders.js')) {
            if (-not (Test-Path -LiteralPath (Join-Path $folder $required))) { throw "필수 파일 누락: $required" }
        }
        return @{ folder=$folder; stage=$stage; version=$version }
    } catch {
        Remove-Item -LiteralPath $stage -Force -Recurse -ErrorAction SilentlyContinue
        throw
    }
}
function Apply-Package([string]$Folder, [string]$ZipFile, [string]$ExpectedVersion = '') {
    $before = Get-AppVersion $Folder
    $pkg = Get-PackageFolder $ZipFile $ExpectedVersion
    $stage = [string]$pkg.folder
    try {
        if ($pkg.version -lt $before) { throw "구버전으로 덮어쓸 수 없습니다 ($before -> $($pkg.version))." }
        $currentManifest = Read-Json (Join-Path $Folder 'manifest.json')
        $newManifest = Read-Json (Join-Path $stage 'manifest.json')
        # Google Calendar API와 OAuth 권한은 v1.2.5에서 제거되었습니다.
        if ($currentManifest.PSObject.Properties['key']) {
            $newManifest | Add-Member -MemberType NoteProperty -Name key -Value $currentManifest.key -Force
        }
        Save-Json (Join-Path $stage 'manifest.json') $newManifest
        $backup = Join-Path $DataDir ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        $null = New-Item -ItemType Directory -Path $backup -Force
        $changed = New-Object 'System.Collections.Generic.List[string]'
        $newFiles = New-Object 'System.Collections.Generic.List[string]'
        $skipNames = @('update-source.json','updater-version.json','updater-status.json')
        try {
            foreach ($sourceFile in (Get-ChildItem -LiteralPath $stage -File -Recurse)) {
                $relative = $sourceFile.FullName.Substring($stage.Length).TrimStart('\','/')
                if ($skipNames -contains $relative) { continue }
                # Only package files are copied. Updater code is never executed from a downloaded ZIP.
                $dest = Join-Path $Folder $relative
                $backupFile = Join-Path $backup $relative
                if (Test-Path -LiteralPath $dest) {
                    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force
                    Copy-Item -LiteralPath $dest -Destination $backupFile -Force
                    $changed.Add($relative)
                } else { $newFiles.Add($relative) }
                $null = New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force
                Copy-Item -LiteralPath $sourceFile.FullName -Destination $dest -Force
            }
            # Obsolete quick-time editing scripts must not linger in installed folder.
            foreach ($obsolete in @('time-shortcut.js','quick-edit.js','hover-preview.js')) {
                $obsoletePath = Join-Path $Folder $obsolete
                if (Test-Path -LiteralPath $obsoletePath -PathType Leaf) {
                    Copy-Item -LiteralPath $obsoletePath -Destination (Join-Path $backup $obsolete) -Force
                    $changed.Add($obsolete)
                    Remove-Item -LiteralPath $obsoletePath -Force
                }
            }
        } catch {
            foreach ($rel in $newFiles) { Remove-Item -LiteralPath (Join-Path $Folder $rel) -Force -ErrorAction SilentlyContinue }
            foreach ($rel in $changed) { Copy-Item -LiteralPath (Join-Path $backup $rel) -Destination (Join-Path $Folder $rel) -Force }
            throw
        }
        try {
            if (Test-Path -LiteralPath (Join-Path $stage 'WindowsUpdater\Update-CalendarCustomizer.ps1')) {
                Copy-Item -LiteralPath (Join-Path $stage 'WindowsUpdater\Update-CalendarCustomizer.ps1') -Destination (Join-Path $DataDir 'Update-CalendarCustomizer.ps1') -Force
            }
        } catch { Write-Warning "다음 번 업데이트 관리자 교체 실패(현재 확장프로그램 업데이트는 계속): $_" }
        Save-Json (Join-Path $Folder 'updater-version.json') @{
            version = $pkg.version.ToString()
            updatedAt = (Get-Date).ToUniversalTime().ToString('o')
            method = 'WindowsUpdater'
        }
        Write-Host "확장프로그램 파일 업데이트 완료: $before -> $($pkg.version)" -ForegroundColor Green
        Write-Host "기존 확장프로그램 폴더 유지: $Folder"
        Write-Host '브라우저가 실행 중이면 확장프로그램에서 최대 약 3분 후 자동 새로고침을 시도합니다.'
        Write-Host '기존 Google Calendar 탭은 직접 새로고침해야 변경된 화면 스크립트가 적용됩니다.'
        Get-ChildItem -LiteralPath $DataDir -Directory -Filter 'backup-*' |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } finally {
        Remove-Item -LiteralPath $pkg.stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
function Get-Latest($Config) {
    $repo = [string]$Config.repository
    if ($repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'GitHub 저장소(owner/repo)가 설정되지 않았습니다.' }
    $apiUrl = "https://api.github.com/repos/$repo/releases/latest"
    $headers = @{ 'User-Agent'='GCalCustomizerUpdater/1.2.6'; 'Accept'='application/vnd.github+json' }
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 25
    $tag = ([string]$release.tag_name) -replace '^[vV]',''
    if ($tag -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw '최신 릴리스 태그는 v1.2.6 형식이어야 합니다.' }
    $assetName = "google-calendar-customizer-v$tag.zip"
    $asset = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
    if (-not $asset) { throw "릴리스에 필수 ZIP 자산이 없습니다: $assetName" }
    $digest = [string]$asset.digest
    if ($digest -notmatch '^sha256:([0-9a-fA-F]{64})$') {
        throw 'SHA256 검증값이 없는 릴리스는 보안상 자동 설치하지 않습니다.'
    }
    $sha = $Matches[1].ToLowerInvariant()
    if ($asset.browser_download_url -notmatch '^https://github\.com/') { throw 'GitHub 외 다운로드 URL은 허용하지 않습니다.' }
    return @{version=[version]$tag;url=[string]$asset.browser_download_url;sha256=$sha}
}
function Download-Latest([string]$Target, $Latest) {
    $download = Join-Path $env:TEMP ('GCalCustDownload_' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        Invoke-WebRequest -Uri $Latest.url -OutFile $download -UseBasicParsing -TimeoutSec 150
        $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $Latest.sha256) { throw 'SHA256 검증 실패. 기존 설치는 변경되지 않았습니다.' }
        Apply-Package -Folder $Target -ZipFile $download -ExpectedVersion $Latest.version.ToString()
    } finally {
        Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
    }
}
function Register-AutoTask {
    $script = Join-Path $DataDir 'Update-CalendarCustomizer.ps1'
    $args = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '" -Auto'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 6) -RepetitionDuration (New-TimeSpan -Days 3650)
    $username = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $username -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Write-Host '6시간마다 자동 업데이트 확인 작업을 등록했습니다.' -ForegroundColor Green
}
function Remove-AutoTask {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
}
try {
    if ($Setup) {
        if (-not $SourceDirectory) { throw '압축 해제된 설치 패키지의 경로가 필요합니다.' }
        $SourceDirectory = Resolve-DirectoryPath $SourceDirectory '업데이트 파일'
        $null = Get-AppVersion $SourceDirectory
        Write-Host 'Google Calendar 커스터마이저 업데이트 관리자 설정' -ForegroundColor Cyan
        $existing = Read-Json $ConfigPath
        $target = if ($existing -and (Test-Path -LiteralPath $existing.installPath)) {
            $choice = Read-Host "기존 설치 폴더 재사용: $($existing.installPath) (Y/n)"
            if ($choice -eq '' -or $choice -match '^[Yy]') { [string]$existing.installPath } else { Read-TargetFolder }
        } else { Read-TargetFolder }
        $target = Resolve-DirectoryPath $target '기존 확장프로그램 설치'
        $null = Get-AppVersion $target
        $repository = [string]$existing.repository
        $answer = Read-Host "GitHub Releases 저장소 (owner/repo, 현재: $repository, 빈칸=기존값 유지)"
        if ($answer) { $repository = $answer.Trim() }
        if ($repository -and $repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'owner/repo 형식으로 입력해 주세요.' }
        $automatic = $false
        if ($repository) {
            $autoAnswer = Read-Host '6시간마다 자동 업데이트를 적용할까요? (Y/n)'
            $automatic = ($autoAnswer -eq '' -or $autoAnswer -match '^[Yy]')
        }
        $config = @{ installPath=$target; repository=$repository; automatic=$automatic }
        Save-Json $ConfigPath $config
        Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $DataDir 'Update-CalendarCustomizer.ps1') -Force
        if ($target.TrimEnd('\') -ne $SourceDirectory.TrimEnd('\')) {
            $tmp = Join-Path $env:TEMP ('GCalCustLocal_' + [guid]::NewGuid().ToString('N') + '.zip')
            try {
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                [IO.Compression.ZipFile]::CreateFromDirectory($SourceDirectory,$tmp)
                Apply-Package -Folder $target -ZipFile $tmp
            } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        }
        Update-SourceFile $config
        Write-Status $config 'ready' ('업데이트 관리자 설정 완료. 현재 ' + (Get-AppVersion $target))
        if ($automatic) {
            try { Register-AutoTask } catch { $config.automatic=$false; Save-Json $ConfigPath $config; Update-SourceFile $config; Write-Warning "자동 작업 등록 실패: $_" }
        } else { Remove-AutoTask }
        Write-Host '설정 완료. 브라우저에서 확장프로그램과 구글 캘린더를 새로고침해 주세요.' -ForegroundColor Green
        if (-not $repository) { Write-Host '온라인 업데이트를 쓰려면 GitHub 릴리스 저장소를 연결하여 설정을 다시 실행하세요.' }
        exit 0
    }
    $config = Read-Json $ConfigPath
    if (-not $config) { throw '업데이트 관리자가 설정되지 않았습니다. Install-or-Update.cmd를 먼저 실행해 주세요.' }
    $target = Resolve-DirectoryPath ([string]$config.installPath) '설정된 설치'
    $installed = Get-AppVersion $target
    if ($Auto -and -not $config.automatic) { exit 0 }
    $latest = Get-Latest $config
    if ($latest.version -le $installed) {
        Write-Host "최신 버전입니다: $installed"
        Write-Status $config 'latest' ("최신 버전 v$installed")
        exit 0
    }
    Write-Host "새 릴리스 발견: $installed -> $($latest.version)"
    Download-Latest -Target $target -Latest $latest
    Write-Status $config 'applied' ("v$($latest.version) 파일 업데이트 완료")
} catch {
    $message = $_.Exception.Message
    Write-Host "오류: $message" -ForegroundColor Red
    try {
        $config = Read-Json $ConfigPath
        if ($config) { Write-Status $config 'error' $message }
    } catch { }
    exit 1
}
