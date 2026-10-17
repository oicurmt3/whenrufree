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

function listItem(iconName, main, sub, extra, actions) {
  const li = document.createElement('li');
  li.appendChild(typeof iconName === 'string' ? makeIcon(iconName) : iconName);
  const text = document.createElement('span');
  text.className = 'acct-item-text';
  const body = document.createElement('span');
  body.className = 'acct-item-body';
  body.appendChild(main);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'acct-item-sub';
    s.textContent = sub;
    body.appendChild(s);
  }
  text.appendChild(body);
  // Row actions sit beside the name, and wrap under it only when the row is too narrow
  if (actions) text.appendChild(actions);
  li.appendChild(text);
  if (extra) li.appendChild(extra);
  return li;
}

function emptyItem(listEl, message, linkHref, linkText) {
  const li = document.createElement('li');
  li.className = 'acct-empty';
  li.appendChild(document.createTextNode(message));
  if (linkHref && linkText) li.appendChild(link(linkHref, linkText));
  listEl.appendChild(li);
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

function tag(text, extraClass) {
  const t = document.createElement('span');
  t.className = extraClass ? `acct-tag ${extraClass}` : 'acct-tag';
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
  $('setupUsernameValue').textContent = info.username || 'generated when you save';
  $('setupName').value = info.display_name || '';
  $('setupName').focus();
  $('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = await saveProfile($('setupForm'), $('setupError'), {
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
  $('profileUsernameValue').textContent = info.username || 'not assigned';
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('profileNote').textContent = '';
    const data = await saveProfile($('profileForm'), $('profileError'), {
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

/**
 * The buttons under a calendar on the profile page: organisers can put it in a Hub or delete it
 * for everyone, everyone else removes their own name and choices. Both confirm first, then
 * reload the list.
 */
function calendarActions(c) {
  const wrap = document.createElement('span');
  wrap.className = 'acct-item-actions';
  const title = c.title || 'Untitled calendar';
  if (c.role === 'admin') {
    // Hub first, then the destructive action last
    const hubBtn = document.createElement('button');
    hubBtn.type = 'button';
    hubBtn.className = 'acct-btn acct-btn-secondary acct-btn-small acct-btn-iconable';
    hubBtn.appendChild(makeIcon('hub'));
    hubBtn.appendChild(buttonText('Hub'));
    hubBtn.title = c.hub ? `Move ${title} to another Hub` : `Add ${title} to a Hub`;
    hubBtn.setAttribute('aria-label', hubBtn.title);
    hubBtn.addEventListener('click', () => openHubPicker(c, hubBtn));
    wrap.appendChild(hubBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'acct-btn acct-btn-danger acct-btn-small acct-btn-iconable';
    delBtn.appendChild(makeIcon('delete'));
    delBtn.appendChild(buttonText('Delete calendar'));
    delBtn.setAttribute('aria-label', `Delete ${title} for everyone`);
    delBtn.addEventListener('click', () => deleteCalendar(c, title, delBtn));
    wrap.appendChild(delBtn);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acct-btn acct-btn-ghost acct-btn-small';
    btn.textContent = 'Leave calendar';
    btn.setAttribute('aria-label', `Leave ${title} and remove your choices`);
    btn.addEventListener('click', () => leaveCalendar(c, title, btn));
    wrap.appendChild(btn);
  }
  return wrap;
}

/** The label half of a button whose text collapses to its icon on narrow screens. */
function buttonText(label) {
  const s = document.createElement('span');
  s.className = 'acct-btn-text';
  s.textContent = label;
  return s;
}

function calendarStatus(message) {
  const el = $('calendarStatus');
  if (el) el.textContent = message;
}

// Last account_memberships payload, so the Hub picker opens instantly instead of refetching.
let lastMemberships = null;

function closeHubPicker() {
  show('hubPickModal', false);
}

/**
 * The Hub a calendar should belong to. Lists every Hub the account organises or has opened,
 * organisers first. Each row carries the action it performs: an add icon for Hubs it is not in,
 * a delete icon on the Hub it is in now (which takes the calendar back out).
 * @param {object} c - calendar row from accountMemberships()
 */
function openHubPicker(c) {
  const list = $('hubPickList');
  const errorEl = $('hubPickError');
  const title = c.title || 'Untitled calendar';
  errorEl.textContent = '';
  list.textContent = '';
  $('hubPickCalName').textContent = title;
  $('hubPickTitle').textContent = c.hub ? 'Move to a Hub' : 'Add to a Hub';
  show('hubPickModal', true);

  const hubs = ((lastMemberships && lastMemberships.hubs) || []).slice()
    .sort((a, b) => (b.is_organiser ? 1 : 0) - (a.is_organiser ? 1 : 0));
  if (!hubs.length) {
    emptyItem(list, 'No Hubs yet. ', 'hub.html?create=1', 'Create a Hub.');
    return;
  }

  hubs.forEach((h) => {
    const current = !!c.hub && c.hub.token === h.token;
    // Hubs take calendars from their organiser only unless they have opened adds up
    const locked = !current && !h.is_organiser && !h.allow_member_calendars;
    const hubTitle = h.title || 'Untitled Hub';
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = current ? 'acct-btn acct-btn-ghost hub-pick-btn hub-pick-btn-current' : 'acct-btn acct-btn-ghost hub-pick-btn';
    btn.appendChild(makeIcon('hub'));

    const text = document.createElement('span');
    text.className = 'hub-pick-text';
    const name = document.createElement('span');
    name.className = 'hub-pick-name';
    name.textContent = hubTitle;
    const sub = document.createElement('span');
    sub.className = 'hub-pick-sub';
    sub.textContent = `${h.calendar_count} calendar${h.calendar_count === 1 ? '' : 's'}`
      + (h.is_organiser ? ' - you organise it' : '')
      + (current ? ' - current' : '')
      + (locked ? ' - organiser adds only' : '');
    text.appendChild(name);
    text.appendChild(sub);
    btn.appendChild(text);

    // Add for Hubs it can go into, delete for the one it is in now
    const action = makeIcon(current ? 'delete' : (locked ? 'lock' : 'add_circle'));
    action.classList.add('hub-pick-action');
    btn.appendChild(action);

    if (locked) {
      btn.disabled = true;
      btn.title = `Only the organiser adds calendars to "${hubTitle}"`;
    } else {
      btn.title = current
        ? `Remove from "${hubTitle}"`
        : (c.hub ? `Move to "${hubTitle}"` : `Add to "${hubTitle}"`);
    }
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => (current
      ? unlinkCalendarFromHub(c, btn)
      : linkCalendarToHub(c, h, btn)));

    li.appendChild(btn);
    list.appendChild(li);
  });
}

/**
 * Puts the calendar in the chosen Hub. If it is already in one, it is moved: the old link is
 * removed first, so a failed add is reported as "no longer in any Hub" rather than leaving the
 * user guessing which Hub it ended up in.
 */
async function linkCalendarToHub(c, h, btn) {
  const errorEl = $('hubPickError');
  const title = c.title || 'Untitled calendar';
  const hubTitle = h.title || 'Untitled Hub';
  const moving = !!c.hub && c.hub.token !== h.token;

  if (moving) {
    const ok = confirm(
      `Move "${title}" from "${c.hub.title || 'Untitled Hub'}" to "${hubTitle}"?\n\n` +
      'It will disappear from the old Hub and appear in the new one.'
    );
    if (!ok) return;
  }

  errorEl.textContent = '';
  btn.disabled = true;
  if (moving) {
    const rm = await Account.postJson('remove_calendar_from_group', {}, { c: c.token });
    if (!rm.ok) {
      errorEl.textContent = rm.data.message || 'Could not remove it from its current Hub.';
      btn.disabled = false;
      return;
    }
  }
  const r = await Account.postJson('add_calendar_to_group', { group_token: h.token }, { c: c.token, g: h.token });
  if (!r.ok) {
    const message = r.data.message || 'Could not add it to that Hub.';
    errorEl.textContent = moving ? `${message} It is no longer in any Hub.` : message;
    btn.disabled = false;
    return;
  }
  closeHubPicker();
  await loadMemberships();
  calendarStatus(`"${title}" is now in Hub "${hubTitle}".`);
}

/** Takes the calendar out of its Hub. The calendar itself is untouched and stays at its own link. */
async function unlinkCalendarFromHub(c, btn) {
  const errorEl = $('hubPickError');
  const title = c.title || 'Untitled calendar';
  const hubTitle = (c.hub && c.hub.title) || 'Untitled Hub';
  const ok = confirm(
    `Remove "${title}" from "${hubTitle}"?\n\nThe calendar stays open at its own link; it just stops appearing in that Hub.`
  );
  if (!ok) return;
  errorEl.textContent = '';
  btn.disabled = true;
  const r = await Account.postJson('remove_calendar_from_group', {}, { c: c.token });
  if (!r.ok) {
    errorEl.textContent = r.data.message || 'Could not remove it from that Hub.';
    btn.disabled = false;
    return;
  }
  closeHubPicker();
  await loadMemberships();
  calendarStatus(`"${title}" was removed from Hub "${hubTitle}".`);
}

async function leaveCalendar(c, title, btn) {
  const ok = confirm(
    `Leave "${title}"?\n\nYour name and every choice you made on it will be removed. ` +
    'The calendar itself stays for everyone else, and opening the link again joins you back with a blank calendar.'
  );
  if (!ok) return;
  calendarStatus('');
  btn.disabled = true;
  const r = await Account.postJson('account_leave_calendar', {}, { c: c.token });
  if (!r.ok) {
    calendarStatus(r.data.message || 'Could not leave the calendar.');
    btn.disabled = false;
    return;
  }
  await loadMemberships();
  calendarStatus(`You left "${title}".`);
}

async function deleteCalendar(c, title, btn) {
  const ok = confirm(
    `Delete "${title}" for everyone?\n\n` +
    'Every name and every answer on it will be deleted, and the link will stop working. ' +
    'This cannot be undone.'
  );
  if (!ok) return;
  calendarStatus('');
  btn.disabled = true;
  const r = await Account.postJson('account_delete_calendar', {}, { c: c.token });
  if (!r.ok) {
    calendarStatus(r.data.message || 'Could not delete the calendar.');
    btn.disabled = false;
    return;
  }
  await loadMemberships();
  calendarStatus(`"${title}" was deleted.`);
}

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
  lastMemberships = r.data;
  if (!r.data.calendars.length) emptyItem(calList, 'No calendars yet. Open a calendar link to join, or create one from Home.');
  r.data.calendars.forEach((c) => {
    const main = link(`calendar.html?c=${encodeURIComponent(c.token)}`, c.title || 'Untitled calendar');
    const wrap = document.createElement('span');
    wrap.appendChild(main);
    if (c.role === 'admin') wrap.appendChild(tag('Organiser'));
    if (c.blocked) wrap.appendChild(tag('Blocked', 'acct-tag-muted'));
    const parts = [];
    if (c.start_date && c.end_date) parts.push(`${formatDay(c.start_date)} - ${formatDay(c.end_date)}`);
    if (c.name_custom) parts.push(`you appear as "${c.display_name}"`);
    if (c.hub) parts.push(`in Hub "${c.hub.title || 'Untitled Hub'}"`);
    calList.appendChild(listItem('calendar_month', wrap, parts.join(' - '), null, calendarActions(c)));
  });

  if (!r.data.hubs.length) emptyItem(hubList, 'No Hubs yet. ', 'hub.html?create=1', 'Create a Hub.');
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
    $('deleteTypedLabel').textContent = info.username
      ? `Type your private username (${info.username}) to confirm`
      : 'Type your private username to confirm';
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

  // Hub picker: closes on the button, the backdrop, or Escape
  $('hubPickClose').addEventListener('click', closeHubPicker);
  $('hubPickCancel').addEventListener('click', closeHubPicker);
  $('hubPickModal').addEventListener('click', (e) => {
    if (e.target === $('hubPickModal')) closeHubPicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('hubPickModal').classList.contains('hide')) closeHubPicker();
  });

  if (signinResult === 'linked' || signinResult === 'taken') {
    $('methodStatus').textContent = Account.SIGNIN_MESSAGES[signinResult];
  }
  loadMethods();
  loadMemberships();
}

document.addEventListener('DOMContentLoaded', init);
