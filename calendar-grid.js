/**
 * calendar-grid.js - Calendar page grid: availability fetch, slot status, date filter, grid skeleton, past dates, slot click, save and reset.
 * Classic script sharing global scope. Load order: passkey.js, account-core.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
 */
'use strict';

/*** Availability loading */
function useSummaryForRankings(){
  if (state.privacyMode === 'open') return false;
  if (state.privacyMode === 'hidden' && isCurrentUserOrganiser()) return false;
  return true;
}

function getSummaryCount(dateStr, slotId, status){
  const k = `${dateStr}\n${slotId}\n${status}`;
  return state.availabilitySummary.get(k) || 0;
}

async function reloadAvailability(){
  state.store.clear();
  state.availabilitySummary.clear();
  state.loadedRanges.clear();
  if (state.startDate && state.endDate) {
    const {from, to} = getFullCalendarRange();
    await ensureRangeLoaded(from, to);
  }
  refreshCalendarValues();
  renderRankings();
}

async function ensureRangeLoaded(from, to){
  const key=`${from}\n${to}`;
  if(state.loadedRanges.has(key)) return;
  const data=await apiGet('availability', {from, to});
  if(data.status!=='success') throw new Error('Failed availability fetch');
  for(const r of (data.rows??[])){
    const uid=Number(r.user_id); const k=`${uid}\n${r.day}\n${r.slot}`;
    state.store.set(k, Number(r.status));
  }
  for (const s of (data.summary ?? [])) {
    const sk = `${s.day}\n${s.slot}\n${Number(s.status)}`;
    state.availabilitySummary.set(sk, Number(s.count));
  }
  state.loadedRanges.add(key);
}

/*** Status getters/setters */
function getStatus(userId, dateStr, slotId){
  const key=`${userId}\n${dateStr}\n${slotId}`;
  if(userId===state.currentUserId){
    const pend=state.pending[dateStr];
    if(pend && pend[slotId]!==undefined) return {status:pend[slotId], pending:true};
  }
  if(state.store.has(key)) return {status: state.store.get(key), pending:false};
  return {status: STATUS_NULL, pending:false};
}

/**
 * Gets the organiser's (admin's) status for a specific slot.
 * Used to display organiser dots on slots.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} slotId - The slot ID
 * @returns {number} Status value (0 = NULL, 1..N = status)
 */
function getOrganiserStatus(dateStr, slotId){
  if(!state.adminUserId) return STATUS_NULL;
  const {status} = getStatus(state.adminUserId, dateStr, slotId);
  return status;
}

function setSlotClass(el, status){
  // Remove any existing status-* classes up to 5 (max allowed)
  el.classList.remove('status-1','status-2','status-3','status-4','status-5');
  if(status!==STATUS_NULL) el.classList.add(`status-${status}`);
}

/**
 * Updates the organiser left-border indicator on a slot element.
 * Shows the organiser's status as a coloured 5px left border.
 * Only displays if the organiser has set a status (not NULL).
 * Hidden when the admin/organiser is viewing (they don't need to see their own indicator).
 * Hidden completely in Blind mode (no individual choices visible).
 * @param {HTMLElement} slotEl - The slot element
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} slotId - The slot ID
 */
function updateOrganiserDot(slotEl, dateStr, slotId){
  // Remove any existing organiser border classes
  slotEl.classList.remove('org-border-1','org-border-2','org-border-3','org-border-4','org-border-5');
  
  // Don't show indicator in Blind mode - no individual choices visible
  if(!shouldShowOrganiserDots()) return;
  
  // Not on the organiser's own answers (yours, or theirs when viewing them)
  if((state.viewUserId || state.currentUserId) === state.adminUserId) return;
  
  // Get organiser's status for this slot
  const orgStatus = getOrganiserStatus(dateStr, slotId);
  
  // Only show indicator if organiser has a status (not NULL)
  if(orgStatus === STATUS_NULL) return;
  
  // Add the border class directly to the slot element
  slotEl.classList.add(`org-border-${orgStatus}`);
}

/**
 * Updates your own left-edge indicator while you are reading someone else's calendar.
 * The fill colour is the person you are viewing, so this puts YOUR answer alongside theirs
 * (and the organiser's, which keeps the outer border) to compare at a glance.
 * Only shown while viewing: on your own calendar the fill already is your answer.
 * @param {HTMLElement} slotEl - The slot element
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} slotId - The slot ID
 */
function updateOwnEdge(slotEl, dateStr, slotId){
  slotEl.classList.remove('own-border-1','own-border-2','own-border-3','own-border-4','own-border-5');

  // Only while viewing someone else, and only if you have a name here to compare
  if(!state.viewUserId || !state.currentUserId) return;

  const {status} = getStatus(state.currentUserId, dateStr, slotId);
  if(status === STATUS_NULL) return;

  slotEl.classList.add(`own-border-${status}`);
}

/*** Build grid */
/**
 * Determines if a date should be visible to the current user based on date filter settings.
 * Organiser always sees all dates (to manage selections).
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {boolean} True if the date should be rendered
 */
function isDateVisible(dateStr){
  // Organiser always sees all dates so they can manage filter selections
  if(isCurrentUserOrganiser()) return true;
  // 'all' mode: no filtering
  if(state.dateFilterMode === 'all') return true;
  const isMarked = state.dateFilterDates.includes(dateStr);
  // 'only' mode: show only marked dates
  if(state.dateFilterMode === 'only') return isMarked;
  // 'except' mode: show all except marked dates
  if(state.dateFilterMode === 'except') return !isMarked;
  return true;
}

/**
 * Checks if a date is marked in the date filter list.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {boolean}
 */
function isDateMarked(dateStr){
  return state.dateFilterDates.includes(dateStr);
}

/**
 * Toggles a date in the date filter selection.
 * Only callable by the organiser.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 */
function toggleDateFilter(dateStr){
  const idx = state.dateFilterDates.indexOf(dateStr);
  if(idx >= 0){
    state.dateFilterDates.splice(idx, 1);
  } else {
    state.dateFilterDates.push(dateStr);
    state.dateFilterDates.sort();
  }
  state.dateFilterDirty = true;
  // Show immediate "Unsaved" feedback
  setDateFilterSaveStatus('unsaved');
  // Update visual indicator on the header
  updateDateFilterIndicators();
  // Auto-save filter dates after a short delay
  scheduleDateFilterSave();
}

/** Timer for debounced date filter save */
let dateFilterSaveTimer = null;

/**
 * Schedules a save of date filter dates to the server after a short delay.
 */
function scheduleDateFilterSave(){
  if(dateFilterSaveTimer) clearTimeout(dateFilterSaveTimer);
  dateFilterSaveTimer = setTimeout(async ()=>{
    dateFilterSaveTimer = null;
    await saveDateFilterDates();
  }, 1500);
}

/**
 * Saves the current date_filter_dates to the server.
 * Requires admin auth. Updates the save status pill in the banner.
 */
async function saveDateFilterDates(){
  if(!state.dateFilterDirty) return;
  if(!state.adminUserId) return;
  const auth = state.auth.get(state.adminUserId);
  if(!auth) return;
  setDateFilterSaveStatus('saving');
  try{
    const res = await apiPost('save_date_filter', { dates: state.dateFilterDates }, auth.token);
    if(res.status === 'success'){
      state.dateFilterDirty = false;
      setDateFilterSaveStatus('saved');
      showToast('Date filter saved');
    } else {
      setDateFilterSaveStatus('unsaved');
      showToast('Date filter save failed');
    }
  }catch(e){
    console.error('Failed to save date filter:', e);
    setDateFilterSaveStatus('unsaved');
  }
}

/**
 * Updates the visual indicators on all day headers to reflect date filter selections.
 * Toggles both the header highlight and column border for selected dates.
 * Only shown to the organiser -- non-admin and unauthenticated users see nothing.
 * Also updates the info banner count.
 */
function updateDateFilterIndicators(){
  const isOrg = isCurrentUserOrganiser();
  for(const [dateStr, col] of state.dayCols.entries()){
    const hdr = col.querySelector('.day-header');
    if(!hdr) continue;
    const marked = isDateMarked(dateStr);
    // Only show visual indicators to the organiser
    hdr.classList.toggle('date-filtered', marked && isOrg);
    col.classList.toggle('date-col-filtered', marked && isOrg);
    // Only show tooltips to the organiser
    if(isOrg && state.dateFilterMode !== 'all'){
      if(state.dateFilterMode === 'only'){
        hdr.title = marked ? 'Selected - click to deselect' : 'Click to include for participants';
      } else {
        hdr.title = marked ? 'Excluded - click to un-exclude' : 'Click to exclude for participants';
      }
    } else {
      hdr.title = '';
    }
  }
  // Update the banner count text and save status
  updateDateFilterBanner();
}

function renderDateRangeSkeleton(){
  state.slotEls.clear(); state.dayCols.clear(); els.calendarGrid.innerHTML='';
  if(!state.startDate || !state.endDate){ els.monthLabel.textContent='No date range set'; return; }
  const start=new Date(state.startDate+'T00:00:00'); const end=new Date(state.endDate+'T00:00:00'); const today=new Date();

  // Show info banner for non-organiser when 'only' mode has no dates selected
  if(!isCurrentUserOrganiser() && state.dateFilterMode === 'only' && state.dateFilterDates.length === 0){
    const msg = document.createElement('div');
    msg.className = 'date-filter-empty-msg';
    msg.textContent = 'The organiser has not selected any dates yet.';
    els.calendarGrid.appendChild(msg);
    return;
  }

  // Only add leading placeholders to align weeks when weekends are included
  if(!state.excludeWeekends){
    // Find the first visible date to align correctly
    let firstVisibleDate = null;
    for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
      const dateStr=fmtDate(d);
      if(isDateVisible(dateStr)){
        firstVisibleDate = new Date(d);
        break;
      }
    }
    if(firstVisibleDate){
      const startDOW=getDayOfWeek(firstVisibleDate);
      for(let i=0;i<startDOW;i++){
        const emp=document.createElement('div'); emp.className='day-column empty-day'; emp.style.visibility='hidden'; els.calendarGrid.appendChild(emp);
      }
    }
  }
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if(state.excludeWeekends && (dow===0 || dow===6)) continue;
    const dateStr=fmtDate(d);

    // Apply date filter for non-organiser users
    if(!isDateVisible(dateStr)) continue;

    const {dayNum,dayName,monthName}=formatDayHeader(dateStr);
    const col=document.createElement('div'); col.className='day-column';
    const hdr=document.createElement('div'); hdr.className='day-header';
    if(d.getFullYear()===today.getFullYear() && d.getMonth()===today.getMonth() && d.getDate()===today.getDate()){ hdr.classList.add('today'); }

    // Make header clickable for organiser when date filter mode is not 'all'
    if(isCurrentUserOrganiser() && state.dateFilterMode !== 'all'){
      hdr.classList.add('date-header-clickable');
      hdr.addEventListener('click', ()=> toggleDateFilter(dateStr));
    }

    // Date number with appended 3-letter month name (e.g., "15 Jan")
    const num=document.createElement('div'); num.className='date-num';
    num.appendChild(document.createTextNode(dayNum + ' '));
    const mon=document.createElement('span'); mon.className='date-mon'; mon.textContent=monthName;
    num.appendChild(mon);
    const dowEl=document.createElement('div'); dowEl.className='date-dow'; dowEl.textContent=dayName;
    hdr.appendChild(num); hdr.appendChild(dowEl); col.appendChild(hdr);
    const slotMap=new Map();
    for(const slot of TIME_SLOTS){
      const slotEl=document.createElement('div'); slotEl.className='time-slot';
      if(isBookingMode()){
        slotEl.classList.add('bk-cell');
        slotEl.setAttribute('role', 'button');
        slotEl.tabIndex = 0;
        const lbl=document.createElement('span'); lbl.className='bk-label'; lbl.textContent=slot.label;
        const sub=document.createElement('span'); sub.className='bk-sub';
        slotEl.appendChild(lbl); slotEl.appendChild(sub);
        slotEl.addEventListener('keydown', (e)=>{
          if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); onSlotClick(dateStr, slot.id); }
        });
      } else {
        slotEl.textContent=slot.label;
      }
      slotEl.dataset.date = dateStr;
      slotEl.dataset.slot = slot.id;
      slotEl.addEventListener('click', ()=> onSlotClick(dateStr, slot.id));
      col.appendChild(slotEl); slotMap.set(slot.id, slotEl);
    }
    state.slotEls.set(dateStr, slotMap); state.dayCols.set(dateStr, col); els.calendarGrid.appendChild(col);
  }
  // Only add trailing placeholders when weekends are included
  if(!state.excludeWeekends){
    // Find the last visible date for trailing alignment
    let lastVisibleDate = null;
    for(let d=new Date(end); d>=start; d.setDate(d.getDate()-1)){
      const dateStr=fmtDate(d);
      const dow=d.getDay();
      if(state.excludeWeekends && (dow===0 || dow===6)) continue;
      if(isDateVisible(dateStr)){
        lastVisibleDate = new Date(d);
        break;
      }
    }
    if(lastVisibleDate){
      const endDOW=getDayOfWeek(lastVisibleDate);
      if(((endDOW+1)%7)>0){ for(let i=0;i<(6-endDOW);i++){ const emp=document.createElement('div'); emp.className='day-column empty-day'; emp.style.visibility='hidden'; els.calendarGrid.appendChild(emp); } }
    }
  }
  // Update filter indicators (tooltips) after grid is built
  updateDateFilterIndicators();
  // Show/hide past dates according to current preference
  applyPastDateFilter();
  // New cells start blank: paint current values and the decided state
  refreshCalendarValues();
  applyFrozenState();
}

/**
 * Returns today's date string in YYYY-MM-DD (local time).
 */
function todayStr(){
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}

/**
 * Show or hide past date columns based on state.hidePastDates.
 * Also shows/hides the toggle button itself (hidden if no past dates exist).
 */
function applyPastDateFilter(){
  const today = todayStr();
  let hasPast = false;
  for(const [dateStr, col] of state.dayCols.entries()){
    const isPast = dateStr < today;
    if(isPast) hasPast = true;
    if(isPast) col.style.display = state.hidePastDates ? 'none' : '';
  }
  const btn = els.togglePastDatesBtn;
  btn.style.display = hasPast ? '' : 'none';
  btn.textContent = state.hidePastDates ? 'Show past dates' : 'Hide past dates';
  btn.classList.toggle('active', state.hidePastDates);
}

/**
 * Refreshes the calendar grid values for the current user.
 * Updates slot colours and organiser dots.
 */
function refreshCalendarValues(){
  if(isBookingMode()){ refreshBookingCells(); return; }
  const shownUserId = state.viewUserId || state.currentUserId;
  for(const [dateStr, slotMap] of state.slotEls.entries()){
    for(const slot of TIME_SLOTS){
      const el=slotMap.get(slot.id);

      // Your status colour, or the person you are viewing
      if(shownUserId){
        const {status}=getStatus(shownUserId, dateStr, slot.id);
        setSlotClass(el, status);
      } else {
        // No user selected - show neutral
        setSlotClass(el, STATUS_NULL);
      }
      
      // Update organiser dot (shows for all users)
      updateOrganiserDot(el, dateStr, slot.id);

      // While viewing someone else, your own answer as an inner left edge
      updateOwnEdge(el, dateStr, slot.id);
    }
  }
  updateSubmitButtonState();
}

/*** Slot clicks - gated by auth */
/**
 * Cycles through availability statuses: NULL -> Status1 -> Status2 -> ... -> StatusN -> NULL.
 * Status values are integers: 0 = NULL, 1..N = custom options.
 */
function cycleStatus(current){
  const n = Array.isArray(STATUS_OPTIONS) ? STATUS_OPTIONS.length : 0;
  if (n <= 0) return STATUS_NULL;
  if (current === STATUS_NULL) return 1;
  if (current >= 1 && current < n) return current + 1;
  return STATUS_NULL;
}

/**
 * Highlights the legend item for the given status index.
 * Shows which status was just selected. Cleared on save.
 * @param {number} statusIndex - Status index (1-5) or STATUS_NULL (0) to clear all
 */
function highlightLegendItem(statusIndex){
  if(!els.legendWrap) return;
  const items = els.legendWrap.querySelectorAll('.legend-item');
  items.forEach(item => {
    // Clear all highlights first, then add to matching item
    item.classList.remove('recently-used');
    if(parseInt(item.dataset.status, 10) === statusIndex){
      item.classList.add('recently-used');
    }
  });
}

/**
 * Clears all legend item highlights (called after save)
 */
function clearLegendHighlights(){
  if(!els.legendWrap) return;
  const items = els.legendWrap.querySelectorAll('.legend-item');
  items.forEach(item => item.classList.remove('recently-used'));
}

/*** Info modal helper functions */
function showInfoModal(){
  els.infoModal.classList.add('active');
  setTimeout(() => {
    els.infoModalCancel.focus();
  }, 50);
}
function closeInfoModal(){
  els.infoModal.classList.remove('active');
}
function onSlotClick(dateStr, slotId){
  if(isBookingMode()){ onBookingSlotClick(dateStr, slotId); return; }
  if(state.viewUserId){
    showToast('Read only. Close this view to change your own.');
    return;
  }
  // Block slot changes if the calendar has been finalised
  if(isCalendarFrozen()){
    showToast('Calendar finalised - no changes allowed.');
    return;
  }
  if(!state.currentUserId || !state.auth.get(state.currentUserId)){
    promptJoin();
    return;
  }
  const {status}=getStatus(state.currentUserId, dateStr, slotId);
  const next=cycleStatus(status);
  if(!state.pending[dateStr]) state.pending[dateStr]={};
  state.pending[dateStr][slotId]=next;
  const slotEl=state.slotEls.get(dateStr).get(slotId);
  setSlotClass(slotEl, next);
  
  // Highlight the legend item for the selected status
  highlightLegendItem(next);
  
  updateSubmitButtonState();
  debouncedRank();

  // Durable local queue (backup to localStorage for recovery)
  persistPendingDebounced();
  
  // Schedule autosave after delay
  scheduleAutosave();
}

/*** Save / Reset functions */

/**
 * Saves pending changes to the server.
 * Handles both autosave and manual save.
 * 
 * IMPORTANT: This function now properly handles NULL (status 0) changes.
 * When a user cycles a slot back to NULL, this change IS sent to the server,
 * which then deletes the corresponding availability record.
 * 
 * @param {boolean} isAutosave - If true, this is an autosave (no prompts, quieter feedback)
 */
async function savePending(isAutosave = false){
  if(state.isSaving) return; // single-flight
  if(!state.currentUserId) return;
  if(!Object.keys(state.pending).length) return;

  const uid = state.currentUserId;
  
  // For autosave, check auth without prompting
  const auth = state.auth.get(uid);
  if(!auth){
    // Not authenticated - skip autosave, wait for manual save which will prompt
    if(isAutosave) return;
    // Manual save - prompt for auth
    await ensureAuthedForUser(uid);
    return; // ensureAuthedForUser will throw, but if it doesn't, exit
  }

  // Snapshot what we intend to save - use validatePendingForSave to KEEP null values
  const toSave = validatePendingForSave(state.pending);
  if(!Object.keys(toSave).length) return;

  // Show loading indicator (spinning icon) for both autosave and manual save
  setLoading(true, isAutosave ? 'Auto-saving...' : 'Saving...');
  state.isSaving = true;

  const postSave = async () => {
    const url=new URL('api.php', window.location.href);
    url.searchParams.set('action','save');
    url.searchParams.set('c', state.token);
    const headers={'Content-Type':'application/json'};
    const csrf = await ensureCsrfToken();
    if(csrf) headers['X-CSRF-Token']=csrf;
    const resp = await accessFetch(url.toString(), {
      method:'POST',
      headers,
      body: JSON.stringify({user_id: uid, changes: toSave}),
      credentials:'same-origin'
    });
    let data = null;
    try{ data = await resp.json(); }catch(e){ data = null; }
    return { status: resp.status, ok: resp.ok, data };
  };

  const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));
  const shouldRetry = (httpStatus, err) => {
    if(err) return true; // network / unexpected
    if(httpStatus === 429) return true;
    if(httpStatus >= 500 && httpStatus <= 599) return true;
    return false;
  };

  try{
    // Retry with exponential backoff for transient failures
    const maxAttempts = 4;
    let lastErr = null;
    let saveData = null;
    let bookingsClosed = false;
    for(let attempt=1; attempt<=maxAttempts; attempt++){
      try{
        const res = await postSave();
        if(res.data && res.data.status === 'success'){
          lastErr = null;
          saveData = res.data;
          break;
        }
        if(res.data && res.data.code === 'BOOKINGS_CLOSED'){
          lastErr = null;
          bookingsClosed = true;
          break;
        }

        // Non-success JSON response
        const msg = (res.data && res.data.message) ? String(res.data.message) : 'Save failed';
        const transient = shouldRetry(res.status, null);
        if(!transient){
          throw new Error(msg);
        }
        lastErr = new Error(msg);
      }catch(e){
        // fetch() error or JSON parse failure
        const transient = shouldRetry(0, e);
        if(!transient){
          throw e;
        }
        lastErr = e;
      }

      if(attempt < maxAttempts){
        const base = 350 * Math.pow(2, attempt-1);
        const jitter = Math.floor(Math.random()*180);
        await sleep(Math.min(3500, base + jitter));
      }
    }
    if(lastErr) throw lastErr;

    if(bookingsClosed){
      handleBookingsClosedOnSave(uid);
      return;
    }

    // Booking calendars: the server refuses bookings for full slots or over the per-person limit
    const rejected = isBookingMode() && Array.isArray(saveData?.rejected) ? saveData.rejected : [];
    const rejectedKeys = new Set(rejected.map(r => `${r.day}\n${r.slot}`));
    for(const r of rejected){
      if(toSave[r.day]) delete toSave[r.day][r.slot];
      if(state.pending[r.day]){
        delete state.pending[r.day][r.slot];
        if(!Object.keys(state.pending[r.day]).length) delete state.pending[r.day];
      }
    }

    // Commit snapshot into local store
    for(const [dateStr, slots] of Object.entries(toSave)){
      for(const [slot,st] of Object.entries(slots)){
        if(rejectedKeys.has(`${dateStr}\n${slot}`)) continue;
        const key=`${uid}\n${dateStr}\n${slot}`;
        if(Number(st)===STATUS_NULL) state.store.delete(key); else state.store.set(key, Number(st));
      }
    }

    // Remove only the saved entries from pending if they are unchanged; keep newer edits.
    for(const [dateStr, slots] of Object.entries(toSave)){
      const curDay = state.pending[dateStr];
      if(!curDay) continue;
      for(const [slot,st] of Object.entries(slots)){
        if(curDay[slot] === st) delete curDay[slot];
      }
      if(Object.keys(curDay).length===0) delete state.pending[dateStr];
    }

    // Persist new pending state (may be empty) and refresh UI
    persistPendingNow();
    if(!Object.keys(state.pending).length){
      clearPersistedPending(uid);
    }
    updateSubmitButtonState();
    refreshCalendarValues();
    
    // Clear legend highlights after successful save
    clearLegendHighlights();
    
    if(isBookingMode()){
      if(rejected.some(r => r.reason === 'full')) showToast('Just taken by someone else');
      else if(rejected.some(r => r.reason === 'limit')) showToast(bookingLimitMessage());
      else showToast('Saved to server!');
      await reloadAvailability();
      return;
    }

    // Show success feedback
    showToast('Saved to server!');
  } catch(e) {
    // Only show error alert for manual save, not autosave
    if(!isAutosave){
      console.error('Save failed:', e);
      alert('Save failed. Please try again.');
    } else {
      console.error('Autosave failed:', e);
    }
  } finally {
    state.isSaving = false;
    setLoading(false);
  }
}

/**
 * Reset current user's own availability.
 * Requires double confirmation (confirm dialog + type "RESET").
 * Available to all authenticated users.
 */
async function resetMyAvailability(){
  if(!state.currentUserId){
    showToast('No user selected.');
    return;
  }
  
  const auth = state.auth.get(state.currentUserId);
  if(!auth){
    showToast('Join this calendar first.');
    return;
  }
  
  if(isBookingMode()){ await cancelMyBookings(auth); return; }

  const currentUser = state.users.find(u => u.id === state.currentUserId);
  const userName = currentUser ? currentUser.display_name : 'your';
  
  // First confirmation
  if(!confirm(`[!] WARNING: This will permanently delete ALL your availability data.\n\nThis action cannot be undone.\n\nAre you sure you want to reset ${userName}'s availability?`)) {
    return;
  }
  
  // Second confirmation - prompt to type "RESET"
  const confirmInput = prompt('To confirm, please type RESET (in capitals):');
  if(confirmInput === null) {
    // User cancelled
    return;
  }
  if(confirmInput.trim().toUpperCase() !== 'RESET') {
    showToast('Reset cancelled - confirmation code incorrect.');
    return;
  }
  
  try {
    const res = await apiPost('reset_user', { user_id: state.currentUserId }, auth.token);
    
    if(res.status !== 'success'){
      alert('Reset failed: ' + (res.message || 'Unknown error'));
      return;
    }
    
    // Clear local stored availability for this user
    for(const key of state.store.keys()){
      if(key.startsWith(`${state.currentUserId}\n`)){
        state.store.delete(key);
      }
    }
    
    // Clear pending changes
    state.pending = {};
    clearPersistedPending(state.currentUserId);
    
    // Reload availability data and refresh UI
    state.loadedRanges.clear();
    await ensureDateRangeLoaded();
    updateSubmitButtonState();
    refreshCalendarValues();
    renderRankings();
    
    showToast('Your availability has been reset');
  } catch(e) {
    console.error('Reset failed:', e);
    alert('Reset failed. Please try again.');
  }
}

/**
 * Reset ALL availability for ALL users (admin only).
 * Requires double confirmation (confirm dialog + type "RESET").
 */
async function resetAllUsers(){
  // Check if current user is admin
  const currentUser = state.users.find(u => u.id === state.currentUserId);
  if(!currentUser || currentUser.role !== 'admin'){
    showToast('Only admin can reset the calendar.');
    return;
  }
  
  // First confirmation
  const allWarning = isBookingMode()
    ? '[!] WARNING: This will cancel ALL bookings for ALL users in this calendar.\n\nThis action cannot be undone.\n\nAre you sure you want to continue?'
    : '[!] WARNING: This will permanently delete ALL availability data for ALL users in this calendar.\n\nThis action cannot be undone.\n\nAre you sure you want to continue?';
  if(!confirm(allWarning)) {
    return;
  }
  
  // Second confirmation - prompt to type "RESET"
  const confirmInput = prompt('To confirm, please type RESET (in capitals):');
  if(confirmInput === null) {
    // User cancelled
    return;
  }
  if(confirmInput.trim().toUpperCase() !== 'RESET') {
    showToast('Reset cancelled - confirmation code incorrect.');
    return;
  }
  
  try {
    const auth = await ensureAuthedForUser(state.currentUserId);
    const res = await apiPost('reset_all', { confirm_code: 'RESET' }, auth.token);
    
    if(res.status !== 'success'){
      alert('Reset failed: ' + (res.message || 'Unknown error'));
      return;
    }
    
    state.pending = {};
    if(isBookingMode()){
      await reloadAvailability();
      showToast('All bookings cancelled');
      return;
    }

    // Clear all stored availability from local state
    state.store.clear();
    state.loadedRanges.clear();
    
    // Reload availability data and refresh UI
    await ensureDateRangeLoaded();
    updateSubmitButtonState();
    refreshCalendarValues();
    renderRankings();
    
    showToast('All availability has been reset');
  } catch(e) {
    console.error('Reset all failed:', e);
    alert('Reset failed. Please try again.');
  }
}

/*** Full range helpers */
function getFullCalendarRange(){ return {from: state.startDate, to: state.endDate}; }
async function ensureDateRangeLoaded(){ if(!state.startDate || !state.endDate) return; const {from,to}=getFullCalendarRange(); await ensureRangeLoaded(from,to); }
