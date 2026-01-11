// ==UserScript==
// @name         WorkMarket Firehose Enricher Auto-inject (Paging + DOM watch)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Continuously intercept /feed/firehose responses, auto-inject feed details into assignments, handle paging/navigation/DOM updates, and show a live debug overlay.
// @author       ilakskill
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
  const DEBOUNCE_MS = 200;

  function lg(...a){ console.info(TAG, ...a); }
  function lw(...a){ console.warn(TAG, ...a); }
  function le(...a){ console.error(TAG, ...a); }
  function ld(...a){ if (console.debug) console.debug(TAG, ...a); }

  lg('Script starting (document-start)');

  // state
  let latestUrl = null;
  let latestPayload = null;
  let lastIndexedCount = 0;
  let lastAnchorsCount = 0;
  let lastInjectedCount = 0;
  let overlay = null;
  const handlers = [];

  function onPayload(cb){ handlers.push(cb); }
  function emitPayload(url, payload){
    latestUrl = url;
    latestPayload = payload;
    try { GM_setValue('workmarket_firehose_last', { timestamp: Date.now(), url, payload }); } catch(e){}
    handlers.forEach(h => { try { h(url, payload); } catch (e) { le('handler error', e); } });
  }

  function tryParse(text){ try { return JSON.parse(text); } catch(e) { return null; } }

  // ---- overlay UI ----
  function createOverlay(){
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'wm-enricher-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: 2147483647,
      background: 'rgba(2,6,23,0.75)', color: '#fff', padding: '10px 12px',
      borderRadius: '8px', fontSize: '13px', fontFamily: 'Segoe UI, Roboto, Arial, sans-serif',
      lineHeight: '1.3', minWidth: '220px', boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      backdropFilter: 'blur(4px)', pointerEvents: 'auto', userSelect: 'none'
    });

    const title = document.createElement('div');
    title.textContent = 'WM-Enricher Debug';
    Object.assign(title.style, { fontWeight: '700', marginBottom: '8px' });
    overlay.appendChild(title);

    const list = document.createElement('div');
    list.id = 'wm-enricher-stats';
    Object.assign(list.style, { display:'grid', gridTemplateColumns:'1fr auto', rowGap:'6px', columnGap:'8px' });

    function mkRow(labelText, id) {
      const label = document.createElement('div');
      label.style.opacity = '0.9'; label.style.fontWeight = '600'; label.textContent = labelText;
      const value = document.createElement('div'); value.id = id; value.style.textAlign = 'right'; value.style.fontWeight = '600'; value.textContent = '0';
      return { label, value };
    }
    const r1 = mkRow('Anchors', 'wm-enricher-anchors-count');
    const r2 = mkRow('Indexed items', 'wm-enricher-indexed-count');
    const r3 = mkRow('Injected', 'wm-enricher-injected-count');
    const r4 = mkRow('Last source', 'wm-enricher-source');

    [r1,r2,r3,r4].forEach(r => { list.appendChild(r.label); list.appendChild(r.value); });
    overlay.appendChild(list);

    const controls = document.createElement('div');
    controls.style.marginTop = '8px'; controls.style.display = 'flex'; controls.style.gap = '8px';

    const btnRefresh = document.createElement('button');
    btnRefresh.textContent = 'Refresh';
    Object.assign(btnRefresh.style, { cursor:'pointer', border:'none', padding:'6px 8px', borderRadius:'6px', background:'#0ea5e9', color:'#042', fontWeight:'700' });
    btnRefresh.addEventListener('click', ()=>{ runNow(); flashOverlay(); });

    const btnHide = document.createElement('button');
    btnHide.textContent = 'Hide';
    Object.assign(btnHide.style, { cursor:'pointer', border:'none', padding:'6px 8px', borderRadius:'6px', background:'#e2e8f0', color:'#042' });
    btnHide.addEventListener('click', ()=>{ if (overlay) overlay.style.display = 'none'; });

    controls.appendChild(btnRefresh); controls.appendChild(btnHide);
    overlay.appendChild(controls);

    // drag
    overlay.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const startX = e.clientX, startY = e.clientY;
      const rect = overlay.getBoundingClientRect();
      function onMove(ev){ overlay.style.left = (rect.left + (ev.clientX - startX)) + 'px'; overlay.style.bottom = 'auto'; overlay.style.top = (rect.top + (ev.clientY - startY)) + 'px'; }
      function onUp(){ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
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
      if (sourceEl) sourceEl.textContent = latestUrl ? (latestUrl.length > 40 ? latestUrl.slice(0,40) + '…' : latestUrl) : 'none';
    } catch (e){ ld('updateOverlay error', e); }
  }

  // ---- network interception (capture every /feed/firehose response) ----
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (typeof url === 'string' && url.includes('/feed/firehose')) {
        lg('Detected fetch to firehose:', url);
        const resp = await originalFetch.apply(this, arguments);
        let text = null;
        try { text = await resp.clone().text(); } catch (e) { lw('fetch clone failed', e); }
        const parsed = tryParse(text) ?? text;
        lg('Captured fetch payload type:', typeof parsed);
        emitPayload(url, parsed);
        return resp;
      }
    } catch (e) { lw('fetch wrapper error', e); }
    return originalFetch.apply(this, arguments);
  };

  (function () {
    const XHR = window.XMLHttpRequest;
    function ProxyXHR() {
      const xhr = new XHR();
      let _url = null;
      const openOrig = xhr.open;
      xhr.open = function (method, url) { try { _url = url; } catch (e) { _url = null; } return openOrig.apply(this, arguments); };
      const sendOrig = xhr.send;
      xhr.send = function () {
        try {
          if (_url && typeof _url === 'string' && _url.includes('/feed/firehose')) {
            lg('Detected XHR to firehose:', _url);
            this.addEventListener('load', function () {
              let text = null;
              try { text = this.responseText; } catch (e) { text = null; }
              const parsed = tryParse(text) ?? text;
              lg('Captured XHR payload type:', typeof parsed);
              emitPayload(_url, parsed);
            }, { once: true });
          }
        } catch (e) { lw('XHR wrapper error', e); }
        return sendOrig.apply(this, arguments);
      };
      return xhr;
    }
    ProxyXHR.prototype = XHR.prototype;
    window.XMLHttpRequest = ProxyXHR;
    lg('XMLHttpRequest patched');
  })();

  // ---- matching / extraction / injection logic ----
  function getNumericTokenFromHrefOrText(href, text) {
    // return the first long numeric token (6+ digits) from href or text
    const fromHref = href ? (href.match(/(\d{6,})/g) || []) : [];
    const fromText = text ? (text.match(/(\d{6,})/g) || []) : [];
    return (fromHref.concat(fromText))[0] || null;
  }

  function buildIndexesFromItems(items){
    const byId = new Map(), byUuid = new Map(), byWorkNumber = new Map();
    for (const it of (items || [])) {
      try {
        if (it?.id != null) byId.set(String(it.id), it);
        if (it?.uuid) byUuid.set(String(it.uuid), it);
        if (it?.workNumber != null) byWorkNumber.set(String(it.workNumber), it);
      } catch (e) { /* ignore item parse errors */ }
    }
    return { byId, byUuid, byWorkNumber };
  }

  function extractFields(item){
    if (!item) return {};
    return {
      workOrder: item.workNumber ?? null,
      spendLimit: item.spendLimit ?? item.spend_limit ?? null,
      pricingType: item.pricingType ?? item.pricing_type ?? null,
      companyName: item.companyName ?? item.company_name ?? null,
      company: item.company ?? item.client ?? null,
      assignedToFirst: item.assignToFirstResource === true ? '(assignToFirstResource:true)' : (item.assignedTo?.[0]?.name ?? item.assignedTo?.[0] ?? null)
    };
  }

  function buildInfoBlock(info){
    const wrap = document.createElement('div');
    wrap.className = 'wm-feed-details-block';
    Object.assign(wrap.style, { margin:'6px 0 0', padding:'6px 8px', border:'1px solid rgba(2,6,23,0.06)', borderRadius:'6px', background:'#f8fafc', fontSize:'12px', lineHeight:'1.4', color:'#0f172a' });
    const title = document.createElement('div'); title.textContent = 'Feed details'; title.style.fontWeight = '600'; title.style.marginBottom = '4px'; wrap.appendChild(title);
    const mk = (l,v) => { const r = document.createElement('div'); const a = document.createElement('span'); a.textContent = l + ': '; a.style.fontWeight = '700'; const b = document.createElement('span'); b.textContent = (v !== null && v !== undefined) ? String(v) : '—'; r.appendChild(a); r.appendChild(b); return r; };
    wrap.appendChild(mk('Work order', info.workOrder));
    wrap.appendChild(mk('Spend limit', info.spendLimit));
    wrap.appendChild(mk('Pricing type', info.pricingType));
    wrap.appendChild(mk('Company name', info.companyName));
    wrap.appendChild(mk('Company', info.company));
    wrap.appendChild(mk('Assigned to (first resource)', info.assignedToFirst));
    return wrap;
  }

  function findCardContainer(anchor){
    let el = anchor;
    for (let i = 0; i < 6 && el; i++) {
      if (!el) break;
      if (el.classList && (el.classList.contains('card') || el.classList.contains('assignment-card') || el.classList.contains('list-item') || el.getAttribute('data-assignment') || el.getAttribute('role') === 'article')) return el;
      el = el.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  // main augmentation function
  function augmentFromPayload(url, payload) {
    lg('augmentFromPayload called', { url, type: typeof payload });

    const itemsArray = Array.isArray(payload) ? payload
      : Array.isArray(payload?.results) ? payload.results
      : Array.isArray(payload?.items) ? payload.items
      : Array.isArray(payload?.data) ? payload.data
      : null;

    if (!itemsArray) { lw('No items array found in payload; keys:', Object.keys(payload || {})); updateOverlayCounts(0,0,0); return; }
    lg('Items array length:', itemsArray.length);

    const { byId, byUuid, byWorkNumber } = buildIndexesFromItems(itemsArray);
    lg('Indexes sizes', { byId: byId.size, byUuid: byUuid.size, byWorkNumber: byWorkNumber.size });

    const anchors = Array.from(document.querySelectorAll('a[href*="/assignment/"], a[href*="/work/"], a[href*="/job/"], a[href*="/workorder/"], a[href*="/jobs/"]'));
    lg('Anchors found on page:', anchors.length);

    let injected = 0;
    anchors.forEach(anchor => {
      try {
        const href = anchor.href;
        const text = anchor.innerText || anchor.textContent || '';
        const numericToken = getNumericTokenFromHrefOrText(href, text);
        let matched = null;
        let reason = null;

        // Preferred: treat numericToken as workNumber (site uses /work/<workNumber>)
        if (numericToken && byWorkNumber.has(String(numericToken))) {
          matched = byWorkNumber.get(String(numericToken));
          reason = `workNumber:${numericToken}`;
        }

        // numericToken -> feed.id
        if (!matched && numericToken && byId.has(String(numericToken))) {
          matched = byId.get(String(numericToken));
          reason = `id:${numericToken}`;
        }

        // numericToken -> uuid (rare)
        if (!matched && numericToken && byUuid.has(String(numericToken))) {
          matched = byUuid.get(String(numericToken));
          reason = `uuid:${numericToken}`;
        }

        // contains check for workNumber in href/text
        if (!matched) {
          for (const [wn, it] of byWorkNumber.entries()) {
            if (wn && (href.includes(wn) || (text && text.includes(wn)))) {
              matched = it;
              reason = `contain-workNumber:${wn}`;
              break;
            }
          }
        }

        if (!matched) {
          ld('No match for anchor', { href, textSnippet: text.trim().slice(0,80), numericToken });
          return;
        }

        const container = findCardContainer(anchor);
        if (!container) return;
        if (container.querySelector && container.querySelector('.wm-feed-details-block')) {
          ld('Already injected for matched anchor', { href, reason });
          return;
        }

        const info = extractFields(matched);
        const block = buildInfoBlock(info);
        if (anchor.parentElement) anchor.parentElement.insertBefore(block, anchor.nextSibling); else container.appendChild(block);
        injected++;
        lg('Injected', { href, reason, id: matched.id, workNumber: matched.workNumber, title: matched.publicTitle ?? matched.title });
      } catch (e) {
        le('Error in anchor processing', e);
      }
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

  // runNow helper
  function runNow(){
    if (latestPayload) augmentFromPayload(latestUrl, latestPayload);
    else {
      try {
        const stored = GM_getValue('workmarket_firehose_last', null);
        if (stored && stored.payload) augmentFromPayload(stored.url || latestUrl, stored.payload);
        else lg('No payload available to runNow');
      } catch (e) { lw('runNow error', e); }
    }
  }

  // register payload handlers
  onPayload((url, payload) => {
    try { createOverlay(); } catch(e) {}
    setTimeout(()=>augmentFromPayload(url, payload), 120);
  });

  // try stored payload once on load
  (function tryStoredOnce(){
    try {
      const stored = GM_getValue('workmarket_firehose_last', null);
      if (stored && stored.payload) {
        lg('Found stored payload — running augmentFromPayload once (stored)');
        const run = () => augmentFromPayload(stored.url || latestUrl, stored.payload);
        if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(run, 300);
        else window.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        lg('No stored payload available');
      }
    } catch (e) { lw('GM_getValue error', e); }
  })();

  // ---- Auto-inject hooks (DOM / navigation / clicks) ----
  let debounceTimer = null;
  function scheduleAutoRun(reason) {
    lg('scheduleAutoRun', reason);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      lg('Debounced auto-run executing (reason):', reason);
      runNow();
      debounceTimer = null;
    }, DEBOUNCE_MS);
  }

  function startMutationObserver() {
    const containerSelectorCandidates = ['div[role="main"]', '#content', '.browse-list', '.results', '.feed-list'];
    let parent = null;
    for (const sel of containerSelectorCandidates) {
      const el = document.querySelector(sel);
      if (el) { parent = el; break; }
    }
    if (!parent) parent = document.body;

    const observer = new MutationObserver((mutations) => {
      let addedAssignment = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            try {
              if (n.nodeType !== 1) continue;
              const node = n;
              if (node.querySelector && (node.querySelector('a[href*="/assignment/"], a[href*="/work/"], a[href*="/job/"]') || node.querySelector('.assignment-card') || node.querySelector('.publicTitle'))) {
                addedAssignment = true; break;
              }
              if (node.matches && node.matches('a[href*="/assignment/"], a[href*="/work/"], a[href*="/job/"]')) {
                addedAssignment = true; break;
              }
            } catch (e) { /* ignore */ }
          }
        }
        if (addedAssignment) break;
      }
      if (addedAssignment) scheduleAutoRun('mutationObserver:assignmentAdded');
    });

    observer.observe(parent, { childList: true, subtree: true });
    lg('MutationObserver started on', parent.tagName || 'BODY');
  }

  (function patchHistory() {
    const origPush = history.pushState;
    history.pushState = function () { origPush.apply(this, arguments); scheduleAutoRun('history.pushState'); };
    const origReplace = history.replaceState;
    history.replaceState = function () { origReplace.apply(this, arguments); scheduleAutoRun('history.replaceState'); };
    window.addEventListener('popstate', () => scheduleAutoRun('popstate'));
    lg('History API patched');
  })();

  function installClickListener() {
    document.addEventListener('click', (ev) => {
      try {
        const target = ev.target;
        if (!target) return;
        const anchor = target.closest ? target.closest('a') : (target.tagName === 'A' ? target : null);
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        if (href.includes('page') || href.includes('p=') || anchor.textContent?.trim()?.toLowerCase().includes('next') || href.includes('/worker/browse')) {
          scheduleAutoRun('click:paginationOrBrowseLink');
        }
      } catch (e) { /* ignore */ }
    }, { capture: true });
    lg('Global click listener installed');
  }

  function runOnLoad() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(() => scheduleAutoRun('initialLoad'), 200);
    else window.addEventListener('DOMContentLoaded', () => scheduleAutoRun('DOMContentLoaded'), { once: true });
  }

  function initAutoHooks() {
    try { createOverlay(); } catch(e) {}
    startMutationObserver();
    installClickListener();
    runOnLoad();
    lg('Auto-inject hooks initialized');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(initAutoHooks, 200);
  else window.addEventListener('DOMContentLoaded', () => setTimeout(initAutoHooks, 200), { once: true });

  // expose debug API
  window.__wm_enricher = {
    lastUrl: () => latestUrl,
    lastPayload: () => latestPayload,
    runNow: () => runNow(),
    showOverlay: () => { if (overlay) overlay.style.display = 'block'; else createOverlay(); updateOverlay(); },
    hideOverlay: () => { if (overlay) overlay.style.display = 'none'; }
  };

  lg('WM-Enricher loaded and watching for /feed/firehose calls, DOM mutations, and navigation events');
})();
