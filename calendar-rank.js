/**
 * calendar-rank.js - Calendar page Best Match: calendar links, share, rank scores, sort/limit toggles, organiser message, chosen slot.
 * Classic script sharing global scope. Load order: passkey.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
 */
'use strict';

/*** Calendar links (Google / ICS) - All-day events with 24hr reminder */
function buildCalendarLinks(item){
  const calendarName = state.calendarTitle || 'Catch-up';
  const dateStr = item.dateStr;
  const slotLabel = item.slotLabel;
  const friendlyDate = formatFriendlyDate(dateStr);
  
  // Event title: "{calendar name}"
  const eventTitle = calendarName;
  
  // Event description: "{calendar name} organised for {slot} on {date}"
  const eventDescription = `${calendarName} has been organised for ${slotLabel} on ${friendlyDate}`;
  
  const dateOnly = dateStr.replace(/-/g,'');
  
  // Calculate next day for all-day event end date
  const d = new Date(dateStr+'T00:00:00');
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate()+1);
  const nextDayStr = `${nextDay.getFullYear()}${String(nextDay.getMonth()+1).padStart(2,'0')}${String(nextDay.getDate()).padStart(2,'0')}`;
  
  // Google Calendar URL (all-day event)
  // Note: Google Calendar doesn't support reminder via URL params, but it will use user's default
  const gcalURL = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventTitle)}&dates=${dateOnly}/${nextDayStr}&details=${encodeURIComponent(eventDescription)}`;
  
  // ICS file with all-day event and 24-hour reminder
  const uid = `grape-${state.token}-${dateOnly}-${encodeURIComponent(slotLabel)}`;
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}T${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}00Z`;
  
  let ics = 'BEGIN:VCALENDAR\r\n';
  ics += 'VERSION:2.0\r\n';
  ics += 'PRODID:-//When//RU//Free//EN\r\n';
  ics += 'BEGIN:VEVENT\r\n';
  ics += `UID:${uid}\r\n`;
  ics += `DTSTAMP:${dtstamp}\r\n`;
  ics += `SUMMARY:${eventTitle}\r\n`;
  ics += `DESCRIPTION:${eventDescription}\r\n`;
  ics += `DTSTART;VALUE=DATE:${dateOnly}\r\n`;
  ics += `DTEND;VALUE=DATE:${nextDayStr}\r\n`;
  // 24-hour reminder (VALARM)
  ics += 'BEGIN:VALARM\r\n';
  ics += 'ACTION:DISPLAY\r\n';
  ics += `DESCRIPTION:Reminder: ${eventTitle}\r\n`;
  ics += 'TRIGGER:-P1D\r\n'; // 1 day before (24 hours)
  ics += 'END:VALARM\r\n';
  ics += 'END:VEVENT\r\n';
  ics += 'END:VCALENDAR\r\n';
  
  const blob = new Blob([ics], {type:'text/calendar;charset=utf-8'});
  const icsBlobUrl = URL.createObjectURL(blob);
  const icsName = `${calendarName.replace(/\s+/g,'_')}_${dateOnly}.ics`;
  
  return { gcalURL, icsBlobUrl, icsName };
}

/**
 * Shares ranking details for a specific date/slot via Web Share API or clipboard.
 * Includes the calendar name, date, slot, and roster with statuses.
 * @param {Object} item - The ranking item with dateStr, slotLabel, details
 * @param {Array} opts - STATUS_OPTIONS array for label lookup
 */
async function shareRankingDetails(item, opts){
  const calendarName = state.calendarTitle || 'When RU Free';
  const friendlyDate = formatFriendlyDate(item.dateStr);
  const slotLabel = item.slotLabel;
  
  // Build roster text grouped by status
  const sorted = (item.details ?? []).slice().sort((a, b) => {
    const wa = Number(opts[a.status - 1]?.weight ?? 0) || 0;
    const wb = Number(opts[b.status - 1]?.weight ?? 0) || 0;
    if (wa !== wb) return wb - wa;
    return a.name.localeCompare(b.name);
  });
  
  // Group by status
  const groups = {};
  for (const d of sorted) {
    const label = opts[d.status - 1]?.label ?? `Status ${d.status}`;
    if (!groups[label]) groups[label] = [];
    groups[label].push(d.name);
  }
  
  // Build roster text
  let rosterText = '';
  for (const [label, names] of Object.entries(groups)) {
    rosterText += `${label}: ${names.join(', ')}\n`;
  }
  
  // Compose share text
  const title = `${calendarName} - ${friendlyDate}`;
  const text = `${calendarName}\n${friendlyDate} - ${slotLabel}\n\n${rosterText.trim()}`;
  
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return;
    }
  } catch (e) {
    // User cancelled or share failed - fall through to clipboard
  }
  
  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch (e) {
    showToast('Share failed');
  }
}

/*** Ranking (single bordered card; details hidden until expanded) */
/**
 * Builds ranked date/slot combinations using per-status weights.
 * Convention:
 * - Status 1: weight 2 (positive)
 * - Status 2: weight 1 (tentative)
 * - Status 3..N: weight 0 (neutral/negative)
 */
function buildRankScores(){
  if(state.users.length===0 || !state.startDate || !state.endDate) return [];
  const {from,to}=getFullCalendarRange();
  const start=new Date(from+'T00:00:00'), end=new Date(to+'T00:00:00');
  const scores=[];
  const opts = Array.isArray(STATUS_OPTIONS) ? STATUS_OPTIONS : [];
  const n = opts.length;
  const fromSummary = useSummaryForRankings();
  for(let dt=new Date(start); dt<=end; dt.setDate(dt.getDate()+1)){
    const dow = dt.getDay(); // 0=Sun,6=Sat
    if(state.excludeWeekends && (dow===0 || dow===6)) continue;
    const dateStr=fmtDate(dt);
    if(!isDateVisible(dateStr)) continue;
    for(const slot of TIME_SLOTS){
      const counts = Array(n).fill(0);
      let score = 0;
      let weightResponses = 0;
      const details=[];
      if (fromSummary) {
        for (let idx = 0; idx < n; idx++) {
          const status = idx + 1;
          const cnt = getSummaryCount(dateStr, slot.id, status);
          if (cnt <= 0) continue;
          counts[idx] += cnt;
          const w = Number(opts[idx]?.weight ?? 0) || 0;
          score += w * cnt;
          if (w > 0) weightResponses += cnt;
        }
      } else {
        for(const u of state.users){
          const {status}=getStatus(u.id, dateStr, slot.id);
          if(status===STATUS_NULL) continue;
          const idx = status - 1;
          if(idx < 0 || idx >= n) continue;
          counts[idx] += 1;
          const w = Number(opts[idx]?.weight ?? 0) || 0;
          score += w;
          if(w > 0) weightResponses += 1;
          details.push({name:u.display_name, status});
        }
      }
      if(weightResponses >= 2){
        scores.push({ dateStr, slotId:slot.id, slotLabel:slot.label, counts, score, details });
      }
    }
  }
  // Sort based on the organiser's chosen rank sort order
  if (state.rankSortOrder === 'date') {
    // Chronological: earliest date first, then by slot display order for same date
    // Build a lookup of slot position from TIME_SLOTS so tiebreaker respects
    // the organiser's configured slot order rather than alphabetical labels
    const slotOrder = new Map();
    TIME_SLOTS.forEach((s, i) => slotOrder.set(s.id, i));
    scores.sort((a, b) => {
      const dc = a.dateStr.localeCompare(b.dateStr);
      if (dc !== 0) return dc;
      return (slotOrder.get(a.slotId) ?? 999) - (slotOrder.get(b.slotId) ?? 999);
    });
  } else {
    // Score order: highest score first (default)
    scores.sort((a, b) => b.score - a.score);
  }
  return scores;
}

/**
 * Updates the sort toggle UI to reflect the current sort order.
 * Shows the toggle for all authenticated users (organiser and members).
 * Non-authenticated viewers see no toggle and no title text.
 * The organiser sets the default sort order (saved to server for all users).
 * Any authenticated user can change the toggle locally during their session.
 */
function updateSortToggleUI(){
  if(!els.sortToggle) return;

  // Booking calendars: Booked / Free for the organiser, Mine / Free for everyone else
  if(isBookingMode()){
    els.sortToggle.style.display = 'flex';
    if(els.analysisTitleText) els.analysisTitleText.style.display = 'none';
    const [firstBtn, freeBtn] = els.sortToggle.querySelectorAll('.sort-btn');
    if(isAuthedOrganiser()){
      setBookingViewButton(firstBtn, 'booked', 'check_circle', 'Booked');
    } else {
      let label = 'Mine';
      if(state.currentUserId && state.auth.get(state.currentUserId)){
        const n = myTotalBookingCount(true);
        label = state.booking.perUserTotal ? `Mine (${n} of ${state.booking.perUser})` : `Mine (${n})`;
      }
      setBookingViewButton(firstBtn, 'mine', 'person', label);
    }
    setBookingViewButton(freeBtn, 'free', 'event_available', 'Free');
    const view = currentBookingView();
    els.sortToggle.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === view);
    });
    return;
  }

  // Determine if current user is authenticated
  const auth = state.auth.get(state.currentUserId || -1);
  const isAuthenticated = !!auth;

  // Hide toggle and title text for non-authenticated viewers
  if(!isAuthenticated){
    els.sortToggle.style.display = 'none';
    if(els.analysisTitleText){
      els.analysisTitleText.style.display = 'none';
    }
    return;
  }

  // Show toggle for all authenticated users, always hide title text
  els.sortToggle.style.display = 'flex';
  if(els.analysisTitleText){
    els.analysisTitleText.style.display = 'none';
  }

  const buttons = els.sortToggle.querySelectorAll('.sort-btn');
  buttons.forEach(btn => {
    const mode = btn.dataset.mode;
    if(mode === state.rankSortOrder){
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Updates the limit toggle UI to reflect the current rank limit.
 */
function updateLimitToggleUI(){
  if(!els.limitToggle) return;
  const buttons = els.limitToggle.querySelectorAll('.limit-btn');
  buttons.forEach(btn => {
    const limit = parseInt(btn.dataset.limit, 10);
    if(limit === state.rankLimit){
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Saves the sort order preference to the server.
 * Called when organiser changes sort order via toggle.
 */
async function saveSortOrderToServer(){
  if(!state.adminUserId) return;
  const auth = state.auth.get(state.adminUserId);
  if(auth && auth.token){
    try{
      await apiPost('save_rank_sort', { order: state.rankSortOrder }, auth.token);
    } catch(e){
      console.warn('Failed to save rank sort order:', e);
    }
  }
}

/* ============================================
   ORGANISER MESSAGE
   Shows a short note from the organiser to all
   participants. Organiser can click to edit inline.
   ============================================ */

/**
 * Escapes a string for safe insertion as HTML text content.
 * @param {string} str - Raw string
 * @returns {string} HTML-escaped string
 */
function escapeMessageHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Updates the organiser message display based on current state.
 * - Shows the message area if there is a message or user is organiser
 * - Organiser sees editable text; others see read-only
 */
function updateOrganiserMessageUI(){
  if(!els.organiserMessageWrap) return;

  const isOrg = isCurrentUserOrganiser();
  const hasMessage = state.organiserMessage.length > 0;

  // Show the area if there is a message OR the organiser is viewing (so they can add one)
  if(!hasMessage && !isOrg){
    els.organiserMessageWrap.style.display = 'none';
    return;
  }
  els.organiserMessageWrap.style.display = 'block';

  // Always hide edit mode when refreshing display
  els.organiserMessageEdit.style.display = 'none';

  // Set text content
  if(hasMessage){
    els.organiserMessageText.textContent = state.organiserMessage;
    els.organiserMessageText.classList.remove('placeholder');
  } else {
    els.organiserMessageText.textContent = 'Tap to add a note for participants...';
    els.organiserMessageText.classList.add('placeholder');
  }

  // Organiser can click to edit
  if(isOrg){
    els.organiserMessageText.classList.add('editable');
    els.organiserMessageText.style.display = 'block';
  } else {
    els.organiserMessageText.classList.remove('editable');
    els.organiserMessageText.style.display = 'block';
  }
}

/**
 * Opens the inline edit mode for the organiser message.
 */
function openMessageEdit(){
  if(!isCurrentUserOrganiser()) return;
  els.organiserMessageText.style.display = 'none';
  els.organiserMessageEdit.style.display = 'block';
  els.organiserMessageInput.value = state.organiserMessage;
  els.organiserMessageInput.maxLength = state.organiserMessageMax;
  updateMessageCharCount();
  els.organiserMessageInput.focus();
}

/**
 * Closes the inline edit mode without saving.
 */
function cancelMessageEdit(){
  els.organiserMessageEdit.style.display = 'none';
  els.organiserMessageText.style.display = 'block';
}

/**
 * Updates the character counter below the textarea.
 */
function updateMessageCharCount(){
  const len = els.organiserMessageInput.value.length;
  els.organiserMessageCount.textContent = len + '/' + state.organiserMessageMax;
}

/**
 * Saves the organiser message to the server and updates local state.
 */
async function saveOrganiserMessage(){
  const msg = els.organiserMessageInput.value.trim().substring(0, state.organiserMessageMax);
  const auth = state.auth.get(state.currentUserId);
  if(!auth || !auth.token) return;

  try{
    const result = await apiPost('save_organiser_message', { message: msg }, auth.token);
    if(result.status === 'success'){
      state.organiserMessage = (result.organiser_message || '').toString();
      updateOrganiserMessageUI();
      showToast('Message saved');
    } else {
      showToast('Failed to save message');
    }
  } catch(e){
    console.warn('Failed to save organiser message:', e);
    showToast('Failed to save message');
  }
}

/**
 * Returns true if the organiser has locked in a chosen date+slot.
 * When frozen, non-organiser users cannot change availability.
 * @returns {boolean}
 */
function isCalendarFrozen(){
  return !!(state.chosenDate && state.chosenSlot);
}

/**
 * Renders or removes the "Decided" banner at the top of the analysis section.
 * Shows the chosen date+slot to all users. Organiser sees a Reopen button.
 */
function canReopenCalendar(){
  return isCurrentUserOrganiser() && !!state.auth.get(state.currentUserId || -1)?.token;
}

function updateChosenBanner(){
  if(isBookingMode()){ updateBookingClosedBanner(); return; }
  const existing = document.getElementById('chosenBanner');
  if(!isCalendarFrozen()){
    if(existing) existing.remove();
    return;
  }
  const friendlyDate = formatFriendlyDate(state.chosenDate);
  const slotLabel = state.chosenSlot;

  if(existing){
    // Update text in existing banner
    const txt = existing.querySelector('.chosen-banner-text');
    if(txt) txt.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:18px;vertical-align:middle;">check_circle</span> '
      + ' Decided: <strong>' + escapeHTML(friendlyDate) + ' - ' + escapeHTML(slotLabel) + '</strong>';
    // Toggle reopen button visibility
    const reopenBtn = existing.querySelector('.chosen-reopen-btn');
    if(reopenBtn) reopenBtn.style.display = canReopenCalendar() ? 'inline-flex' : 'none';
    return;
  }

  // Create banner
  const banner = document.createElement('div');
  banner.id = 'chosenBanner';
  banner.className = 'chosen-banner';
  banner.innerHTML =
    '<span class="chosen-banner-text">'
    + '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:18px;vertical-align:middle;">check_circle</span> '
    + ' Decided: <strong>' + escapeHTML(friendlyDate) + ' - ' + escapeHTML(slotLabel) + '</strong>'
    + '</span>'
    + '<button type="button" class="btn btn-sm chosen-reopen-btn" style="display:' + (canReopenCalendar() ? 'inline-flex' : 'none') + ';">'
    + '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;">lock_open</span> Reopen'
    + '</button>';

  // Attach reopen handler
  const reopenBtn = banner.querySelector('.chosen-reopen-btn');
  if(reopenBtn){
    reopenBtn.addEventListener('click', () => unchooseSlot());
  }

  // Insert before the analysis card
  const section = document.querySelector('.analysis-section');
  if(section){
    section.insertBefore(banner, section.firstChild);
  }
}

/**
 * Escapes a plain string for safe HTML insertion.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Applies frozen (decided) visual state to the calendar grid.
 * - Dims all slots except the chosen one
 * - Highlights the chosen slot with a special class
 * - Disables pointer events on non-chosen slots when frozen
 */
function applyFrozenState(){
  if(!isCalendarFrozen()){
    // Remove frozen classes if calendar was reopened
    els.calendarGrid.classList.remove('calendar-frozen');
    for(const [dateStr, slotMap] of state.slotEls.entries()){
      for(const [slotId, el] of slotMap.entries()){
        el.classList.remove('chosen-slot', 'frozen-slot');
      }
    }
    return;
  }

  els.calendarGrid.classList.add('calendar-frozen');
  for(const [dateStr, slotMap] of state.slotEls.entries()){
    for(const [slotId, el] of slotMap.entries()){
      if(dateStr === state.chosenDate && slotId === state.chosenSlot){
        el.classList.add('chosen-slot');
        el.classList.remove('frozen-slot');
      } else {
        el.classList.add('frozen-slot');
        el.classList.remove('chosen-slot');
      }
    }
  }
}

/**
 * Sends the choose_slot API call to lock in a date+slot.
 * Called from the rank card "Choose" button (organiser only).
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} slotId - Slot ID
 */
async function chooseSlot(dateStr, slotId){
  if(!isCurrentUserOrganiser()) return;
  const auth = state.auth.get(state.currentUserId);
  if(!auth || !auth.token) return;

  // Find the slot label for the confirmation dialog
  const slotObj = TIME_SLOTS.find(s => s.id === slotId);
  const slotLabel = slotObj ? slotObj.label : slotId;
  const friendlyDate = formatFriendlyDate(dateStr);

  if(!confirm('Lock in "' + friendlyDate + ' - ' + slotLabel + '" as the final choice?\n\nThis will freeze the calendar for all participants.')){
    return;
  }

  try{
    const res = await apiPost('choose_slot', {
      chosen_date: dateStr,
      chosen_slot: slotId
    }, auth.token);
    if(res.status === 'success'){
      state.chosenDate = res.chosen_date;
      state.chosenSlot = res.chosen_slot;
      updateChosenBanner();
      applyFrozenState();
      renderRankings();
      updateUserUI();
      showToast('Slot locked in!');
    } else {
      showToast(res.message || 'Failed to lock slot');
    }
  }catch(e){
    console.error('choose_slot failed:', e);
    showToast('Failed to lock slot');
  }
}

/**
 * Sends the unchoose_slot API call to reopen the calendar.
 * Called from the Reopen button in the chosen banner (organiser only).
 */
async function unchooseSlot(){
  if(!isCurrentUserOrganiser()) return;
  const auth = state.auth.get(state.currentUserId);
  if(!auth || !auth.token) return;

  if(!confirm('Reopen this calendar?\n\nParticipants will be able to change their availability again.')){
    return;
  }

  try{
    const res = await apiPost('unchoose_slot', {}, auth.token);
    if(res.status === 'success'){
      state.chosenDate = null;
      state.chosenSlot = null;
      updateChosenBanner();
      applyFrozenState();
      renderRankings();
      updateUserUI();
      showToast('Calendar reopened');
    } else {
      showToast(res.message || 'Failed to reopen');
    }
  }catch(e){
    console.error('unchoose_slot failed:', e);
    showToast('Failed to reopen');
  }
}

function rankKey(item){ return `${item.dateStr}\n${item.slotId}`; }
function toggleRankExpand(key){
  if(state.expandedRanks.has(key)) state.expandedRanks.delete(key); else state.expandedRanks.add(key);
  renderRankings();
}
function renderRankings(){
  if(isBookingMode()){ renderBookings(); return; }
  const scores=buildRankScores();
  els.rankWrap.innerHTML='';
  els.rankEmpty.style.display = scores.length ? 'none' : 'block';
  
  // Update toggle UIs to reflect current state
  updateSortToggleUI();
  updateLimitToggleUI();
  
  if(!scores.length){ return; }

  const frozen = isCalendarFrozen();
  const isOrg = isCurrentUserOrganiser();

  // If frozen, pin the chosen card to the top regardless of sort/limit
  let shown;
  if(frozen){
    // Always show chosen card first, then the rest
    const chosenIdx = scores.findIndex(s => s.dateStr === state.chosenDate && s.slotId === state.chosenSlot);
    if(chosenIdx >= 0){
      const chosenItem = scores.splice(chosenIdx, 1)[0];
      const rest = state.rankLimit === 0 ? scores : scores.slice(0, Math.max(0, state.rankLimit - 1));
      shown = [chosenItem, ...rest];
    } else {
      shown = state.rankLimit === 0 ? scores : scores.slice(0, state.rankLimit);
    }
  } else {
    shown = state.rankLimit === 0 ? scores : scores.slice(0, state.rankLimit);
  }
  
  // Determine if roster should be visible based on privacy mode
  const showRoster = shouldShowRoster();
  
  for(const item of shown){
    const key=rankKey(item);
    const isOpen=state.expandedRanks.has(key);
    const opts = Array.isArray(STATUS_OPTIONS) ? STATUS_OPTIONS : [];
    const isChosenCard = frozen && item.dateStr === state.chosenDate && item.slotId === state.chosenSlot;

    // Card container (single bordered container)
    const card=document.createElement('div');
    card.className='rank-card' + (isOpen && showRoster ? ' open' : '') + (isChosenCard ? ' rank-card-chosen' : '');
    // Header button (always visible)
    const btn=document.createElement('button'); btn.className='rank-btn'; btn.type='button';
    const main=document.createElement('div'); main.className='rank-main';
    const line1=document.createElement('div'); line1.className='rank-line1';
    // Add a check icon for the chosen card
    if(isChosenCard){
      line1.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;vertical-align:middle;color:#357A38;">check_circle</span> ';
      line1.appendChild(document.createTextNode(formatFriendlyDate(item.dateStr) + ' - ' + item.slotLabel));
    } else {
      line1.textContent = formatFriendlyDate(item.dateStr) + ' - ' + item.slotLabel;
    }
    const line2=document.createElement('div');
    line2.className='rank-line2';
    const parts = (item.counts || []).map((c, idx) => `${c} ${opts[idx]?.label ?? `Status ${idx+1}`}`);
    line2.textContent = parts.join(', ');
    main.appendChild(line1); main.appendChild(line2);
    
    // Only show View/Hide pill if roster is visible
    if (showRoster) {
      const pill=document.createElement('div'); pill.className='rank-pill'; pill.textContent=isOpen ? 'Hide' : 'View';
      btn.appendChild(main); btn.appendChild(pill);
      btn.addEventListener('click', ()=>{
        if(state.expandedRanks.has(key)) state.expandedRanks.delete(key); else state.expandedRanks.add(key);
        renderRankings();
      });
    } else {
      btn.appendChild(main);
      btn.style.cursor = 'default';
    }
    
    // Details (hidden until expanded) - includes actions and roster
    const details=document.createElement('div'); details.className='rank-details';
    
    // Only build details content if roster is visible
    if (showRoster) {
      // Calendar actions (Google / ICS / Share)
      const actions = document.createElement('div'); actions.className='rank-actions';
      const links = buildCalendarLinks(item);
      const aG = document.createElement('a');
      aG.href = links.gcalURL; aG.target='_blank'; aG.rel='noopener';
      aG.className='btn-pill btn-cal';
      aG.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">event</span> Add`;
      const aI = document.createElement('a');
      aI.href = links.icsBlobUrl; aI.download = links.icsName;
      aI.className='btn-pill btn-ics';
      aI.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">download</span> Download`;
      
      // Share button for this specific date/slot with roster
      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'btn-pill btn-share';
      shareBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">share</span> Share`;
      shareBtn.addEventListener('click', () => shareRankingDetails(item, opts));
      
      actions.appendChild(aG); actions.appendChild(aI); actions.appendChild(shareBtn);

      // "Choose this" button for organiser when calendar is not yet frozen
      if(isOrg && !frozen){
        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.className = 'btn-pill btn-choose';
        chooseBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:16px;">check_circle</span> Choose';
        chooseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          chooseSlot(item.dateStr, item.slotId);
        });
        actions.appendChild(chooseBtn);
      }

      details.appendChild(actions);
      
      // Roster - inline display of names with status tags
      const sorted=(item.details??[]).slice().sort((a,b)=>{
        const wa = Number(opts[a.status-1]?.weight ?? 0) || 0;
        const wb = Number(opts[b.status-1]?.weight ?? 0) || 0;
        if(wa !== wb) return wb - wa; // higher weight first
        const la = (opts[a.status-1]?.label ?? '').toString();
        const lb = (opts[b.status-1]?.label ?? '').toString();
        if(la !== lb) return la.localeCompare(lb);
        return a.name.localeCompare(b.name);
      });
      if(!sorted.length){
        const empty=document.createElement('div'); empty.style.color='#777'; empty.style.fontWeight='700'; empty.textContent='No responses yet.';
        details.appendChild(empty);
      } else {
        // Create inline roster container
        const roster = document.createElement('div');
        roster.className = 'roster-inline';
        for(const d of sorted){
          const rosterItem = document.createElement('span');
          rosterItem.className = 'roster-item';
          
          const name = document.createElement('span');
          name.className = 'roster-name';
          name.textContent = d.name;
          
          const tag = document.createElement('span');
          tag.className = 'status-tag status-' + d.status;
          tag.textContent = (opts[d.status-1]?.label ?? `Status ${d.status}`);
          
          rosterItem.appendChild(name);
          rosterItem.appendChild(tag);
          roster.appendChild(rosterItem);
        }
        details.appendChild(roster);
      }
    } else if (state.privacyMode === 'blind') {
      // Blind mode: show privacy message when expanded
      const privMsg = document.createElement('div');
      privMsg.className = 'privacy-message';
      privMsg.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">lock</span> Individual responses are hidden in Blind mode.';
      details.appendChild(privMsg);
    }
    
    // Compose card
    card.appendChild(btn);
    if (showRoster || state.privacyMode === 'blind') {
      card.appendChild(details);
    }
    els.rankWrap.appendChild(card);
  }
}
const debouncedRank = debounce(renderRankings, 250);
