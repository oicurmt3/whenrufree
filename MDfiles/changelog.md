# Changelog

All notable changes to When RU Free, in reverse chronological order.

---

## 2026-09-26

### Added
- **Fingerprint / face unlock (passkeys):** Calendar users, calendar organisers and Hub organisers can unlock with their device's fingerprint, face or screen lock. The 4-digit PIN stays as the backup.
  - After a successful PIN login (or adding your name), the app offers "Turn on" once per device; "Not now" is remembered on that device
  - PIN modal shows "Use fingerprint / face / screen lock" and prompts automatically on enrolled devices
  - Device list (calendar: fingerprint icon next to your name; Hub: organiser **Fingerprint** button): see every device with its name and added / last used dates, remove any of them (e.g. a lost phone), or turn on the current device
  - New tables: `user_passkeys`, `group_passkeys` (FK cascade, `device_label`). Migration: `migrations/001_passkeys.sql`
  - API: `passkey_register_begin`, `passkey_register_finish`, `passkey_login_begin`, `passkey_login_finish`, `passkey_list`, `passkey_remove`; `calendar_meta` and `group_meta` report `passkeys`
  - New files: `includes/webauthn.php` (dependency-free WebAuthn verifier, ES256 + RS256), `includes/.htaccess`, `passkey.js`
  - Optional config: `webauthn.rp_id`, `webauthn.origin`
  - Security events: `PASSKEY_ADDED`, `PASSKEY_LOGIN`, `PASSKEY_REMOVED`, `PASSKEY_COUNTER_REPLAY`

### Changed
- `.htaccess` now blocks direct access to `*.sql` files
- A successful passkey login clears PIN failed attempts / lockout
- `calendar.css`, `hub.css`, `passkey.js`, `calendar.js`, `hub.js` links carry `?v=20260926b` cache-busters

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
- **Saved on this browser** (Go page Hub shortcuts in localStorage) — archived in `MDfiles/archived/saved-hubs-browser-storage.md`
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
