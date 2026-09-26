# Changelog

All notable changes to When RU Free, in reverse chronological order.

---

## 2026-09-26

### Added
- **Booking mode:** a calendar can limit how many people take each slot, first come, first served (like a booking form).
  - Create page, Slots section: **People per slot** - No limit (default, normal availability poll) / 1 / 2 / More (stepper 3-20). With a limit, **Bookings per person** appears below it - how many slots each person can book in total across the whole calendar: No limit / 1 (default) / 2 / More
  - With a limit, the Options section is hidden and a **Booking label** (default "Booked") with a colour appears under Bookings per person. No weights or Score Method. Blind privacy is hidden (Open: everyone sees who booked; Hidden: only the organiser sees names)
  - Calendar page: taps save straight away (no Submit). Cells show Free / You (with a check) / "N left" / Full (grey, hatched) and names when privacy allows. Tapping your own slot asks "Cancel this booking?"; a full slot says "This slot is taken"; at the per-person limit: "You can book 1 slot in total - cancel it to pick another."
  - **Bookings** card replaces Best Match: "N of M booked", a Booked / Free toggle (organiser defaults to Booked, others to Free), date order, Cancel on your own bookings, Add to Google Calendar, Book on free slots, and a per-person Remove for the organiser. The 2 / 10 / All limit stays (default 10)
  - Organiser **Close bookings** (replaces Choose / Reopen): a "Bookings closed" banner with Reopen; participants can no longer book or cancel, the organiser can still remove bookings
  - The grid refreshes on tab focus and every 30 seconds. "Reset my availability" becomes "Cancel my bookings"
  - Server: each booking save locks the calendar row (`SELECT ... FOR UPDATE`), checks the day is in range and the slot exists, runs cancellations before bookings, enforces capacity and the per-person limit (organiser exempt from the per-person limit) and returns `rejected` slots ("Just taken by someone else")
  - "Book a slot" wording in the share text, email, poster and .txt file; "Booking" tag in the Hub list and admin panel
  - Template links: `cap=` (people per slot) and `per=` (bookings per person in total, 0 = no limit)
  - Templates page (`ideas.html`): new **Interview / Appointment Slots** and **Class / Workshop Sign-up** booking templates; **Gym / Facility Booking**, **Holiday House Bookings**, **Shared Car Booking** and **Meeting Room Booking** are now real booking forms (1 per slot, single "Booked" option). Cards with "People per slot" / "Bookings per person" rows get `cap` / `per` in their Use This Template link
  - New columns `calendars.slot_capacity`, `max_per_user`, `bookings_closed`. Migration: `migrations/004_booking.sql` (option hidden until it runs)
  - API: `slot_capacity` / `max_per_user` on `create_calendar`; booking fields on `calendar_meta`; `slot_capacity` on `group_meta` calendars and `admin_calendars`; `rejected` on `save`; new `set_bookings_closed`; `features.booking` on `get_site_config`. New file `includes/booking.php`
  - Security events: `BOOKINGS_CLOSED`, `BOOKINGS_REOPENED`
- **Access emoji:** an optional second barrier on top of the secret link. The organiser picks 1 of 35 emoji (5 columns x 7 rows); anyone opening the calendar or Hub must pick the same emoji first.
  - Create page: **Access emoji** switch above Privacy Mode opens a fullscreen picker. Hub create form: the same switch below the PIN
  - A calendar in a Hub uses the Hub's emoji unless it has its own; a right pick on the Hub opens all its calendars
  - Organiser **Settings** (gear) window on the calendar and the Hub to turn the emoji on, change it or turn it off. Changing or removing it signs out every browser that had access
  - The emoji is included in the copied link text, share, email, poster and .txt file on both save panels and in the organiser Share / toolbar buttons
  - Throttling: 3 wrong picks lock that IP out of that calendar/Hub for 5 minutes, then 15 minutes, 2 hours, 2 days; max 20 wrong picks and 30 unknown calendar/Hub codes per IP per hour
  - The right pick gives the browser a 30-day grant (stored as a SHA-256 hash, sent in `X-Access-Grant`); the emoji itself never reaches visitors, and link previews for guarded calendars show no title
  - Admin panel shows an emoji badge and a **Remove emoji** button (key_off) for calendars and Hubs
  - New columns `calendars.access_emoji`, `groups.access_emoji`; new tables `access_grants`, `access_attempts`. Migration: `migrations/003_access_emoji.sql` (feature hidden until it runs)
  - API: `access_check`, `access_settings`, `set_access_emoji`, `set_group_access_emoji`, `admin_set_access_emoji`; `access_emoji` on `create_calendar` / `create_group`; `access` on `calendar_meta` / `group_meta`; `features.access_emoji` on `get_site_config`
  - New files: `includes/access.php`, `emoji.js`, `emoji.css`; optional config `access_emoji`; `cleanup.php` step 9
  - Security events: `ACCESS_FAILED`, `ACCESS_LOCKED`, `ACCESS_GRANTED`, `ACCESS_EMOJI_CHANGED`, `ADMIN_ACCESS_EMOJI_CLEARED`, `NOT_FOUND_THROTTLED`
- **Fingerprint / face unlock (passkeys):** Calendar users, calendar organisers and Hub organisers can unlock with their device's fingerprint, face or screen lock. The 4-digit PIN stays as the backup.
  - After a successful PIN login (or adding your name), the app offers "Turn on" once per device; "Not now" is remembered on that device
  - PIN modal shows a "Use Passkey" button (fingerprint / face / pattern icons, full description in `aria-label`) on enrolled devices; the device prompt opens only when that button is pressed (never automatically)
  - One **Passkeys** window (calendar: fingerprint icon next to your name; Hub: organiser **Passkey** button; also opens once after a PIN login). On a device without a passkey it shows "Set up a passkey?" (fingerprint / face / pattern icons, Touch ID / Face ID / Windows Hello / phone PIN or pattern, **Not now** / **Set up passkey**) plus any passkeys on other devices with **Remove**. Once this device has one it lists every device with its name and added / last used dates, each removable (e.g. a lost phone)
  - User-facing wording uses "Passkey" throughout (buttons, window titles, messages), with "fingerprint, face or screen lock" as the explanation
  - New tables: `user_passkeys`, `group_passkeys` (FK cascade, `device_label`). Migration: `migrations/001_passkeys.sql`
  - API: `passkey_register_begin`, `passkey_register_finish`, `passkey_login_begin`, `passkey_login_finish`, `passkey_list`, `passkey_remove`; `calendar_meta` and `group_meta` report `passkeys`
  - New files: `includes/webauthn.php` (dependency-free WebAuthn verifier, ES256 + RS256), `includes/.htaccess`, `passkey.js`
  - Optional config: `webauthn.rp_id`, `webauthn.origin`
  - Security events: `PASSKEY_ADDED`, `PASSKEY_LOGIN`, `PASSKEY_REMOVED`, `PASSKEY_COUNTER_REPLAY`
- **Escalating PIN lockout** (calendar users, organisers and Hub organisers): 5 wrong PINs in a row lock for 5 minutes, then 15 minutes, then 2 hours, then 2 days (repeats). Replaces the flat 15-minute lock.
  - The 5th wrong PIN now says straight away how long the lock lasts ("Too many wrong PINs. This name is locked for 15 minutes."); while locked: "Try again in 2 hours."
  - Escalation resets on a correct PIN, a passkey login, a super admin Unlock, or after 30 days without a lockout (`cleanup.php` step 8)
  - Admin panel: amber **Unlock** pill on locked users; lock_open button on locked Hubs. API: `admin_unlock_user`, `admin_unlock_group`; `admin_list_users` and `admin_groups` report `locked_seconds`
  - New columns `lockout_level`, `last_locked_at` on `users` and `groups`. Migration: `migrations/002_escalating_lockout.sql` (flat 15-minute lock until it runs)
  - New file `includes/lockout.php`; optional config `pin_lockout` (`max_attempts`, `schedule_minutes`, `reset_after_days`)
  - Security events: `GROUP_LOCKED`, `ADMIN_UNLOCK_USER`, `ADMIN_UNLOCK_GROUP`; `ACCOUNT_LOCKED` now includes `minutes`
  - Super admin password login keeps its separate per-IP lockout

### Fixed
- Calendar grid lost its colours (and the Decided highlight) after unlocking with a PIN / passkey or switching name: the values were painted and then the grid was rebuilt with blank cells. `renderDateRangeSkeleton()` now repaints its own cells (`refreshCalendarValues()` + `applyFrozenState()`).
- Hub "add calendar" rate limits (5 per IP per Hub per hour, 15 per IP per hour) were never enforced: their keys (`hub_cal_{id}_{YYYYMMDDHH}`, 21+ chars) did not fit the `CHAR(16)` `api_rate_limit.minute_key` column, so MySQL either truncated them (the count query then never matched) or, in strict mode, rejected the insert. Keys are now `hg{YYYYMMDDHH}{id base 36}` / `hi{YYYYMMDDHH}`, and `enforceActionRateLimit()` hashes any key longer than 16 chars (`rateLimitKey()`).
- Organiser could not change a decided date without refreshing: the Decided banner's **Reopen** button was only evaluated at page load, so logging in as the organiser afterwards (PIN, fingerprint, or switching name) left it hidden. `updateUserUI()` now refreshes the banner, and Reopen requires an authenticated organiser session (`canReopenCalendar()`).

### Changed
- Hub organiser PIN, "Set up a passkey?" and Passkeys windows now use the same modal design as the calendar (indigo title, grey Cancel on the left, indigo confirm on the right, PIN show/hide eye, error hidden until needed)
- The separate "Set up a passkey?" and "Passkeys" popups are merged into one window with two states (calendar and Hub); the Hub uses the same wording as the calendar
- `.htaccess` now blocks direct access to `*.sql` files
- A successful passkey login clears PIN failed attempts / lockout
- `calendar.css`, `hub.css`, `passkey.js`, `calendar.js`, `hub.js` links carry `?v=20260926*` cache-busters; `admin.css` / `admin.js` now carry `?v=20260926a`

---

## 2026-06-27

### Added
- **Calendar Hubs:** One private link (`hub.html?g=TOKEN`) lists multiple calendars for participant entry.
  - New tables: `groups`, `group_sessions`; `calendars.group_id` FK
  - API: `create_group`, `group_meta`, `auth_group`, `add_calendar_to_group`, `remove_calendar_from_group`
  - Hub create flow with mandatory save panel: auto copy, auto `.txt` download, Share, Email, Poster, acknowledgement checkbox
  - Open Hub contribution: anyone with Hub link can create/attach calendars (Hub code in URL); rate limits on server
  - Hub page: public copy Hub code/link, Create new calendar in this Hub
  - Organiser PIN: remove calendars from Hub, Share/Email/Download, Logout on shared computers
  - Go page (`go/`): Calendar or Hub mode; accepts code or full URL
  - Migration: `migrations/add_groups.sql`

### Changed
- Hub create via `index.html?g=TOKEN` no longer requires Hub organiser PIN
- Hub link bar visible without organiser login; Share, Email, Download remain organiser-only
- Hub link toolbar: icon-only on small screens; `link_2` for link copy, `content_copy` for code copy
- Attach existing calendar: calendar organiser only, from calendar page Hub bar (not from Hub page)
- Save panel: Poster popup; plain-ASCII share/download text (`toPlainAscii`)

### Removed
- **Saved on this browser** (Go page Hub shortcuts in localStorage) - archived in `MDfiles/archived/saved-hubs-browser-storage.md`
- **Add existing calendar** button on Hub page (use calendar page attach flow instead)

---

## 2026-04-04

### Added
- **Choose/Freeze feature:** Organiser can lock in a chosen date+slot from the rank card analysis panel. Freezes the calendar -- participants can still view but cannot change availability. Organiser sees a "Reopen" button to undo.
  - New API endpoints: `choose_slot`, `unchoose_slot`
  - Server-side enforcement: `save` endpoint returns 403 when calendar is frozen
  - New DB columns: `calendars.chosen_date`, `calendars.chosen_slot`
  - Green "Decided" banner with check icon at top of analysis section
  - Chosen slot highlighted with green outline in calendar grid
  - Non-chosen slots dimmed to 35% opacity with pointer events disabled
  - Chosen rank card pinned to top with green border treatment
  - "Choose" button appears in expanded rank card actions (organiser only, when not frozen)
  - Confirmation dialogs on both choose and reopen actions
  - Security events logged: `CHOOSE_SLOT`, `UNCHOOSE_SLOT`
- **Month abbreviations in date headers:** Calendar grid now shows "4 Apr", "15 Jul" etc. instead of just the day number. Three-letter month appended to `.date-num` element.

### Changed
- `formatDayHeader()` now returns `monthAbbr` alongside `dayNum` and `dayName`
- Submit button hidden when calendar is frozen
- `calendar_meta` response now includes `chosen_date` and `chosen_slot` fields

---

## 2026-04-03

### Added
- Multi-category support: calendars can have up to 3 category icons
- NY Team Availabilities demo calendar

---

## 2026-03-22

### Added
- Kings Park walking group calendar with Facebook integration in organiser message
- Date filter "only" mode with specific date selections

---

## 2026-03-08

### Added
- Organiser message feature: editable inline note visible to all participants
- Rank sort order toggle: "By Match" (score) vs "By Date" (chronological)
- Rank limit toggle: 2 / 10 / All cards shown
- Auto-save with configurable delay (4.5s default)
- Google Calendar and ICS export from rank cards
- Share button on rank cards with roster summary

### Changed
- Shorter 8-character calendar tokens for cleaner URLs
- Token validation widened to 8-64 chars for backward compatibility

---

## 2026-02-28

### Added
- Date filter system: organiser can show/hide specific dates for participants
- Date filter modes: "all", "only", "except"
- Date filter save status indicator (Unsaved/Saving/Saved)

---

## 2026-02-23

### Added
- Custom status options with configurable colours and weights (1-5 statuses)
- Strength palette system for auto-colouring
- WCAG contrast calculation for status text colours
- Privacy modes: Open, Hidden, Blind
- Organiser dots (left border indicators) showing organiser's choices
- Mood Tracker demo calendar

---

## 2026-02-22

### Added
- Sports Tryouts demo calendar with 4-status system
- Weekend exclusion option
- Template URL system for pre-configured calendars from Ideas page
- Scoring mode toggle: Rank vs Weights

---

## 2026-02-19

### Added
- Initial release
- Calendar creation with custom slots
- PIN-based authentication with lockout
- Availability grid with tap-to-cycle statuses
- Ranked "Best Match" analysis
- User management (add, rename, delete)
- CSRF protection
- Per-IP rate limiting
- Security event logging
- Automatic cleanup via cron
- Super admin panel
