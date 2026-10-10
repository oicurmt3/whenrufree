'use strict';

/************** CATEGORY TOGGLE UI **************/
const catGrid = document.getElementById('catGrid');
const catCount = document.getElementById('catCount');
const CAT_MAX = 3;

/**
 * Returns an array of currently selected category values.
 * @returns {string[]}
 */
function getSelectedCategories(){
  return Array.from(catGrid.querySelectorAll('.cat-tog.active')).map(b => b.dataset.value);
}

/**
 * Updates the counter text and disabled state on unselected buttons.
 */
function updateCatUI(){
  const selected = getSelectedCategories();
  const atMax = selected.length >= CAT_MAX;
  catCount.textContent = selected.length > 0 ? `(${selected.length}/${CAT_MAX})` : '';
  catGrid.querySelectorAll('.cat-tog').forEach(btn => {
    if(!btn.classList.contains('active')){
      btn.disabled = atMax;
    }
  });
}

// Toggle handler for category buttons
catGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-tog');
  if(!btn || btn.disabled) return;
  btn.classList.toggle('active');
  updateCatUI();
});

// CSRF token cached for this browser session (fetched from api.php?action=csrf_token)
let csrfToken = null;

/** Hub context when creating calendar inside a Hub (?g=TOKEN) */
let hubContext = { token: null, title: null, accessEnabled: false, inviteOnly: false };

function getHubTokenFromUrl() {
  return new URL(window.location.href).searchParams.get('g');
}

/************** ACCESS EMOJI **************/
let accessField = null;       // Organiser "Access emoji" switch (AccessEmoji.field)
let accessGatePromise = null;

/** Hub emoji popup (creating a calendar inside a Hub that has an emoji). */
function requireHubAccess() {
  if (!accessGatePromise) {
    accessGatePromise = AccessEmoji.gate({
      title: "Pick this Hub's emoji",
      hint: "Ask the Hub organiser if you don't know it.",
      submit: async (emoji) => {
        const csrf = await ensureCsrfToken();
        const resp = await fetch(`api.php?action=access_check&g=${encodeURIComponent(hubContext.token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
          body: JSON.stringify({ emoji })
        });
        const data = await resp.json();
        if (data.status !== 'success') return { ok: false, message: data.message };
        if (data.access_grant) AccessEmoji.saveGrant(`g_${hubContext.token}`, data.access_grant, data.expires_at);
        return { ok: true };
      }
    }).finally(() => { accessGatePromise = null; });
  }
  return accessGatePromise;
}

/** fetch() with the Hub's X-Access-Grant; after the emoji popup succeeds the request is sent again. */
async function accessFetch(url, opts = {}) {
  for (let tries = 0; ; tries++) {
    const headers = { ...(opts.headers || {}) };
    const grants = (window.AccessEmoji && hubContext.token) ? AccessEmoji.grantHeader([`g_${hubContext.token}`]) : '';
    if (grants) headers['X-Access-Grant'] = grants;
    const resp = await fetch(url, { ...opts, headers });
    if (resp.status !== 401 && resp.status !== 403) return resp;
    let data = null;
    try { data = await resp.clone().json(); } catch (e) { data = null; }
    if (data && window.Account && Account.handleApiError(data)) return new Promise(() => {});
    if (resp.status !== 403 || tries >= 2 || !window.AccessEmoji || !hubContext.token) return resp;
    if (!data || data.code !== 'ACCESS_REQUIRED') return resp;
    await requireHubAccess();
  }
}

/** Shows the organiser's emoji switch (above Privacy Mode) once the server supports it. */
function initAccessField(features) {
  if (!window.AccessEmoji || !features || features.access_emoji !== true || accessField) return;
  accessField = AccessEmoji.field(document.getElementById('accessEmojiField'), {
    label: 'Access emoji',
    pickerTitle: 'Choose calendar emoji',
    pickerHint: 'Use this emoji to access the calendar.',
    offHint: 'Optional emoji access security.',
    onHint: 'Use this emoji to access the calendar.'
  });
  updateAccessOffHint();
  document.getElementById('accessEmojiWrap').classList.remove('hideme');
}

function updateAccessOffHint() {
  if (!accessField) return;
  accessField.setOffHint(hubContext.accessEnabled
    ? "Uses the Hub's emoji. Switch on to give this calendar its own."
    : 'Optional emoji access security.');
  accessField.setOnHint(isInviteOnly()
    ? 'Asked before people request access.'
    : 'Use this emoji to access the calendar.');
}

/************** WHO CAN JOIN **************/
// Direct link (default) or Invite only (people request access, the organiser approves).
// Chosen at creation only. Inside an Invite only Hub the calendar is always Invite only.
let inviteSupported = false;
let joinMode = 'link';

const JOIN_MODE_HINTS = {
  link: 'Anyone with the link can join.',
  invite: "People with the link tap Request access and you approve each one. This can't be changed later."
};

function isInviteOnly() {
  return hubContext.inviteOnly || (inviteSupported && joinMode === 'invite');
}

function renderJoinMode() {
  const field = document.getElementById('joinModeField');
  document.getElementById('joinModeHubNote').classList.toggle('hideme', !hubContext.inviteOnly);
  field.classList.toggle('hideme', !inviteSupported || hubContext.inviteOnly);
  document.querySelectorAll('#joinModeToggle .priv-btn').forEach(b => {
    const on = b.dataset.join === joinMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.getElementById('joinModeHint').textContent = JOIN_MODE_HINTS[joinMode];
  updateAccessOffHint();
}

/** Shows Who can join and Hide names too once the server supports them (migrations/009). */
function initJoinModeField(features) {
  if (!features || features.invite_only !== true) return;
  inviteSupported = true;
  renderJoinMode();
  updateHideNamesRow();
}

document.getElementById('joinModeToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.priv-btn');
  if (!btn || btn.dataset.join === joinMode) return;
  joinMode = btn.dataset.join === 'invite' ? 'invite' : 'link';
  renderJoinMode();
});

async function initHubContext() {
  const g = getHubTokenFromUrl();
  if (!g || !/^[A-Za-z0-9_-]{8,64}$/.test(g)) return;

  hubContext.token = g;
  const banner = document.getElementById('hubContextBanner');
  const titleEl = document.getElementById('hubContextTitle');
  if (!banner) return;

  try {
    const resp = await accessFetch(`api.php?action=group_meta&g=${encodeURIComponent(g)}`);
    const data = await resp.json();
    if (data.status === 'success' && data.group) {
      hubContext.title = data.group.title || 'Untitled Hub';
      hubContext.accessEnabled = data.group.access?.enabled === true;
      hubContext.inviteOnly = data.group.invite_only === true;
      renderJoinMode();
      titleEl.textContent = hubContext.title;
      banner.classList.remove('hideme');
    }
  } catch (e) {
    console.warn('Hub meta failed', e);
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
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
// Calendar Save Kit
// -------------------------

const calendarSaveKit = {
  buildCalendarUrl(token) {
    const dir = window.location.href.replace(/[^/]*$/, '');
    return `${dir}calendar.html?c=${encodeURIComponent(token)}`;
  },

  buildGoCalendarUrl(token) {
    const dir = window.location.href.replace(/[^/]*$/, '');
    return `${dir}go/?c=${encodeURIComponent(token)}`;
  },

  sanitiseFilename(title) {
    const s = (title || 'Calendar').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-');
    return (s || 'Calendar').substring(0, 40);
  },

  formatDateForFile() {
    return new Date().toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  },

  /** "Emoji: ..." line when the calendar has its own emoji or uses its Hub's, else ''. */
  emojiLine(meta) {
    return window.AccessEmoji ? AccessEmoji.shareLine(meta.access_emoji, meta.access_hub === true) : '';
  },

  /** Link for the clipboard, with the emoji on the next line when there is one. */
  buildCopyText(meta) {
    const url = meta.url || this.buildCalendarUrl(meta.token);
    const line = this.emojiLine(meta);
    return line ? `${url}\n${line}` : url;
  },

  buildCalendarDetailsText(meta) {
    const url = meta.url || this.buildCalendarUrl(meta.token);
    const goUrl = this.buildGoCalendarUrl(meta.token);
    const title = toPlainAscii(meta.title || 'When RU Free');
    const emojiLine = this.emojiLine(meta);
    const lines = [
      'When RU Free - Calendar details',
      `Created: ${this.formatDateForFile()}`,
      '',
      `Calendar title:  ${title}`,
      `Calendar link:   ${url}`,
      `Calendar code:   ${meta.token}`,
      ...(emojiLine ? [emojiLine, '(Pick this emoji before the calendar opens.)'] : []),
      ''
    ];
    if (meta.hub_title) {
      lines.push(`Part of Hub:       ${toPlainAscii(meta.hub_title)}`);
      lines.push('');
    }
    lines.push(
      'Go page (enter code if you lose the full link):',
      goUrl,
      '',
      'INSTRUCTIONS',
      meta.booking
        ? '- Share the calendar link with participants so they can sign in, join and book a slot.'
        : '- Share the calendar link with participants so they can sign in, join and mark availability.',
      '- Bookmark this link. While signed in, you can also find it on your profile page.',
      emojiLine
        ? '- People need to sign in, have the link and pick the emoji to open this calendar.'
        : '- Anyone who signs in with the link can view and join this calendar.',
      ...(meta.invite_only ? ['- Invite only: people request access and the organiser approves them.'] : []),
      '',
      window.location.origin
    );
    return lines.join('\n');
  },

  downloadCalendarDetailsTxt(meta) {
    const content = this.buildCalendarDetailsText(meta);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WhenRUFree-Calendar-${this.sanitiseFilename(meta.title)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  },

  async copyCalendarUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard');
      return true;
    } catch (e) {
      return false;
    }
  },

  buildEmailContent(meta) {
    const url = meta.url || this.buildCalendarUrl(meta.token);
    const goUrl = this.buildGoCalendarUrl(meta.token);
    const title = toPlainAscii(meta.title || 'When RU Free');
    const subject = `When RU Free: ${title}`;
    const emojiLine = this.emojiLine(meta);
    const body = [
      meta.booking
        ? 'Save this calendar link for our booking calendar:'
        : 'Save this calendar link for our group availability poll:',
      '',
      url,
      '',
      `Calendar code: ${meta.token}`,
      ...(emojiLine ? [emojiLine, '(Pick this emoji before the calendar opens.)'] : []),
      '',
      'If you lose the full link, enter the code on the Go page:',
      goUrl,
      '',
      'Sign in with the same account to manage the calendar.',
      '',
      meta.booking
        ? 'Share this link with participants so they can book a slot.'
        : 'Share this link with participants so they can mark their availability.'
    ];
    return { subject, body };
  },

  emailCalendarLink(meta) {
    const { subject, body } = this.buildEmailContent(meta);
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  },

  async shareCalendarLink(meta) {
    const url = meta.url || this.buildCalendarUrl(meta.token);
    const title = toPlainAscii(meta.title || 'When RU Free');
    const shareTitle = `${title} - When RU Free`;
    const emojiLine = this.emojiLine(meta);
    const shareText = (meta.booking
      ? `Use this link to book a slot for ${title}: ${url}`
      : `Use this link to mark your availability for ${title}: ${url}`)
      + (emojiLine ? `\n${emojiLine}` : '');
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText });
        return;
      }
    } catch (e) { /* cancelled */ }
    const ok = await this.copyCalendarUrl(shareText);
    if (!ok) showToast('Share not available - use Copy link');
  },

  buildCalendarPosterHtml(meta, options = {}) {
    const { showToolbar = false } = options;
    const url = meta.url || this.buildCalendarUrl(meta.token);
    const title = toPlainAscii(meta.title || 'When RU Free');
    const token = meta.token || '';
    const siteUrl = 'https://whenrufree.net';
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const created = this.formatDateForFile();
    const hasOwnEmoji = !!window.AccessEmoji && AccessEmoji.valid(meta.access_emoji);
    const emojiHtml = hasOwnEmoji
      ? `<div class="emoji-block"><div class="code-label">Calendar emoji</div><div class="emoji-glyph">${esc(AccessEmoji.glyph(meta.access_emoji))}</div><div class="emoji-name">${esc(AccessEmoji.name(meta.access_emoji))}</div><p class="emoji-note">Pick this emoji when the calendar asks for it.</p></div>`
      : (meta.access_hub === true
        ? `<div class="emoji-block"><div class="code-label">Emoji</div><p class="emoji-note">Pick the Hub's emoji when the calendar asks for it.</p></div>`
        : '');

    const toolbarHtml = showToolbar ? `
  <div class="toolbar no-print">
    <span class="toolbar-label">Calendar poster</span>
    <div class="toolbar-actions">
      <button type="button" id="posterCopyCodeBtn" class="tb-btn">Copy code</button>
      <button type="button" id="posterCopyLinkBtn" class="tb-btn">Copy link</button>
      <button type="button" id="posterPrintBtn" class="tb-btn tb-btn-primary">Print</button>
    </div>
  </div>` : '';

    const onloadScript = showToolbar ? `<script>
(function(){
  var calUrl=${JSON.stringify(this.buildCopyText(meta))};
  var calCode=${JSON.stringify(token)};
  function copyText(t){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(t).then(function(){alert('Copied to clipboard');})
        .catch(function(){prompt('Copy this text:',t);});
    }else{prompt('Copy this text:',t);}
  }
  document.getElementById('posterCopyCodeBtn').onclick=function(){copyText(calCode);};
  document.getElementById('posterCopyLinkBtn').onclick=function(){copyText(calUrl);};
  document.getElementById('posterPrintBtn').onclick=function(){window.print();};
  window.focus();
})();
<\/script>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>When RU Free - ${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    background:linear-gradient(145deg,#e8eaf6 0%,#f5f5f5 45%,#eceff1 100%);
    color:#333;min-height:100vh;padding:20px;
  }
  .page-wrap{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:16px;}
  .toolbar{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;
    background:#fff;border:1px solid #c5cae9;border-radius:10px;
    padding:12px 16px;box-shadow:0 4px 16px rgba(63,81,181,0.1);
  }
  .toolbar-label{font-weight:700;color:#283593;font-size:0.95rem;}
  .toolbar-actions{display:flex;flex-wrap:wrap;gap:8px;}
  .tb-btn{padding:9px 14px;border:1px solid #ccc;background:#fff;border-radius:6px;font-weight:600;font-size:0.88rem;cursor:pointer;min-height:40px;}
  .tb-btn:hover{background:#f5f5f5;}
  .tb-btn-primary{background:#880000;color:#fff;border-color:#880000;}
  .tb-btn-primary:hover{background:#6d0000;}
  .poster{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.14);border:1px solid rgba(63,81,181,0.15);}
  .brand-header{background:linear-gradient(135deg,#3f51b5 0%,#283593 100%);color:#fff;padding:32px 28px 28px;text-align:center;position:relative;}
  .brand-header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#880000,#c62828,#880000);}
  .brand-badge{display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.35);border-radius:999px;padding:6px 14px;font-size:0.75rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:14px;}
  .brand-header .app-name{font-size:2.2rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;}
  .brand-header .tagline{font-size:1.05rem;opacity:0.94;font-weight:500;}
  .poster-body{padding:36px 32px 30px;text-align:center;}
  .cal-label{font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#888;margin-bottom:8px;}
  .cal-name{font-size:1.75rem;font-weight:800;color:#222;margin-bottom:6px;line-height:1.25;}
  .cal-created{font-size:0.85rem;color:#888;margin-bottom:26px;}
  .code-block{background:linear-gradient(180deg,#fafafa 0%,#f0f0f0 100%);border:3px solid #3f51b5;border-radius:14px;padding:32px 24px 28px;margin:0 auto 26px;max-width:100%;box-shadow:0 8px 24px rgba(63,81,181,0.12),inset 0 1px 0 #fff;}
  .code-label{font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#3f51b5;margin-bottom:14px;}
  .cal-code{font-family:Consolas,'Courier New',monospace;font-size:clamp(2.6rem,11vw,4.8rem);font-weight:800;letter-spacing:0.2em;color:#111;line-height:1.1;word-break:break-all;}
  .go-instruction{font-size:1.08rem;font-weight:600;color:#444;line-height:1.45;margin:0 auto 26px;max-width:520px;}
  .emoji-block{border:2px dashed #9fa8da;border-radius:14px;padding:18px 16px;margin:0 auto 26px;background:#f5f6fc;}
  .emoji-block .code-label{font-size:1.05rem;}
  .emoji-glyph{font-size:6.5rem;line-height:1.1;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;}
  .emoji-name{font-size:1.8rem;font-weight:800;color:#222;margin-top:4px;}
  .emoji-note{font-size:1.15rem;font-weight:600;color:#444;margin-top:8px;}
  .link-section{text-align:left;margin-top:4px;}
  .link-section p{font-size:0.92rem;color:#555;line-height:1.55;margin-bottom:10px;}
  .link-box{font-family:Consolas,'Courier New',monospace;font-size:0.84rem;background:#e8eaf6;border:1px solid #c5cae9;border-radius:8px;padding:14px 16px;word-break:break-all;color:#283593;}
  .promo{background:linear-gradient(135deg,#880000 0%,#6d0000 100%);color:#fff;padding:26px 32px;text-align:center;}
  .promo .site{font-size:1.45rem;font-weight:800;letter-spacing:0.02em;margin-bottom:8px;}
  .promo .pitch{font-size:0.98rem;opacity:0.96;line-height:1.45;}
  .promo .cta{font-size:0.84rem;margin-top:12px;opacity:0.88;padding-top:12px;border-top:1px solid rgba(255,255,255,0.25);}
  @page{margin:10mm;}
  @media print{
    body{background:#fff;padding:0;min-height:0;}
    .no-print{display:none !important;}
    .page-wrap{max-width:none;gap:0;}
    .poster{box-shadow:none;border-radius:0;border:none;break-inside:avoid;page-break-inside:avoid;}
    .brand-header,.promo,.code-block{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .brand-header{padding:20px 24px 18px;}
    .brand-badge{margin-bottom:8px;}
    .poster-body{padding:22px 28px 18px;}
    .cal-created{margin-bottom:16px;}
    .code-block{padding:20px 20px 18px;margin-bottom:16px;}
    .cal-code{font-size:4.2rem;}
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
        <div class="tagline">${meta.booking ? 'Book a Slot' : 'Group Availability Calendar'}</div>
      </div>
      <div class="poster-body">
        <div class="cal-label">Your calendar</div>
        <div class="cal-name">${esc(title)}</div>
        <div class="cal-created">Created ${esc(created)}</div>
        <div class="code-block">
          <div class="code-label">Calendar code</div>
          <div class="cal-code">${esc(token)}</div>
        </div>
        <p class="go-instruction">Go to whenrufree.net/go and enter this calendar code</p>
        ${meta.invite_only ? '<p class="go-instruction">Invite only: people request access</p>' : ''}
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

  openCalendarPosterPopup(meta) {
    const html = this.buildCalendarPosterHtml(meta, { showToolbar: true });
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

function showSaveCalendarPanel(meta) {
  const overlay = document.getElementById('savePanelOverlay');
  const url = meta.url || calendarSaveKit.buildCalendarUrl(meta.token);

  document.getElementById('saveCalTitle').textContent = meta.title || 'When RU Free';
  document.getElementById('saveCalCode').textContent = meta.token;
  document.getElementById('saveCalUrl').textContent = url;

  const hasOwnEmoji = !!window.AccessEmoji && AccessEmoji.valid(meta.access_emoji);
  const showEmoji = hasOwnEmoji || meta.access_hub === true;
  document.getElementById('saveCalEmojiWrap').classList.toggle('hideme', !showEmoji);
  document.getElementById('saveCalEmoji').textContent = hasOwnEmoji ? AccessEmoji.glyph(meta.access_emoji) : '';
  document.getElementById('saveCalEmojiName').textContent = hasOwnEmoji
    ? AccessEmoji.name(meta.access_emoji)
    : "the Hub's emoji";
  document.getElementById('saveCalInvite').classList.toggle('hideme', meta.invite_only !== true);

  const ack = document.getElementById('saveAckCheckbox');
  const continueBtn = document.getElementById('saveContinueBtn');
  ack.checked = false;
  continueBtn.disabled = true;

  document.getElementById('clipboardFailMsg').classList.add('hideme');
  overlay.classList.remove('hideme');

  const fullMeta = { ...meta, url };
  const copyText = calendarSaveKit.buildCopyText(fullMeta);

  (async () => {
    const copied = await calendarSaveKit.copyCalendarUrl(copyText);
    if (!copied) document.getElementById('clipboardFailMsg').classList.remove('hideme');
    calendarSaveKit.downloadCalendarDetailsTxt(fullMeta);
  })();

  document.getElementById('saveCopyBtn').onclick = () => calendarSaveKit.copyCalendarUrl(copyText);
  document.getElementById('saveDownloadBtn').onclick = () => {
    calendarSaveKit.downloadCalendarDetailsTxt(fullMeta);
    showToast('Download started');
  };
  document.getElementById('saveShareBtn').onclick = () => calendarSaveKit.shareCalendarLink(fullMeta);
  document.getElementById('saveEmailBtn').onclick = () => calendarSaveKit.emailCalendarLink(fullMeta);
  document.getElementById('savePosterBtn').onclick = () => calendarSaveKit.openCalendarPosterPopup(fullMeta);

  ack.onchange = () => {
    continueBtn.disabled = !ack.checked;
  };

  continueBtn.onclick = () => {
    if (!ack.checked) return;
    overlay.classList.add('hideme');
    window.location.href = `calendar.html?c=${encodeURIComponent(meta.token)}`;
  };
}

/**
 * IMPORTANT: getRelativeLuminance() and getContrastTextColor() below are
 * duplicated in calendar-core.js. If you change the luminance formula or contrast
 * threshold here, update calendar-core.js to match (and vice versa).
 *
 * Calculates relative luminance of a colour for WCAG contrast calculations.
 * Uses sRGB linearisation as per WCAG 2.1 specification.
 * @param {string} hexColor - Hex colour string (e.g., '#FF5500' or 'FF5500')
 * @returns {number} Relative luminance between 0 (black) and 1 (white)
 */
function getRelativeLuminance(hexColor) {
  // Remove # if present and handle shorthand hex
  let hex = hexColor.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  
  // Parse RGB components
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  
  // sRGB to linear RGB conversion (WCAG formula)
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  
  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);
  
  // Relative luminance formula (ITU-R BT.709)
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Determines if text should be black or white based on background colour.
 * Uses a simple luminance threshold for predictable results.
 * @param {string} bgColor - Background colour in hex format
 * @returns {string} '#000000' for dark text or '#FFFFFF' for light text
 */
function getContrastTextColor(bgColor) {
  if (!bgColor || typeof bgColor !== 'string') return '#FFFFFF';
  
  const luminance = getRelativeLuminance(bgColor);
  
  // Simple threshold: adjust this value (0.0-1.0)
  // Higher = more backgrounds get white text
  // 0.5 = balanced, 0.6 = prefer white, 0.7 = strongly prefer white
  // ##################### TEXT SLOT COLOR ###############
  const threshold = 0.4;
  
  return luminance < threshold ? '#FFFFFF' : '#000000';
}

/**
 * Applies the chosen colour as background to the label input with appropriate text contrast.
 * @param {HTMLInputElement} colorPicker - The color picker element
 * @param {HTMLInputElement} labelInput - The label input element
 */
function applyColorPreview(colorPicker, labelInput) {
  const bgColor = colorPicker.value;
  const textColor = getContrastTextColor(bgColor);
  labelInput.style.backgroundColor = bgColor;
  labelInput.style.color = textColor;
  labelInput.style.borderColor = bgColor;
}

/**
 * Fetches and caches a CSRF token for state-changing requests.
 * @returns {Promise<string|null>} CSRF token or null if unavailable
 */
async function ensureCsrfToken(){
  if(csrfToken) return csrfToken;
  try{
    const resp = await fetch('api.php?action=csrf_token', {method:'GET'});
    const data = await resp.json();
    if(data && data.status==='success' && typeof data.csrf_token==='string' && data.csrf_token.length>10){
      csrfToken = data.csrf_token;
    }
  }catch(e){
    console.error('Failed to fetch CSRF token:', e);
  }
  return csrfToken;
}

/************** HELPERS: Normalisation etc **************/
function normaliseTitle(t){
  t = (t ?? '').trim().replace(/\s+/g,' ');
  t = t.replace(/[<>]/g,'');
  if (!t) return '';
  if (t.length>80) t = t.slice(0,80);
  return t;
}
function normaliseSlotLabel(s){
  s = (s ?? '').replace(/\u00A0/g,' ').trim().replace(/\s+/g,' ');
  if (s.length===0) return '';
  if (s.length>20) s = s.slice(0,20);
  return s;
}
// Must match validateSlotsArray() in api.php (includes apostrophe)
const SLOT_REGEX = /^[A-Za-z0-9][A-Za-z0-9'\- ]{0,19}$/;
const MIN_DATE='2026-01-01';
const MAX_DATE='2030-12-31';

/* These are mutable so admin site config can override them at runtime.
   No upper limit on slots or statuses - admin sets the ceiling.
   Defaults match the original hardcoded values. */
let MAX_SLOTS = 6;
let MAX_STATUSES = 5;
let MAX_RANGE_DAYS = 360;

/* ============================================
   SITE CONFIG - fetched from api.php?action=get_site_config
   Controls: category list, slot chips, option presets, date chips, max limits.
   Falls back gracefully to hardcoded defaults if fetch fails or config absent.
   ============================================ */
let siteConfig = null;

/**
 * Fetch site config from the server.
 * Silent fail - returns null if unavailable (page uses hardcoded defaults).
 * @returns {Promise<object|null>}
 */
async function fetchSiteConfig() {
  try {
    const resp = await fetch('api.php?action=get_site_config', { method: 'GET' });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.status === 'success') {
      initAccessField(data.features);
      initBookingField(data.features);
      initJoinModeField(data.features);
    }
    if (data && data.status === 'success' && data.config && typeof data.config === 'object') {
      return data.config;
    }
  } catch (e) {
    console.warn('site config fetch failed:', e);
  }
  return null;
}

/**
 * Rebuild the category grid from config.
 * @param {Array} cats - array of {value, icon, label}
 */
function applyCategoryConfig(cats) {
  if (!Array.isArray(cats) || cats.length === 0) return;
  catGrid.innerHTML = '';
  cats.forEach(cat => {
    if (!cat.value || !cat.icon || !cat.label) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-tog';
    btn.dataset.value = cat.value;
    btn.dataset.icon  = cat.icon;
    btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${cat.icon}</span><span>${cat.label}</span>`;
    catGrid.appendChild(btn);
  });
}

/**
 * Rebuild the slot example chips bar from config.
 * @param {Array} examples - array of strings
 */
function applySlotChipsConfig(examples) {
  const bar = document.getElementById('quickAddBar');
  if (!bar || !Array.isArray(examples) || examples.length === 0) return;
  bar.innerHTML = '<span style="font-size:0.8em;color:#333;vertical-align:middle;margin-top:0.2em;">e.g. </span>';
  examples.forEach(ex => {
    if (!ex) return;
    const btn = document.createElement('button');
    btn.className = 'btn-chip';
    btn.type = 'button';
    btn.dataset.slot = ex;
    btn.textContent = ex;
    bar.appendChild(btn);
  });
}

/**
 * Rebuild the option preset chips bar from config.
 * @param {Array} presets - array of {key, label, items}
 */
function applyOptionPresetsConfig(presets) {
  const bar = document.getElementById('statusPresetBar');
  if (!bar || !Array.isArray(presets) || presets.length === 0) return;
  bar.innerHTML = '<span style="font-size:0.8em;color:#333;vertical-align:middle;margin-top:0.2em;">e.g. </span>';
  presets.forEach(p => {
    if (!p.key || !p.label) return;
    const btn = document.createElement('button');
    btn.className = 'btn-chip';
    btn.type = 'button';
    btn.dataset.preset = p.key;
    btn.textContent = p.label;
    bar.appendChild(btn);
  });
}

/**
 * Rebuild the date range quick preset chips from config.
 * Also updates the hidden MAX_RANGE_DAYS used in validation.
 * @param {Array} presets - array of {key, label, days}
 * @param {number} maxRangeDays
 */
function applyDatePresetsConfig(presets, maxRangeDays) {
  if (typeof maxRangeDays === 'number' && maxRangeDays >= 1) {
    MAX_RANGE_DAYS = maxRangeDays;
  }
  const rangeDaysHint = document.getElementById('maxRangeDaysHint');
  if (rangeDaysHint) rangeDaysHint.textContent = MAX_RANGE_DAYS;

  if (!Array.isArray(presets) || presets.length === 0) return;

  // Find the chips container inside the Dates section
  const chipsWrap = document.querySelector('#datePresetsBar');
  if (!chipsWrap) return;

  chipsWrap.innerHTML = '<span style="font-size:0.8em;color:#333;vertical-align:middle;margin-top:0.2em;">e.g. </span>';
  presets.forEach(p => {
    if (!p.key || !p.label) return;
    const btn = document.createElement('button');
    btn.className = 'btn-chip';
    btn.type = 'button';
    btn.dataset.range = p.key;
    btn.dataset.rangeDays = p.days;
    btn.textContent = p.label;
    chipsWrap.appendChild(btn);
  });

  // Re-wire the click handler for the new buttons (event delegation handles it already)
}

/**
 * Apply max slot/status limits from config to validation and UI hints.
 * @param {number} maxSlots
 * @param {number} maxStatuses
 */
function applyMaxLimits(maxSlots, maxStatuses) {
  if (typeof maxSlots === 'number' && maxSlots >= 1) {
    MAX_SLOTS = maxSlots;
  }
  if (typeof maxStatuses === 'number' && maxStatuses >= 1) {
    MAX_STATUSES = maxStatuses;
  }
  // Always update hint text to reflect current maximums
  const slotHint = document.getElementById('slotsMaxHint');
  if (slotHint) slotHint.textContent = MAX_SLOTS;
  const statusHint = document.getElementById('statusMaxHint');
  if (statusHint) statusHint.textContent = MAX_STATUSES;
}

/**
 * Apply full site config to the index page.
 * Called once after fetchSiteConfig() resolves.
 * @param {object} cfg
 */
function applySiteConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  siteConfig = cfg;

  if (cfg.slots) {
    applySlotChipsConfig(cfg.slots.examples);
    applyMaxLimits(cfg.slots.max, null);
  }
  if (cfg.options) {
    applyOptionPresetsConfig(cfg.options.presets);
    // Update STATUS_PRESETS from config so preset chips work correctly
    if (Array.isArray(cfg.options.presets)) {
      cfg.options.presets.forEach(p => {
        if (p.key && Array.isArray(p.items)) {
          STATUS_PRESETS[p.key] = p.items;
        }
      });
    }
    applyMaxLimits(null, cfg.options.max);
  }
  if (cfg.dates) {
    applyDatePresetsConfig(cfg.dates.presets, cfg.dates.max_range_days);
  }
  if (cfg.retention) {
    applyRetentionConfig(cfg.retention.inactive_days);
  }
}

/**
 * Update any `.js-retention-days` spans in the page with the admin-configured
 * auto-delete threshold (in days). Falls back to each span's data-default when
 * the value is missing or out of range.
 * @param {number|string} days
 */
function applyRetentionConfig(days) {
  const n = parseInt(days, 10);
  document.querySelectorAll('.js-retention-days').forEach(el => {
    const fallback = parseInt(el.dataset.default, 10) || 30;
    el.textContent = (n >= 1 && n <= 3650) ? String(n) : String(fallback);
  });
}

/**
 * Returns the default slots/statuses from site config, or falls back to hardcoded defaults.
 * @returns {{slots: string[], statuses: Array}}
 */
function getConfigDefaults() {
  if (siteConfig) {
    const slots = Array.isArray(siteConfig.slots?.defaults) && siteConfig.slots.defaults.length > 0
      ? siteConfig.slots.defaults
      : ['Morning', 'Afternoon', 'Evening'];
    const statuses = Array.isArray(siteConfig.options?.defaults) && siteConfig.options.defaults.length > 0
      ? siteConfig.options.defaults
      : [{label:'Yes', weight:2}, {label:'Maybe', weight:1}, {label:'No', weight:0}];
    return { slots, statuses };
  }
  return {
    slots: ['Morning', 'Afternoon', 'Evening'],
    statuses: [{label:'Yes', weight:2}, {label:'Maybe', weight:1}, {label:'No', weight:0}]
  };
}

function formatDateDisplay(dateStr){
  const date = new Date(dateStr + 'T00:00:00');
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}
function daysBetween(start, end){
  const startMs = new Date(start + 'T00:00:00').getTime();
  const endMs   = new Date(end   + 'T00:00:00').getTime();
  return Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
}
function getTodayClamped(){
  const today = new Date();
  const y=today.getFullYear(), m=String(today.getMonth()+1).padStart(2,'0'), d=String(today.getDate()).padStart(2,'0');
  const s=`${y}-${m}-${d}`;
  if (s<MIN_DATE) return MIN_DATE;
  if (s>MAX_DATE) return MAX_DATE;
  return s;
}
function addDays(dateStr, days){
  const d=new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+days);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0');
  const res=`${y}-${m}-${da}`;
  if (res<MIN_DATE) return MIN_DATE;
  if (res>MAX_DATE) return MAX_DATE;
  return res;
}

/************** SLOTS REPEATER UI **************/
const slotsWrap   = document.getElementById('slotsWrap');
const addSlotBtn  = document.getElementById('addSlotBtn');
const slotsError  = document.getElementById('slotsError');

function makeSlotRow(initial=''){
  const row = document.createElement('div');
  row.className = 'slot-row';

  // Reorder control: move this row above the previous one. Mirrors the
  // .status-row move-up behaviour - the slot order in the DOM is the order
  // saved by getValidSlots(), so swapping siblings is enough.
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn-small move-up';
  up.setAttribute('aria-label', 'Move up');
  up.setAttribute('title', 'Move up');
  up.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">arrow_shape_up_stack_2</span>`;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = "e.g., Morning";
  input.maxLength = 20;
  input.value = initial;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn-small remove';
  del.setAttribute('aria-label', 'Delete');
  del.setAttribute('title', 'Delete');
  del.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">delete</span>`;

  const err = document.createElement('span');
  err.className = 'inline-error';

  input.addEventListener('input', validateSlotsUI);
  del.addEventListener('click', () => {
    row.remove();
    refreshSlotReorderUI();
    validateSlotsUI();
  });

  up.addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (!prev) return;
    slotsWrap.insertBefore(row, prev);
    refreshSlotReorderUI();
    validateSlotsUI();
  });

  row.appendChild(up);
  row.appendChild(input);
  row.appendChild(del);
  row.appendChild(err);
  return row;
}

/** Disable the Move-up button on the first slot row so it can't go above itself. */
function refreshSlotReorderUI(){
  const rows = Array.from(slotsWrap.querySelectorAll('.slot-row'));
  rows.forEach((row, idx) => {
    const btn = row.querySelector('.move-up');
    if (!btn) return;
    btn.disabled = (idx === 0);
  });
}

function readSlotsFromUI(){
  const inputs = Array.from(slotsWrap.querySelectorAll('input'));
  return inputs.map(i => normaliseSlotLabel(i.value));
}
function setSlots(slots){
  slotsWrap.innerHTML = '';
  for (const s of slots) slotsWrap.appendChild(makeSlotRow(s));
  refreshSlotReorderUI();
  validateSlotsUI();
}
function addSlot(label=''){
  const current = slotsWrap.querySelectorAll('.slot-row').length;
  if (current >= MAX_SLOTS) return;
  slotsWrap.appendChild(makeSlotRow(label));
  refreshSlotReorderUI();
  validateSlotsUI();
}
addSlotBtn.addEventListener('click', () => addSlot(''));
document.getElementById('quickAddBar').addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-slot]');
  if (!btn) return;
  const label = normaliseSlotLabel(btn.dataset.slot);
  const slots = readSlotsFromUI();
  const lower = slots.map(s => s.toLowerCase());
  if (label && lower.indexOf(label.toLowerCase()) === -1){
    if (slots.length < MAX_SLOTS) addSlot(label);
  }
});
function validateSlotsUI(){
  const rows = Array.from(slotsWrap.querySelectorAll('.slot-row'));
  const labels = [];
  let ok = true;
  slotsError.style.display = 'none';

  for (const row of rows){
    const input = row.querySelector('input');
    const err   = row.querySelector('.inline-error');
    const v = normaliseSlotLabel(input.value);
    let msg = '';
    if (!v){ msg = 'Required'; }
    else if (!SLOT_REGEX.test(v)){ msg = "Use letters, numbers, spaces, apostrophes and hyphens only (max 20)."; }
    else {
      const lower = v.toLowerCase();
      if (labels.map(x=>x.toLowerCase()).includes(lower)) msg = 'Duplicate';
    }
    if (msg){
      ok = false; err.textContent = msg; err.style.display='inline';
    } else {
      err.textContent=''; err.style.display='none';
    }
    labels.push(v);
  }
  if (labels.length<1 || labels.length>MAX_SLOTS){
    ok=false; slotsError.textContent=`Add between 1 and ${MAX_SLOTS} slots.`; slotsError.style.display='block';
  }
  validateAll();
  return ok;
}

/************** STATUS OPTIONS REPEATER UI **************/
const statusWrap  = document.getElementById('statusWrap');
const addStatusBtn = document.getElementById('addStatusBtn');
const statusError = document.getElementById('statusError');

/************** UNANSWERED SLOTS COLOUR (migrations/012) **************/
// Five fixed greys an organiser may pick for a Slot nobody has answered yet. There is no "clear"
// option: the default grey is a real choice, so the picker always shows a tick.
// NOTE: keep in sync with NULL_COLOR_CHOICES in includes/data.php and calendar-core.js.
const NULL_COLOR_CHOICES = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff'];
const NULL_COLOR_DEFAULT = '#bfbfbf';
let nullColorChoice = NULL_COLOR_DEFAULT;
const nullSwatchesEl = document.getElementById('nullSwatches');

// Ranking mode: 'rank' (position-based) or 'weights' (custom values 0-5)
let rankingMode = 'rank';

// Toggle click handler (safe initialization)
const rankingToggleEl = document.getElementById('rankingToggle');
if (rankingToggleEl) {
  rankingToggleEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tog-btn');
    if (!btn || btn.dataset.mode === rankingMode) return;
    
    // Update active state
    document.querySelectorAll('#rankingToggle .tog-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update mode and hint
    rankingMode = btn.dataset.mode;
    const hintEl = document.getElementById('rankingHint');
    if (hintEl) {
      hintEl.textContent = rankingMode === 'rank' ? 'Position = score (top is best)' : 'Enter score 0-5 for each';
    }
    
    // Toggle visibility of controls
    applyRankingMode();
  });
}

/** Show/hide move-up buttons and weight inputs based on mode */
function applyRankingMode(){
  const rows = statusWrap.querySelectorAll('.status-row');
  rows.forEach(row => {
    const moveUp = row.querySelector('.move-up');
    const weightNum = row.querySelector('.weight-num');
    if (rankingMode === 'rank') {
      if (moveUp) moveUp.style.display = '';
      if (weightNum) weightNum.style.display = 'none';
    } else {
      if (moveUp) moveUp.style.display = 'none';
      if (weightNum) weightNum.style.display = '';
    }
  });
  refreshStatusReorderUI();
}

// Status labels share the same constraints as slots (max 20 chars)
function normaliseStatusLabel(s){
  s = (s ?? '').replace(/\u00A0/g,' ').trim().replace(/\s+/g,' ');
  if (s.length===0) return '';
  if (s.length>20) s = s.slice(0,20);
  return s;
}
const STATUS_REGEX = SLOT_REGEX;

// Strength palette (2..5) used to represent weight/score.
// Colours are intentionally tied to *rank position* (strength), not to option identity.
// Green = best/positive, Red = worst/negative, with gradient in between.
const STRENGTH_COLORS = {
  green: '#4caf50',       // Strong positive (Yes, Available, etc.)
  yellowGreen: '#8bc34a', // Moderate positive
  amber: '#ffc107',       // Neutral/Maybe
  orange: '#ff9800',      // Moderate negative
  red: '#f44336'          // Strong negative (No, Unavailable, etc.)
};

/**
 * Returns a strength-ordered palette for N statuses (1..N).
 * For N > 5 the base 5-colour palette cycles to cover all entries.
 * Index 0 is strongest (highest weight), last index is weakest.
 */
function getStrengthPalette(n){
  const base = [
    STRENGTH_COLORS.green,
    STRENGTH_COLORS.yellowGreen,
    STRENGTH_COLORS.amber,
    STRENGTH_COLORS.orange,
    STRENGTH_COLORS.red
  ];
  const N = Math.max(1, Number(n) || 1);
  if (N === 1) return [STRENGTH_COLORS.green];
  if (N === 2) return [STRENGTH_COLORS.green, STRENGTH_COLORS.red];
  if (N === 3) return [STRENGTH_COLORS.green, STRENGTH_COLORS.amber, STRENGTH_COLORS.red];
  if (N === 4) return [STRENGTH_COLORS.green, STRENGTH_COLORS.yellowGreen, STRENGTH_COLORS.amber, STRENGTH_COLORS.red];
  if (N === 5) return [...base];
  // N > 5: cycle through the base palette
  const result = [];
  for (let i = 0; i < N; i++) {
    result.push(base[i % base.length]);
  }
  return result;
}

/**
 * Applies strength colours (by DOM order) to the status option inputs.
 * This ensures colours always match the derived ranking weights.
 */
/**
 * Applies default colors to status rows based on position.
 * Only sets color if the color picker hasn't been manually changed (still has default palette color).
 * Also updates the label input preview styling.
 */
function applyDefaultColors(){
  const rows = Array.from(statusWrap.querySelectorAll('.status-row'));
  const palette = getStrengthPalette(rows.length || 1);
  rows.forEach((row, idx) => {
    const colorPicker = row.querySelector('.color-pick');
    const labelInput = row.querySelector('.label-input');
    if (!colorPicker) return;
    
    // Check if this is a "default" color (from palette) - if so, update it based on new position
    const currentColor = colorPicker.value.toUpperCase();
    const isDefaultColor = Object.values(STRENGTH_COLORS).some(c => c.toUpperCase() === currentColor);
    
    if (isDefaultColor || !colorPicker.dataset.userSet) {
      const newColor = palette[Math.min(idx, palette.length-1)];
      colorPicker.value = newColor;
    }
    
    // Always apply preview styling to label input
    if (labelInput) {
      applyColorPreview(colorPicker, labelInput);
    }
  });
}

const STATUS_PRESETS = {
  yes:               [{label:'Yes', weight:1}],
  no:               [{label:'No', weight:1}],
  yes_no:               [{label:'Yes', weight:2}, {label:'No', weight:0}],
  yes_maybe_no:         [{label:'Yes', weight:2}, {label:'Maybe', weight:1}, {label:'No', weight:0}],
  available_unavailable:[{label:'Available', weight:2}, {label:'Unavailable', weight:0}],
  free_tentative_busy:  [{label:'Free', weight:2}, {label:'Tentative', weight:1}, {label:'Busy', weight:0}],
  in_out_maybe:         [{label:'In', weight:2}, {label:'Maybe', weight:1}, {label:'Out', weight:0}],
  attending_not_attending: [{label:'Attending', weight:2}, {label:'Not attending', weight:0}]
};

function makeStatusRow(initialLabel='', initialWeight=null, initialColor=null){
  const row = document.createElement('div');
  row.className = 'status-row';

  // Single reorder control: move up (higher priority) - shown in Rank mode
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn-small move-up';
  up.setAttribute('aria-label', 'Move up');
  up.setAttribute('title', 'Move up');
  up.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">arrow_shape_up_stack_2</span>`;

  // Color picker - small square to the left of the label input
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.className = 'color-pick';
  colorPicker.title = 'Choose color';
  // Use initial color or default based on position (will be set by applyDefaultColors)
  colorPicker.value = initialColor || '#6fae00';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'label-input';
  input.placeholder = 'e.g., Yes';
  input.maxLength = 20;
  input.value = initialLabel;

  // Weight number input - shown in Weights mode
  const weightNum = document.createElement('input');
  weightNum.type = 'number';
  weightNum.className = 'weight-num';
  weightNum.min = 0;
  weightNum.max = 5;
  weightNum.value = initialWeight !== null ? initialWeight : 2;
  weightNum.title = 'Weight 0-5';
  weightNum.style.display = rankingMode === 'weights' ? '' : 'none';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn-small remove';
  del.setAttribute('aria-label', 'Delete');
  del.setAttribute('title', 'Delete');
  del.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">delete</span>`;

  const err = document.createElement('span');
  err.className = 'inline-error';

  input.addEventListener('input', validateStatusesUI);
  colorPicker.addEventListener('input', () => {
    // Mark that user has manually set this color (prevents auto-reassignment on reorder)
    colorPicker.dataset.userSet = 'true';
    // Apply color preview to label input
    applyColorPreview(colorPicker, input);
    // Validate to check for duplicate colours
    validateStatusesUI();
  });
  weightNum.addEventListener('input', () => {
    // Clamp value to 0-5
    let v = parseInt(weightNum.value, 10) || 0;
    if (v < 0) v = 0;
    if (v > 5) v = 5;
    weightNum.value = v;
  });
  del.addEventListener('click', () => { row.remove(); applyDefaultColors(); validateStatusesUI(); });

  up.addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (!prev) return;
    statusWrap.insertBefore(row, prev);
    refreshStatusReorderUI();
    applyDefaultColors();
    updatePositionWeights();
    validateStatusesUI();
  });

  // Hide move-up in Weights mode
  if (rankingMode === 'weights') up.style.display = 'none';

  row.appendChild(up);
  row.appendChild(colorPicker);
  row.appendChild(input);
  row.appendChild(weightNum);
  row.appendChild(del);
  row.appendChild(err);
  return row;
}

function refreshStatusReorderUI(){
  // Disable the Move up button on the first row only.
  const rows = Array.from(statusWrap.querySelectorAll('.status-row'));
  rows.forEach((row, idx) => {
    const btn = row.querySelector('.move-up');
    if (!btn) return;
    btn.disabled = (idx === 0);
  });
}

function setStatuses(items){
  statusWrap.innerHTML = '';
  const safe = Array.isArray(items) ? items : [];
  const n = Math.min(safe.length, 5);
  const palette = getStrengthPalette(n);
  safe.slice(0, 5).forEach((item, idx) => {
    // item can be string (label only) or {label, weight, color}
    const label = typeof item === 'string' ? item : (item.label || '');
    const weight = typeof item === 'object' && item.weight !== undefined 
      ? item.weight 
      : Math.max(0, n - 1 - idx); // Default: position-based
    const color = typeof item === 'object' && item.color 
      ? item.color 
      : palette[idx]; // Default: position-based color
    statusWrap.appendChild(makeStatusRow(label, weight, color));
  });
  refreshStatusReorderUI();
  applyDefaultColors();
  applyRankingMode();
  validateStatusesUI();
}

function addStatus(label=''){
  const current = statusWrap.querySelectorAll('.status-row').length;
  if (current >= MAX_STATUSES) return;
  // New status gets weight 0 by default
  statusWrap.appendChild(makeStatusRow(label, 0));
  refreshStatusReorderUI();
  applyDefaultColors();
  applyRankingMode();
  updatePositionWeights();
  validateStatusesUI();
}

/** Update weights based on position (for Rank mode) */
function updatePositionWeights(){
  if (rankingMode !== 'rank') return;
  const rows = Array.from(statusWrap.querySelectorAll('.status-row'));
  const n = rows.length;
  rows.forEach((row, idx) => {
    const weightNum = row.querySelector('.weight-num');
    if (weightNum) weightNum.value = Math.max(0, n - 1 - idx);
  });
}

addStatusBtn.addEventListener('click', () => addStatus(''));

/**
 * Un-answered Slots: the five fixed greys, with the default ticked from the start
 * (migrations/012). Part of the Options section, so it hides with it on booking calendars.
 */
function initNullColorPicker(){
  if(!nullSwatchesEl) return;
  const paint = () => {
    nullSwatchesEl.querySelectorAll('.null-swatch').forEach(btn => {
      const on = btn.dataset.color === nullColorChoice;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.innerHTML = '';
      if(on){
        const tick = document.createElement('span');
        tick.className = 'material-symbols-outlined';
        tick.setAttribute('aria-hidden', 'true');
        tick.textContent = 'check';
        tick.style.color = getContrastTextColor(btn.dataset.color);
        btn.appendChild(tick);
      }
    });
  };

  for(const color of NULL_COLOR_CHOICES){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'null-swatch';
    btn.dataset.color = color;
    btn.style.background = color;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-label', `Unanswered Slot colour: ${color}${color === NULL_COLOR_DEFAULT ? ' (default)' : ''}`);
    btn.title = color;
    btn.addEventListener('click', () => { nullColorChoice = color; paint(); });
    nullSwatchesEl.appendChild(btn);
  }

  paint();
}

document.getElementById('statusPresetBar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-preset]');
  if (!btn) return;
  const key = btn.getAttribute('data-preset');
  const preset = STATUS_PRESETS[key];
  if (preset) setStatuses(preset);
});

function validateStatusesUI(){
  const rows = Array.from(statusWrap.querySelectorAll('.status-row'));
  const labels = [];
  const colors = [];
  let ok = true;

  statusError.style.display = 'none';

  refreshStatusReorderUI();
  applyDefaultColors();

  for (const row of rows){
    const input = row.querySelector('.label-input');
    const colorPicker = row.querySelector('.color-pick');
    const err   = row.querySelector('.inline-error');
    const v = normaliseStatusLabel(input ? input.value : '');
    const color = colorPicker ? colorPicker.value.toUpperCase() : '#CCCCCC';
    
    let msg = '';
    if (!v){ msg = 'Required'; }
    else if (!STATUS_REGEX.test(v)){ msg = "Use letters, numbers, spaces, apostrophes and hyphens only (max 20)."; }
    else {
      const lower = v.toLowerCase();
      if (labels.map(x=>x.toLowerCase()).includes(lower)) msg = 'Duplicate label';
    }
    
    // Check for duplicate colour (only if no other error)
    if (!msg && colors.includes(color)) {
      msg = 'Duplicate colour';
    }
    
    if (msg){
      ok = false; err.textContent = msg; err.style.display='inline';
    } else {
      err.textContent=''; err.style.display='none';
    }
    labels.push(v);
    colors.push(color);
  }

  if (labels.length < 1 || labels.length > MAX_STATUSES){
    ok = false;
    statusError.textContent = `Add between 1 and ${MAX_STATUSES} status options.`;
    statusError.style.display = 'block';
  }

  validateAll();
  return ok;
}

/************** DATE RANGE + PRESETS UI **************/
const startDate   = document.getElementById('startDate');
const endDate     = document.getElementById('endDate');
const rangeError  = document.getElementById('rangeError');
const rangeSummary= document.getElementById('rangeSummary');
const rangeDays   = document.getElementById('rangeDays');
const rangeStart  = document.getElementById('rangeStart');
const rangeEnd    = document.getElementById('rangeEnd');

/* NEW: exclude weekends checkbox */
const excludeWeekendsEl = document.getElementById('excludeWeekends');

function updateRangeSummary(){
  const s = startDate.value;
  const e = endDate.value;
  if (s && e && s<=e){
    const days = daysBetween(s,e)+1;
    rangeDays.textContent = days;
    rangeStart.textContent = formatDateDisplay(s);
    rangeEnd.textContent   = formatDateDisplay(e);
    rangeSummary.style.display='block';
  } else {
    rangeSummary.style.display='none';
  }
}
function setDateRange(s,e){ startDate.value=s; endDate.value=e; updateRangeSummary(); validateRangeUI(); }
function validateRangeUI(){
  const s=startDate.value, e=endDate.value; let ok=true, msg='';
  rangeError.style.display='none';
  
  // Reset error styling
  endDate.classList.remove('end-date-error');
  rangeSummary.classList.remove('error');

  if (!s || !e){ ok=false; msg='Both start and end dates are required.'; }
  else if (s<MIN_DATE || s>MAX_DATE || e<MIN_DATE || e>MAX_DATE){ ok=false; msg=`Dates must be between ${MIN_DATE} and ${MAX_DATE}.`; }
  else if (s>e){ ok=false; msg='Start date must be before or equal to end date.'; }
  else {
    const d=daysBetween(s,e);
    if (d>MAX_RANGE_DAYS){ 
      ok=false; 
      msg=`Date range cannot exceed ${MAX_RANGE_DAYS} days.`; 
      endDate.classList.add('end-date-error');
      rangeSummary.classList.add('error');
    }
  }
  if (!ok){ rangeError.textContent=msg; rangeError.style.display='block'; }
  validateAll();
  return ok;
}
startDate.addEventListener('change', ()=>{ updateRangeSummary(); validateRangeUI(); });
endDate.addEventListener('change',   ()=>{ updateRangeSummary(); validateRangeUI(); });

/************** ORGANISER NAME (optional; blank = profile name) **************/
const adminName   = document.getElementById('adminName');
const adminNameErr= document.getElementById('adminNameErr');

function adminNameValue(){
  return (adminName.value??'').trim().replace(/\s+/g,' ');
}

function validateAdmin(){
  adminNameErr.style.display='none';
  const name = adminNameValue();
  if (name && (name.length>32 || !/^[A-Za-z0-9][A-Za-z0-9'\- ]*$/.test(name))){
    adminNameErr.textContent="Use letters, numbers, spaces, apostrophes and hyphens only (max 32).";
    adminNameErr.style.display='block';
    return false;
  }
  return true;
}

/************** PRIVACY MODE TOGGLE **************/
// Privacy mode: 'open' (0), 'hidden' (1), or 'blind' (2)
let privacyMode = 'open';

const PRIVACY_HINTS = {
  open: "Visible - All users can see each other's responses.",
  hidden: "Private (Users) Users cannot see each other's choices, but the organiser can.",
  blind: "Private (All) All responses and names are private - even the organiser cannot see users' responses. People only see their own name, organiser name (yours), and how many have joined."
};

const privacyToggleEl = document.getElementById('privacyToggle');
const privacyHintEl = document.getElementById('privacyHint');

if (privacyToggleEl) {
  privacyToggleEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.priv-btn');
    if (!btn || btn.dataset.mode === privacyMode) return;
    
    // Update active state
    document.querySelectorAll('#privacyToggle .priv-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    privacyMode = btn.dataset.mode;
    updatePrivacyHint();
  });
}

function updatePrivacyHint() {
  if (!privacyHintEl) return;
  const hints = isBookingMode() ? BOOKING_PRIVACY_HINTS : PRIVACY_HINTS;
  privacyHintEl.textContent = hints[privacyMode] || hints.open;
  updateHideNamesRow();
}

/** "Hide names too" is offered with Hidden only (Blind always hides names). */
function updateHideNamesRow() {
  const show = inviteSupported && privacyMode === 'hidden';
  document.getElementById('hideNamesRow').classList.toggle('hideme', !show);
  document.getElementById('hideNamesHint').classList.toggle('hideme', !show);
}

function hideNamesValue() {
  return inviteSupported && privacyMode === 'hidden' && document.getElementById('hideNames').checked;
}

function setPrivacyMode(mode) {
  privacyMode = mode;
  document.querySelectorAll('#privacyToggle .priv-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  updatePrivacyHint();
}

/**
 * Returns the numeric privacy value for the API (0=open, 1=hidden, 2=blind)
 */
function getPrivacyValue() {
  if (privacyMode === 'hidden') return 1;
  if (privacyMode === 'blind') return 2;
  return 0;
}

/************** DATE FILTER MODE TOGGLE **************/
// Date filter mode: 'all', 'only', or 'except'
// Determines which dates participants see after organiser marks dates on the calendar
let dateFilterMode = 'all';

const DATE_FILTER_HINTS = {
  all: "Show all dates in the range to participants.",
  only: "Only show dates you select on the calendar. Click date headers after creating to pick them.",
  except: "Show all dates except the ones you select. Click date headers after creating to exclude them."
};

const dateFilterToggleEl = document.getElementById('dateFilterToggle');
const dateFilterHintEl = document.getElementById('dateFilterHint');

if (dateFilterToggleEl) {
  dateFilterToggleEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.dfilt-btn');
    if (!btn || btn.dataset.mode === dateFilterMode) return;

    // Update active state
    document.querySelectorAll('#dateFilterToggle .dfilt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update mode and hint
    dateFilterMode = btn.dataset.mode;
    if (dateFilterHintEl) {
      dateFilterHintEl.textContent = DATE_FILTER_HINTS[dateFilterMode] || DATE_FILTER_HINTS.all;
    }
  });
}

/**
 * Returns the date filter mode string for the API ('all', 'only', 'except')
 */
function getDateFilterMode() {
  return dateFilterMode;
}

/************** BOOKING MODE **************/
// People per slot (null = normal availability poll) and Bookings per person (per day or in total).
// Shown once the server reports features.booking (migrations/004_booking.sql).
const BOOKING_LIMIT_MAX = 20;
const BOOKING_PRIVACY_HINTS = {
  open: 'Everyone sees who booked each slot.',
  hidden: 'Only you see names. Others just see Booked.'
};
const bookingLabelEl = document.getElementById('bookingLabel');
const bookingColorEl = document.getElementById('bookingColor');
const bookingLabelErrEl = document.getElementById('bookingLabelErr');
// Partly booked / Full colours and names (migrations/006)
const bookingPartialColorEl = document.getElementById('bookingPartialColor');
const bookingFullColorEl = document.getElementById('bookingFullColor');
const bookingPartialLabelEl = document.getElementById('bookingPartialLabel');
const bookingFullLabelEl = document.getElementById('bookingFullLabel');
const bookingPartialLabelErrEl = document.getElementById('bookingPartialLabelErr');
const bookingFullLabelErrEl = document.getElementById('bookingFullLabelErr');

/**
 * Segmented No limit / 1 / 2 / More control; "More" shows a stepper (3..BOOKING_LIMIT_MAX).
 * value is null for no limit, otherwise 1..BOOKING_LIMIT_MAX.
 */
function makeLimitControl({ toggleId, stepperId, valueId, hintId, initial, hint, onChange }) {
  const toggle = document.getElementById(toggleId);
  const stepper = document.getElementById(stepperId);
  const valueEl = document.getElementById(valueId);
  const hintEl = document.getElementById(hintId);
  const minus = stepper.querySelector('[data-step="-1"]');
  const plus = stepper.querySelector('[data-step="1"]');
  let value = initial;
  let moreValue = 3;

  function render() {
    const mode = value === null ? '0' : (value <= 2 ? String(value) : 'more');
    toggle.querySelectorAll('.priv-btn').forEach(b => {
      const on = b.dataset.limit === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    stepper.classList.toggle('hideme', mode !== 'more');
    valueEl.textContent = String(moreValue);
    minus.disabled = moreValue <= 3;
    plus.disabled = moreValue >= BOOKING_LIMIT_MAX;
    hintEl.textContent = hint(value);
  }

  function set(v, silent = false) {
    let n = (v === null || v === undefined) ? null : parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) n = null;
    else n = Math.min(BOOKING_LIMIT_MAX, n);
    value = n;
    if (n !== null && n >= 3) moreValue = n;
    render();
    if (!silent && onChange) onChange(value);
  }

  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.priv-btn');
    if (!btn) return;
    const m = btn.dataset.limit;
    set(m === '0' ? null : (m === 'more' ? moreValue : parseInt(m, 10)));
  });
  stepper.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn || btn.disabled) return;
    moreValue = Math.max(3, Math.min(BOOKING_LIMIT_MAX, moreValue + parseInt(btn.dataset.step, 10)));
    set(moreValue);
  });
  render();
  return { get value() { return value; }, set };
}

const capacityControl = makeLimitControl({
  toggleId: 'capacityToggle', stepperId: 'capacityStepper', valueId: 'capacityValue', hintId: 'capacityHint',
  initial: null,
  hint: (v) => v === null ? 'Everyone can pick every slot.'
    : v === 1 ? 'Booking: each slot can be taken by one person.'
    : `Each slot can be taken by up to ${v} people.`,
  onChange: () => applyBookingMode()
});

// Per day / In total: whether Bookings per person counts each day or the whole calendar (migrations/005).
let perUserTotal = false;
let bookingTotalSupported = false;
const perUserScopeEl = document.getElementById('perUserScope');

const perUserControl = makeLimitControl({
  toggleId: 'perUserToggle', stepperId: 'perUserStepper', valueId: 'perUserValue', hintId: 'perUserHint',
  initial: 1,
  hint: (v) => {
    const when = perUserTotal ? 'in total' : 'per day';
    return v === null ? 'People can book as many slots as they like.'
      : v === 1 ? `Each person can book 1 slot ${when}.`
      : `Each person can book up to ${v} slots ${when}.`;
  },
  onChange: () => renderPerUserScope()
});

/** Per day / In total only shows when the server supports it and a limit is set. */
function renderPerUserScope() {
  perUserScopeEl.classList.toggle('hideme', !bookingTotalSupported || perUserControl.value === null);
  perUserScopeEl.querySelectorAll('.priv-btn').forEach(b => {
    const on = (b.dataset.scope === 'total') === perUserTotal;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setPerUserTotal(on) {
  perUserTotal = on && bookingTotalSupported;
  renderPerUserScope();
  perUserControl.set(perUserControl.value, true);
}

perUserScopeEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.priv-btn');
  if (btn) setPerUserTotal(btn.dataset.scope === 'total');
});

function isBookingMode() {
  return capacityControl.value !== null;
}

let bookingSupported = false;
let bookingStylesSupported = false;

/** Shows People per slot once the server supports booking. */
function initBookingField(features) {
  if (!features || features.booking !== true) return;
  bookingSupported = true;
  bookingTotalSupported = features.booking_total === true;
  bookingStylesSupported = features.booking_styles === true;
  document.getElementById('capacityField').classList.remove('hideme');
  document.getElementById('bookingStyleRows').classList.toggle('hideme', !bookingStylesSupported);
  renderPerUserScope();
}

/** Shows Bookings per person (with the booking label), hides Options and Blind privacy while booking. */
function applyBookingMode() {
  const booking = isBookingMode();
  document.getElementById('perUserField').classList.toggle('hideme', !booking);
  document.getElementById('optionsSection').classList.toggle('hideme', booking);
  // A one-person slot is either free or full, never partly booked
  document.getElementById('bookingPartialRow').classList.toggle('hideme', capacityControl.value === 1);
  const blindBtn = document.querySelector('#privacyToggle .priv-btn[data-mode="blind"]');
  if (blindBtn) blindBtn.classList.toggle('hideme', booking);
  if (booking && privacyMode === 'blind') setPrivacyMode('hidden');
  else updatePrivacyHint();
  validateBookingLabel();
  validateAll();
}

/** Error for a booking name (same rules as option labels); others = names it must differ from. */
function bookingNameError(v, others) {
  if (!v) return 'Required';
  if (!STATUS_REGEX.test(v)) return 'Use letters, numbers, spaces, apostrophes and hyphens only (max 20).';
  if (others.some(o => o && o.toLowerCase() === v.toLowerCase())) return 'Duplicate label';
  return '';
}

function showBookingNameError(el, msg) {
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  return !msg;
}

/** Validates the Booked label and, when shown, the Partly booked / Full names. */
function validateBookingLabel() {
  const booked = normaliseStatusLabel(bookingLabelEl.value);
  let ok = showBookingNameError(bookingLabelErrEl, bookingNameError(booked, []));
  if (bookingStylesSupported) {
    const hasPartial = capacityControl.value !== 1;
    const partial = normaliseStatusLabel(bookingPartialLabelEl.value);
    const full = normaliseStatusLabel(bookingFullLabelEl.value);
    ok = showBookingNameError(bookingPartialLabelErrEl, hasPartial ? bookingNameError(partial, [booked]) : '') && ok;
    ok = showBookingNameError(bookingFullLabelErrEl, bookingNameError(full, hasPartial ? [booked, partial] : [booked])) && ok;
  }
  return ok;
}

for (const [picker, input] of [
  [bookingColorEl, bookingLabelEl],
  [bookingPartialColorEl, bookingPartialLabelEl],
  [bookingFullColorEl, bookingFullLabelEl]
]) {
  input.addEventListener('input', () => { validateBookingLabel(); validateAll(); });
  picker.addEventListener('input', () => applyColorPreview(picker, input));
  applyColorPreview(picker, input);
}

/************** CREATE CALENDAR **************/
const createBtn   = document.getElementById('createBtn');
const titleInput  = document.getElementById('titleInput');

function validateAll(){
  const okSlots = !slotsError.style.display || slotsError.style.display==='none';
  const okStatus = !statusError.style.display || statusError.style.display==='none';
  const okRange = !rangeError.style.display || rangeError.style.display==='none';
  const rows = Array.from(slotsWrap.querySelectorAll('.slot-row'));
  const rowHasError = rows.some(r => r.querySelector('.inline-error').style.display !== 'none');
  const sRows = Array.from(statusWrap.querySelectorAll('.status-row'));
  const statusRowHasError = sRows.some(r => r.querySelector('.inline-error').style.display !== 'none');
  const count = rows.length;
  const statusCount = sRows.length;
  const okOptions = isBookingMode()
    ? validateBookingLabel()
    : okStatus && !statusRowHasError && statusCount>=1 && statusCount<=MAX_STATUSES;
  const enable = okSlots && okRange && !rowHasError && okOptions && count>=1 && count<=MAX_SLOTS && validateAdmin();
  createBtn.disabled = !enable;
}

function getValidSlots(){
  const rows = Array.from(slotsWrap.querySelectorAll('.slot-row'));
  const out = [];
  const seen = new Set();
  for (const r of rows){
    const v = normaliseSlotLabel(r.querySelector('input').value);
    if (!v || !SLOT_REGEX.test(v)) continue;
    const k = v.toLowerCase();
    if (!seen.has(k)){ seen.add(k); out.push(v); }
  }
  return out;
}

function getValidStatuses(){
  if (isBookingMode()) {
    const label = normaliseStatusLabel(bookingLabelEl.value);
    return STATUS_REGEX.test(label) ? [{ label, color: bookingColorEl.value, weight: 1 }] : [];
  }
  const rows = Array.from(statusWrap.querySelectorAll('.status-row'));
  const out = [];
  const seen = new Set();
  rows.forEach((row, idx) => {
    const labelInput = row.querySelector('.label-input');
    const v = normaliseStatusLabel(labelInput ? labelInput.value : '');
    if (!v || !STATUS_REGEX.test(v)) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);

    // Get color from the color picker
    const colorPicker = row.querySelector('.color-pick');
    const color = colorPicker ? colorPicker.value : '#6fae00';
    
    // Get weight value from the weight input
    const weightInput = row.querySelector('.weight-num');
    const weight = weightInput ? parseInt(weightInput.value, 10) || 0 : 0;
    
    out.push({ label: v, color, weight });
  });
  return out;
}

async function createCalendar(){
  createBtn.disabled = true;
  try{
    if (!validateAdmin()) throw new Error('Invalid organiser');
    const csrf = await ensureCsrfToken();
    const title = normaliseTitle(titleInput.value);
    const categories = getSelectedCategories();
    // Default to ['groups'] if none selected
    const category = categories.length > 0 ? JSON.stringify(categories) : JSON.stringify(['groups']);
    const slots = getValidSlots();
    const statuses = getValidStatuses();
    const sDate = startDate.value, eDate=endDate.value;
    if (slots.length<1 || slots.length>MAX_SLOTS) throw new Error('Invalid slots.');
    if (statuses.length<1 || statuses.length>MAX_STATUSES) throw new Error('Invalid status options.');
    if (!sDate || !eDate || sDate>eDate) throw new Error('Invalid date range.');
    const days=daysBetween(sDate,eDate);     if (days>MAX_RANGE_DAYS) throw new Error('Range too long.');

    const headers = {
      'Content-Type':'application/json',
      'X-CSRF-Token': csrf || ''
    };

    const body = {
        title, category, slots,
        statuses,
        start_date: sDate,
        end_date: eDate,
        exclude_weekends: excludeWeekendsEl.checked ? 1 : 0,
        date_filter_mode: getDateFilterMode(),
        is_private: getPrivacyValue(),
        admin_name: adminNameValue()
    };
    if (hubContext.token) body.group_token = hubContext.token;
    const inviteOnly = isInviteOnly();
    if (inviteOnly) body.invite_only = 1;
    if (hideNamesValue()) body.hide_names = 1;
    // Un-answered Slots colour (migrations/012). The default grey is stored as nothing, so only a
    // different grey is sent; booking calendars ignore it (their Slots use Free / Partly / Full).
    if (!isBookingMode() && nullColorChoice !== NULL_COLOR_DEFAULT) body.null_color = nullColorChoice;
    const accessEmoji = accessField ? accessField.value : null;
    if (accessEmoji !== null) body.access_emoji = accessEmoji;
    const booking = isBookingMode();
    if (booking) {
      body.slot_capacity = capacityControl.value;
      body.max_per_user = perUserControl.value;
      if (perUserTotal && perUserControl.value !== null) body.per_user_total = 1;
      if (bookingStylesSupported) {
        if (capacityControl.value > 1) {
          body.partial_color = bookingPartialColorEl.value;
          body.partial_label = normaliseStatusLabel(bookingPartialLabelEl.value);
        }
        body.full_color = bookingFullColorEl.value;
        body.full_label = normaliseStatusLabel(bookingFullLabelEl.value);
      }
    }

    const resp = await accessFetch('api.php?action=create_calendar', {
      method:'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (window.Account && Account.handleApiError(data)) return;
    if (data.status!=='success') throw new Error(data.message || 'Create failed');

    showSaveCalendarPanel({
      token: data.token,
      title: title || 'When RU Free',
      hub_title: hubContext.title || null,
      access_emoji: accessEmoji,
      access_hub: accessEmoji === null && !!hubContext.token && hubContext.accessEnabled,
      invite_only: inviteOnly,
      booking
    });
  }catch(e){
    alert(e.message || 'Failed to create calendar. Please fix errors and try again.');
  }finally{
    createBtn.disabled = false;
  }
}

/************** URL TEMPLATE PREFILL **************/
/**
 * Parses URL parameters to prefill form from Ideas page templates.
 * URL format: index.html?template=1&title=...&category=...&slots=...&statuses=...&range=...
 * 
 * Parameters:
 *   template  - Flag indicating template mode (any truthy value)
 *   title     - Calendar title (URL encoded)
 *   category  - Category value (catchup, how_to_vote, meeting, etc.)
 *   slots     - Comma-separated slot labels (URL encoded)
 *   statuses  - Comma-separated status labels (URL encoded)
 *   weights   - Comma-separated weight values (e.g., "1,1,1" for equal weights)
 *   mode      - Scoring mode: "rank" or "weights"
 *   range     - Date range preset (1day, 1week, 2weeks, 1month, 2months, 3months)
 *   weekends  - Exclude weekends flag (1 = exclude)
 *   cap       - Booking: people per slot (1-20); omit for a normal availability poll
 *   per       - Booking: bookings per person (0 = no limit, 1-20; default 1), counted per day
 *   total     - Booking: 1 = count per across the whole calendar instead of per day
 *   privacy   - "open", "hidden" or "blind" (booking calendars fall back from blind to hidden)
 *   names     - "hidden": Hidden privacy with Hide names too ticked
 *   join      - "invite": Who can join = Invite only
 */
function parseTemplateParams() {
  const params = new URLSearchParams(window.location.search);
  
  // Only process if template flag is present
  if (!params.has('template')) return false;
  
  let applied = false;
  
  // Title
  if (params.has('title')) {
    const title = decodeURIComponent(params.get('title'));
    titleInput.value = normaliseTitle(title);
    applied = true;
  }
  
  // Category (comma-separated values, e.g. category=groups,sport,coffee)
  if (params.has('category')) {
    const cats = params.get('category').split(',').map(c => c.trim()).filter(Boolean);
    // Clear any existing selections
    catGrid.querySelectorAll('.cat-tog.active').forEach(b => b.classList.remove('active'));
    // Activate matching buttons (up to CAT_MAX)
    let count = 0;
    for(const cat of cats){
      if(count >= CAT_MAX) break;
      const catOption = catGrid.querySelector(`.cat-tog[data-value="${cat}"]`);
      if(catOption){
        catOption.classList.add('active');
        count++;
        applied = true;
      }
    }
    updateCatUI();
  }
  
  // Slots (comma-separated)
  if (params.has('slots')) {
    const slotsStr = decodeURIComponent(params.get('slots'));
    const slotsList = slotsStr.split(',').map(s => normaliseSlotLabel(s)).filter(s => s);
    if (slotsList.length > 0 && slotsList.length <= 6) {
      setSlots(slotsList);
      applied = true;
    }
  }
  
  // Scoring mode - must be set BEFORE statuses so weights display correctly
  if (params.has('mode')) {
    const mode = params.get('mode');
    if (mode === 'weights' || mode === 'rank') {
      rankingMode = mode;
      // Update toggle UI
      document.querySelectorAll('#rankingToggle .tog-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      const hintEl = document.getElementById('rankingHint');
      if (hintEl) {
        hintEl.textContent = mode === 'rank' ? 'Position = score (top is best)' : 'Enter score 0-5 for each';
      }
      applied = true;
    }
  }
  
  // Statuses (comma-separated) with optional weights
  if (params.has('statuses')) {
    const statusStr = decodeURIComponent(params.get('statuses'));
    const statusList = statusStr.split(',').map(s => normaliseStatusLabel(s)).filter(s => s);
    
    // Parse weights if provided
    let weightList = [];
    if (params.has('weights')) {
      weightList = params.get('weights').split(',').map(w => {
        const parsed = parseInt(w, 10);
        return isNaN(parsed) ? 0 : Math.max(0, Math.min(5, parsed));
      });
    }
    
    if (statusList.length > 0 && statusList.length <= 5) {
      // Create status objects with weights
      const statusObjs = statusList.map((label, idx) => {
        let weight;
        if (weightList.length > 0 && idx < weightList.length) {
          // Use provided weight
          weight = weightList[idx];
        } else if (rankingMode === 'rank') {
          // Rank mode: position-based weights
          weight = Math.max(0, statusList.length - 1 - idx);
        } else {
          // Weights mode without explicit weights: default to 1 (equal)
          weight = 1;
        }
        return { label, weight };
      });
      setStatuses(statusObjs);
      applied = true;
    }
  }
  
  // Date range preset
  if (params.has('range')) {
    const range = params.get('range');
    const today = getTodayClamped();
    const rangeMap = {
      '1day': 0,
      '2days': 1,
      '3days': 2,
      '5days': 4,
      '1week': 6,
      '10days': 9,
      '2weeks': 13,
      '1month': 29,
      '2months': 59,
      '3months': 89
    };
    if (rangeMap.hasOwnProperty(range)) {
      setDateRange(today, addDays(today, rangeMap[range]));
      applied = true;
    }
  }
  
  // Exclude weekends
  if (params.has('weekends') && params.get('weekends') === '0') {
    excludeWeekendsEl.checked = true;
    updateRangeSummary();
    applied = true;
  }

  // Date filter mode (all, only, except)
  if (params.has('datefilter')) {
    const df = params.get('datefilter');
    if (['all', 'only', 'except'].includes(df)) {
      dateFilterMode = df;
      document.querySelectorAll('#dateFilterToggle .dfilt-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === df);
      });
      if (dateFilterHintEl) {
        dateFilterHintEl.textContent = DATE_FILTER_HINTS[df] || DATE_FILTER_HINTS.all;
      }
      applied = true;
    }
  }

  // privacy = open | hidden | blind (set before cap so booking can drop blind)
  const privacyParam = params.get('privacy');
  if (['open', 'hidden', 'blind'].includes(privacyParam)) {
    setPrivacyMode(privacyParam);
    applied = true;
  }

  // names=hidden: Hidden privacy with "Hide names too" ticked (ignored until migrations/009)
  if (params.get('names') === 'hidden' && inviteSupported) {
    setPrivacyMode('hidden');
    document.getElementById('hideNames').checked = true;
    applied = true;
  }

  // join=invite: Who can join = Invite only (ignored until migrations/009; a Hub's setting wins)
  if (params.get('join') === 'invite' && inviteSupported) {
    joinMode = 'invite';
    renderJoinMode();
    applied = true;
  }

  // Booking: cap = people per slot (1-20), per = bookings per person (0 = no limit, default 1),
  // total=1 counts "per" across the whole calendar instead of per day.
  // The first status label (if given) becomes the booking label.
  if (params.has('cap') && bookingSupported) {
    const cap = parseInt(params.get('cap'), 10);
    if (cap >= 1 && cap <= BOOKING_LIMIT_MAX) {
      if (params.has('per')) perUserControl.set(params.get('per'));
      if (params.get('total') === '1') setPerUserTotal(true);
      if (params.has('statuses')) {
        const first = normaliseStatusLabel(decodeURIComponent(params.get('statuses')).split(',')[0] || '');
        if (first) bookingLabelEl.value = first;
      }
      capacityControl.set(cap);
      applied = true;
    }
  }
  
  // Apply ranking mode UI after statuses are set
  if (applied) {
    applyRankingMode();
  }
  
  return applied;
}

/**
 * Shows a notification banner when template is applied
 */
function showTemplateBanner() {
  // Check if banner already exists
  if (document.getElementById('templateBanner')) return;
  
  const banner = document.createElement('div');
  banner.id = 'templateBanner';
  banner.className = 'warn';
  banner.style.cssText = 'background:#e3f2fd; border-color:#90caf9; color:#1565c0; display:flex; justify-content:space-between; align-items:center; gap:10px;';
  banner.innerHTML = `
    <span><strong>Template loaded!</strong> Review the settings below, and edit as needed.</span>
    <button type="button" onclick="this.parentElement.remove()" style="background:none; border:none; cursor:pointer; padding:4px; font-size:1.2rem; line-height:1; color:#1565c0;">&times;</button>
  `;
  
  // Insert after the first warning div
  const firstWarn = document.querySelector('.card > .warn');
  if (firstWarn) {
    firstWarn.parentNode.insertBefore(banner, firstWarn);
  }
}

/**
 * Signed out: the page stays visible, but the first tap or focus on any form control opens the
 * sign-in panel instead (links still work). Click and focus only, so scrolling past a field on
 * a phone doesn't trigger it.
 */
function guardFormUntilSignedIn(me) {
  const card = document.querySelector('.card');
  if (!card) return;
  const CONTROLS = 'input, textarea, select, button, label, summary, [role="button"], [tabindex]:not([tabindex="-1"])';
  const ask = (e) => {
    const target = e.target.closest(CONTROLS);
    if (!target || !card.contains(target) || target.closest('a, #accountBadge')) return;
    e.preventDefault();
    e.stopPropagation();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    Account.showSignIn(me, { dismissible: true });
  };
  card.addEventListener('click', ask, true);
  card.addEventListener('focusin', ask, true);
}

// ============================================
// ASYNC INIT
// Fetch site config first, then apply it, then set defaults and wire events.
// The page is already rendered with fallback HTML; config just upgrades it.
// ============================================
(async function initPage() {
  'use strict';

  // 0. Signed-out visitors can look at the form; using it asks them to sign in.
  //    Creating inside a Hub (?g=) reads the Hub first, which needs an account.
  const me = await Account.me();
  if ((me.signed_in && me.needs_setup) || (!me.signed_in && getHubTokenFromUrl())) {
    await Account.require();
    return;
  }
  const badge = document.getElementById('accountBadge');
  if (me.signed_in) {
    Account.renderBadge(me, badge);
    if (me.display_name) adminName.placeholder = me.display_name;
  } else {
    Account.renderSignInBadge(badge, () => Account.showSignIn(me, { dismissible: true }));
    guardFormUntilSignedIn(me);
  }

  // 1. Apply default limits immediately so hints show correct values before config loads
  applyMaxLimits(MAX_SLOTS, MAX_STATUSES, MAX_RANGE_DAYS);

  // 2. Fetch and apply site config (silent fail - overrides defaults if present)
  const cfg = await fetchSiteConfig();
  if (cfg) applySiteConfig(cfg);

  // 2. Wire date range preset chips (may have been rebuilt by applySiteConfig)
  //    Use event delegation on the parent container so dynamic chips are covered.
  const datePresetsBar = document.getElementById('datePresetsBar');
  if (datePresetsBar) {
    datePresetsBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      const today = getTodayClamped();
      if (btn.hasAttribute('data-range-days')) {
        const days = parseInt(btn.getAttribute('data-range-days'), 10) || 0;
        setDateRange(today, addDays(today, days));
        return;
      }
      // Legacy key fallback
      const which = btn.getAttribute('data-range');
      const legacyMap = {
        '1day': 0, '2day': 2, '3day': 3, '5day': 5,
        '1week': 6, '2weeks': 13, '1month': 30, '3month': 90
      };
      if (Object.prototype.hasOwnProperty.call(legacyMap, which)) {
        setDateRange(today, addDays(today, legacyMap[which]));
      }
    });
  }

  // 3. Apply template params or use config/hardcoded defaults
  const today = getTodayClamped();
  const templateApplied = parseTemplateParams();

  initNullColorPicker();

  if (!templateApplied) {
    const defs = getConfigDefaults();
    setSlots(defs.slots);
    setStatuses(defs.statuses);
    setDateRange(today, addDays(today, 6));
  } else {
    showTemplateBanner();
    window.scrollTo(0, 0);
  }

  // 4. Initial validation pass
  validateAll();

  // 5. Wire live validation
  createBtn.addEventListener('click', createCalendar);
  adminName.addEventListener('input', validateAll);

  // 6. Hub context when creating inside a Hub
  await initHubContext();
}());