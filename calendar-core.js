/**
 * calendar-core.js - Calendar page core: constants, colours, status options, utilities, pending queue, autosave, dates, els, state, CSRF, access gate and API helpers.
 * Classic script sharing global scope. Load order: passkey.js, account-core.js, emoji.js, calendar-core.js, calendar-users.js, calendar-grid.js, calendar-rank.js, calendar-booking.js, calendar-main.js.
 */
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
   and calendar-core.js (CATEGORY_META). Keys must match. Max 3 selectable per calendar. */
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
    hiddenNames: { icon: 'visibility_off', tooltip: 'Hidden, names private: Users cannot see each other\'s choices or names (organiser sees all)' },
    blind: { icon: 'lock', tooltip: 'Blind: All choices and names are private (even organiser cannot see individual responses)' }
  };
  
  const mode = state.privacyMode === 'hidden' && state.namesPrivate ? 'hiddenNames' : state.privacyMode;
  const config = PRIVACY_CONFIG[mode] || PRIVACY_CONFIG.open;
  
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
 * - Open mode: shown unless the organiser turned them off (Calendar settings)
 * - Hidden mode: allowed, but only the organiser receives the organiser's rows
 * - Blind mode: never show organiser dots
 * @returns {boolean}
 */
function shouldShowOrganiserDots(){
  // User must be authenticated to see organiser dots in calendar grid
  if (!state.currentUserId) return false;
  const auth = state.auth.get(state.currentUserId);
  if (!auth || !auth.token) return false;
  if (isBookingMode()) return false;
  if (state.privacyMode === 'blind') return false;
  // Open: everyone sees them unless the organiser turned them off. Hidden: only the organiser has the data
  if (state.privacyMode === 'open') return state.organiserMarks;
  return true;
}

/** Calendar settings offers the organiser-marks switch: Open availability calendars once migration 010 ran. */
function organiserMarksSettingShown(){
  return state.organiserMarksAvailable && state.privacyMode === 'open' && !isBookingMode();
}

/**
 * Whether you can open someone else's calendar read-only from the People list.
 * Same rule as the Best Match names (joined; Open, or Hidden for the organiser).
 * Not for bookings, or blocked people (their answers are never sent).
 * @param {object|undefined} u - Entry from state.users
 * @returns {boolean}
 */
function canViewUser(u){
  return !!u && !u.mine && !u.blocked && !isBookingMode() && shouldShowRoster();
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

/*** Page elements and state */
const els = {
  calendarTitle: qs('#calendarTitle'),
  serverStatus: qs('#serverStatus'),
  // User select button (icon) and modal
  userSelectBtn: qs('#userSelectBtn'),
  userSelectModal: qs('#userSelectModal'),
  userSelectList: qs('#userSelectList'),
  userSelectCancel: qs('#userSelectCancel'),
  userSelectAddLink: qs('#userSelectAddLink'),
  // Block / Report & block modal (organiser)
  blockUserModal: qs('#blockUserModal'),
  blockUserTitle: qs('#blockUserTitle'),
  blockUserText: qs('#blockUserText'),
  blockModeToggle: qs('#blockModeToggle'),
  blockReportModeBtn: qs('#blockReportModeBtn'),
  blockReportFields: qs('#blockReportFields'),
  blockReason: qs('#blockReason'),
  blockDetails: qs('#blockDetails'),
  blockUserHint: qs('#blockUserHint'),
  blockUserError: qs('#blockUserError'),
  blockUserCancel: qs('#blockUserCancel'),
  blockUserConfirm: qs('#blockUserConfirm'),
  // Other elements
  bannerAddBtn: qs('#bannerAddBtn'),
  nameBanner: qs('#nameBanner'),
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
  userUseProfileBtn: qs('#userUseProfileBtn'),
  userClaimHint: qs('#userClaimHint'),
  userClaimLink: qs('#userClaimLink'),
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
  accountBadge: qs('#accountBadge'),
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
  inviteOnly:false, // People request access (own setting or the Hub's)
  inviteViaHub:false, // Requests go to the Hub organiser
  namesPrivate:false, // Blind, or Hidden with Hide names too
  organiserMarks:true, // Organiser's answers as a coloured slot edge (Open calendars; organiser can turn off)
  organiserMarksAvailable:false, // Server has calendars.show_organiser_marks (migration 010)
  reportsAvailable:false, // Server has the reports table (migration 011): offer Report & block
  reportReasons:null, // reason key => label, from the server so both sides agree
  blockTarget:null, // Person the block modal is open for
  pendingRequests:null, // Requests waiting (only for whoever decides them)
  users:[],
  usersTotal:0, // Everyone who has joined (users may be trimmed when names are private)
  namesHidden:false, // users list trimmed for you (names private, not the organiser)
  currentUserId:null,
  viewUserId:null, // Someone else's answers shown read-only in the grid (People list)
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
  auth:new Map(), // user_id -> {token:true, role}: only your own name (the signed-in account's)
  account:null, // calendar_meta.account: {profile_name, me, claimable}
  nameCustom:false, // Your name here differs from your profile name
  accessAvailable:false, // Server has the access emoji tables (calendar_meta.access.available)
  accessEmoji:null, // This calendar's own emoji position (organiser only, for Share)
  accessHubEmoji:false, // Calendar uses its Hub's emoji (organiser only, for Share)
  accessEmojiLoaded:false,
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
    if(resp.status !== 401 && resp.status !== 403) return resp;
    let data = null;
    try{ data = await resp.clone().json(); }catch(e){ data = null; }
    if(window.Account && Account.handleApiError(data)) return new Promise(() => {});
    if(resp.status !== 403 || tries >= 2 || !window.AccessEmoji) return resp;
    if(!data || data.code !== 'ACCESS_REQUIRED') return resp;
    await requireAccess(data.access || {});
  }
}

async function apiGet(action, params={}){
  const url=new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('c', state.token);
  for(const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await accessFetch(url.toString(), { credentials:'same-origin' });
  return resp.json();
}
/**
 * POST to the API with the CSRF token. The signed-in account's session cookie identifies you.
 * @param {string} action
 * @param {Object} body
 * @param {*} _unused Ignored: who you are comes from the account cookie
 * @param {string|null} extraHubToken Also send this Hub's access grant (adding to a Hub)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiPost(action, body={}, _unused=null, extraHubToken=null){
  const url=new URL('api.php', window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('c', state.token);
  const headers={'Content-Type':'application/json'};
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
