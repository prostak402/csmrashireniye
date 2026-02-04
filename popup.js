// === popup.js ===
const DEF = {
  autoEnabled: false,
  autoActionsEnabled: true,
  autoBuyEnabled: true,
  autoMode: 'active',
  autoIntervalMs: 1000,
  autoScanLimit: 20,
  autoRoiThresholdPct: 20,
  autoBuyRoiThresholdPct: 500,
  autoRandomMinMs: 120,
  autoRandomMaxMs: 420
};

const RUNTIME_DEFAULTS = {
  autoStatus: 'disabled',
  autoHaltReason: '',
  lastFetchError: null,
  lastPriceFetchTs: 0,
  lastPriceItemCount: 0
};

const META_DEFAULTS = {
  priceTtlMin: 5
};

const ROI_THRESHOLD_MIN = -1000;
const ROI_THRESHOLD_MAX = 1000;

const CONTROL_IDS = [
  'autoEnabled',
  'autoActionsEnabled',
  'autoBuyEnabled',
  'autoMode',
  'autoIntervalMs',
  'autoScanLimit',
  'autoRoiThresholdPct',
  'autoBuyRoiThresholdPct',
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
  setFormValue('autoBuyEnabled', s.autoBuyEnabled);
  setFormValue('autoMode', s.autoMode);
  setFormValue('autoIntervalMs', s.autoIntervalMs);
  setFormValue('autoScanLimit', s.autoScanLimit);
  setFormValue('autoRoiThresholdPct', s.autoRoiThresholdPct);
  setFormValue('autoBuyRoiThresholdPct', s.autoBuyRoiThresholdPct);
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
    autoBuyEnabled: !!$('autoBuyEnabled')?.checked,
    autoMode: $('autoMode')?.value || DEF.autoMode,
    autoIntervalMs: Math.max(250, getNumberInput('autoIntervalMs', DEF.autoIntervalMs)),
    autoScanLimit: Math.max(1, Math.trunc(getNumberInput('autoScanLimit', DEF.autoScanLimit))),
    autoRoiThresholdPct: clampRoiThreshold(getNumberInput('autoRoiThresholdPct', DEF.autoRoiThresholdPct)),
    autoBuyRoiThresholdPct: clampRoiThreshold(getNumberInput('autoBuyRoiThresholdPct', DEF.autoBuyRoiThresholdPct)),
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
    chrome.storage.local.set({ autoStatus: 'disabled', autoHaltReason: 'manual' });
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

function formatDistance(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}м ${sec}с`;
  return `${sec}с`;
}

function formatTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  return new Date(ts).toLocaleTimeString();
}

function formatDateTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  return new Date(ts).toLocaleString();
}

function updateAutoStatusUI(autoStatus, autoHaltReason) {
  const badge = $('autoStatusBadge');
  const reason = $('autoStatusReason');
  if (!badge || !reason) return;
  const status = (autoStatus || '').toLowerCase();
  const reasonKey = (autoHaltReason || '').toLowerCase();
  let label = '—';
  let cls = 'badge--off';
  if (status === 'running') {
    label = 'Активен';
    cls = 'badge--ok';
  } else if (status === 'halted') {
    label = 'Остановлен';
    cls = 'badge--warn';
  } else if (status === 'disabled') {
    label = 'Выключен';
    cls = 'badge--off';
  }
  badge.textContent = label;
  badge.className = `badge ${cls}`;
  const reasonMap = {
    'roi-threshold': 'достигнут порог ROI',
    manual: 'остановлен вручную',
    hotkey: 'остановлен хоткеем'
  };
  reason.textContent = reasonMap[reasonKey] || '';
}

function updatePriceMetaUI(meta, ttlMin) {
  const ageEl = $('priceCacheAge');
  const updatedEl = $('priceLastUpdated');
  const countEl = $('priceItemCount');
  const nextEl = $('priceNextRefresh');
  if (!ageEl || !updatedEl || !countEl || !nextEl) return;
  const now = Date.now();
  const lastTs = Number(meta.lastPriceFetchTs) || 0;
  ageEl.textContent = lastTs ? formatDistance(now - lastTs) : '—';
  updatedEl.textContent = formatTime(lastTs);
  countEl.textContent = meta.lastPriceItemCount ? String(meta.lastPriceItemCount) : '—';
  const ttlMs = Number(ttlMin) > 0 ? Number(ttlMin) * 60 * 1000 : 0;
  const nextTs = lastTs && ttlMs ? lastTs + ttlMs : 0;
  nextEl.textContent = nextTs ? formatDistance(nextTs - now) : '—';
}

function updateFetchErrorUI(lastFetchError) {
  const errorEl = $('lastFetchError');
  if (!errorEl) return;
  if (!lastFetchError || !lastFetchError.message) {
    errorEl.textContent = '';
    return;
  }
  const when = lastFetchError.ts ? formatDateTime(lastFetchError.ts) : '';
  const suffix = when ? ` (${when})` : '';
  errorEl.textContent = `Ошибка сети: ${lastFetchError.message}${suffix}`;
}

function refreshRuntimeInfo() {
  chrome.storage.local.get(RUNTIME_DEFAULTS, (runtime) => {
    const err = chrome.runtime.lastError;
    if (err) {
      setStatus(`Ошибка чтения состояния: ${err.message}`, false);
      return;
    }
    chrome.storage.sync.get(META_DEFAULTS, (meta) => {
      updateAutoStatusUI(runtime.autoStatus, runtime.autoHaltReason);
      updatePriceMetaUI(runtime, meta.priceTtlMin);
      updateFetchErrorUI(runtime.lastFetchError);
    });
  });
}

function initLiveSync() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (Object.keys(changes).some((key) => CONTROL_IDS.includes(key))) {
        chrome.storage.sync.get(DEF, (settings) => {
          const err = chrome.runtime.lastError;
          if (err) {
            setStatus(`Ошибка обновления: ${err.message}`, false);
            return;
          }
          fillForm(settings);
          setStatus('Настройки обновлены');
        });
      }
      if ('priceTtlMin' in changes) {
        refreshRuntimeInfo();
      }
    }
    if (area === 'local') {
      const runtimeKeys = ['autoStatus', 'autoHaltReason', 'lastFetchError', 'lastPriceFetchTs', 'lastPriceItemCount'];
      if (runtimeKeys.some((key) => key in changes)) {
        refreshRuntimeInfo();
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initLiveSync();
  loadSettings();
  refreshRuntimeInfo();
});
