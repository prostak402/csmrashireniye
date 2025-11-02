// === content.js — CS.MONEY helper (автообновление, ROI, автопокупка с открытием корзины) ===
(() => {
  if (window.__CSM_EXT_INJECTED__) return;
  window.__CSM_EXT_INJECTED__ = true;

  // ---------------- Константы / утилиты ----------------
  const WEAR_MAP = { "FN":"Factory New","MW":"Minimal Wear","FT":"Field-Tested","WW":"Well-Worn","BS":"Battle-Scarred" };
  const NON_SKIN_PREFIXES = ["Sticker","Patch","Keychain","Case","Graffiti","Key","Music Kit","Name Tag"];
  const NON_WEAR_PREFIXES = [...NON_SKIN_PREFIXES];
  const STAR_ITEM_REGEX = /\b(Knife|Bayonet|Karambit|Butterfly|Daggers|Falchion|Huntsman|Bowie|Ursus|Navaja|Stiletto|Talon|Skeleton|Classic|Survival|Nomad|Flip|Gut|Gloves)\b/i;

  const ROI_THRESHOLD_MIN = -1000;
  const ROI_THRESHOLD_MAX = 1000;

  const AUTO_DEFAULTS = {
    autoEnabled: false,
    autoActionsEnabled: true,
    autoMode: 'active',
    autoIntervalMs: 1000,
    autoScanLimit: 20,
    autoRoiThresholdPct: 20,

    autoBuyEnabled: true,
    autoBuyRoiThresholdPct: 500,

    autoRandomMinMs: 120,
    autoRandomMaxMs: 420
  };

  let auto = { ...AUTO_DEFAULTS };
  let autoHalted = false;
  let autoBuyInProgress = false;
  let lastKnownAutoEnabled = auto.autoEnabled;

  const AUTO = {
    started: false,
    intervalId: null,
    timeouts: new Set(),
    start(){
      this.stop();
      if (!auto.autoEnabled || autoHalted) return;
      this.started = true;
      this.scheduleCycle(0);
      this.intervalId = setInterval(() => {
        if (autoHalted || !auto.autoEnabled) return;
        this.scheduleCycle(randDelay());
      }, auto.autoIntervalMs);
    },
    stop(){
      if (this.intervalId){ clearInterval(this.intervalId); this.intervalId = null; }
      for (const id of Array.from(this.timeouts)) clearTimeout(id);
      this.timeouts.clear();
      this.started = false;
    },
    scheduleCycle(delayMs){
      const id = setTimeout(() => { this.timeouts.delete(id); safeRefreshAndRescan(); }, Math.max(0, delayMs||0));
      this.timeouts.add(id);
    },
    timeout(fn, ms){
      const id = setTimeout(() => { this.timeouts.delete(id); fn(); }, Math.max(0, ms||0));
      this.timeouts.add(id); return id;
    }
  };

  function clampRoiThreshold(value, fallback){
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(ROI_THRESHOLD_MAX, Math.max(ROI_THRESHOLD_MIN, n));
  }

  function randBetween(min, max){
    const a = Math.max(0, Number(min)||0);
    const b = Math.max(a, Number(max)||a);
    return Math.floor(a + Math.random()*(b - a));
  }
  function randDelay(){ return randBetween(auto.autoRandomMinMs, auto.autoRandomMaxMs); }

  function toast(msg){
    try {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483647;background:#111827;color:#fff;padding:8px 10px;border-radius:10px;font:600 13px/1.3 system-ui,Segoe UI;box-shadow:0 6px 18px rgba(0,0,0,.35)';
      document.body.appendChild(t);
      setTimeout(()=>t.remove(), 1700);
    } catch(_){}
  }

  function stripDopplerVariant(name){
    return name
      .replace(/(\|\s*)Gamma\s+Doppler\s+(?:Phase\s*[1-4]|P\s*[1-4]|I{1,3}|IV|Sapphire|Ruby|Black\s+Pearl|Emerald)\b/gi,'$1Gamma Doppler')
      .replace(/(\|\s*)Doppler\s+(?:Phase\s*[1-4]|P\s*[1-4]|I{1,3}|IV|Sapphire|Ruby|Black\s+Pearl|Emerald)\b/gi,'$1Doppler')
      .replace(/\s{2,}/g,' ')
      .trim();
  }
  function stripStickerKeychainTails(name){
    return name
      .replace(/\s*\+\s*\d*\s*x\s*Sticker.*$/i,'')
      .replace(/\s*\+\s*Sticker.*$/i,'')
      .replace(/\s*\(\s*(with|w\/)\s*stickers?.*?\)\s*$/i,'')
      .replace(/\s*\(\s*(with|w\/)\s*keychains?.*?\)\s*$/i,'')
      .replace(/\s*\(\s*Keychain[^)]*\)\s*$/i,'')
      .replace(/\s*\[\s*Stickers?.*?\]\s*$/i,'')
      .replace(/\s{2,}/g,' ')
      .trim();
  }
  function parseRub(text){
    if (!text) return null;
    const c = text.replace(/\s/g,'').replace('₽','').replace(',', '.');
    const m=c.match(/[\d.]+/);
    return m?Number(m[0]):null;
  }
  function fmt(n){ return n.toLocaleString('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}); }
  function srcLabel(src){
    switch((src||'').toLowerCase()){
      case 'best_offer': return 'Лучшая цена';
      case 'buy_order':  return 'Max buy order';
      case 'smart':      return 'Смарт-оценка';
      default:           return 'Market';
    }
  }
  function textHas(el, re){
    const t = (el?.textContent || '').replace(/\s+/g,' ').trim();
    return re.test(t);
  }

  function getCardById(cardId){
    return document.querySelector(`[data-card-item-id="${cardId}"]`) 
        || document.querySelector(`[data-card-id="${cardId}"]`)
        || null;
  }
  function robustClick(el){
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch(_){}
    const opts = { bubbles:true, cancelable:true, composed:true, view:window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(_){}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(_){}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(_){}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(_){}
    try { el.dispatchEvent(new MouseEvent('click', opts)); } catch(_){ el.click?.(); }
  }

  // ---------------- Настройки ----------------
  function loadAutoSettings(cb){
    const prevEnabled = lastKnownAutoEnabled;
    chrome.storage.sync.get(AUTO_DEFAULTS, s => {
      auto = { ...AUTO_DEFAULTS, ...s };
      auto.autoActionsEnabled  = !!auto.autoActionsEnabled;
      auto.autoIntervalMs      = Math.max(250, Number(auto.autoIntervalMs)||1000);
      auto.autoScanLimit       = Math.max(1, Math.trunc(Number(auto.autoScanLimit)||20));
      auto.autoRoiThresholdPct = clampRoiThreshold(auto.autoRoiThresholdPct, AUTO_DEFAULTS.autoRoiThresholdPct);
      auto.autoBuyRoiThresholdPct = clampRoiThreshold(auto.autoBuyRoiThresholdPct, AUTO_DEFAULTS.autoBuyRoiThresholdPct);
      auto.autoRandomMinMs     = Math.max(0, Number(auto.autoRandomMinMs)||120);
      auto.autoRandomMaxMs     = Math.max(0, Number(auto.autoRandomMaxMs)||420);
      if (auto.autoRandomMaxMs < auto.autoRandomMinMs){
        const t = auto.autoRandomMinMs; auto.autoRandomMinMs = auto.autoRandomMaxMs; auto.autoRandomMaxMs = t;
      }
      lastKnownAutoEnabled = !!auto.autoEnabled;
      cb && cb(prevEnabled, lastKnownAutoEnabled);
    });
  }
  function ensureAutoRunning({ immediateScan = false } = {}){
    autoHalted = false;
    AUTO.start();
    if (immediateScan) scanAndCompare(true);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const watched = [
      'autoEnabled','autoActionsEnabled','autoMode','autoIntervalMs','autoScanLimit',
      'autoRoiThresholdPct','autoBuyEnabled','autoBuyRoiThresholdPct',
      'autoRandomMinMs','autoRandomMaxMs'
    ];
    if (watched.some(k => k in changes)){
      loadAutoSettings((prevEnabled, nextEnabled) => {
        if (nextEnabled && !prevEnabled) {
          ensureAutoRunning({ immediateScan: true });
        } else if (nextEnabled && !autoHalted) {
          AUTO.start();
        } else {
          if (!nextEnabled) autoHalted = false;
          AUTO.stop();
        }
      });
    }
  });

  // ---------------- Управление остановкой ----------------
  function haltAutoAndFocus(){
    if (autoHalted) return;
    autoHalted = true;
    AUTO.stop();
    toast('Автообновление остановлено');
    try { chrome.runtime.sendMessage({ type:'FOCUS_ME' }, ()=>{}); } catch(_){}
  }

  // ---------------- «Обновить результаты» ----------------
  function findRefreshButton(){
    const candidates = [
      'div[aria-label="Refresh results"][role="button"]',
      'button[aria-label="Refresh results"]',
      'div.csm_2ab80ca3[role="button"]',
      'div[role="button"][tabindex="0"][aria-label="Refresh results"]'
    ];
    for (const sel of candidates){
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const anyButtons = document.querySelectorAll('div[role="button"], button');
    for (const b of anyButtons){
      if (b.getAttribute('aria-label')?.toLowerCase().includes('refresh')) return b;
    }
    return null;
  }
  function clickRefreshButton(){
    if (autoHalted) return;
    const btn = findRefreshButton();
    if (btn) robustClick(btn);
  }

  let refreshCycleInProgress = false;
  let refreshCycleQueued = false;
  function safeRefreshAndRescan(){
    if (autoHalted) return;
    if (refreshCycleInProgress){
      refreshCycleQueued = true;
      return;
    }
    refreshCycleInProgress = true;
    const finishCycle = () => {
      refreshCycleInProgress = false;
      const shouldRepeat = refreshCycleQueued && !autoHalted;
      refreshCycleQueued = false;
      if (shouldRepeat) safeRefreshAndRescan();
    };
    scanAndCompare(true, {
      onDone(){
        if (autoHalted){
          finishCycle();
          return;
        }
        AUTO.timeout(() => {
          if (autoHalted){
            finishCycle();
            return;
          }
          clickRefreshButton();
          AUTO.timeout(() => {
            if (!autoHalted) scanAndCompare(true);
            finishCycle();
          }, 120 + randDelay());
        }, 60 + randDelay());
      }
    });
  }

  // ---------------- Парсинг карточек ----------------
  function buildHashName(card){
    const img = card.querySelector('.csm_22b8286f img[alt]') || card.querySelector('img[alt]');
    let baseName = img?.getAttribute('alt')?.trim();
    if (!baseName) return null;
    baseName = stripStickerKeychainTails(baseName);

    const isNonWear = NON_WEAR_PREFIXES.some(p => baseName.startsWith(p));
    const badge = card.querySelector('.csm_c5a774b6, .csm_592712e5, .csm_f9fa1fda');
    let wearAbbr = null, isStatTrak = false;
    if (badge){
      const t = badge.textContent.replace(/\s+/g,' ').trim();
      if (/(^|[^\w])ST([^\w]|$)/.test(t)) isStatTrak = true;
      const m = t.match(/\b(FN|MW|FT|WW|BS)\b/); if (m) wearAbbr = m[1];
    }
    if (!isNonWear && wearAbbr){
      const wearFull = WEAR_MAP[wearAbbr] || wearAbbr;
      if (!/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/.test(baseName)){
        baseName = `${baseName} (${wearFull})`;
      }
    }
    const alreadyHasStar = /^\u2605\s/.test(baseName);
    const looksLikeStar = STAR_ITEM_REGEX.test(baseName) || alreadyHasStar;
    const hasSt = /StatTrak™/.test(baseName);

    let name = baseName;
    if (looksLikeStar && !alreadyHasStar) name = `★ ${name}`;
    if (isStatTrak && !hasSt){
      if (/^\u2605\s/.test(name)){ name = name.replace(/^\u2605\s*/, ''); name = `★ StatTrak™ ${name}`; }
      else name = `StatTrak™ ${name}`;
    }
    return stripDopplerVariant(name);
  }
  function isNonSkin(name){ return NON_SKIN_PREFIXES.some(p => name.startsWith(p)); }

  function injectPill(card, info, opts={}){
    const pill = document.createElement('div');
    pill.className = 'csmoney-market-pill';
    let text, bg = '#6b7280';
    if (opts.error){ text = 'Market: ошибка'; bg = '#b45309'; }
    else if (!info){ text = 'Market: —'; }
    else {
      const roiPct = (info.roi*100).toFixed(1);
      const deltaStr = `${info.delta>=0?'+':''}${fmt(info.delta)}`;
      const src = srcLabel(info.priceSource);
      text = `${src}: ${fmt(info.marketBase)} · ROI ${roiPct}% · ${deltaStr}`;
      bg = info.color || (info.ok ? '#22c55e' : '#ef4444');
    }
    pill.textContent = text;
    pill.style.cssText = 'position:absolute;top:8px;right:8px;z-index:9;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:'+bg+';box-shadow:0 2px 6px rgba(0,0,0,.2)';
    card.style.position = 'relative';
    card.querySelector('.csmoney-market-pill')?.remove();
    card.appendChild(pill);
  }

  let seen = new WeakSet();
  function collectBatch(limit = Infinity){
    const batch = [];
    const cards = document.querySelectorAll('[data-card-item-id]');
    let i=0;
    for (const card of cards){
      if (i>=limit) break;
      if (!seen.has(card)){
        const priceEl = card.querySelector('.Price-module_price__FiOl9, [class*="Price-module_price"]');
        const priceRub = parseRub(priceEl?.textContent);
        if (!priceRub){ i++; continue; }
        const hashName = buildHashName(card);
        if (!hashName || isNonSkin(hashName)){ i++; continue; }
        seen.add(card);
        injectPill(card, null);
        batch.push({
          cardId: card.getAttribute('data-card-item-id') || (crypto?.randomUUID?.() || String(Math.random())),
          hashName,
          csmPriceRub: priceRub
        });
      }
      i++;
    }
    return batch;
  }

  function sendBatch(batch, opts={}){
    const { onDone } = opts;
    let done = false;
    const signalDone = (details={}) => {
      if (done) return;
      done = true;
      try { onDone?.(details); } catch(_){}
    };
    if (!batch.length){
      signalDone({ empty:true });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type:'BATCH_COMPARE', payload: batch }, (resp) => {
        const runtimeErr = chrome.runtime?.lastError;
        if (runtimeErr || !resp || !resp.ok || (resp.count !== undefined && Number(resp.count) === 0)){
          batch.forEach(it => {
            const card = getCardById(it.cardId);
            if (card) injectPill(card, null, { error:true });
          });
          signalDone({ error:true, resp: resp ?? null, runtimeError: runtimeErr ?? null });
          return;
        }
        const triggeredEntries = [];
        const autoBuyEntries = [];
        for (const item of batch){
          const info = resp.result[item.cardId] || null;
          const card = getCardById(item.cardId);
          if (card) injectPill(card, info);

          if (auto.autoEnabled && !autoHalted && info){
            const roiPct = (info.roi * 100);

            if (roiPct >= auto.autoRoiThresholdPct){
              const entry = { card, item, info, roiPct };
              triggeredEntries.push(entry);

              if (auto.autoActionsEnabled && auto.autoBuyEnabled && roiPct >= auto.autoBuyRoiThresholdPct){
                autoBuyEntries.push({ card, item, info, roiPct });
              }
            }
          }
        }

        if (triggeredEntries.length){
          if (auto.autoActionsEnabled){
            haltAutoAndFocus();

            if (auto.autoMode === 'active'){
              if (autoBuyEntries.length){
                scheduleAutoBuy(autoBuyEntries);
              }

              const autoBuyIds = new Set(autoBuyEntries.map(({ item }) => item.cardId));
              let delay = randDelay();
              for (const entry of triggeredEntries){
                if (autoBuyIds.has(entry.item.cardId)) continue;
                AUTO.timeout(() => tryAutoClickForCard(entry.card, entry.item, entry.info), delay);
                delay += 120 + randDelay();
              }
            } else {
              let delay = randDelay();
              for (const entry of triggeredEntries){
                AUTO.timeout(() => tryNotifyForCard(entry.item, entry.info), delay);
                delay += 120 + randDelay();
              }
            }
          } else {
            let delay = randDelay();
            for (const entry of triggeredEntries){
              AUTO.timeout(() => tryNotifyForCard(entry.item, entry.info), delay);
              delay += 120 + randDelay();
            }
          }
        }
        signalDone({
          resp,
          triggered: triggeredEntries.length,
          autoBuyTriggered: autoBuyEntries.length
        });
      });
    } catch(err){
      signalDone({ error:true, exception: err });
    }
  }

  function scanAndCompare(force=false, opts={}){
    if (force) seen = new WeakSet();
    const limit = auto.autoEnabled ? auto.autoScanLimit : Infinity;
    const b = collectBatch(limit);
    sendBatch(b, opts);
  }

  // ---------------- Кнопки: «в корзину», «корзина», «оформление», «Купить» ----------------

  function findAddToCartBtn(card){
    return (
      card.querySelector('[aria-label="Add item to cart"][role="button"]') ||
      card.querySelector('.csm_dc61987a [aria-label="Add item to cart"]') ||
      card.querySelector('button[aria-label="Add item to cart"]')
    );
  }

  // Кнопка открытия корзины (из твоего примера: .csm_eaf3a8c5 > button c "₽" и иконкой тележки)
  function findCartButton(){
    // приоритет — явный контейнер
    const byContainer = document.querySelector('.csm_eaf3a8c5 button');
    if (byContainer) return byContainer;

    // кнопка, содержащая цену «₽» внутри (виджет корзины)
    const withPrice = [...document.querySelectorAll('button, [role="button"]')]
      .find(b => b.querySelector('.Price-module_price__FiOl9'));
    if (withPrice) return withPrice;

    // по aria-label / тексту
    const byLabel = [...document.querySelectorAll('button, [role="button"]')]
      .find(b => /корзин|cart/i.test((b.getAttribute('aria-label')||'') + ' ' + (b.textContent||'')));
    if (byLabel) return byLabel;

    return null;
  }

  // Кнопка перехода к оформлению (если таковая отдельная)
  function findCheckoutButton(){
    return (
      document.querySelector('button[data-testid="cart-checkout-button"]') ||
      document.querySelector('.csm_eaf3a8c5 button.Button-module_primary__st6yY') ||
      document.querySelector('.csm_eaf3a8c5 button')
    );
  }

  function findBuyButtonOnce(){
    const direct = [...document.querySelectorAll('button, [role="button"]')]
      .find(b => textHas(b, /(^|\s)Купить(\s|$)/i));
    if (direct) return direct;

    const containers = [
      '.csm_eaf3a8c5',
      '.csm_a9e80a76',
      '.Button-module_root__8RX49',
      '.csm_4ca4f039', '.csm_dbb28ac4',
      '.Button-module_label__1PsXG',
      '.modal', '[class*="Dialog"]', '[class*="drawer"]', '[class*="Checkout"]'
    ];
    for (const c of containers){
      const root = document.querySelector(c);
      if (!root) continue;
      const btn = [...root.querySelectorAll('button, [role="button"]')]
        .find(b => textHas(b, /(^|\s)Купить(\s|$)/i));
      if (btn) return btn;
    }

    const any = [...document.querySelectorAll('button, [role="button"]')]
      .find(b => /₽/.test(b.textContent || '') && textHas(b, /Купить/i));
    if (any) return any;

    return null;
  }

  // Открыть корзину (при необходимости) и дождаться «Купить»
  function openCartAndWaitBuyButton({ attempts = 30, delay = 150 } = {}, onDone){
    let left = attempts;
    (function step(){
      const buy = findBuyButtonOnce();
      if (buy) return onDone(buy);

      const cartBtn = findCartButton();
      if (cartBtn) robustClick(cartBtn);

      left -= 1;
      if (left <= 0) return onDone(null);
      setTimeout(step, delay + randDelay());
    })();
  }

  // ---------------- Реакция на выгодную карточку ----------------
  function tryAutoClickForCard(card, item, info, opts = {}){
    if (!card) return;

    const addBtn = findAddToCartBtn(card);
    if (addBtn) robustClick(addBtn);

    if (opts.skipCheckout) return;

    AUTO.timeout(() => {
      const cartBtn = findCartButton();
      if (cartBtn) robustClick(cartBtn);
      AUTO.timeout(() => {
        const checkout = findCheckoutButton();
        if (checkout) robustClick(checkout);
      }, 150 + randDelay());
    }, 150 + randDelay());
  }

  function scheduleAutoBuy(entries){
    if (!entries.length) return;
    if (autoBuyInProgress) return;

    autoBuyInProgress = true;

    let delay = 0;
    const uniqueIds = new Set();
    for (const entry of entries){
      if (!entry?.item?.cardId || uniqueIds.has(entry.item.cardId)) continue;
      uniqueIds.add(entry.item.cardId);
      AUTO.timeout(() => {
        tryAutoClickForCard(entry.card, entry.item, entry.info, { skipCheckout: true });
      }, delay);
      delay += 120 + randDelay();
    }

    if (uniqueIds.size === 0){
      autoBuyInProgress = false;
      return;
    }

    AUTO.timeout(() => {
      openCartAndWaitBuyButton({ attempts: 30, delay: 150 }, (buyBtn) => {
        if (buyBtn) {
          robustClick(buyBtn);
          toast(`Автопокупка: нажал «Купить» (${uniqueIds.size} шт.)`);
        } else {
          const checkout = findCheckoutButton();
          if (checkout) {
            robustClick(checkout);
            toast('Автопокупка: перешёл к оформлению (кнопка «Купить» не найдена)');
          } else {
            toast('Автопокупка: не удалось найти «Купить»');
          }
        }
        AUTO.timeout(() => { autoBuyInProgress = false; }, 4000);
      });
    }, delay + 250 + randDelay());
  }

  function tryNotifyForCard(item, info){
    const title = 'Найдена выгодная карточка';
    const message = `${item.hashName}\nЦена: ${fmt(item.csmPriceRub)} · Market: ${fmt(info.marketBase)}\nROI ≈ ${(info.roi*100).toFixed(1)}%`;
    try { chrome.runtime.sendMessage({ type:'AUTO_NOTIFY', payload:{ title, message } }, ()=>{}); } catch(_){}
  }

  // ---------------- Хоткей AltLeft + AltRight (AltGr) ----------------
  let altLeftDown=false, altRightDown=false, lastToggleTs=0;
  function toggleAutoByHotkey(){
    const now = Date.now();
    if (now - lastToggleTs < 600) return;
    lastToggleTs = now;

    const isRunning = !!(auto.autoEnabled && !autoHalted);
    if (isRunning){
      AUTO.stop();
      autoHalted = false;
      chrome.storage.sync.set({ autoEnabled:false }, () => {
        auto.autoEnabled = false;
        lastKnownAutoEnabled = false;
        toast('Автоматический режим: выключен');
      });
    } else {
      chrome.storage.sync.set({ autoEnabled:true }, () => {
        auto.autoEnabled = true;
        lastKnownAutoEnabled = true;
        ensureAutoRunning({ immediateScan: true });
        toast('Автоматический режим: включен');
      });
    }
  }
  window.addEventListener('keydown', e => {
    if (e.code === 'AltLeft') altLeftDown = true;
    if (e.key === 'AltGraph' || e.code === 'AltRight') altRightDown = true;
    if (e.key === 'AltGraph' || (altLeftDown && altRightDown)) {
      e.preventDefault();
      e.stopPropagation();
      toggleAutoByHotkey();
    }
  }, true);
  window.addEventListener('keyup', e => {
    if (e.code === 'AltLeft') altLeftDown = false;
    if (e.key === 'AltGraph' || e.code === 'AltRight') altRightDown = false;
  }, true);

  // ---------------- Наблюдатель и запуск ----------------
  const obs = new MutationObserver(() => scanAndCompare());
  obs.observe(document.documentElement, { childList:true, subtree:true });

  chrome.runtime?.onMessage?.addListener?.((msg) => {
    if (msg?.type==='RECOMPARE_ALL') scanAndCompare(true);
  });

  loadAutoSettings((prevEnabled, nextEnabled) => {
    if (nextEnabled && !autoHalted) AUTO.start();
  });
  scanAndCompare();

  // Вспомогательные форматтеры (внизу, чтобы не мешать чтению)
  function fmt(n){ return n.toLocaleString('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}); }

})();
