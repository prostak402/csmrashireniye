// === popup.js ===
const DEF = {
  autoEnabled: false,
  autoActionsEnabled: true,
  autoMode: 'active',
  autoIntervalMs: 1000,
  autoScanLimit: 20,
  autoRoiThresholdPct: 20,
  autoRandomMinMs: 120,
  autoRandomMaxMs: 420
};

const ROI_THRESHOLD_MIN = -1000;
const ROI_THRESHOLD_MAX = 1000;

const CONTROL_IDS = [
  'autoEnabled',
  'autoActionsEnabled',
  'autoMode',
  'autoIntervalMs',
  'autoScanLimit',
  'autoRoiThresholdPct',
  'autoRandomMinMs',
  'autoRandomMaxMs'
];

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, ok = true) {
  const statusEl = $('status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = ok ? '#111827' : '#b91c1c';
}

function getNumberInput(id, fallback) {
  const node = $(id);
  if (!node) return fallback;
  const value = Number(node.value);
  return Number.isFinite(value) ? value : fallback;
}

function clampRoiThreshold(value) {
  return Math.min(ROI_THRESHOLD_MAX, Math.max(ROI_THRESHOLD_MIN, value));
}

function applyRandomBounds(data) {
  if (data.autoRandomMaxMs < data.autoRandomMinMs) {
    const min = data.autoRandomMinMs;
    data.autoRandomMinMs = data.autoRandomMaxMs;
    data.autoRandomMaxMs = min;
    setFormValue('autoRandomMinMs', data.autoRandomMinMs);
    setFormValue('autoRandomMaxMs', data.autoRandomMaxMs);
  }
  return data;
}

function setFormValue(id, value) {
  const node = $(id);
  if (!node) return;
  if (node.type === 'checkbox') {
    node.checked = !!value;
  } else {
    node.value = value ?? '';
  }
}

function fillForm(rawSettings) {
  const s = { ...DEF, ...(rawSettings || {}) };
  setFormValue('autoEnabled', s.autoEnabled);
  setFormValue('autoActionsEnabled', s.autoActionsEnabled);
  setFormValue('autoMode', s.autoMode);
  setFormValue('autoIntervalMs', s.autoIntervalMs);
  setFormValue('autoScanLimit', s.autoScanLimit);
  setFormValue('autoRoiThresholdPct', s.autoRoiThresholdPct);
  setFormValue('autoRandomMinMs', s.autoRandomMinMs);
  setFormValue('autoRandomMaxMs', s.autoRandomMaxMs);
}

function loadSettings() {
  chrome.storage.sync.get(DEF, (settings) => {
    const err = chrome.runtime.lastError;
    if (err) {
      setStatus(`Ошибка загрузки настроек: ${err.message}`, false);
      return;
    }
    fillForm(settings);
    setStatus('Настройки загружены');
  });
}

function collectForm() {
  const payload = {
    autoEnabled: !!$('autoEnabled')?.checked,
    autoActionsEnabled: !!$('autoActionsEnabled')?.checked,
    autoMode: $('autoMode')?.value || DEF.autoMode,
    autoIntervalMs: Math.max(250, getNumberInput('autoIntervalMs', DEF.autoIntervalMs)),
    autoScanLimit: Math.max(1, Math.trunc(getNumberInput('autoScanLimit', DEF.autoScanLimit))),
    autoRoiThresholdPct: clampRoiThreshold(getNumberInput('autoRoiThresholdPct', DEF.autoRoiThresholdPct)),
    autoRandomMinMs: Math.max(0, getNumberInput('autoRandomMinMs', DEF.autoRandomMinMs)),
    autoRandomMaxMs: Math.max(0, getNumberInput('autoRandomMaxMs', DEF.autoRandomMaxMs))
  };
  return applyRandomBounds(payload);
}

function saveSettings() {
  const data = collectForm();
  chrome.storage.sync.set(data, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      setStatus(`Ошибка сохранения: ${err.message}`, false);
      return;
    }
    setStatus('Настройки применены');
  });
}

function withActiveCsMoneyTabs(cb) {
  chrome.tabs.query({ url: '*://*.cs.money/*' }, (tabs) => {
    (tabs || []).forEach((tab) => {
      if (!tab?.id) return;
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'RECOMPARE_ALL' });
      } catch (_) {
        // ignore sendMessage errors
      }
    });
    cb?.(tabs || []);
  });
}

function handleForceRefresh() {
  setStatus('Обновляю прайс…');
  chrome.runtime.sendMessage({ type: 'REFRESH_PRICES' }, (resp) => {
    const err = chrome.runtime.lastError;
    if (err) {
      setStatus(`Ошибка: ${err.message}`, false);
      return;
    }
    if (resp?.ok) {
      const t = resp.ts ? new Date(resp.ts).toLocaleTimeString() : '';
      const count = resp.count != null ? String(resp.count) : '—';
      setStatus(`Обновлено: ${t}\nПозиций: ${count}`);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs && tabs[0];
        if (activeTab?.id) {
          try {
            chrome.tabs.sendMessage(activeTab.id, { type: 'RECOMPARE_ALL' });
          } catch (_) {
            // ignore sendMessage errors
          }
        }
      });
    } else {
      setStatus(`Ошибка: ${resp?.error || 'нет ответа'}`, false);
    }
  });
}

function handleStopAuto() {
  chrome.storage.sync.set({ autoEnabled: false }, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      setStatus(`Ошибка: ${err.message}`, false);
      return;
    }
    setStatus('Авто-режим выключен');
    withActiveCsMoneyTabs();
  });
}

function bindEvents() {
  $('force')?.addEventListener('click', handleForceRefresh);
  $('stop')?.addEventListener('click', handleStopAuto);
  $('reloadUi')?.addEventListener('click', loadSettings);
  $('saveAuto')?.addEventListener('click', saveSettings);
}

function initLiveSync() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!Object.keys(changes).some((key) => CONTROL_IDS.includes(key))) return;
    chrome.storage.sync.get(DEF, (settings) => {
      const err = chrome.runtime.lastError;
      if (err) {
        setStatus(`Ошибка обновления: ${err.message}`, false);
        return;
      }
      fillForm(settings);
      setStatus('Настройки обновлены');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initLiveSync();
  loadSettings();
});
