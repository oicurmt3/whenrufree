'use strict';

/*** DYNAMIC SLOTS (legacy defaults; replaced by meta if present) */
let TIME_SLOTS = [
  { id: 'morning', label: 'Morning' },
  { id: 'brunch', label: 'Brunch' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'arvo', label: 'Mid-arvo'},
  { id: 'dinner', label: 'Dinner' }
];

/**
 * IMPORTANT: getRelativeLuminance() and getContrastTextColor() below are
 * duplicated in index.js. If you change the luminance formula or contrast
 * threshold here, update index.js to match (and vice versa).
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
 * Updates CSS custom properties for status text colours based on status background colours.
 * Called after status options are loaded to ensure proper contrast.
 */
function updateStatusTextColors() {
  const root = document.documentElement;
  
  for (let i = 0; i < STATUS_OPTIONS.length; i++) {
    const statusNum = i + 1;
    const bgColor = STATUS_OPTIONS[i].color;
    const textColor = getContrastTextColor(bgColor);
    
    // Set the text colour CSS variable for this status
    root.style.setProperty(`--status-${statusNum}-text`, textColor);
  }
}
// Availability status values are stored as integers:
// 0 = NULL (no selection), 1..N = user-defined status options
const STATUS_NULL = 0;

// Default statuses used when a calendar does not specify custom options.
// The ordering matters for cycling and scoring.
let STATUS_OPTIONS = [
  { label: 'Yes', color: '#357A38', weight: 2 },
  { label: 'Maybe', color: '#e58800', weight: 1 },
  { label: 'No', color: '#880000', weight: 0 }
];

// Strength palette (1..5) used to represent weight/score.
// Colours are intentionally tied to *rank position* (strength), not to option identity.
const STRENGTH_COLORS = {
  green: '#6fae00',
  yellowGreen: '#e1b000',
  amber: '#0000FF',
  orange: '#808080',
  red: '#FF0000'
};
function getStrengthPalette(n){
  const N = Math.max(1, Math.min(5, Number(n) || 0));
  if (N === 1) return [STRENGTH_COLORS.green];
  if (N === 2) return [STRENGTH_COLORS.green, STRENGTH_COLORS.red];
  if (N === 3) return [STRENGTH_COLORS.green, STRENGTH_COLORS.amber, STRENGTH_COLORS.red];
  if (N === 4) return [STRENGTH_COLORS.green, STRENGTH_COLORS.yellowGreen, STRENGTH_COLORS.amber, STRENGTH_COLORS.red];
  return [STRENGTH_COLORS.green, STRENGTH_COLORS.yellowGreen, STRENGTH_COLORS.amber, STRENGTH_COLORS.orange, STRENGTH_COLORS.red];
}
/* CATEGORIES: To add/edit/remove a category, update BOTH index.html (#catGrid)
   and calendar.js (CATEGORY_META). Keys must match. Max 3 selectable per calendar. */
const CATEGORY_META = {
  rsvp:{icon:'rsvp',label:'Attendance'},
  meeting_room:{icon:'meeting_room',label:'Meeting'},
  event:{icon:'event',label:'Event'},
  cake:{icon:'cake',label:'Party'},
  directions_walk:{icon:'directions_walk',label:'Activity'},
  nightlife:{icon:'nightlife',label:'Night life'},
  groups:{icon:'groups',label:'Catchup'},
  catchup:{icon:'groups',label:'Catchup'},
  how_to_vote:{icon:'how_to_vote',label:'Vote'},
  meeting:{icon:'event',label:'Meeting'},
  drinks:{icon:'liquor',label:'Drinks'},
  coffee:{icon:'local_cafe',label:'Coffee'},
  breakfast_dining:{icon:'breakfast_dining',label:'Breakfast'},
  dinner:{icon:'restaurant',label:'Dinner'},
  movie:{icon:'movie',label:'Movie'},
  study:{icon:'event_available',label:'Booking'},
  sport:{icon:'sports_soccer',label:'Sport'},
  travel:{icon:'flight',label:'Travel'},
  reunion:{icon:'celebration',label:'Reunion'},
  appointment:{icon:'calendar_add_on',label:'Appointment'}
};

/**
 * Parses a category value from the server into an array of valid category keys.
 * Handles JSON arrays (new format), plain strings (legacy), and fallback.
 * @param {*} raw - Category value from server (JSON string, plain string, or array)
 * @returns {string[]} Array of valid category keys
 */
function parseCategories(raw){
  let cats = [];
  if(Array.isArray(raw)){
    cats = raw;
  } else {
    const str = (raw ?? '').toString().trim();
    if(str.startsWith('[')){
      try{ cats = JSON.parse(str); }catch(e){ cats = []; }
    } else if(str){
      cats = [str];
    }
  }
  // Filter to known keys, deduplicate, max 3
  const seen = new Set();
  const result = [];
  for(const c of cats){
    const key = (c ?? '').toString().toLowerCase().trim();
    if(CATEGORY_META[key] && !seen.has(key)){
      seen.add(key);
      result.push(key);
      if(result.length >= 3) break;
    }
  }
  return result.length > 0 ? result : ['groups'];
}

/**
 * Sets the calendar heading with title text and one or more category icons.
 * @param {string} titleRaw - Calendar title
 * @param {*} categoryRaw - Category value (JSON array, plain string, or array)
 */
function setCalendarHeading(titleRaw, categoryRaw){
  const cats = parseCategories(categoryRaw);
  const title = (titleRaw ?? '').toString().trim();
  const has = !!title;
  const headerTitle = has ? title : 'When RU Free';
  const h1 = els.calendarTitle;
  h1.textContent = '';
  h1.appendChild(document.createTextNode(headerTitle + ' '));
  // Append an icon for each selected category
  for(const cat of cats){
    const meta = CATEGORY_META[cat];
    if(!meta) continue;
    const iconSpan = document.createElement('span');
    iconSpan.className = 'material-symbols-outlined';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = meta.icon;
    iconSpan.title = meta.label;
    h1.appendChild(iconSpan);
  }
  // Update page title
  document.title = has ? `${title} availability` : 'When RU Free';
}

/**
 * Updates or creates the privacy indicator next to the calendar title.
 * Shows an icon representing the current privacy mode with a tooltip.
 */
function updatePrivacyIndicator(){
  const PRIVACY_CONFIG = {
    open: { icon: 'visibility', tooltip: 'Open: All users can see each other\'s choices' },
    hidden: { icon: 'visibility_off', tooltip: 'Hidden: Users cannot see each other\'s choices (organiser sees all)' },
    blind: { icon: 'lock', tooltip: 'Blind: All choices are private (even organiser cannot see individual responses)' }
  };
  
  const config = PRIVACY_CONFIG[state.privacyMode] || PRIVACY_CONFIG.open;
  
  // Find or create the indicator element
  let indicator = document.querySelector('.privacy-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'privacy-indicator material-symbols-outlined';
    // Insert after the calendar title h1
    const h1 = els.calendarTitle;
    if (h1 && h1.parentNode) {
      h1.parentNode.insertBefore(indicator, h1.nextSibling);
    }
  }
  
  indicator.textContent = config.icon;
  indicator.title = config.tooltip;
  indicator.setAttribute('aria-label', config.tooltip);
}

/**
 * Checks if the current user is the organiser (admin).
 * @returns {boolean}
 */
function isCurrentUserOrganiser(){
  return state.currentUserRole === 'admin' || state.currentUserId === state.adminUserId;
}

/**
 * Shows or hides a date filter instruction banner for the organiser.
 * Includes a save status pill (Unsaved / Saving / Saved) that mirrors
 * the submit button behaviour for normal slot changes.
 */
function updateDateFilterBanner(){
  const existingBanner = document.getElementById('dateFilterBanner');

  // Remove if mode is 'all' or user is not organiser
  if(state.dateFilterMode === 'all' || !isCurrentUserOrganiser()){
    if(existingBanner) existingBanner.remove();
    return;
  }

  const modeLabel = state.dateFilterMode === 'only' ? 'Only chosen dates' : 'All dates except chosen';
  const instruction = state.dateFilterMode === 'only'
    ? 'Click date headers to select which dates participants will see.'
    : 'Click date headers to choose which dates to hide from participants.';
  const count = state.dateFilterDates.length;
  const countText = count === 0 ? 'No dates selected yet.' : `${count} date${count === 1 ? '' : 's'} selected.`;

  if(existingBanner){
    // Update existing banner text (preserve save status element)
    const textEl = existingBanner.querySelector('.dfb-text');
    if(textEl){
      textEl.innerHTML = `<strong>${modeLabel}</strong> -- ${instruction} <em>${countText}</em>`;
    }
    return;
  }

  // Create banner
  const banner = document.createElement('div');
  banner.id = 'dateFilterBanner';
  banner.className = 'date-filter-banner';
  banner.innerHTML =
    `<span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;flex-shrink:0;">filter_alt</span> `
    + `<span class="dfb-text"><strong>${modeLabel}</strong> -- ${instruction} <em>${countText}</em></span>`
    + `<span id="dfSaveStatus" class="date-filter-save-status saved"><span class="material-symbols-outlined" style="font-size:14px;">check</span> Saved</span>`;

  // Insert before the calendar grid section header
  const calSection = document.querySelector('.calendar-section');
  if(calSection){
    calSection.insertBefore(banner, calSection.querySelector('.calendar-header'));
  }
}

/**
 * Updates the save status pill in the date filter banner.
 * @param {'unsaved'|'saving'|'saved'} status
 */
function setDateFilterSaveStatus(status){
  const el = document.getElementById('dfSaveStatus');
  if(!el) return;
  el.classList.remove('unsaved','saving','saved');
  el.classList.add(status);
  if(status === 'unsaved'){
    el.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">edit</span> Unsaved';
  } else if(status === 'saving'){
    el.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">hourglass_empty</span> Saving...';
  } else {
    el.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;">check</span> Saved';
  }
}

/**
 * Determines if the roster (list of names with statuses) should be shown in rankings.
 * Privacy rules for analysis-card (showing who responded):
 * - User MUST be logged in to see roster data
 * - Open mode: logged-in users can see each other's choices
 * - Hidden mode: only logged-in organiser can see roster
 * - Blind mode: never show roster to anyone
 * @returns {boolean}
 */
function shouldShowRoster(){
  // User must be authenticated to see roster in analysis
  if (!state.currentUserId) return false;
  const auth = state.auth.get(state.currentUserId);
  if (!auth || !auth.token) return false;
  
  // Privacy mode rules
  if (state.privacyMode === 'blind') return false;
  if (state.privacyMode === 'hidden') return isCurrentUserOrganiser();
  return true; // open mode - authenticated users can see
}

/**
 * Determines if organiser dots should be shown on time slots in calendar grid.
 * Privacy rules for calendar-section (organiser's choices as border indicators):
 * - User MUST be logged in to see organiser dots
 * - Open/Hidden modes: logged-in users can see organiser dots
 * - Blind mode: never show organiser dots
 * @returns {boolean}
 */
function shouldShowOrganiserDots(){
  // User must be authenticated to see organiser dots in calendar grid
  if (!state.currentUserId) return false;
  const auth = state.auth.get(state.currentUserId);
  if (!auth || !auth.token) return false;
  if (isBookingMode()) return false;
  
  return state.privacyMode !== 'blind';
}

/**
 * Normalises calendar-provided status options.
 * Expected shape: [{label:string, color:string, weight:number}, ...] (1..5).
 *
 * If colors/weights are provided in the data, they are used directly.
 * Otherwise, they are derived from list order (position-based).
 */
function normaliseStatusOptions(raw){
  const fallback = [
    { label: 'Yes', weight: 2 },
    { label: 'Maybe', weight: 1 },
    { label: 'No', weight: 0 }
  ];

  const build = (items, useCustom = false) => {
    const n = items.length;
    const palette = getStrengthPalette(n);
    return items.map((o, idx) => ({
      label: o.label,
      // Use custom color if provided, otherwise use position-based palette
      color: (useCustom && o.color) ? o.color : palette[idx],
      // Use custom weight if provided, otherwise calculate from position
      weight: (useCustom && typeof o.weight === 'number') 
        ? Math.max(0, Math.min(5, o.weight)) 
        : Math.max(0, n - 1 - idx)
    }));
  };

  if(!Array.isArray(raw)){
    return build(fallback, false);
  }

  const out=[];
  let hasCustom = false;
  for(const item of raw){
    if(!item) continue;
    const label = (item.label ?? item).toString().trim().replace(/\s+/g,' ').slice(0,20);
    if(!label) continue;
    // Check if this item has custom color or weight
    const color = typeof item.color === 'string' && item.color.match(/^#[0-9A-Fa-f]{6}$/) ? item.color : null;
    const weight = typeof item.weight === 'number' ? item.weight : null;
    if(color !== null || weight !== null) hasCustom = true;
    out.push({ label, color, weight });
  }

  if(out.length < 1 || out.length > 5){
    return build(fallback, false);
  }

  return build(out, hasCustom);
}


function applyStatusOptions(rawOptions){
  STATUS_OPTIONS = normaliseStatusOptions(rawOptions);
  // Apply CSS variables for up to 5 statuses (and clear any unused values)
  try{
    const root = document.documentElement;
    for(let i=1;i<=5;i++) root.style.removeProperty(`--status-${i}`);
    STATUS_OPTIONS.forEach((o, idx) => {
      const key = `--status-${idx+1}`;
      if(o && o.color) root.style.setProperty(key, o.color);
    });
    // Calculate and apply text colours based on background luminance
    updateStatusTextColors();
  }catch(e){}
  renderLegend();
}


function renderLegend(){
  if(!els.legendWrap) return;
  if(isBookingMode()){ renderBookingLegend(); return; }
  els.legendWrap.innerHTML='';
  const opts = Array.isArray(STATUS_OPTIONS) ? STATUS_OPTIONS : [];
  for(let i=0;i<opts.length;i++){
    const item=document.createElement('div'); item.className='legend-item';
    item.dataset.status = i + 1; // Store status index for highlighting
    const dot=document.createElement('div'); dot.className='dot';
    dot.style.background = `var(--status-${i+1})`;
    item.appendChild(dot);
    item.appendChild(document.createTextNode(' ' + (opts[i].label ?? `Status ${i+1}`)));
    els.legendWrap.appendChild(item);
  }
}
function qs(sel){return document.querySelector(sel);}
function debounce(fn,ms){let t=null;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function getToken(){const url=new URL(window.location.href);return url.searchParams.get('c');}
function showToast(msg){
  const t=qs('#toast');
  t.textContent=msg;
  // Center the toast ONLY for the "Saved to server!" message
  if (typeof msg==='string' && msg.toLowerCase().includes('saved to server')) {
    t.classList.add('center');
  } else {
    t.classList.remove('center');
  }
  t.classList.add('show');
  setTimeout(()=>{ t.classList.remove('show'); }, 2000);
}

/*** Pending durability (per calendar + per user) */
function pendingKey(userId){ return `pending_${state.token}_${userId}`; }

/**
 * Prunes the pending object for localStorage persistence only.
 * Removes entries with invalid or NULL status to keep localStorage lean.
 * NOTE: This is ONLY for localStorage - the actual save to server handles NULL differently.
 * @param {Object} p - The pending changes object
 * @returns {Object} - Pruned object (mutated in place)
 */
function prunePendingForStorage(p){
  if(!p || typeof p !== 'object') return {};
  for(const [d, slots] of Object.entries(p)){
    if(!slots || typeof slots !== 'object'){ delete p[d]; continue; }
    for(const [slot, st] of Object.entries(slots)){
      const n = Number(st);
      // For storage, we only keep non-null status values
      // NULL changes are tracked in memory but pruned from storage
      if(!Number.isFinite(n) || n===STATUS_NULL) delete slots[slot];
      else slots[slot] = n;
    }
    if(Object.keys(slots).length===0) delete p[d];
  }
  return p;
}

/**
 * Validates pending object entries without removing NULL statuses.
 * Used for preparing data to send to server (NULL = delete record).
 * @param {Object} p - The pending changes object
 * @returns {Object} - Validated object with all status values normalised
 */
function validatePendingForSave(p){
  if(!p || typeof p !== 'object') return {};
  const result = {};
  for(const [d, slots] of Object.entries(p)){
    if(!slots || typeof slots !== 'object') continue;
    const validSlots = {};
    for(const [slot, st] of Object.entries(slots)){
      const n = Number(st);
      if(!Number.isFinite(n)) continue;
      // Keep ALL values including NULL (0) - server will delete the record
      validSlots[slot] = n;
    }
    if(Object.keys(validSlots).length > 0){
      result[d] = validSlots;
    }
  }
  return result;
}

function persistPendingNow(){
  if(!state.currentUserId) return;
  try{
    // For localStorage, prune NULL values (crash recovery only needs positive selections)
    const cleaned = prunePendingForStorage(JSON.parse(JSON.stringify(state.pending || {})));
    if(Object.keys(cleaned).length===0){
      localStorage.removeItem(pendingKey(state.currentUserId));
      return;
    }
    const payload = { v:1, ts:Date.now(), pending: cleaned };
    localStorage.setItem(pendingKey(state.currentUserId), JSON.stringify(payload));
  }catch(e){
    // localStorage may be unavailable/quota exceeded; ignore
  }
}
function persistPendingDebounced(){
  window.clearTimeout(state.persistTimer);
  state.persistTimer = window.setTimeout(persistPendingNow, 220);
}
function clearPersistedPending(userId){
  try{ localStorage.removeItem(pendingKey(userId)); }catch(e){}
}
function restorePendingForUser(userId){
  try{
    const raw = localStorage.getItem(pendingKey(userId));
    if(!raw) return {};
    const obj = JSON.parse(raw);
    const p = obj && obj.pending ? obj.pending : {};
    return prunePendingForStorage(p);
  }catch(e){
    return {};
  }
}

/*** 
 * AUTOSAVE CONFIGURATION
 * =====================
 * Autosave triggers after a period of inactivity following changes.
 * The delay is configurable below. Manual save is always available.
 * 
 * AUTOSAVE_DELAY_MS: Time in milliseconds to wait after the last change
 *                    before triggering autosave. Default: 4500ms (4.5 seconds)
 * 
 * To change the autosave delay, modify the value below:
 */
const AUTOSAVE_DELAY_MS = 4500; // 4.5 seconds - adjust this value as needed

// Timer for autosave debouncing
let autosaveTimer = null;

/**
 * Schedules an autosave after AUTOSAVE_DELAY_MS of inactivity.
 * Called after each slot change. Resets timer on each call.
 */
function scheduleAutosave(){
  // Clear any existing autosave timer
  if(autosaveTimer){
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  
  // Only schedule if there are pending changes and user is authenticated
  if(!Object.keys(state.pending).length) return;
  if(!state.currentUserId) return;
  const auth = state.auth.get(state.currentUserId);
  if(!auth) return;
  
  // Schedule autosave
  autosaveTimer = setTimeout(async ()=>{
    autosaveTimer = null;
    // Double-check we still have pending changes
    if(!Object.keys(state.pending).length) return;
    try{
      await savePending(true); // true = isAutosave
    }catch(e){
      console.error('Autosave failed:', e);
      // Don't show error for autosave failures - user can manually save
    }
  }, AUTOSAVE_DELAY_MS);
}

/**
 * Cancels any pending autosave timer.
 * Called when user manually saves or when switching users.
 */
function cancelAutosave(){
  if(autosaveTimer){
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

function fmtDate(d){const yyyy=d.getFullYear();const mm=String(d.getMonth()+1).padStart(2,'0');const dd=String(d.getDate()).padStart(2,'0');return `${yyyy}-${mm}-${dd}`;}
/**
 * Formats a date string into a user-friendly display format.
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Formatted date like "Mon 24th Jan 2026"
 */
function formatFriendlyDate(dateStr){
  const date=new Date(dateStr+'T00:00:00');
  const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dayName=days[date.getDay()]; const dayNum=date.getDate(); const monthName=months[date.getMonth()]; const year=date.getFullYear();
  const ord=(n)=>{const s=["th","st","nd","rd"];const v=n%100;return (s[(v-20)%10] || s[v] || s[0]);};
  return `${dayName} ${dayNum}${ord(dayNum)} ${monthName} ${year}`;
}
function formatDateRange(startStr,endStr){
  const start=new Date(startStr+'T00:00:00'), end=new Date(endStr+'T00:00:00');
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const sm=months[start.getMonth()], sd=start.getDate(), sy=start.getFullYear();
  const em=months[end.getMonth()], ed=end.getDate(), ey=end.getFullYear();
  if (sy===ey && sm===em) return `${sm} ${sd}-${ed}, ${sy}`;
  if (sy===ey) return `${sm} ${sd} - ${em} ${ed}, ${sy}`;
  return `${sm} ${sd}, ${sy} - ${em} ${ed}, ${ey}`;
}
function formatDayHeader(dateStr){
  const d=new Date(dateStr+'T00:00:00');
  const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return {dayNum:d.getDate(),dayName:days[d.getDay()],monthName:months[d.getMonth()]};
}
function getDayOfWeek(date){return date.getDay();}

/*** API helpers (X-Auth-Token for save/reset) */
const els = {
  calendarTitle: qs('#calendarTitle'),
  currentUserDisplay: qs('#currentUserDisplay'),
  serverStatus: qs('#serverStatus'),
  // User select button (icon) and modal
  userSelectBtn: qs('#userSelectBtn'),
  userSelectModal: qs('#userSelectModal'),
  userSelectList: qs('#userSelectList'),
  userSelectCancel: qs('#userSelectCancel'),
  userSelectAddLink: qs('#userSelectAddLink'),
  // Other elements
  bannerAddBtn: qs('#bannerAddBtn'),
  nameBanner: qs('#nameBanner'),
  renameBtn: qs('#renameBtn'),
  monthLabel: qs('#monthLabel'),
  togglePastDatesBtn: qs('#togglePastDatesBtn'),
  legendWrap: qs('#legendWrap'),
  calendarGrid: qs('#calendarGrid'),
  submitBtn: qs('#submitBtn'),
  submitBtnIcon: qs('#submitBtnIcon'),
  shareBtn: qs('#shareBtn'),
  settingsBtn: qs('#settingsBtn'),
  settingsModal: qs('#settingsModal'),
  settingsAccessField: qs('#settingsAccessField'),
  settingsError: qs('#settingsError'),
  settingsClose: qs('#settingsClose'),
  // Reset buttons (resetMineBtn for all users, resetAllBtn for admin only)
  resetMineBtn: qs('#resetMineBtn'),
  resetAllBtn: qs('#resetAllBtn'),
  currentUserTag:qs('#currentUserTag'),
  userModal: qs('#userModal'),
  userModalTitle:qs('#userModalTitle'),
  userModalText: qs('#userModalText'),
  userNameInput: qs('#userNameInput'),
  userNameErr: qs('#userNameErr'),
  userPinWrap: qs('#userPinWrap'),
  userPin2Wrap: qs('#userPin2Wrap'),
  userPinInput: qs('#userPinInput'),
  userPin2Input: qs('#userPin2Input'),
  toggleUserPin: qs('#toggleUserPin'),
  toggleUserPin2:qs('#toggleUserPin2'),
  userPinErr: qs('#userPinErr'),
  userPin2Err: qs('#userPin2Err'),
  userModalError:qs('#userModalError'),
  userModalCancel:qs('#userModalCancel'),
  userModalConfirm:qs('#userModalConfirm'),
  // Sort and limit toggles (new toggle button UI)
  sortToggle: qs('#sortToggle'),
  limitToggle: qs('#limitToggle'),
  analysisTitleText: qs('#analysisTitleText'),
  rankWrap: qs('#rankWrap'),
  rankEmpty: qs('#rankEmpty'),
  // Organiser message
  organiserMessageWrap: qs('#organiserMessageWrap'),
  organiserMessageText: qs('#organiserMessageText'),
  organiserMessageEdit: qs('#organiserMessageEdit'),
  organiserMessageInput: qs('#organiserMessageInput'),
  organiserMessageCount: qs('#organiserMessageCount'),
  organiserMessageCancel: qs('#organiserMessageCancel'),
  organiserMessageSave: qs('#organiserMessageSave'),
  pinModal: qs('#pinModal'),
  pinModalTitle: qs('#pinModalTitle'),
  pinModalText: qs('#pinModalText'),
  pinInput: qs('#pinInput'),
  toggleUnlockPin:qs('#toggleUnlockPin'),
  pinModalError: qs('#pinModalError'),
  pinCancel: qs('#pinCancel'),
  pinConfirm: qs('#pinConfirm'),
  pinPasskeyWrap: qs('#pinPasskeyWrap'),
  pinPasskeyBtn: qs('#pinPasskeyBtn'),
  passkeyModal: qs('#passkeyModal'),
  passkeySetup: qs('#passkeySetup'),
  passkeyManageHead: qs('#passkeyManageHead'),
  passkeyOthersTitle: qs('#passkeyOthersTitle'),
  passkeyList: qs('#passkeyList'),
  passkeyError: qs('#passkeyError'),
  passkeyAdd: qs('#passkeyAdd'),
  passkeyClose: qs('#passkeyClose'),
  infoModal: qs('#infoModal'),
  infoModalCancel:qs('#infoModalCancel'),
  infoModalAdd: qs('#infoModalAdd')
};
const state = {
  token:null,
  calendarTitle:'',
  calendarCategories:['groups'], // Array of category keys (up to 3)
  startDate:null,
  endDate:null,
  excludeWeekends:false, // HONOURS server flag
  dateFilterMode:'all', // 'all', 'only', or 'except'
  dateFilterDates:[], // Array of YYYY-MM-DD strings marked by organiser
  dateFilterDirty:false, // True when filter dates have unsaved changes
  privacyMode:'open', // 'open', 'hidden', or 'blind'
  users:[],
  currentUserId:null,
  currentUserName:'',
  currentUserRole:null, // 'admin' or 'user' - tracks if current user is organiser
  adminUserId:null, // Cache the admin user ID for organiser dots
  store:new Map(),
  pending:{},
  isSaving:false,
  persistTimer:null,
  slotEls:new Map(),
  dayCols:new Map(),
  loadedRanges:new Set(),
  availabilitySummary:new Map(),
  rankLimit:2, // Number of rank cards to show: 2, 10, or 0 (all)
  rankSortOrder:'score', // 'score' (best first) or 'date' (chronological) - persisted
  organiserMessage:'', // Short message from organiser shown to all participants
  organiserMessageMax:250, // Max chars for organiser message (overridden by server meta)
  chosenDate:null, // YYYY-MM-DD if organiser has locked in a slot (null = open)
  chosenSlot:null, // Slot ID if organiser has locked in a slot (null = open)
  hubGroup:null, // { token, title } when calendar belongs to a Hub
  booking:null, // { capacity, perUser, perUserTotal, closed } for booking calendars (null = availability poll)
  bookingView:null, // 'booked' (organiser) / 'mine' (others) / 'free' once chosen; null = default for the role
  expandedRanks:new Set(),
  auth:new Map(), // user_id -> {token, role, exp}
  _pendingAuthUserId:null, // Tracks user ID during PIN authentication flow
  _pendingAuthUserObj:null, // Tracks user object during PIN authentication flow
  accessAvailable:false, // Server has the access emoji tables (calendar_meta.access.available)
  accessEmoji:null, // This calendar's own emoji position (organiser only, for Share)
  accessHubEmoji:false, // Calendar uses its Hub's emoji (organiser only, for Share)
  accessEmojiLoaded:false,
  passkeysEnabled:false, // Server has fingerprint / face unlock tables (calendar_meta.passkeys)
  platformPasskey:false, // This device has a built-in fingerprint / face / screen-lock authenticator
  hidePastDates:true // Whether past date columns are currently hidden
};

// CSRF token cached for this browser session (fetched from api.php?action=csrf_token)
let csrfToken = null;

/**
 * Fetches and caches a CSRF token for state-changing requests.
 * @returns {Promise<string|null>} CSRF token or null if it could not be obtained
 */
async function ensureCsrfToken(){
  if(csrfToken) return csrfToken;
  try{
    const resp = await fetch('api.php?action=csrf_token', {
      method:'GET',
      credentials:'same-origin' // Ensure session cookie is sent/received
    });
    const data = await resp.json();
    if(data && data.status==='success' && typeof data.csrf_token==='string' && data.csrf_token.length>10){
      csrfToken = data.csrf_token;
    }
  }catch(e){
    console.error('Failed to fetch CSRF token:', e);
  }
  return csrfToken;
}
function tz(){ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }

/*** Access emoji: grants go with every request; the emoji popup opens when the server asks */
let accessGatePromise = null;

function accessHubToken(){
  const g = new URL(window.location.href).searchParams.get('g');
  if(g && /^[A-Za-z0-9_\-]{8,64}$/.test(g)) return g;
  return state.hubGroup?.token || null;
}

function accessGrantKeys(extraHubToken=null){
  const keys = ['c_' + state.token];
  const hub = accessHubToken();
  if(hub) keys.push('g_' + hub);
  if(extraHubToken && extraHubToken !== hub) keys.push('g_' + extraHubToken);
  return keys;
}

/** Shows the emoji popup once, however many requests are waiting on it. */
function requireAccess(info){
  if(!accessGatePromise){
    const isHub = info && info.kind === 'hub';
    accessGatePromise = AccessEmoji.gate({
      title: isHub ? "Pick this Hub's emoji" : "Pick this calendar's emoji",
      hint: "Ask the organiser if you don't know it.",
      submit: async (emoji) => {
        const url = new URL('api.php', window.location.href);
        url.searchParams.set('action', 'access_check');
        url.searchParams.set('c', state.token);
        const headers = {'Content-Type':'application/json'};
        const csrf = await ensureCsrfToken();
        if(csrf) headers['X-CSRF-Token'] = csrf;
        const resp = await fetch(url.toString(), {
          method:'POST', headers, credentials:'same-origin', body: JSON.stringify({ emoji })
        });
        const data = await resp.json();
        if(data.status !== 'success') return { ok:false, message:data.message };
        if(data.access_grant) AccessEmoji.saveGrant('c_' + state.token, data.access_grant, data.expires_at);
        return { ok:true };
      }
    }).finally(() => { accessGatePromise = null; });
  }
  return accessGatePromise;
}

/** fetch() with X-Access-Grant; after the emoji popup succeeds the request is sent again. */
async function accessFetch(url, opts={}, extraHubToken=null){
  for(let tries = 0; ; tries++){
    const headers = { ...(opts.headers || {}) };
    const grants = window.AccessEmoji ? AccessEmoji.grantHeader(accessGrantKeys(extraHubToken)) : '';
    if(grants) headers['X-Access-Grant'] = grants;
    const resp = await fetch(url, { ...opts, headers });
    if(resp.status !== 403 || tries >= 2 || !window.AccessEmoji) return resp;
    let data = null;
    try{ data = await resp.clone().json(); }catch(e){ data = null; }
    if(!data || data.code !== 'ACCESS_REQUIRED') return resp;
    await requireAccess(data.access || {});
  }
}

async function apiGet(action, params={}){
  const url=new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('c', state.token);
  for(const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = {};
  if (action === 'availability' || action === 'access_settings') {
    const auth = state.currentUserId
      ? (state.auth.get(state.currentUserId) || getCachedAuth(state.currentUserId))
      : null;
    if (auth?.token) headers['X-Auth-Token'] = auth.token;
  }
  const resp = await accessFetch(url.toString(), {
    credentials:'same-origin',
    headers
  });
  return resp.json();
}
/**
 * Makes an authenticated POST request to the API.
 * Adds X-CSRF-Token and (optionally) X-Auth-Token.
 * @param {string} action
 * @param {Object} body
 * @param {string|null} authToken
 * @param {string|null} extraHubToken Also send this Hub's access grant (adding to a Hub)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiPost(action, body={}, authToken=null, extraHubToken=null){
  const url=new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('c', state.token);
  const headers={'Content-Type':'application/json'};
  if(authToken) headers['X-Auth-Token']=authToken;
  const csrf = await ensureCsrfToken();
  if(csrf) headers['X-CSRF-Token']=csrf;
  const resp = await accessFetch(url.toString(), {
    method:'POST',
    headers,
    body: JSON.stringify(body),
    credentials:'same-origin' // Ensure session cookie is sent for CSRF validation
  }, extraHubToken);
  return resp.json();
}

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
  
  // Don't show indicator when admin/organiser is viewing - they don't need to see their own status
  if(state.currentUserId === state.adminUserId) return;
  
  // Get organiser's status for this slot
  const orgStatus = getOrganiserStatus(dateStr, slotId);
  
  // Only show indicator if organiser has a status (not NULL)
  if(orgStatus === STATUS_NULL) return;
  
  // Add the border class directly to the slot element
  slotEl.classList.add(`org-border-${orgStatus}`);
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
  for(const [dateStr, slotMap] of state.slotEls.entries()){
    for(const slot of TIME_SLOTS){
      const el=slotMap.get(slot.id);
      
      // Update current user's status colour
      if(state.currentUserId){
        const {status}=getStatus(state.currentUserId, dateStr, slot.id);
        setSlotClass(el, status);
      } else {
        // No user selected - show neutral
        setSlotClass(el, STATUS_NULL);
      }
      
      // Update organiser dot (shows for all users)
      updateOrganiserDot(el, dateStr, slot.id);
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
  // Block slot changes if the calendar has been finalised
  if(isCalendarFrozen()){
    showToast('Calendar finalised - no changes allowed.');
    return;
  }
  // Check if no user is selected - show user select modal
  if(!state.currentUserId){
    openUserSelectModal();
    return;
  }
  const auth = state.auth.get(state.currentUserId);
  if(!auth){
    const u = state.users.find(x => x.id === state.currentUserId);
    openPinModal(state.currentUserId, u);
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

  const postSave = async (authToken) => {
    const url=new URL('api.php', window.location.href);
    url.searchParams.set('action','save');
    url.searchParams.set('c', state.token);
    const headers={'Content-Type':'application/json'};
    if(authToken) headers['X-Auth-Token']=authToken;
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
        const res = await postSave(auth.token);
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
    showToast('Please unlock your name first.');
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