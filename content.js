(() => {
  "use strict";

  if (window.__GCW_WEEKEND_CUSTOMIZER__) return;
  window.__GCW_WEEKEND_CUSTOMIZER__ = true;

  const DEFAULTS = Object.freeze({
    enabled: true,
    theme: "system",
    eventShapesEnabled: true,
    saturdayBgAlpha: 100, saturdayTextAlpha: 100,
    sundayBgAlpha: 100, sundayTextAlpha: 100,
    todayHighlight: true,
    eventBordersEnabled: true,
    weekendPreset: "auto",
    saturdayBg: "#fff1f2",
    saturdayText: "#be123c",
    sundayBg: "#ffe4e6",
    sundayText: "#b91c1c"
  });
  // 각 주말 프리셋은 토요일/일요일 배경·날짜 글자색을 별도로 지정합니다.
  const PRESETS = Object.freeze({
    light: { saturdayBg: "#fff1f2", saturdayText: "#be123c", sundayBg: "#ffe4e6", sundayText: "#b91c1c" },
    wine: { saturdayBg: "#302027", saturdayText: "#ffa1b1", sundayBg: "#43242e", sundayText: "#ff94a8" },
    charcoal: { saturdayBg: "#24272d", saturdayText: "#f6a2b3", sundayBg: "#30292f", sundayText: "#ff9bad" }
  });
  const PRESET_NAMES = ["auto", "light", "wine", "charcoal", "custom"];
  const DATE_KEY_SELECTOR = "[data-datekey],[data-date-key],[datekey],[dateKey]";
  const EVENT_SELECTOR = "[data-eventid],[data-event-id],[data-eventchip],[data-event-chip], [role='option']";
  const MARKED_SELECTOR = "[data-gcw-day], [data-gcw-header], .gcw-date-label, .gcw-day-surface";
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  function opacity(value) { return Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : 100; }
  function rgba(hex, percent) {
    const a = opacity(percent) / 100;
    if (a === 1) return hex;
    const n = [1, 3, 5].map(pos => parseInt(hex.slice(pos, pos + 2), 16));
    return `rgba(${n[0]}, ${n[1]}, ${n[2]}, ${a})`;
  }
  let config = { ...DEFAULTS };
  let observer;
  let scheduled = 0;
  let overlayTimer = 0;
  let overlays = [];
  let lastAppliedPalette = "";
  let themeObserver;
  let darkMediaQuery;
  let todayColumnOverlay = null;
  let midnightTimer = 0;

  function safeColor(value, fallback) {
    return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
  }

  function migratedPreset(raw) {
    if (PRESET_NAMES.includes(raw.weekendPreset)) return raw.weekendPreset;
    // v1.2.2 이전 사용자가 직접 지정한 색상은 초기 업그레이드 시 보존합니다.
    for (const key of ["saturdayBg", "saturdayText", "sundayBg", "sundayText"]) {
      if (typeof raw[key] === "string" && HEX_COLOR.test(raw[key]) &&
          raw[key].toLowerCase() !== DEFAULTS[key].toLowerCase()) return "custom";
    }
    return "auto";
  }

  function normalizeConfig(input) {
    return {
      enabled: input.enabled !== false,
      theme: ["system", "light", "dark"].includes(input.theme) ? input.theme : "system",
      eventShapesEnabled: input.eventShapesEnabled !== false,
      saturdayBgAlpha: opacity(input.saturdayBgAlpha), saturdayTextAlpha: opacity(input.saturdayTextAlpha),
      sundayBgAlpha: opacity(input.sundayBgAlpha), sundayTextAlpha: opacity(input.sundayTextAlpha),
      todayHighlight: input.todayHighlight !== false,
      eventBordersEnabled: input.eventBordersEnabled !== false,
      weekendPreset: PRESET_NAMES.includes(input.weekendPreset) ? input.weekendPreset : "auto",
      saturdayBg: safeColor(input.saturdayBg, DEFAULTS.saturdayBg),
      saturdayText: safeColor(input.saturdayText, DEFAULTS.saturdayText),
      sundayBg: safeColor(input.sundayBg, DEFAULTS.sundayBg),
      sundayText: safeColor(input.sundayText, DEFAULTS.sundayText)
    };
  }

  // Google Calendar의 data-datekey는 (연도-1970)*512 + 월*32 + 일입니다.
  function dateKeyToDateParts(raw) {
    if (raw === null || !/^-?\d+$/.test(String(raw))) return null;
    const key = Number(raw);
    if (!Number.isSafeInteger(key)) return null;
    const offset = Math.floor(key / 512);
    const remainder = key - offset * 512;
    const month = Math.floor(remainder / 32);
    const date = remainder % 32;
    const year = 1970 + offset;
    if (month < 1 || month > 12 || date < 1 || date > 31) return null;
    const parsed = new Date(Date.UTC(year, month - 1, date));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) {
      return null;
    }
    return { year, month, date, weekday: parsed.getUTCDay() };
  }

  function dateKeyToDayOfWeek(raw) {
    return dateKeyToDateParts(raw)?.weekday ?? null;
  }

  function isTodayDateKey(raw) {
    const parts = dateKeyToDateParts(raw);
    if (!parts) return false;
    const current = new Date();
    return parts.year === current.getFullYear() &&
      parts.month === current.getMonth() + 1 && parts.date === current.getDate();
  }

  function getDateKey(el) {
    for (const name of ["data-datekey", "data-date-key", "datekey", "dateKey"]) {
      if (el.hasAttribute(name)) return el.getAttribute(name);
    }
    return null;
  }

  function dayCode(weekday) {
    return weekday === 0 ? "sun" : weekday === 6 ? "sat" : null;
  }

  function setVariable(name, value) {
    document.documentElement.style.setProperty(`--gcw-${name}`, value);
  }

  // Google Calendar의 기본 테마(system)는 OS 설정과 다를 수 있으므로
  // 실제 달력 외곽의 계산된 배경색을 먼저 검사합니다.
  function isDarkCanvas() {
    if (config.theme === "dark") return true;
    if (config.theme === "light") return false;
    for (const selector of ["[role='main']", "main", "#yDmH0d", "body", "html"]) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const color = getComputedStyle(node).backgroundColor;
      const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(color);
      if (!match || (match[4] != null && Number(match[4]) < 0.5)) continue;
      const [red, green, blue] = match.slice(1, 4).map(Number);
      return (red * 0.2126 + green * 0.7152 + blue * 0.0722) < 125;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function getActivePalette() {
    const dark = isDarkCanvas();
    const preset = config.weekendPreset === "auto" ? (dark ? "wine" : "light") : config.weekendPreset;
    return {
      dark, preset,
      colors: preset === "custom" ? {
        saturdayBg: config.saturdayBg, saturdayText: config.saturdayText,
        sundayBg: config.sundayBg, sundayText: config.sundayText
      } : PRESETS[preset]
    };
  }

  function applyWeekendPalette() {
    const active = getActivePalette();
    const values = active.colors;
    const key = [active.preset, ...Object.values(values), config.saturdayBgAlpha,
      config.saturdayTextAlpha, config.sundayBgAlpha, config.sundayTextAlpha].join("|");
    if (lastAppliedPalette === key) return;
    lastAppliedPalette = key;
    for (const [name, value] of Object.entries(values)) {
      const cssName = name.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
      setVariable(cssName + "-raw", rgba(value, config[name + 'Alpha']));
    }
    document.documentElement.classList.toggle("gcw-weekend-dark-palette", ["wine", "charcoal"].includes(active.preset));
  }

  function renderSettings() {
    document.documentElement.classList.toggle("gcw-enabled", config.enabled);
    document.documentElement.classList.toggle("gcw-today-on", config.todayHighlight);
    document.documentElement.classList.toggle("gcw-event-borders-on", config.eventBordersEnabled);
    document.documentElement.classList.toggle("gcw-theme-dark", config.theme === "dark");
    document.documentElement.classList.toggle("gcw-theme-light", config.theme === "light");
    lastAppliedPalette = "";
    applyWeekendPalette();
    document.documentElement.classList.toggle("gcw-today-dark", isDarkCanvas());
    if (!config.enabled) hideOverlays();
    scheduleScan();
  }

  function isEvent(el) {
    return !!el.closest(EVENT_SELECTOR);
  }

  // '토요일', '일요일', 'Sat', 'Sun' 등 다국어 헤더 텍스트 대응.
  function weekdayFromText(value) {
    const v = String(value || "").trim().replace(/\s+/g, " ");
    if (/^(토요일|토)(?=\s|$|\d|\(|,)/.test(v) || /^(Saturday|Sat)(?=\s|$|\d|\(|,)/i.test(v) || /^(土曜日|土)(?=\s|$|\d|\()/u.test(v)) return 6;
    if (/^(일요일|일)(?=\s|$|\d|\(|,)/.test(v) || /^(Sunday|Sun)(?=\s|$|\d|\(|,)/i.test(v) || /^(日曜日)(?=\s|$|\d|\()/u.test(v)) return 0;
    return null;
  }

  function getHeaderWeekday(header) {
    const ownDate = getDateKey(header);
    const withDate = ownDate != null ? header : header.querySelector(DATE_KEY_SELECTOR);
    if (withDate) {
      const day = dateKeyToDayOfWeek(getDateKey(withDate));
      if (day !== null) return day;
    }
    const label = header.getAttribute("aria-label") || "";
    let found = weekdayFromText(label);
    if (found !== null) return found;
    // 헤더에 날짜 숫자가 함께 있어도 앞부분의 요일 이름을 식별합니다.
    found = weekdayFromText((header.textContent || "").slice(0, 80));
    return found;
  }

  function markNumberLabels(dayEl, dayCodeValue, expectedDay) {
    const elementCandidates = [dayEl, ...dayEl.querySelectorAll("span, time, button, div")];
    let marked = 0;
    for (const candidate of elementCandidates) {
      if (marked >= 2) break;
      if (candidate !== dayEl && candidate.closest(EVENT_SELECTOR)) continue;
      if (candidate !== dayEl && candidate.closest(DATE_KEY_SELECTOR) !== dayEl) continue;
      const value = (candidate.textContent || "").trim();
      if (!/^\d{1,2}$/.test(value) || Number(value) !== expectedDay) continue;
      if (candidate.children.length && Array.from(candidate.children).some(ch => /\d/.test(ch.textContent || ""))) continue;
      candidate.classList.add("gcw-date-label");
      candidate.setAttribute("data-gcw-day", dayCodeValue);
      marked++;
    }
  }

  // data-datekey의 날짜를 기준으로 오늘을 판별합니다. 숫자 '12'만 비교하지 않아
  // 다른 달의 같은 날짜나 다른 지역 설정의 주 시작 요일과 혼동하지 않습니다.
  function markDateCells(root) {
    const dateElements = root.querySelectorAll(DATE_KEY_SELECTOR);
    let total = 0;
    // 날짜 이동이나 자정 이후에도 이전 강조가 남지 않도록 기존 표식을 초기화합니다.
    root.querySelectorAll('.gcw-today-cell, .gcw-today-number').forEach(el => {
      el.classList.remove('gcw-today-cell', 'gcw-today-number');
    });
    for (const cell of dateElements) {
      if (isEvent(cell)) continue;
      const raw = getDateKey(cell);
      const parts = dateKeyToDateParts(raw);
      if (!parts) continue;
      const code = dayCode(parts.weekday);
      if (code) {
        cell.setAttribute('data-gcw-day', code);
        if (!cell.hasAttribute('jsaction') && cell.getAttribute('role') !== 'button') {
          cell.classList.add('gcw-day-surface');
        }
        markNumberLabels(cell, code, parts.date);
      }
      if (isTodayDateKey(raw)) {
        // 우선 날짜 셀 자체를 강조합니다. Google Calendar가 날짜키를
        // 작은 날짜 라벨에만 놓는 레이아웃에서는 gridcell을 사용합니다.
        const box = cell.getBoundingClientRect();
        let target = cell;
        if (box.width < 55 || box.height < 40) {
          const gridCell = cell.closest('[role="gridcell"]');
          if (gridCell && gridCell.getBoundingClientRect().width >= 55 &&
              gridCell.getBoundingClientRect().height >= 40 &&
              gridCell.querySelectorAll(DATE_KEY_SELECTOR).length <= 2) {
            target = gridCell;
          }
        }
        const rect = target.getBoundingClientRect();
        if (rect.width >= 55 && rect.height >= 40) {
          target.classList.add('gcw-today-cell');
        } else {
          cell.classList.add('gcw-today-number');
        }
      }
      total++;
    }
    return total;
  }

  function markHeaders(root) {
    const headers = Array.from(root.querySelectorAll('[role="columnheader"]'));
    for (const header of headers) {
      const code = dayCode(getHeaderWeekday(header));
      const datedNode = getDateKey(header) !== null ? header : header.querySelector(DATE_KEY_SELECTOR);
      const isToday = !!datedNode && isTodayDateKey(getDateKey(datedNode));
      if (isToday) header.setAttribute('data-gcw-header-today', '1');
      else header.removeAttribute('data-gcw-header-today');
      if (!code) continue;
      header.setAttribute("data-gcw-header", code);
      // 헤더의 작은 숫자/요일 텍스트에도 주말 글자색을 적용합니다.
      const textNodes = header.querySelectorAll("span, div, button");
      for (const child of textNodes) {
        if (child.children.length === 0 && !isEvent(child)) {
          child.classList.add("gcw-date-label");
          child.setAttribute("data-gcw-day", code);
        }
      }
    }
    return headers;
  }

  function hideOverlays() {
    for (const overlay of overlays) overlay.style.visibility = 'hidden';
    if (todayColumnOverlay) todayColumnOverlay.style.visibility = 'hidden';
  }

  function ensureOverlays() {
    while (overlays.length < 2) {
      const overlay = document.createElement("div");
      overlay.className = "gcw-week-overlay";
      overlay.setAttribute("aria-hidden", "true");
      document.body.appendChild(overlay);
      overlays.push(overlay);
    }
    hideOverlays();
  }

  // 주간 보기: 날짜 키가 없는 시간표 하단에도 연한 세로 배경을 얹습니다.
  // 실제 이벤트 DOM은 변경하지 않으며, 드래그/클릭은 통과시킵니다.
  function updateWeeklyOverlays(root, dateCount, headers) {
    if (!config.enabled || !(root instanceof Element)) { hideOverlays(); return; }
    const validHeaders = headers.filter(h => h.getBoundingClientRect().width > 35);
    // 월간 보기의 많은 날짜 셀 또는 일정 보기에는 오버레이를 사용하지 않습니다.
    if (dateCount > 18 || validHeaders.length < 5 || validHeaders.length > 8) { hideOverlays(); return; }
    const bounds = root.getBoundingClientRect();
    if (bounds.width < 200 || bounds.height < 200) { hideOverlays(); return; }
    const weekendHeaders = validHeaders.filter(h => h.getAttribute("data-gcw-header"));
    if (!weekendHeaders.length) { hideOverlays(); return; }
    ensureOverlays();
    let idx = 0;
    for (const header of weekendHeaders) {
      if (idx >= overlays.length) break;
      const r = header.getBoundingClientRect();
      const left = Math.max(bounds.left, r.left);
      const right = Math.min(bounds.right, r.right);
      const top = Math.max(bounds.top, r.bottom);
      const bottom = Math.min(bounds.bottom, window.innerHeight);
      if (right - left < 35 || bottom - top < 80) continue;
      const overlay = overlays[idx++];
      overlay.dataset.gcwDay = header.dataset.gcwHeader;
      Object.assign(overlay.style, {
        left: `${left}px`, top: `${top}px`, width: `${right - left}px`,
        height: `${bottom - top}px`, visibility: "visible"
      });
    }
  }

  function updateTodayColumnOverlay(root, dateCount, headers) {
    if (!config.todayHighlight || dateCount > 18) {
      if (todayColumnOverlay) todayColumnOverlay.style.visibility = 'hidden';
      return;
    }
    const valid = headers.filter(h => h.getBoundingClientRect().width > 35);
    const header = valid.length >= 5 && valid.length <= 8
      ? valid.find(h => h.getAttribute('data-gcw-header-today') === '1') : null;
    if (!header) {
      if (todayColumnOverlay) todayColumnOverlay.style.visibility = 'hidden';
      return;
    }
    const outer = root.getBoundingClientRect();
    const rect = header.getBoundingClientRect();
    const left = Math.max(outer.left, rect.left);
    const right = Math.min(outer.right, rect.right);
    const top = Math.max(outer.top, rect.bottom);
    const bottom = Math.min(outer.bottom, window.innerHeight);
    if (right - left < 35 || bottom - top < 65) return;
    if (!todayColumnOverlay) {
      todayColumnOverlay = document.createElement('div');
      todayColumnOverlay.className = 'gcw-today-column-overlay';
      todayColumnOverlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(todayColumnOverlay);
    }
    Object.assign(todayColumnOverlay.style, {
      left: `${left}px`, top: `${top}px`, width: `${right-left}px`,
      height: `${bottom-top}px`, visibility: 'visible'
    });
  }

  function scan() {
    scheduled = 0;
    applyWeekendPalette();
    document.documentElement.classList.toggle('gcw-today-dark', isDarkCanvas());
    const root = document.querySelector('[role="main"]') || document.querySelector('main');
    if (!root) { hideOverlays(); return; }
    const count = markDateCells(root);
    const headers = markHeaders(root);
    if (config.enabled) updateWeeklyOverlays(root, count, headers);
    else for (const overlay of overlays) overlay.style.visibility = 'hidden';
    updateTodayColumnOverlay(root, count, headers);
  }

  function scheduleMidnightRefresh() {
    if (midnightTimer) clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    midnightTimer = setTimeout(() => {
      scan();
      scheduleMidnightRefresh();
    }, Math.max(1000, next.getTime() - now.getTime()));
  }

  function scheduleScan() {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(scan, 160);
  }

  function scheduleOverlayUpdate() {
    if (overlayTimer) cancelAnimationFrame(overlayTimer);
    overlayTimer = requestAnimationFrame(() => {
      overlayTimer = 0;
      scheduleScan();
    });
  }

  async function initialize() {
    try {
      const raw = await chrome.storage.local.get(null);
      config = normalizeConfig({ ...DEFAULTS, ...raw, weekendPreset: migratedPreset(raw) });
    } catch (error) {
      console.warn("[GC 주말 컬러] 설정 로딩 실패, 기본값 사용:", error);
    }
    renderSettings();
    // 캘린더 자체의 테마 변경 시에도 검은 배경인지 다시 판별합니다.
    themeObserver = new MutationObserver(scheduleScan);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "data-theme"]});
    darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkMediaQuery.addEventListener("change", scheduleScan);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action !== "GCW_GET_APPEARANCE") return;
      const active = getActivePalette();
      sendResponse({ dark: active.dark, preset: active.preset });
    });
    observer = new MutationObserver((mutations) => {
      if (mutations.some(m => {
        if (m.type === "attributes") return true;
        return Array.from(m.addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains("gcw-week-overlay"));
      })) scheduleScan();
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      // 확장프로그램이 쓰는 class/style/data-gcw-* 속성은 감시하지 않습니다.
      attributeFilter: ["data-datekey", "data-date-key", "datekey", "dateKey", "aria-label"]
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (Object.keys(DEFAULTS).some(key => Object.hasOwn(changes, key))) {
        const next = { ...config };
        for (const key of Object.keys(DEFAULTS)) {
          if (Object.hasOwn(changes, key)) next[key] = changes[key].newValue ?? DEFAULTS[key];
        }
        config = normalizeConfig(next);
        renderSettings();
      }
    });
    window.addEventListener("resize", scheduleOverlayUpdate, { passive: true });
    window.addEventListener("scroll", scheduleOverlayUpdate, { passive: true, capture: true });
    scan();
    scheduleMidnightRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
