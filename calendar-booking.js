/**
 * calendar-booking.js - Calendar page booking mode: booking cells, caps, instant save queue, Bookings card and polling.
 * Classic script sharing global scope. Load order: passkey.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
 */
'use strict';

/* ============================================
   BOOKING MODE
   Each slot can be taken by up to state.booking.capacity people.
   Taps toggle Booked / not booked and save like a normal calendar
   (auto-save or Submit); the server locks the calendar row and
   returns any bookings it refused (slot full / per-person limit).
   ============================================ */
const BOOKING_REFRESH_MS = 30000;

function isBookingMode(){ return !!state.booking; }
function isBookingClosed(){ return !!(state.booking && state.booking.closed); }

function bookingLabel(){
  return (Array.isArray(STATUS_OPTIONS) && STATUS_OPTIONS[0]?.label) || 'Booked';
}

function isAuthedOrganiser(){
  const auth = state.auth.get(state.currentUserId || -1);
  return !!(auth && auth.role === 'admin');
}

/**
 * Bookings card list. The organiser toggles Booked / Free, everyone else Mine / Free; the page
 * always opens on Booked / Mine. A choice that doesn't fit the current role (e.g. after signing
 * in as organiser) falls back to that role's first button.
 */
function currentBookingView(){
  const first = isAuthedOrganiser() ? 'booked' : 'mine';
  return state.bookingView === 'free' ? 'free' : first;
}

function setBookingViewButton(btn, mode, icon, label){
  if(!btn) return;
  btn.dataset.mode = mode;
  const iconEl = document.createElement('span');
  iconEl.className = 'material-symbols-outlined';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const text = document.createElement('span');
  text.textContent = label;
  btn.replaceChildren(iconEl, text);
}

function bookingUserName(uid){
  if(uid === state.currentUserId) return 'You';
  const u = state.users.find(x => x.id === uid);
  return u ? u.display_name : 'Someone';
}

/** Page wording and toggle labels for booking calendars. */
function applyBookingChrome(){
  document.title = state.calendarTitle ? `${state.calendarTitle} - book a slot` : 'When RU Free';
  if(els.analysisTitleText) els.analysisTitleText.textContent = 'Bookings';
  state.rankLimit = 2;
  const bannerText = els.nameBanner ? els.nameBanner.querySelector('p') : null;
  if(bannerText) bannerText.textContent = 'Add your name, then tap a free slot to book it.';
  for(const [el, label] of [[els.resetMineBtn, 'Cancel my bookings'], [els.resetAllBtn, 'Cancel ALL bookings (admin)']]){
    if(!el) continue;
    el.title = label;
    el.setAttribute('aria-label', label);
  }
}

/** Organiser-chosen Partly booked / Full name, or the default. */
function bookingStateName(name, fallback){
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
}

/** Organiser-chosen Partly booked / Full colours (null keeps the CSS defaults). */
function applyBookingColors(partial, full){
  const root = document.documentElement;
  for(const [name, color] of [['partial', partial], ['full', full]]){
    if(typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) continue;
    root.style.setProperty(`--bk-${name}`, color);
    root.style.setProperty(`--bk-${name}-text`, getContrastTextColor(color));
  }
}

function renderBookingLegend(){
  els.legendWrap.innerHTML = '';
  const cap = state.booking.capacity;
  const items = [['free', 'Free'], ['mine', 'Yours']];
  if(cap >= 2) items.push(['partial', state.booking.partialLabel]);
  items.push(['full', state.booking.fullLabel]);
  for(const [kind, text] of items){
    const item = document.createElement('div'); item.className = 'legend-item';
    const dot = document.createElement('div'); dot.className = `dot bk-dot bk-dot-${kind}`;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(' ' + text));
    els.legendWrap.appendChild(item);
  }
}

/**
 * Who has booked a slot, including your unsaved change. With full rows (Open, or Hidden
 * organiser) ids lists everyone; otherwise others are counted from the anonymous summary.
 */
function bookingInfo(dateStr, slotId){
  const me = state.currentUserId;
  const ids = [];
  let savedMine = false;
  for(const u of state.users){
    const booked = (state.store.get(`${u.id}\n${dateStr}\n${slotId}`) || 0) >= 1;
    if(u.id === me) savedMine = booked;
    else if(booked) ids.push(u.id);
  }
  const mine = !!me && getStatus(me, dateStr, slotId).status >= 1;
  const others = Math.max(ids.length, getSummaryCount(dateStr, slotId, 1) - (savedMine ? 1 : 0));
  if(mine) ids.push(me);
  const count = others + (mine ? 1 : 0);
  const cap = state.booking.capacity;
  return { ids, mine, count, left: Math.max(0, cap - count), full: count >= cap };
}

/**
 * Cell sub-line text. People's names never go in the cell (no room); they are on the Bookings card.
 * Slots for 2+ people get a separate "N/M" count (see renderBookingCell), so here they return
 * just the booking label, Free or the Full name ('' when only the count applies).
 */
function bookingCellText(info){
  if(info.mine) return bookingLabel();
  if(info.count === 0) return 'Free';
  if(state.booking.capacity >= 2) return info.full ? state.booking.fullLabel : '';
  return state.booking.fullLabel;
}

function renderBookingCell(el, dateStr, slot){
  const info = bookingInfo(dateStr, slot.id);
  setSlotClass(el, info.mine ? 1 : STATUS_NULL);
  el.classList.toggle('bk-mine', info.mine);
  el.classList.toggle('bk-full', !info.mine && info.full);
  el.classList.toggle('bk-partial', !info.mine && !info.full && info.count > 0);
  const cap = state.booking.capacity;
  let text = bookingCellText(info);
  const sub = el.querySelector('.bk-sub');
  if(cap >= 2){
    if(sub){
      const count = document.createElement('span');
      count.className = 'bk-count';
      count.textContent = `${info.count}/${cap}`;
      sub.replaceChildren(count, ` ${text || 'booked'}`);
    }
    text = text ? `${text}, ${info.count} of ${cap} booked` : `${info.count} of ${cap} booked`;
  } else if(sub){
    sub.textContent = text;
  }
  el.title = `${slot.label}: ${text}`;
  el.setAttribute('aria-label', `${formatFriendlyDate(dateStr)}, ${slot.label}: ${text}`);
}

function refreshBookingCells(){
  els.calendarGrid.classList.toggle('bookings-closed', isBookingClosed());
  for(const [dateStr, slotMap] of state.slotEls.entries()){
    for(const slot of TIME_SLOTS){
      const el = slotMap.get(slot.id);
      if(el) renderBookingCell(el, dateStr, slot);
    }
  }
}

/**
 * Your bookings that count towards Bookings per person, including unsaved changes:
 * that day's bookings, or every booking when the limit covers the whole calendar.
 */
function myBookingCount(dateStr){
  if(!state.currentUserId) return 0;
  if(state.booking.perUserTotal) return myTotalBookingCount(true);
  let n = 0;
  for(const slot of TIME_SLOTS){
    if(getStatus(state.currentUserId, dateStr, slot.id).status >= 1) n++;
  }
  return n;
}

/** All your bookings on this calendar; saved only (for "Cancel my bookings") unless withPending. */
function myTotalBookingCount(withPending = false){
  if(!state.currentUserId) return 0;
  const uid = state.currentUserId;
  const prefix = `${uid}\n`;
  let n = 0;
  for(const [k, v] of state.store.entries()){
    if(v >= 1 && k.startsWith(prefix)) n++;
  }
  if(withPending){
    for(const [dateStr, slots] of Object.entries(state.pending)){
      for(const [slotId, st] of Object.entries(slots)){
        const saved = (state.store.get(`${uid}\n${dateStr}\n${slotId}`) || 0) >= 1;
        if(st >= 1 && !saved) n++;
        else if(st < 1 && saved) n--;
      }
    }
  }
  return n;
}

function bookingLimitMessage(){
  const n = state.booking.perUser;
  const when = state.booking.perUserTotal ? 'in total' : 'per day';
  return n === 1
    ? `You can book 1 slot ${when} - cancel it to pick another.`
    : `You can book ${n} slots ${when} - cancel one to pick another.`;
}

/**
 * Tap on a booking cell: toggles Booked / not booked as an unsaved change (like a normal
 * calendar). Returns true when the change was queued.
 */
function onBookingSlotClick(dateStr, slotId){
  if(isBookingClosed() && !isAuthedOrganiser()){ showToast('Bookings are closed.'); return false; }
  if(!state.currentUserId){ openUserSelectModal(); return false; }
  if(!state.auth.get(state.currentUserId)){
    openPinModal(state.currentUserId, state.users.find(x => x.id === state.currentUserId));
    return false;
  }
  const info = bookingInfo(dateStr, slotId);
  if(!info.mine){
    if(info.full){ showToast('This slot is taken'); return false; }
    if(!isAuthedOrganiser() && state.booking.perUser !== null && myBookingCount(dateStr) >= state.booking.perUser){
      showToast(bookingLimitMessage());
      return false;
    }
  }
  setPendingBooking(dateStr, slotId, info.mine ? STATUS_NULL : 1);
  return true;
}

/** Records your unsaved booking change; toggling back to the saved state leaves nothing to save. */
function setPendingBooking(dateStr, slotId, status){
  const saved = (state.store.get(`${state.currentUserId}\n${dateStr}\n${slotId}`) || 0) >= 1 ? 1 : STATUS_NULL;
  if(status === saved){
    if(state.pending[dateStr]){
      delete state.pending[dateStr][slotId];
      if(!Object.keys(state.pending[dateStr]).length) delete state.pending[dateStr];
    }
  } else {
    if(!state.pending[dateStr]) state.pending[dateStr] = {};
    state.pending[dateStr][slotId] = status;
  }
  const el = state.slotEls.get(dateStr)?.get(slotId);
  const slot = TIME_SLOTS.find(s => s.id === slotId);
  if(el && slot) renderBookingCell(el, dateStr, slot);
  updateSubmitButtonState();
  debouncedRank();
  persistPendingDebounced();
  scheduleAutosave();
}

/** Bookings button on the Bookings card: same toggle, saved straight away. */
async function bookingCardAction(dateStr, slotId){
  if(!onBookingSlotClick(dateStr, slotId)) return;
  cancelAutosave();
  await savePending(false);
}

/** The organiser closed bookings before your changes were saved. */
function handleBookingsClosedOnSave(uid){
  state.booking.closed = true;
  state.pending = {};
  clearPersistedPending(uid);
  updateBookingClosedBanner();
  updateSubmitButtonState();
  updateUserUI();
  refreshCalendarValues();
  renderRankings();
  showToast('Bookings are closed - your changes were not saved.');
}

/** Organiser removals of other people's bookings run one at a time, in tap order. */
let bookingChain = Promise.resolve();
let bookingInFlight = 0;

function queueBooking(userId, dateStr, slotId, status){
  const el = state.slotEls.get(dateStr)?.get(slotId);
  if(el) el.classList.add('bk-busy');
  bookingInFlight++;
  bookingChain = bookingChain
    .then(() => sendBooking(userId, dateStr, slotId, status))
    .catch(e => console.error('Booking save failed:', e))
    .finally(() => {
      bookingInFlight--;
      const cur = state.slotEls.get(dateStr)?.get(slotId);
      if(cur) cur.classList.remove('bk-busy');
    });
  return bookingChain;
}

function handleExpiredSession(){
  const uid = state.currentUserId;
  state.auth.delete(uid);
  try{ localStorage.removeItem(cacheKey(uid)); }catch(e){}
  updateUserUI();
  openPinModal(uid, state.users.find(x => x.id === uid));
}

async function sendBooking(userId, dateStr, slotId, status){
  const auth = state.auth.get(state.currentUserId || -1);
  if(!auth){ showToast('Please unlock your name first.'); return; }
  let res;
  try{
    res = await apiPost('save', { user_id: userId, changes: { [dateStr]: { [slotId]: status } } }, auth.token);
  }catch(e){
    showToast('Could not save - check your connection.');
    return;
  }
  if(res && res.status === 'success'){
    const rejected = Array.isArray(res.rejected) ? res.rejected : [];
    if(rejected.some(r => r.reason === 'full')) showToast('Just taken by someone else');
    else if(rejected.some(r => r.reason === 'limit')) showToast(bookingLimitMessage());
    else if(status === 0) showToast(userId === state.currentUserId ? 'Booking cancelled' : 'Booking removed');
    else showToast('Booked!');
  } else if(res && res.code === 'BOOKINGS_CLOSED'){
    state.booking.closed = true;
    updateBookingClosedBanner();
    showToast('Bookings are closed.');
  } else if(res && /session|auth required/i.test(res.message || '')){
    handleExpiredSession();
    return;
  } else {
    showToast((res && res.message) || 'Save failed');
  }
  await reloadAvailability();
}

async function cancelMyBookings(auth){
  const n = myTotalBookingCount();
  if(!n){ showToast('You have no bookings.'); return; }
  if(isBookingClosed() && !isAuthedOrganiser()){ showToast('Bookings are closed.'); return; }
  if(!confirm(n === 1 ? 'Cancel your booking?' : `Cancel all ${n} of your bookings?`)) return;
  try{
    const res = await apiPost('reset_user', { user_id: state.currentUserId }, auth.token);
    if(res.status !== 'success'){ showToast(res.message || 'Cancel failed'); return; }
    cancelAutosave();
    state.pending = {};
    clearPersistedPending(state.currentUserId);
    updateSubmitButtonState();
    await reloadAvailability();
    showToast(n === 1 ? 'Booking cancelled' : 'Bookings cancelled');
  }catch(e){
    console.error('Cancel bookings failed:', e);
    showToast('Cancel failed. Please try again.');
  }
}

/** Visible dates in order (past dates follow the Show/Hide past dates button). */
function bookingDates(){
  const out = [];
  if(!state.startDate || !state.endDate) return out;
  const today = todayStr();
  const end = new Date(state.endDate + 'T00:00:00');
  for(let d = new Date(state.startDate + 'T00:00:00'); d <= end; d.setDate(d.getDate() + 1)){
    const dow = d.getDay();
    if(state.excludeWeekends && (dow === 0 || dow === 6)) continue;
    const dateStr = fmtDate(d);
    if(!isDateVisible(dateStr)) continue;
    if(state.hidePastDates && dateStr < today) continue;
    out.push(dateStr);
  }
  return out;
}

/**
 * A booking row built like a normal Best Match card: a header button (date - slot, summary,
 * View/Hide pill) that expands to the action pills and the roster.
 */
function bookingRankCard(dateStr, slot, { mine, summary, fillDetails }){
  const key = `bk\n${dateStr}\n${slot.id}`;
  const details = document.createElement('div'); details.className = 'rank-details';
  const actions = document.createElement('div'); actions.className = 'rank-actions';
  details.appendChild(actions);
  fillDetails(details, actions);
  if(!actions.childElementCount) actions.remove();
  const hasDetails = details.childElementCount > 0;
  const isOpen = hasDetails && state.expandedRanks.has(key);

  const card = document.createElement('div');
  card.className = 'rank-card bk-card' + (isOpen ? ' open' : '') + (mine ? ' bk-card-mine' : '');
  const btn = document.createElement('button'); btn.className = 'rank-btn'; btn.type = 'button';
  const main = document.createElement('div'); main.className = 'rank-main';
  const line1 = document.createElement('div'); line1.className = 'rank-line1';
  if(mine) line1.innerHTML = '<span class="material-symbols-outlined bk-mine-icon" aria-hidden="true">check_circle</span> ';
  line1.appendChild(document.createTextNode(`${formatFriendlyDate(dateStr)} - ${slot.label}`));
  const line2 = document.createElement('div'); line2.className = 'rank-line2';
  line2.textContent = summary;
  main.appendChild(line1); main.appendChild(line2);
  btn.appendChild(main);
  if(hasDetails){
    const pill = document.createElement('div'); pill.className = 'rank-pill'; pill.textContent = isOpen ? 'Hide' : 'View';
    btn.appendChild(pill);
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    btn.addEventListener('click', () => toggleRankExpand(key));
    card.appendChild(btn);
    card.appendChild(details);
  } else {
    btn.style.cursor = 'default';
    card.appendChild(btn);
  }
  return card;
}

/** Names on a slot (you first), styled like the normal roster; the organiser can remove others. */
function bookingRoster(info, dateStr, slot, isOrg){
  const me = state.currentUserId;
  const list = document.createElement('div'); list.className = 'roster-inline';
  const ids = info.ids.slice().sort((a, b) =>
    ((b === me) - (a === me)) || bookingUserName(a).localeCompare(bookingUserName(b)));
  for(const uid of ids){
    const name = bookingUserName(uid);
    const item = document.createElement('span'); item.className = 'roster-item';
    const nameEl = document.createElement('span'); nameEl.className = 'roster-name'; nameEl.textContent = name;
    const tag = document.createElement('span'); tag.className = 'status-tag status-1'; tag.textContent = bookingLabel();
    item.appendChild(nameEl); item.appendChild(tag);
    if(isOrg && uid !== me){
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'bk-remove';
      rm.title = `Remove ${name}`;
      rm.setAttribute('aria-label', `Remove ${name}'s booking`);
      rm.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
      rm.addEventListener('click', () => {
        if(!confirm(`Remove ${name}'s booking for ${formatFriendlyDate(dateStr)} - ${slot.label}?`)) return;
        queueBooking(uid, dateStr, slot.id, 0);
      });
      item.appendChild(rm);
    }
    list.appendChild(item);
  }
  return list;
}

/** Share pill (same as Best Match) listing who booked the slot; only on your own bookings. */
function bookingShareButton(info, dateStr, slot){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-pill btn-share';
  btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">share</span> Share';
  const details = info.ids.map(uid => ({ name: state.users.find(u => u.id === uid)?.display_name || 'Someone', status: 1 }));
  btn.addEventListener('click', () => shareRankingDetails({ dateStr, slotLabel: slot.label, details }, STATUS_OPTIONS || []));
  return btn;
}

function buildBookedRow({ dateStr, slot, info }, { cap, closed, isOrg, roster }){
  const summary = cap === 1
    ? (info.mine ? 'Booked by you' : (roster && info.ids.length ? `Booked by ${bookingUserName(info.ids[0])}` : bookingLabel()))
    : `${info.count} of ${cap} booked${info.mine ? ' (incl. you)' : ''}`;
  return bookingRankCard(dateStr, slot, { mine: info.mine, summary, fillDetails: (details, actions) => {
    if(info.mine){
      const links = buildCalendarLinks({ dateStr, slotLabel: slot.label });
      const add = document.createElement('a');
      add.href = links.gcalURL; add.target = '_blank'; add.rel = 'noopener';
      add.className = 'btn-pill btn-cal';
      add.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">event</span> Add';
      const ics = document.createElement('a');
      ics.href = links.icsBlobUrl; ics.download = links.icsName;
      ics.className = 'btn-pill btn-ics';
      ics.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">download</span> Download';
      actions.appendChild(add); actions.appendChild(ics);
      actions.appendChild(bookingShareButton(info, dateStr, slot));
      if(!closed || isOrg){
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-pill bk-cancel-btn';
        cancel.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">event_busy</span> Cancel';
        cancel.addEventListener('click', () => {
          if(confirm('Cancel this booking?')) bookingCardAction(dateStr, slot.id);
        });
        actions.appendChild(cancel);
      }
    }
    if(roster && info.ids.length) details.appendChild(bookingRoster(info, dateStr, slot, isOrg));
  }});
}

function buildFreeRow({ dateStr, slot, info }, { cap, closed, isOrg, roster }){
  const summary = info.count === 0 ? 'Free' : `${info.left} of ${cap} left`;
  return bookingRankCard(dateStr, slot, { mine: false, summary, fillDetails: (details, actions) => {
    if(!closed){
      const book = document.createElement('button');
      book.type = 'button';
      book.className = 'btn-pill btn-choose';
      book.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;">check_circle</span> Book';
      book.addEventListener('click', () => bookingCardAction(dateStr, slot.id));
      actions.appendChild(book);
    }
    if(roster && info.ids.length) details.appendChild(bookingRoster(info, dateStr, slot, isOrg));
  }});
}

/** Bookings card: "N of M booked", then the Booked, Mine or Free list in date order. */
function renderBookings(){
  updateSortToggleUI();
  updateLimitToggleUI();
  els.rankWrap.innerHTML = '';
  const cap = state.booking.capacity;
  const view = currentBookingView();
  const closed = isBookingClosed();
  const isOrg = isAuthedOrganiser();
  const roster = shouldShowRoster();
  const rows = [];
  let taken = 0;
  let places = 0;
  for(const dateStr of bookingDates()){
    for(const slot of TIME_SLOTS){
      const info = bookingInfo(dateStr, slot.id);
      taken += Math.min(info.count, cap);
      places += cap;
      const include = view === 'booked' ? info.count > 0
        : view === 'mine' ? info.mine
        : (!info.full && !info.mine);
      if(include) rows.push({ dateStr, slot, info });
    }
  }

  const head = document.createElement('div');
  head.className = 'bk-summary';
  const count = document.createElement('span');
  count.className = 'bk-summary-text';
  count.textContent = cap === 1 ? `${taken} of ${places} booked` : `${taken} of ${places} places booked`;
  head.appendChild(count);
  if(isOrg && !closed){
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-pill bk-close-btn';
    closeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">lock</span> Close bookings';
    closeBtn.addEventListener('click', () => setBookingsClosed(true));
    head.appendChild(closeBtn);
  }
  els.rankWrap.appendChild(head);

  if(!rows.length){
    const signedIn = !!(state.currentUserId && state.auth.get(state.currentUserId));
    els.rankEmpty.textContent = view === 'booked' ? 'No bookings yet.'
      : view === 'mine' ? (signedIn ? "You haven't booked anything yet - tap a free slot to book it." : 'Pick your name to see your bookings.')
      : (closed ? 'Bookings are closed.' : 'No free slots.');
    els.rankEmpty.style.display = 'block';
    return;
  }
  els.rankEmpty.style.display = 'none';
  const shown = state.rankLimit === 0 ? rows : rows.slice(0, state.rankLimit);
  for(const row of shown){
    els.rankWrap.appendChild(view !== 'free'
      ? buildBookedRow(row, { cap, closed, isOrg, roster })
      : buildFreeRow(row, { cap, closed, isOrg, roster }));
  }
}

function updateBookingClosedBanner(){
  const closed = isBookingClosed();
  els.calendarGrid.classList.toggle('bookings-closed', closed);
  let banner = document.getElementById('bookingClosedBanner');
  if(!closed){
    if(banner) banner.remove();
    return;
  }
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'bookingClosedBanner';
    banner.className = 'chosen-banner bk-closed-banner';
    banner.innerHTML =
      '<span class="chosen-banner-text">'
      + '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:18px;vertical-align:middle;">lock</span> Bookings closed'
      + '</span>'
      + '<button type="button" class="btn btn-sm chosen-reopen-btn">'
      + '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;">lock_open</span> Reopen'
      + '</button>';
    banner.querySelector('.chosen-reopen-btn').addEventListener('click', () => setBookingsClosed(false));
    const section = document.querySelector('.analysis-section');
    if(section) section.insertBefore(banner, section.firstChild);
  }
  banner.querySelector('.chosen-reopen-btn').style.display = isAuthedOrganiser() ? 'inline-flex' : 'none';
}

async function setBookingsClosed(closed){
  if(!isAuthedOrganiser()) return;
  const auth = state.auth.get(state.currentUserId);
  const msg = closed
    ? 'Close bookings?\n\nNobody can book or cancel until you reopen. You can still remove bookings.'
    : 'Reopen bookings?\n\nPeople will be able to book and cancel again.';
  if(!confirm(msg)) return;
  try{
    const res = await apiPost('set_bookings_closed', { closed: closed ? 1 : 0 }, auth.token);
    if(res.status !== 'success'){ showToast(res.message || 'Failed to update bookings'); return; }
    state.booking.closed = res.bookings_closed === true;
    updateBookingClosedBanner();
    refreshBookingCells();
    renderRankings();
    showToast(state.booking.closed ? 'Bookings closed' : 'Bookings reopened');
  }catch(e){
    console.error('set_bookings_closed failed:', e);
    showToast('Failed to update bookings');
  }
}

/** Keeps the grid current while the page is open: on tab focus and every 30 seconds. */
let bookingRefreshBusy = false;

function startBookingRefresh(){
  setInterval(() => { if(document.visibilityState === 'visible') refreshBookings(); }, BOOKING_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshBookings();
  });
}

async function refreshBookings(){
  if(bookingRefreshBusy || bookingInFlight > 0 || state.isSaving) return;
  bookingRefreshBusy = true;
  try{
    const meta = await apiGet('calendar_meta');
    if(meta.status === 'success' && meta.calendar){
      const closed = meta.calendar.bookings_closed === true;
      if(closed !== state.booking.closed){
        state.booking.closed = closed;
        updateBookingClosedBanner();
        updateUserUI();
      }
    }
    await reloadAvailability();
  }catch(e){
    console.warn('Booking refresh failed:', e);
  }finally{
    bookingRefreshBusy = false;
  }
}
