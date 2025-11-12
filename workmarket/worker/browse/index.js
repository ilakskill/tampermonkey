// ==UserScript==
// @name         WorkMarket Firehose Continuous Enricher with Overlay
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Intercept /feed/firehose responses, enrich assignments and show live counts overlay on Browse Work page.
// @match        https://www.workmarket.com/worker/browse*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      www.workmarket.com
// ==/UserScript==

(function () {
  'use strict';
  const TAG = '[WM-Enricher]';
  const CAPTURE_TIMEOUT_MS = 8000;

  function lg(...a){ console.info(TAG, ...a); }
  function lw(...a){ console.warn(TAG, ...a); }
  function le(...a){ console.error(TAG, ...a); }
  function ld(...a){ if (console.debug) console.debug(TAG, ...a); }

  lg('Script starting (document-start)');

  // live state
  let latestUrl = null;
  let latestPayload = null;
  let lastIndexedCount = 0;
  let lastAnchorsCount = 0;
  let lastInjectedCount = 0;
  const handlers = [];

  function onPayload(cb){ handlers.push(cb); }
  function emitPayload(url, payload){
    latestUrl = url;
    latestPayload = payload;
    try { GM_setValue('workmarket_firehose_last', { timestamp: Date.now(), url, payload }); } catch(e){}
    handlers.forEach(h=>{
      try{ h(url, payload); }catch(e){ le('handler error', e); }
    });
  }

  function tryParse(text){ try{ return JSON.parse(text); }catch(e){ return null; } }

  // create overlay
  let overlay = null;
  function createOverlay(){
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'wm-enricher-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '12px';
    overlay.style.bottom = '12px';
    overlay.style.zIndex = 2147483647;
    overlay.style.background = 'rgba(2,6,23,0.75)';
    overlay.style.color = '#fff';
    overlay.style.padding = '10px 12px';
    overlay.style.borderRadius = '8px';
    overlay.style.fontSize = '13px';
    overlay.style.fontFamily = 'Segoe UI, Roboto, Arial, sans-serif';
    overlay.style.lineHeight = '1.3';
    overlay.style.minWidth = '200px';
    overlay.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.textContent = 'WM-Enricher Debug';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';
    overlay.appendChild(title);

    const list = document.createElement('div');
    list.id = 'wm-enricher-stats';
    list.style.display = 'grid';
    list.style.gridTemplateColumns = '1fr auto';
    list.style.rowGap = '6px';
    list.style.columnGap = '8px';

    const mkRow = (idLabel, textLabel) => {
      const label = document.createElement('div');
      label.style.opacity = '0.9';
      label.style.fontWeight = '600';
      label.textContent = idLabel;
      const value = document.createElement('div');
      value.id = textLabel;
      value.style.textAlign = 'right';
      value.style.fontWeight = '600';
      value.textContent = '0';
      return { label, value };
    };

    const r1 = mkRow('Anchors', 'wm-enricher-anchors-count');
    const r2 = mkRow('Indexed items', 'wm-enricher-indexed-count');
    const r3 = mkRow('Injected', 'wm-enricher-injected-count');
    const r4 = mkRow('Last source', 'wm-enricher-source');

    list.appendChild(r1.label); list.appendChild(r1.value);
    list.appendChild(r2.label); list.appendChild(r2.value);
    list.appendChild(r3.label); list.appendChild(r3.value);
    list.appendChild(r4.label); list.appendChild(r4.value);

    overlay.appendChild(list);

    const controls = document.createElement('div');
    controls.style.marginTop = '8px';
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.justifyContent = 'space-between';

    const btnRefresh = document.createElement('button');
    btnRefresh.textContent = 'Refresh';
    btnRefresh.style.cursor = 'pointer';
    btnRefresh.style.border = 'none';
    btnRefresh.style.padding = '6px 8px';
    btnRefresh.style.borderRadius = '6px';
    btnRefresh.style.background = '#0ea5e9';
    btnRefresh.style.color = '#042';
    btnRefresh.style.fontWeight = '700';
    btnRefresh.addEventListener('click', () => {
      runNow();
      flashOverlay();
    });

    const btnHide = document.createElement('button');
    btnHide.textContent = 'Hide';
    btnHide.style.cursor = 'pointer';
    btnHide.style.border = 'none';
    btnHide.style.padding = '6px 8px';
    btnHide.style.borderRadius = '6px';
    btnHide.style.background = '#e2e8f0';
    btnHide.style.color = '#042';
    btnHide.addEventListener('click', () => {
      if (overlay) overlay.style.display = 'none';
    });

    controls.appendChild(btnRefresh);
    controls.appendChild(btnHide);
    overlay.appendChild(controls);

    // small draggable support
    overlay.style.userSelect = 'none';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const startX = e.clientX, startY = e.clientY;
      const rect = overlay.getBoundingClientRect();
      function onMove(ev){
        overlay.style.left = (rect.left + (ev.clientX - startX)) + 'px';
        overlay.style.bottom = 'auto';
        overlay.style.top = (rect.top + (ev.clientY - startY)) + 'px';
      }
      function onUp(){ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    document.documentElement.appendChild(overlay);
    updateOverlay();
    return overlay;
  }

  function flashOverlay(){
    if (!overlay) return;
    const orig = overlay.style.boxShadow;
    overlay.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.8)';
    setTimeout(()=> overlay.style.boxShadow = orig, 600);
  }

  function updateOverlay(){
    try {
      if (!overlay) createOverlay();
      const anchorsEl = document.getElementById('wm-enricher-anchors-count');
      const indexedEl = document.getElementById('wm-enricher-indexed-count');
      const injectedEl = document.getElementById('wm-enricher-injected-count');
      const sourceEl = document.getElementById('wm-enricher-source');
      if (anchorsEl) anchorsEl.textContent = String(lastAnchorsCount);
      if (indexedEl) indexedEl.textContent = String(lastIndexedCount);
      if (injectedEl) injectedEl.textContent = String(lastInjectedCount);
      if (sourceEl) sourceEl.textContent = latestUrl ? (latestUrl.length > 28 ? latestUrl.slice(0,28) + '…' : latestUrl) : 'none';
    } catch (e){ ld('updateOverlay error', e); }
  }

  // intercept fetch
  const _fetch = window.fetch;
  window.fetch = async function(input, init){
    try{
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (typeof url === 'string' && url.includes('/feed/firehose')){
        lg('Detected fetch to firehose:', url);
        const resp = await _fetch.apply(this, arguments);
        let text = null;
        try{ text = await resp.clone().text(); }catch(e){ lw('fetch clone failed', e); }
        const parsed = tryParse(text) ?? text;
        lg('Captured fetch payload type:', typeof parsed);
        emitPayload(url, parsed);
        return resp;
      }
    }catch(e){ lw('fetch wrapper error', e); }
    return _fetch.apply(this, arguments);
  };

  // intercept XHR
  (function(){
    const XHR = window.XMLHttpRequest;
    function ProxyXHR(){
      const xhr = new XHR();
      let _url = null;
      const openOrig = xhr.open;
      xhr.open = function(method, url){
        try{ _url = url; }catch(e){ _url = null; }
        return openOrig.apply(this, arguments);
      };
      const sendOrig = xhr.send;
      xhr.send = function(){
        try{
          if (_url && typeof _url === 'string' && _url.includes('/feed/firehose')){
            lg('Detected XHR to firehose:', _url);
            this.addEventListener('load', function(){
              let text = null;
              try{ text = this.responseText; }catch(e){ text = null; }
              const parsed = tryParse(text) ?? text;
              lg('Captured XHR payload type:', typeof parsed);
              emitPayload(_url, parsed);
            }, { once: true });
          }
        }catch(e){ lw('XHR wrapper error', e); }
        return sendOrig.apply(this, arguments);
      };
      return xhr;
    }
    ProxyXHR.prototype = XHR.prototype;
    window.XMLHttpRequest = ProxyXHR;
    lg('XMLHttpRequest patched');
  })();

  // helpers
  function getNumericId(url){ if(!url) return null; const m = String(url).match(/(\d+)(?:\/?#?[^\d]*)?$/); return m?m[1]:null; }

  function buildIndexesFromItems(items){
    const byId=new Map(), byUuid=new Map(), byWorkNumber=new Map();
    for(const it of (items||[])){
      try{
        if (it?.id != null) byId.set(String(it.id), it);
        if (it?.uuid) byUuid.set(String(it.uuid), it);
        if (it?.workNumber != null) byWorkNumber.set(String(it.workNumber), it);
      }catch(e){}
    }
    return {byId, byUuid, byWorkNumber};
  }

  function extractFields(item){
    if(!item) return {};
    return {
      workOrder: item.workNumber ?? item.workNumber ?? item.workNumber ?? null,
      spendLimit: item.spendLimit ?? item.spend_limit ?? item.budget ?? null,
      pricingType: item.pricingType ?? item.pricing_type ?? item.pricing ?? null,
      companyName: item.companyName ?? item.company_name ?? null,
      company: item.company ?? item.client ?? null,
      assignedToFirst: item.assignToFirstResource === true ? '(assignToFirstResource:true)' : (item.assignedTo?.[0]?.name ?? item.assignedTo?.[0] ?? null)
    };
  }

  function buildInfoBlock(info){
    const wrap=document.createElement('div');
    wrap.className='wm-feed-details-block';
    wrap.style.margin='6px 0 0';
    wrap.style.padding='6px 8px';
    wrap.style.border='1px solid rgba(2,6,23,0.06)';
    wrap.style.borderRadius='6px';
    wrap.style.background='#f8fafc';
    wrap.style.fontSize='12px';
    wrap.style.lineHeight='1.4';
    wrap.style.color='#0f172a';
    const title=document.createElement('div'); title.textContent='Feed details'; title.style.fontWeight='600'; title.style.marginBottom='4px'; wrap.appendChild(title);
    const mk=(l,v)=>{ const r=document.createElement('div'); const a=document.createElement('span'); a.textContent=l+': '; a.style.fontWeight='700'; const b=document.createElement('span'); b.textContent=(v!==null&&v!==undefined)?String(v):'—'; r.appendChild(a); r.appendChild(b); return r; };
    wrap.appendChild(mk('Work order', info.workOrder));
    wrap.appendChild(mk('Spend limit', info.spendLimit));
    wrap.appendChild(mk('Pricing type', info.pricingType));
    wrap.appendChild(mk('Company name', info.companyName));
    wrap.appendChild(mk('Company', info.company));
    wrap.appendChild(mk('Assigned to (first resource)', info.assignedToFirst));
    return wrap;
  }

  function findCardContainer(anchor){
    let el=anchor;
    for(let i=0;i<6&&el;i++){
      if(!el) break;
      if(el.classList && (el.classList.contains('card')||el.classList.contains('assignment-card')||el.classList.contains('list-item')||el.getAttribute('data-assignment')||el.getAttribute('role')==='article')) return el;
      el=el.parentElement;
    }
    return anchor.parentElement||anchor;
  }

  // augmentation logic
  function augmentFromPayload(url, payload){
    lg('augmentFromPayload called', { url, payloadType: typeof payload });
    // normalize items array
    const itemsArray = Array.isArray(payload) ? payload
      : Array.isArray(payload?.results) ? payload.results
      : Array.isArray(payload?.items) ? payload.items
      : Array.isArray(payload?.data) ? payload.data
      : null;

    if(!itemsArray){ lw('No items array found in payload; keys:', Object.keys(payload||{})); updateOverlayCounts(0,0,0); return; }
    lg('Items array length:', itemsArray.length);

    const {byId, byUuid, byWorkNumber} = buildIndexesFromItems(itemsArray);
    lg('Indexes sizes', { byId: byId.size, byUuid: byUuid.size, byWorkNumber: byWorkNumber.size });

    const anchors = Array.from(document.querySelectorAll('a[href*="/assignment/"], a[href*="/work/"], a[href*="/job/"], a[href*="/workorder/"], a[href*="/jobs/"]'));
    lg('Anchors found on page:', anchors.length);

    let injected = 0;
    anchors.forEach(anchor=>{
      try{
        const href = anchor.href;
        const text = anchor.innerText || anchor.textContent || '';
        const numericId = getNumericId(href);
        let matched = null;
        let reason = null;

        if(numericId && byId.has(String(numericId))){ matched = byId.get(String(numericId)); reason = 'id'; }
        if(!matched && numericId && byUuid.has(String(numericId))){ matched = byUuid.get(String(numericId)); reason = 'uuid'; }

        if(!matched){
          const workNumberCandidate = (href.match(/(\d{6,})/g) || []).concat((text.match(/(\d{6,})/g)||[]))[0] || null;
          if(workNumberCandidate && byWorkNumber.has(String(workNumberCandidate))){ matched = byWorkNumber.get(String(workNumberCandidate)); reason='workNumber'; }
        }

        if(!matched){
          for(const [wn,it] of byWorkNumber.entries()){
            if(wn && (href.includes(wn) || (text && text.includes(wn)))){ matched = it; reason = 'contain-workNumber:'+wn; break; }
          }
        }

        if(!matched){
          ld('No match for anchor', { href, textSnippet: text.trim().slice(0,80), numericId });
          return;
        }

        const container = findCardContainer(anchor);
        if(!container) return;
        if(container.querySelector && container.querySelector('.wm-feed-details-block')) {
          ld('Already injected for matched anchor', { href, reason });
          return;
        }

        const info = extractFields(matched);
        const block = buildInfoBlock(info);
        if(anchor.parentElement) anchor.parentElement.insertBefore(block, anchor.nextSibling); else container.appendChild(block);
        injected++;
        lg('Injected', { href, reason, id: matched.id, workNumber: matched.workNumber, title: matched.publicTitle ?? matched.title });
      }catch(e){ le('Error in anchor processing', e); }
    });

    lastIndexedCount = itemsArray.length;
    lastAnchorsCount = anchors.length;
    lastInjectedCount = injected;
    updateOverlayCounts(lastAnchorsCount, lastIndexedCount, lastInjectedCount);
    lg('augment complete. injected:', injected);
  }

  function updateOverlayCounts(anchors, indexed, injected){
    lastAnchorsCount = anchors ?? lastAnchorsCount;
    lastIndexedCount = indexed ?? lastIndexedCount;
    lastInjectedCount = injected ?? lastInjectedCount;
    updateOverlay();
  }

  // register handler
  onPayload((url,payload) => {
    // ensure overlay exists and run augmentation after slight delay
    try { createOverlay(); } catch(e){}
    setTimeout(()=>augmentFromPayload(url,payload), 120);
  });

  // try stored payload once on load
  function tryStoredOnce(){
    try{
      const stored = GM_getValue('workmarket_firehose_last', null);
      if(stored && stored.payload){
        lg('Found stored payload — running augmentFromPayload once (stored)');
        const run = ()=>augmentFromPayload(stored.url || latestUrl, stored.payload);
        if(document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(run, 300);
        else window.addEventListener('DOMContentLoaded', run, {once:true});
      } else {
        lg('No stored payload available');
      }
    }catch(e){ lw('GM_getValue error', e); }
  }
  tryStoredOnce();

  // expose debug API
  window.__wm_enricher = {
    lastUrl: ()=>latestUrl,
    lastPayload: ()=>latestPayload,
    runNow: ()=>augmentFromPayload(latestUrl, latestPayload),
    showOverlay: ()=>{ if (overlay) overlay.style.display = 'block'; else createOverlay(); updateOverlay(); },
    hideOverlay: ()=>{ if (overlay) overlay.style.display = 'none'; }
  };

  // helper to run on-demand
  function runNow(){
    if (latestPayload) augmentFromPayload(latestUrl, latestPayload);
    else {
      // attempt to use stored payload
      try {
        const stored = GM_getValue('workmarket_firehose_last', null);
        if (stored && stored.payload) augmentFromPayload(stored.url || latestUrl, stored.payload);
        else lg('No payload available to runNow');
      } catch (e) { lw('runNow error', e); }
    }
  }

  // ensure overlay created after DOM available
  function scheduleOverlayCreate(){
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(createOverlay, 250);
    else window.addEventListener('DOMContentLoaded', () => setTimeout(createOverlay, 250), { once: true });
  }
  scheduleOverlayCreate();

  lg('WM-Enricher loaded and watching for /feed/firehose calls');

})();
