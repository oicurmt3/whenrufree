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
| `canReopenCalendar()` | 2870 | True when the selected user is the organiser and has a valid session. |
| `updateChosenBanner()` | 2874 | Renders/removes the green "Decided" banner; Reopen shown when `canReopenCalendar()`. Called from `updateUserUI()`, so it follows login / logout / name switches. |
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

### Fingerprint / face unlock (calendar page)

Device memory key: `passkeyId(userId)` = `cal_{calendarToken}_{userId}` (see `passkey.js`).

| Function | Line | Description |
|----------|------|-------------|
| `finishUnlock(userId, res)` | 1993 | Shared success path for PIN and passkey login: caches auth, sets current user, refreshes UI. |
| `passkeyId(userId)` | 2014 | Device-local id for this calendar user. |
| `passkeysUsable()` | 2015 | True when server reports `passkeys` and the browser supports WebAuthn. |
| `unlockWithPasskey(userId)` | 2017 | `passkey_login_begin` -> device prompt -> `passkey_login_finish`. Falls back to PIN on cancel / error; forgets device on `NO_PASSKEY`. |
| `maybeOfferPasskey(userId)` | 2048 | After PIN login or add-name, shows the "Turn on" offer once (skipped if enrolled, dismissed, or no platform authenticator). |
| `enrolPasskey(userId, errorEl, btn)` | 2068 | `passkey_register_begin` -> device prompt -> `passkey_register_finish` (sends `device_label`); remembers the device. |
| `openPasskeyWindow(userId, silent)` | - | The one **Passkeys** window (`#passkeyModal`), opened from the fingerprint icon in the user list or once after a PIN login (`maybeOfferPasskey`, `silent` = no list errors). No passkey on this device: "Set up a passkey?" (Not now / Set up passkey) plus "Passkeys on other devices" with Remove, if any. This device has one: full device list with Remove (`passkey_remove`) and Close. "Not now" records the dismissal. |

### Access emoji (calendar page)

| Function | Line | Description |
|----------|------|-------------|
| `accessHubToken()` | 764 | Hub token of this calendar (from meta), used to send the Hub grant too. |
| `accessGrantKeys(extraHubToken)` | 770 | Grant storage keys to send: `c_{calendar}`, `g_{hub}` and an optional extra Hub (for `confirmAddToHub`). |
| `requireAccess(info)` | 779 | Shows the blocking emoji popup (`AccessEmoji.gate`), posts `access_check` and saves the grant. Resolves false if the user leaves. |
| `accessFetch(url, opts, extraHubToken)` | 806 | `fetch` wrapper used by `apiGet`, `apiPost` and `postSave`: adds `X-Access-Grant`; on 403 `ACCESS_REQUIRED` clears stale grants, shows the popup and retries (max 3 tries). |
| `loadAccessEmoji()` / `applyAccessSettings(data)` | 1456 | Organiser only: GET `access_settings` into `accessAvailable`, `accessEmoji`, `accessHubEmoji`. |
| `openSettingsModal()` / `hideSettingsModal()` | 1464 | Organiser **Settings** window (`#settingsModal`, gear `#settingsBtn`): emoji on/off/change via `AccessEmoji.field`, confirms, then POST `set_access_emoji` and stores the fresh grant. |

The header Share button adds `AccessEmoji.shareLine()` under the link when an emoji is set.

### Booking mode (calendar page)

Active when `calendar_meta` has `slot_capacity` (`state.booking = {capacity, perUser, closed}`). `renderRankings()`, `refreshCalendarValues()`, `onSlotClick()`, `renderLegend()`, `updateChosenBanner()` and `resetMyAvailability()` hand over to these; organiser dots are off. Taps are normal pending changes (Submit, auto-save, restore after reload); `savePending()` drops the server's `rejected` slots (toast "Just taken by someone else" / limit), handles `BOOKINGS_CLOSED` (`handleBookingsClosedOnSave()`), then reloads availability.

| Function | Line | Description |
|----------|------|-------------|
| `isBookingMode()` / `isBookingClosed()` | 3453 | Booking calendar? Bookings closed? |
| `currentBookingView()` | 3491 | `'booked'`, `'mine'` or `'free'` list. Organiser: Booked / Free; everyone else: Mine / Free. Always opens on Booked / Mine; only an explicit Free choice sticks, anything else maps to the role's first button. |
| `setBookingViewButton(btn, mode, icon, label)` | 3510 | Sets a `#sortToggle` button's mode, icon and label (text only, no HTML). `updateSortToggleUI()` labels the first button Booked (organiser) or "Mine (N)" / "Mine (N of M)" (In total limit) on every render. |
| `applyBookingChrome()` | 3500 | Page title, name banner text, "Cancel my bookings" titles; list limit 2. |
| `applyBookingColors(partial, full)` | 3503 | Sets `--bk-partial` / `--bk-full` (and `-text` contrast colours via `getContrastTextColor()`) from `calendar_meta`; `null` keeps the CSS defaults (orange / red). |
| `bookingStateName(name, fallback)` | 3509 | Organiser's Partly booked / Full name from `calendar_meta`, or the default. |
| `renderBookingLegend()` | 3525 | Legend: Free / Yours / (partly booked name when capacity is 2+) / full name (`state.booking.partialLabel` / `fullLabel`). |
| `bookingInfo(dateStr, slotId)` | 3517 | `{ids, mine, count, left, full}` for a slot, including your unsaved change. Others are the larger of the known rows and the anonymous summary (minus your saved booking), so it works in Hidden mode too. |
| `bookingCellText(info)` / `renderBookingCell(el, dateStr, slot)` / `refreshBookingCells()` | 3534 | Cell sub-line (your booking shows the booking label, e.g. "Booked", on the booking colour / Free / the booking label when taken) and classes `bk-mine`, `bk-partial`, `bk-full`. Slots for 2+ people start the sub-line with a `.bk-count` "N/M" (people booked so far / people per slot), then the label, Free, "booked" or Full. Cells never show names (no room); names are on the Bookings card. |
| `myBookingCount(dateStr)` / `myTotalBookingCount(withPending)` | 3575 | Your bookings that count towards Bookings per person, saved plus unsaved: that day's, or all of them when `state.booking.perUserTotal` / all your bookings (saved only for "Cancel my bookings"; `withPending` adds unsaved changes). |
| `onBookingSlotClick(dateStr, slotId)` / `setPendingBooking(dateStr, slotId, status)` | 3597 | Tap: closed / pick a name / unlock checks, "This slot is taken", the per-person limit message, else toggles Booked / not booked as a pending change (repaints the cell, Submit state, auto-save). Toggling back to the saved state removes the pending entry. |
| `bookingCardAction(dateStr, slotId)` | 3638 | Book / Cancel buttons on the Bookings card: the same toggle, saved straight away. |
| `queueBooking(userId, dateStr, slotId, status)` / `sendBooking(...)` | 3661 | Organiser removal of someone else's booking, one at a time (`bk-busy` on the cell), then reloads availability. An expired session reopens the PIN window (`handleExpiredSession()`). |
| `cancelMyBookings(auth)` | 3713 | "Cancel my bookings": one confirm, then `reset_user`; clears pending changes. |
| `bookingDates()` | 3734 | Visible dates in order; past dates follow the Show/Hide past dates button. |
| `bookingRankCard(...)` / `bookingRoster(...)` | 3754 | Booking rows built like normal Best Match cards: `.rank-card` header button (date - slot, summary, View/Hide pill) expanding to `.rank-actions` and a `.roster-inline` (name + booking tag, organiser remove x). Your own bookings get `.bk-card-mine`. |
| `renderBookings()` | 3866 | Bookings card: "N of M booked", organiser **Close bookings**, then Booked or Mine rows (`buildBookedRow`; Mine = only your own slots, including unsaved: Add / Download / Share (`bookingShareButton()`) / Cancel on your own bookings only, roster) or Free rows (`buildFreeRow`: Free / "N of M left", Book, roster; no Share). Pills use the same `.btn-pill` classes and sizes as Best Match. Respects the 2 / 10 / All limit. |
| `updateBookingClosedBanner()` / `setBookingsClosed(closed)` | 3918 | "Bookings closed" banner with organiser Reopen; POST `set_bookings_closed`. |
| `startBookingRefresh()` / `refreshBookings()` | 3968 | Every 30 s and on tab focus: re-reads `bookings_closed` from `calendar_meta` and reloads availability (skipped while saving). |

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
| `updateOrganiserUI()` | 631 | Shows/hides organiser-only Share/Email/Download/Remove. |
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

## admin.js (~1,070 lines)

Admin panel logic. Access emoji: `emojiBadge(emoji, inherited)` shows the emoji (or the Hub's, faded) next to calendars and Hubs; `clearAccessEmoji(kind, item, btn, rerender)` confirms and posts `admin_set_access_emoji` (key_off button). Not documented in detail here as it is a separate internal tool. Key functions: `loadCalendars()`, `renderCalendarList()`, `deleteCalendar()`, `togglePermanent()`, `loadUsers()`, `deleteUser()`. PIN lockouts: `renderUserPills()` adds an amber Unlock pill for users with `locked_seconds > 0` (`unlockUser()` -> `admin_unlock_user`); `renderHubTable()` adds a lock_open action on locked Hubs (`unlockHub()` -> `admin_unlock_group`); `formatWait(seconds)` matches the API's "5 minutes" / "2 hours" / "2 days" wording.
