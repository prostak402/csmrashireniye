// === background.js ===
const DEFAULTS = {
  buyFeeCsm: 0.05,
  sellFeeMarket: 0.05,
  withdrawFeeMarket: 0.05,
  roiMin: 0.00,
  priceTtlMin: 5,
  priceMode: 'best_offer',
  undercutPct: 0.005,
  bidMarkupPct: 0.03,
  tightSpreadPct: 0.04,
  roiYellowFromPct: -10,
  roiYellowToPct: 0,
  roiGreenMinPct: 0,
  roiPurpleMinPct: 7,
  roiBlueMinPct: 12,
  apiKey: "",
  autoEnabled: false,
  autoActionsEnabled: true,
  autoMode: 'active',
  autoIntervalMs: 1000,
  autoScanLimit: 20,
  autoRoiThresholdPct: 20,
  autoRandomMinMs: 120,
  autoRandomMaxMs: 420
};

function asNum(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }
function asStr(v){ return (v == null) ? '' : String(v); }

async function getSettings() {
  return new Promise(res => chrome.storage.sync.get(DEFAULTS, raw => {
    const s = { ...DEFAULTS, ...raw };
    s.priceTtlMin = Math.max(1, asNum(s.priceTtlMin));
    s.undercutPct = Math.max(0, asNum(s.undercutPct));
    s.bidMarkupPct = Math.max(0, asNum(s.bidMarkupPct));
    s.tightSpreadPct = Math.max(0, asNum(s.tightSpreadPct));

    s._yellowFrom = asNum(s.roiYellowFromPct)/100;
    s._yellowTo   = asNum(s.roiYellowToPct)/100;
    if (s._yellowFrom > s._yellowTo){ const t=s._yellowFrom; s._yellowFrom=s._yellowTo; s._yellowTo=t; }

    const g = asNum(s.roiGreenMinPct)/100;
    let p = asNum(s.roiPurpleMinPct)/100;
    let b = asNum(s.roiBlueMinPct)/100;
    if (p < g) p = g; if (b < p) b = p;
    s._greenMin=g; s._purpleMin=p; s._blueMin=b;

    res(s);
  }));
}

function normName(s){
  if (!s) return "";
  let r = s.replace(/\u2122/g, '™').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  r = r.replace(/^StatTrak™\s+/, 'StatTrak™ ').replace(/^Souvenir\s+/, 'Souvenir ');
  return r;
}

let priceCache = { time: 0, currency: "RUB", mapByName: {} };
let historyIndexCache = { time: 0, mapByName: {} };
const historyCache = new Map();
const HISTORY_INDEX_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_ITEM_TTL_MS = 30 * 60 * 1000;
const HISTORY_WINDOW_SEC = 7 * 24 * 60 * 60;
const HISTORY_SAMPLE_LIMIT = 10;
const notificationActions = new Map();

chrome.notifications?.onClicked?.addListener?.(notifId => {
  const action = notificationActions.get(notifId);
  if (typeof action === 'function') {
    try {
      action();
    } catch (_) {
      // ignore action errors
    }
  }
  notificationActions.delete(notifId);
});

function buildBestOffers(items){
  const out = {};
  const push = (name, price) => {
    name = normName(name);
    const p = Number(price||0);
    if (!name || !(p>0)) return;
    if (!out[name]) out[name] = { best_offer: p, buy_order: 0 };
    else out[name].best_offer = Math.min(out[name].best_offer || Infinity, p);
  };
  if (Array.isArray(items)){
    for (const v of items){
      const name = v?.market_hash_name || v?.name || v?.hash_name;
      push(name, v?.price);
    }
  } else if (typeof items === 'object'){
    for (const [k, vRaw] of Object.entries(items)){
      const v = vRaw || {};
      const name = v.market_hash_name || k;
      push(name, v.price);
    }
  }
  return out;
}
function coerceNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const x = Number(v.replace(/\s+/g,'').replace(',', '.'));
    return Number.isFinite(x) ? x : 0;
  }
  return 0;
}
function buildBuyOrders(payload){
  const out = {};
  const items = (payload && (payload.items ?? payload)) || null;
  if (!items) return out;
  const push = (name, rawVal) => {
    const nm = normName(name);
    const val = coerceNum(rawVal);
    if (!nm || !(val>0)) return;
    if (!out[nm]) out[nm] = { best_offer: 0, buy_order: val };
    else out[nm].buy_order = Math.max(out[nm].buy_order || 0, val);
  };
  if (Array.isArray(items)){
    for (const v of items){
      const name = v?.market_hash_name || v?.name || v?.hash_name || v?.data?.market_hash_name;
      const val  = ('buy_order' in (v||{})) ? v.buy_order : (v?.value ?? v?.price ?? v?.order ?? v?.o);
      push(name, val);
    }
  } else if (typeof items === 'object'){
    for (const [k,v] of Object.entries(items)){
      if (typeof v === 'number' || typeof v === 'string') push(k, v);
      else push(v?.market_hash_name || k, ('buy_order' in (v||{})) ? v.buy_order : (v?.value ?? v?.price ?? v?.order ?? v?.o));
    }
  }
  return out;
}

async function loadMarketPrices(force=false){
  const s = await getSettings();
  const fresh = (Date.now() - priceCache.time) < s.priceTtlMin*60*1000;
  if (fresh && !force && Object.keys(priceCache.mapByName).length) return priceCache;

  let mapBest = {}, mapOrders = {};
  try {
    const r = await fetch('https://market.csgo.com/api/v2/prices/RUB.json');
    if (r.ok) mapBest = buildBestOffers((await r.json())?.items ?? {});
  } catch(_){}
  try {
    const r2 = await fetch('https://market.csgo.com/api/v2/prices/orders/RUB.json');
    if (r2.ok) mapOrders = buildBuyOrders((await r2.json())?.items ?? {});
  } catch(_){}

  const result = {};
  const names = new Set([...Object.keys(mapBest), ...Object.keys(mapOrders)]);
  for (const name of names){
    const a = mapBest[name] || {}, b = mapOrders[name] || {};
    const best = Number(a.best_offer||0), bid = Number(b.buy_order||0);
    result[name] = { best_offer: best>0?best:0, buy_order: bid>0?bid:0 };
  }
  priceCache = { time: Date.now(), currency:'RUB', mapByName: result };
  return priceCache;
}

function calcMedian(arr){
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length/2);
  if (sorted.length % 2 === 0) return (sorted[mid-1] + sorted[mid]) / 2;
  return sorted[mid];
}

async function loadHistoryIndex(force=false){
  const fresh = (Date.now() - historyIndexCache.time) < HISTORY_INDEX_TTL_MS;
  if (!force && fresh && Object.keys(historyIndexCache.mapByName).length) return historyIndexCache.mapByName;
  try {
    const r = await fetch('https://market.csgo.com/api/v2/full-history/all.json');
    if (!r.ok) return historyIndexCache.mapByName;
    const data = await r.json();
    const map = {};
    for (const [name, id] of Object.entries(data?.history || {})){
      const nm = normName(name);
      if (!nm || !Number.isFinite(Number(id))) continue;
      map[nm] = Number(id);
    }
    historyIndexCache = { time: Date.now(), mapByName: map };
  } catch (_){}
  return historyIndexCache.mapByName;
}

async function loadItemHistory(id){
  const cached = historyCache.get(id);
  if (cached && (Date.now() - cached.time) < HISTORY_ITEM_TTL_MS) return cached.data;
  try {
    const r = await fetch(`https://market.csgo.com/api/v2/full-history/${id}.json`);
    if (!r.ok) return null;
    const json = await r.json();
    const hist = json?.data?.history;
    if (Array.isArray(hist)){
      historyCache.set(id, { time: Date.now(), data: hist });
      return hist;
    }
  } catch(_){}
  return null;
}

function pickRecentSales(history){
  if (!Array.isArray(history)) return [];
  const cutoff = Math.floor(Date.now()/1000) - HISTORY_WINDOW_SEC;
  const out = [];
  for (const entry of history){
    const ts = Number(entry?.[0] || 0);
    const priceRub = Number(entry?.[1] || 0);
    if (!(priceRub > 0) || !(ts > 0)) continue;
    if (ts < cutoff) break;
    out.push(priceRub);
    if (out.length >= HISTORY_SAMPLE_LIMIT) break;
  }
  return out;
}

function buildSmartPriceFromHistory(prices, s){
  if (!prices.length) return null;
  const median = calcMedian(prices);
  const avg = prices.reduce((a,b)=>a+b,0) / prices.length;
  const blended = (median*0.6 + avg*0.4);
  const sale = blended * (1 - s.undercutPct);
  return sale > 0 ? sale : null;
}

async function estimateSmartPrice(itemName, entry, s){
  const index = await loadHistoryIndex();
  const id = index[normName(itemName)] ?? null;
  if (id){
    const hist = await loadItemHistory(id);
    const prices = pickRecentSales(hist);
    const estimated = buildSmartPriceFromHistory(prices, s);
    if (estimated) return { value: estimated, source: 'smart_history' };
  }
  return estimateSalePrice(entry, { ...s, priceMode: 'best_offer' });
}

function colorByRoi(roi, mode, s){
  const RED='#ef4444', YELLOW='#f59e0b', GREEN='#22c55e', PURPLE='#a855f7', BLUE='#3b82f6';
  mode = (mode||'').toLowerCase();
  if (mode === 'buy_order'){
    if (roi >= s._yellowFrom && roi <= s._yellowTo) return YELLOW;
    return roi >= s.roiMin ? GREEN : RED;
  }
  if (roi < 0) return RED;
  if (roi >= s._blueMin) return BLUE;
  if (roi >= s._purpleMin) return PURPLE;
  if (roi >= s._greenMin) return GREEN;
  return GREEN;
}
function estimateSalePrice(entry, s, overrideMode){
  const best = Number(entry?.best_offer||0);
  const bid  = Number(entry?.buy_order||0);
  const mode = (overrideMode || s.priceMode || 'best_offer').toLowerCase();
  if (mode === 'best_offer') return { value: best, source: 'best_offer' };
  if (mode === 'buy_order')  return { value: bid,  source: 'buy_order'  };
  const under = 1 - s.undercutPct;
  const up = 1 + s.bidMarkupPct;
  const tight = s.tightSpreadPct;
  let est = 0;
  if (best>0 && bid>0){
    const spread = (best - bid)/best;
    est = (spread <= tight) ? best*under : Math.min(best*under, Math.max(bid*up, bid));
  } else if (best>0) est = best*under;
  else if (bid>0) est = bid*up;
  return { value: est, source: 'smart_fallback' };
}
function calcWithBase(csmPriceRub, marketBase, s){
  if (!(marketBase>0)) return null;
  const Cin  = csmPriceRub * (1 + s.buyFeeCsm);
  const Pout = marketBase   * (1 - s.sellFeeMarket) * (1 - s.withdrawFeeMarket);
  const delta = Pout - Cin;
  const roi = delta / Cin;
  return { marketBase, Cin, Pout, delta, roi };
}

async function handleBatchCompare(items){
  const s = await getSettings();
  const cache = await loadMarketPrices(false);
  const out = {};
  const mode = (s.priceMode||'best_offer').toLowerCase();
  for (const item of items){
    const name = normName(item.hashName);
    const entry = cache.mapByName[name];
    const est = (mode === 'smart')
      ? await estimateSmartPrice(name, entry, s)
      : estimateSalePrice(entry, s, mode);
    const res = calcWithBase(item.csmPriceRub, Number(est.value), s);
    out[item.cardId] = res ? {
      ok: res.roi >= s.roiMin,
      roi: res.roi,
      delta: res.delta,
      marketBase: res.marketBase,
      cin: res.Cin,
      pout: res.Pout,
      priceSource: est.source,
      color: colorByRoi(res.roi, est.source, s)
    } : null;
  }
  return { ok:true, result: out, ts: cache.time, count: Object.keys(cache.mapByName||{}).length };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "BATCH_COMPARE") {
    handleBatchCompare(msg.payload).then(sendResponse).catch(e => sendResponse({ ok:false, error:String(e) }));
    return true;
  }
  if (msg?.type === 'REFRESH_PRICES') {
    (async () => {
      try {
        const cache = await loadMarketPrices(true);
        chrome.tabs.query({ url: '*://*.cs.money/*' }, tabs => {
          for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'RECOMPARE_ALL', ts: cache.time });
        });
        sendResponse({ ok:true, ts: cache.time, count: Object.keys(cache.mapByName||{}).length });
      } catch (e) {
        sendResponse({ ok:false, error:String(e) });
      }
    })();
    return true;
  }
  if (msg?.type === 'FOCUS_ME') {
    try {
      const tabId = sender?.tab?.id;
      const winId = sender?.tab?.windowId;
      if (tabId) chrome.tabs.update(tabId, { active:true });
      if (winId) chrome.windows.update(winId, { focused:true });
      sendResponse({ ok:true });
    } catch(e){
      sendResponse({ ok:false, error:String(e) });
    }
    return true;
  }
  if (msg?.type === 'AUTO_NOTIFY') {
    const { title, message } = msg.payload || {};
    const notifId = `csm-auto-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    notificationActions.set(notifId, () => {
      chrome.tabs.query({ url: '*://*.cs.money/*' }, tabs => {
        if (tabs && tabs.length) {
          chrome.tabs.update(tabs[0].id, { active:true });
          chrome.windows.update(tabs[0].windowId, { focused:true });
        }
      });
    });
    chrome.notifications.create(notifId, {
      type:'basic', iconUrl:'icon48.png',
      title: title || 'Найдена выгодная карточка',
      message: message || 'ROI превысил порог', priority:2
    }, () => {});
    sendResponse?.({ ok:true });
  }
});

chrome.alarms?.create?.("refreshPrices", { periodInMinutes: 10 });
chrome.alarms?.onAlarm?.addListener?.(a => { if (a.name === "refreshPrices") loadMarketPrices(true).catch(()=>{}); });
