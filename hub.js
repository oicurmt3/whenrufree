'use strict';

const GROUP_AUTH_CACHE_PREFIX = 'wruf_group_auth_';
const CREATOR_AUTH_KEY = 'hub_creator_auth';

function qs(sel) { return document.querySelector(sel); }
function showToast(msg) {
  const t = qs('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function getGroupTokenFromUrl() {
  return new URL(window.location.href).searchParams.get('g');
}

function isCreateMode() {
  return new URL(window.location.href).searchParams.get('create') === '1';
}

function toPlainAscii(str) {
  return String(str ?? '')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ');
}

// -------------------------
// Hub Save Kit
// -------------------------

const hubSaveKit = {
  buildHubUrl(token) {
    const dir = window.location.href.replace(/[^/]*$/, '');
    return `${dir}hub.html?g=${encodeURIComponent(token)}`;
  },

  buildGoHubUrl(token) {
    const dir = window.location.href.replace(/[^/]*$/, '');
    return `${dir}go/?hub=${encodeURIComponent(token)}`;
  },

  sanitiseFilename(title) {
    const s = (title || 'Hub').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
    return (s || 'Hub').substring(0, 40);
  },

  formatDateForFile() {
    return new Date().toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  },

  buildHubDetailsText(meta) {
    const url = meta.url || this.buildHubUrl(meta.token);
    const goUrl = this.buildGoHubUrl(meta.token);
    const title = toPlainAscii(meta.title || 'Untitled Hub');
    return [
      'When RU Free - Hub details',
      `Created: ${this.formatDateForFile()}`,
      '',
      `Hub name:  ${title}`,
      `Hub link:  ${url}`,
      `Hub code:  ${meta.token}`,
      '',
      'Go page (enter code if you lose the full link):',
      goUrl,
      '',
      'INSTRUCTIONS',
      '- Share the Hub link with your group so they can pick a calendar.',
      '- Bookmark this link - it cannot be recovered if lost.',
      '- Your organiser PIN is NOT stored here. Remember it separately.',
      '- Each calendar inside the Hub has its own link and participant PINs.',
      '',
      window.location.origin
    ].join('\n');
  },

  downloadHubDetailsTxt(meta) {
    const content = this.buildHubDetailsText(meta);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WhenRUFree-Hub-${this.sanitiseFilename(meta.title)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  },

  async copyHubUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard');
      return true;
    } catch (e) {
      return false;
    }
  },

  async copyHubCode(token) {
    try {
      await navigator.clipboard.writeText(token);
      showToast('Hub code copied to clipboard');
      return true;
    } catch (e) {
      return false;
    }
  },

  buildEmailContent(meta) {
    const url = meta.url || this.buildHubUrl(meta.token);
    const goUrl = this.buildGoHubUrl(meta.token);
    const title = toPlainAscii(meta.title || 'Untitled Hub');
    const subject = `When RU Free Hub: ${title}`;
    const body = [
      'Save this Hub link for our group calendars:',
      '',
      url,
      '',
      `Hub code: ${meta.token}`,
      '',
      'If you lose the full link, enter the code on the Go page:',
      goUrl,
      '',
      'Remember your organiser PIN separately - it is not included here.',
      '',
      'Share this link with participants so they can pick a calendar.'
    ].join('\n');
    return { subject, body };
  },

  emailHubLink(meta) {
    const { subject, body } = this.buildEmailContent(meta);
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  },

  async shareHubLink(meta) {
    const url = meta.url || this.buildHubUrl(meta.token);
    const title = toPlainAscii(meta.title || 'Untitled Hub');
    const shareTitle = `${title} Calendar Hub`;
    const shareText = `Use this link to find out ${title} Calendar Hub: ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText
        });
        return;
      }
    } catch (e) { /* cancelled */ }
    const ok = await this.copyHubUrl(shareText);
    if (!ok) showToast('Share not available - use Copy link');
  },

  buildHubPosterHtml(meta, options = {}) {
    const { showToolbar = false } = options;
    const url = meta.url || this.buildHubUrl(meta.token);
    const title = toPlainAscii(meta.title || 'Untitled Hub');
    const token = meta.token || '';
    const siteUrl = 'https://whenrufree.net';
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const created = this.formatDateForFile();

    const toolbarHtml = showToolbar ? `
  <div class="toolbar no-print">
    <span class="toolbar-label">Hub poster</span>
    <div class="toolbar-actions">
      <button type="button" id="posterCopyCodeBtn" class="tb-btn">Copy code</button>
      <button type="button" id="posterCopyLinkBtn" class="tb-btn">Copy link</button>
      <button type="button" id="posterPrintBtn" class="tb-btn tb-btn-primary">Print</button>
    </div>
  </div>` : '';

    const onloadScript = showToolbar ? `<script>
(function(){
  var hubUrl=${JSON.stringify(url)};
  var hubCode=${JSON.stringify(token)};
  function copyText(t){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(function(){alert('Copied to clipboard');})
        .catch(function(){prompt('Copy this text:',t);});
    }else{prompt('Copy this text:',t);}
  }
  document.getElementById('posterCopyCodeBtn').onclick=function(){copyText(hubCode);};
  document.getElementById('posterCopyLinkBtn').onclick=function(){copyText(hubUrl);};
  document.getElementById('posterPrintBtn').onclick=function(){window.print();};
  window.focus();
})();
<\/script>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>When RU Free Hub - ${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    background:linear-gradient(145deg,#e8eaf6 0%,#f5f5f5 45%,#eceff1 100%);
    color:#333;min-height:100vh;padding:20px;
  }
  .page-wrap{
    max-width:760px;margin:0 auto;
    display:flex;flex-direction:column;gap:16px;
  }
  .toolbar{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;
    background:#fff;border:1px solid #c5cae9;border-radius:10px;
    padding:12px 16px;box-shadow:0 4px 16px rgba(63,81,181,0.1);
  }
  .toolbar-label{font-weight:700;color:#283593;font-size:0.95rem;}
  .toolbar-actions{display:flex;flex-wrap:wrap;gap:8px;}
  .tb-btn{
    padding:9px 14px;border:1px solid #ccc;background:#fff;
    border-radius:6px;font-weight:600;font-size:0.88rem;cursor:pointer;min-height:40px;
  }
  .tb-btn:hover{background:#f5f5f5;}
  .tb-btn-primary{background:#880000;color:#fff;border-color:#880000;}
  .tb-btn-primary:hover{background:#6d0000;}
  .poster{
    background:#fff;border-radius:16px;overflow:hidden;
    box-shadow:0 16px 48px rgba(0,0,0,0.14);
    border:1px solid rgba(63,81,181,0.15);
  }
  .brand-header{
    background:linear-gradient(135deg,#3f51b5 0%,#283593 100%);
    color:#fff;padding:32px 28px 28px;text-align:center;position:relative;
  }
  .brand-header::after{
    content:'';position:absolute;bottom:0;left:0;right:0;height:4px;
    background:linear-gradient(90deg,#880000,#c62828,#880000);
  }
  .brand-badge{
    display:inline-block;background:rgba(255,255,255,0.15);
    border:1px solid rgba(255,255,255,0.35);border-radius:999px;
    padding:6px 14px;font-size:0.75rem;font-weight:700;
    letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;
  }
  .brand-header .app-name{
    font-size:2.2rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;
  }
  .brand-header .tagline{font-size:1.05rem;opacity:0.94;font-weight:500;}
  .poster-body{padding:36px 32px 30px;text-align:center;}
  .hub-label{
    font-size:0.8rem;font-weight:700;text-transform:uppercase;
    letter-spacing:0.14em;color:#888;margin-bottom:8px;
  }
  .hub-name{
    font-size:1.75rem;font-weight:800;color:#222;
    margin-bottom:6px;line-height:1.25;
  }
  .hub-created{font-size:0.85rem;color:#888;margin-bottom:26px;}
  .code-block{
    background:linear-gradient(180deg,#fafafa 0%,#f0f0f0 100%);
    border:3px solid #3f51b5;border-radius:14px;
    padding:32px 24px 28px;margin:0 auto 26px;max-width:100%;
    box-shadow:0 8px 24px rgba(63,81,181,0.12),inset 0 1px 0 #fff;
  }
  .code-label{
    font-size:0.85rem;font-weight:700;text-transform:uppercase;
    letter-spacing:0.12em;color:#3f51b5;margin-bottom:14px;
  }
  .hub-code{
    font-family:Consolas,'Courier New',monospace;
    font-size:clamp(2.6rem,11vw,4.8rem);
    font-weight:800;letter-spacing:0.2em;
    color:#111;line-height:1.1;word-break:break-all;
  }
  .go-instruction{
    font-size:1.08rem;font-weight:600;color:#444;
    line-height:1.45;margin:0 auto 26px;max-width:520px;
  }
  .link-section{text-align:left;margin-top:4px;}
  .link-section p{
    font-size:0.92rem;color:#555;line-height:1.55;margin-bottom:10px;
  }
  .link-box{
    font-family:Consolas,'Courier New',monospace;
    font-size:0.84rem;background:#e8eaf6;
    border:1px solid #c5cae9;border-radius:8px;
    padding:14px 16px;word-break:break-all;color:#283593;
  }
  .promo{
    background:linear-gradient(135deg,#880000 0%,#6d0000 100%);
    color:#fff;padding:26px 32px;text-align:center;
  }
  .promo .site{
    font-size:1.45rem;font-weight:800;letter-spacing:0.02em;margin-bottom:8px;
  }
  .promo .pitch{font-size:0.98rem;opacity:0.96;line-height:1.45;}
  .promo .cta{
    font-size:0.84rem;margin-top:12px;opacity:0.88;
    padding-top:12px;border-top:1px solid rgba(255,255,255,0.25);
  }
  @media print{
    body{background:#fff;padding:0;}
    .no-print{display:none !important;}
    .page-wrap{max-width:none;gap:0;}
    .poster{box-shadow:none;border-radius:0;border:none;}
    .brand-header,.promo,.code-block{
      -webkit-print-color-adjust:exact;print-color-adjust:exact;
    }
  }
</style>
</head>
<body>
  <div class="page-wrap">
    ${toolbarHtml}
    <div class="poster">
      <div class="brand-header">
        <div class="brand-badge">whenrufree.net</div>
        <div class="app-name">When RU Free?</div>
        <div class="tagline">Group Calendar Hub</div>
      </div>
      <div class="poster-body">
        <div class="hub-label">Your Hub</div>
        <div class="hub-name">${esc(title)}</div>
        <div class="hub-created">Created ${esc(created)}</div>
        <div class="code-block">
          <div class="code-label">Hub code</div>
          <div class="hub-code">${esc(token)}</div>
        </div>
        <p class="go-instruction">Go to whenrufree.net/go and enter this Hub Code</p>
        <div class="link-section">
          <p><strong>Full link</strong> - share with your group:</p>
          <div class="link-box">${esc(url)}</div>
        </div>
      </div>
      <div class="promo">
        <div class="site">${esc(siteUrl)}</div>
        <div class="pitch">Find a time when everyone in your group is available.<br>Free shared calendars for clubs, teams, and events.</div>
        <div class="cta">Created with When RU Free - whenrufree.net</div>
      </div>
    </div>
  </div>
  ${onloadScript}
</body>
</html>`;
  },

  openHubPosterPopup(meta) {
    const html = this.buildHubPosterHtml(meta, { showToolbar: true });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, '_blank', 'noopener,noreferrer,width=920,height=900');
    if (!w) {
      URL.revokeObjectURL(blobUrl);
      showToast('Allow pop-ups to open poster');
      return;
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
};

// -------------------------
// CSRF + API
// -------------------------

let csrfToken = null;

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  try {
    const resp = await fetch('api.php?action=csrf_token', { credentials: 'same-origin' });
    const data = await resp.json();
    if (data?.status === 'success' && typeof data.csrf_token === 'string') {
      csrfToken = data.csrf_token;
    }
  } catch (e) {
    console.error('CSRF fetch failed', e);
  }
  return csrfToken;
}

async function apiGet(action, params = {}) {
  const url = new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), { credentials: 'same-origin' });
  return resp.json();
}

/** POST to a Hub action (?g=) with CSRF, plus the organiser session when withAuth. */
async function hubPost(action, body = {}, withAuth = false) {
  const url = new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('g', state.token);
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': (await ensureCsrfToken()) || ''
  };
  if (withAuth && state.auth?.token) headers['X-Group-Auth-Token'] = state.auth.token;
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  return resp.json();
}

// -------------------------
// Group auth cache
// -------------------------

function groupAuthCacheKey(token) {
  return GROUP_AUTH_CACHE_PREFIX + token;
}

function cacheGroupAuth(token, auth) {
  try {
    localStorage.setItem(groupAuthCacheKey(token), JSON.stringify({
      token: auth.auth_token,
      role: auth.role,
      organiser_name: auth.organiser_name,
      exp: Date.now() + 86400000
    }));
  } catch (e) { /* ignore */ }
}

function getCachedGroupAuth(token) {
  try {
    const raw = localStorage.getItem(groupAuthCacheKey(token));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.token || obj.exp < Date.now()) {
      localStorage.removeItem(groupAuthCacheKey(token));
      return null;
    }
    return obj;
  } catch (e) {
    return null;
  }
}

function clearCachedGroupAuth(token) {
  try { localStorage.removeItem(groupAuthCacheKey(token)); } catch (e) { /* ignore */ }
}

const state = {
  token: null,
  title: '',
  auth: null,
  calendars: [],
  passkeysEnabled: false, // Server has fingerprint / face unlock tables (group_meta.group.passkeys)
  platformPasskey: false  // This device has a built-in fingerprint / face / screen-lock authenticator
};

// -------------------------
// Save Hub Link Panel
// -------------------------

function showSaveHubPanel(meta) {
  const overlay = qs('#savePanelOverlay');
  const url = meta.url || hubSaveKit.buildHubUrl(meta.token);

  qs('#saveHubName').textContent = meta.title || 'Untitled Hub';
  qs('#saveHubCode').textContent = meta.token;
  qs('#saveHubUrl').textContent = url;

  const ack = qs('#saveAckCheckbox');
  const continueBtn = qs('#saveContinueBtn');
  ack.checked = false;
  continueBtn.disabled = true;

  qs('#clipboardFailMsg').classList.add('hideme');
  overlay.classList.remove('hideme');

  (async () => {
    const copied = await hubSaveKit.copyHubUrl(url);
    if (!copied) qs('#clipboardFailMsg').classList.remove('hideme');
    hubSaveKit.downloadHubDetailsTxt({ ...meta, url });
  })();

  const fullMeta = { ...meta, url };

  qs('#saveCopyBtn').onclick = () => hubSaveKit.copyHubUrl(url);
  qs('#saveDownloadBtn').onclick = () => {
    hubSaveKit.downloadHubDetailsTxt(fullMeta);
    showToast('Download started');
  };
  qs('#saveShareBtn').onclick = () => hubSaveKit.shareHubLink(fullMeta);
  qs('#saveEmailBtn').onclick = () => hubSaveKit.emailHubLink(fullMeta);
  qs('#savePosterBtn').onclick = () => hubSaveKit.openHubPosterPopup(fullMeta);

  ack.onchange = () => {
    continueBtn.disabled = !ack.checked;
  };

  continueBtn.onclick = () => {
    if (!ack.checked) return;
    overlay.classList.add('hideme');
    try {
      sessionStorage.setItem(CREATOR_AUTH_KEY, JSON.stringify({
        token: meta.token,
        organiser_pin: meta.organiser_pin || '',
        organiser_name: meta.organiser_name || ''
      }));
    } catch (e) { /* ignore */ }
    window.location.href = `hub.html?g=${encodeURIComponent(meta.token)}`;
  };
}

// -------------------------
// Create hub
// -------------------------

async function createHub() {
  const btn = qs('#createHubBtn');
  btn.disabled = true;
  try {
    const title = (qs('#hubTitle').value || '').trim().replace(/\s+/g, ' ');
    const organiserName = (qs('#organiserName').value || '').trim().replace(/\s+/g, ' ');
    const organiserPin = (qs('#organiserPin').value || '').trim();

    if (!organiserName || !/^\d{4}$/.test(organiserPin)) {
      alert('Please enter your name and a valid 4-digit PIN.');
      return;
    }

    const csrf = await ensureCsrfToken();
    const resp = await fetch('api.php?action=create_group', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf || ''
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        title: title || null,
        organiser_name: organiserName,
        organiser_pin: organiserPin
      })
    });
    const data = await resp.json();

    if (data.status !== 'success' || !data.token) {
      throw new Error(data.message || 'Create failed');
    }

    showSaveHubPanel({
      token: data.token,
      title: data.title || title || 'Untitled Hub',
      organiser_name: organiserName,
      organiser_pin: organiserPin
    });
  } catch (e) {
    alert('Failed to create Hub. Please try again.');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

// -------------------------
// Hub view
// -------------------------

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function renderCalendarGrid() {
  const grid = qs('#calGrid');
  const empty = qs('#emptyState');
  grid.innerHTML = '';

  if (!state.calendars.length) {
    empty.classList.remove('hideme');
    return;
  }

  empty.classList.add('hideme');

  for (const cal of state.calendars) {
    const card = document.createElement('div');
    card.className = 'cal-card' + (cal.is_frozen ? ' frozen' : '');

    const title = cal.title || 'Untitled calendar';
    const badge = cal.is_frozen
      ? '<span class="badge badge-frozen">Decided</span>'
      : '<span class="badge badge-open">Open</span>';

    card.innerHTML = `
      <div class="cal-card-main">
        <p class="cal-card-title">${escapeHtml(title)}${badge}</p>
      </div>
      <div class="btn-row cal-card-actions">
        <a href="calendar.html?c=${encodeURIComponent(cal.token)}&amp;g=${encodeURIComponent(state.token)}&amp;from_hub=1" class="btn btn-open" style="text-decoration:none;">Open</a>
        ${state.auth ? `<button type="button" class="btn btn-secondary btn-remove-cal" data-token="${escapeHtml(cal.token)}">Remove</button>` : ''}
      </div>
    `;

    grid.appendChild(card);
  }

  grid.querySelectorAll('.btn-remove-cal').forEach(btn => {
    btn.addEventListener('click', () => removeCalendarFromHub(btn.dataset.token, btn));
  });
}

function getHubMeta() {
  return {
    token: state.token,
    title: state.title,
    url: hubSaveKit.buildHubUrl(state.token)
  };
}

function updateHubPublicUI() {
  if (!state.token) return;

  const meta = getHubMeta();
  const linkBar = qs('#hubLinkBar');
  const publicPanel = qs('#hubPublicPanel');

  linkBar?.classList.remove('hideme');
  publicPanel?.classList.remove('hideme');

  const codeEl = qs('#hubCodeLarge');
  if (codeEl) codeEl.textContent = state.token;

  const urlText = qs('#hubLinkUrlText');
  if (urlText) urlText.textContent = meta.url;

  qs('#createCalInHubBtn').href = `index.html?g=${encodeURIComponent(state.token)}`;

  qs('#barCopyBtn').onclick = () => hubSaveKit.copyHubUrl(meta.url);
  qs('#barCopyCodeBtn').onclick = () => hubSaveKit.copyHubCode(state.token);
  qs('#hubCodeCopyIcon').onclick = () => hubSaveKit.copyHubCode(state.token);
  qs('#hubLinkCopyIcon').onclick = () => hubSaveKit.copyHubUrl(meta.url);
}

function updateOrganiserUI() {
  const loginBtn = qs('#organiserLoginBtn');
  const logoutBtn = qs('#organiserLogoutBtn');
  const badge = qs('#organiserBadge');
  const organiserBtns = document.querySelectorAll('.hub-action-organiser');

  if (state.auth) {
    loginBtn.classList.add('hideme');
    logoutBtn.classList.remove('hideme');
    badge.classList.remove('hideme');
    badge.textContent = state.auth.organiser_name || 'Organiser';
    organiserBtns.forEach(btn => btn.classList.remove('hideme'));

    const meta = getHubMeta();
    qs('#barShareBtn').onclick = () => hubSaveKit.shareHubLink(meta);
    qs('#barEmailBtn').onclick = () => hubSaveKit.emailHubLink(meta);
    qs('#barDownloadBtn').onclick = () => hubSaveKit.downloadHubDetailsTxt(meta);
  } else {
    loginBtn.classList.remove('hideme');
    logoutBtn.classList.add('hideme');
    badge.classList.add('hideme');
    organiserBtns.forEach(btn => btn.classList.add('hideme'));
  }

  const pkBtn = qs('#organiserPasskeyBtn');
  const pkOn = passkeysUsable() && !!Passkey.deviceCredential(passkeyId());
  const showPk = !!state.auth && passkeysUsable();
  pkBtn.classList.toggle('hideme', !showPk);
  pkBtn.classList.toggle('on', pkOn);
  pkBtn.title = pkOn ? 'Fingerprint / face unlock is on for this device - manage devices' : 'Fingerprint / face unlock';
  pkBtn.setAttribute('aria-label', pkBtn.title);
}

async function loadHubView() {
  const data = await apiGet('group_meta', { g: state.token });
  if (data.status !== 'success') {
    alert(data.message || 'Hub not found');
    window.location.href = 'index.html';
    return;
  }

  state.title = data.group?.title || 'Hub';
  state.calendars = data.calendars || [];
  state.passkeysEnabled = data.group?.passkeys === true;
  if (state.passkeysEnabled && window.Passkey && !state.platformPasskey) {
    state.platformPasskey = await Passkey.platformAvailable();
  }

  const displayTitle = state.title || 'Hub';
  qs('#hubTitleDisplay').innerHTML =
    `<span class="material-symbols-outlined">hub</span> ${escapeHtml(displayTitle)}`;

  document.title = `${displayTitle} – When RU Free Hub`;

  renderCalendarGrid();
  updateHubPublicUI();
  updateOrganiserUI();
}

async function authGroup(pin) {
  const url = new URL('api.php', window.location.href);
  url.searchParams.set('action', 'auth_group');
  url.searchParams.set('g', state.token);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': (await ensureCsrfToken()) || ''
    },
    credentials: 'same-origin',
    body: JSON.stringify({ pin })
  });
  return resp.json();
}

async function tryAutoAuthCreator() {
  try {
    const raw = sessionStorage.getItem(CREATOR_AUTH_KEY);
    if (!raw) return false;
    const c = JSON.parse(raw);
    if (c.token !== state.token || !c.organiser_pin) return false;
    sessionStorage.removeItem(CREATOR_AUTH_KEY);

    const authData = await authGroup(c.organiser_pin);
    if (authData.status === 'success' && authData.auth_token) {
      state.auth = {
        token: authData.auth_token,
        role: authData.role,
        organiser_name: authData.organiser_name || c.organiser_name
      };
      cacheGroupAuth(state.token, authData);
      return true;
    }
  } catch (e) {
    console.warn('Auto auth failed', e);
  }
  return false;
}

function showPinModal() {
  qs('#pinModal').classList.remove('hideme');
  qs('#pinInput').value = '';
  qs('#pinError').textContent = '';

  const hasPasskey = passkeysUsable() && !!Passkey.deviceCredential(passkeyId());
  qs('#pinPasskeyWrap').classList.toggle('hideme', !hasPasskey);
  if (hasPasskey) {
    // Go straight to the fingerprint / face prompt; the PIN field stays as the backup.
    unlockWithPasskey();
  } else {
    qs('#pinInput').focus();
  }
}

function hidePinModal() {
  qs('#pinModal').classList.add('hideme');
}

async function confirmPinLogin() {
  const pin = (qs('#pinInput').value || '').trim();
  if (!/^\d{4}$/.test(pin)) {
    qs('#pinError').textContent = 'Enter a 4-digit PIN';
    return;
  }

  const data = await authGroup(pin);
  if (data.status !== 'success') {
    qs('#pinError').textContent = data.message || 'Invalid PIN';
    return;
  }

  finishOrganiserLogin(data);
  maybeOfferPasskey();
}

/** Applies a successful organiser login (PIN or passkey). */
function finishOrganiserLogin(data) {
  state.auth = {
    token: data.auth_token,
    role: data.role,
    organiser_name: data.organiser_name
  };
  cacheGroupAuth(state.token, data);
  hidePinModal();
  updateOrganiserUI();
  renderCalendarGrid();
  showToast('Logged in as organiser');
}

// -------------------------
// Passkeys: fingerprint / face / device screen lock login (PIN stays as backup)
// -------------------------

function passkeyId() { return `hub_${state.token}`; }
function passkeysUsable() { return state.passkeysEnabled && !!window.Passkey && Passkey.supported(); }

async function unlockWithPasskey() {
  const btn = qs('#pinPasskeyBtn');
  const errEl = qs('#pinError');
  errEl.textContent = '';
  btn.disabled = true;
  try {
    const begin = await hubPost('passkey_login_begin');
    if (begin.status !== 'success') {
      if (begin.code === 'NO_PASSKEY') {
        Passkey.forgetDevice(passkeyId());
        qs('#pinPasskeyWrap').classList.add('hideme');
      }
      throw new Error(begin.message || 'Fingerprint unlock failed. Use your PIN.');
    }
    const credential = await Passkey.get(begin.publicKey);
    const data = await hubPost('passkey_login_finish', { credential });
    if (data.status !== 'success') {
      if (data.code === 'NO_PASSKEY') {
        Passkey.forgetDevice(passkeyId());
        qs('#pinPasskeyWrap').classList.add('hideme');
      }
      throw new Error(data.message || 'Fingerprint unlock failed. Use your PIN.');
    }
    Passkey.rememberDevice(passkeyId(), credential.rawId);
    finishOrganiserLogin(data);
  } catch (e) {
    if (Passkey.isCancel(e)) {
      qs('#pinInput').focus();
      return;
    }
    errEl.textContent = e.message || 'Fingerprint unlock failed. Use your PIN.';
  } finally {
    btn.disabled = false;
  }
}

/** After a PIN login, offers fingerprint / face unlock once per Hub on capable devices. */
async function maybeOfferPasskey() {
  if (!passkeysUsable() || !state.platformPasskey) return;
  const id = passkeyId();
  if (Passkey.deviceCredential(id) || Passkey.wasDismissed(id)) return;
  qs('#passkeyOfferError').textContent = '';
  qs('#passkeyOfferModal').classList.remove('hideme');
}

/** Registers this device for the logged-in organiser. Returns true when fingerprint unlock is on. */
async function enrolPasskey(errEl, btn) {
  if (!state.auth?.token) return false;
  const id = passkeyId();
  const fail = (msg) => { if (errEl) errEl.textContent = msg; else showToast(msg); };

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';
  try {
    const begin = await hubPost('passkey_register_begin', {}, true);
    if (begin.status !== 'success') {
      fail(begin.message || 'Could not turn on fingerprint unlock.');
      return false;
    }
    const credential = await Passkey.create(begin.publicKey);
    const res = await hubPost('passkey_register_finish', { credential, device_label: Passkey.deviceLabel() }, true);
    if (res.status !== 'success' && res.code !== 'PASSKEY_EXISTS') {
      fail(res.message || 'Could not turn on fingerprint unlock.');
      return false;
    }
    Passkey.rememberDevice(id, res.credential_id || credential.rawId);
    showToast('Fingerprint / face unlock is on');
    return true;
  } catch (e) {
    if (Passkey.isDuplicate(e)) {
      Passkey.rememberDevice(id, null);
      showToast('Fingerprint / face unlock is on');
      return true;
    }
    if (!Passkey.isCancel(e)) fail('Could not turn on fingerprint unlock.');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Lists the organiser's fingerprint / face unlock devices; any can be removed (e.g. a lost phone). */
async function openPasskeyManager() {
  if (!state.auth?.token) return;
  const id = passkeyId();
  const modal = qs('#passkeyManageModal');
  const listEl = qs('#passkeyList');
  const errEl = qs('#passkeyManageError');
  const addBtn = qs('#passkeyManageAdd');

  const render = (credentials) => {
    const mine = Passkey.syncDevice(id, credentials);
    Passkey.renderList(listEl, credentials, mine, removeDevice);
    addBtn.classList.toggle('hideme', !!mine);
    updateOrganiserUI();
  };

  const removeDevice = async (cred, btn) => {
    const isThis = cred.credential_id === Passkey.deviceCredential(id);
    const what = isThis ? 'this device' : (cred.device_label || 'this device');
    if (!confirm(`Remove fingerprint / face unlock from ${what}? The PIN still works.`)) return;
    btn.disabled = true;
    errEl.textContent = '';
    const res = await hubPost('passkey_remove', { credential_id: cred.credential_id }, true);
    if (res.status !== 'success') {
      btn.disabled = false;
      errEl.textContent = res.message || 'Could not remove this device.';
      return;
    }
    if (isThis) Passkey.forgetDevice(id);
    Passkey.signalRemoved(cred.credential_id);
    render(res.credentials);
    showToast('Device removed');
  };

  errEl.textContent = '';
  listEl.textContent = '';
  addBtn.classList.add('hideme');
  modal.classList.remove('hideme');
  addBtn.onclick = async () => {
    if (await enrolPasskey(errEl, addBtn)) {
      const again = await hubPost('passkey_list', {}, true);
      if (again.status === 'success') render(again.credentials);
    }
  };

  try {
    const res = await hubPost('passkey_list', {}, true);
    if (res.status !== 'success') {
      errEl.textContent = res.message || 'Could not load devices.';
      return;
    }
    render(res.credentials);
  } catch (e) {
    errEl.textContent = 'Could not load devices. Check your connection.';
  }
}

async function removeCalendarFromHub(calToken, btn) {
  if (!state.auth?.token) return;
  if (!confirm('Remove this calendar from the Hub? The calendar itself will still work at its own link.')) return;

  btn.disabled = true;
  try {
    const url = new URL('api.php', window.location.href);
    url.searchParams.set('action', 'remove_calendar_from_group');
    url.searchParams.set('c', calToken);

    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': (await ensureCsrfToken()) || '',
        'X-Group-Auth-Token': state.auth.token
      },
      credentials: 'same-origin',
      body: JSON.stringify({})
    });
    const result = await resp.json();

    if (result.status !== 'success') {
      alert(result.message || 'Failed to remove');
      return;
    }
    await loadHubView();
    showToast('Calendar removed from Hub');
  } finally {
    btn.disabled = false;
  }
}

function tryRestoreCachedAuth() {
  const cached = getCachedGroupAuth(state.token);
  if (cached) {
    state.auth = {
      token: cached.token,
      role: cached.role || 'admin',
      organiser_name: cached.organiser_name
    };
    return true;
  }
  return false;
}

async function initViewMode() {
  state.token = getGroupTokenFromUrl();
  if (!state.token || !/^[A-Za-z0-9_-]{8,64}$/.test(state.token)) {
    alert('Invalid Hub link');
    window.location.href = 'index.html';
    return;
  }

  qs('#viewSection').classList.remove('hideme');

  await loadHubView();

  const autoAuth = await tryAutoAuthCreator();
  if (!autoAuth) tryRestoreCachedAuth();

  updateHubPublicUI();
  updateOrganiserUI();
  renderCalendarGrid();

  qs('#organiserLoginBtn').addEventListener('click', showPinModal);
  qs('#organiserLogoutBtn').addEventListener('click', () => {
    state.auth = null;
    clearCachedGroupAuth(state.token);
    updateOrganiserUI();
    renderCalendarGrid();
    showToast('Logged out');
  });
  qs('#pinConfirmBtn').addEventListener('click', confirmPinLogin);
  qs('#pinCancelBtn').addEventListener('click', hidePinModal);
  qs('#pinPasskeyBtn').addEventListener('click', unlockWithPasskey);
  qs('#organiserPasskeyBtn').addEventListener('click', openPasskeyManager);
  qs('#passkeyManageClose').addEventListener('click', () => qs('#passkeyManageModal').classList.add('hideme'));
  qs('#passkeyOfferNo').addEventListener('click', () => {
    Passkey.dismiss(passkeyId());
    qs('#passkeyOfferModal').classList.add('hideme');
  });
  qs('#passkeyOfferYes').addEventListener('click', async () => {
    if (await enrolPasskey(qs('#passkeyOfferError'), qs('#passkeyOfferYes'))) {
      qs('#passkeyOfferModal').classList.add('hideme');
      updateOrganiserUI();
    }
  });
  qs('#pinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmPinLogin();
  });
}

function initCreateMode() {
  qs('#createSection').classList.remove('hideme');
  qs('#createHubBtn').addEventListener('click', createHub);
}

async function init() {
  if (isCreateMode()) {
    initCreateMode();
    return;
  }

  const token = getGroupTokenFromUrl();
  if (token) {
    await initViewMode();
    return;
  }

  window.location.href = 'hub.html?create=1';
}

document.addEventListener('DOMContentLoaded', init);
