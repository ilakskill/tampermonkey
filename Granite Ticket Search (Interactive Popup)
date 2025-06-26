// ==UserScript==
// @name         Granite Ticket Search (Interactive Popup)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Search Smartsheet by dragging to highlight text and open results directly from the popup.
// @author       ilakskills
// @match        *://*/*
// @connect      api.smartsheet.com
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration (Unchanged) ---

    let SMARTSHEET_API_KEY;

(async () => {
    SMARTSHEET_API_KEY = await GM_getValue('SMARTSHEET_API_KEY');
    if (!SMARTSHEET_API_KEY) {
        SMARTSHEET_API_KEY = prompt('Enter your Smartsheet API Key:');
        if (SMARTSHEET_API_KEY) {
            await GM_setValue('SMARTSHEET_API_KEY', SMARTSHEET_API_KEY);
            alert('API Key saved! Reload the page to use it.');
        } else {
            alert('No API key provided. Script will not function.');
        }
    }
})();


    const SMARTSHEET_API_BASE_URL = 'https://api.smartsheet.com/2.0';

    // --- State & Helpers (Unchanged) ---
    let lastSearchResults = [];
    function linkify(text) { if (text == null) return ''; const textAsString = String(text); const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig; return textAsString.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`); }

    // ==============================================================================
    // --- Redesigned UI & Styling (v4.0) ---
    // ==============================================================================
    GM_addStyle(`
        :root { /* CSS variables for easy theming */
            --gts-primary: #0d6efd; --gts-text-on-primary: #004085; --gts-bg-on-primary: #cce5ff; --gts-border-on-primary: #b8daff;
            --gts-bg: #ffffff; --gts-header-bg: #f8f9fa; --gts-border: #dee2e6; --gts-text: #212529; --gts-link: #0d6efd;
            --gts-shadow: 0 8px 25px rgba(0,0,0,0.15);
        }
        .gts-common, .gts-common * { box-sizing: border-box; }
        /* Main Popup Shell */
        #gts-popup { position: fixed; top: 40px; right: 40px; width: 600px; max-height: 90vh; background-color: var(--gts-bg); border: 1px solid var(--gts-border); border-radius: 12px; box-shadow: var(--gts-shadow); z-index: 10001; display: none; flex-direction: column; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--gts-text); }
        #gts-popup-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; background-color: var(--gts-header-bg); border-bottom: 1px solid var(--gts-border); cursor: move; border-radius: 12px 12px 0 0; }
        #gts-popup.gts-collapsed { height: auto !important; } #gts-popup.gts-collapsed #gts-popup-content { display: none; }
        #gts-popup-title-area { display: flex; align-items: center; gap: 10px; }
        #gts-popup #gts-popup-title { font-size: 16px; font-weight: 600; }
        /* NEW: Header link to open in Smartsheet */
        #gts-popup-open-link { display: none; align-items: center; justify-content: center; }
        #gts-popup-header-buttons { display: flex; align-items: center; gap: 8px; cursor: default; }
        .gts-header-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; cursor: pointer; background: transparent; border: none; border-radius: 8px; transition: background-color 0.2s ease; }
        .gts-header-btn:hover { background-color: rgba(0,0,0,0.08); }
        .gts-header-btn svg { width: 20px; height: 20px; stroke: #555; stroke-width: 2; }
        #gts-popup-back { display: none; }
        /* Content Area */
        #gts-popup-content { padding: 20px; overflow-y: auto; } #gts-popup a { color: var(--gts-link); text-decoration: none; } #gts-popup a:hover { text-decoration: underline; }
        .gts-message, .gts-error { padding: 20px; text-align: center; }
        .gts-error { color: #842029; background-color: #f8d7da; border: 1px solid #f5c2c7; border-radius: 8px; }
        .gts-section { margin-top: 25px; border-top: 1px solid #eee; padding-top: 20px; } .gts-section h5 { margin: 0 0 15px 0; font-size: 16px; font-weight: 600; }
        /* List styling for search results & attachments */
        .gts-list { list-style: none; padding: 0; margin: 0; border: 1px solid var(--gts-border); border-radius: 8px; overflow: hidden; }
        .gts-list li { display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid var(--gts-border); transition: background-color 0.2s; background: #fff; }
        .gts-list li:last-child { border-bottom: none; }
        .gts-list-item-main { flex-grow: 1; cursor: pointer; }
        .gts-list-item-main:hover { text-decoration: underline; }
        .gts-list li small { color: #555; line-height: 1.5; display: block; font-size: 13px; }
        .gts-list li strong { color: #333; font-weight: 600; } .gts-list .gts-search-name { color: var(--gts-primary); }
        /* NEW: Link icon within search results */
        .gts-result-link { margin-left: 15px; padding: 5px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .gts-result-link:hover { background-color: rgba(0,0,0,0.08); }
        .gts-result-link svg { width: 18px; height: 18px; stroke: #555; }
        /* Details View & Confirmation Prompt */
        .gts-details-table { /* ... unchanged ... */ } .gts-comment { /* ... unchanged ... */ }
        #gts-prompt { position: fixed; z-index: 10002; background-color: #fff; border: 1px solid var(--gts-border); box-shadow: var(--gts-shadow); border-radius: 10px; padding: 20px; display: none; font-family: system-ui, sans-serif; }
        #gts-prompt-text { font-size: 15px; margin-bottom: 20px; display: block; max-width: 400px; color: var(--gts-text); }
        #gts-prompt-text strong { color: var(--gts-primary); font-weight: 600; }
        #gts-prompt-buttons { text-align: right; }
        .gts-prompt-btn { border: 1px solid var(--gts-border); border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; margin-left: 10px; font-weight: 600; transition: all 0.2s ease; }
        /* NEW: Button style change */
        #gts-prompt-yes { background-color: var(--gts-bg-on-primary); color: var(--gts-text-on-primary); border-color: var(--gts-border-on-primary); }
        #gts-prompt-yes:hover { opacity: 0.85; }
        #gts-prompt-no { background-color: #fff; color: #444; } #gts-prompt-no:hover { background-color: #f1f1f1; }
    `);

    // --- SVG Icons ---
    const ICONS = {
        back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
        collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        openExternal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
        settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82.33 1.65 1.65 0 0 0-.33 1.82 2 2 0 1 1-3.58 0 1.65 1.65 0 0 0-1.82-.51 1.65 1.65 0 0 0-.33-.33 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0 .33-1.82 2 2 0 1 1 3.58 0"></path></svg>'
    };

    /** Creates the main popup UI structure and makes it interactive. */
    function getOrCreatePopup() {
        let popup = document.getElementById('gts-popup');
        if (!popup) {
            // Build the popup structure programmatically
            popup = document.createElement('div'); popup.id = 'gts-popup'; popup.className = 'gts-common';
            popup.innerHTML = `
                <div id="gts-popup-header">
                    <div id="gts-popup-title-area">
                        <div id="gts-popup-title">Smartsheet Search</div>
                        <a href="#" target="_blank" rel="noopener noreferrer" id="gts-popup-open-link" class="gts-header-btn" title="Open in Smartsheet">${ICONS.openExternal}</a>
                    </div>
                    <div id="gts-popup-header-buttons">
                        <button id="gts-popup-back" class="gts-header-btn" title="Back">${ICONS.back}</button>
                        <button id="gts-popup-collapse" class="gts-header-btn" title="Collapse">${ICONS.collapse}</button>
                        <button id="gts-popup-settings" class="gts-header-btn" title="API Key">${ICONS.settings}</button>
                        <button id="gts-popup-close" class="gts-header-btn" title="Close">${ICONS.close}</button>
                    </div>
                </div>
                <div id="gts-popup-content"></div>`;
            document.body.appendChild(popup);
            const header = document.getElementById('gts-popup-header');
            const collapseBtn = document.getElementById('gts-popup-collapse');
            document.getElementById('gts-popup-close').addEventListener('click', () => { popup.style.display = 'none'; });
            document.getElementById('gts-popup-back').addEventListener('click', () => { renderSearchResultsView(lastSearchResults); });
            collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); popup.classList.toggle('gts-collapsed'); if (popup.classList.contains('gts-collapsed')) { collapseBtn.innerHTML = ICONS.expand; collapseBtn.title = 'Expand'; } else { collapseBtn.innerHTML = ICONS.collapse; collapseBtn.title = 'Collapse'; }});
            document.getElementById('gts-popup-settings').addEventListener('click', manageApiKey);
            let pos1=0, pos2=0, pos3=0, pos4=0;
            header.onmousedown = (e) => { e.preventDefault(); pos3=e.clientX; pos4=e.clientY; document.onmouseup=() => {document.onmouseup=document.onmousemove=null;}; document.onmousemove=(ev) => {ev.preventDefault(); pos1=pos3-ev.clientX; pos2=pos4-ev.clientY; pos3=ev.clientX; pos4=ev.clientY; popup.style.top=(popup.offsetTop-pos2)+"px"; popup.style.left=(popup.offsetLeft-pos1)+"px";}; };
        }
        popup.style.display = 'flex';
        if (popup.classList.contains('gts-collapsed')) { popup.classList.remove('gts-collapsed'); document.getElementById('gts-popup-collapse').innerHTML = ICONS.collapse; document.getElementById('gts-popup-collapse').title = 'Collapse'; }
        return popup;
    }

    /** Generic renderer that updates the popup's UI, including the header permalink. */
    function renderView(title, contentHTML, showBackButton = false, permalink = null) {
        const popup = getOrCreatePopup();
        document.getElementById('gts-popup-title').innerText = title;
        document.getElementById('gts-popup-content').innerHTML = contentHTML;
        document.getElementById('gts-popup-back').style.display = showBackButton ? 'flex' : 'none';

        // Show/hide the header link
        const openLink = document.getElementById('gts-popup-open-link');
        if (permalink) {
            openLink.href = permalink;
            openLink.style.display = 'flex';
        } else {
            openLink.style.display = 'none';
        }
    }

    /** Renders the list of search results with "open" links for each. */
    function renderSearchResultsView(results) {
        let content = results.length > 0 ? '<ul class="gts-list">' + results.map((result, index) =>
            `<li data-result-index="${index}">
                <div class="gts-list-item-main" title="Click to view details">
                    Found in: <strong class="gts-search-name">${result.parentObjectName}</strong>
                    <small>
                        Modified: ${result.modifiedAt ? new Date(result.modifiedAt).toLocaleString() : 'N/A'} by <strong>${result.modifiedBy ? result.modifiedBy.name : 'N/A'}</strong>
                        <br>Type: ${result.objectType} | Text: ${result.text}
                    </small>
                </div>
                ${result.permalink ? `<a href="${result.permalink}" target="_blank" rel="noopener noreferrer" class="gts-result-link" title="Open in Smartsheet">${ICONS.openExternal}</a>` : ''}
            </li>`
        ).join('') + '</ul>' : '<div class="gts-message">No results found.</div>';

        renderView('Search Results', content);

        document.querySelectorAll('.gts-list-item-main').forEach(item => {
            item.addEventListener('click', e => getObjectDetails(lastSearchResults[e.currentTarget.parentElement.dataset.resultIndex]));
        });
    }

    /** Renders a detailed view of a row, passing the permalink to the renderer. */
    function renderRowDetailsView(rowData) {
        const columnMap = rowData.columns.reduce((map, col) => ({ ...map, [col.id]: col.title }), {});
        let content = '<h4>Row Details</h4><table class="gts-details-table">' + rowData.cells.filter(cell => columnMap[cell.columnId]).map(cell => `<tr><th>${columnMap[cell.columnId]}</th><td>${linkify(cell.displayValue || cell.value)}</td></tr>`).join('') + '</table>';
        if (rowData.attachments && rowData.attachments.length > 0) { content += '<div class="gts-section"><h5>Attachments</h5><ul class="gts-list">' + rowData.attachments.map(att => `<li><a href="${att.url}" target="_blank" rel="noopener noreferrer">${att.name}</a> <small>(${att.mimeType})</small></li>`).join('') + '</ul></div>'; }
        if (rowData.discussions && rowData.discussions.length > 0) { content += '<div class="gts-section"><h5>Discussions</h5>' + rowData.discussions.map(disc => `<h6>${disc.title}</h6>` + (disc.comments.map(comment => `<div class="gts-comment"><div class="gts-comment-header"><strong>${comment.createdBy.name}</strong> on ${new Date(comment.createdAt).toLocaleString()}</div><div>${linkify(comment.text)}</div></div>`).join(''))).join('') + '</div>'; }
        // Pass the permalink to the main render function
        renderView(`Row in ${rowData.sheetName}`, content, true, rowData.permalink);
    }

    /** Renders a detailed view of a discussion, passing the permalink. */
function renderDiscussionDetailsView(discussionData) {
        let content = `<h4 style="margin-top:0;">Discussion: ${discussionData.title}</h4>` + (discussionData.comments && discussionData.comments.length > 0 ? discussionData.comments.map(comment => `<div class="gts-comment"><div class="gts-comment-header"><strong>${comment.createdBy.name}</strong> on ${new Date(comment.createdAt).toLocaleString()}</div><div>${linkify(comment.text)}</div></div>`).join('') : '<div class="gts-message">No comments in this discussion.</div>');
        // Pass the permalink to the main render function
        renderView(`Discussion in ${discussionData.parentName}`, content, true, discussionData.permalink);
}

    async function manageApiKey() {
        const current = await GM_getValue('SMARTSHEET_API_KEY', '');
        const input = prompt('Enter your Smartsheet API Key (leave blank to clear):', current);
        if (input === null) return;
        if (input.trim()) {
            await GM_setValue('SMARTSHEET_API_KEY', input.trim());
            SMARTSHEET_API_KEY = input.trim();
            alert('API key saved!');
        } else {
            await GM_setValue('SMARTSHEET_API_KEY', '');
            SMARTSHEET_API_KEY = '';
            alert('API key cleared.');
        }
    }

    // --- The rest of the script is unchanged: prompt logic, event listeners, API calls etc. ---
    function createSearchPrompt() { if (document.getElementById('gts-prompt')) return; const p=document.createElement('div'); p.id='gts-prompt';p.className='gts-common';p.innerHTML=`<div id="gts-prompt-text">Search for: "<strong></strong>"</div><div id="gts-prompt-buttons"><button id="gts-prompt-no" class="gts-prompt-btn">Cancel</button><button id="gts-prompt-yes" class="gts-prompt-btn">Search</button></div>`;document.body.appendChild(p);document.getElementById('gts-prompt-no').addEventListener('click',hideSearchPrompt);document.getElementById('gts-prompt-yes').addEventListener('click',()=>{const q=p.dataset.searchText;hideSearchPrompt();if(q)searchSmartsheet(q);}); }
    function hideSearchPrompt() { const p=document.getElementById('gts-prompt'); if(p)p.style.display='none';}
    function showSearchPrompt(x,y,t){const p=document.getElementById('gts-prompt');if(!p)return;p.dataset.searchText=t;const d=t.length>30?t.substring(0,27)+'...':t;p.querySelector('#gts-prompt-text strong').textContent=d;p.style.left=`${x+15}px`;p.style.top=`${y+15}px`;p.style.display='block';}
    function searchSmartsheet(q){renderView(`Searching for "${q}"...`,'<div class="gts-message">Loading...</div>');const u=`${SMARTSHEET_API_BASE_URL}/search?query=${encodeURIComponent(q)}`;GM_xmlhttpRequest({method:'GET',url:u,headers:{'Authorization':`Bearer ${SMARTSHEET_API_KEY}`},onload:r=>{const d=JSON.parse(r.responseText),s=d.results||[];s.sort((a,b)=>(new Date(b.modifiedAt||0)-new Date(a.modifiedAt||0)));lastSearchResults=s;renderSearchResultsView(s);},onerror:e=>renderView('Error','<div class="gts-error">A network error occurred.</div>')});}
    function getObjectDetails(r){renderView(`Loading details...`,'<div class="gts-message">Loading details...</div>',true);const t=r.objectType.toUpperCase();let u='';if(t==='ROW'){u=`${SMARTSHEET_API_BASE_URL}/sheets/${r.parentObjectId}/rows/${r.objectId}?include=discussions,attachments,columns`;}else if(t==='DISCUSSION'){u=`${SMARTSHEET_API_BASE_URL}/sheets/${r.parentObjectId}/discussions/${r.objectId}?include=comments`;}else{renderView('Unsupported Type',`<div class="gts-error">Cannot get details for object type: ${r.objectType}</div>`,true);return;}GM_xmlhttpRequest({method:'GET',url:u,headers:{'Authorization':`Bearer ${SMARTSHEET_API_KEY}`},onload:s=>{if(s.status>=200&&s.status<300){try{if(!s.responseText.trim()){throw new Error("Response body is empty.");}const d=JSON.parse(s.responseText);if(t==='ROW')renderRowDetailsView(d);else if(t==='DISCUSSION')renderDiscussionDetailsView(d);}catch(e){renderView('Parsing Error',`<div class="gts-error">A valid response was received, but could not be processed.<br><strong>Error:</strong> ${e.message}<br><br><strong>Raw API Response Text:</strong><pre class="gts-raw-response">${s.responseText||'(empty)'}</pre></div>`,true);}}else{let m=`API Error: ${s.status} - ${s.statusText}`;try{const d=JSON.parse(s.responseText);m+=`<br><br><strong>Details:</strong> ${d.message}`;}catch(e){m+=`<br><br><strong>Raw Response:</strong><br><pre class="gts-raw-response">${s.responseText}</pre>`;}renderView('API Error',`<div class="gts-error">${m}</div>`,true);}},onerror:e=>renderView('Network Error','<div class="gts-error">A network error occurred while fetching details.</div>',true)});}
    createSearchPrompt();
    document.addEventListener('mouseup',e=>{if(e.target.closest('#gts-popup')||e.target.closest('#gts-prompt'))return;setTimeout(()=>{const s=window.getSelection();if(s.type==='Range'&&s.toString().trim().length>0){showSearchPrompt(e.clientX,e.clientY,s.toString().trim());}},50);});
document.addEventListener('click',e=>{const p=document.getElementById('gts-prompt');if(p.style.display==='block'&&!e.target.closest('#gts-prompt')){hideSearchPrompt();}});
    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const prompt = document.getElementById('gts-prompt');
        const popup = document.getElementById('gts-popup');
        if (e.key === 'Escape') {
            if (prompt && prompt.style.display === 'block') { hideSearchPrompt(); e.preventDefault(); }
            else if (popup && popup.style.display !== 'none') { popup.style.display = 'none'; e.preventDefault(); }
        } else if (e.key === 'Enter') {
            if (prompt && prompt.style.display === 'block') { document.getElementById('gts-prompt-yes').click(); e.preventDefault(); }
        }
    });
})();
