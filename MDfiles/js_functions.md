# JS Functions Reference

Complete catalogue of JavaScript functions across the When RU Free frontend.

---

## calendar.js (~3,000 lines)

### Colour and Contrast

| Function | Line | Description |
|----------|------|-------------|
| `getRelativeLuminance(hexColor)` | 22 | WCAG sRGB luminance calculation. Duplicated in index.js -- keep in sync. |
| `getContrastTextColor(bgColor)` | 51 | Returns '#000000' or '#FFFFFF' based on luminance threshold (0.4). |
| `updateStatusTextColors()` | 69 | Sets `--status-N-text` CSS variables for all status options. |

### Status and Category Configuration

| Function | Line | Description |
|----------|------|-------------|
| `getStrengthPalette(n)` | 102 | Returns array of 1-5 colours for position-based status colouring. |
| `parseCategories(raw)` | 138 | Parses category value (JSON array, plain string, or array) into validated keys. Max 3, defaults to `['groups']`. |
| `setCalendarHeading(titleRaw, categoryRaw)` | 169 | Sets h1 text and appends Material Symbol icons for each category. |
| `updatePrivacyIndicator()` | 196 | Creates/updates the lock/eye icon next to the calendar title. |
| `normaliseStatusOptions(raw)` | 339 | Validates and normalises 1-5 status options with labels, colours, and weights. |
| `applyStatusOptions(rawOptions)` | 385 | Sets STATUS_OPTIONS, applies CSS variables, recalculates text colours, re-renders legend. |
| `renderLegend()` | 402 | Builds the status colour legend in `#legendWrap`. |

### Auth and Permissions

| Function | Line | Description |
|----------|------|-------------|
| `isCurrentUserOrganiser()` | 226 | Returns true if current user has admin role or matches adminUserId. |
| `shouldShowRoster()` | 303 | Privacy-gated: returns true if roster details should be visible in rankings. |
| `shouldShowOrganiserDots()` | 323 | Privacy-gated: returns true if organiser border indicators should show on slots. |
| `ensureCsrfToken()` | 710 | Fetches and caches CSRF token. Called before every POST. |
| `cacheKey(userId)` | 1798 | Returns localStorage key for cached auth: `auth_TOKEN_USERID`. |
| `cacheAuth(userId, token, role, ttlSec)` | 1799 | Stores auth token in localStorage with expiry. |
| `getCachedAuth(userId)` | 1805 | Retrieves valid cached auth or returns null if expired. |
| `ensureAuthedForUser(userId)` | 1813 | Returns auth object for a user, checking cache and state. |
| `tryAutoAuthCreator()` | 2907 | Auto-authenticates calendar creator using sessionStorage credentials. |
| `tryRestoreCachedSession()` | 2962 | Restores cached user session from localStorage on page load. |

### Utilities

| Function | Line | Description |
|----------|------|-------------|
| `qs(sel)` | 416 | Shorthand for `document.querySelector`. |
| `debounce(fn, ms)` | 417 | Returns a debounced version of `fn`. |
| `getToken()` | 418 | Extracts calendar token from URL `?c=` parameter. |
| `showToast(msg)` | 419 | Shows a brief notification. Centres for "Saved to server!" messages. |
| `fmtDate(d)` | 575 | Date object to YYYY-MM-DD string. |
| `formatFriendlyDate(dateStr)` | 581 | YYYY-MM-DD to "Mon 24th Jan 2026" with ordinal suffix. |
| `formatDateRange(startStr, endStr)` | 589 | Formats two dates into a compact range string. |
| `formatDayHeader(dateStr)` | 598 | Returns `{dayNum, dayName, monthAbbr}` for grid column headers. |
| `getDayOfWeek(date)` | 599 | Returns 0-6 (Sun-Sat) for a Date object. |
| `tz()` | 724 | Returns the browser's IANA timezone string. |
| `escapeHTML(str)` | 2512 | Escapes a string for safe HTML insertion via textContent. |
| `escapeMessageHTML(str)` | 2350 | Alias for HTML escaping (used by organiser message). |

### API Communication

| Function | Line | Description |
|----------|------|-------------|
| `apiGet(action, params)` | 727 | GET request to api.php with calendar token. Returns parsed JSON. |
| `apiPost(action, body, authToken)` | 745 | POST request with CSRF and optional auth token. Returns parsed JSON. |

### Data Loading

| Function | Line | Description |
|----------|------|-------------|
| `loadCalendarMeta()` | 763 | Fetches calendar config, applies slots/statuses/dates/privacy/chosen state. |
| `loadUsers()` | 830 | Fetches user list, sorts admin first, caches adminUserId. |
| `ensureRangeLoaded(from, to)` | 1089 | Fetches availability for a date range if not already loaded. |
| `ensureDateRangeLoaded()` | 2092 | Loads the full calendar date range. |
| `ensureCalendarLoadedAllDates()` | 3042 | Ensures all dates are loaded after save operations. |

### Pending Changes and Autosave

| Function | Line | Description |
|----------|------|-------------|
| `pendingKey(userId)` | 433 | Returns localStorage key for pending changes: `pending_TOKEN_USERID`. |
| `prunePendingForStorage(p)` | 442 | Removes NULL (status 0) entries from pending object for localStorage. |
| `validatePendingForSave(p)` | 464 | Validates pending object for server save, keeping NULL entries (server deletes them). |
| `persistPendingNow()` | 483 | Immediately writes pending changes to localStorage. |
| `persistPendingDebounced()` | 498 | Debounced (220ms) version of persistPendingNow. |
| `clearPersistedPending(userId)` | 502 | Removes pending changes from localStorage for a user. |
| `restorePendingForUser(userId)` | 505 | Reads and validates pending changes from localStorage. |
| `scheduleAutosave()` | 537 | Schedules server save after AUTOSAVE_DELAY_MS (4500ms) of inactivity. |
| `cancelAutosave()` | 568 | Clears pending autosave timer. |
| `savePending(isAutosave)` | 1833 | Sends pending changes to server. Handles NULL status (delete) and positive statuses (upsert). |

### UI State Management

| Function | Line | Description |
|----------|------|-------------|
| `updateCurrentUserDisplay()` | 842 | Updates the user name badge in the header. |
| `updateSubmitButtonState()` | 1102 | Toggles submit button between "Save"/"Saved"/"Saving" states. |
| `setLoading(isLoading, message)` | 1123 | Shows/hides loading overlay. |
| `updateUserUI()` | 1143 | Shows/hides buttons based on auth state and role. Hides submit when frozen. |
| `updateSortToggleUI()` | 2274 | Updates sort toggle active state. Visible for all authenticated users. |
| `updateLimitToggleUI()` | 2310 | Updates rank limit toggle active state. |
| `updateOrganiserMessageUI()` | 2361 | Shows/hides organiser message area. Editable for organiser, read-only for others. |

### Calendar Grid

| Function | Line | Description |
|----------|------|-------------|
| `renderDateRangeSkeleton()` | 1357 | Builds the full calendar grid with day columns, headers, and slot elements. |
| `refreshCalendarValues()` | 1447 | Updates all slot colours and organiser dots for the current user. |
| `getStatus(userId, dateStr, slotId)` | 1177 | Returns `{status, pending}` for a user/date/slot, checking pending changes first. |
| `getOrganiserStatus(dateStr, slotId)` | 1194 | Returns the admin's status for a slot (for organiser dots). |
| `setSlotClass(el, status)` | 1200 | Applies `status-N` CSS class to a slot element. |
| `updateOrganiserDot(slotEl, dateStr, slotId)` | 1216 | Applies `org-border-N` CSS class for organiser's left-border indicator. |
| `cycleStatus(current)` | 1473 | Cycles through statuses: NULL -> 1 -> 2 -> ... -> N -> NULL. |
| `onSlotClick(dateStr, slotId)` | 1517 | Main slot click handler. Blocks if frozen, prompts auth if needed, cycles status. |
| `highlightLegendItem(statusIndex)` | 1486 | Adds `recently-used` class to matching legend item. |
| `clearLegendHighlights()` | 1501 | Removes all legend highlights after save. |

### Date Filtering

| Function | Line | Description |
|----------|------|-------------|
| `updateDateFilterBanner()` | 235 | Shows/hides the date filter instruction banner for the organiser. |
| `setDateFilterSaveStatus(status)` | 280 | Updates the save status pill: unsaved/saving/saved. |
| `isDateVisible(dateStr)` | 1243 | Returns true if a date should be shown based on filter mode. Organiser always sees all. |
| `isDateMarked(dateStr)` | 1261 | Returns true if a date is in the dateFilterDates array. |
| `toggleDateFilter(dateStr)` | 1270 | Adds/removes a date from filter selections. Organiser only. |
| `scheduleDateFilterSave()` | 1293 | Debounced (1500ms) save of date filter to server. |
| `saveDateFilterDates()` | 1305 | Sends date filter selections to server via `save_date_filter`. |
| `updateDateFilterIndicators()` | 1333 | Updates visual highlights on day headers for filtered dates. |

### Rankings and Analysis

| Function | Line | Description |
|----------|------|-------------|
| `buildRankScores()` | 2213 | Scores all date+slot combinations. Returns sorted array of `{dateStr, slotId, slotLabel, counts, score, details}`. |
| `rankKey(item)` | 2624 | Returns unique key for a rank item: `dateStr\nslotId`. |
| `toggleRankExpand(key)` | 2625 | Toggles expanded state for a rank card and re-renders. |
| `renderRankings()` | 2629 | Builds rank cards with roster, actions, and choose button. Pins chosen card when frozen. |
| `buildCalendarLinks(item)` | 2095 | Generates Google Calendar URL and ICS blob for a rank item. |
| `shareRankingDetails(item, opts)` | 2156 | Shares rank card details via Web Share API or clipboard. |
| `saveSortOrderToServer()` | 2327 | Saves organiser's rank sort preference to server. |

### Chosen/Frozen State

| Function | Line | Description |
|----------|------|-------------|
| `isCalendarFrozen()` | 2453 | Returns true if organiser has locked in a chosen date+slot. |
| `updateChosenBanner()` | 2461 | Renders/removes the green "Decided" banner. Organiser sees Reopen button. |
| `applyFrozenState()` | 2524 | Adds `chosen-slot`/`frozen-slot` classes to grid. Dims non-chosen slots. |
| `chooseSlot(dateStr, slotId)` | 2556 | Sends `choose_slot` API call with confirmation dialog. Updates all UI. |
| `unchooseSlot()` | 2596 | Sends `unchoose_slot` API call with confirmation dialog. Reopens calendar. |

### Organiser Message

| Function | Line | Description |
|----------|------|-------------|
| `openMessageEdit()` | 2399 | Opens inline textarea for editing organiser message. |
| `cancelMessageEdit()` | 2412 | Closes edit mode without saving. |
| `updateMessageCharCount()` | 2420 | Updates the character counter below the textarea. |
| `saveOrganiserMessage()` | 2428 | Saves message to server and updates local state. |

### User Management Modals

| Function | Line | Description |
|----------|------|-------------|
| `populateUserSelectModal()` | 864 | Builds user list with avatars, roles, logout/delete buttons. |
| `openUserSelectModal()` | 968 | Shows the user selection modal. |
| `closeUserSelectModal()` | 973 | Hides the user selection modal. |
| `logoutCurrentUser()` | 981 | Clears auth and reloads the page. |
| `confirmDeleteCalendarUser(userId, displayName)` | 1007 | Confirmation dialog then DELETE API call. Organiser only. |
| `onUserSelectItemClick(userId)` | 1045 | Handles user selection -- switches or prompts PIN. |
| `openUserModal(mode)` | 1555 | Opens add/rename modal. Mode: 'add' or 'rename'. |
| `closeUserModal()` | 1582 | Closes the user modal. |
| `validateName(name)` | 1583 | Validates display name (1-40 chars, allowed characters). |
| `validatePin4(s)` | 1589 | Returns true if string is exactly 4 digits. |
| `openPinModal(userId, userObj)` | 1715 | Opens PIN entry modal for authentication. |
| `wirePinToggle(inputEl, btnEl)` | 1784 | Wires show/hide toggle for PIN input fields. |
| `showInfoModal()` | 1508 | Shows the "Select a Name" prompt modal. |
| `closeInfoModal()` | 1514 | Closes the info modal. |

### Hub membership (calendar page)

| Function | Line | Description |
|----------|------|-------------|
| `updateHubBarUI()` | 1231 | Shows Hub breadcrumb link or "Not in a Hub"; organiser add/remove buttons. |
| `extractHubToken(raw)` | 1263 | Parses Hub code or URL from user input for attach modal. |
| `showHubModal()` | 1280 | Opens modal to enter Hub code/link. |
| `hideHubModal()` | 1288 | Closes Hub attach modal. |
| `confirmAddToHub()` | 1292 | POST `add_calendar_to_group` (calendar organiser). |
| `removeFromHub()` | 1315 | POST `remove_calendar_from_group` (calendar organiser). |

### Reset Operations

| Function | Line | Description |
|----------|------|-------------|
| `resetMyAvailability()` | 1971 | Confirmation then API call to delete current user's availability. |
| `resetAllUsers()` | 2039 | Double confirmation (confirm + type "RESET") then API call. Admin only. |

### Initialisation

| Function | Line | Description |
|----------|------|-------------|
| `init()` | 2979 | Main entry point. Loads meta, users, restores session, renders grid and rankings. |

---

## index.js (~1,100 lines)

### Category UI

| Function | Line | Description |
|----------|------|-------------|
| `getSelectedCategories()` | 12 | Returns array of active category button values. |
| `updateCatUI()` | 19 | Updates counter and disables buttons at CAT_MAX (3). |

### Colour and Contrast (Duplicated)

| Function | Line | Description |
|----------|------|-------------|
| `getRelativeLuminance(hexColor)` | 51 | Same as calendar.js -- keep in sync. |
| `getContrastTextColor(bgColor)` | 80 | Same as calendar.js -- keep in sync. |
| `applyColorPreview(colorPicker, labelInput)` | 99 | Applies colour picker value as background to status label input. |

### Helpers

| Function | Line | Description |
|----------|------|-------------|
| `ensureCsrfToken()` | 111 | Fetches and caches CSRF token. |
| `normaliseTitle(t)` | 126 | Strips tags, trims, max 80 chars. |
| `normaliseSlotLabel(s)` | 133 | Strips NBSP, trims, max 20 chars. |
| `formatDateDisplay(dateStr)` | 144 | Formats YYYY-MM-DD to "Mar 15, 2026". |
| `daysBetween(start, end)` | 149 | Returns integer day count between two date strings. |
| `getTodayClamped()` | 154 | Returns today's date clamped to MIN_DATE/MAX_DATE. |
| `addDays(dateStr, days)` | 162 | Adds days to a date string, clamped to range. |

### Slots UI

| Function | Line | Description |
|----------|------|-------------|
| `makeSlotRow(initial)` | 177 | Creates a slot input row with delete button and error span. |
| `readSlotsFromUI()` | 204 | Reads all slot input values into an array. |
| `setSlots(slots)` | 208 | Replaces slot rows with given labels. |
| `addSlot(label)` | 213 | Adds a slot row (max 6). |
| `validateSlotsUI()` | 230 | Validates all slots, shows inline errors. |

### Calendar Creation

| Function | Line | Description |
|----------|------|-------------|
| `createCalendar()` | 830 | Validates form, sends `create_calendar` API call, stores creator auth in sessionStorage, redirects to calendar page. |
| `validateAll()` | ~800 | Validates all form fields and enables/disables create button. |

### Template System

| Function | Line | Description |
|----------|------|-------------|
| `parseTemplateParams()` | 917 | Reads URL params (title, category, slots, statuses, weights, mode, range, weekends, datefilter) and prefills the form. |
| `showTemplateBanner()` | 1068 | Shows blue "Template loaded!" notification banner. |
| `initHubContext()` | 48 | Reads `?g=` token, fetches `group_meta`, shows Hub banner; sets `hubContext` for `create_calendar`. |
| `getHubTokenFromUrl()` | 44 | Returns Hub token from `?g=` query param. |

---

## hub.js (~856 lines)

Hub create/view page. Uses `hubSaveKit` object for copy, share, email, download, and poster output.

### URL and state

| Function | Line | Description |
|----------|------|-------------|
| `getGroupTokenFromUrl()` | 15 | Returns Hub token from `?g=` query param. |
| `isCreateMode()` | 19 | True when `?create=1` (show create form). |
| `toPlainAscii(str)` | 23 | Strips smart punctuation for plain-text share/download output. |

### hubSaveKit (save panel and link bar)

| Method | Line | Description |
|--------|------|-------------|
| `buildHubUrl(token)` | 38 | Full Hub URL for sharing. |
| `buildHubDetailsText(meta)` | 59 | Plain-text block for clipboard and `.txt` download. |
| `copyHubUrl(url)` | 95 | Copies Hub link to clipboard. |
| `copyHubCode(token)` | 105 | Copies Hub code only. |
| `shareHubLink(meta)` | 125 | Web Share API or clipboard fallback. |
| `emailHubLink(meta)` | 138 | Opens mailto with Hub details. |
| `openHubPosterPopup(meta)` | 349 | Opens printable poster in new window (Blob URL). |

### Auth and API

| Function | Line | Description |
|----------|------|-------------|
| `cacheGroupAuth(token, auth)` | 399 | Stores Hub organiser session in localStorage (`wruf_group_auth_{token}`). |
| `getCachedGroupAuth(token)` | 410 | Retrieves valid cached Hub organiser auth. |
| `clearCachedGroupAuth(token)` | 425 | Clears Hub organiser cache on Logout. |
| `authGroup(pin)` | 678 | POST `auth_group`; returns auth token. |
| `removeCalendarFromHub(calToken, btn)` | 755 | POST `remove_calendar_from_group` (Hub organiser). |

### UI

| Function | Line | Description |
|----------|------|-------------|
| `showSaveHubPanel(meta)` | 440 | Post-create modal: copy, download, share, email, poster, ack checkbox. |
| `createHub()` | 495 | POST `create_group`, then show save panel. |
| `loadHubView()` | 656 | GET `group_meta`, render calendar grid. |
| `updateHubPublicUI()` | 607 | Link bar, copy handlers, Create new calendar link. |
| `updateOrganiserUI()` | 631 | Shows/hides organiser-only Share/Email/Download/Remove. |
| `renderCalendarGrid()` | 558 | Lists child calendars with links to `calendar.html?c=`. |

---

## admin.js (~1,070 lines)

Admin panel logic. Not documented in detail here as it is a separate internal tool. Key functions: `loadCalendars()`, `renderCalendarList()`, `deleteCalendar()`, `togglePermanent()`, `loadUsers()`, `deleteUser()`.
