# Handover Guide

Everything a new developer needs to understand, maintain, and extend When RU Free.

---

## Architecture Overview

This is a no-framework, no-build-step web application. Core pages: index (create calendar), calendar (view/interact), hub (Hub create/list), go (open by code/URL), admin. One API file, one database.

```
Browser                     Server
------                      ------
index.html  ----POST----->  api.php?action=create_calendar
  index.js                    |
  index.css                   v
                           MariaDB (calendars, users, availability,
calendar.html <--GET----    user_sessions, api_rate_limit)
  calendar-*.js (6 files)     |
  calendar.css                |
                           cleanup.php (cron, daily)
admin.html
  admin-*.js (4 files)     config.php (outside webroot)
  admin.css                includes/*.php (helpers, blocked by .htaccess)
```

There is no SPA routing, no state management library, no component framework. The calendar page is the most complex (~4,400 lines of JS across six files) and manages all state in a single `state` object.

### Split scripts (no modules, no build step)

The calendar page and the admin panel are split into several classic `<script>` files that share global scope. They load in a fixed order from the page's HTML. A function in one file can call a function in any other file once the page has loaded, because startup runs on `DOMContentLoaded`. Two rules keep this safe:
- Top-level code that runs at load time (such as `els`, `debouncedRank` or `addEventListener` wiring) may only use names from its own file or an earlier file.
- Never declare the same top-level name (`function`, `let`, `const`) in two files of the same page. A duplicate is a SyntaxError that stops that whole file.

When adding a file, add its `<script>` tag in the right place with a `?v=` cache-buster, and list it in `js_functions.md`.

## Key Design Decisions

### Single source of truth for business rules

Constants like `MESSAGE_MAX_LEN` are defined in `includes/data.php` and sent to the frontend via `calendar_meta`. The DB column should always be wider than or equal to the app-level limit so schema migrations are never needed for limit changes.

### Integer-indexed availability statuses

Availability is stored as integers (0 = null, 1..N = status option index). The mapping from integer to label/colour happens on the client using the `statuses` array from `calendar_meta`. This is a common source of integration bugs -- the integers are 1-based in the DB but the statuses array is 0-based in JS.

### Client-side category allowlist

The `CATEGORY_META` object in `calendar-core.js` is the allowlist of valid categories. The API accepts any string -- validation is purely client-side. Adding a category means editing `CATEGORY_META` in calendar-core.js and adding a button in index.html. No API or DB changes needed.

### Privacy enforcement split

Privacy mode (open/hidden/blind) is enforced on both client and server:
- **Client:** `shouldShowRoster()` and `shouldShowOrganiserDots()` gate UI rendering
- **Server:** The `availability` endpoint returns all data regardless of privacy mode. Privacy is a display concern, not a data access concern. This is intentional -- the data is "available" (pun intended) to any authenticated user who reads the API directly. The privacy modes are social contracts, not security boundaries.

### Chosen/frozen state

When an organiser locks in a date+slot, the calendar enters a "frozen" state. This is enforced server-side on the `save` endpoint (returns 403). The client dims non-chosen slots and hides the save button, but even if someone bypasses the UI, the server will reject their changes.

## File-by-File Guide

### api.php (~2,200 lines) and includes/

`api.php` is the single entry point and holds every endpoint. All endpoints are `if ($action === '...')` blocks that fall through to a final `respond(404, ...)`. No classes, no routing library. Shared helpers live in `includes/` (blocked from the web by `includes/.htaccess`), loaded by one `require_once` block near the top of `api.php`:

| File | Contents |
|------|----------|
| `includes/http.php` | `respond()`, `readJsonBody()`, `requireAction()`, `requireToken()`, `requireConfig()`, trusted proxies and `clientIp()`, `startSecureSession()`, CSRF (`generateCsrfToken()`, `requireCsrf()`) |
| `includes/data.php` | `normaliseTitle()`, `normaliseName()`, `validateSlotsArray()`, `validateStatusesArray()`, `dateRangeOk()`, `MESSAGE_MAX_LEN`, `respondDuplicateName()`, `buildAvailabilitySummary()` |
| `includes/security.php` | `pdo()`, `logSecurityEvent()`, rate limiting (`enforceRateLimit()`, `enforceActionRateLimit()`, `rateLimitKey()`, `isSensitivePostAction()`), admin login lockout, `requireAdminSession()`, PIN lockout wrappers, `hashPin()` / `verifyPin()`, `createToken()` |
| `includes/sessions.php` | `createUserSession()`, `requireSession()`, `getOptionalSession()`, `createGroupSession()`, `getOptionalGroupSession()`, `requireGroupOrganiserSession()`, `resolvePasskeySubject()` |
| `includes/hubs.php` | Hub limits (`HUB_*`, `hubLimitsConfig()`, `prepareHubCalendarAdd()`), `requireGroupTokenParam()`, `getGroupByToken()`, `touchGroupActivity()`, Hub PIN lockout wrappers, `resolveGroupTokenFromPost()` |
| `includes/webauthn.php`, `lockout.php`, `access.php`, `booking.php` | Passkeys, escalating PIN lockout, access emoji, booking rules (see below) |

Each include declares `strict_types=1`, like `api.php`. `logSecurityEvent()` writes to `grape_private/logs/` next to the webroot (the path is relative to `includes/`, so it uses `dirname(__DIR__)`).

Key patterns:
- `requireCsrf()` -- called on all POST endpoints
- `requireSession($pdo, $calId)` -- validates X-Auth-Token, returns `{user_id, role, calendar_id}`
- `requireToken()` -- validates the `?c=` calendar token parameter
- JSON bodies are decoded into `$_POST` at the top of the file

Config is loaded from a fixed path: `/home/perthrel/grape_private/config.php`.

Passkey (WebAuthn) verification lives in `includes/webauthn.php`, required by api.php. See "Built: Fingerprint / Face Unlock" below.

PIN lockout lives in `includes/lockout.php` (`pinLockoutCheck`, `pinLockoutRecordFailure`, `pinLockoutReset`), called through the `checkAccountLockout` / `recordFailedAttempt` / `resetFailedAttempts` wrappers (in `includes/security.php`; the `Group` equivalents are in `includes/hubs.php`). The schedule is 5 min, 15 min, 2 hours, 2 days (config `pin_lockout`); `lockout_level` stores how far a name or Hub has escalated. The optimistic `UPDATE ... WHERE lockout_level = :level` stops two simultaneous wrong PINs escalating twice. The admin panel shows an Unlock control on locked users and Hubs. The super admin password login keeps its own per-IP lockout (`admin.max_attempts` / `admin.lockout_minutes`).

### calendar-*.js (~4,400 lines, 6 files)

The largest and most complex part. Loaded by `calendar.html` in this order (see "Split scripts" above):

1. **calendar-core.js**: constants and config (TIME_SLOTS, STATUS_OPTIONS, CATEGORY_META, strength palette), utilities, pending changes queue and autosave, date helpers, the `els` object (caches all querySelector calls), the single `state` object, CSRF, access emoji gate, `apiGet` / `apiPost`
2. **calendar-users.js**: `loadCalendarMeta`, `loadUsers`, user select modal, logout / delete, submit and user UI, Hub bar, organiser Settings, add / rename / PIN modals, passkeys, auth caching
3. **calendar-grid.js**: availability loading, slot status, date filter, `renderDateRangeSkeleton`, past dates, `refreshCalendarValues`, `cycleStatus`, `onSlotClick`, `savePending` and reset operations
4. **calendar-rank.js**: calendar links, share, `buildRankScores`, sort / limit toggles, organiser message, chosen / frozen state, `renderRankings`, `debouncedRank`
5. **calendar-booking.js**: booking mode (cells, caps, Bookings card, close / reopen, polling)
6. **calendar-main.js**: event listeners, auto-auth, session restore, `init()` on `DOMContentLoaded`

Function-by-function locations are in `js_functions.md`.

### admin-*.js (~2,600 lines, 4 files)

Loaded by `admin.html` in this order: `admin-core.js` (login, API helper, utilities, tabs), `admin-calendars.js` (Calendars tab and Users expander), `admin-hubs.js` (Hubs tab), `admin-setup.js` (Setup tab). `checkExistingSession()` runs on `DOMContentLoaded` so every tab file is loaded first.

### calendar.css (~1,400 lines)

Organised in sections:
- Layout and header
- Analysis section (rankings, organiser message, sort/limit toggles)
- Calendar grid (day columns, slots, status colours, organiser dots)
- Modals (user select, add/rename, PIN, info)
- Date filtering (banner, indicators)
- Chosen/frozen state
- Responsive breakpoint at 700px

### index.js (~1,100 lines)

Calendar creation form logic. Manages slots repeater, status repeater, date range picker, category toggles, and template URL parsing. Sends `create_calendar` and redirects to calendar.html. When opened with `?g=TOKEN`, loads Hub context via `group_meta` and passes `group_token` on create (no Hub PIN required).

### hub.js (~856 lines)

Hub create and view page. Post-create save panel (copy, download, share, email, poster). Public link bar; organiser-only Share/Email (icon-only), Poster, Download and Remove. Hub organiser auth cached in localStorage. See `js_functions.md` for function catalogue.

### cleanup.php (~220 lines)

CLI-only cron script. Operations include:
1. Delete calendars inactive for N days (Admin Setup or config; default 40). Respects `never_expires`.
2. Delete Hubs inactive for M days (separate `hub_inactive_days`; default follows calendar setting). Respects Hub `never_expires`; detaches child calendars.
3. Delete expired user sessions
4. Prune old rate limit entries
5. Reset expired PIN lockouts (calendar users); keeps `lockout_level`
6. Delete expired Hub organiser sessions
7. Reset expired Hub organiser PIN lockouts
8. Reset `lockout_level` after `pin_lockout.reset_after_days` (default 30) without a lockout; skipped until migration 002 is applied
9. Delete expired / orphaned `access_grants` and `access_attempts` rows unlocked and idle for `access_emoji.attempts_keep_days` (default 30); skipped until migration 003 is applied

## Common Tasks

### Adding a new API endpoint

1. Add a new `if ($action === 'your_action' && $_SERVER['REQUEST_METHOD'] === 'POST')` block before the final `respond(404, ...)` in api.php
2. Call `requireCsrf()` for POST endpoints
3. Call `requireSession($pdo, $calId)` if authentication is needed
4. Check `$session['role']` if admin-only
5. Log security events with `logSecurityEvent()`
6. Put any new shared helper in the matching `includes/` file (or a new one added to the `require_once` block), not in `api.php`

### Adding a new calendar setting

1. Add column to `calendars` table (phpMyAdmin)
2. Add to the `calendar_meta` SELECT query
3. Add to the `calendar_meta` response processing
4. Add to `state` object in calendar-core.js
5. Read from meta in `loadCalendarMeta()`
6. Add UI in calendar.html (or create dynamically in JS)

### Adding a new category

See the "Adding a Category" Word document. Two files: `CATEGORY_META` in calendar-core.js + button in index.html.

## Gotchas and Known Issues

1. **ASCII only**: All files must use plain ASCII. No em dashes, curly quotes, ellipsis characters. cPanel File Manager corrupts non-ASCII on save.

2. **Status index mismatch**: DB stores 1-based status integers. JS statuses array is 0-based. Always subtract 1 when mapping: `opts[status - 1]`.

3. **VARCHAR(150) vs 250**: The `organiser_message` column was originally VARCHAR(150) but `MESSAGE_MAX_LEN` is 250. A migration to VARCHAR(250) should be applied. The general rule: DB column width should always exceed the app-layer limit.

4. **Rate limit race condition**: The upsert pattern for `api_rate_limit` has a known race condition under high concurrency. Acceptable for shared hosting scale. Would need Redis or similar for high-traffic deployments. Rate-limit keys must fit `minute_key` CHAR(16); `enforceActionRateLimit()` hashes longer keys via `rateLimitKey()`, but keep new prefixes short and readable (e.g. `pkr` + minute, `hg` + hour + id).

5. **Session accumulation**: New sessions are created on each login without invalidating old ones. Cleanup.php handles expired sessions, but active users may accumulate rows. Not a problem at current scale.

6. **No CORS for cross-origin**: The app is designed for same-origin use only. CORS headers are minimal (OPTIONS support for dev tooling only). The external API architecture has been designed but not yet built.

7. **getRelativeLuminance duplication**: This function exists in both calendar-core.js and index.js. If you change the luminance formula or contrast threshold, update both files.

8. **DateUtils IIFE**: A `DateUtils` utility with `normalizeDateToISO`, `preClean`, `expandTwoDigitYear`, and `isoToDMY` was designed but has NOT been implemented anywhere in the codebase yet.

## Planned Features (Not Yet Built)

- **Marshal scheduling integration** (Session Tracker x When RU Free): v5 plan finalised, not yet building. Starts with config.php + api.php changes.
- **External API**: Key-based access with CORS binding, tiered rate limiting, versioned routing. Architecture designed through v3.1.
- **URL token options**: 4-word "easy link" format under consideration as alternative to 8-char tokens.

## Built: Calendar Hubs

- UI label **Hub**; DB table `groups`. Pages: `hub.html`, `hub.js`, `hub.css`.
- Participant entry: `hub.html?g=TOKEN` lists child calendars (no PIN to view list).
- Hub organiser PIN for management; sessions in `group_sessions` (`X-Group-Auth-Token`), cached in localStorage per Hub token (`wruf_group_auth_{token}`).
- Post-create save panel: auto copy, auto `.txt` download, Share, Email, Poster, acknowledgement checkbox gate.
- Public Hub link bar: copy link/code for everyone; Share, Email, Poster, Download for organiser only.
- Open contribution: anyone with Hub link can create a calendar via `index.html?g=TOKEN` (no Hub PIN); server rate limits apply.
- Attach existing calendar: calendar organiser only, from calendar page Hub bar (`add_calendar_to_group`).
- Remove from Hub: Hub organiser or calendar organiser (`remove_calendar_from_group`).
- `go/index.html`: Calendar/Hub toggle; accepts code or full URL (`normalizeLinkInput` prepends `https://` when needed).
- Hub rate limits in `includes/hubs.php`: max 50 calendars/Hub; 5 adds/IP/Hub/hour; 15 adds/IP/hour global (override via `config.php` `hub_limits`).

## Built: Fingerprint / Face Unlock (Passkeys)

- Optional WebAuthn login for calendar users (organisers included) and Hub organisers. The PIN is always the backup and is still required to enrol a device.
- Server: `includes/webauthn.php` (dependency-free; CBOR/COSE parsing, ES256 + RS256 via `openssl_verify`). `includes/` is blocked by its own `.htaccess`.
- `includes/sessions.php`: `resolvePasskeySubject()` maps `?c=` + user / `?g=` to a subject; `createUserSession()` / `createGroupSession()` are shared by PIN and passkey logins. Actions: `passkey_register_begin|finish`, `passkey_login_begin|finish`, `passkey_list`, `passkey_remove`.
- Device list (modelled on the loyalty app's Account page): owners see all their devices (`device_label`, added, last used) and can remove any, so a lost phone can be revoked from another device after a PIN login. `Passkey.syncDevice()` clears stale local enrolment when a device was removed elsewhere.
- Tables `user_passkeys` / `group_passkeys` (`migrations/001_passkeys.sql`); FK cascades mean cleanup.php needs no changes.
- Self-disabling: if the tables are missing, `calendar_meta` / `group_meta` return `passkeys: false` and the UI hides everything.
- Challenges live in the PHP session (`$_SESSION['wruf_webauthn']`), 5-minute TTL, single-use, bound to the subject.
- `residentKey: 'discouraged'` + `allowCredentials` per user, so the user picks their name first, then taps the fingerprint button (focused, so Enter works) to open the device prompt. The prompt is never opened automatically: on desktop it would pop up Windows Hello / Touch ID uninvited, and Safari can block WebAuthn calls not started by a user gesture. No usernameless login.
- Passkeys are domain-bound: whenrufree.net and sandgroper.net passkeys are separate. Leave `webauthn.rp_id` unset unless you want to pin one domain.
- Browser: `passkey.js` (`window.Passkey`). Enrolment state is remembered per device in localStorage; if the server no longer knows the credential (`NO_PASSKEY`), the client forgets it.
- Local test: there is no automated test suite in the repo. Verification was done with a throwaway PHP script that emulates an authenticator. On Windows PHP, `openssl_pkey_new()` needs `OPENSSL_CONF` pointing at `extras/ssl/openssl.cnf`.

## Built: Access Emoji

- Optional second barrier on top of the secret link: the organiser picks 1 of 35 emoji for a calendar or Hub; visitors pick it before any data loads. Not a password replacement - 1 in 35 odds, backed by throttling.
- Stored as a position 0-34 (`calendars.access_emoji`, `groups.access_emoji`). The glyphs and names live only in `emoji.js` (`AccessEmoji.LIST`, written as `\u{...}` escapes to keep files ASCII). **Never reorder or replace entries** - it would silently change every saved emoji. Only append, and bump `ACCESS_EMOJI_COUNT` in `includes/access.php` to match.
- Effective emoji: the calendar's own, else its Hub's. A Hub grant opens every calendar in the Hub.
- Server: `includes/access.php`. `accessGate()` runs in api.php before the action dispatch and resolves the target from `?c=`, then `?g=`, then the POSTed `group_token` on `create_calendar`. Exempt: `csrf_token`, `diag`, `access_check`, `remove_calendar_from_group` (PIN-protected; exempting it avoids a loop when a Hub organiser removes a calendar that has its own emoji) and `admin_*`.
- Grants: random 64-hex, stored as SHA-256 in `access_grants`, 30 days. Browser keeps them in localStorage (`wruf_ag_c_{token}` / `wruf_ag_g_{token}`, in-memory fallback) and sends up to 3 in `X-Access-Grant` (calendar + Hub when relevant).
- Throttling: per IP + subject in `access_attempts` (3 wrong picks, then 5/15/120/2880 minute locks); per IP per hour in `api_rate_limit` (`aw` wrong picks 20, `nf` unknown codes 30). `access_check`, `set_access_emoji` and `set_group_access_emoji` are sensitive POSTs (fail closed without the limiter).
- Changing or removing an emoji revokes its grants and clears its attempt rows; the organiser gets a fresh grant in the response.
- The emoji itself is only returned by organiser-only `access_settings`; `calendar_meta` / `group_meta` expose just `{available, enabled, inherited}`. `share.php` hides the title in link previews for guarded calendars.
- Browser: `emoji.js` / `emoji.css` (`window.AccessEmoji`: grid, fullscreen picker, blocking gate popup, on/off field). `calendar-core.js`, `hub.js`, `index.js` wrap API calls in `accessFetch()`, which shows the gate on 403 `ACCESS_REQUIRED` and retries (max 3 tries).
- Self-disabling: until `migrations/003_access_emoji.sql` runs, `accessTablesReady()` is false, the gate is skipped and the UI hides the switch.
- Admin: badge + Remove emoji (`admin_set_access_emoji`, removal only) for organisers who forget it.

## Built: Booking Mode

- A calendar with `calendars.slot_capacity` set (1-20) is a booking form: each slot can be taken by that many people, first come, first served. `max_per_user` (1-20 or NULL) caps bookings per person per day (counted with `AND day = :day` in `bookingApplyChanges()`), or across the whole calendar when `per_user_total` = 1 (the day filter is dropped); `bookings_closed` locks it. All four are set only in `create_calendar` - there is no endpoint to change them later.
- Bookings are ordinary `availability` rows with status 1. The calendar has exactly one status (the booking label, default "Booked"); Blind privacy is rejected because nobody could see which slots are free.
- Server rules live in `includes/booking.php`: `bookingColumnsReady()` (migration check), `bookingLimitValue()`, `bookingSettingsFromRow()`, `bookingLockCalendar()` (`SELECT ... FOR UPDATE` on the calendar row - this is what makes two simultaneous taps on the last place safe) and `bookingApplyChanges()` (cancellations first, then bookings with capacity / per-person checks; returns the refused ones). `save` uses them for booking calendars only; normal calendars keep the old upsert path.
- The organiser booking for themselves skips `max_per_user` (so they can block slots); removing someone else's booking is a `save` for that user with status 0. When closed, participants get 403 `BOOKINGS_CLOSED` from `save` and `reset_user`; the organiser can still save.
- Hidden booking calendars send the anonymous `summary` even without a session, so visitors see Free / Full. Names follow `shouldShowRoster()`.
- Browser: `index.js` BOOKING MODE block (`makeLimitControl()`, `applyBookingMode()`), `calendar-booking.js` (`bookingInfo()`, `onBookingSlotClick()` / `setPendingBooking()` - taps become normal pending changes saved by `savePending()`, which drops the server's `rejected` slots and handles `BOOKINGS_CLOSED`; `queueBooking()` - organiser removals of other people, `renderBookings()`, `setBookingsClosed()`, `refreshBookings()` every 30 s and on tab focus). `renderRankings()`, `refreshCalendarValues()`, `onSlotClick()`, `renderLegend()` and `updateChosenBanner()` branch to the booking versions when `state.booking` is set.
- Self-disabling: until `migrations/004_booking.sql` runs, `features.booking` is false and the create page hides People per slot. Until `migrations/005_booking_total.sql` runs, `features.booking_total` is false, the Per day / In total toggle is hidden and every limit is per day (`bookingTotalColumnReady()`). Until `migrations/006_booking_styles.sql` runs, `features.booking_styles` is false, the Partly booked / Full colour and name settings are hidden and cells use the defaults (`bookingStyleColumnsReady()`; `calendars.partial_color` / `full_color` become the `--bk-partial` / `--bk-full` CSS variables via `applyBookingColors()`, and `partial_label` / `full_label` become `state.booking.partialLabel` / `fullLabel` in `calendar-users.js`).
- Tests: `$env:TEMP\wruf_booking_test.php` (SQLite, not in the repo) covers `includes/booking.php`; there is no browser test.

## Future ideas

### Booking: combined per-day and in-total limits (parked 2026-09-26)

Today Bookings per person is one number counted **Per day** or **In total** (`calendars.per_user_total`, migration 005). A combined rule such as "at most 1 per day and 4 in total" is not supported.

- **Use cases:** monthly volunteer rosters (1/day, 4 total), gym or court weeks (1/day, 3 total), tutoring terms (1/day, 5 total), shared-car fair share (1/day, 5 total).
- **Not needed for:** interviews and workshops (1 in total), holiday house and meeting room (No limit), single-day calendars.
- **Why parked:** niche; two limit controls make the create page harder to follow; organisers can already remove bunched bookings by hand.
- **Design if built:** replace the Per day / In total toggle with two optional limits, **Per day** and **In total** (each No limit / 1 / 2 / More). New column `max_per_day` (migration 006); existing calendars map `per_user_total = 0` to `max_per_day = max_per_user`, and `per_user_total = 1` to the in-total limit only. `bookingApplyChanges()` checks both counts (organiser still exempt); `myBookingCount()` / `bookingLimitMessage()` check and name whichever limit was hit. Hint: "Each person can book 1 slot per day, up to 4 in total." Template params `per` + `day`.

## Contact and Access

- **Hosting**: cPanel shared hosting
- **Database admin**: phpMyAdmin (via cPanel)
- **Logs**: `grape_private/logs/` (security and cleanup logs)
- **Domains**: whenrufree.net, sandgroper.net (same deployment)
