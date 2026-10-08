/**
 * account.js - Profile page (account.html): first-time setup, profile name and private
 * username, sign-in methods, calendars and Hubs, sign out and delete account.
 * Uses window.Account (account-core.js) and window.Passkey (passkey.js). All text is set
 * with textContent.
 */
'use strict';

const $ = (id) => document.getElementById(id);

const PROVIDER_LABELS = { google: 'Google', facebook: 'Facebook', passkey: 'Passkey' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let info = null;
let signinResult = null;

/** "2026-09-26 08:51:00" / "2026-09-26" -> "26 Sep 2026". */
function formatDay(sql) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(sql || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** Same-site path from ?return=, or null. */
function returnPath() {
  const r = new URLSearchParams(location.search).get('return') || '';
  return r.startsWith('/') && !r.startsWith('//') && !/[\\\s]/.test(r) ? r : null;
}

function show(id, visible) {
  $(id).classList.toggle('hide', !visible);
}

function makeIcon(name) {
  const s = document.createElement('span');
  s.className = 'material-symbols-outlined';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = name;
  return s;
}

function listItem(iconName, main, sub, extra) {
  const li = document.createElement('li');
  li.appendChild(typeof iconName === 'string' ? makeIcon(iconName) : iconName);
  const text = document.createElement('span');
  text.className = 'acct-item-text';
  text.appendChild(main);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'acct-item-sub';
    s.textContent = sub;
    text.appendChild(s);
  }
  li.appendChild(text);
  if (extra) li.appendChild(extra);
  return li;
}

function emptyItem(listEl, message) {
  const li = document.createElement('li');
  li.className = 'acct-empty';
  li.textContent = message;
  listEl.appendChild(li);
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

function tag(text) {
  const t = document.createElement('span');
  t.className = 'acct-tag';
  t.textContent = text;
  return t;
}

// -------------------------
// Setup and profile
// -------------------------

async function saveProfile(form, errorEl, body) {
  errorEl.textContent = '';
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const r = await Account.postJson('account_update', body);
    if (!r.ok) {
      errorEl.textContent = r.data.message || 'Could not save.';
      return null;
    }
    return r.data;
  } finally {
    btn.disabled = false;
  }
}

function initSetup() {
  show('setup', true);
  $('setupUsername').value = info.username || '';
  $('setupName').value = info.display_name || '';
  $('setupUsername').focus();
  $('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = await saveProfile($('setupForm'), $('setupError'), {
      username: $('setupUsername').value.trim().toLowerCase(),
      display_name: $('setupName').value.trim(),
    });
    if (!data) return;
    const back = returnPath();
    if (back) location.href = back;
    else location.reload();
  });
}

function initProfile() {
  $('profileName').value = info.display_name || '';
  $('profileUsername').value = info.username || '';
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('profileNote').textContent = '';
    const data = await saveProfile($('profileForm'), $('profileError'), {
      username: $('profileUsername').value.trim().toLowerCase(),
      display_name: $('profileName').value.trim(),
    });
    if (!data) return;
    info.display_name = data.display_name;
    info.username = data.username;
    let note = 'Saved.';
    if (data.renamed) note += ` Your name was updated on ${data.renamed} calendar${data.renamed === 1 ? '' : 's'}.`;
    if (data.conflicts && data.conflicts.length) {
      note += ` Someone else already uses that name on: ${data.conflicts.join(', ')} - your old name was kept there.`;
    }
    $('profileNote').textContent = note;
    loadMemberships();
  });
}

// -------------------------
// Calendars and Hubs
// -------------------------

async function loadMemberships() {
  const r = await Account.getJson('account_memberships');
  const calList = $('calendarList');
  const hubList = $('hubList');
  calList.textContent = '';
  hubList.textContent = '';
  if (!r.ok) {
    emptyItem(calList, r.data.message || 'Could not load your calendars.');
    return;
  }

  if (!r.data.calendars.length) emptyItem(calList, 'No calendars yet. Open a calendar link to join, or create one from Home.');
  r.data.calendars.forEach((c) => {
    const main = link(`calendar.html?c=${encodeURIComponent(c.token)}`, c.title || 'Untitled calendar');
    const wrap = document.createElement('span');
    wrap.appendChild(main);
    if (c.role === 'admin') wrap.appendChild(tag('Organiser'));
    const parts = [];
    if (c.start_date && c.end_date) parts.push(`${formatDay(c.start_date)} - ${formatDay(c.end_date)}`);
    if (c.name_custom) parts.push(`you appear as "${c.display_name}"`);
    if (c.hub) parts.push(`in Hub "${c.hub.title || 'Untitled Hub'}"`);
    calList.appendChild(listItem('calendar_month', wrap, parts.join(' - ')));
  });

  if (!r.data.hubs.length) emptyItem(hubList, 'No Hubs yet.');
  r.data.hubs.forEach((h) => {
    const wrap = document.createElement('span');
    wrap.appendChild(link(`hub.html?g=${encodeURIComponent(h.token)}`, h.title || 'Untitled Hub'));
    if (h.is_organiser) wrap.appendChild(tag('Organiser'));
    const sub = `${h.calendar_count} calendar${h.calendar_count === 1 ? '' : 's'}`;
    hubList.appendChild(listItem('hub', wrap, sub));
  });
}

// -------------------------
// Sign-in methods
// -------------------------

function renderMethods(methods) {
  const list = $('methodList');
  list.textContent = '';
  methods.forEach((m) => {
    const name = document.createElement('strong');
    name.textContent = m.type === 'passkey' ? `Passkey - ${m.label || 'Device'}` : PROVIDER_LABELS[m.type] || m.type;
    const added = formatDay(m.created_at);
    const used = formatDay(m.last_used_at);
    const sub = (added ? `Added ${added}` : '') + (used ? ` - last used ${used}` : '');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'acct-btn acct-btn-ghost acct-btn-small';
    del.textContent = 'Remove';
    del.disabled = methods.length <= 1;
    del.title = methods.length <= 1 ? 'You need at least one way to sign in' : '';
    del.setAttribute('aria-label', `Remove ${name.textContent}`);
    del.addEventListener('click', () => removeMethod(m, del));
    list.appendChild(listItem(m.type === 'passkey' ? 'fingerprint' : Account.brandLogo(m.type), name, sub, del));
  });
  renderAddButtons(new Set(methods.map((m) => m.type)));
}

async function loadMethods() {
  const r = await Account.getJson('account_methods');
  if (r.ok) renderMethods(r.data.methods);
  else renderAddButtons();
}

async function removeMethod(m, btn) {
  const label = m.type === 'passkey' ? `the passkey on ${m.label || 'this device'}` : PROVIDER_LABELS[m.type];
  if (!confirm(`Stop signing in with ${label}?`)) return;
  btn.disabled = true;
  const r = await Account.postJson('account_remove_method', { type: m.type, id: m.id });
  if (!r.ok) {
    $('methodStatus').textContent = r.data.message || 'Could not remove it.';
    btn.disabled = false;
    return;
  }
  if (m.type === 'passkey') Passkey.signalRemoved(m.id);
  renderMethods(r.data.methods);
  $('methodStatus').textContent = 'Removed.';
}

async function addPasskey() {
  const status = $('methodStatus');
  try {
    status.textContent = 'Waiting for your fingerprint, face or screen lock...';
    const begin = await Account.postJson('account_passkey_add_begin');
    if (!begin.ok) throw new Error(begin.data.message || 'Could not start');
    const credential = await Passkey.create(begin.data.publicKey);
    const fin = await Account.postJson('account_passkey_add_finish', { credential, device_label: Passkey.deviceLabel() });
    if (!fin.ok) throw new Error(fin.data.message || 'Could not add the passkey');
    renderMethods(fin.data.methods);
    status.textContent = 'Passkey added. You can now sign in with your fingerprint, face or screen lock on this device.';
  } catch (e) {
    if (Passkey.isDuplicate(e)) status.textContent = 'This device already has a passkey for your account.';
    else status.textContent = Passkey.isCancel(e) ? '' : (e.message || 'Could not add the passkey');
  }
}

/** Google and Facebook are offered once each; passkeys can be added per device. */
function renderAddButtons(linked = new Set()) {
  const wrap = $('addMethods');
  wrap.textContent = '';
  const add = (cls, iconNode, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `acct-btn ${cls}`;
    b.appendChild(iconNode);
    const text = document.createElement('span');
    text.className = 'acct-btn-label';
    text.textContent = label;
    b.appendChild(text);
    b.addEventListener('click', onClick);
    wrap.appendChild(b);
  };
  if (info.methods.google && !linked.has('google')) wrap.appendChild(Account.googleButton('Add sign-in with Google', () => Account.startOAuth('google', 'link')));
  if (info.methods.facebook && !linked.has('facebook')) add('acct-btn-facebook', Account.brandLogo('facebook'), 'Add sign-in with Facebook', () => Account.startOAuth('facebook', 'link'));
  if (info.methods.passkey && Passkey.supported()) add('acct-btn-secondary', makeIcon('fingerprint'), 'Add a passkey on this device', addPasskey);
}

// -------------------------
// Sign out and delete
// -------------------------

function initSignOutAndDelete() {
  $('signOutBtn').addEventListener('click', async () => {
    $('signOutBtn').disabled = true;
    await Account.logout();
    location.href = 'index.html';
  });

  $('deleteStartBtn').addEventListener('click', async () => {
    const r = await Account.getJson('account_delete_preview');
    const summary = $('deleteSummary');
    summary.textContent = '';
    const lines = [];
    if (r.ok && r.data.calendars.length) lines.push(`Calendars you organise that will be deleted for everyone: ${r.data.calendars.join(', ')}.`);
    if (r.ok && r.data.hubs.length) lines.push(`Hubs you organise that will be deleted (their calendars stay): ${r.data.hubs.join(', ')}.`);
    if (!lines.length) lines.push('You do not organise any calendars or Hubs.');
    lines.forEach((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      summary.appendChild(p);
    });
    show('deleteConfirm', true);
    $('deleteStartBtn').classList.add('hide');
    $('deleteTyped').focus();
  });

  $('deleteCancelBtn').addEventListener('click', () => {
    show('deleteConfirm', false);
    $('deleteStartBtn').classList.remove('hide');
    $('deleteTyped').value = '';
    $('deleteError').textContent = '';
  });

  $('deleteBtn').addEventListener('click', async () => {
    $('deleteError').textContent = '';
    $('deleteBtn').disabled = true;
    const r = await Account.postJson('account_delete', { confirm: $('deleteTyped').value.trim().toLowerCase() });
    if (!r.ok) {
      $('deleteError').textContent = r.data.message || 'Could not delete the account.';
      $('deleteBtn').disabled = false;
      return;
    }
    alert('Your account has been deleted.');
    location.href = 'index.html';
  });
}

// -------------------------
// Start
// -------------------------

async function init() {
  signinResult = Account.takeSigninResult();
  info = await Account.me(true);
  show('loading', false);

  if (!info.signed_in) {
    show('signedOut', true);
    if (!info.available) {
      $('signInButtons').textContent = 'Sign-in is not set up on this server yet. Please try again later.';
      return;
    }
    $('signInButtons').appendChild(Account.renderSignInButtons(info.methods || {}));
    return;
  }

  if (info.needs_setup) {
    initSetup();
    return;
  }

  show('signedIn', true);
  initProfile();
  initSignOutAndDelete();
  if (signinResult === 'linked' || signinResult === 'taken') {
    $('methodStatus').textContent = Account.SIGNIN_MESSAGES[signinResult];
  }
  loadMethods();
  loadMemberships();
}

document.addEventListener('DOMContentLoaded', init);
