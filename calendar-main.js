/**
 * calendar-main.js - Calendar page startup: event wiring, sign-in check and init.
 * Classic script sharing global scope. Load order: passkey.js, account-core.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
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

// Read-only view of someone else's calendar: X or Escape goes back to yours
document.getElementById('viewBarClose').addEventListener('click', closeUserView);
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && state.viewUserId && !document.querySelector('.modal-overlay.active')) closeUserView();
});

// Manage one person (organiser): block / unblock, delete and report, then the review popup
if(els.manageBlockToggle){
  els.manageBlockToggle.addEventListener('click', (e)=>{
    const b = e.target.closest('.block-mode');
    if(b && !b.disabled) setManageBlock(b.dataset.blocked);
  });
}
if(els.manageDelete){
  els.manageDelete.addEventListener('change', ()=>{
    if(!state.manage) return;
    state.manage.delete = els.manageDelete.checked;
    updateManageState();
  });
}
if(els.manageReason){
  els.manageReason.addEventListener('change', ()=>{
    if(!state.manage) return;
    state.manage.reason = els.manageReason.value;
    updateManageState();
  });
}
if(els.manageDetails){
  els.manageDetails.addEventListener('input', ()=>{
    if(state.manage) state.manage.details = els.manageDetails.value.trim();
  });
}
if(els.manageUserCancel) els.manageUserCancel.addEventListener('click', closeManageModal);
if(els.manageUserConfirm) els.manageUserConfirm.addEventListener('click', openConfirmChoices);
if(els.choiceBack) els.choiceBack.addEventListener('click', closeConfirmChoices);
if(els.choiceApply) els.choiceApply.addEventListener('click', applyManageChoices);

// Report someone (everyone) and the organiser's report inbox
if(els.reportReason){
  els.reportReason.addEventListener('change', ()=>{
    els.reportSend.disabled = els.reportReason.value === '';
  });
}
if(els.reportCancel) els.reportCancel.addEventListener('click', closeReportModal);
if(els.reportSend) els.reportSend.addEventListener('click', submitReport);
if(els.reportsBtn) els.reportsBtn.addEventListener('click', openReportsModal);
if(els.reportsClose) els.reportsClose.addEventListener('click', closeReportsModal);
if(els.reportsList){
  els.reportsList.addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-decision]');
    if(!b || b.disabled) return;
    decideCalendarReport(Number(b.dataset.reportId), b.dataset.decision, b);
  });
}

// Escape closes the top layer only, so Back behaviour is predictable
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  if(els.choiceModal && els.choiceModal.classList.contains('active')) closeConfirmChoices();
  else if(els.manageUserModal && els.manageUserModal.classList.contains('active')) closeManageModal();
  else if(els.reportUserModal && els.reportUserModal.classList.contains('active')) closeReportModal();
  else if(els.reportsModal && els.reportsModal.classList.contains('active')) closeReportsModal();
});

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
  const me = await Account.require();
  Account.renderBadge(me, els.accountBadge);
  try{
    await loadCalendarMeta();
    await loadUsers();

    // Restore any unsaved pending changes for your name
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
document.getElementById('organiserMarksInput').addEventListener('change', (e)=> saveOrganiserMarks(e.target));
els.settingsClose.addEventListener('click', hideSettingsModal);
document.addEventListener('DOMContentLoaded', init);

/*** Ensure rankings reflect all dates after changes */
async function ensureCalendarLoadedAllDates(){
  if(!state.startDate || !state.endDate) return;
  await ensureRangeLoaded(state.startDate, state.endDate);
}