// === options.js ===

// Хелперы
const $ = (id) => document.getElementById(id);
const exists = (id) => !!$(id);
const setIf = (id, v) => { if (exists(id)) { const n = $(id); if (n.type === 'checkbox') n.checked = !!v; else n.value = v; } };
const num = (id, fallback) => {
  if (!exists(id)) return fallback;
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : fallback;
};

// Дефолты — синхронизированы с контент-скриптом
const DEFAULTS = {
  // Блок сравнения цен
  buyFeeCsm: 0.05,
  sellFeeMarket: 0.05,
  withdrawFeeMarket: 0.05,
  roiMin: 0.00,
  priceTtlMin: 5,
  priceMode: 'best_offer',     // best_offer | buy_order | smart
  undercutPct: 0.005,
  bidMarkupPct: 0.03,
  tightSpreadPct: 0.04,
  roiYellowFromPct: -10,
  roiYellowToPct: 0,
  roiGreenMinPct: 0,
  roiPurpleMinPct: 7,
  roiBlueMinPct: 12,
  apiKey: "",

  // Авторежим
  autoEnabled: false,
  autoMode: 'active',           // active | passive
  autoIntervalMs: 1000,
  autoScanLimit: 20,
  autoRoiThresholdPct: 20,      // триггер ROI (остановка цикла/действие)
  autoBuyEnabled: true,         // НОВОЕ: отдельно включать/выключать автопокупку
  autoBuyRoiThresholdPct: 500,  // НОВОЕ: порог автопокупки
  autoRandomMinMs: 120,
  autoRandomMaxMs: 420
};

// Отрисовка «умной» секции
function updateSmartBoxVisibility() {
  if (!exists('smartBox') || !exists('priceMode')) return;
  const show = $('priceMode').value === 'smart';
  $('smartBox').style.display = show ? '' : 'none';
}

// Подготовить объект к сохранению — только поля, реально присутствующие в HTML
function collectPayload() {
  const p = {};

  // ——— БЛОК ЦЕН ———
  if (exists('buyFeeCsm'))              p.buyFeeCsm = Math.max(0, num('buyFeeCsm', DEFAULTS.buyFeeCsm));
  if (exists('sellFeeMarket'))          p.sellFeeMarket = Math.max(0, num('sellFeeMarket', DEFAULTS.sellFeeMarket));
  if (exists('withdrawFeeMarket'))      p.withdrawFeeMarket = Math.max(0, num('withdrawFeeMarket', DEFAULTS.withdrawFeeMarket));
  if (exists('roiMin'))                 p.roiMin = num('roiMin', DEFAULTS.roiMin);
  if (exists('priceTtlMin'))            p.priceTtlMin = Math.max(1, Math.trunc(num('priceTtlMin', DEFAULTS.priceTtlMin)));
  if (exists('priceMode'))              p.priceMode = $('priceMode').value || DEFAULTS.priceMode;
  if (exists('undercutPct'))            p.undercutPct = Math.max(0, num('undercutPct', DEFAULTS.undercutPct));
  if (exists('bidMarkupPct'))           p.bidMarkupPct = Math.max(0, num('bidMarkupPct', DEFAULTS.bidMarkupPct));
  if (exists('tightSpreadPct'))         p.tightSpreadPct = Math.max(0, num('tightSpreadPct', DEFAULTS.tightSpreadPct));
  if (exists('roiYellowFromPct'))       p.roiYellowFromPct = num('roiYellowFromPct', DEFAULTS.roiYellowFromPct);
  if (exists('roiYellowToPct'))         p.roiYellowToPct = num('roiYellowToPct', DEFAULTS.roiYellowToPct);
  if (exists('roiGreenMinPct'))         p.roiGreenMinPct = num('roiGreenMinPct', DEFAULTS.roiGreenMinPct);
  if (exists('roiPurpleMinPct'))        p.roiPurpleMinPct = num('roiPurpleMinPct', DEFAULTS.roiPurpleMinPct);
  if (exists('roiBlueMinPct'))          p.roiBlueMinPct = num('roiBlueMinPct', DEFAULTS.roiBlueMinPct);
  if (exists('apiKey'))                 p.apiKey = $('apiKey').value ?? DEFAULTS.apiKey;

  // ——— АВТОРЕЖИМ ———
  if (exists('autoEnabled'))            p.autoEnabled = !!$('autoEnabled').checked;
  if (exists('autoMode'))               p.autoMode = $('autoMode').value || DEFAULTS.autoMode;
  if (exists('autoIntervalMs'))         p.autoIntervalMs = Math.max(250, num('autoIntervalMs', DEFAULTS.autoIntervalMs));
  if (exists('autoScanLimit'))          p.autoScanLimit = Math.max(1, Math.trunc(num('autoScanLimit', DEFAULTS.autoScanLimit)));
  if (exists('autoRoiThresholdPct'))    p.autoRoiThresholdPct = Math.max(0, num('autoRoiThresholdPct', DEFAULTS.autoRoiThresholdPct));
  if (exists('autoBuyEnabled'))         p.autoBuyEnabled = !!$('autoBuyEnabled').checked;
  if (exists('autoBuyRoiThresholdPct')) p.autoBuyRoiThresholdPct = Math.max(0, num('autoBuyRoiThresholdPct', DEFAULTS.autoBuyRoiThresholdPct));
  if (exists('autoRandomMinMs'))        p.autoRandomMinMs = Math.max(0, num('autoRandomMinMs', DEFAULTS.autoRandomMinMs));
  if (exists('autoRandomMaxMs'))        p.autoRandomMaxMs = Math.max(0, num('autoRandomMaxMs', DEFAULTS.autoRandomMaxMs));

  // Коррекция min/max задержек
  if ('autoRandomMinMs' in p || 'autoRandomMaxMs' in p) {
    const min = ('autoRandomMinMs' in p) ? p.autoRandomMinMs : (exists('autoRandomMinMs') ? Number($('autoRandomMinMs').value) : DEFAULTS.autoRandomMinMs);
    const max = ('autoRandomMaxMs' in p) ? p.autoRandomMaxMs : (exists('autoRandomMaxMs') ? Number($('autoRandomMaxMs').value) : DEFAULTS.autoRandomMaxMs);
    if (Number.isFinite(min) && Number.isFinite(max) && max < min) {
      p.autoRandomMinMs = max;
      p.autoRandomMaxMs = min;
      setIf('autoRandomMinMs', p.autoRandomMinMs);
      setIf('autoRandomMaxMs', p.autoRandomMaxMs);
    }
  }

  return p;
}

// Статус «сохранено/ошибка»
let statusTimer;
function status(msg, ok = true) {
  if (!exists('status')) return;
  const el = $('status');
  el.textContent = msg;
  el.style.color = ok ? '#10b981' : '#ef4444';
  el.style.opacity = '1';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

// Загрузка значений в форму
function load() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    // Блок цен
    setIf('buyFeeCsm', s.buyFeeCsm);
    setIf('sellFeeMarket', s.sellFeeMarket);
    setIf('withdrawFeeMarket', s.withdrawFeeMarket);
    setIf('roiMin', s.roiMin);
    setIf('priceTtlMin', s.priceTtlMin);
    setIf('priceMode', s.priceMode);
    setIf('undercutPct', s.undercutPct);
    setIf('bidMarkupPct', s.bidMarkupPct);
    setIf('tightSpreadPct', s.tightSpreadPct);
    setIf('roiYellowFromPct', s.roiYellowFromPct);
    setIf('roiYellowToPct', s.roiYellowToPct);
    setIf('roiGreenMinPct', s.roiGreenMinPct);
    setIf('roiPurpleMinPct', s.roiPurpleMinPct);
    setIf('roiBlueMinPct', s.roiBlueMinPct);
    setIf('apiKey', s.apiKey);

    // Авторежим
    setIf('autoEnabled', s.autoEnabled);
    setIf('autoMode', s.autoMode);
    setIf('autoIntervalMs', s.autoIntervalMs);
    setIf('autoScanLimit', s.autoScanLimit);
    setIf('autoRoiThresholdPct', s.autoRoiThresholdPct);
    setIf('autoBuyEnabled', s.autoBuyEnabled);
    setIf('autoBuyRoiThresholdPct', s.autoBuyRoiThresholdPct);
    setIf('autoRandomMinMs', s.autoRandomMinMs);
    setIf('autoRandomMaxMs', s.autoRandomMaxMs);

    updateSmartBoxVisibility();
  });
}

// Сохранение
function save() {
  const payload = collectPayload();
  if (!Object.keys(payload).length) {
    status('Нет полей для сохранения', false);
    return;
  }
  chrome.storage.sync.set(payload, () => {
    if (chrome.runtime.lastError) {
      status('Ошибка сохранения', false);
      return;
    }
    status('Сохранено');
  });
}

// Debounce для «живых» инпутов
let saveDebTimer;
function debouncedSave() {
  clearTimeout(saveDebTimer);
  saveDebTimer = setTimeout(save, 350);
}

// Навесить события
function bind() {
  // instant save
  ['autoEnabled','autoMode','priceMode','autoBuyEnabled'].forEach(id => {
    if (!exists(id)) return;
    const n = $(id);
    const evt = (n.type === 'checkbox') ? 'change' : 'input';
    n.addEventListener(evt, () => {
      if (id === 'priceMode') updateSmartBoxVisibility();
      save();
    });
  });

  // debounced save
  [
    'buyFeeCsm','sellFeeMarket','withdrawFeeMarket','roiMin','priceTtlMin',
    'undercutPct','bidMarkupPct','tightSpreadPct','roiYellowFromPct','roiYellowToPct','roiGreenMinPct','roiPurpleMinPct','roiBlueMinPct','apiKey',
    'autoIntervalMs','autoScanLimit','autoRoiThresholdPct','autoBuyRoiThresholdPct','autoRandomMinMs','autoRandomMaxMs'
  ].forEach(id => {
    if (!exists(id)) return;
    $(id).addEventListener('input', debouncedSave);
    $(id).addEventListener('change', save);
  });

  // Кнопка «Сохранить» (если есть)
  if (exists('save')) $('save').addEventListener('click', save);
}

// Подхват внешних изменений (например, из popup)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  load();
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  load();
  bind();
});
