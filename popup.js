(() => {
  'use strict';
  const DEFAULTS = {
    enabled: true, theme: 'system', eventDotsEnabled: true, eventDotDefault: 'circle',
    todayHighlight: true, eventBordersEnabled: true, eventShapesEnabled: true,
    saturdayBgAlpha: 100, saturdayTextAlpha: 100,
    sundayBgAlpha: 100, sundayTextAlpha: 100, weekendPreset: 'auto',
    saturdayBg: '#fff1f2', saturdayText: '#be123c',
    sundayBg: '#ffe4e6', sundayText: '#b91c1c'
  };
  const PRESETS = {
    light: { saturdayBg: '#fff1f2', saturdayText: '#be123c', sundayBg: '#ffe4e6', sundayText: '#b91c1c' },
    wine: { saturdayBg: '#302027', saturdayText: '#ffa1b1', sundayBg: '#43242e', sundayText: '#ff94a8' },
    charcoal: { saturdayBg: '#24272d', saturdayText: '#f6a2b3', sundayBg: '#30292f', sundayText: '#ff9bad' }
  };
  const PRESET_NAMES = ['auto', 'light', 'wine', 'charcoal', 'custom'];
  const colorKeys = ['saturdayBg','saturdayText','sundayBg','sundayText'];
  const $ = id => document.getElementById(id);
  const state = { ...DEFAULTS };
  const COLOR_HEX = /^#[0-9a-f]{6}$/i;
  const alphaKeys=['saturdayBgAlpha','saturdayTextAlpha','sundayBgAlpha','sundayTextAlpha'];
  const boundedPercent=n=>Number.isFinite(Number(n))?Math.max(0,Math.min(100,Math.round(Number(n)))):100;
  function withAlpha(hex,percent){
    const alpha=boundedPercent(percent)/100;
    if(alpha===1) return hex;
    return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
  }
  let statusTimer;
  let nativeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  function isDark() {
    return state.theme === 'dark' || (state.theme === 'system' && nativeDark);
  }

  function activeColors() {
    const chosen = state.weekendPreset === 'auto' ? (isDark() ? 'wine' : 'light') : state.weekendPreset;
    return chosen === 'custom' ? Object.fromEntries(colorKeys.map(key => [key, state[key]])) : PRESETS[chosen];
  }

  async function refreshNativeAppearance() {
    if (state.theme !== 'system') return;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs?.[0]?.id) return;
      const result = await chrome.tabs.sendMessage(tabs[0].id, { action: 'GCW_GET_APPEARANCE' });
      if (typeof result?.dark === 'boolean') { nativeDark = result.dark; render(); }
    } catch (_) { /* 구글 캘린더 탭이 아니면 OS 설정을 사용합니다. */ }
  }


  function render() {
    $('enabled').checked = state.enabled;
    $('eventDotsEnabled').checked = state.eventDotsEnabled;
    $('eventDotDefault').value = state.eventDotDefault;
    $('eventShapesEnabled').checked = state.eventShapesEnabled;
    $('todayHighlight').checked = state.todayHighlight;
    $('eventBordersEnabled').checked = state.eventBordersEnabled;
    document.querySelectorAll('input[name="theme"]').forEach(el => el.checked = el.value === state.theme);
    document.querySelectorAll('input[name="weekendPreset"]').forEach(el => el.checked = el.value === state.weekendPreset);
    document.body.classList.toggle('theme-dark', isDark());
    document.body.classList.toggle('theme-light', !isDark());
    const colors = activeColors();
    for (const key of colorKeys) {
      $(key).value = colors[key];
      $(`${key}Value`).textContent = colors[key].toUpperCase();
      $(`${key}Alpha`).value=state[`${key}Alpha`];
      $(`${key}AlphaValue`).textContent=`${state[`${key}Alpha`]}%`;
    }
    $('colors').classList.toggle('off', !state.enabled);
    $('satPreview').style.backgroundColor = withAlpha(colors.saturdayBg,state.saturdayBgAlpha);
    $('satPreview').style.color = withAlpha(colors.saturdayText,state.saturdayTextAlpha);
    $('sunPreview').style.backgroundColor = withAlpha(colors.sundayBg,state.sundayBgAlpha);
    $('sunPreview').style.color = withAlpha(colors.sundayText,state.sundayTextAlpha);
    document.querySelector('.preview-week').classList.toggle('off', !state.enabled);
  }

  async function save(partial) {
    Object.assign(state, partial);
    render();
    try {
      await chrome.storage.local.set(partial);
      $('status').textContent = '저장됨';
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => $('status').textContent = '설정 자동 저장', 1800);
    } catch (error) {
      $('status').textContent = '저장 실패';
      console.error(error);
    }
  }

  async function initialize() {
    const raw = await chrome.storage.local.get(null);
    const stored = { ...DEFAULTS, ...raw };
    state.enabled = stored.enabled !== false;
    state.eventDotsEnabled=stored.eventDotsEnabled!==false;
    state.eventDotDefault=['circle','square','diamond','triangle','star','heart','ring','sparkle'].includes(stored.eventDotDefault)?stored.eventDotDefault:'circle';
    state.eventShapesEnabled=stored.eventShapesEnabled!==false;
    for(const key of alphaKeys) state[key]=boundedPercent(stored[key]);
    state.todayHighlight = stored.todayHighlight !== false;
    state.eventBordersEnabled = stored.eventBordersEnabled !== false;
    state.theme = ['system','light','dark'].includes(stored.theme) ? stored.theme : 'system';
    state.weekendPreset = PRESET_NAMES.includes(raw.weekendPreset) ? raw.weekendPreset : 'auto';
    if (!Object.hasOwn(raw, 'weekendPreset') && colorKeys.some(key =>
      typeof raw[key] === 'string' && COLOR_HEX.test(raw[key]) &&
      raw[key].toLowerCase() !== DEFAULTS[key].toLowerCase())) state.weekendPreset = 'custom';
    for (const key of colorKeys) if (typeof stored[key] === 'string' && COLOR_HEX.test(stored[key])) state[key] = stored[key];
    render();
    refreshNativeAppearance();
    $('version').textContent = `v${chrome.runtime.getManifest().version}`;
    initializeUpdater().catch(err => {
      $('updateMessage').textContent = `업데이트 상태 확인 실패: ${err.message}`;
    });
    $('enabled').addEventListener('change', e => save({ enabled: e.target.checked }));
    $('eventDotsEnabled').addEventListener('change', e => save({ eventDotsEnabled: e.target.checked }));
    $('eventDotDefault').addEventListener('change', e => save({ eventDotDefault: e.target.value }));
    $('eventShapesEnabled').addEventListener('change', e => save({ eventShapesEnabled: e.target.checked }));
    $('todayHighlight').addEventListener('change', e => save({ todayHighlight: e.target.checked }));
    $('eventBordersEnabled').addEventListener('change', e => save({ eventBordersEnabled: e.target.checked }));
    $('clearBorders').addEventListener('click', async () => {
      if (!confirm('저장된 모든 일정의 테두리·카드·점 모양을 초기화하시겠습니까?')) return;
      try { await chrome.storage.local.remove(['gcwEventBorders','gcwEventShapes','gcwEventDots']); $('status').textContent = '일정 꾸미기 초기화됨'; }
      catch { $('status').textContent = '초기화 실패'; }
    });
    document.querySelectorAll('input[name="theme"]').forEach(el => el.addEventListener('change', e => {
      if (e.target.checked) {
        save({ theme: e.target.value });
        if (e.target.value === 'system') refreshNativeAppearance();
      }
    }));
    document.querySelectorAll('input[name="weekendPreset"]').forEach(el => el.addEventListener('change', e => {
      if (e.target.checked) save({ weekendPreset: e.target.value });
    }));
    for (const key of colorKeys) $(key).addEventListener('input', e => {
      // 프리셋에서 일부 색상만 바꿔도 나머지는 그대로 유지합니다.
      const full = { ...activeColors(), [key]: e.target.value, weekendPreset: 'custom' };
      save(full);
    });
    for(const key of colorKeys) $(`${key}Alpha`).addEventListener('input', e=>{
      const colors=activeColors();
      save({...colors,weekendPreset:'custom',[`${key}Alpha`]:boundedPercent(e.target.value)});
    });
    $('reset').addEventListener('click', () => save({ ...DEFAULTS }));

  }
  let releaseAsset = null;
  async function readLocalJson(file) {
    const response = await fetch(chrome.runtime.getURL(file), { cache: 'no-store' });
    if (!response.ok) throw new Error(`${file} 읽기 실패`);
    return response.json();
  }
  async function checkNow() {
    const btn = $('checkUpdate');
    btn.disabled = true;
    $('updateMessage').textContent = 'GitHub 릴리스 확인 중…';
    try {
      const reply = await chrome.runtime.sendMessage({ action: 'GCW_UPDATE_CHECK' });
      if (!reply?.ok) throw new Error(reply?.error || '업데이트 확인 실패');
      releaseAsset = reply.asset || null;
      if (reply.status === 'unconfigured') {
        $('updateMessage').textContent = '업데이트 저장소 미설정 · Install-or-Update.cmd에서 설정하세요.';
        $('downloadUpdate').hidden = true;
      } else if (reply.status === 'new') {
        $('updateMessage').textContent = `새 버전 v${reply.latestVersion} 발견 (현재 v${reply.currentVersion})`;
        $('downloadUpdate').hidden = !releaseAsset;
      } else {
        $('updateMessage').textContent = `최신 버전입니다 (v${reply.currentVersion}).`;
        $('downloadUpdate').hidden = true;
      }
    } catch (error) {
      $('updateMessage').textContent = `확인 실패: ${error.message}`;
    } finally {
      btn.disabled = false;
    }
  }
  async function initializeUpdater() {
    let source;
    try { source = await readLocalJson('update-source.json'); } catch (_) { source = {}; }
    const repo = typeof source.repository === 'string' ? source.repository : '';
    $('updateRepo').textContent = repo
      ? `GitHub: ${repo} · 자동 설치 ${source.automatic ? '사용' : '미사용'}`
      : 'GitHub 릴리스 저장소 미설정';
    $('updateMessage').textContent = repo
      ? '자동 확인 또는 [지금 확인]으로 새 버전을 확인할 수 있습니다.'
      : '온라인 업데이트를 사용하려면 Windows 업데이트 관리자를 설정해 주세요.';
    $('checkUpdate').addEventListener('click', checkNow);
    $('downloadUpdate').addEventListener('click', () => {
      if (releaseAsset && /^https:\/\/github\.com\//i.test(releaseAsset)) {
        chrome.tabs.create({ url: releaseAsset });
      }
    });
    $('refreshExtension').addEventListener('click', () => chrome.runtime.reload());
    const versionFile = await readLocalJson('updater-version.json').catch(() => null);
    const current = chrome.runtime.getManifest().version;
    if (versionFile?.version && versionFile.version !== current) {
      $('refreshExtension').hidden = false;
      $('updateMessage').textContent = `로컬 파일 v${versionFile.version} 적용 대기 · 확장 새로고침 필요`;
    } else {
      const status = await readLocalJson('updater-status.json').catch(() => null);
      if (status?.status === 'applied' && status?.message) $('updateMessage').textContent = status.message + ' · 캘린더 화면은 새로고침하세요.';
      if (status?.status === 'error' && status?.message) $('updateMessage').textContent = '최근 업데이트 오류: ' + status.message;
    }
  }
  initialize().catch(console.error);
})();
