# JS Functions Reference

Complete catalogue of JavaScript functions across the When RU Free frontend.

---

## calendar-*.js (6 files, ~4,000 lines)

The calendar page is split into six classic scripts that share global scope (no modules, no build step). `calendar.html` loads them after `passkey.js`, `account-core.js` and `emoji.js`, in this order. A later file may call functions from an earlier one at any time. Top-level code that runs at load (for example `els`, `debouncedRank`, listener wiring) may only use names from its own file or an earlier file. Never declare the same top-level name in two files.

| File | Contents |
|------|----------|
| `calendar-core.js` | Constants, colours, status options, utilities (`qs`, `debounce`, `showToast`), pending queue, autosave, date formatting, `els`, `state`, CSRF, access gate and account errors, `apiGet` / `apiPost` |
| `calendar-users.js` | Meta load, your name on this calendar, users, People modal, submit / user UI, Hub bar, settings modal, join / rename, claim an old name |
| `calendar-grid.js` | Availability fetch, slot status, date filter, grid skeleton, past dates, slot click, save and reset |
| `calendar-rank.js` | Calendar links, share, rank scores, sort / limit toggles, organiser message, chosen slot, Best Match, `debouncedRank` |
| `calendar-booking.js` | Booking mode and booking polling |
| `calendar-main.js` | Event wiring, `init()` on `DOMContentLoaded` (sign-in check first) |

`state.auth` holds at most one entry: your own name on this calendar, `Map([[userId, {token: true, role}]])`. `state.account` is `calendar_meta.account` (`{profile_name, me, claimable}`).

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
| `isCurrentUserOrganiser()` | calendar-core.js:234 | Returns true if your name here has the admin role or matches adminUserId. |
| `shouldShowRoster()` | calendar-core.js:313 | Privacy-gated: returns true if roster details should be visible in rankings (you must have joined). |
| `shouldShowOrganiserDots()` | calendar-core.js:334 | Privacy-gated: returns true if organiser border indicators should show on slots. Open calendars: `state.organiserMarks`; Hidden: true (only the organiser has the rows); Blind and booking: false. |
| `organiserMarksSettingShown()` | calendar-core.js:347 | True when Calendar settings offers the organiser-marks switch: migration 010 ran, Open privacy, not a booking calendar. |
| `canViewUser(u)` | calendar-core.js:358 | True when you can open `u`'s calendar read only from the People list: not yourself, not blocked, not a booking calendar, and `shouldShowRoster()`. |
| `ensureCsrfToken()` | calendar-core.js:736 | Fetches and caches CSRF token. Called before every POST. |
| `applyMe(me)` | calendar-users.js:112 | Sets `state.auth` / `state.currentUserId` from `calendar_meta.account.me` (your name here), or clears them when you have not joined. |
| `promptJoin()` | calendar-users.js:130 | Opens the Join window when you have not joined yet. Used by slot taps, booking taps and banners. |
| `ensureAuthedForUser(userId)` | calendar-users.js:746 | Returns your auth for `userId`, or calls `promptJoin()` and throws. |

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
| `tz()` | calendar-core.js:752 | Returns the browser's IANA timezone string. |
| `escapeHTML(str)` | calendar-rank.js:464 | Escapes a string for safe HTML insertion via textContent. |
| `escapeMessageHTML(str)` | calendar-rank.js:297 | Alias for HTML escaping (used by organiser message). |

### API Communication

| Function | File:Line | Description |
|----------|------|-------------|
| `apiGet(action, params)` | calendar-core.js:815 | GET request to api.php with calendar token. Returns parsed JSON. |
| `apiPost(action, body)` | calendar-core.js:831 | POST request with CSRF. Who you are comes from the account cookie (a third argument is ignored). Returns parsed JSON. |

### Data Loading

| Function | File:Line | Description |
|----------|------|-------------|
| `loadCalendarMeta()` | calendar-users.js:8 | Fetches calendar config, applies slots/statuses/dates/privacy/chosen state, stores `state.account` and calls `applyMe()`. |
| `loadUsers()` | calendar-users.js:144 | Fetches the name list (`mine`, `claimable` flags), sorts admin first, caches adminUserId. Updates the view bar name, or closes the read-only view when that person can no longer be viewed. |
| `ensureRangeLoaded(from, to)` | calendar-grid.js:31 | Fetches availability for a date range if not already loaded. |
| `ensureDateRangeLoaded()` | calendar-grid.js:782 | Loads the full calendar date range. |
| `ensureCalendarLoadedAllDates()` | calendar-main.js:204 | Ensures all dates are loaded after save operations. |

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
| `savePending(isAutosave)` | calendar-grid.js:480 | Sends pending changes to server. Handles NULL status (delete) and positive statuses (upsert). |

### UI State Management

| Function | File:Line | Description |
|----------|------|-------------|
| `updateCurrentUserDisplay()` | calendar-users.js:150 | Updates the user name badge in the header. |
| `updateSubmitButtonState()` | calendar-users.js:310 | Toggles submit button between "Save"/"Saved"/"Saving" states. |
| `setLoading(isLoading, message)` | calendar-users.js:331 | Shows/hides loading overlay. |
| `updateUserUI()` | calendar-users.js:351 | Shows/hides buttons based on whether you joined and your role (Your name button for anyone joined). Hides submit when frozen. |
| `updateSortToggleUI()` | calendar-rank.js:198 | Updates sort toggle active state. Visible for everyone who joined. |
| `updateLimitToggleUI()` | calendar-rank.js:257 | Updates rank limit toggle active state. |
| `updateOrganiserMessageUI()` | calendar-rank.js:308 | Shows/hides organiser message area. Editable for organiser, read-only for others. |

### Calendar Grid

| Function | File:Line | Description |
|----------|------|-------------|
| `renderDateRangeSkeleton()` | calendar-grid.js:228 | Builds the full calendar grid with day columns, headers, and slot elements. |
| `refreshCalendarValues()` | calendar-grid.js:366 | Updates all slot colours and organiser dots for you, or for the person in the read-only view (`state.viewUserId`). |
| `getStatus(userId, dateStr, slotId)` | calendar-grid.js:48 | Returns `{status, pending}` for a user/date/slot, checking pending changes first. |
| `getOrganiserStatus(dateStr, slotId)` | calendar-grid.js:65 | Returns the admin's status for a slot (for organiser dots). |
| `setSlotClass(el, status)` | calendar-grid.js:71 | Applies `status-N` CSS class to a slot element. |
| `updateOrganiserDot(slotEl, dateStr, slotId)` | calendar-grid.js:87 | Applies `org-border-N` CSS class for organiser's left-border indicator. Skipped on the organiser's own answers (yours, or theirs while viewing them). |
| `cycleStatus(current)` | calendar-grid.js:393 | Cycles through statuses: NULL -> 1 -> 2 -> ... -> N -> NULL. |
| `onSlotClick(dateStr, slotId)` | calendar-grid.js:438 | Main slot click handler. Only shows a "Read only" toast while viewing someone, blocks if frozen, calls `promptJoin()` if you have not joined, cycles status. |
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
| `canReopenCalendar()` | calendar-rank.js:408 | True when your name here is the organiser. |
| `updateChosenBanner()` | calendar-rank.js:412 | Renders/removes the green "Decided" banner; Reopen shown when `canReopenCalendar()`. Called from `updateUserUI()`. |
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

### People, Join and Claim

| Function | File:Line | Description |
|----------|------|-------------|
| `updatePeopleBadge()` | calendar-users.js:182 | Count badge (`#peopleBadge`) on the People button for `state.pendingRequests`. |
| `populateUserSelectModal()` | calendar-users.js:230 | People list: your name first with "(you)", organiser Block / Unblock (`block` / `undo` icon) and delete buttons, blocked rows dimmed (avatar and name only) with "Access paused", "Yours from before? Tap to claim it" on old PIN names while you have not joined, and "Tap to see" on people `canViewUser()` allows (the one being viewed shows "Showing their calendar" and a `visibility` icon). When names are private, an intro line says "Names are private on this calendar. N people have joined/booked." Clickable rows get `is-clickable`. |
| `setViewBarText(u)` | calendar-users.js:168 | Sets `#viewBarText` to "Viewing NAME (read only)" (name in bold, via `textContent`). |
| `openUserView(u)` | calendar-users.js:176 | Read-only view of `u`'s calendar: sets `state.viewUserId`, shows `#viewBar`, adds `.is-viewing` to `.calendar-section`, redraws the grid and scrolls to it. |
| `closeUserView()` | calendar-users.js:187 | Back to your own calendar: clears `state.viewUserId`, hides the bar, redraws. Wired to the bar's X and Escape (when no modal is open) in calendar-main.js. |
| `openUserSelectModal()` | calendar-users.js:302 | Shows the People modal and calls `loadPeopleRequests()`. |
| `closeUserSelectModal()` | calendar-users.js | Hides the People modal. |
| `refreshPeopleAndViews()` | calendar-users.js:309 | Reloads users and availability, then redraws the People list, grid and rankings (after block / unblock / delete). |
| `setCalendarUserBlocked(u, blocked, btn)` | calendar-users.js:322 | POST `set_user_blocked`, then `refreshPeopleAndViews()`. Organiser only. |
| `loadPeopleRequests()` | calendar-users.js:343 | Organiser of an Invite only calendar: GET `access_requests` into `#userRequestsWrap`; when `managed_by` is hub, shows a note pointing to the Hub page. |
| `requestRow(req, actions)` / `renderPeopleRequests(lists)` | calendar-users.js:363 / 385 | **Requests (N)** with Approve / Decline and **Approve all**, plus a collapsed **Declined** list with Approve. |
| `decidePeopleRequest(decision, requestId, btn)` | calendar-users.js:433 | POST `decide_access_request`, redraws the lists and badge. |
| `confirmDeleteCalendarUser(userId, displayName)` | calendar-users.js:464 | Confirmation dialog then `delete_user`. Organiser only. |
| `onUserSelectItemClick(userId)` | calendar-users.js:522 | Your own name opens rename; a claimable old name opens `openClaimModal()`; anyone `canViewUser()` allows opens `openUserView()`. |
| `openUserModal(mode)` | calendar-users.js:566 | Join (`'add'`, profile name prefilled, claim hint when old names exist) or rename (`'rename'`, with **Use my profile name**). |
| `closeUserModal()` | calendar-users.js:592 | Closes the join / rename modal. |
| `validateName(name)` | calendar-users.js:593 | Validates a name (1-32 chars, letters, numbers, spaces, `'` and `-`). |
| `validatePin4(s)` | calendar-users.js:599 | Returns true if string is exactly 4 digits (claim modal). |
| `showUserModalError(msg)` | calendar-users.js:602 | Error line in the join / rename modal. |
| `afterMyNameChanged()` | calendar-users.js:613 | Reloads users and refreshes the header, People list and rankings after a join, rename or claim. |
| `becomeUser(user)` | calendar-users.js:626 | Sets `state.auth` / `state.currentUserId` to a name you just joined or claimed, restores pending changes. |
| `saveMyName(useProfile)` | calendar-users.js:634 | POST `join_calendar` (add) or `rename_user` (rename, or `use_profile`). Handles `NAME_TAKEN` / `ALREADY_JOINED`. |
| `openClaimModal(user)` | calendar-users.js:693 | "Claim your old name" window (`#pinModal`): 4-digit PIN, POST `claim_name`, then `becomeUser()`. Shows lockout messages. |
| `wirePinToggle(inputEl, btnEl)` | calendar-users.js:731 | Show/hide toggle for the claim PIN field. |
| `showInfoModal()` | calendar-grid.js:428 | Shows the "Join first" prompt modal. |
| `closeInfoModal()` | calendar-grid.js:434 | Closes the info modal. |

### Access emoji (calendar page)

| Function | File:Line | Description |
|----------|------|-------------|
| `accessHubToken()` | calendar-core.js:757 | Hub token of this calendar (from meta), used to send the Hub grant too. |
| `accessGrantKeys(extraHubToken)` | calendar-core.js:763 | Grant storage keys to send: `c_{calendar}`, `g_{hub}` and an optional extra Hub (for `confirmAddToHub`). |
| `requireAccess(info)` | calendar-core.js:772 | Shows the blocking emoji popup (`AccessEmoji.gate`), posts `access_check` and saves the grant. Resolves false if the user leaves. |
| `accessFetch(url, opts, extraHubToken)` | calendar-core.js:799 | `fetch` wrapper used by `apiGet`, `apiPost` and `postSave`: adds `X-Access-Grant`; on 403 `ACCESS_REQUIRED` clears stale grants, shows the popup and retries (max 3 tries). On 401/403 account, `INVITE_ONLY` or `BLOCKED` errors it hands over to `Account.handleApiError()` and never resolves (the page shows sign-in or the Invite only panel). |
| `applyAccessSettings(data)` / `loadAccessEmoji()` | calendar-users.js:496 | Organiser only: GET `access_settings` into `accessAvailable`, `accessEmoji`, `accessHubEmoji`. |
| `openSettingsModal()` / `hideSettingsModal()` | calendar-users.js:739 | Organiser **Settings** window (`#settingsModal`, gear `#settingsBtn`, shown when the emoji or the organiser-marks switch is available): **Show my answers on everyone's calendar** (`#settingsMarksField`, when `organiserMarksSettingShown()`), and emoji on/off/change via `AccessEmoji.field`, confirms, then POST `set_access_emoji` and stores the fresh grant. |
| `saveOrganiserMarks(input)` | calendar-users.js:798 | POST `set_organiser_marks` (`on` 1/0) from the settings tick box; sets `state.organiserMarks` and redraws; undoes the tick on error. |

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
| `onBookingSlotClick(dateStr, slotId)` / `setPendingBooking(dateStr, slotId, status)` | calendar-booking.js:214 | Tap: closed check, `promptJoin()` if you have not joined, "This slot is taken", the per-person limit message, else toggles Booked / not booked as a pending change (repaints the cell, Submit state, auto-save). Toggling back to the saved state removes the pending entry. |
| `bookingCardAction(dateStr, slotId)` | calendar-booking.js:251 | Book / Cancel buttons on the Bookings card: the same toggle, saved straight away. |
| `queueBooking(userId, dateStr, slotId, status)` / `sendBooking(...)` | calendar-booking.js:274 | Organiser removal of someone else's booking, one at a time (`bk-busy` on the cell), then reloads availability. `NOT_JOINED` (your name was removed) calls `handleExpiredSession()`: toast "Your name is no longer on this calendar." and reload. |
| `cancelMyBookings(auth)` | calendar-booking.js:324 | "Cancel my bookings": one confirm, then `reset_user`; clears pending changes. |
| `bookingDates()` | calendar-booking.js:345 | Visible dates in order; past dates follow the Show/Hide past dates button. |
| `bookingRankCard(...)` / `bookingRoster(...)` | calendar-booking.js:365 | Booking rows built like normal Best Match cards: `.rank-card` header button (date - slot, summary, View/Hide pill) expanding to `.rank-actions` and a `.roster-inline` (name + booking tag, organiser remove x). Your own bookings get `.bk-card-mine`. |
| `renderBookings()` | calendar-booking.js:489 | Bookings card: "N of M booked", organiser **Close bookings**, then Booked or Mine rows (`buildBookedRow`; Mine = only your own slots, including unsaved: Add / Download / Share (`bookingShareButton()`) / Cancel on your own bookings only, roster) or Free rows (`buildFreeRow`: Free / "N of M left", Book, roster; no Share). Pills use the same `.btn-pill` classes and sizes as Best Match. Respects the 2 / 10 / All limit. |
| `updateBookingClosedBanner()` / `setBookingsClosed(closed)` | calendar-booking.js:546 | "Bookings closed" banner with organiser Reopen; POST `set_bookings_closed`. |
| `startBookingRefresh()` / `refreshBookings()` | calendar-booking.js:596 | Every 30 s and on tab focus: re-reads `bookings_closed` from `calendar_meta` and reloads availability (skipped while saving). |

### Hub membership (calendar page)

| Function | File:Line | Description |
|----------|------|-------------|
| `updateHubBarUI()` | calendar-users.js:394 | Shows Hub breadcrumb link or "Not in a Hub"; organiser add/remove buttons. |
| `extractHubToken(raw)` | calendar-users.js:426 | Parses Hub code or URL from user input for attach modal. |
| `showHubModal()` | calendar-users.js:443 | Opens modal to enter Hub code/link. |
| `hideHubModal()` | calendar-users.js:451 | Closes Hub attach modal. |
| `confirmAddToHub()` | calendar-users.js:455 | POST `add_calendar_to_group` (calendar organiser). |
| `removeFromHub()` | calendar-users.js:478 | POST `remove_calendar_from_group` (calendar organiser). |

### Reset Operations

| Function | File:Line | Description |
|----------|------|-------------|
| `resetMyAvailability()` | calendar-grid.js:650 | Confirmation then API call to delete current user's availability. |
| `resetAllUsers()` | calendar-grid.js:720 | Double confirmation (confirm + type "RESET") then API call. Admin only. |

### Initialisation

| Function | File:Line | Description |
|----------|------|-------------|
| `init()` | calendar-main.js:133 | Main entry point. Validates the token, `await Account.require()`, renders the account badge, loads meta and users, restores your pending changes, renders grid and rankings. Until you join, the join banner shows. |

---

## index.js (~2,100 lines)

### Category UI

| Function | Line | Description |
|----------|------|-------------|
| `getSelectedCategories()` | 12 | Returns array of active category button values. |
| `updateCatUI()` | 19 | Updates counter and disables buttons at CAT_MAX (3). |

### Colour and Contrast (Duplicated)

| Function | Line | Description |
|----------|------|-------------|
| `getRelativeLuminance(hexColor)` | 531 | Same as calendar-core.js -- keep in sync. |
| `getContrastTextColor(bgColor)` | 560 | Same as calendar-core.js -- keep in sync. |
| `applyColorPreview(colorPicker, labelInput)` | 579 | Applies colour picker value as background to status label input. |

### Helpers

| Function | Line | Description |
|----------|------|-------------|
| `ensureCsrfToken()` | 591 | Fetches and caches CSRF token. |
| `normaliseTitle(t)` | 606 | Strips tags, trims, max 80 chars. |
| `normaliseSlotLabel(s)` | 613 | Strips NBSP, trims, max 20 chars. |
| `formatDateDisplay(dateStr)` | 838 | Formats YYYY-MM-DD to "Mar 15, 2026". |
| `daysBetween(start, end)` | 843 | Returns integer day count between two date strings. |
| `getTodayClamped()` | 848 | Returns today's date clamped to MIN_DATE/MAX_DATE. |
| `addDays(dateStr, days)` | 856 | Adds days to a date string, clamped to range. |

### Slots UI

| Function | Line | Description |
|----------|------|-------------|
| `makeSlotRow(initial)` | 871 | Creates a slot input row with delete button and error span. |
| `readSlotsFromUI()` | 933 | Reads all slot input values into an array. |
| `setSlots(slots)` | 937 | Replaces slot rows with given labels. |
| `addSlot(label)` | 943 | Adds a slot row (max 6). |
| `validateSlotsUI()` | 961 | Validates all slots, shows inline errors. |

### Calendar Creation

| Function | Line | Description |
|----------|------|-------------|
| `adminNameValue()` | 1390 | Trimmed optional organiser name (blank = profile name). |
| `validateAdmin()` | 1394 | Organiser name check; passes when blank. |
| `validateAll()` | 1688 | Validates all form fields and enables/disables create button. |
| `createCalendar()` | 1747 | Validates form, sends `create_calendar` (with `admin_name` only when typed), hands account errors to `Account.handleApiError()`, shows the save panel, then goes to the calendar. |

| `guardFormUntilSignedIn(me)` | 2108 | Signed out: capture-phase `click` and `focusin` listeners on `.card` stop any form control and open the closable sign-in panel (`Account.showSignIn(me, {dismissible: true})`). Links and the badge still work; scrolling doesn't trigger it. |

`initPage()` (line 2129) reads `Account.me()`. Signed in, it renders the badge in `#accountBadge` and uses the profile name as the organiser name placeholder. Signed out, the form stays visible with a **Sign in** button (`Account.renderSignInBadge()`) and `guardFormUntilSignedIn()`. Hub links (`?g=`) and unfinished set-up use `await Account.require()` instead.

### Template System

| Function | Line | Description |
|----------|------|-------------|
| `parseTemplateParams()` | 1840 | Reads URL params (title, category, slots, statuses, weights, mode, range, weekends, datefilter, and booking `cap` / `per`) and prefills the form. With `cap`, the first status label becomes the booking label. |
| `showTemplateBanner()` | 2008 | Shows blue "Template loaded!" notification banner. |
| `initHubContext()` | 159 | Reads `?g=` token, fetches `group_meta`, shows Hub banner; sets `hubContext` (including `inviteOnly`) for `create_calendar` and redraws Who can join. |
| `getHubTokenFromUrl()` | 44 | Returns Hub token from `?g=` query param. |

### Access emoji (create page)

| Function | Line | Description |
|----------|------|-------------|
| `requireHubAccess()` | 53 | Emoji popup for a guarded Hub when creating inside it (`?g=`); saves the Hub grant. |
| `accessFetch(url, opts)` | 76 | Adds the Hub grant; on 403 `ACCESS_REQUIRED` shows the popup and retries (max 3 tries); account errors go to `Account.handleApiError()`. Used for `group_meta` and `create_calendar`. |
| `initAccessField(features)` | 93 | Shows the **Access emoji** switch above Privacy Mode when `get_site_config` reports `features.access_emoji`. |
| `updateAccessOffHint()` | 106 | Off-state hint: "Uses the Hub's emoji" when the Hub has one; on Invite only the on-state hint says the emoji is asked before people request access. |

### Who can join and private names (create page)

| Function | Line | Description |
|----------|------|-------------|
| `isInviteOnly()` | 127 | True when **Invite only** is picked, or the calendar is being created in an Invite only Hub. |
| `renderJoinMode()` | 131 | Draws the **Who can join** toggle (`#joinModeToggle`, hint `#joinModeHint`), or the `#joinModeHubNote` note instead inside an Invite only Hub. |
| `initJoinModeField(features)` | 145 | Shows Who can join when `get_site_config` reports `features.invite_only`. |
| `updateHideNamesRow()` / `hideNamesValue()` | 1491 / 1497 | **Hide names too** checkbox (`#hideNamesRow`), shown only for Hidden privacy; sends `hide_names: 1`. Template param `names=hidden`. |

`createCalendar()` sends `invite_only` / `hide_names`; the save panel (`#saveCalInvite`), details text and poster add an "Invite only" line.
| `calendarSaveKit.emojiLine(meta)` / `buildCopyText(meta)` | 182 | Emoji line added to the copied link, share, email, poster and `.txt`. |

### Booking mode (create page)

| Function | Line | Description |
|----------|------|-------------|
| `updatePrivacyHint()` / `setPrivacyMode(mode)` | 1432 | Privacy hint (booking wording when a limit is set) and programmatic mode change. |
| `makeLimitControl({...})` | 1516 | No limit / 1 / 2 / More segmented control with a 3-20 stepper for More. Used for **People per slot** (`capacityControl`) and **Bookings per person** (`perUserControl`, default 1). |
| `renderPerUserScope()` / `setPerUserTotal(on)` | 1593 | **Per day / In total** toggle (`#perUserScope`) under Bookings per person. Shown only when `features.booking_total` is true and a limit is set; updates the hint and sends `per_user_total: 1` on create. |
| `isBookingMode()` | 1613 | True when People per slot has a limit. |
| `initBookingField(features)` | 1621 | Shows People per slot when `get_site_config` reports `features.booking`; enables the Per day / In total toggle when `features.booking_total`. |
| `applyBookingMode()` | 1632 | Shows Bookings per person (`#perUserField`, Slots section, which also holds the booking label + colour in `#bookingPanel`), hides the Options section (`#optionsSection`) and Blind (switches to Hidden if needed), revalidates. |
| `validateBookingLabel()` | 1661 | Booking label check (same rules as status labels). |

`getValidStatuses()` returns the single booking status (weight 1) in booking mode; `createCalendar()` adds `slot_capacity` / `max_per_user` and passes `booking` to the save panel, where `calendarSaveKit` uses "book a slot" wording in the share text, email, poster tagline and `.txt`.

---

## hub.js (~960 lines)

Hub create/view page. Uses `hubSaveKit` object for copy, share, email, download, and poster output. Organiser status comes from `group_meta.is_organiser` (the signed-in account); there are no Hub PINs except to claim an old Hub.

### URL and state

| Function | Line | Description |
|----------|------|-------------|
| `getGroupTokenFromUrl()` | 12 | Returns Hub token from `?g=` query param. |
| `isCreateMode()` | 16 | True when `?create=1` (show create form). |
| `toPlainAscii(str)` | 20 | Strips smart punctuation for plain-text share/download output. |

`state` = `{token, title, auth: {organiser_name} | null, claimable, organiserName, calendars, accessAvailable, accessField, hubEmoji, inviteOnly, joinMode}`.

### hubSaveKit (save panel and link bar)

| Method | Line | Description |
|--------|------|-------------|
| `buildHubUrl(token)` | 35 | Full Hub URL for sharing. |
| `emojiLine(meta)` / `buildCopyText(meta)` | 57 | Emoji line (`AccessEmoji.shareLine`) added to the copied link, share, email, poster and `.txt` when the Hub has an emoji. |
| `buildHubDetailsText(meta)` | 68 | Plain-text block for clipboard and `.txt` download. |
| `copyHubUrl(url)` | 107 | Copies Hub link to clipboard. |
| `copyHubCode(token)` | 117 | Copies Hub code only. |
| `emailHubLink(meta)` | 151 | Opens mailto with Hub details. |
| `shareHubLink(meta)` | 156 | Web Share API or clipboard fallback. |
| `openHubPosterPopup(meta)` | 386 | Opens printable poster in new window (Blob URL). |

### API and organiser

| Function | Line | Description |
|----------|------|-------------|
| `accessFetch(url, opts)` | 456 | Adds `X-Access-Grant`; on 403 `ACCESS_REQUIRED` shows the emoji popup and retries (max 3 tries); account errors go to `Account.handleApiError()`. |
| `apiGet(action, params)` | 472 | GET helper with `?g=`. |
| `hubPost(action, body)` | 481 | POST helper: adds `?g=` and CSRF. |
| `removeCalendarFromHub(calToken, btn)` | 860 | POST `remove_calendar_from_group` (Hub organiser). |
| `showPinModal()` / `hidePinModal()` / `setPinVisible(visible)` | 816 | "Claim this Hub" window (`#pinModal`) for an old Hub. |
| `confirmClaimHub()` | 835 | POST `claim_hub` with the old organiser PIN; on success the account becomes organiser and `loadHubView()` / `loadHubEmoji()` refresh the page. |

### Access emoji (Hub)

| Function | Line | Description |
|----------|------|-------------|
| `requireHubAccess()` | 427 | Blocking emoji popup; posts `access_check` with `?g=` and saves the Hub grant. |
| `getHubMeta()` | 669 | Current Hub meta for the toolbar buttons (includes `access_emoji` for the organiser). |
| `loadHubEmoji()` | 679 | GET `access_settings` when you are the organiser. |
| `openHubSettings()` | 741 | Organiser **Settings** window: emoji on/off/change, POST `set_group_access_emoji`. |
| `initCreateAccessField()` | 1066 | Shows the emoji switch, and **Who can join** when `features.invite_only`, on the create form. |
| `renderHubJoinMode()` | 1051 | Draws the Direct link / Invite only toggle (`#hubJoinField`) and its hint. |

### Invite only (Hub organiser)

| Function | Line | Description |
|----------|------|-------------|
| `formatRequestDate(s)` | 826 | Short date for request rows. |
| `peopleRow(req, actions, extraClass)` | 832 | One person row with action buttons (44px). |
| `renderHubPeople(lists)` | 861 | `#hubPeopleCard`: **Requests** (with count and **Approve all**), **Approved** (Block), and a collapsed **Declined** list (Approve); Hub-blocked people are listed under Approved with Unblock. |
| `loadHubPeople()` | 897 | Organiser of an Invite only Hub: GET `access_requests`. |
| `decideHubRequest(req, action, btn)` | 913 | POST `decide_access_request` (approve / decline / block / unblock), then redraws. |

### UI

| Function | Line | Description |
|----------|------|-------------|
| `showSaveHubPanel(meta)` | 514 | Post-create modal: copy, download, share, email, poster, ack checkbox. |
| `createHub()` | 568 | POST `create_group` (optional `organiser_name`, `invite_only`), then show save panel (with the Invite only line `#saveHubInvite`). |
| `renderCalendarGrid()` | 627 | Lists child calendars with links to `calendar.html?c=`. |
| `updateHubPublicUI()` | 690 | Link bar, copy handlers, Create new calendar link. |
| `updateOrganiserUI()` | 714 | "Organiser: X (you)" badge, organiser-only Share/Email/Poster/Download/Settings/Remove, and the **Claim this Hub** button for old Hubs. |
| `loadHubView()` | 793 | GET `group_meta`, sets `organiserName`, `auth` (from `is_organiser`), `claimable` and `inviteOnly` (badge in the title), renders the calendar grid, then `loadHubPeople()`. |
| `initViewMode()` | 892 | `Account.require()`, account badge, then `loadHubView()`. |
| `initCreateMode()` | 918 | `Account.require()`, account badge, profile name as the organiser name placeholder. |
| `init()` | 946 | Picks create or view mode on `DOMContentLoaded`. |

---

## account-core.js (~335 lines)

Loaded on every page after `passkey.js`. Exposes `window.Account`. Builds everything with `textContent` (no innerHTML).

| Member | Line | Description |
|--------|------|-------------|
| `brandLogo(provider)` | 63 | Inline SVG of the standard-colour Google "G" or the Facebook "f" (class `acct-logo`, 20px). No external requests. |
| `googleButton(label, onClick)` | 84 | Google's official "Sign in with Google" HTML button markup (`gsi-material-button`, styled in `account.css` from Google's branding configurator). Don't restyle it: Google app verification checks it. |
| `me(force)` | 132 | Cached `account_me` promise. |
| `startOAuth(provider, mode)` | 143 | Navigates to `oauth_start` with the current page as `return` (`mode=link` to add to the signed-in account). |
| `passkeyLogin(statusEl)` | 154 | `account_passkey_login_begin` -> device prompt -> `account_passkey_login_finish`; forgets the passkey on the device on `NO_PASSKEY`. |
| `passkeySignup(statusEl)` | 172 | `account_passkey_signup_begin` -> create a passkey -> `account_passkey_signup_finish` (with `device_label`), then setup. |
| `renderSignInButtons(methods)` | 192 | **Continue with Google** (`googleButton`) / **Continue with Facebook** (when on in `config.php`), **Sign in with a passkey** and **New here? Create an account with a passkey**. All share Google's layout: icon 12px from the left, label centred. |
| `showSignIn(info, opts)` | 223 | Full-screen sign-in panel that cannot be dismissed. With `opts.dismissible` (home page while signed out) it gets a lighter backdrop and closes with the X button, Escape or a tap outside. |
| `require()` | 251 | Resolves with `account_me` once signed in and set up; otherwise shows the sign-in panel or goes to `account.html` to finish setup, and never resolves. |
| `pageTarget()` | 260 | `{c}` or `{g}` from the page URL, for Request access calls. |
| `showInvite(invite)` | 284 | Invite only panel (`#acctInvite`, cannot be dismissed). States: none (**Request access**), pending (**Check again** / **Cancel request**), declined (Not approved), blocked (Access paused). Links to Home, Your profile and FAQs. |
| `handleApiError(data)` | 353 | For `ACCOUNT_REQUIRED` / `ACCOUNT_SETUP` responses from any call: shows sign-in or goes to setup; for `INVITE_ONLY` / `BLOCKED` shows `showInvite()`. Returns true when handled. |
| `takeSigninResult()` | 274 | Reads and strips `?signin=` after a Google / Facebook redirect (messages in `SIGNIN_MESSAGES`). |
| `toast(message)` | 287 | Small notice for sign-in results. |
| `renderBadge(info, parent)` | 413 | Account badge link (profile name) to `account.html`. |
| `renderSignInBadge(parent, onClick)` | 423 | Signed-out **Sign in** button in the badge spot (`acct-badge acct-badge-signin`, `login` icon). |
| `logout()` | 303 | POST `account_logout`. |

## account.js (~340 lines)

Profile page (`account.html`).

| Function | Line | Description |
|----------|------|-------------|
| `saveProfile(form, errorEl, body)` | 83 | POST `account_update`; reports `renamed` / `conflicts`. |
| `initSetup()` | 99 | First-time setup form: username + profile name, then back to the page the person came from. |
| `initProfile()` | 117 | Profile form (name and private username). |
| `tag(text, extraClass)` / `pendingTag(n)` | 72 / 80 | Small labels on list rows; `pendingTag` shows "N requests waiting". |
| `loadMemberships()` | 149 | GET `account_memberships`: calendars (role, name, Hub, "Access paused", requests waiting) and Hubs (organiser or opened, requests waiting). |
| `renderWaiting(requests)` | 191 | **Waiting for approval** section (`#waitingSection`): your pending and declined Invite only requests. |
| `renderMethods(methods)` / `loadMethods()` | 182 / 204 | **Ways to sign in** list with Remove (disabled when only one is left), then redraws the Add buttons. |
| `removeMethod(m, btn)` | 210 | POST `account_remove_method`. |
| `addPasskey()` | 225 | `account_passkey_add_begin` -> create -> `account_passkey_add_finish`; "already has a passkey" when the device refuses a duplicate. |
| `renderAddButtons(linked)` | 243 | **Add sign-in with Google** / **Add sign-in with Facebook** (`oauth_start` with `mode=link`), each hidden when already in `linked`; **Add a passkey on this device** always. |
| `initSignOutAndDelete()` | 267 | Sign out; delete account (GET `account_delete_preview`, type the username, POST `account_delete`). |
| `init()` | 317 | Handles `?signin=`, then setup or profile. |

---

## passkey.js (~95 lines)

Browser helper loaded by every page before `account-core.js`. Exposes `window.Passkey`. Converts WebAuthn options/credentials to and from base64url JSON.

| Method | Description |
|--------|-------------|
| `supported()` | Browser exposes `PublicKeyCredential` and `navigator.credentials` (only available over HTTPS or localhost). |
| `create(publicKey)` | Runs `navigator.credentials.create()` and serializes the result for the API. |
| `get(publicKey)` | Runs `navigator.credentials.get()` and serializes the result for the API. |
| `isCancel(e)` | True when the user cancelled or the prompt timed out. |
| `isDuplicate(e)` | True when this device already has a passkey for the account. |
| `deviceLabel()` | Short device name from the user agent ("iPhone", "Android phone", "Windows PC", ...), sent as `device_label` on enrolment. |
| `signalRemoved(credentialId)` | Tells the OS password manager the passkey is no longer accepted (where supported). |

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
| `field(container, {label, pickerTitle, pickerHint, offHint, onHint, value, onChange})` | On/off switch plus chosen emoji and Change button; returns `{value, set, setOffHint, setOnHint}`. `onChange` may be async and return false to reject. |
| `saveGrant(key, grant, expiresAt)` / `getGrant(key)` / `clearGrant(key)` | Grant storage in localStorage (`wruf_ag_{key}`, e.g. `c_3PNpKJTs`, `g_ab12CD34`) with in-memory fallback. |
| `grantHeader(keys)` | Comma-separated valid grants for `X-Access-Grant` (max 3). |

---

## admin-*.js (5 files, ~2,700 lines)

Admin panel logic, split like the calendar page into classic scripts sharing global scope. `admin.html` loads them after `emoji.js`, in this order:

| File | Contents |
|------|----------|
| `admin-core.js` | Tokens, `apiRequest(action, method, body, params)`, `formatDate()`, `truncateToken()`, `escapeHtml()`, password login (`handleLogin()`), account login (`handleAccountLogin(silent)`, POST `admin_login_account`), `startAdminSession()`, logout (stops the automatic account login for the tab), `checkExistingSession()` (runs on `DOMContentLoaded`; tries the account login silently when there is no admin token), `emojiBadge()`, `inviteBadge(inviteOnly, pending)` (Invite only badge with the waiting count), `clearAccessEmoji()`, Escape-key handler, `switchTab()` (loads Accounts the first time its tab opens) |
| `admin-calendars.js` | Calendars tab: `loadCalendars()`, filters, sort, `renderTable()`, selection, `handleTogglePermanent()`, `executeDelete()`, bulk delete, pagination, Users expander (`toggleUsersExpand()`, `executeDeleteUser()`) |
| `admin-hubs.js` | Hubs tab: `loadHubs()`, filters, sort, `renderHubTable()`, selection, delete, bulk delete, pagination, calendars expander |
| `admin-accounts.js` | Accounts tab: `loadAccounts()` (GET `admin_accounts`, optional `q` username prefix, debounced search), `renderAccountStats()` (Google / Facebook / passkey on or off, totals, unclaimed old names and Hubs), `renderAccountTable()`, `deleteAdminAccount()` (type the username, or DELETE for an account without one; POST `admin_delete_account`), `calendarsNeedReload()` |
| `admin-setup.js` | Setup tab: `loadSiteConfig()`, slot / option / preset / date editors, `saveConfig()` |

Other details: Access emoji: `emojiBadge(emoji, inherited)` shows the emoji (or the Hub's, faded) next to calendars and Hubs; `clearAccessEmoji(kind, item, btn, rerender)` confirms and posts `admin_set_access_emoji` (key_off button). Old names: `renderUserPills()` marks names without an account with a dashed border and " - not claimed", and paused people with " - Blocked". Claim lockouts: `renderUserPills()` adds an amber Unlock pill for users with `locked_seconds > 0` (`unlockUser()` -> `admin_unlock_user`); `renderHubTable()` adds a lock_open action on locked Hubs (`unlockHub()` -> `admin_unlock_group`); `formatWait(seconds)` matches the API's "5 minutes" / "2 hours" / "2 days" wording.
