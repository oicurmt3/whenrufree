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
  calendar.js                 |
  calendar.css                |
                           cleanup.php (cron, daily)
admin.html
  admin.js                 config.php (outside webroot)
  admin.css
```

There is no SPA routing, no state management library, no component framework. The calendar page is the most complex (~3,000 lines of JS) and manages all state in a single `state` object.

## Key Design Decisions

### Single source of truth for business rules

Constants like `MESSAGE_MAX_LEN` are defined in `api.php` and sent to the frontend via `calendar_meta`. The DB column should always be wider than or equal to the app-level limit so schema migrations are never needed for limit changes.

### Integer-indexed availability statuses

Availability is stored as integers (0 = null, 1..N = status option index). The mapping from integer to label/colour happens on the client using the `statuses` array from `calendar_meta`. This is a common source of integration bugs -- the integers are 1-based in the DB but the statuses array is 0-based in JS.

### Client-side category allowlist

The `CATEGORY_META` object in `calendar.js` is the allowlist of valid categories. The API accepts any string -- validation is purely client-side. Adding a category means editing `CATEGORY_META` in calendar.js and adding a button in index.html. No API or DB changes needed.

### Privacy enforcement split

Privacy mode (open/hidden/blind) is enforced on both client and server:
- **Client:** `shouldShowRoster()` and `shouldShowOrganiserDots()` gate UI rendering
- **Server:** The `availability` endpoint returns all data regardless of privacy mode. Privacy is a display concern, not a data access concern. This is intentional -- the data is "available" (pun intended) to any authenticated user who reads the API directly. The privacy modes are social contracts, not security boundaries.

### Chosen/frozen state

When an organiser locks in a date+slot, the calendar enters a "frozen" state. This is enforced server-side on the `save` endpoint (returns 403). The client dims non-chosen slots and hides the save button, but even if someone bypasses the UI, the server will reject their changes.

## File-by-File Guide

### api.php (~1,400 lines)

Single procedural PHP file. All endpoints are `if ($action === '...')` blocks that fall through to a final `respond(404, ...)`. No classes, no routing library.

Key patterns:
- `requireCsrf()` -- called on all POST endpoints
- `requireSession($pdo, $calId)` -- validates X-Auth-Token, returns `{user_id, role, calendar_id}`
- `requireToken()` -- validates the `?c=` calendar token parameter
- JSON bodies are decoded into `$_POST` at the top of the file

Config is loaded from a fixed path: `/home/perthrel/grape_private/config.php`.

Passkey (WebAuthn) verification lives in `includes/webauthn.php`, required by api.php. See "Built: Fingerprint / Face Unlock" below.

### calendar.js (~3,000 lines)

The largest and most complex file. Structure (top to bottom):

1. **Constants and config** (lines 1-130): TIME_SLOTS, STATUS_OPTIONS, CATEGORY_META, strength palette
2. **Utility functions** (lines 130-600): parsing, formatting, date helpers
3. **DOM references** (lines 600-670): `els` object caches all querySelector calls
4. **State object** (lines 668-700): single `state` object holds all runtime state
5. **API helpers** (lines 700-760): apiGet, apiPost, CSRF
6. **Data loading** (lines 760-835): loadCalendarMeta, loadUsers
7. **User UI** (lines 835-1090): user select modal, logout, delete
8. **Grid rendering** (lines 1090-1460): renderDateRangeSkeleton, refreshCalendarValues
9. **Slot interaction** (lines 1460-1540): cycleStatus, onSlotClick
10. **User modals** (lines 1540-1800): add/rename/PIN modals
11. **Auth caching** (lines 1800-1830): localStorage auth persistence
12. **Save logic** (lines 1830-2090): savePending, reset operations
13. **Rankings** (lines 2090-2450): buildRankScores, calendar links, share, sort/limit
14. **Organiser message** (lines 2330-2450): edit/save inline message
15. **Chosen/frozen** (lines 2450-2630): isCalendarFrozen, choose/unchoose, banner, grid state
16. **Rank rendering** (lines 2630-2760): renderRankings with choose button
17. **Event listeners** (lines 2760-2860): button click handlers
18. **Init** (lines 2860-3044): init(), auto-auth, session restore

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

Hub create and view page. Post-create save panel (copy, download, share, email, poster). Public link bar; organiser-only Share/Email/Download/Remove. Hub organiser auth cached in localStorage. See `js_functions.md` for function catalogue.

### cleanup.php (~220 lines)

CLI-only cron script. Operations include:
1. Delete calendars inactive for N days (Admin Setup or config; default 40). Respects `never_expires`.
2. Delete Hubs inactive for M days (separate `hub_inactive_days`; default follows calendar setting). Respects Hub `never_expires`; detaches child calendars.
3. Delete expired user sessions
4. Prune old rate limit entries
5. Reset expired PIN lockouts (users and Hub organisers)
6. Delete expired Hub organiser sessions

## Common Tasks

### Adding a new API endpoint

1. Add a new `if ($action === 'your_action' && $_SERVER['REQUEST_METHOD'] === 'POST')` block before the final `respond(404, ...)` in api.php
2. Call `requireCsrf()` for POST endpoints
3. Call `requireSession($pdo, $calId)` if authentication is needed
4. Check `$session['role']` if admin-only
5. Log security events with `logSecurityEvent()`

### Adding a new calendar setting

1. Add column to `calendars` table (phpMyAdmin)
2. Add to the `calendar_meta` SELECT query
3. Add to the `calendar_meta` response processing
4. Add to `state` object in calendar.js
5. Read from meta in `loadCalendarMeta()`
6. Add UI in calendar.html (or create dynamically in JS)

### Adding a new category

See the "Adding a Category" Word document. Two files: `CATEGORY_META` in calendar.js + button in index.html.

## Gotchas and Known Issues

1. **ASCII only**: All files must use plain ASCII. No em dashes, curly quotes, ellipsis characters. cPanel File Manager corrupts non-ASCII on save.

2. **Status index mismatch**: DB stores 1-based status integers. JS statuses array is 0-based. Always subtract 1 when mapping: `opts[status - 1]`.

3. **VARCHAR(150) vs 250**: The `organiser_message` column was originally VARCHAR(150) but `MESSAGE_MAX_LEN` is 250. A migration to VARCHAR(250) should be applied. The general rule: DB column width should always exceed the app-layer limit.

4. **Rate limit race condition**: The upsert pattern for `api_rate_limit` has a known race condition under high concurrency. Acceptable for shared hosting scale. Would need Redis or similar for high-traffic deployments.

5. **Session accumulation**: New sessions are created on each login without invalidating old ones. Cleanup.php handles expired sessions, but active users may accumulate rows. Not a problem at current scale.

6. **No CORS for cross-origin**: The app is designed for same-origin use only. CORS headers are minimal (OPTIONS support for dev tooling only). The external API architecture has been designed but not yet built.

7. **getRelativeLuminance duplication**: This function exists in both calendar.js and index.js. If you change the luminance formula or contrast threshold, update both files.

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
- Public Hub link bar: copy link/code for everyone; Share, Email, Download for organiser only.
- Open contribution: anyone with Hub link can create a calendar via `index.html?g=TOKEN` (no Hub PIN); server rate limits apply.
- Attach existing calendar: calendar organiser only, from calendar page Hub bar (`add_calendar_to_group`).
- Remove from Hub: Hub organiser or calendar organiser (`remove_calendar_from_group`).
- `go/index.html`: Calendar/Hub toggle; accepts code or full URL (`normalizeLinkInput` prepends `https://` when needed).
- Hub rate limits in `api.php`: max 50 calendars/Hub; 5 adds/IP/Hub/hour; 15 adds/IP/hour global (override via `config.php` `hub_limits`).

## Built: Fingerprint / Face Unlock (Passkeys)

- Optional WebAuthn login for calendar users (organisers included) and Hub organisers. The PIN is always the backup and is still required to enrol a device.
- Server: `includes/webauthn.php` (dependency-free; CBOR/COSE parsing, ES256 + RS256 via `openssl_verify`). `includes/` is blocked by its own `.htaccess`.
- `api.php`: `resolvePasskeySubject()` maps `?c=` + user / `?g=` to a subject; `createUserSession()` / `createGroupSession()` are shared by PIN and passkey logins. Actions: `passkey_register_begin|finish`, `passkey_login_begin|finish`, `passkey_list`, `passkey_remove`.
- Device list (modelled on the loyalty app's Account page): owners see all their devices (`device_label`, added, last used) and can remove any, so a lost phone can be revoked from another device after a PIN login. `Passkey.syncDevice()` clears stale local enrolment when a device was removed elsewhere.
- Tables `user_passkeys` / `group_passkeys` (`migrations/001_passkeys.sql`); FK cascades mean cleanup.php needs no changes.
- Self-disabling: if the tables are missing, `calendar_meta` / `group_meta` return `passkeys: false` and the UI hides everything.
- Challenges live in the PHP session (`$_SESSION['wruf_webauthn']`), 5-minute TTL, single-use, bound to the subject.
- `residentKey: 'discouraged'` + `allowCredentials` per user, so the user picks their name first and the device prompts immediately. No usernameless login.
- Passkeys are domain-bound: whenrufree.net and sandgroper.net passkeys are separate. Leave `webauthn.rp_id` unset unless you want to pin one domain.
- Browser: `passkey.js` (`window.Passkey`). Enrolment state is remembered per device in localStorage; if the server no longer knows the credential (`NO_PASSKEY`), the client forgets it.
- Local test: there is no automated test suite in the repo. Verification was done with a throwaway PHP script that emulates an authenticator. On Windows PHP, `openssl_pkey_new()` needs `OPENSSL_CONF` pointing at `extras/ssl/openssl.cnf`.

## Contact and Access

- **Hosting**: cPanel shared hosting
- **Database admin**: phpMyAdmin (via cPanel)
- **Logs**: `grape_private/logs/` (security and cleanup logs)
- **Domains**: whenrufree.net, sandgroper.net (same deployment)
