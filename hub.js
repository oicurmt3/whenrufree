'use strict';

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

  /** "Emoji: ..." line when the Hub has an emoji, else ''. */
  emojiLine(meta) {
    return window.AccessEmoji ? AccessEmoji.shareLine(meta.access_emoji) : '';
  },

  /** Link for the clipboard, with the emoji on the next line when there is one. */
  buildCopyText(meta) {
    const url = meta.url || this.buildHubUrl(meta.token);
    const line = this.emojiLine(meta);
    return line ? `${url}\n${line}` : url;
  },

  buildHubDetailsText(meta) {
    const url = meta.url || this.buildHubUrl(meta.token);
    const goUrl = this.buildGoHubUrl(meta.token);
    const title = toPlainAscii(meta.title || 'Untitled Hub');
    const emojiLine = this.emojiLine(meta);
    return [
      'When RU Free - Hub details',
      `Created: ${this.formatDateForFile()}`,
      '',
      `Hub name:  ${title}`,
      `Hub link:  ${url}`,
      `Hub code:  ${meta.token}`,
      ...(emojiLine ? [emojiLine, '(Pick this emoji before the Hub opens.)'] : []),
      '',
      'Go page (enter code if you lose the full link):',
      goUrl,
      '',
      'INSTRUCTIONS',
      '- Share the Hub link with your group so they can pick a calendar.',
      '- Bookmark this link. While signed in, you can also find it on your profile page.',
      '- Everyone signs in (Google, Facebook or passkey) to open the Hub and its calendars.',
      '- Only the organiser account can manage the Hub.',
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
    const emojiLine = this.emojiLine(meta);
    const body = [
      'Save this Hub link for our group calendars:',
      '',
      url,
      '',
      `Hub code: ${meta.token}`,
      ...(emojiLine ? [emojiLine, '(Pick this emoji before the Hub opens.)'] : []),
      '',
      'If you lose the full link, enter the code on the Go page:',
      goUrl,
      '',
      'Sign in with the same account to manage the Hub.',
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
    const emojiLine = this.emojiLine(meta);
    const shareText = `Use this link to find out ${title} Calendar Hub: ${url}`
      + (emojiLine ? `\n${emojiLine}` : '');
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
    const hasEmoji = !!window.AccessEmoji && AccessEmoji.valid(meta.access_emoji);
    const emojiHtml = hasEmoji
      ? `<div class="emoji-block"><div class="code-label">Hub emoji</div><div class="emoji-glyph">${esc(AccessEmoji.glyph(meta.access_emoji))}</div><div class="emoji-name">${esc(AccessEmoji.name(meta.access_emoji))}</div><p class="emoji-note">Pick this emoji when the Hub asks for it.</p></div>`
      : '';

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
  var hubUrl=${JSON.stringify(this.buildCopyText(meta))};
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
  .emoji-block{border:2px dashed #9fa8da;border-radius:14px;padding:18px 16px;margin:0 auto 26px;background:#f5f6fc;}
  .emoji-block .code-label{font-size:1.05rem;}
  .emoji-glyph{font-size:6.5rem;line-height:1.1;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;}
  .emoji-name{font-size:1.8rem;font-weight:800;color:#222;margin-top:4px;}
  .emoji-note{font-size:1.15rem;font-weight:600;color:#444;margin-top:8px;}
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
  @page{margin:10mm;}
  @media print{
    body{background:#fff;padding:0;min-height:0;}
    .no-print{display:none !important;}
    .page-wrap{max-width:none;gap:0;}
    .poster{box-shadow:none;border-radius:0;border:none;break-inside:avoid;page-break-inside:avoid;}
    .brand-header,.promo,.code-block{
      -webkit-print-color-adjust:exact;print-color-adjust:exact;
    }
    .brand-header{padding:20px 24px 18px;}
    .brand-badge{margin-bottom:8px;}
    .poster-body{padding:22px 28px 18px;}
    .hub-created{margin-bottom:16px;}
    .code-block{padding:20px 20px 18px;margin-bottom:16px;}
    .hub-code{font-size:4.2rem;}
    .go-instruction{margin-bottom:16px;}
    .emoji-block{padding:12px 16px;margin-bottom:16px;}
    .emoji-glyph{font-size:5.5rem;}
    .promo{padding:16px 28px;}
    .promo .cta{margin-top:8px;padding-top:8px;}
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
        ${emojiHtml}
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

// -------------------------
// Access emoji: the Hub grant goes with every request; the emoji popup opens when asked
// -------------------------

let accessGatePromise = null;

/** Shows the emoji popup once, however many requests are waiting on it. */
function requireHubAccess() {
  if (!accessGatePromise) {
    accessGatePromise = AccessEmoji.gate({
      title: "Pick this Hub's emoji",
      hint: "Ask the organiser if you don't know it.",
      submit: async (emoji) => {
        const url = new URL('api.php', window.location.href);
        url.searchParams.set('action', 'access_check');
        url.searchParams.set('g', state.token);
        const resp = await fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': (await ensureCsrfToken()) || '' },
          credentials: 'same-origin',
          body: JSON.stringify({ emoji })
        });
        const data = await resp.json();
        if (data.status !== 'success') return { ok: false, message: data.message };
        if (data.access_grant) AccessEmoji.saveGrant(`g_${state.token}`, data.access_grant, data.expires_at);
        return { ok: true };
      }
    }).finally(() => { accessGatePromise = null; });
  }
  return accessGatePromise;
}

/**
 * fetch() with X-Access-Grant; after the emoji popup succeeds the request is sent again.
 * Signed-out / unfinished accounts get the sign-in panel instead (the promise then never settles).
 */
async function accessFetch(url, opts = {}) {
  for (let tries = 0; ; tries++) {
    const headers = { ...(opts.headers || {}) };
    const grants = (window.AccessEmoji && state.token) ? AccessEmoji.grantHeader([`g_${state.token}`]) : '';
    if (grants) headers['X-Access-Grant'] = grants;
    const resp = await fetch(url, { ...opts, headers });
    if (resp.status !== 401 && resp.status !== 403) return resp;
    let data = null;
    try { data = await resp.clone().json(); } catch (e) { data = null; }
    if (data && window.Account && Account.handleApiError(data)) return new Promise(() => {});
    if (resp.status !== 403 || tries >= 2 || !window.AccessEmoji || !state.token) return resp;
    if (!data || data.code !== 'ACCESS_REQUIRED') return resp;
    await requireHubAccess();
  }
}

async function apiGet(action, params = {}) {
  const url = new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await accessFetch(url.toString(), { credentials: 'same-origin' });
  return resp.json();
}

/** POST to a Hub action (?g=) with CSRF. Who you are comes from the account cookie.
 *  Extra query params (e.g. ?c= for a calendar) go through params. */
async function hubPost(action, body = {}, params = {}) {
  const url = new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('g', state.token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': (await ensureCsrfToken()) || ''
  };
  const resp = await accessFetch(url.toString(), {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  return resp.json();
}

const state = {
  token: null,
  title: '',
  auth: null,             // { organiser_name } when your account organises this Hub
  claimable: false,       // Old Hub with an organiser PIN that no account has claimed yet
  organiserName: '',
  calendars: [],
  accessAvailable: false, // Server has the access emoji tables (group_meta.group.access.available)
  addPolicyAvailable: false, // Server has migrations/017 (group_meta.group.add_policy_available)
  allowMemberCalendars: false, // Other people may add their calendars to this Hub
  allowAddsInForm: false, // Create form switch, before the Hub exists
  accessField: null,      // Create form emoji switch (AccessEmoji.field)
  hubEmoji: null          // The Hub's emoji position, loaded for the organiser
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

  const hasEmoji = !!window.AccessEmoji && AccessEmoji.valid(meta.access_emoji);
  qs('#saveHubEmojiWrap').classList.toggle('hideme', !hasEmoji);
  qs('#saveHubEmoji').textContent = hasEmoji ? AccessEmoji.glyph(meta.access_emoji) : '';
  qs('#saveHubEmojiName').textContent = hasEmoji ? AccessEmoji.name(meta.access_emoji) : '';

  const ack = qs('#saveAckCheckbox');
  const continueBtn = qs('#saveContinueBtn');
  ack.checked = false;
  continueBtn.disabled = true;

  qs('#clipboardFailMsg').classList.add('hideme');
  overlay.classList.remove('hideme');

  const fullMeta = { ...meta, url };
  const copyText = hubSaveKit.buildCopyText(fullMeta);

  (async () => {
    const copied = await hubSaveKit.copyHubUrl(copyText);
    if (!copied) qs('#clipboardFailMsg').classList.remove('hideme');
    hubSaveKit.downloadHubDetailsTxt(fullMeta);
  })();

  qs('#saveCopyBtn').onclick = () => hubSaveKit.copyHubUrl(copyText);
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
    if (organiserName && !/^[A-Za-z0-9][A-Za-z0-9'\- ]{0,31}$/.test(organiserName)) {
      alert("Organiser name: use letters, numbers, spaces, ' or - (up to 32).");
      return;
    }

    const accessEmoji = state.accessField ? state.accessField.value : null;
    const body = {
      title: title || null,
      organiser_name: organiserName
    };
    if (accessEmoji !== null) body.access_emoji = accessEmoji;
    // Off by default: only send when the organiser ticked it
    if (state.allowAddsInForm) body.allow_member_calendars = 1;

    const csrf = await ensureCsrfToken();
    const resp = await fetch('api.php?action=create_group', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf || ''
      },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (window.Account && Account.handleApiError(data)) return;

    if (data.status !== 'success' || !data.token) {
      alert(data.message || 'Failed to create Hub. Please try again.');
      return;
    }

    showSaveHubPanel({
      token: data.token,
      title: data.title || title || 'Untitled Hub',
      access_emoji: accessEmoji
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
    const isBooking = cal.slot_capacity !== null && cal.slot_capacity !== undefined;
    const badge = (cal.is_frozen
      ? `<span class="badge badge-frozen">${isBooking ? 'Closed' : 'Decided'}</span>`
      : '<span class="badge badge-open">Open</span>')
      + (isBooking ? '<span class="badge badge-booking">Booking</span>' : '');

    // The Hub organiser can remove any calendar; anyone else only the calendars they organise
    const canRemove = cal.can_remove === undefined ? !!state.auth : cal.can_remove === true;

    card.innerHTML = `
      <div class="cal-card-main">
        <p class="cal-card-title">${escapeHtml(title)}${badge}</p>
      </div>
      <div class="btn-row cal-card-actions">
        <a href="calendar.html?c=${encodeURIComponent(cal.token)}&amp;g=${encodeURIComponent(state.token)}&amp;from_hub=1" class="btn btn-open" style="text-decoration:none;">Open</a>
        ${canRemove ? `<button type="button" class="btn btn-secondary btn-remove-cal" data-token="${escapeHtml(cal.token)}">Remove</button>` : ''}
      </div>
    `;

    grid.appendChild(card);
  }

  grid.querySelectorAll('.btn-remove-cal').forEach(btn => {
    btn.addEventListener('click', () => removeCalendarFromHub(btn.dataset.token, btn));
  });
}

/** access_emoji is only known after an organiser login (access_settings). */
function getHubMeta() {
  return {
    token: state.token,
    title: state.title,
    url: hubSaveKit.buildHubUrl(state.token),
    access_emoji: state.auth ? state.hubEmoji : null
  };
}

/** Loads the Hub's emoji for the organiser's copy / share / email / download buttons. */
async function loadHubEmoji() {
  state.hubEmoji = null;
  if (!state.auth || !state.accessAvailable) return;
  try {
    const data = await apiGet('access_settings', { g: state.token });
    if (data.status === 'success' && window.AccessEmoji && AccessEmoji.valid(data.emoji)) {
      state.hubEmoji = data.emoji;
    }
  } catch (e) { /* buttons fall back to the link only */ }
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

  // Adds are organiser-only unless the organiser opened the Hub up. Gate both paths (add an
  // existing calendar, or create one inside the Hub) and swap the hint to match.
  const canAdd = !!state.auth || state.allowMemberCalendars;
  qs('#hubAddBtnRow')?.classList.toggle('hideme', !canAdd);
  const addHint = qs('#hubAddCalHint');
  if (addHint) {
    addHint.textContent = canAdd
      ? "Already have a calendar open? Add this Hub's code from its Hub settings."
      : 'Only the organiser adds calendars to this Hub.';
  }
  const emptyHint = qs('#emptyHint');
  if (emptyHint) {
    emptyHint.textContent = canAdd ? 'Create a new calendar below.' : 'Ask the organiser to add a calendar.';
  }

  qs('#barCopyBtn').onclick = () => hubSaveKit.copyHubUrl(hubSaveKit.buildCopyText(getHubMeta()));
  qs('#barCopyCodeBtn').onclick = () => hubSaveKit.copyHubCode(state.token);
  qs('#hubCodeCopyIcon').onclick = () => hubSaveKit.copyHubCode(state.token);
  qs('#hubLinkCopyIcon').onclick = () => hubSaveKit.copyHubUrl(meta.url);
}

function updateOrganiserUI() {
  const badge = qs('#organiserBadge');
  const organiserBtns = document.querySelectorAll('.hub-action-organiser');

  qs('#claimHubBtn').classList.toggle('hideme', !!state.auth || !state.claimable);
  badge.classList.toggle('hideme', !state.organiserName);
  badge.textContent = state.auth ? `Organiser: ${state.organiserName} (you)` : `Organiser: ${state.organiserName}`;

  if (state.auth) {
    organiserBtns.forEach(btn => btn.classList.remove('hideme'));

    qs('#barShareBtn').onclick = () => hubSaveKit.shareHubLink(getHubMeta());
    qs('#barEmailBtn').onclick = () => hubSaveKit.emailHubLink(getHubMeta());
    qs('#barPosterBtn').onclick = () => hubSaveKit.openHubPosterPopup(getHubMeta());
    qs('#barDownloadBtn').onclick = () => hubSaveKit.downloadHubDetailsTxt(getHubMeta());
  } else {
    organiserBtns.forEach(btn => btn.classList.add('hideme'));
  }

  const showSettings = !!state.auth
    && (state.addPolicyAvailable || (state.accessAvailable && !!window.AccessEmoji));
  qs('#organiserSettingsBtn').classList.toggle('hideme', !showSettings);
}

// -------------------------
// Hub settings (organiser): who can add calendars, and the access emoji
// -------------------------

/** Switch controlling whether people other than the organiser may add their calendars. */
function renderAddPolicySwitch(container) {
  container.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'hub-switch-row';
  const label = document.createElement('span');
  label.className = 'hub-switch-label';
  label.id = 'settingsAddPolicyLabel';
  label.textContent = 'Let other people add their own calendars';
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'hub-switch';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-labelledby', label.id);
  row.append(label, sw);

  const hint = document.createElement('p');
  hint.className = 'ae-note';

  container.append(row, hint);

  const paint = () => {
    const on = state.allowMemberCalendars;
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.setAttribute('aria-label', on ? 'Other people can add calendars: on' : 'Other people can add calendars: off');
    hint.textContent = on
      ? 'On: anyone signed in with the Hub link can add their calendars or create one here.'
      : 'Off: only you can add calendars to this Hub.';
  };

  sw.onclick = async () => {
    const next = !state.allowMemberCalendars;
    if (next && !confirm('Let other people add their own calendars to this Hub?')) return;
    sw.disabled = true;
    try {
      const res = await hubPost('set_group_add_policy', { allow: next ? 1 : 0 });
      if (res.status !== 'success') {
        showToast(res.message || 'Could not save this setting.');
        return;
      }
      state.allowMemberCalendars = res.allow_member_calendars === true || next;
      paint();
      updateHubPublicUI();
      showToast(next ? 'Other people can now add calendars' : 'Only you can add calendars now');
    } finally {
      sw.disabled = false;
    }
  };

  paint();
}

async function openHubSettings() {
  if (!state.auth) return;
  const modal = qs('#settingsModal');
  const policyEl = qs('#settingsAddPolicy');
  const fieldEl = qs('#settingsAccessField');
  const errEl = qs('#settingsError');
  errEl.textContent = '';
  policyEl.innerHTML = '';
  fieldEl.innerHTML = '';
  modal.classList.remove('hideme');

  if (state.addPolicyAvailable) renderAddPolicySwitch(policyEl);

  if (!state.accessAvailable || !window.AccessEmoji) {
    if (!state.addPolicyAvailable) {
      fieldEl.innerHTML = '<p class="ae-note">Settings are not available yet.</p>';
    }
    return;
  }

  fieldEl.innerHTML = '<p class="ae-note">Loading...</p>';
  const data = await apiGet('access_settings', { g: state.token });
  if (data.status !== 'success' || !data.available) {
    fieldEl.innerHTML = '';
    errEl.textContent = data.message || 'Settings are not available yet.';
    return;
  }

  let saved = AccessEmoji.valid(data.emoji) ? data.emoji : null;
  AccessEmoji.field(fieldEl, {
    label: 'Access emoji',
    pickerTitle: 'Choose Hub emoji',
    pickerHint: 'Use this emoji to access the Hub.',
    offHint: 'Optional emoji for Hub access',
    onHint: 'Use this emoji to access the Hub.',
    value: saved,
    onChange: async (next) => {
      errEl.textContent = '';
      if (next === null) {
        if (!confirm('Remove the emoji? Anyone with the Hub link will be able to open this Hub.')) return false;
      } else if (saved !== null && !confirm('Change the emoji? Everyone will need to pick the new one.')) {
        return false;
      }
      const res = await hubPost('set_group_access_emoji', { emoji: next });
      if (res.status !== 'success') {
        errEl.textContent = res.message || 'Could not save the emoji.';
        return false;
      }
      if (res.access_grant) AccessEmoji.saveGrant(`g_${state.token}`, res.access_grant, res.expires_at);
      saved = next;
      state.hubEmoji = next;
      showToast(next === null ? 'Emoji removed' : `Emoji set: ${AccessEmoji.name(next)}`);
      return true;
    }
  });
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
  state.accessAvailable = data.group?.access?.available === true;
  state.addPolicyAvailable = data.group?.add_policy_available === true;
  state.allowMemberCalendars = data.group?.allow_member_calendars === true;
  state.organiserName = data.group?.organiser_name || '';
  state.auth = data.group?.is_organiser === true ? { organiser_name: state.organiserName } : null;
  state.claimable = data.group?.claimable === true;

  const displayTitle = state.title || 'Hub';
  qs('#hubTitleDisplay').innerHTML =
    `<span class="material-symbols-outlined">hub</span> ${escapeHtml(displayTitle)}`;

  document.title = `${displayTitle} \u2013 When RU Free Hub`;

  renderCalendarGrid();
  updateHubPublicUI();
  updateOrganiserUI();
}

// -------------------------
// Claim an old Hub (created before sign-in accounts) with its organiser PIN, once
// -------------------------

function showPinModal() {
  qs('#pinModal').classList.remove('hideme');
  qs('#pinInput').value = '';
  setPinVisible(false);
  qs('#pinError').textContent = '';
  qs('#pinInput').focus();
}

function hidePinModal() {
  qs('#pinModal').classList.add('hideme');
}

function setPinVisible(show) {
  const btn = qs('#togglePinVisibility');
  qs('#pinInput').type = show ? 'text' : 'password';
  btn.querySelector('.material-symbols-outlined').textContent = show ? 'visibility_off' : 'visibility';
  btn.setAttribute('aria-label', show ? 'Hide PIN' : 'Show PIN');
}

async function confirmClaimHub() {
  const pin = (qs('#pinInput').value || '').trim();
  if (!/^\d{4}$/.test(pin)) {
    qs('#pinError').textContent = 'Enter a 4-digit PIN';
    return;
  }
  const btn = qs('#pinConfirmBtn');
  btn.disabled = true;
  try {
    const data = await hubPost('claim_hub', { pin });
    if (data.status !== 'success') {
      qs('#pinError').textContent = data.message || 'Could not claim this Hub.';
      return;
    }
    hidePinModal();
    await loadHubView();
    loadHubEmoji();
    showToast('Hub claimed - it now belongs to your account');
  } catch (e) {
    qs('#pinError').textContent = 'Could not claim this Hub. Try again.';
  } finally {
    btn.disabled = false;
  }
}

async function removeCalendarFromHub(calToken, btn) {
  // The server decides: the Hub organiser, or the organiser of that calendar
  if (!confirm('Remove this calendar from the Hub? The calendar itself will still work at its own link.')) return;

  btn.disabled = true;
  try {
    const url = new URL('api.php', window.location.href);
    url.searchParams.set('action', 'remove_calendar_from_group');
    url.searchParams.set('c', calToken);

    const resp = await accessFetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': (await ensureCsrfToken()) || ''
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

/** "12 Oct 2026" from a YYYY-MM-DD column. */
function formatCalDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One-time list row for the picker: a calendar you organise that is not in a Hub yet.
 * The whole row is the button, so it is a big, obvious tap target.
 */
function addCalRow(cal) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-cal-item';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'calendar_month';

  const text = document.createElement('span');
  text.className = 'add-cal-text';
  const name = document.createElement('span');
  name.className = 'add-cal-title';
  name.textContent = cal.title || 'Untitled calendar';
  const sub = document.createElement('span');
  sub.className = 'add-cal-sub';
  const from = formatCalDay(cal.start_date);
  const to = formatCalDay(cal.end_date);
  sub.textContent = from && to ? `${from} - ${to}` : 'No dates set';
  text.appendChild(name);
  text.appendChild(sub);

  btn.appendChild(icon);
  btn.appendChild(text);
  btn.addEventListener('click', () => addCalendarToHub(cal, btn));
  li.appendChild(btn);
  return li;
}

/** Opens the picker with the calendars this account organises and has not put in a Hub. */
async function openAddCalModal() {
  const modal = qs('#addCalModal');
  const list = qs('#addCalList');
  const errEl = qs('#addCalError');
  if (!modal || !list) return;
  // Organiser-only until the Hub opens adds up
  if (!state.auth && !state.allowMemberCalendars) return;

  errEl.textContent = '';
  list.textContent = '';
  const loading = document.createElement('li');
  loading.className = 'add-cal-empty';
  loading.textContent = 'Loading your calendars...';
  list.appendChild(loading);
  modal.classList.remove('hideme');

  let data;
  try {
    data = await apiGet('account_memberships');
  } catch (e) {
    list.textContent = '';
    errEl.textContent = 'Could not load your calendars.';
    return;
  }
  list.textContent = '';
  if (data.status !== 'success') {
    errEl.textContent = data.message || 'Could not load your calendars.';
    return;
  }

  // You can only add a calendar you organise, and only if it is not already in a Hub
  const mine = (data.calendars || []).filter(c => c.role === 'admin' && !c.hub);
  if (!mine.length) {
    const li = document.createElement('li');
    li.className = 'add-cal-empty';
    li.textContent = 'You have no calendars free to add. A calendar can be in one Hub at a time. ';
    const make = document.createElement('a');
    make.href = `index.html?g=${encodeURIComponent(state.token)}`;
    make.textContent = 'Create a new calendar.';
    li.appendChild(make);
    list.appendChild(li);
    return;
  }
  mine.forEach(cal => list.appendChild(addCalRow(cal)));
}

/** Adds one calendar to this Hub, then reloads the Hub so the card appears. */
async function addCalendarToHub(cal, btn) {
  const errEl = qs('#addCalError');
  const title = cal.title || 'Untitled calendar';
  errEl.textContent = '';
  btn.disabled = true;
  try {
    const res = await hubPost('add_calendar_to_group', { group_token: state.token }, { c: cal.token });
    if (res.status !== 'success') {
      errEl.textContent = res.message || 'Could not add that calendar.';
      return;
    }
    qs('#addCalModal').classList.add('hideme');
    await loadHubView();
    showToast(`"${title}" added to this Hub`);
  } catch (e) {
    errEl.textContent = 'Could not add that calendar.';
  } finally {
    btn.disabled = false;
  }
}

async function initViewMode() {
  state.token = getGroupTokenFromUrl();
  if (!state.token || !/^[A-Za-z0-9_-]{8,64}$/.test(state.token)) {
    alert('Invalid Hub link');
    window.location.href = 'index.html';
    return;
  }

  const me = await Account.require();
  Account.renderBadge(me, qs('#accountBadge'));
  qs('#viewSection').classList.remove('hideme');

  await loadHubView();
  loadHubEmoji();

  qs('#claimHubBtn').addEventListener('click', showPinModal);
  qs('#pinConfirmBtn').addEventListener('click', confirmClaimHub);
  qs('#pinCancelBtn').addEventListener('click', hidePinModal);
  qs('#togglePinVisibility').addEventListener('click', () => setPinVisible(qs('#pinInput').type === 'password'));
  qs('#organiserSettingsBtn').addEventListener('click', openHubSettings);
  qs('#addCalToHubBtn').addEventListener('click', openAddCalModal);
  qs('#addCalCancel').addEventListener('click', () => qs('#addCalModal').classList.add('hideme'));
  qs('#addCalModal').addEventListener('click', (e) => {
    if (e.target === qs('#addCalModal')) qs('#addCalModal').classList.add('hideme');
  });
  qs('#settingsClose').addEventListener('click', () => qs('#settingsModal').classList.add('hideme'));
  qs('#pinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmClaimHub();
  });
}

async function initCreateMode() {
  const me = await Account.require();
  qs('#createSection').classList.remove('hideme');
  if (me.display_name) qs('#organiserName').placeholder = me.display_name;
  qs('#createHubBtn').addEventListener('click', createHub);
  initCreateFeatures();
}

/** Shows the optional create-form switches once the server supports them. */
async function initCreateFeatures() {
  let features = {};
  try {
    const resp = await fetch('api.php?action=get_site_config', { credentials: 'same-origin' });
    const data = await resp.json();
    features = data?.features || {};
  } catch (e) {
    return;
  }
  initCreateAddPolicy(features);
  initCreateAccessField(features);
}

/** "Let other people add their own calendars" switch. Off by default. */
function initCreateAddPolicy(features) {
  if (features.hub_add_policy !== true) return;
  const wrap = qs('#hubAllowAddsWrap');
  const sw = qs('#hubAllowAdds');
  const hint = qs('#hubAllowAddsHint');
  const paint = () => {
    const on = state.allowAddsInForm;
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    hint.textContent = on
      ? 'On: anyone signed in with the Hub link can add their calendars or create one here.'
      : 'Off: only you can add calendars to this Hub. A calendar can be in one Hub at a time.';
  };
  sw.onclick = () => {
    state.allowAddsInForm = !state.allowAddsInForm;
    paint();
  };
  wrap.classList.remove('hideme');
  paint();
}

/** Shows the optional emoji switch once the server supports it. */
function initCreateAccessField(features) {
  if (!window.AccessEmoji || features.access_emoji !== true) return;
  state.accessField = AccessEmoji.field(qs('#hubAccessField'), {
    label: 'Access emoji',
    pickerTitle: 'Choose Hub emoji',
    pickerHint: 'Use this emoji to access the Hub.',
    offHint: 'Optional emoji for Hub access',
    onHint: 'Use this emoji to access the Hub.'
  });
  qs('#hubAccessWrap').classList.remove('hideme');
}

async function init() {
  if (isCreateMode()) {
    await initCreateMode();
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
