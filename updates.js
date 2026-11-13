(() => {
  'use strict';
  const CHECK_ALARM = 'gcal-check-release-v1';
  const RELOAD_ALARM = 'gcal-check-disk-version-v1';
  const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
  const VERSION_RE = /^\d+\.\d+\.\d+(?:\.\d+)?$/;
  function compareVersion(a, b) {
    const left = String(a).split('.').map(Number), right = String(b).split('.').map(Number);
    for (let i=0; i<Math.max(left.length,right.length);i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff) return diff;
    }
    return 0;
  }
  async function readJson(path) {
    const response = await fetch(chrome.runtime.getURL(path), {cache: 'no-store'});
    if (!response.ok) throw new Error(`${path} 파일을 읽지 못했습니다.`);
    return response.json();
  }
  async function source() {
    const config = await readJson('update-source.json');
    const repo = typeof config.repository === 'string' ? config.repository.trim() : '';
    return {repo: REPO_RE.test(repo) ? repo : '', automatic: config.automatic === true};
  }
  async function checkLatest() {
    const currentVersion = chrome.runtime.getManifest().version;
    const config = await source();
    if (!config.repo) return {status:'unconfigured', currentVersion};
    const response = await fetch(`https://api.github.com/repos/${config.repo}/releases/latest`, {
      cache:'no-store',headers:{'Accept':'application/vnd.github+json'}
    });
    if (!response.ok) throw new Error(`GitHub 조회 오류 (${response.status})`);
    const data = await response.json();
    const latestVersion = String(data.tag_name || '').replace(/^v/i,'');
    if (!VERSION_RE.test(latestVersion)) throw new Error('릴리스 태그 형식이 v1.2.4이 아닙니다.');
    if (compareVersion(latestVersion,currentVersion)<=0) return {status:'latest',currentVersion,latestVersion};
    const asset = (data.assets||[]).find(item =>
      /^google-calendar-customizer-v\d+\.\d+\.\d+\.zip$/i.test(item.name||'') &&
      (item.name||'').toLowerCase().includes(`v${latestVersion}.zip`.toLowerCase()) &&
      /^https:\/\/github\.com\//i.test(item.browser_download_url||''));
    if (!asset) throw new Error('신규 릴리스에서 전용 ZIP 파일을 찾지 못했습니다.');
    return {status:'new',currentVersion,latestVersion,asset:asset.browser_download_url};
  }
  async function checkAndBadge() {
    const update = await checkLatest();
    const isNew = update.status === 'new';
    await chrome.action.setBadgeText({text: isNew ? 'UP' : ''});
    if (isNew) await chrome.action.setBadgeBackgroundColor({color:'#BE3455'});
    await chrome.storage.local.set({gcwLatestUpdate: update, gcwLastUpdateCheck: Date.now()});
  }
  async function checkDiskVersion() {
    const file = await readJson('updater-version.json');
    if (!VERSION_RE.test(file.version||'')) return;
    if (compareVersion(file.version,chrome.runtime.getManifest().version) > 0) {
      await chrome.storage.local.set({gcwUpdatedNeedsTabReload:true});
      chrome.runtime.reload();
    }
  }
  async function configureAlarms() {
    await chrome.alarms.create(RELOAD_ALARM, {periodInMinutes:3});
    await chrome.alarms.create(CHECK_ALARM, {periodInMinutes:360});
    const config = await source();
    if (config.repo) checkAndBadge().catch(console.warn);
  }
  chrome.runtime.onInstalled.addListener(() => { configureAlarms().catch(console.warn); });
  chrome.runtime.onStartup.addListener(() => { configureAlarms().catch(console.warn); });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RELOAD_ALARM) checkDiskVersion().catch(console.warn);
    if (alarm.name === CHECK_ALARM) checkAndBadge().catch(console.warn);
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
    // Popup only: never give externally reachable websites update control.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) return false;
    if (message?.action !== 'GCW_UPDATE_CHECK') return false;
    checkLatest().then(result => sendResponse({ok:true,...result}))
      .catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  });
  configureAlarms().catch(console.warn);
})();
