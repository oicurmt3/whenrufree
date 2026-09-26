/**
 * calendar-users.js - Calendar page people and access: meta load, users, user-select modal, submit/user UI, Hub bar, settings, add/rename, PIN, passkeys, auth cache.
 * Classic script sharing global scope. Load order: passkey.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
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
    state.passkeysEnabled = meta.calendar.passkeys === true;
    if(state.passkeysEnabled && window.Passkey){
      Passkey.platformAvailable().then(v => { state.platformPasskey = v; });
    }
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

/*** Users include role; admin first with "(admin)" */
async function loadUsers(){
  const data = await apiGet('users');
  if(data.status!=='success') throw new Error('Failed to load users');
  state.users = (data.users??[]).map(u => ({ id:Number(u.id), display_name:u.display_name, role:(u.role??'member') }));
  // admin first
  state.users.sort((a,b)=> (a.role==='admin'? -1:0) + (b.role==='admin'? 1:0));
  // Cache admin user ID for organiser dots
  const admin = state.users.find(u => u.role === 'admin');
  state.adminUserId = admin ? admin.id : null;
}

/*** Update current user display in header (after title) */
function updateCurrentUserDisplay(){
  if(state.currentUserId){
    const u = state.users.find(x => x.id === state.currentUserId);
    if(u){
      const displayText = u.role === 'admin' ? `${u.display_name} (organiser)` : u.display_name;
      els.currentUserDisplay.textContent = displayText;
      els.currentUserDisplay.classList.add('visible');
      els.currentUserDisplay.classList.toggle('is-admin', u.role === 'admin');
      els.userSelectBtn.classList.add('has-user');
      els.userSelectBtn.title = `Viewing as: ${displayText}`;
    }
  } else {
    els.currentUserDisplay.textContent = '';
    els.currentUserDisplay.classList.remove('visible', 'is-admin');
    els.userSelectBtn.classList.remove('has-user');
    els.userSelectBtn.title = 'Select user';
  }
  // Show/hide name banner
  els.nameBanner.style.display = state.users.length === 0 ? '' : 'none';
}

/*** User Select Modal - populate and show */
function populateUserSelectModal(){
  els.userSelectList.innerHTML = '';
  
  if(state.users.length === 0){
    const empty = document.createElement('div');
    empty.className = 'user-select-empty';
    empty.textContent = 'No users yet. Add your name to get started!';
    els.userSelectList.appendChild(empty);
    return;
  }
  
  const isOrganiser = isCurrentUserOrganiser();
  
  // Sort users: logged-in user first, then organiser, then alphabetical
  const sortedUsers = [...state.users].sort((a, b) => {
    // Logged-in user always first
    const aIsLoggedIn = a.id === state.currentUserId && state.auth.get(a.id);
    const bIsLoggedIn = b.id === state.currentUserId && state.auth.get(b.id);
    if(aIsLoggedIn && !bIsLoggedIn) return -1;
    if(!aIsLoggedIn && bIsLoggedIn) return 1;
    // Then organiser (admin)
    if(a.role === 'admin' && b.role !== 'admin') return -1;
    if(a.role !== 'admin' && b.role === 'admin') return 1;
    // Then alphabetical
    return (a.display_name || '').localeCompare(b.display_name || '');
  });
  
  for(const u of sortedUsers){
    const item = document.createElement('div');
    item.className = 'user-select-item';
    const isSelected = u.id === state.currentUserId;
    const isAuthenticated = isSelected && state.auth.get(u.id);
    if(isSelected) item.classList.add('selected');
    item.dataset.userId = u.id;
    
    // Avatar with first letter
    const avatar = document.createElement('div');
    avatar.className = 'user-select-avatar';
    if(u.role === 'admin') avatar.classList.add('admin');
    avatar.textContent = (u.display_name || '?').charAt(0).toUpperCase();
    
    // Info (name + role)
    const info = document.createElement('div');
    info.className = 'user-select-info';
    
    const name = document.createElement('div');
    name.className = 'user-select-name';
    name.textContent = u.display_name;
    
    info.appendChild(name);
    
    if(u.role === 'admin'){
      const role = document.createElement('div');
      role.className = 'user-select-role';
      role.textContent = 'Organiser';
      info.appendChild(role);
    }
    
    item.appendChild(avatar);
    item.appendChild(info);
    
    // Checkmark for selected user
    if(isSelected){
      const check = document.createElement('span');
      check.className = 'material-symbols-outlined user-select-check';
      check.textContent = 'check_circle';
      item.appendChild(check);
    }
    
    // Fingerprint / face unlock devices for the authenticated selected user
    if(isAuthenticated && passkeysUsable()){
      const pkOn = !!Passkey.deviceCredential(passkeyId(u.id));
      const pkBtn = document.createElement('button');
      pkBtn.className = 'user-select-passkey' + (pkOn ? ' on' : '');
      pkBtn.type = 'button';
      pkBtn.title = pkOn ? 'Passkey is on for this device - manage passkeys' : 'Passkeys';
      pkBtn.setAttribute('aria-label', pkBtn.title);
      pkBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">fingerprint</span>';
      pkBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent selecting this user
        openPasskeyWindow(u.id);
      });
      item.appendChild(pkBtn);
    }

    // Logout button for authenticated selected user
    if(isAuthenticated){
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'user-select-logout';
      logoutBtn.type = 'button';
      logoutBtn.title = 'Log out';
      logoutBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">logout</span>';
      logoutBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent selecting this user
        logoutCurrentUser();
      });
      item.appendChild(logoutBtn);
    }
    
    // Delete icon: organiser can delete non-admin users (not themselves)
    if(isOrganiser && u.role !== 'admin'){
      const delBtn = document.createElement('button');
      delBtn.className = 'user-select-delete';
      delBtn.type = 'button';
      delBtn.title = 'Delete ' + u.display_name;
      delBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent selecting this user
        confirmDeleteCalendarUser(u.id, u.display_name);
      });
      item.appendChild(delBtn);
    }
    
    // Click handler (selects user)
    item.addEventListener('click', () => onUserSelectItemClick(u.id));
    
    els.userSelectList.appendChild(item);
  }
}

function openUserSelectModal(){
  populateUserSelectModal();
  els.userSelectModal.classList.add('active');
}

function closeUserSelectModal(){
  els.userSelectModal.classList.remove('active');
}

/**
 * Logs out the current user by clearing their auth token and reloading the page.
 * This ensures they cannot view other users' choices without re-authenticating.
 */
function logoutCurrentUser(){
  if(!state.currentUserId) return;
  
  const userId = state.currentUserId;
  
  // Clear auth from memory and localStorage
  state.auth.delete(userId);
  try{ localStorage.removeItem(cacheKey(userId)); }catch(e){}
  
  // Close modal before reload
  closeUserSelectModal();
  
  // Reload page to ensure completely clean state
  showToast('Logging out...');
  setTimeout(() => {
    window.location.reload();
  }, 300);
}

/**
 * Prompts the organiser to confirm deletion of a user from the calendar.
 * On confirmation, calls the delete_user API, reloads the user list,
 * and refreshes the calendar display.
 * @param {number} userId - The ID of the user to delete
 * @param {string} displayName - The display name shown in the confirmation
 */
async function confirmDeleteCalendarUser(userId, displayName){
  const ok = confirm('Delete "' + displayName + '" and all their availability data?\n\nThis cannot be undone.');
  if(!ok) return;
  
  if(!state.adminUserId) return;
  const auth = state.auth.get(state.adminUserId);
  if(!auth || !auth.token){ showToast('Authentication required'); return; }
  
  try{
    const res = await apiPost('delete_user', { user_id: userId }, auth.token);
    if(res.status === 'success'){
      showToast(displayName + ' deleted');
      // If the deleted user was the currently selected user, deselect
      if(state.currentUserId === userId){
        state.currentUserId = null;
        state.currentUserName = '';
        state.currentUserRole = null;
        state.pending = {};
        updateCurrentUserDisplay();
        updateUserUI();
      }
      // Reload users and refresh display
      await loadUsers();
      populateUserSelectModal();
      await ensureDateRangeLoaded();
      renderDateRangeSkeleton();
      refreshCalendarValues();
      renderRankings();
    } else {
      showToast(res.message || 'Failed to delete user');
    }
  } catch(e){
    console.error('Error deleting user:', e);
    showToast('Failed to delete user');
  }
}

/*** Handle user selection from modal */
async function onUserSelectItemClick(userId){
  closeUserSelectModal();
  try{
    // Cancel any pending autosave for the current user
    cancelAutosave();
    
    // Persist any unsaved changes for the current user so nothing is lost on switch
    if(Object.keys(state.pending).length){
      persistPendingNow();
    }

    const uid = Number(userId);
    const u = state.users.find(x => x.id === uid);
    
    // Check if user is already authenticated (cached auth)
    const cached = getCachedAuth(uid);
    if(cached){
      // User is authenticated - safe to switch
      state.auth.set(uid, cached);
      state.currentUserId = uid;
      state.currentUserName = u ? (u.role === 'admin' ? `${u.display_name} (organiser)` : u.display_name) : '';
      state.currentUserRole = u ? u.role : null;
      state.pending = restorePendingForUser(uid);
      
      updateCurrentUserDisplay();
      updateUserUI();
      await reloadAvailability();
      renderDateRangeSkeleton();
      updateDateFilterBanner();
      await ensureCalendarLoadedAllDates();
    } else {
      // User needs to authenticate - open PIN modal WITHOUT changing currentUserId
      // This prevents showing another user's choices before auth
      openPinModal(uid, u);
    }
  } catch(e){
    console.error('Error switching user:', e);
    showToast('Failed to switch user. Please try again.');
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
 * - Edit name and Share: admin only
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
  
  // Edit name and Share are admin-only
  els.renameBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  els.renameBtn.disabled = !isAdmin;
  els.shareBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  els.settingsBtn.style.display = (isAdmin && state.accessAvailable && window.AccessEmoji) ? 'inline-flex' : 'none';
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
  if(!auth || auth.role !== 'admin' || !window.AccessEmoji){
    showToast('Organiser auth required');
    return;
  }
  els.settingsError.textContent = '';
  els.settingsAccessField.innerHTML = '<p class="ae-note">Loading...</p>';
  els.settingsModal.classList.add('active');

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

/*** Add / Rename user (with PIN + confirm on Add) */
function openUserModal(mode){
  els.userModalError.style.display='none';
  els.userNameErr.style.display='none';
  els.userPinErr.style.display='none';
  els.userPin2Err.style.display='none';
  els.userNameInput.value='';
  els.userPinInput.value='';
  els.userPin2Input.value='';
  if(mode==='add'){
    els.userModalTitle.textContent='Add your name';
    els.userModalText.textContent='Enter your name and a 4-digit PIN (keep it secret).';
    els.userModalConfirm.textContent='Save';
    els.userModalConfirm.dataset.mode='add';
    els.userPinWrap.style.display='';
    els.userPin2Wrap.style.display='';
  } else {
    els.userModalTitle.textContent='Rename';
    els.userModalText.textContent='Update your display name (does not affect saved availability).';
    els.userModalConfirm.textContent='Rename';
    els.userModalConfirm.dataset.mode='rename';
    els.userNameInput.value = state.currentUserName.replace(/\s+\(admin\)$/,'') || '';
    els.userPinWrap.style.display='none';
    els.userPin2Wrap.style.display='none';
  }
  els.userModal.classList.add('active');
  setTimeout(()=> els.userNameInput.focus(), 50);
}
function closeUserModal(){ els.userModal.classList.remove('active'); }
function validateName(name){
  if(!name) return {ok:false, msg:'Name is required.'};
  if(name.length>40) return {ok:false, msg:'Max 40 characters.'};
  if(!/^[A-Za-z0-9][A-Za-z0-9'\- ]*$/.test(name)) return {ok:false, msg:"Use letters, numbers, spaces, apostrophes and hyphens only."};
  return {ok:true, name};
}
function validatePin4(s){ return /^\d{4}$/.test(s); }
els.userModalCancel.addEventListener('click', ()=> els.userModal.classList.remove('active'));
els.userModalConfirm.addEventListener('click', async ()=>{
  const mode=els.userModalConfirm.dataset.mode;
  const vRaw=(els.userNameInput.value??'').trim().replace(/\s+/g,' ');
  const nv=validateName(vRaw);
  els.userNameErr.style.display='none';
  els.userPinErr.style.display='none';
  els.userPin2Err.style.display='none';
  els.userModalError.style.display='none';
  if(!nv.ok){
    els.userNameErr.textContent = nv.msg;
    els.userNameErr.style.display='block';
    return;
  }
  try{
    if(mode==='add'){
      const pin = (els.userPinInput.value??'').trim();
      const pin2 = (els.userPin2Input.value??'').trim();
      if(!validatePin4(pin)){
        els.userPinErr.textContent='PIN must be 4 numbers.';
        els.userPinErr.style.display='block';
        return;
      }
      if(!validatePin4(pin2)){
        els.userPin2Err.textContent='Confirm PIN must be exactly 4 numbers.';
        els.userPin2Err.style.display='block';
        return;
      }
      if(pin !== pin2){
        els.userPin2Err.textContent='PINs do not match.';
        els.userPin2Err.style.display='block';
        return;
      }
      
      // Step 1: Create the user
      const res = await apiPost('add_user', {display_name:nv.name, pin});
      if(res.status!=='success'){
        if(res.code==='NAME_TAKEN'){
          els.userNameErr.textContent="name taken, choose another name or add a number after your name to make it unique";
          els.userNameErr.style.display='block';
          return;
        }
        els.userModalError.textContent = res.message || 'Failed to add name.';
        els.userModalError.style.display='block';
        return;
      }
      
      // Step 2: Refresh user list
      try {
        await loadUsers();
      } catch(loadErr) {
        console.error('loadUsers failed:', loadErr);
        // Continue anyway - user was created
      }
      
      // Step 3: Authenticate as the new user
      // Debug: log what we're sending
      console.log('add_user response:', JSON.stringify(res));
      console.log('res.user:', res.user);
      console.log('res.user.id:', res.user?.id, 'type:', typeof res.user?.id);
      
      const authPayload = {user_id: res.user.id, pin};
      console.log('auth_user payload:', JSON.stringify(authPayload));
      
      const auth = await apiPost('auth_user', authPayload);
      if(auth.status!=='success'){
        // User was created but auth failed
        console.error('auth_user failed:', auth);
        if(auth.debug) console.error('auth_user debug:', auth.debug);
        
        // Show error but DON'T close modal - let user see the message
        els.userModalError.textContent = 'Name added! ' + (auth.message || 'Please close and select your name to unlock.');
        els.userModalError.style.display='block';
        
        // Refresh user list so new user appears
        await loadUsers();
        updateCurrentUserDisplay();
        // Don't close modal - user needs to see the message and manually close or try again
        return;
      }
      
      // Success - complete setup
      state.currentUserId = Number(res.user.id);
      state.currentUserName = res.user.display_name;
      cacheAuth(state.currentUserId, auth.auth_token, auth.role, 86400);

      // New user: load any locally queued pending edits for this user (usually none)
      state.pending = restorePendingForUser(state.currentUserId);
      updateSubmitButtonState();

      updateCurrentUserDisplay();
      closeUserModal();
      updateUserUI();
      maybeOfferPasskey(state.currentUserId);
      await ensureDateRangeLoaded();
      renderDateRangeSkeleton();
      updateDateFilterBanner();
      refreshCalendarValues();
      await ensureCalendarLoadedAllDates();
      renderRankings();
      showToast('Name added');
    } else {
      const auth=await ensureAuthedForUser(state.currentUserId);
      const res = await apiPost('rename_user', {user_id: state.currentUserId, display_name: nv.name}, auth.token);
      if(res.status!=='success'){
        els.userModalError.textContent = res.message || 'Rename failed.';
        els.userModalError.style.display='block';
        return;
      }
      await loadUsers();
      state.currentUserName = nv.name;
      updateCurrentUserDisplay();
      closeUserModal();
      updateUserUI();
      await ensureCalendarLoadedAllDates();
      renderRankings();
      showToast('Renamed');
    }
  }catch(e){
    console.error('User modal error:', e);
    els.userModalError.textContent = e.message || 'An error occurred. Try again.';
    els.userModalError.style.display='block';
  }
});

/*** PIN modal for unlocking a selected user */
function openPinModal(userId, userObj){
  // Store pending auth info - DO NOT set currentUserId yet
  state._pendingAuthUserId = userId;
  state._pendingAuthUserObj = userObj || state.users.find(x => x.id === userId);
  
  els.pinModalError.style.display='none';
  els.pinInput.value='';
  els.pinModal.classList.add('active');

  const hasPasskey = passkeysUsable() && !!Passkey.deviceCredential(passkeyId(userId));
  els.pinPasskeyWrap.hidden = !hasPasskey;
  els.pinPasskeyBtn.onclick = () => unlockWithPasskey(userId);
  // The device prompt only opens when the button is pressed (Enter works: the button gets focus).
  setTimeout(() => (hasPasskey ? els.pinPasskeyBtn : els.pinInput).focus(), 50);

  els.pinConfirm.onclick = async ()=>{
    const pin=(els.pinInput.value??'').trim();
    if(!validatePin4(pin)){
      els.pinModalError.textContent='PIN must be exactly 4 digits.';
      els.pinModalError.style.display='block';
      return;
    }
    try{
      const res=await apiPost('auth_user', {user_id: userId, pin});
      if(res.status!=='success'){
        // Handle lockout explicitly
        if(res.code==='ACCOUNT_LOCKED' && res.message){
          els.pinModalError.textContent = res.message;
        } else {
          els.pinModalError.textContent='Invalid PIN. Please try again.';
        }
        els.pinModalError.style.display='block';
        return;
      }
      
      await finishUnlock(userId, res);
      maybeOfferPasskey(userId);
    }catch(e){
      els.pinModalError.textContent='Auth failed. Try again.';
      els.pinModalError.style.display='block';
    }
  };
}

/** Switches to the user after a successful PIN or passkey login. */
async function finishUnlock(userId, res){
  cacheAuth(userId, res.auth_token, res.role, 86400);
  const u = state._pendingAuthUserObj || state.users.find(x => x.id === userId);
  state.currentUserId = userId;
  state.currentUserName = u ? (u.role === 'admin' ? `${u.display_name} (organiser)` : u.display_name) : '';
  state.currentUserRole = u ? u.role : null;
  state.pending = restorePendingForUser(userId);

  state._pendingAuthUserId = null;
  state._pendingAuthUserObj = null;

  els.pinModal.classList.remove('active');
  updateCurrentUserDisplay();
  updateUserUI();
  await reloadAvailability();
  renderDateRangeSkeleton();
  updateDateFilterBanner();
  showToast('Unlocked');
}

/*** Passkeys: fingerprint / face / device screen lock unlock (PIN stays as backup) */
function passkeyId(userId){ return `cal_${state.token}_${userId}`; }
function passkeysUsable(){ return state.passkeysEnabled && !!window.Passkey && Passkey.supported(); }

async function unlockWithPasskey(userId){
  const id = passkeyId(userId);
  els.pinModalError.style.display='none';
  els.pinPasskeyBtn.disabled = true;
  try{
    const begin = await apiPost('passkey_login_begin', {user_id: userId});
    if(begin.status !== 'success'){
      if(begin.code === 'NO_PASSKEY'){ Passkey.forgetDevice(id); els.pinPasskeyWrap.hidden = true; }
      throw new Error(begin.message || 'Passkey sign-in failed. Use your PIN.');
    }
    const credential = await Passkey.get(begin.publicKey);
    const res = await apiPost('passkey_login_finish', {user_id: userId, credential});
    if(res.status !== 'success'){
      if(res.code === 'NO_PASSKEY'){ Passkey.forgetDevice(id); els.pinPasskeyWrap.hidden = true; }
      throw new Error(res.message || 'Passkey sign-in failed. Use your PIN.');
    }
    Passkey.rememberDevice(id, credential.rawId);
    await finishUnlock(userId, res);
  }catch(e){
    if(Passkey.isCancel(e)){
      els.pinInput.focus();
      return;
    }
    els.pinModalError.textContent = e.message || 'Passkey sign-in failed. Use your PIN.';
    els.pinModalError.style.display='block';
  }finally{
    els.pinPasskeyBtn.disabled = false;
  }
}

/** After a PIN login, offers fingerprint / face unlock once per name on capable devices. */
async function maybeOfferPasskey(userId){
  if(!passkeysUsable()) return;
  const id = passkeyId(userId);
  if(Passkey.deviceCredential(id) || Passkey.wasDismissed(id)) return;
  if(!(await Passkey.platformAvailable())) return;
  openPasskeyWindow(userId, true);
}

/** Registers this device for a logged-in user. Returns true when fingerprint unlock is on. */
async function enrolPasskey(userId, errorEl, btn){
  const auth = state.auth.get(userId) || getCachedAuth(userId);
  if(!auth?.token) return false;
  const id = passkeyId(userId);
  const fail = (msg) => {
    if(errorEl){ errorEl.textContent = msg; errorEl.style.display='block'; }
    else showToast(msg);
  };

  if(btn) btn.disabled = true;
  if(errorEl) errorEl.style.display='none';
  try{
    const begin = await apiPost('passkey_register_begin', {}, auth.token);
    if(begin.status !== 'success'){
      fail(begin.message || 'Could not add a passkey.');
      return false;
    }
    const credential = await Passkey.create(begin.publicKey);
    const res = await apiPost('passkey_register_finish', {credential, device_label: Passkey.deviceLabel()}, auth.token);
    if(res.status !== 'success' && res.code !== 'PASSKEY_EXISTS'){
      fail(res.message || 'Could not add a passkey.');
      return false;
    }
    Passkey.rememberDevice(id, res.credential_id || credential.rawId);
    showToast('Passkey added on this device');
    return true;
  }catch(e){
    if(Passkey.isDuplicate(e)){
      Passkey.rememberDevice(id, null);
      showToast('Passkey added on this device');
      return true;
    }
    if(!Passkey.isCancel(e)) fail('Could not add a passkey.');
    return false;
  }finally{
    if(btn) btn.disabled = false;
  }
}

/**
 * The Passkeys window for a logged-in name. On a device without a passkey it shows the
 * setup prompt, plus any passkeys on other devices so a lost phone can still be removed.
 * Once this device has one, it lists every device.
 * silent: opened automatically after a PIN login, so list errors are not shown.
 */
async function openPasskeyWindow(userId, silent = false){
  const auth = state.auth.get(userId) || getCachedAuth(userId);
  if(!auth?.token) return;
  const id = passkeyId(userId);
  let credentials = [];
  let loaded = false;

  const showError = (msg) => {
    els.passkeyError.textContent = msg;
    els.passkeyError.style.display = msg ? 'block' : 'none';
  };

  const render = () => {
    const mine = loaded ? Passkey.syncDevice(id, credentials) : Passkey.deviceCredential(id);
    const setup = !mine;
    els.passkeyModal.classList.toggle('is-setup', setup);
    els.passkeySetup.hidden = !setup;
    els.passkeyManageHead.hidden = setup;
    els.passkeyOthersTitle.hidden = !(loaded && setup && credentials.length);
    els.passkeyList.hidden = !loaded || (setup && !credentials.length);
    if(loaded) Passkey.renderList(els.passkeyList, credentials, mine, removeDevice);
    els.passkeyAdd.hidden = !setup;
    els.passkeyClose.textContent = setup ? 'Not now' : 'Close';
  };

  const close = () => {
    if(!Passkey.deviceCredential(id)) Passkey.dismiss(id);
    els.passkeyModal.classList.remove('active');
  };

  const removeDevice = async (cred, btn) => {
    const isThis = cred.credential_id === Passkey.deviceCredential(id);
    const what = isThis ? 'this device' : (cred.device_label || 'this device');
    if(!confirm(`Remove the passkey from ${what}? The PIN still works.`)) return;
    btn.disabled = true;
    showError('');
    const res = await apiPost('passkey_remove', {credential_id: cred.credential_id}, auth.token);
    if(res.status !== 'success'){
      btn.disabled = false;
      showError(res.message || 'Could not remove this device.');
      return;
    }
    if(isThis) Passkey.forgetDevice(id);
    Passkey.signalRemoved(cred.credential_id);
    credentials = Array.isArray(res.credentials) ? res.credentials : [];
    render();
    populateUserSelectModal();
    showToast('Passkey removed');
  };

  showError('');
  render();
  els.passkeyModal.classList.add('active');
  els.passkeyClose.onclick = close;
  els.passkeyAdd.onclick = async () => {
    if(await enrolPasskey(userId, els.passkeyError, els.passkeyAdd)){
      els.passkeyModal.classList.remove('active');
      populateUserSelectModal();
    }
  };

  try{
    const res = await apiPost('passkey_list', {}, auth.token);
    if(res.status !== 'success'){
      if(!silent) showError(res.message || 'Could not load devices.');
      return;
    }
    credentials = Array.isArray(res.credentials) ? res.credentials : [];
    loaded = true;
    render();
  }catch(e){
    if(!silent) showError('Could not load devices. Check your connection.');
  }
}

/**
 * PIN modal cancel handler.
 * Since we don't set currentUserId until auth succeeds, 
 * cancel simply closes the modal without any state changes.
 */
els.pinCancel.addEventListener('click', ()=> {
  els.pinModal.classList.remove('active');
  state._pendingAuthUserId = null;
  state._pendingAuthUserObj = null;
});

/*** Eye toggles for PIN inputs */
function wirePinToggle(inputEl, btnEl){
  const icon = btnEl.querySelector('.material-symbols-outlined');
  btnEl.addEventListener('click', ()=>{
    const nowText = inputEl.type === 'password';
    inputEl.type = nowText ? 'text' : 'password';
    icon.textContent = nowText ? 'visibility_off' : 'visibility';
    btnEl.setAttribute('aria-label', nowText ? 'Hide PIN' : 'Show PIN');
  });
}
wirePinToggle(els.userPinInput, els.toggleUserPin);
wirePinToggle(els.userPin2Input, els.toggleUserPin2);
wirePinToggle(els.pinInput, els.toggleUnlockPin);

/*** Auth cache */
function cacheKey(userId){ return `auth_${state.token}_${userId}`; }
function cacheAuth(userId, token, role, ttlSec){
  const exp = Date.now()+ttlSec*1000;
  const obj={token, role, exp};
  state.auth.set(userId, obj);
  try{ localStorage.setItem(cacheKey(userId), JSON.stringify(obj)); }catch(e){}
}
function getCachedAuth(userId){
  try{
    const raw=localStorage.getItem(cacheKey(userId)); if(!raw) return null;
    const obj=JSON.parse(raw); if(!obj || !obj.token || !obj.exp) return null;
    if(obj.exp < Date.now()) { localStorage.removeItem(cacheKey(userId)); return null; }
    return obj;
  }catch(e){ return null; }
}
async function ensureAuthedForUser(userId){
  let auth = state.auth.get(userId) || getCachedAuth(userId);
  if(auth){ state.auth.set(userId, auth); return auth; }
  const u = state.users.find(x => x.id === userId);
  openPinModal(userId, u);
  throw new Error('Auth required');
}
