# JS Functions Reference

Complete catalogue of JavaScript functions across the When RU Free frontend.

---

## calendar-*.js (6 files, ~4,400 lines)

The calendar page is split into six classic scripts that share global scope (no modules, no build step). `calendar.html` loads them after `passkey.js` and `emoji.js`, in this order. A later file may call functions from an earlier one at any time. Top-level code that runs at load (for example `els`, `debouncedRank`, listener wiring) may only use names from its own file or an earlier file. Never declare the same top-level name in two files.

| File | Contents |
|------|----------|
| `calendar-core.js` | Constants, colours, status options, utilities (`qs`, `debounce`, `showToast`), pending queue, autosave, date formatting, `els`, `state`, CSRF, access gate, `apiGet` / `apiPost` |
| `calendar-users.js` | Meta load, users, user-select modal, submit / user UI, Hub bar, settings modal, add / rename, PIN, passkeys, auth cache |
| `calendar-grid.js` | Availability fetch, slot status, date filter, grid skeleton, past dates, slot click, save and reset |
| `calendar-rank.js` | Calendar links, share, rank scores, sort / limit toggles, organiser message, chosen slot, Best Match, `debouncedRank` |
| `calendar-booking.js` | Booking mode and booking polling |
| `calendar-main.js` | Event wiring, session restore, `init()` on `DOMContentLoaded` |

### Colour and Contrast

| Function | File:Line | Description |
|----------|------|-------------|
| `getRelativeLuminance(hexColor)` | calendar-core.js:27 | WCAG sRGB luminance calculation. Duplicated in index.js -- keep in sync. |
| `getContrastTextColor(bgColor)` | calendar-core.js:56 | Returns '#000000' or '#FFFFFF' based on luminance threshold (0.4). |
| `updateStatusTextColors()` | calendar-core.js:74 | Sets `--status-N-text` CSS variables for all status options. |

### Status and Category Configuration

| Function | File:Line | Description |
|----------|------|-------------|
| `getStrengthPalette(n)` | calendar-core.js:107 | Returns array of 1-5 colours for position-based status colouring. |
| `parseCategories(raw)` | calendar-core.js:146 | Parses category value (JSON array, plain string, or array) into validated keys. Max 3, defaults to `['groups']`. |
| `setCalendarHeading(titleRaw, categoryRaw)` | calendar-core.js:177 | Sets h1 text and appends Material Symbol icons for each category. |
| `updatePrivacyIndicator()` | calendar-core.js:204 | Creates/updates the lock/eye icon next to the calendar title. |
| `normaliseStatusOptions(raw)` | calendar-core.js:348 | Validates and normalises 1-5 status options with labels, colours, and weights. |
| `applyStatusOptions(rawOptions)` | calendar-core.js:394 | Sets STATUS_OPTIONS, applies CSS variables, recalculates text colours, re-renders legend. |
| `renderLegend()` | calendar-core.js:411 | Builds the status colour legend in `#legendWrap`. |

### Auth and Permissions

| Function | File:Line | Description |
|----------|------|-------------|
| `isCurrentUserOrganiser()` | calendar-core.js:234 | Returns true if current user has admin role or matches adminUserId. |
| `shouldShowRoster()` | calendar-core.js:311 | Privacy-gated: returns true if roster details should be visible in rankings. |
| `shouldShowOrganiserDots()` | calendar-core.js:331 | Privacy-gated: returns true if organiser border indicators should show on slots. |
| `ensureCsrfToken()` | calendar-core.js:752 | Fetches and caches CSRF token. Called before every POST. |
| `cacheKey(userId)` | calendar-users.js:1056 | Returns localStorage key for cached auth: `auth_TOKEN_USERID`. |
| `cacheAuth(userId, token, role, ttlSec)` | calendar-users.js:1057 | Stores auth token in localStorage with expiry. |
| `getCachedAuth(userId)` | calendar-users.js:1063 | Retrieves valid cached auth or returns null if expired. |
| `ensureAuthedForUser(userId)` | calendar-users.js:1071 | Returns auth object for a user, checking cache and state. |
| `tryAutoAuthCreator()` | calendar-main.js:133 | Auto-authenticates calendar creator using sessionStorage credentials. |
| `tryRestoreCachedSession()` | calendar-main.js:188 | Restores cached user session from localStorage on page load. |

### Utilities

| Function | File:Line | Description |
|----------|------|-------------|
| `qs(sel)` | calendar-core.js:426 | Shorthand for `document.querySelector`. |
| `debounce(fn, ms)` | calendar-core.js:427 | Returns a debounced version of `fn`. |
| `getToken()` | calendar-core.js:428 | Extracts calendar token from URL `?c=` parameter. |
| `showToast(msg)` | calendar-core.js:429 | Shows a brief notification. Centres for "Saved to server!" messages. |
| `fmtDate(d)` | calendar-core.js:585 | Date object to YYYY-MM-DD string. |
| `formatFriendlyDate(dateStr)` | calendar-core.js:591 | YYYY-MM-DD to "Mon 24th Jan 2026" with ordinal suffix. |
| `formatDateRange(startStr, endStr)` | calendar-core.js:599 | Formats two dates into a compact range string. |
| `formatDayHeader(dateStr)` | calendar-core.js:608 | Returns `{dayNum, dayName, monthAbbr}` for grid column headers. |
| `getDayOfWeek(date)` | calendar-core.js:614 | Returns 0-6 (Sun-Sat) for a Date object. |
| `tz()` | calendar-core.js:768 | Returns the browser's IANA timezone string. |
| `escapeHTML(str)` | calendar-rank.js:464 | Escapes a string for safe HTML insertion via textContent. |
| `escapeMessageHTML(str)` | calendar-rank.js:297 | Alias for HTML escaping (used by organiser message). |

### API Communication

| Function | File:Line | Description |
|----------|------|-------------|
| `apiGet(action, params)` | calendar-core.js:829 | GET request to api.php with calendar token. Returns parsed JSON. |
| `apiPost(action, body, authToken)` | calendar-core.js:856 | POST request with CSRF and optional auth token. Returns parsed JSON. |

### Data Loading

| Function | File:Line | Description |
|----------|------|-------------|
| `loadCalendarMeta()` | calendar-users.js:8 | Fetches calendar config, applies slots/statuses/dates/privacy/chosen state. |
| `loadUsers()` | calendar-users.js:111 | Fetches user list, sorts admin first, caches adminUserId. |
| `ensureRangeLoaded(from, to)` | calendar-grid.js:31 | Fetches availability for a date range if not already loaded. |
| `ensureDateRangeLoaded()` | calendar-grid.js:790 | Loads the full calendar date range. |
| `ensureCalendarLoadedAllDates()` | calendar-main.js:282 | Ensures all dates are loaded after save operations. |

### Pending Changes and Autosave

| Function | File:Line | Description |
|----------|------|-------------|
| `pendingKey(userId)` | calendar-core.js:443 | Returns localStorage key for pending changes: `pending_TOKEN_USERID`. |
| `prunePendingForStorage(p)` | calendar-core.js:452 | Removes NULL (status 0) entries from pending object for localStorage. |
| `validatePendingForSave(p)` | calendar-core.js:474 | Validates pending object for server save, keeping NULL entries (server deletes them). |
| `persistPendingNow()` | calendar-core.js:493 | Immediately writes pending changes to localStorage. |
| `persistPendingDebounced()` | calendar-core.js:508 | Debounced (220ms) version of persistPendingNow. |
| `clearPersistedPending(userId)` | calendar-core.js:512 | Removes pending changes from localStorage for a user. |
| `restorePendingForUser(userId)` | calendar-core.js:515 | Reads and validates pending changes from localStorage. |
| `scheduleAutosave()` | calendar-core.js:547 | Schedules server save after AUTOSAVE_DELAY_MS (4500ms) of inactivity. |
| `cancelAutosave()` | calendar-core.js:578 | Clears pending autosave timer. |
| `savePending(isAutosave)` | calendar-grid.js:487 | Sends pending changes to server. Handles NULL status (delete) and positive statuses (upsert). |

### UI State Management

| Function | File:Line | Description |
|----------|------|-------------|
| `updateCurrentUserDisplay()` | calendar-users.js:123 | Updates the user name badge in the header. |
| `updateSubmitButtonState()` | calendar-users.js:384 | Toggles submit button between "Save"/"Saved"/"Saving" states. |
| `setLoading(isLoading, message)` | calendar-users.js:405 | Shows/hides loading overlay. |
| `updateUserUI()` | calendar-users.js:425 | Shows/hides buttons based on auth state and role. Hides submit when frozen. |
| `updateSortToggleUI()` | calendar-rank.js:198 | Updates sort toggle active state. Visible for all authenticated users. |
| `updateLimitToggleUI()` | calendar-rank.js:257 | Updates rank limit toggle active state. |
| `updateOrganiserMessageUI()` | calendar-rank.js:308 | Shows/hides organiser message area. Editable for organiser, read-only for others. |

### Calendar Grid

| Function | File:Line | Description |
|----------|------|-------------|
| `renderDateRangeSkeleton()` | calendar-grid.js:228 | Builds the full calendar grid with day columns, headers, and slot elements. |
| `refreshCalendarValues()` | calendar-grid.js:366 | Updates all slot colours and organiser dots for the current user. |
| `getStatus(userId, dateStr, slotId)` | calendar-grid.js:48 | Returns `{status, pending}` for a user/date/slot, checking pending changes first. |
| `getOrganiserStatus(dateStr, slotId)` | calendar-grid.js:65 | Returns the admin's status for a slot (for organiser dots). |
| `setSlotClass(el, status)` | calendar-grid.js:71 | Applies `status-N` CSS class to a slot element. |
| `updateOrganiserDot(slotEl, dateStr, slotId)` | calendar-grid.js:87 | Applies `org-border-N` CSS class for organiser's left-border indicator. |
| `cycleStatus(current)` | calendar-grid.js:393 | Cycles through statuses: NULL -> 1 -> 2 -> ... -> N -> NULL. |
| `onSlotClick(dateStr, slotId)` | calendar-grid.js:437 | Main slot click handler. Blocks if frozen, prompts auth if needed, cycles status. |
| `highlightLegendItem(statusIndex)` | calendar-grid.js:406 | Adds `recently-used` class to matching legend item. |
| `clearLegendHighlights()` | calendar-grid.js:421 | Removes all legend highlights after save. |

### Date Filtering

| Function | File:Line | Description |
|----------|------|-------------|
| `updateDateFilterBanner()` | calendar-core.js:243 | Shows/hides the date filter instruction banner for the organiser. |
| `setDateFilterSaveStatus(status)` | calendar-core.js:288 | Updates the save status pill: unsaved/saving/saved. |
| `isDateVisible(dateStr)` | calendar-grid.js:114 | Returns true if a date should be shown based on filter mode. Organiser always sees all. |
| `isDateMarked(dateStr)` | calendar-grid.js:132 | Returns true if a date is in the dateFilterDates array. |
| `toggleDateFilter(dateStr)` | calendar-grid.js:141 | Adds/removes a date from filter selections. Organiser only. |
| `scheduleDateFilterSave()` | calendar-grid.js:164 | Debounced (1500ms) save of date filter to server. |
| `saveDateFilterDates()` | calendar-grid.js:176 | Sends date filter selections to server via `save_date_filter`. |
| `updateDateFilterIndicators()` | calendar-grid.js:204 | Updates visual highlights on day headers for filtered dates. |

### Rankings and Analysis

| Function | File:Line | Description |
|----------|------|-------------|
| `buildRankScores()` | calendar-rank.js:126 | Scores all date+slot combinations. Returns sorted array of `{dateStr, slotId, slotLabel, counts, score, details}`. |
| `rankKey(item)` | calendar-rank.js:576 | Returns unique key for a rank item: `dateStr\nslotId`. |
| `toggleRankExpand(key)` | calendar-rank.js:577 | Toggles expanded state for a rank card and re-renders. |
| `renderRankings()` | calendar-rank.js:581 | Builds rank cards with roster, actions, and choose button. Pins chosen card when frozen. |
| `buildCalendarLinks(item)` | calendar-rank.js:8 | Generates Google Calendar URL and ICS blob for a rank item. |
| `shareRankingDetails(item, opts)` | calendar-rank.js:69 | Shares rank card details via Web Share API or clipboard. |
| `saveSortOrderToServer()` | calendar-rank.js:274 | Saves organiser's rank sort preference to server. |

### Chosen/Frozen State

| Function | File:Line | Description |
|----------|------|-------------|
| `isCalendarFrozen()` | calendar-rank.js:400 | Returns true if organiser has locked in a chosen date+slot. |
| `canReopenCalendar()` | calendar-rank.js:408 | True when the selected user is the organiser and has a valid session. |
| `updateChosenBanner()` | calendar-rank.js:412 | Renders/removes the green "Decided" banner; Reopen shown when `canReopenCalendar()`. Called from `updateUserUI()`, so it follows login / logout / name switches. |
| `applyFrozenState()` | calendar-rank.js:476 | Adds `chosen-slot`/`frozen-slot` classes to grid. Dims non-chosen slots. |
| `chooseSlot(dateStr, slotId)` | calendar-rank.js:508 | Sends `choose_slot` API call with confirmation dialog. Updates all UI. |
| `unchooseSlot()` | calendar-rank.js:548 | Sends `unchoose_slot` API call with confirmation dialog. Reopens calendar. |

### Organiser Message

| Function | File:Line | Description |
|----------|------|-------------|
| `openMessageEdit()` | calendar-rank.js:346 | Opens inline textarea for editing organiser message. |
| `cancelMessageEdit()` | calendar-rank.js:359 | Closes edit mode without saving. |
| `updateMessageCharCount()` | calendar-rank.js:367 | Updates the character counter below the textarea. |
| `saveOrganiserMessage()` | calendar-rank.js:375 | Saves message to server and updates local state. |

### User Management Modals

| Function | File:Line | Description |
|----------|------|-------------|
| `populateUserSelectModal()` | calendar-users.js:145 | Builds user list with avatars, roles, logout/delete buttons. |
| `openUserSelectModal()` | calendar-users.js:265 | Shows the user selection modal. |
| `closeUserSelectModal()` | calendar-users.js:270 | Hides the user selection modal. |
| `logoutCurrentUser()` | calendar-users.js:278 | Clears auth and reloads the page. |
| `confirmDeleteCalendarUser(userId, displayName)` | calendar-users.js:304 | Confirmation dialog then DELETE API call. Organiser only. |
| `onUserSelectItemClick(userId)` | calendar-users.js:342 | Handles user selection -- switches or prompts PIN. |
| `openUserModal(mode)` | calendar-users.js:640 | Opens add/rename modal. Mode: 'add' or 'rename'. |
| `closeUserModal()` | calendar-users.js:667 | Closes the user modal. |
| `validateName(name)` | calendar-users.js:668 | Validates display name (1-40 chars, allowed characters). |
| `validatePin4(s)` | calendar-users.js:674 | Returns true if string is exactly 4 digits. |
| `openPinModal(userId, userObj)` | calendar-users.js:801 | Opens PIN entry modal for authentication. |
| `wirePinToggle(inputEl, btnEl)` | calendar-users.js:1042 | Wires show/hide toggle for PIN input fields. |
| `showInfoModal()` | calendar-grid.js:428 | Shows the "Select a Name" prompt modal. |
| `closeInfoModal()` | calendar-grid.js:434 | Closes the info modal. |

### Fingerprint / face unlock (calendar page)

Device memory key: `passkeyId(userId)` = `cal_{calendarToken}_{userId}` (see `passkey.js`).

| Function | File:Line | Description |
|----------|------|-------------|
| `finishUnlock(userId, res)` | calendar-users.js:846 | Shared success path for PIN and passkey login: caches auth, sets current user, refreshes UI. |
| `passkeyId(userId)` | calendar-users.js:867 | Device-local id for this calendar user. |
| `passkeysUsable()` | calendar-users.js:868 | True when server reports `passkeys` and the browser supports WebAuthn. |
| `unlockWithPasskey(userId)` | calendar-users.js:870 | `passkey_login_begin` -> device prompt -> `passkey_login_finish`. Falls back to PIN on cancel / error; forgets device on `NO_PASSKEY`. |
| `maybeOfferPasskey(userId)` | calendar-users.js:901 | After PIN login or add-name, shows the "Turn on" offer once (skipped if enrolled, dismissed, or no platform authenticator). |
| `enrolPasskey(userId, errorEl, btn)` | calendar-users.js:910 | `passkey_register_begin` -> device prompt -> `passkey_register_finish` (sends `device_label`); remembers the device. |
| `openPasskeyWindow(userId, silent)` | - | The one **Passkeys** window (`#passkeyModal`), opened from the fingerprint icon in the user list or once after a PIN login (`maybeOfferPasskey`, `silent` = no list errors). No passkey on this device: "Set up a passkey?" (Not now / Set up passkey) plus "Passkeys on other devices" with Remove, if any. This device has one: full device list with Remove (`passkey_remove`) and Close. "Not now" records the dismissal. |

### Access emoji (calendar page)

| Function | File:Line | Description |
|----------|------|-------------|
| `accessHubToken()` | calendar-core.js:773 | Hub token of this calendar (from meta), used to send the Hub grant too. |
| `accessGrantKeys(extraHubToken)` | calendar-core.js:779 | Grant storage keys to send: `c_{calendar}`, `g_{hub}` and an optional extra Hub (for `confirmAddToHub`). |
| `requireAccess(info)` | calendar-core.js:788 | Shows the blocking emoji popup (`AccessEmoji.gate`), posts `access_check` and saves the grant. Resolves false if the user leaves. |
| `accessFetch(url, opts, extraHubToken)` | calendar-core.js:815 | `fetch` wrapper used by `apiGet`, `apiPost` and `postSave`: adds `X-Access-Grant`; on 403 `ACCESS_REQUIRED` clears stale grants, shows the popup and retries (max 3 tries). |
| `loadAccessEmoji()` / `applyAccessSettings(data)` | calendar-users.js:577 | Organiser only: GET `access_settings` into `accessAvailable`, `accessEmoji`, `accessHubEmoji`. |
| `openSettingsModal()` / `hideSettingsModal()` | calendar-users.js:585 | Organiser **Settings** window (`#settingsModal`, gear `#settingsBtn`): emoji on/off/change via `AccessEmoji.field`, confirms, then POST `set_access_emoji` and stores the fresh grant. |

The header Share button adds `AccessEmoji.shareLine()` under the link when an emoji is set.

### Booking mode (calendar page)

Active when `calendar_meta` has `slot_capacity` (`state.booking = {capacity, perUser, closed}`). `renderRankings()`, `refreshCalendarValues()`, `onSlotClick()`, `renderLegend()`, `updateChosenBanner()` and `resetMyAvailability()` hand over to these; organiser dots are off. Taps are normal pending changes (Submit, auto-save, restore after reload); `savePending()` drops the server's `rejected` slots (toast "Just taken by someone else" / limit), handles `BOOKINGS_CLOSED` (`handleBookingsClosedOnSave()`), then reloads availability.

| Function | File:Line | Description |
|----------|------|-------------|
| `isBookingMode()` / `isBookingClosed()` | calendar-booking.js:16 | Booking calendar? Bookings closed? |
| `currentBookingView()` | calendar-booking.js:33 | `'booked'`, `'mine'` or `'free'` list. Organiser: Booked / Free; everyone else: Mine / Free. Always opens on Booked / Mine; only an explicit Free choice sticks, anything else maps to the role's first button. |
| `setBookingViewButton(btn, mode, icon, label)` | calendar-booking.js:38 | Sets a `#sortToggle` button's mode, icon and label (text only, no HTML). `updateSortToggleUI()` labels the first button Booked (organiser) or "Mine (N)" / "Mine (N of M)" (In total limit) on every render. |
| `applyBookingChrome()` | calendar-booking.js:57 | Page title, name banner text, "Cancel my bookings" titles; list limit 2. |
| `applyBookingColors(partial, full)` | calendar-booking.js:76 | Sets `--bk-partial` / `--bk-full` (and `-text` contrast colours via `getContrastTextColor()`) from `calendar_meta`; `null` keeps the CSS defaults (orange / red). |
| `bookingStateName(name, fallback)` | calendar-booking.js:71 | Organiser's Partly booked / Full name from `calendar_meta`, or the default. |
| `renderBookingLegend()` | calendar-booking.js:85 | Legend: Free / Yours / (partly booked name when capacity is 2+) / full name (`state.booking.partialLabel` / `fullLabel`). |
| `bookingInfo(dateStr, slotId)` | calendar-booking.js:104 | `{ids, mine, count, left, full}` for a slot, including your unsaved change. Others are the larger of the known rows and the anonymous summary (minus your saved booking), so it works in Hidden mode too. |
| `bookingCellText(info)` / `renderBookingCell(el, dateStr, slot)` / `refreshBookingCells()` | calendar-booking.js:126 | Cell sub-line (your booking shows the booking label, e.g. "Booked", on the booking colour / Free / the booking label when taken) and classes `bk-mine`, `bk-partial`, `bk-full`. Slots for 2+ people start the sub-line with a `.bk-count` "N/M" (people booked so far / people per slot), then the label, Free, "booked" or Full. Cells never show names (no room); names are on the Bookings card. |
| `myBookingCount(dateStr)` / `myTotalBookingCount(withPending)` | calendar-booking.js:171 | Your bookings that count towards Bookings per person, saved plus unsaved: that day's, or all of them when `state.booking.perUserTotal` / all your bookings (saved only for "Cancel my bookings"; `withPending` adds unsaved changes). |
| `onBookingSlotClick(dateStr, slotId)` / `setPendingBooking(dateStr, slotId, status)` | calendar-booking.js:214 | Tap: closed / pick a name / unlock checks, "This slot is taken", the per-person limit message, else toggles Booked / not booked as a pending change (repaints the cell, Submit state, auto-save). Toggling back to the saved state removes the pending entry. |
| `bookingCardAction(dateStr, slotId)` | calendar-booking.js:255 | Book / Cancel buttons on the Bookings card: the same toggle, saved straight away. |
| `queueBooking(userId, dateStr, slotId, status)` / `sendBooking(...)` | calendar-booking.js:278 | Organiser removal of someone else's booking, one at a time (`bk-busy` on the cell), then reloads availability. An expired session reopens the PIN window (`handleExpiredSession()`). |
| `cancelMyBookings(auth)` | calendar-booking.js:330 | "Cancel my bookings": one confirm, then `reset_user`; clears pending changes. |
| `bookingDates()` | calendar-booking.js:351 | Visible dates in order; past dates follow the Show/Hide past dates button. |
| `bookingRankCard(...)` / `bookingRoster(...)` | calendar-booking.js:371 | Booking rows built like normal Best Match cards: `.rank-card` header button (date - slot, summary, View/Hide pill) expanding to `.rank-actions` and a `.roster-inline` (name + booking tag, organiser remove x). Your own bookings get `.bk-card-mine`. |
| `renderBookings()` | calendar-booking.js:495 | Bookings card: "N of M booked", organiser **Close bookings**, then Booked or Mine rows (`buildBookedRow`; Mine = only your own slots, including unsaved: Add / Download / Share (`bookingShareButton()`) / Cancel on your own bookings only, roster) or Free rows (`buildFreeRow`: Free / "N of M left", Book, roster; no Share). Pills use the same `.btn-pill` classes and sizes as Best Match. Respects the 2 / 10 / All limit. |
| `updateBookingClosedBanner()` / `setBookingsClosed(closed)` | calendar-booking.js:552 | "Bookings closed" banner with organiser Reopen; POST `set_bookings_closed`. |
| `startBookingRefresh()` / `refreshBookings()` | calendar-booking.js:602 | Every 30 s and on tab focus: re-reads `bookings_closed` from `calendar_meta` and reloads availability (skipped while saving). |

### Hub membership (calendar page)

| Function | File:Line | Description |
|----------|------|-------------|
| `updateHubBarUI()` | calendar-users.js:468 | Shows Hub breadcrumb link or "Not in a Hub"; organiser add/remove buttons. |
| `extractHubToken(raw)` | calendar-users.js:500 | Parses Hub code or URL from user input for attach modal. |
| `showHubModal()` | calendar-users.js:517 | Opens modal to enter Hub code/link. |
| `hideHubModal()` | calendar-users.js:525 | Closes Hub attach modal. |
| `confirmAddToHub()` | calendar-users.js:529 | POST `add_calendar_to_group` (calendar organiser). |
| `removeFromHub()` | calendar-users.js:552 | POST `remove_calendar_from_group` (calendar organiser). |

### Reset Operations

| Function | File:Line | Description |
|----------|------|-------------|
| `resetMyAvailability()` | calendar-grid.js:658 | Confirmation then API call to delete current user's availability. |
| `resetAllUsers()` | calendar-grid.js:728 | Double confirmation (confirm + type "RESET") then API call. Admin only. |

### Initialisation

| Function | File:Line | Description |
|----------|------|-------------|
| `init()` | calendar-main.js:205 | Main entry point. Loads meta, users, restores session, renders grid and rankings. |

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
| `getRelativeLuminance(hexColor)` | 51 | Same as calendar-core.js -- keep in sync. |
| `getContrastTextColor(bgColor)` | 80 | Same as calendar-core.js -- keep in sync. |
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
| `parseTemplateParams()` | 917 | Reads URL params (title, category, slots, statuses, weights, mode, range, weekends, datefilter, and booking `cap` / `per`) and prefills the form. With `cap`, the first status label becomes the booking label. |
| `showTemplateBanner()` | 1068 | Shows blue "Template loaded!" notification banner. |
| `initHubContext()` | 48 | Reads `?g=` token, fetches `group_meta`, shows Hub banner; sets `hubContext` for `create_calendar`. |
| `getHubTokenFromUrl()` | 44 | Returns Hub token from `?g=` query param. |

### Access emoji (create page)

| Function | Line | Description |
|----------|------|-------------|
| `requireHubAccess()` | 53 | Emoji popup for a guarded Hub when creating inside it (`?g=`); saves the Hub grant. |
| `accessFetch(url, opts)` | 76 | Adds the Hub grant; on 403 `ACCESS_REQUIRED` shows the popup and retries (max 3 tries). Used for `group_meta` and `create_calendar`. |
| `initAccessField(features)` | 91 | Shows the **Access emoji** switch above Privacy Mode when `get_site_config` reports `features.access_emoji`. |
| `updateAccessOffHint()` | 103 | Off-state hint: "Uses the Hub's emoji" when the Hub has one. |
| `calendarSaveKit.emojiLine(meta)` / `buildCopyText(meta)` | 179 | Emoji line added to the copied link, share, email, poster and `.txt`. |

### Booking mode (create page)

| Function | Line | Description |
|----------|------|-------------|
| `updatePrivacyHint()` / `setPrivacyMode(mode)` | 1464 | Privacy hint (booking wording when a limit is set) and programmatic mode change. |
| `makeLimitControl({...})` | 1542 | No limit / 1 / 2 / More segmented control with a 3-20 stepper for More. Used for **People per slot** (`capacityControl`) and **Bookings per person** (`perUserControl`, default 1). |
| `renderPerUserScope()` / `setPerUserTotal(on)` | 1640 | **Per day / In total** toggle (`#perUserScope`) under Bookings per person. Shown only when `features.booking_total` is true and a limit is set; updates the hint and sends `per_user_total: 1` on create. |
| `isBookingMode()` | 1608 | True when People per slot has a limit. |
| `initBookingField(features)` | 1655 | Shows People per slot when `get_site_config` reports `features.booking`; enables the Per day / In total toggle when `features.booking_total`. |
| `applyBookingMode()` | 1622 | Shows Bookings per person (`#perUserField`, Slots section, which also holds the booking label + colour in `#bookingPanel`), hides the Options section (`#optionsSection`) and Blind (switches to Hidden if needed), revalidates. |
| `validateBookingLabel()` | 1634 | Booking label check (same rules as status labels). |

`getValidStatuses()` returns the single booking status (weight 1) in booking mode; `createCalendar()` adds `slot_capacity` / `max_per_user` and passes `booking` to the save panel, where `calendarSaveKit` uses "book a slot" wording in the share text, email, poster tagline and `.txt`.

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
| `emojiLine(meta)` / `buildCopyText(meta)` | 60 | Emoji line (`AccessEmoji.shareLine`) added to the copied link, share, email, poster and `.txt` when the Hub has an emoji. |

### Auth and API

| Function | Line | Description |
|----------|------|-------------|
| `cacheGroupAuth(token, auth)` | 399 | Stores Hub organiser session in localStorage (`wruf_group_auth_{token}`). |
| `getCachedGroupAuth(token)` | 410 | Retrieves valid cached Hub organiser auth. |
| `clearCachedGroupAuth(token)` | 425 | Clears Hub organiser cache on Logout. |
| `authGroup(pin)` | 678 | POST `auth_group`; returns auth token. |
| `removeCalendarFromHub(calToken, btn)` | 755 | POST `remove_calendar_from_group` (Hub organiser). |
| `hubPost(action, body, withAuth)` | 392 | POST helper: adds `?g=`, CSRF and (optionally) `X-Group-Auth-Token`. |

### Fingerprint / face unlock (Hub organiser)

Device memory key: `passkeyId()` = `hub_{hubToken}`.

| Function | Line | Description |
|----------|------|-------------|
| `finishOrganiserLogin(data)` | 781 | Shared success path for PIN and passkey login: caches auth, closes modal, updates organiser UI. |
| `passkeysUsable()` | 799 | True when `group_meta` reports `passkeys` and the browser supports WebAuthn. |
| `unlockWithPasskey()` | 801 | Passkey login for the Hub organiser; falls back to PIN. |
| `maybeOfferPasskey()` | 838 | One-time "Turn on" offer after PIN login. |
| `enrolPasskey(errEl, btn)` | 847 | Registers this device for the Hub organiser (sends `device_label`). |
| `openPasskeyWindow(silent)` | - | Hub version of the one **Passkeys** window, opened from the organiser toolbar **Passkey** button or once after a PIN login. Same two states as the calendar: set up on this device (with passkeys on other devices listed for removal), or manage every device. |

### Access emoji (Hub)

| Function | Line | Description |
|----------|------|-------------|
| `requireHubAccess()` | 417 | Blocking emoji popup; posts `access_check` with `?g=` and saves the Hub grant. |
| `accessFetch(url, opts)` | 443 | Adds `X-Access-Grant`; on 403 `ACCESS_REQUIRED` shows the popup and retries (max 3 tries). Used by `apiGet`, `hubPost`, `authGroup`, `removeCalendarFromHub`. |
| `getHubMeta()` | 704 | Current Hub meta for the toolbar buttons (includes `access_emoji` when the organiser is logged in). |
| `loadHubEmoji()` | 714 | GET `access_settings` after organiser login / auth restore. |
| `openHubSettings()` | 788 | Organiser **Settings** window: emoji on/off/change, POST `set_group_access_emoji`. |
| `initCreateAccessField()` | 1212 | Shows the emoji switch below the PIN on the create form when the feature is available. |

### UI

| Function | Line | Description |
|----------|------|-------------|
| `showSaveHubPanel(meta)` | 440 | Post-create modal: copy, download, share, email, poster, ack checkbox. |
| `createHub()` | 495 | POST `create_group`, then show save panel. |
| `loadHubView()` | 656 | GET `group_meta`, render calendar grid. |
| `updateHubPublicUI()` | 607 | Link bar, copy handlers, Create new calendar link. |
| `updateOrganiserUI()` | 764 | Shows/hides organiser-only Share/Email/Poster/Download/Remove and wires the link bar buttons. |
| `renderCalendarGrid()` | 558 | Lists child calendars with links to `calendar.html?c=`. |

---

## passkey.js (~200 lines)

Shared browser helper loaded by `calendar.html` and `hub.html`. Exposes `window.Passkey`. Converts WebAuthn options/credentials to and from base64url JSON, remembers per-device enrolment in localStorage (`wruf_pk_{id}` = credential ID, `wruf_pk_no_{id}` = "Not now" dismissed), and renders the device list used by both pages.

| Method | Line | Description |
|--------|------|-------------|
| `supported()` | 73 | Browser exposes `PublicKeyCredential` and `navigator.credentials` (only available over HTTPS or localhost). |
| `platformAvailable()` | 78 | Device has a built-in fingerprint / face / screen-lock authenticator. |
| `create(publicKey)` | 87 | Runs `navigator.credentials.create()` and serializes the result for the API. |
| `get(publicKey)` | 93 | Runs `navigator.credentials.get()` and serializes the result for the API. |
| `isCancel(e)` | 100 | True when the user cancelled or the prompt timed out. |
| `isDuplicate(e)` | 105 | True when this device is already registered. |
| `deviceCredential(id)` / `rememberDevice(id, credId)` / `forgetDevice(id)` | 110 | Device-local enrolment memory. |
| `wasDismissed(id)` / `dismiss(id)` | 114 | "Not now" memory for the enrolment offer. |
| `deviceLabel()` | 118 | Short device name from the user agent ("iPhone", "Android phone", "Windows PC", ...), sent as `device_label` on enrolment. |
| `syncDevice(id, credentials)` | 134 | Forgets this device's enrolment if it is no longer in the server list (removed from another device). Returns the remembered credential ID or null. |
| `renderList(listEl, credentials, thisDeviceCredId, onRemove)` | 150 | Fills a `<ul>` with devices (label, "this device" marker, added / last used dates, Remove button). Text only, no innerHTML. |
| `signalRemoved(credentialId)` | 197 | Tells the OS password manager the passkey was removed (where supported). |

---

## emoji.js (~420 lines)

Shared access emoji helper loaded by `index.html`, `calendar.html`, `hub.html` and `admin.html`. Exposes `window.AccessEmoji`. The 35 emoji are `\u{...}` escapes (files stay ASCII); the saved value is the list position, so **never reorder the list**.

| Member | Description |
|--------|-------------|
| `COUNT` / `list` | 35 entries `{e, n}` (glyph, name), 5 columns x 7 rows. |
| `valid(i)` / `glyph(i)` / `name(i)` | Position checks and lookups. |
| `shareLine(i, inherited)` | "Emoji: <glyph> <name>", "Emoji: use the Hub's emoji", or ''. Used in copy / share / email / poster / `.txt`. |
| `renderGrid(container, {selected, onSelect})` | 5-column grid of 44px+ buttons with `aria-label` names. |
| `openPicker({title, hint, confirmLabel, selected})` | Fullscreen picker; resolves with the position or null (Esc / Cancel). |
| `gate({title, hint, submit})` | Blocking popup for visitors with Home and Open buttons; `submit(i)` returns `{ok, message}` (wrong pick / locked text). |
| `field(container, {label, pickerTitle, pickerHint, offHint, onHint, value, onChange})` | On/off switch plus chosen emoji and Change button; returns `{value, set, setOffHint}`. `onChange` may be async and return false to reject. |
| `saveGrant(key, grant, expiresAt)` / `getGrant(key)` / `clearGrant(key)` | Grant storage in localStorage (`wruf_ag_{key}`, e.g. `c_3PNpKJTs`, `g_ab12CD34`) with in-memory fallback. |
| `grantHeader(keys)` | Comma-separated valid grants for `X-Access-Grant` (max 3). |

---

## admin-*.js (4 files, ~2,600 lines)

Admin panel logic, split like the calendar page into classic scripts sharing global scope. `admin.html` loads them after `emoji.js`, in this order:

| File | Contents |
|------|----------|
| `admin-core.js` | Tokens, `apiRequest()`, `formatDate()`, `truncateToken()`, `escapeHtml()`, login / logout, `checkExistingSession()` (runs on `DOMContentLoaded`), `emojiBadge()`, `clearAccessEmoji()`, Escape-key handler, `switchTab()` |
| `admin-calendars.js` | Calendars tab: `loadCalendars()`, filters, sort, `renderTable()`, selection, `handleTogglePermanent()`, `executeDelete()`, bulk delete, pagination, Users expander (`toggleUsersExpand()`, `executeDeleteUser()`) |
| `admin-hubs.js` | Hubs tab: `loadHubs()`, filters, sort, `renderHubTable()`, selection, delete, bulk delete, pagination, calendars expander |
| `admin-setup.js` | Setup tab: `loadSiteConfig()`, slot / option / preset / date editors, `saveConfig()` |

Other details: Access emoji: `emojiBadge(emoji, inherited)` shows the emoji (or the Hub's, faded) next to calendars and Hubs; `clearAccessEmoji(kind, item, btn, rerender)` confirms and posts `admin_set_access_emoji` (key_off button). PIN lockouts: `renderUserPills()` adds an amber Unlock pill for users with `locked_seconds > 0` (`unlockUser()` -> `admin_unlock_user`); `renderHubTable()` adds a lock_open action on locked Hubs (`unlockHub()` -> `admin_unlock_group`); `formatWait(seconds)` matches the API's "5 minutes" / "2 hours" / "2 days" wording.
