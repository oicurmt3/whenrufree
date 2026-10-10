/**
 * calendar-users.js - Calendar page people: meta load, your name (signed-in account), people modal, submit/user UI, Hub bar, settings, join/rename, claiming an old PIN name.
 * Classic script sharing global scope. Load order: passkey.js, account-core.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
 */
'use strict';

/*** Load meta incl. slots and date range */
async function loadCalendarMeta(){
  const pageUrl = new URL(window.location.href);
  const metaParams = {};
  if (pageUrl.searchParams.get('from_hub') === '1') {
    metaParams.from_hub = '1';
    const hubTok = pageUrl.searchParams.get('g');
    if (hubTok) metaParams.g = hubTok;
  }
  const meta = await apiGet('calendar_meta', metaParams);
  if(meta.status==='success' && meta.calendar){
    const t=(meta.calendar.title??'').toString().trim();
    const cat=meta.calendar.category ?? 'groups';
    state.calendarTitle=t;
    state.calendarCategories=parseCategories(cat);
    state.accessAvailable = meta.calendar.access?.available === true;
    state.account = meta.account || { profile_name: '', me: null, claimable: false };
    applyMe(state.account.me);
    setCalendarHeading(t, cat);
    const slots = Array.isArray(meta.calendar.slots) ? meta.calendar.slots : null;
    if(slots && slots.length){ TIME_SLOTS = slots.map(s=>({id:s, label:s})); }

    // Booking mode must be known before the legend is drawn
    const cap = parseInt(meta.calendar.slot_capacity, 10);
    const per = parseInt(meta.calendar.max_per_user, 10);
    state.booking = cap >= 1
      ? {
          capacity: cap,
          perUser: per >= 1 ? per : null,
          perUserTotal: per >= 1 && meta.calendar.per_user_total === true,
          closed: meta.calendar.bookings_closed === true,
          partialLabel: bookingStateName(meta.calendar.partial_label, 'Partly booked'),
          fullLabel: bookingStateName(meta.calendar.full_label, 'Full')
        }
      : null;
    if(state.booking){
      applyBookingColors(meta.calendar.partial_color, meta.calendar.full_color);
      applyBookingChrome();
    }

    // Custom status options (1..5). Falls back to defaults if absent/invalid.
    applyStatusOptions(meta.calendar.statuses ?? null);
    state.startDate = meta.calendar.start_date ?? null;
    state.endDate = meta.calendar.end_date ?? null;

    // FIX: coerce exclude_weekends correctly (PHP may send "0"/"1" as strings)
    const exw = meta.calendar.exclude_weekends;
    state.excludeWeekends = (exw === 1 || exw === '1' || exw === true);

    // Date filter mode and selected dates
    const dfm = (meta.calendar.date_filter_mode || 'all').toString();
    state.dateFilterMode = ['all', 'only', 'except'].includes(dfm) ? dfm : 'all';
    state.dateFilterDates = Array.isArray(meta.calendar.date_filter_dates)
      ? meta.calendar.date_filter_dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      : [];
    state.dateFilterDirty = false;

    // Privacy mode: 0=open, 1=hidden, 2=blind
    const priv = meta.calendar.is_private;
    if (priv === 2 || priv === '2') {
      state.privacyMode = 'blind';
    } else if (priv === 1 || priv === '1') {
      state.privacyMode = 'hidden';
    } else {
      state.privacyMode = 'open';
    }
    // Invite only (own or the Hub's) and private names; set at creation
    state.inviteOnly = meta.calendar.invite_only === true;
    state.inviteViaHub = meta.calendar.invite_via_hub === true;
    state.namesPrivate = meta.calendar.names_private === true;
    state.organiserMarks = meta.calendar.organiser_marks !== false;
    state.organiserMarksAvailable = meta.calendar.organiser_marks_available === true;
    // Colour of Slots nobody has answered yet (migrations/012); null = the default light grey
    state.nullColorAvailable = meta.calendar.null_color_available === true;
    state.nullColor = typeof meta.calendar.null_color === 'string' ? meta.calendar.null_color : null;
    applyNullColor(state.nullColor);
    // Blocking can offer a report once the reports table exists (migrations/011)
    state.reportsAvailable = meta.calendar.reports_available === true;
    state.reportReasons = meta.calendar.report_reasons && typeof meta.calendar.report_reasons === 'object'
      ? meta.calendar.report_reasons : null;
    state.pendingRequests = Number.isInteger(meta.calendar.pending_requests) ? meta.calendar.pending_requests : null;
    updatePeopleBadge();
    updatePrivacyIndicator();

    // Rank sort order: 'score' (default) or 'date' (chronological)
    const rso = (meta.calendar.rank_sort_order || 'score').toString();
    state.rankSortOrder = (rso === 'date') ? 'date' : 'score';
    updateSortToggleUI();

    // Organiser message and max length (limit defined server-side)
    state.organiserMessage = (meta.calendar.organiser_message || '').toString().trim();
    const msgMax = parseInt(meta.calendar.organiser_message_max, 10);
    if(msgMax > 0) state.organiserMessageMax = msgMax;
    updateOrganiserMessageUI();

    // Chosen (locked-in) date+slot: null if calendar is still open
    state.chosenDate = meta.calendar.chosen_date || null;
    state.chosenSlot = meta.calendar.chosen_slot || null;

    // Hub membership breadcrumb
    state.hubGroup = (meta.calendar.group && meta.calendar.group.token)
      ? { token: meta.calendar.group.token, title: meta.calendar.group.title || 'Hub' }
      : null;
    updateHubBarUI();

    if(state.startDate && state.endDate){
      els.monthLabel.textContent = formatDateRange(state.startDate, state.endDate);
    }
    // Toggle grid class to switch to 5 columns only when excluding weekends
    if (state.excludeWeekends) {
      els.calendarGrid.classList.add('weekdays-only');
    } else {
      els.calendarGrid.classList.remove('weekdays-only');
    }
  }
}

/**
 * Makes the signed-in account's name on this calendar the current user (or clears it).
 * @param {{id:number, display_name:string, role:string, name_custom:boolean}|null} me
 */
function applyMe(me){
  state.auth = new Map();
  if(!me){
    state.currentUserId = null;
    state.currentUserName = '';
    state.currentUserRole = null;
    state.nameCustom = false;
    return;
  }
  const id = Number(me.id);
  state.currentUserId = id;
  state.currentUserName = me.role === 'admin' ? `${me.display_name} (organiser)` : me.display_name;
  state.currentUserRole = me.role;
  state.nameCustom = me.name_custom === true;
  state.auth.set(id, { token: true, role: me.role });
}

/** Opens the Join window when you have no name on this calendar yet. */
function promptJoin(){
  if(state.currentUserId) return;
  openUserModal('add');
}

/*** Users include role; admin first with "(admin)" */
async function loadUsers(){
  const data = await apiGet('users');
  if(data.status!=='success') throw new Error('Failed to load users');
  state.users = (data.users??[]).map(u => ({
    id:Number(u.id), display_name:u.display_name, role:(u.role??'member'), mine:u.mine === true, claimable:u.claimable === true,
    blocked:u.blocked === true
  }));
  // Private names: the list only has you, the organisers and old names; total counts everyone
  state.usersTotal = Number.isInteger(data.total) ? data.total : state.users.length;
  state.namesHidden = data.names_hidden === true;
  // admin first
  state.users.sort((a,b)=> (a.role==='admin'? -1:0) + (b.role==='admin'? 1:0));
  // Cache admin user ID for organiser dots
  const admin = state.users.find(u => u.role === 'admin');
  state.adminUserId = admin ? admin.id : null;
  // Keep the read-only view only while that person can still be viewed
  if(state.viewUserId){
    const viewed = state.users.find(u => u.id === state.viewUserId);
    if(canViewUser(viewed)) setViewBarText(viewed);
    else closeUserView();
  }
}

/*** Read-only view of someone else's calendar (People list) */
function setViewBarText(u){
  const text = document.getElementById('viewBarText');
  const name = document.createElement('b');
  name.textContent = u.display_name;
  text.textContent = '';
  text.append('Viewing ', name);
  // The hint only applies once you have a name here, otherwise there is no edge to compare
  const hint = document.getElementById('viewBarHint');
  if(hint) hint.hidden = !state.currentUserId;
}

function openUserView(u){
  if(!canViewUser(u)) return;
  state.viewUserId = u.id;
  setViewBarText(u);
  document.getElementById('viewBar').hidden = false;
  const section = document.querySelector('.calendar-section');
  section.classList.add('is-viewing');
  refreshCalendarValues();
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeUserView(){
  if(!state.viewUserId) return;
  state.viewUserId = null;
  document.getElementById('viewBar').hidden = true;
  document.querySelector('.calendar-section').classList.remove('is-viewing');
  refreshCalendarValues();
}

/*** Header state for your name here: People button tooltip, organiser marker, join banner */
function updateCurrentUserDisplay(){
  const u = state.currentUserId ? state.users.find(x => x.id === state.currentUserId) : null;
  if(u){
    const displayText = u.role === 'admin' ? `${u.display_name} (organiser)` : u.display_name;
    els.userSelectBtn.classList.add('has-user');
    els.userSelectBtn.title = `People and your name (${displayText})`;
  } else {
    els.userSelectBtn.classList.remove('has-user');
    els.userSelectBtn.title = 'People';
  }
  markBadgeOrganiser(!!u && u.role === 'admin');
  // Join banner until you have a name here
  els.nameBanner.style.display = state.currentUserId ? 'none' : '';
}

/** Account badge: organiser icon and tint while you organise this calendar. */
function markBadgeOrganiser(isOrganiser){
  const badge = els.accountBadge && els.accountBadge.querySelector('.acct-badge');
  if(!badge) return;
  if(badge.dataset.label === undefined) badge.dataset.label = badge.getAttribute('aria-label') || '';
  badge.classList.toggle('is-organiser', isOrganiser);
  const icon = badge.querySelector('.material-symbols-outlined');
  if(icon) icon.textContent = isOrganiser ? 'admin_panel_settings' : 'account_circle';
  badge.setAttribute('aria-label', badge.dataset.label + (isOrganiser ? ', organiser of this calendar' : ''));
  badge.title = isOrganiser
    ? "You're the organiser of this calendar. Tap for your profile, calendars and Hubs"
    : 'Your profile, calendars and Hubs';
}

/*** People button badge: requests waiting (whoever decides them) */
function updatePeopleBadge(){
  const badge = document.getElementById('peopleBadge');
  if(!badge) return;
  const n = state.pendingRequests || 0;
  badge.hidden = n < 1;
  badge.textContent = n > 99 ? '99+' : String(n);
  const label = state.currentUserId ? 'People on this calendar and your name' : 'People on this calendar';
  els.userSelectBtn.setAttribute('aria-label', n > 0
    ? `${label}, ${n} ${n === 1 ? 'request' : 'requests'} waiting`
    : label);
}

/*** People modal: everyone on the calendar, your name first */
function populateUserSelectModal(){
  els.userSelectList.innerHTML = '';
  els.userSelectAddLink.style.display = state.currentUserId ? 'none' : '';
  const introText = document.getElementById('userSelectIntroText');
  if(state.namesHidden){
    const n = state.usersTotal;
    const verb = state.booking ? 'booked' : 'joined';
    introText.textContent = `Names are private on this calendar. ${n} ${n === 1 ? 'person has' : 'people have'} ${verb}.`;
  } else {
    introText.textContent = 'Everyone on this calendar.';
  }

  if(state.users.length === 0){
    const empty = document.createElement('div');
    empty.className = 'user-select-empty';
    empty.textContent = 'Nobody has joined yet.';
    els.userSelectList.appendChild(empty);
    return;
  }

  const isOrganiser = isCurrentUserOrganiser();
  const canClaim = !state.currentUserId;

  // You first, then the organiser, then alphabetical
  const sortedUsers = [...state.users].sort((a, b) => {
    if(a.mine !== b.mine) return a.mine ? -1 : 1;
    if(a.role === 'admin' && b.role !== 'admin') return -1;
    if(a.role !== 'admin' && b.role === 'admin') return 1;
    return (a.display_name || '').localeCompare(b.display_name || '');
  });

  for(const u of sortedUsers){
    const item = document.createElement('div');
    item.className = 'user-select-item';
    if(u.mine) item.classList.add('selected');
    if(u.blocked) item.classList.add('is-blocked');
    item.dataset.userId = u.id;

    const avatar = document.createElement('div');
    avatar.className = 'user-select-avatar';
    if(u.role === 'admin') avatar.classList.add('admin');
    avatar.textContent = (u.display_name || '?').charAt(0).toUpperCase();

    const info = document.createElement('div');
    info.className = 'user-select-info';
    const name = document.createElement('div');
    name.className = 'user-select-name';
    name.textContent = u.mine ? `${u.display_name} (you)` : u.display_name;
    info.appendChild(name);

    const canView = canViewUser(u);
    const roleText = u.role === 'admin' ? 'Organiser' : (u.blocked ? 'Blocked' : '');
    const claimText = canClaim && u.claimable ? 'Yours from before? Tap to claim it' : '';
    const viewing = canView && u.id === state.viewUserId;
    const viewText = viewing ? 'Showing' : '';
    if(roleText || claimText || viewText){
      const role = document.createElement('div');
      role.className = 'user-select-role';
      role.textContent = [roleText, claimText, viewText].filter(Boolean).join(' - ');
      info.appendChild(role);
    }

    item.appendChild(avatar);
    item.appendChild(info);

    if(u.mine){
      const editBtn = document.createElement('button');
      editBtn.className = 'user-select-edit';
      editBtn.type = 'button';
      editBtn.title = 'Change your name on this calendar';
      editBtn.setAttribute('aria-label', editBtn.title);
      editBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">person_edit</span>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeUserSelectModal();
        openUserModal('rename');
      });
      item.appendChild(editBtn);
    } else if(canView){
      const viewBtn = document.createElement('button');
      viewBtn.className = 'user-select-view' + (viewing ? ' is-on' : '');
      viewBtn.type = 'button';
      viewBtn.title = (viewing ? 'Hide ' : 'Show ') + u.display_name + "'s Slots";
      viewBtn.setAttribute('aria-label', viewBtn.title);
      viewBtn.setAttribute('aria-pressed', viewing ? 'true' : 'false');
      viewBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${viewing ? 'visibility_off' : 'visibility'}</span>`;
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleUserView(u);
      });
      item.appendChild(viewBtn);
    }

    // Organiser: one control for everything about this person (block / unblock, delete, report)
    if(isOrganiser && u.role !== 'admin'){
      const manageBtn = document.createElement('button');
      manageBtn.className = 'user-select-manage';
      manageBtn.type = 'button';
      manageBtn.title = 'Manage ' + u.display_name;
      manageBtn.setAttribute('aria-label', manageBtn.title);
      manageBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">more_vert</span>';
      manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openManageModal(u);
      });
      item.appendChild(manageBtn);
    }

    if(u.mine || (canClaim && u.claimable) || canView){
      item.classList.add('is-clickable');
      item.addEventListener('click', () => onUserSelectItemClick(u.id));
    }

    els.userSelectList.appendChild(item);
  }
}

function openUserSelectModal(){
  populateUserSelectModal();
  els.userSelectModal.classList.add('active');
  loadPeopleRequests();
}

/** After a change to who is in: reload people, answers and Best Match. */
async function refreshPeopleAndViews(){
  await loadUsers();
  populateUserSelectModal();
  await ensureDateRangeLoaded();
  renderDateRangeSkeleton();
  refreshCalendarValues();
  renderRankings();
}

// -------------------------
// Manage one person (organiser): block / unblock, delete, report
// -------------------------

/**
 * Open the manage modal for one person. The toggle starts on their current status, so the hint
 * reads as a statement of where they stand and moving it is the change; delete and report are
 * opt-in extras.
 */
function openManageModal(u){
  if(!els.manageUserModal) return;
  state.manage = {
    user: u,
    currentBlocked: u.blocked === true,
    blocked: u.blocked === true ? 1 : 0, // Starts on their current status
    delete: false,
    reason: '',
    details: '',
  };
  const name = u.display_name;
  els.manageUserTitle.textContent = `Manage ${name}`;
  els.manageUserText.textContent = `Block or unblock ${name}, delete them from this calendar, or report them to the super admin. You can combine these.`;
  els.manageDelete.checked = false;
  els.manageReason.value = '';
  els.manageDetails.value = '';
  els.manageUserError.textContent = '';

  // Reporting only exists once migrations/011 has been applied
  const reportable = state.reportsAvailable === true;
  els.manageReportRow.hidden = !reportable;
  els.manageReportFields.hidden = !reportable;
  els.manageReportNone.hidden = reportable;
  if(reportable) fillManageReasons();

  setManageBlock(u.blocked ? 1 : 0);
  updateManageState();
  els.manageUserModal.classList.add('active');
  els.manageUserCancel.focus();
}

function closeManageModal(){
  if(els.manageUserModal) els.manageUserModal.classList.remove('active');
  state.manage = null;
}

/** Two-way toggle: the button you press is the status that will be applied. */
function setManageBlock(value){
  const v = Number(value) === 1 ? 1 : 0;
  if(state.manage) state.manage.blocked = v;
  els.manageBlockToggle.querySelectorAll('.block-mode').forEach(b => {
    const on = Number(b.dataset.blocked) === v;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  updateManageState();
}

/** Reason options come from the server (includes/reports.php) so both sides agree. */
function fillManageReasons(){
  const sel = els.manageReason;
  if(!sel || sel.dataset.filled === '1') return;
  sel.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No report';
  sel.appendChild(none);
  const reasons = state.reportReasons;
  const entries = reasons && typeof reasons === 'object' ? Object.entries(reasons) : [];
  for(const [key, label] of entries){
    const o = document.createElement('option');
    o.value = key;
    o.textContent = String(label);
    sel.appendChild(o);
  }
  sel.dataset.filled = '1';
}

/**
 * Reflect the choices. Block and Delete are independent, so the toggle stays live even when
 * deleting (a change of mind is one tap away). The toggle opens on the person's current status,
 * so Confirm lights up once something would actually happen: a delete, a report, or a block
 * choice that differs from where they stand. The line under the toggle names the selected status.
 */
function updateManageState(){
  const m = state.manage;
  if(!m) return;
  const name = m.user.display_name;
  els.manageBlockHint.textContent = m.blocked === 1
    ? `${name} is blocked and their answers are hidden.`
    : `${name} can use this calendar as normal.`;
  els.manageDeleteHint.hidden = !m.delete;
  const currentAsInt = m.currentBlocked ? 1 : 0;
  const changes = m.delete || m.reason !== '' || m.blocked !== currentAsInt;
  els.manageUserConfirm.disabled = !changes;
  els.manageUserConfirm.classList.toggle('btn-danger', m.delete);
  els.manageUserConfirm.classList.toggle('btn-confirm', !m.delete);
}

/**
 * Plain sentences for the review popup: only what will actually happen. Delete wins over block,
 * because a deleted person has no row left to block, and the block line only appears when their
 * access really changes.
 */
function manageChoiceLines(){
  const m = state.manage;
  if(!m) return [];
  const name = m.user.display_name;
  const lines = [];
  if(m.delete){
    lines.push({ danger: true, text: `Delete: Permanently remove ${name} and their answers.` });
  } else if(m.blocked !== (m.currentBlocked ? 1 : 0)){
    if(m.blocked === 1){
      lines.push({ text: `Block: ${name} is blocked from this calendar and their answers are hidden. You can Unblock them.` });
    } else {
      lines.push({ text: `Unblock: ${name} can open this calendar again.` });
    }
  }
  if(m.reason !== ''){
    const label = (state.reportReasons && state.reportReasons[m.reason]) || m.reason;
    lines.push({ text: `Report to the super admin: ${label}${m.details ? ` - "${m.details}"` : ''}` });
  }
  return lines;
}

/** Second level: show the choices before anything is applied. */
function openConfirmChoices(){
  const m = state.manage;
  if(!m) return;
  els.choiceList.textContent = '';
  for(const line of manageChoiceLines()){
    const li = document.createElement('li');
    li.className = line.danger ? 'choice-item choice-danger' : 'choice-item';
    li.textContent = line.text;
    els.choiceList.appendChild(li);
  }
  els.choiceError.textContent = '';
  els.choiceApply.classList.toggle('btn-danger', m.delete);
  els.choiceApply.classList.toggle('btn-confirm', !m.delete);
  els.choiceModal.classList.add('active');
  els.choiceBack.focus();
}

/** Back returns to the manage modal with every choice still in place. */
function closeConfirmChoices(){
  if(els.choiceModal) els.choiceModal.classList.remove('active');
}

/**
 * Apply the choices in one call. The server writes the report first, then the block, then the
 * delete (which removes the row). A failure keeps the popup open so nothing is half-guessed.
 */
async function applyManageChoices(){
  const m = state.manage;
  if(!m) return;
  const btn = els.choiceApply;
  btn.disabled = true;
  els.choiceError.textContent = '';
  try{
    const body = { user_id: m.user.id };
    if(m.delete) body.delete = 1;
    else body.blocked = m.blocked;
    if(m.reason !== ''){
      body.report_reason = m.reason;
      if(m.details) body.report_details = m.details;
    }
    const res = await apiPost('manage_calendar_user', body);
    if(res.status !== 'success'){
      els.choiceError.textContent = res.message || 'Could not save that.';
      return;
    }
    const name = m.user.display_name;
    const parts = [];
    if(res.deleted) parts.push('deleted');
    else if(res.blocked !== m.currentBlocked) parts.push(res.blocked ? 'blocked' : 'unblocked');
    if(res.reported) parts.push('reported');
    if(parts.length === 0) parts.push('left unchanged');
    closeConfirmChoices();
    closeManageModal();
    showToast(`${name} ${parts.join(' and ')}`);
    await refreshPeopleAndViews();
  } catch(e){
    console.error('Error managing person:', e);
    els.choiceError.textContent = 'Could not save that.';
  } finally {
    btn.disabled = false;
  }
}

/*** Invite only: requests in the People modal (organiser) */
async function loadPeopleRequests(){
  const wrap = document.getElementById('userRequestsWrap');
  if(!wrap) return;
  wrap.textContent = '';
  wrap.hidden = !(state.inviteOnly && isCurrentUserOrganiser());
  if(wrap.hidden) return;
  const data = await apiGet('access_requests');
  if(data.status !== 'success'){ wrap.hidden = true; return; }
  if(!data.requests){
    const note = document.createElement('p');
    note.className = 'modal-note';
    note.textContent = data.managed_by === 'hub'
      ? 'This calendar is in an invite only Hub: the Hub organiser approves requests on the Hub page.'
      : 'Requests are not available.';
    wrap.appendChild(note);
    return;
  }
  renderPeopleRequests(data.requests);
}

function requestRow(req, actions){
  const row = document.createElement('div');
  row.className = 'user-request-row';
  const name = document.createElement('span');
  name.className = 'user-request-name';
  name.textContent = req.display_name || 'Unnamed';
  row.appendChild(name);
  const box = document.createElement('div');
  box.className = 'user-request-actions';
  for(const a of actions){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-sm ${a.cls}`;
    b.textContent = a.label;
    b.setAttribute('aria-label', `${a.label} ${req.display_name || ''}`.trim());
    b.addEventListener('click', () => decidePeopleRequest(a.decision, req.id, b));
    box.appendChild(b);
  }
  row.appendChild(box);
  return row;
}

function renderPeopleRequests(lists){
  const wrap = document.getElementById('userRequestsWrap');
  wrap.textContent = '';
  const pending = lists.pending || [];
  const declined = lists.declined || [];
  state.pendingRequests = pending.length;
  updatePeopleBadge();

  const head = document.createElement('div');
  head.className = 'user-requests-head';
  const h = document.createElement('h3');
  h.textContent = `Requests (${pending.length})`;
  head.appendChild(h);
  if(pending.length > 1){
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'btn btn-ghost btn-sm';
    all.textContent = 'Approve all';
    all.addEventListener('click', () => {
      if(confirm(`Approve all ${pending.length} requests?`)) decidePeopleRequest('approve_all', null, all);
    });
    head.appendChild(all);
  }
  wrap.appendChild(head);

  if(!pending.length){
    const none = document.createElement('p');
    none.className = 'modal-note';
    none.textContent = 'No requests waiting. Approved people can then join with their own name.';
    wrap.appendChild(none);
  }
  pending.forEach(r => wrap.appendChild(requestRow(r, [
    { label: 'Approve', cls: 'btn-confirm', decision: 'approve' },
    { label: 'Decline', cls: 'btn-cancel', decision: 'decline' }
  ])));

  if(declined.length){
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = `Declined (${declined.length})`;
    det.appendChild(sum);
    declined.forEach(r => det.appendChild(requestRow(r, [
      { label: 'Approve', cls: 'btn-ghost', decision: 'approve' }
    ])));
    wrap.appendChild(det);
  }
}

async function decidePeopleRequest(decision, requestId, btn){
  btn.disabled = true;
  try{
    const body = { decision };
    if(requestId !== null) body.request_id = requestId;
    const res = await apiPost('decide_access_request', body);
    if(res.status !== 'success'){
      showToast(res.message || 'Could not save that');
      return;
    }
    renderPeopleRequests(res.requests || {});
    if(decision !== 'decline') showToast(decision === 'approve_all' ? 'All approved' : 'Approved');
  } catch(e){
    console.error('Error deciding request:', e);
    showToast('Could not save that');
  } finally {
    btn.disabled = false;
  }
}

function closeUserSelectModal(){
  els.userSelectModal.classList.remove('active');
}

/*** People modal: tap your name to see your own Slots, an old name to claim it, or someone else to see theirs */
function onUserSelectItemClick(userId){
  const uid = Number(userId);
  const u = state.users.find(x => x.id === uid);
  if(!u) return;
  if(u.mine){
    closeUserSelectModal();
    closeUserView();
    document.querySelector('.calendar-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if(!state.currentUserId && u.claimable){
    closeUserSelectModal();
    openClaimModal(u);
  } else if(canViewUser(u)){
    toggleUserView(u);
  }
}

/** Show someone's Slots (closes the People list), or hide them again (list stays open). */
function toggleUserView(u){
  if(state.viewUserId === u.id){
    closeUserView();
    populateUserSelectModal();
  } else {
    closeUserSelectModal();
    openUserView(u);
  }
}

/*** UI state */
function updateSubmitButtonState(){
  const hasAnyPending = Object.keys(state.pending).length > 0;
  if(hasAnyPending){
    els.submitBtn.disabled=false;
    els.submitBtn.classList.remove('is-saved'); els.submitBtn.classList.add('is-submit','unsaved');
    els.submitBtnIcon.textContent='check';
    els.submitBtn.title='Submit'; els.submitBtn.setAttribute('aria-label','Submit');
  } else {
    els.submitBtn.disabled=true;
    els.submitBtn.classList.remove('is-submit','unsaved'); els.submitBtn.classList.add('is-saved');
    els.submitBtnIcon.textContent='lock';
    els.submitBtn.title='Saved'; els.submitBtn.setAttribute('aria-label','Saved');
  }
}

/**
 * Sets loading state for actions that update availability (eg save).
 * Disables submit while loading and animates the icon.
 * @param {boolean} isLoading
 * @param {string} message
 */
function setLoading(isLoading, message='Loading...'){
  if(isLoading){
    els.submitBtn.disabled = true;
    els.submitBtn.classList.add('loading');
    els.submitBtnIcon.textContent = 'hourglass_empty';
    els.submitBtn.title = message;
    els.submitBtn.setAttribute('aria-label', message);
  } else {
    els.submitBtn.classList.remove('loading');
    updateSubmitButtonState();
  }
}

/**
 * Updates UI elements based on current user authentication state.
 * - Submit/Save button: visible only when authenticated
 * - Reset Mine button: visible for all authenticated users
 * - Reset All button: visible only for authenticated admin
 * - Share: admin only
 */
function updateUserUI(){
  const hasUser = !!state.currentUserId;
  const auth = state.auth.get(state.currentUserId || -1);
  const isAuthenticated = !!auth;
  const isAdmin = auth && auth.role==='admin';
  
  // Update userSelectBtn to show logged-in state
  els.userSelectBtn.classList.toggle('authenticated', isAuthenticated);
  
  // Submit/Save button: only visible when authenticated and calendar is not frozen
  // Remove init-hidden class now that we know the correct state (prevents initial flash)
  els.submitBtn.classList.remove('init-hidden');
  const showSubmit = isAuthenticated && !isCalendarFrozen() && !(isBookingClosed() && !isAdmin);
  els.submitBtn.style.display = showSubmit ? 'inline-flex' : 'none';
  
  // Share: organiser only (your own name is changed from your row in the People list)
  els.shareBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  const hasSettings = (state.accessAvailable && window.AccessEmoji) || organiserMarksSettingShown() || nullColorSettingShown();
  els.settingsBtn.style.display = (isAdmin && hasSettings) ? 'inline-flex' : 'none';
  if(isAdmin && state.accessAvailable && !state.accessEmojiLoaded) loadAccessEmoji();
  if(!isAdmin) state.accessEmojiLoaded = false;
  
  // Reset Mine: visible for ALL authenticated users
  els.resetMineBtn.style.display = isAuthenticated ? 'inline-flex' : 'none';
  
  // Reset All: visible only for admin
  els.resetAllBtn.style.display = isAdmin ? 'inline-flex' : 'none';

  // Update sort toggle clickable state based on current user role
  updateSortToggleUI();

  // Refresh organiser message (edit vs read-only) based on role
  updateOrganiserMessageUI();
  updateHubBarUI();

  // Decided banner: Reopen appears/disappears as the organiser logs in or out
  updateChosenBanner();
}

/**
 * Shows Hub breadcrumb and organiser add/remove controls.
 */
function updateHubBarUI(){
  const bar = document.getElementById('hubBar');
  if(!bar) return;

  const auth = state.auth.get(state.currentUserId || -1);
  const isAdmin = auth && auth.role === 'admin';

  const link = document.getElementById('hubBarLink');
  const text = document.getElementById('hubBarText');
  const addBtn = document.getElementById('hubAddBtn');
  const removeBtn = document.getElementById('hubRemoveBtn');

  if(state.hubGroup){
    bar.style.display = 'flex';
    text.textContent = `Part of Hub: ${state.hubGroup.title || 'Hub'}`;
    if(link){
      link.href = `hub.html?g=${encodeURIComponent(state.hubGroup.token)}`;
      link.style.display = 'inline';
    }
    if(addBtn) addBtn.style.display = 'none';
    if(removeBtn) removeBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  } else if(isAdmin){
    bar.style.display = 'flex';
    text.textContent = 'Not in a Hub';
    if(link) link.style.display = 'none';
    if(addBtn) addBtn.style.display = 'inline-flex';
    if(removeBtn) removeBtn.style.display = 'none';
  } else {
    bar.style.display = 'none';
  }
}

function extractHubToken(raw){
  let str = (raw || '').trim();
  if(!str) return null;
  if(str.includes('hub.html') || str.includes('?g=')){
    try{
      const url = new URL(str, window.location.href);
      const t = url.searchParams.get('g');
      if(t) str = t.trim();
    }catch(e){
      const match = str.match(/[?&]g=([A-Za-z0-9_-]+)/);
      if(match) str = match[1];
    }
  }
  if(/^[A-Za-z0-9_-]{8,64}$/.test(str)) return str;
  return null;
}

function showHubModal(){
  const m = document.getElementById('hubModal');
  if(!m) return;
  document.getElementById('hubTokenInput').value = '';
  document.getElementById('hubModalError').textContent = '';
  m.classList.add('active');
}

function hideHubModal(){
  document.getElementById('hubModal')?.classList.remove('active');
}

async function confirmAddToHub(){
  const auth = state.auth.get(state.currentUserId || -1);
  if(!auth || auth.role !== 'admin'){
    showToast('Organiser auth required');
    return;
  }
  const raw = document.getElementById('hubTokenInput')?.value || '';
  const groupToken = extractHubToken(raw);
  if(!groupToken){
    document.getElementById('hubModalError').textContent = 'Enter a valid Hub code or link';
    return;
  }
  const res = await apiPost('add_calendar_to_group', { group_token: groupToken }, auth.token, groupToken);
  if(res.status !== 'success'){
    document.getElementById('hubModalError').textContent = res.message || 'Failed to add to Hub';
    return;
  }
  hideHubModal();
  state.hubGroup = res.group ? { token: res.group.token, title: res.group.title } : { token: groupToken, title: 'Hub' };
  updateHubBarUI();
  showToast('Added to Hub');
}

async function removeFromHub(){
  const auth = state.auth.get(state.currentUserId || -1);
  if(!auth || auth.role !== 'admin'){
    showToast('Organiser auth required');
    return;
  }
  if(!confirm('Remove this calendar from the Hub? The calendar will still work at its own link.')) return;
  const res = await apiPost('remove_calendar_from_group', {}, auth.token);
  if(res.status !== 'success'){
    showToast(res.message || 'Failed to remove');
    return;
  }
  state.hubGroup = null;
  updateHubBarUI();
  showToast('Removed from Hub');
}

/*** Calendar settings (organiser): access emoji */
function applyAccessSettings(data){
  state.accessEmoji = (window.AccessEmoji && AccessEmoji.valid(data.emoji)) ? data.emoji : null;
  state.accessHubEmoji = data.hub_emoji === true;
  state.accessEmojiLoaded = true;
}

/** Loads the emoji for the organiser's Share button. */
async function loadAccessEmoji(){
  state.accessEmojiLoaded = true;
  try{
    const data = await apiGet('access_settings');
    if(data.status === 'success' && data.available) applyAccessSettings(data);
  }catch(e){ /* Share falls back to the link only */ }
}

async function openSettingsModal(){
  const auth = state.auth.get(state.currentUserId || -1);
  if(!auth || auth.role !== 'admin'){
    showToast('Organiser auth required');
    return;
  }
  els.settingsError.textContent = '';
  document.getElementById('settingsMarksField').hidden = !organiserMarksSettingShown();
  document.getElementById('organiserMarksInput').checked = state.organiserMarks;
  renderNullColorField();
  els.settingsAccessField.innerHTML = '';
  els.settingsModal.classList.add('active');
  if(!state.accessAvailable || !window.AccessEmoji) return;
  els.settingsAccessField.innerHTML = '<p class="ae-note">Loading...</p>';

  const data = await apiGet('access_settings');
  if(data.status !== 'success' || !data.available){
    els.settingsAccessField.innerHTML = '';
    els.settingsError.textContent = data.message || 'Settings are not available yet.';
    return;
  }

  applyAccessSettings(data);
  let saved = state.accessEmoji;
  AccessEmoji.field(els.settingsAccessField, {
    label: 'Access emoji',
    pickerTitle: 'Choose calendar emoji',
    pickerHint: 'Use this emoji to access the calendar.',
    onHint: 'Use this emoji to access the calendar.',
    offHint: data.hub_emoji
      ? "Uses the Hub's emoji. Switch on to give this calendar its own."
      : 'Optional emoji access security.',
    value: saved,
    onChange: async (next) => {
      els.settingsError.textContent = '';
      if(next === null){
        const after = data.hub_emoji ? "People will need the Hub's emoji instead." : 'Anyone with the link will be able to open this calendar.';
        if(!confirm(`Remove the emoji? ${after}`)) return false;
      } else if(saved !== null && !confirm('Change the emoji? Everyone will need to pick the new one.')){
        return false;
      }
      const res = await apiPost('set_access_emoji', { emoji: next }, auth.token);
      if(res.status !== 'success'){
        els.settingsError.textContent = res.message || 'Could not save the emoji.';
        return false;
      }
      if(res.access_grant) AccessEmoji.saveGrant('c_' + state.token, res.access_grant, res.expires_at);
      saved = next;
      state.accessEmoji = next;
      showToast(next === null ? 'Emoji removed' : `Emoji set: ${AccessEmoji.name(next)}`);
      return true;
    }
  });
}

function hideSettingsModal(){
  els.settingsModal.classList.remove('active');
}

/**
 * Calendar settings: the five greys for a Slot nobody has answered. The default grey is ticked
 * when the calendar has no stored choice, so exactly one is always selected. Picking one saves
 * straight away; the grid repaints so the effect is visible.
 */
function renderNullColorField(){
  const field = document.getElementById('settingsNullField');
  if(!field) return;
  field.hidden = !nullColorSettingShown();
  if(field.hidden) return;
  const wrap = document.getElementById('nullSwatches');
  if(!wrap) return;
  wrap.innerHTML = '';

  // A calendar that never picked one is already showing the default grey, so tick that
  const current = (typeof state.nullColor === 'string' && state.nullColor !== '') ? state.nullColor.toLowerCase() : NULL_COLOR_DEFAULT;
  const paint = () => {
    wrap.querySelectorAll('.null-swatch').forEach(btn => {
      const on = btn.dataset.color === current;
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
    btn.setAttribute('aria-label', `Unanswered Slots in ${color}${color === NULL_COLOR_DEFAULT ? ' (default)' : ''}`);
    btn.title = color;
    btn.addEventListener('click', () => saveNullColor(color));
    wrap.appendChild(btn);
  }

  paint();
}

/**
 * Calendar settings: save the un-answered Slot colour. Picking the default stores nothing, so a
 * calendar that is already on it is left alone.
 */
async function saveNullColor(color){
  const auth = state.auth.get(state.currentUserId || -1);
  if(!auth || auth.role !== 'admin') return;
  const stored = (typeof state.nullColor === 'string' && state.nullColor !== '') ? state.nullColor.toLowerCase() : NULL_COLOR_DEFAULT;
  if(stored === color) return;
  els.settingsError.textContent = '';
  const field = document.getElementById('settingsNullField');
  const buttons = field ? field.querySelectorAll('.null-swatch') : [];
  buttons.forEach(b => { b.disabled = true; });
  try{
    const res = await apiPost('set_null_color', { color: color === NULL_COLOR_DEFAULT ? '' : color });
    if(res.status !== 'success'){
      els.settingsError.textContent = res.message || 'Could not save that.';
      return;
    }
    state.nullColor = typeof res.null_color === 'string' ? res.null_color : null;
    applyNullColor(state.nullColor);
    renderNullColorField();
    showToast(color === NULL_COLOR_DEFAULT
      ? 'Unanswered Slots back to default'
      : `Unanswered Slots set to ${color}`);
  } catch(e){
    console.error('Error saving un-answered colour:', e);
    els.settingsError.textContent = 'Could not save that.';
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

/** Calendar settings: show or hide your answers as a coloured edge on everyone's slots. */
async function saveOrganiserMarks(input){
  const on = input.checked;
  els.settingsError.textContent = '';
  input.disabled = true;
  try{
    const res = await apiPost('set_organiser_marks', { on: on ? 1 : 0 });
    if(res.status !== 'success'){
      input.checked = !on;
      els.settingsError.textContent = res.message || 'Could not save that.';
      return;
    }
    state.organiserMarks = res.organiser_marks === true;
    refreshCalendarValues();
    showToast(state.organiserMarks ? 'Coloured edge on' : 'Coloured edge off');
  } catch(e){
    console.error('Error saving organiser marks:', e);
    input.checked = !on;
    els.settingsError.textContent = 'Could not save that.';
  } finally {
    input.disabled = false;
  }
}

/*** Join / change your name on this calendar (your profile name is the default) */
function openUserModal(mode){
  if(mode === 'add' && state.currentUserId) mode = 'rename';
  if(mode === 'rename' && !state.currentUserId) mode = 'add';
  const profileName = state.account?.profile_name || '';
  els.userModalError.style.display='none';
  els.userNameErr.style.display='none';
  els.userModalConfirm.dataset.mode = mode;
  if(mode==='add'){
    els.userModalTitle.textContent='Join this calendar';
    els.userModalText.textContent='This is the name others will see on this calendar. It starts as your profile name; change it here if you like.';
    els.userModalConfirm.textContent='Join';
    els.userNameInput.value = profileName;
    els.userUseProfileBtn.hidden = true;
    els.userClaimHint.hidden = !state.account?.claimable;
  } else {
    const current = state.users.find(u => u.id === state.currentUserId);
    els.userModalTitle.textContent='Your name on this calendar';
    els.userModalText.textContent='Only changes your name here. Your saved availability stays the same.';
    els.userModalConfirm.textContent='Save';
    els.userNameInput.value = current ? current.display_name : '';
    els.userUseProfileBtn.hidden = !state.nameCustom || !profileName;
    els.userClaimHint.hidden = true;
  }
  els.userModal.classList.add('active');
  setTimeout(()=> els.userNameInput.focus(), 50);
}
function closeUserModal(){ els.userModal.classList.remove('active'); }
function validateName(name){
  if(!name) return {ok:false, msg:'Name is required.'};
  if(name.length>32) return {ok:false, msg:'Max 32 characters.'};
  if(!/^[A-Za-z0-9][A-Za-z0-9'\- ]*$/.test(name)) return {ok:false, msg:"Use letters, numbers, spaces, apostrophes and hyphens only."};
  return {ok:true, name};
}
function validatePin4(s){ return /^\d{4}$/.test(s); }

/** Shows a join/rename API error under the name field or the whole form. */
function showUserModalError(res, fallback){
  if(res.code === 'NAME_TAKEN'){
    els.userNameErr.textContent = res.message || 'Someone on this calendar already uses that name.';
    els.userNameErr.style.display='block';
    return;
  }
  els.userModalError.textContent = res.message || fallback;
  els.userModalError.style.display='block';
}

/** Reloads people and availability after your name on this calendar changes. */
async function afterMyNameChanged(){
  await loadUsers();
  updateCurrentUserDisplay();
  updateUserUI();
  await ensureDateRangeLoaded();
  renderDateRangeSkeleton();
  updateDateFilterBanner();
  refreshCalendarValues();
  await ensureCalendarLoadedAllDates();
  renderRankings();
}

/** Called after joining or claiming a name. */
async function becomeUser(user){
  applyMe(user);
  state.account = { ...state.account, me: user, claimable: false };
  state.pending = restorePendingForUser(state.currentUserId);
  updateSubmitButtonState();
  await afterMyNameChanged();
}

async function saveMyName(useProfile){
  const mode = els.userModalConfirm.dataset.mode;
  els.userNameErr.style.display='none';
  els.userModalError.style.display='none';
  let name = '';
  if(!useProfile){
    const nv = validateName((els.userNameInput.value??'').trim().replace(/\s+/g,' '));
    if(!nv.ok){
      els.userNameErr.textContent = nv.msg;
      els.userNameErr.style.display='block';
      return;
    }
    name = nv.name;
  }
  const profileName = state.account?.profile_name || '';
  els.userModalConfirm.disabled = true;
  try{
    if(mode==='add'){
      const res = await apiPost('join_calendar', { display_name: name === profileName ? '' : name });
      if(res.status!=='success'){
        if(res.code === 'ALREADY_JOINED'){ closeUserModal(); location.reload(); return; }
        showUserModalError(res, 'Could not join this calendar.');
        return;
      }
      closeUserModal();
      await becomeUser(res.user);
      showToast('Joined');
    } else {
      const body = useProfile ? { use_profile: 1 } : { display_name: name };
      const res = await apiPost('rename_user', { user_id: state.currentUserId, ...body });
      if(res.status!=='success'){
        showUserModalError(res, 'Could not change your name.');
        return;
      }
      state.nameCustom = res.name_custom === true;
      state.currentUserName = state.currentUserRole === 'admin' ? `${res.display_name} (organiser)` : res.display_name;
      closeUserModal();
      await afterMyNameChanged();
      showToast('Name updated');
    }
  }catch(e){
    console.error('User modal error:', e);
    els.userModalError.textContent = e.message || 'An error occurred. Try again.';
    els.userModalError.style.display='block';
  }finally{
    els.userModalConfirm.disabled = false;
  }
}
els.userModalCancel.addEventListener('click', closeUserModal);
els.userModalConfirm.addEventListener('click', () => saveMyName(false));
els.userUseProfileBtn.addEventListener('click', () => saveMyName(true));
els.userNameInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') saveMyName(false); });
els.userClaimLink.addEventListener('click', (e) => {
  e.preventDefault();
  closeUserModal();
  openUserSelectModal();
});

/*** Claim an old name (from before sign-in accounts) with its PIN, once */
function openClaimModal(user){
  els.pinModalError.style.display='none';
  els.pinInput.value='';
  els.pinModalTitle.textContent = `Claim "${user.display_name}"`;
  els.pinModal.classList.add('active');
  setTimeout(() => els.pinInput.focus(), 50);

  const submit = async () => {
    const pin = (els.pinInput.value??'').trim();
    if(!validatePin4(pin)){
      els.pinModalError.textContent='PIN must be exactly 4 digits.';
      els.pinModalError.style.display='block';
      return;
    }
    els.pinConfirm.disabled = true;
    try{
      const res = await apiPost('claim_name', { user_id: user.id, pin });
      if(res.status!=='success'){
        els.pinModalError.textContent = res.message || 'Could not claim that name.';
        els.pinModalError.style.display='block';
        return;
      }
      els.pinModal.classList.remove('active');
      await becomeUser(res.user);
      showToast('Name claimed - it now belongs to your account');
    }catch(e){
      els.pinModalError.textContent='Could not claim that name. Try again.';
      els.pinModalError.style.display='block';
    }finally{
      els.pinConfirm.disabled = false;
    }
  };
  els.pinConfirm.onclick = submit;
  els.pinInput.onkeydown = (e) => { if(e.key === 'Enter') submit(); };
}
els.pinCancel.addEventListener('click', () => els.pinModal.classList.remove('active'));

/*** Eye toggle for the claim PIN */
function wirePinToggle(inputEl, btnEl){
  const icon = btnEl.querySelector('.material-symbols-outlined');
  btnEl.addEventListener('click', ()=>{
    const nowText = inputEl.type === 'password';
    inputEl.type = nowText ? 'text' : 'password';
    icon.textContent = nowText ? 'visibility_off' : 'visibility';
    btnEl.setAttribute('aria-label', nowText ? 'Hide PIN' : 'Show PIN');
  });
}
wirePinToggle(els.pinInput, els.toggleUnlockPin);

/**
 * Returns your calendar auth when userId is your own name. Otherwise opens the Join
 * window (if you have no name yet) and throws, so callers stop.
 */
async function ensureAuthedForUser(userId){
  const auth = state.auth.get(userId);
  if(auth) return auth;
  promptJoin();
  throw new Error('Join this calendar first');
}
