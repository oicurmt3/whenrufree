/**
 * calendar-main.js - Calendar page startup: event wiring, session restore and init.
 * Classic script sharing global scope. Load order: passkey.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
 */
'use strict';

/*** Events */
els.togglePastDatesBtn.addEventListener('click', ()=>{
  state.hidePastDates = !state.hidePastDates;
  try { sessionStorage.setItem('hidePastDates', state.hidePastDates ? '1' : '0'); } catch(e){}
  applyPastDateFilter();
  if(isBookingMode()) renderRankings();
});

els.shareBtn.addEventListener('click', async ()=>{
  const calendarName = state.calendarTitle || 'When RU Free';
  const url = `https://whenrufree.net/calendar.html?c=${encodeURIComponent(state.token)}`;
  const title = `${calendarName} \u2013 When RU Free`;
  const emojiLine = window.AccessEmoji ? AccessEmoji.shareLine(state.accessEmoji, state.accessHubEmoji) : '';
  const intro = (isBookingMode() ? `Book a slot for ${calendarName}` : `Join the ${calendarName} and add your availability`)
    + (emojiLine ? ` (${emojiLine})` : '') + ':';

  try {
    if(navigator.share){
      // url is appended automatically by the OS share sheet, so keep it out of text
      await navigator.share({ title, text: intro, url });
      return;
    }
  } catch(e){}

  // Fallback: copy full message + URL to clipboard
  try {
    await navigator.clipboard.writeText(`${intro}\n${url}`);
    showToast('Link copied!');
  } catch {
    showToast('Copy failed - copy from the address bar.');
  }
});

// Reset Mine button - resets current user's own availability
els.resetMineBtn.addEventListener('click', ()=> resetMyAvailability());

// Reset All button - admin only, resets all users
els.resetAllBtn.addEventListener('click', ()=> resetAllUsers());

// Sort toggle buttons - switch between score and date sorting
// All authenticated users can toggle locally; only organiser saves to server
els.sortToggle.addEventListener('click', (e)=>{
  const btn = e.target.closest('.sort-btn');
  if(!btn) return;
  const mode = btn.dataset.mode;
  if(isBookingMode()){
    if(mode === 'booked' || mode === 'mine' || mode === 'free'){ state.bookingView = mode; renderRankings(); }
    return;
  }
  if(!mode || mode === state.rankSortOrder) return;
  // Require authentication to change sort order
  const auth = state.auth.get(state.currentUserId || -1);
  if(!auth) return;
  state.rankSortOrder = mode;
  updateSortToggleUI();
  renderRankings();
  // Only organiser saves the default to server
  if(isCurrentUserOrganiser()){
    saveSortOrderToServer();
  }
});

// Limit toggle buttons - switch between 2, 10, and all
els.limitToggle.addEventListener('click', (e)=>{
  const btn = e.target.closest('.limit-btn');
  if(!btn) return;
  const limit = parseInt(btn.dataset.limit, 10);
  if(isNaN(limit) || limit === state.rankLimit) return;
  state.rankLimit = limit;
  updateLimitToggleUI();
  renderRankings();
});
// Organiser message: click to edit, save, cancel, char count
els.organiserMessageText.addEventListener('click', ()=> openMessageEdit());
els.organiserMessageCancel.addEventListener('click', ()=> cancelMessageEdit());
els.organiserMessageSave.addEventListener('click', ()=> saveOrganiserMessage());
els.organiserMessageInput.addEventListener('input', ()=> updateMessageCharCount());
// Allow Enter (without Shift) to save, Escape to cancel
els.organiserMessageInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    saveOrganiserMessage();
  }
  if(e.key === 'Escape'){
    cancelMessageEdit();
  }
});

els.bannerAddBtn.addEventListener('click', ()=> openUserModal('add'));
els.renameBtn.addEventListener('click', ()=>{ if(!state.currentUserId) return; openUserModal('rename'); });

// "Add Your Name" link in User Select modal
els.userSelectAddLink.addEventListener('click', (e)=>{
  e.preventDefault();
  closeUserSelectModal();
  openUserModal('add');
});

// User select button click - open selection modal
els.userSelectBtn.addEventListener('click', ()=> openUserSelectModal());

// User select modal cancel
els.userSelectCancel.addEventListener('click', ()=> closeUserSelectModal());

// Info modal event listeners
els.infoModalCancel.addEventListener('click', closeInfoModal);
els.infoModalAdd.addEventListener('click', () => {
  closeInfoModal();
  openUserModal('add');
});

els.submitBtn.addEventListener('click', async ()=>{
  if(!Object.keys(state.pending).length){ showToast('No changes to save.'); return; }
  // Cancel any pending autosave since we're saving manually
  cancelAutosave();
  try{
    await savePending(false); // false = manual save
    refreshCalendarValues();
    await ensureCalendarLoadedAllDates();
    renderRankings();
  }catch(e){
    console.error(e); alert('Save failed. Please try again.');
  }
});

/*** Auto-authenticate calendar creator (called once on page load after creation) */
async function tryAutoAuthCreator(){
  try {
    const raw = sessionStorage.getItem('creator_auth');
    if(!raw) return false;
    
    const creds = JSON.parse(raw);
    // Clear immediately to prevent reuse
    sessionStorage.removeItem('creator_auth');
    
    // Verify this is for the current calendar
    if(creds.token !== state.token) return false;
    
    // Find the admin user by name
    const adminUser = state.users.find(u => 
      u.role === 'admin' && 
      u.display_name.toLowerCase() === creds.admin_name.toLowerCase()
    );
    
    if(!adminUser) {
      console.warn('Creator auto-auth: admin user not found');
      return false;
    }
    
    // Authenticate with the stored PIN
    const res = await apiPost('auth_user', {
      user_id: adminUser.id, 
      pin: creds.admin_pin
    });
    
    if(res.status !== 'success') {
      console.warn('Creator auto-auth failed:', res.message);
      return false;
    }
    
    // Success - set up the user session
    state.currentUserId = adminUser.id;
    state.currentUserName = `${adminUser.display_name} (organiser)`;
    state.currentUserRole = adminUser.role;
    cacheAuth(adminUser.id, res.auth_token, res.role, 86400);
    
    console.log('Creator auto-authenticated as:', adminUser.display_name);
    return true;
  } catch(e) {
    console.warn('Creator auto-auth error:', e);
    // Clear any corrupted data
    try { sessionStorage.removeItem('creator_auth'); } catch(x){}
    return false;
  }
}

/**
 * Restores a cached user session from localStorage on page load.
 * Checks all users for a valid cached auth token and restores the first found.
 * This allows users to stay logged in across page refreshes.
 */
function tryRestoreCachedSession(){
  for(const u of state.users){
    const cached = getCachedAuth(u.id);
    if(cached){
      // Found valid cached auth - restore session
      state.currentUserId = u.id;
      state.currentUserName = u.role === 'admin' ? `${u.display_name} (organiser)` : u.display_name;
      state.currentUserRole = u.role;
      state.auth.set(u.id, cached);
      console.log('Restored cached session for:', u.display_name);
      return true;
    }
  }
  return false;
}

/*** Initialise */
async function init(){
  // Restore hide-past-dates preference from session
  // Default is hidden; only override if user has explicitly chosen to show past dates
  try {
    const saved = sessionStorage.getItem('hidePastDates');
    if (saved !== null) state.hidePastDates = saved === '1';
  } catch(e){}

  state.token = getToken();
  // Accept 8-64 chars for backward compatibility (old tokens were 48 chars, new are 8)
  if(!state.token || !/^[A-Za-z0-9_\-]{8,64}$/.test(state.token)){
    alert('Missing or invalid calendar token. Go back to the home page to create one.');
    window.location.href='index.html'; return;
  }
  try{
    await loadCalendarMeta();
    await loadUsers();
    
    // Auto-authenticate creator if they just created this calendar
    const creatorAuth = await tryAutoAuthCreator();
    
    // If no creator auth, try to restore cached session from localStorage
    if(!creatorAuth){
      tryRestoreCachedSession();
    }

    // Restore any unsaved pending changes for the selected user
    if(state.currentUserId){
      state.pending = restorePendingForUser(state.currentUserId);
    }
    
    els.serverStatus.textContent='Connected'; els.serverStatus.classList.add('connected');
    updateCurrentUserDisplay();
    await ensureDateRangeLoaded();
    renderDateRangeSkeleton();
    refreshCalendarValues();
    updateDateFilterBanner();
    updateSubmitButtonState();
    updateUserUI();
    // Initialize toggle UIs before rendering rankings
    updateSortToggleUI();
    updateLimitToggleUI();
    renderRankings();

    // Apply chosen/frozen state (banner + grid dimming)
    updateChosenBanner();
    applyFrozenState();
    if(isBookingMode()) startBookingRefresh();

    // Warn before leaving when there are unsaved (pending) changes
    window.addEventListener('beforeunload', (e)=>{
      // Save any pending date filter changes immediately
      if(state.dateFilterDirty){
        saveDateFilterDates();
      }
      if(Object.keys(state.pending).length){
        persistPendingNow();
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }catch(e){
    console.error('Initialization error:', e);
    els.serverStatus.textContent='Offline'; els.serverStatus.classList.add('offline');
    alert('Failed to load calendar. Please try again.');
  }
}
document.getElementById('hubAddBtn')?.addEventListener('click', showHubModal);
document.getElementById('hubRemoveBtn')?.addEventListener('click', removeFromHub);
document.getElementById('hubModalCancel')?.addEventListener('click', hideHubModal);
document.getElementById('hubModalConfirm')?.addEventListener('click', confirmAddToHub);
els.settingsBtn.addEventListener('click', openSettingsModal);
els.settingsClose.addEventListener('click', hideSettingsModal);
document.addEventListener('DOMContentLoaded', init);

/*** Ensure rankings reflect all dates after changes */
async function ensureCalendarLoadedAllDates(){
  if(!state.startDate || !state.endDate) return;
  await ensureRangeLoaded(state.startDate, state.endDate);
}