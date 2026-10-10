# Handover Guide

Everything a new developer needs to understand, maintain, and extend When RU Free.

---

## Architecture Overview

This is a no-framework, no-build-step web application. Core pages: index (create calendar), calendar (view/interact), hub (Hub create/list), go (open by code/URL), account (profile and sign-in setup), admin. One API file, one database.

```
Browser                     Server
------                      ------
index.html  ----POST----->  api.php?action=create_calendar
  index.js                    |
  index.css                   v
                           MariaDB (accounts, account_*, calendars,
calendar.html <--GET----    users, availability, api_rate_limit)
  calendar-*.js (6 files)     |
  calendar.css                |
                           cleanup.php (cron, daily)
account.html
  account.js               Google / Facebook (oauth_start -> provider
every page:                  -> oauth_google / oauth_facebook)
  passkey.js, account-core.js, account.css
admin.html
  admin-*.js (5 files)     config.php (outside webroot)
  admin.css                includes/*.php (helpers, blocked by .htaccess)
```

There is no SPA routing, no state management library, no component framework. The calendar page is the most complex (~4,000 lines of JS across six files) and manages all state in a single `state` object.

### Accounts (no PINs)

Everyone signs in (Google, Facebook or a passkey) before they can open, join or create anything. `accountGate()` in `includes/accounts.php` runs before every action and returns 401 `ACCOUNT_REQUIRED` / 403 `ACCOUNT_SETUP`; every page starts with `await Account.require()` (from `account-core.js`), which shows a sign-in panel that cannot be dismissed. The one exception is the home page (`index.html`): signed out, it shows the create form as a preview with a **Sign in** button (`Account.renderSignInBadge()`), and tapping anything in the form opens a closable sign-in panel (`Account.showSignIn(me, {dismissible: true})`, wired by `guardFormUntilSignedIn()` in `index.js`). Hub links (`?g=`) and unfinished set-up still call `Account.require()`, and `create_calendar` is refused by `accountGate()` anyway. There are no auth headers or per-calendar tokens: the HttpOnly `wruf_account` cookie identifies the account, and a calendar role comes from `users.account_id` + `users.role`. The unique link is the invite; the optional access emoji is an invite confirmation remembered per account. Invite only calendars and Hubs also need the organiser's approval (see "Built: Invite only and Block").

- **Data kept:** private username, profile name, HMAC-SHA-256 (with `accounts.pepper`) of each Google `sub` / Facebook app-scoped `id`, passkey public keys, memberships. Never an email, real name or photo. Google is asked only for `openid`; Facebook only for `public_profile` (its minimum), and only the `id` is read.
- **Names:** `users.name_custom = 0` means the name follows the profile name (updated by `accountUpdateProfile()` when the profile name changes); 1 means a per-calendar override. One name per account per calendar (`ux_users_cal_account`).
- **Claiming:** names and Hubs from before accounts keep their PIN hash (`account_id` / `organiser_account_id` NULL) until someone claims them once with `claim_name` / `claim_hub`; the PIN hash is then set to NULL. `migrations/008_drop_pins.sql` (about 90 days after launch) removes the rest.
- **Sessions:** 64-hex cookie, SHA-256 in `account_sessions`, 30 days, renewed at most once a day (`accountCurrent()`), SameSite=Lax so the provider redirect back keeps it.
- **OAuth:** `includes/oauth.php`. `oauth_start` sets the signed `wruf_oauth` cookie (10 minutes: state, OIDC nonce, PKCE verifier, mode, return path) and redirects; `oauth_google` / `oauth_facebook` verify it, exchange the code with cURL, and sign in or link. Results come back as `?signin=` (see `Account.SIGNIN_MESSAGES`).
- **Passkeys:** discoverable credentials in `account_passkeys` (`residentKey: 'required'`, user handle `webauthnAccountUserHandle()`), so sign-in needs no username (`webauthnDiscoverOptions()` / `webauthnDiscoverFinish()`). Adding one sends the account's existing passkeys as `excludeCredentials`, so a device that already has one refuses (`Passkey.isDuplicate()`); that's why the profile page always shows **Add a passkey on this device** but hides **Add sign-in with Google / Facebook** once linked.
- **Usernames:** 3-20 of `a-z0-9_`, not in `ACCOUNT_USERNAME_RESERVED` (`accountNormaliseUsername()`, `accountUsernameReserved()`); admin accounts may use reserved names.
- **Admin by account:** `admin.account_ids` in `config.php` lists account ids (Admin > Accounts > ID) that may open the admin panel. `admin_login_account` checks the signed-in account against `adminAccountIds()` and starts the same 1-hour admin session as the password (`adminIssueSession()`, which also regenerates the PHP session id). `admin-core.js` tries it silently on load unless the tab has logged out (`sessionStorage.adminNoAutoAccount`).

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
- **Client:** `shouldShowRoster()` and `shouldShowOrganiserDots()` gate UI rendering. `canViewUser()` (the People list's read-only eye-button view) uses the same rule as `shouldShowRoster()`, and skips booking calendars and blocked people. The organiser's coloured slot edge shows only on Open calendars (Hidden members never receive the organiser's rows) and only while `calendars.show_organiser_marks` is 1
- **Server:** `availability` returns every row on Open calendars and to the organiser of a Hidden one; Hidden members and Blind (any role) get only their own rows plus the anonymous `summary`. Blocked people's rows are left out of both on non-booking calendars.
- **Names:** when `membersNamesHidden()` is true (Blind, or Hidden with `calendars.hide_names`), `users` returns only the caller, the organisers and claimable old names, plus a `total`; the organiser still gets everyone.

### Chosen/frozen state

When an organiser locks in a date+slot, the calendar enters a "frozen" state. This is enforced server-side on the `save` endpoint (returns 403). The client dims non-chosen slots and hides the save button, but even if someone bypasses the UI, the server will reject their changes.

## File-by-File Guide

### api.php (~2,450 lines) and includes/

`api.php` is the single entry point and holds every endpoint. All endpoints are `if ($action === '...')` blocks that fall through to a final `respond(404, ...)`. No classes, no routing library. Shared helpers live in `includes/` (blocked from the web by `includes/.htaccess`), loaded by one `require_once` block near the top of `api.php`:

| File | Contents |
|------|----------|
| `includes/http.php` | `respond()`, `readJsonBody()`, `requireAction()`, `requireToken()`, `requireConfig()`, trusted proxies and `clientIp()`, `startSecureSession()`, CSRF (`generateCsrfToken()`, `requireCsrf()`) |
| `includes/data.php` | `normaliseTitle()`, `normaliseName()`, `validateSlotsArray()`, `validateStatusesArray()`, `dateRangeOk()`, `MESSAGE_MAX_LEN`, `respondDuplicateName()`, `buildAvailabilitySummary()`, `organiserMarksColumnReady()` (migration 010) |
| `includes/security.php` | `pdo()`, `logSecurityEvent()`, rate limiting (`enforceRateLimit()`, `enforceActionRateLimit()`, `rateLimitKey()`, `isSensitivePostAction()`), admin login lockout, `adminAccountIds()`, `adminIssueSession()`, `requireAdminSession()`, claim lockout wrappers, `verifyPin()` (old PINs are only checked when claiming), `createToken()` |
| `includes/sessions.php` | `getOptionalSession()` / `requireSession()` (the account's name on a calendar; 403 `NOT_JOINED`), `getOptionalGroupSession()` / `requireGroupOrganiserSession()` (the account organises the Hub) |
| `includes/hubs.php` | Hub limits (`HUB_*`, `hubLimitsConfig()`, `prepareHubCalendarAdd()`), `requireGroupTokenParam()`, `getGroupByToken()`, `touchGroupActivity()`, Hub claim lockout wrappers, `resolveGroupTokenFromPost()` |
| `includes/accounts.php` | Account config, sessions and cookie, `accountGate()`, `requireAccount()`, identities, username / name rules, `accountNameForCalendar()`, `accountUpdateProfile()`, methods, memberships, deletion, per-account emoji picks, legacy clean-up after a claim |
| `includes/oauth.php` | Google / Facebook sign-in: provider config, signed state cookie, authorize URL, code exchange, callback |
| `includes/webauthn.php`, `lockout.php`, `access.php`, `booking.php` | Account passkeys, escalating claim lockout, access emoji, booking rules (see below) |
| `includes/members.php` | Invite only and Block: `membersGate()`, `membersDecide()`, requests, organiser checks, private names (see below) |

Each include declares `strict_types=1`, like `api.php`. `logSecurityEvent()` writes to `grape_private/logs/` next to the webroot (the path is relative to `includes/`, so it uses `dirname(__DIR__)`).

Key patterns:
- `requireCsrf()` -- called on all POST endpoints
- `accountGate()` -- runs before every action; `requireAccount($pdo)` returns the signed-in account `{id, username, display_name, needs_setup}`
- `requireSession($pdo, $calId)` -- the account's name on this calendar, returns `{user_id, role, calendar_id}` (403 `NOT_JOINED` otherwise)
- `requireToken()` -- validates the `?c=` calendar token parameter
- JSON bodies are decoded into `$_POST` at the top of the file

Config is loaded from a fixed path: `/home/perthrel/grape_private/config.php`.

Passkey (WebAuthn) verification lives in `includes/webauthn.php`, required by api.php. See "Built: Passkeys" below.

The claim lockout lives in `includes/lockout.php` (`pinLockoutCheck`, `pinLockoutRecordFailure`, `pinLockoutReset`), called through the `checkAccountLockout` / `recordFailedAttempt` / `resetFailedAttempts` wrappers (in `includes/security.php`; the `Group` equivalents are in `includes/hubs.php`). It only guards `claim_name` / `claim_hub` now. The schedule is 5 min, 15 min, 2 hours, 2 days (config `pin_lockout`); `lockout_level` stores how far a name or Hub has escalated. The optimistic `UPDATE ... WHERE lockout_level = :level` stops two simultaneous wrong PINs escalating twice. The admin panel shows an Unlock control on locked users and Hubs. The super admin password login keeps its own per-IP lockout (`admin.max_attempts` / `admin.lockout_minutes`).

### calendar-*.js (~4,000 lines, 6 files)

The largest and most complex part. Loaded by `calendar.html` after `passkey.js`, `account-core.js` and `emoji.js`, in this order (see "Split scripts" above):

1. **calendar-core.js**: constants and config (TIME_SLOTS, STATUS_OPTIONS, CATEGORY_META, strength palette), utilities, pending changes queue and autosave, date helpers, the `els` object (caches all querySelector calls), the single `state` object, CSRF, access emoji gate and account errors (`accessFetch`), `apiGet` / `apiPost`
2. **calendar-users.js**: `loadCalendarMeta` (+ `applyMe`), `loadUsers`, People modal (your name first with a `person_edit` rename button, claimable old names, an eye button to show / hide someone's calendar read only via `toggleUserView` / `openUserView` / `closeUserView`), delete, submit and user UI, Hub bar, organiser Settings (access emoji, organiser marks), join / rename modal (`openUserModal`, `saveMyName`), claim modal (`openClaimModal`), `promptJoin`, `ensureAuthedForUser`
3. **calendar-grid.js**: availability loading, slot status, date filter, `renderDateRangeSkeleton`, past dates, `refreshCalendarValues`, `cycleStatus`, `onSlotClick`, `savePending` and reset operations
4. **calendar-rank.js**: calendar links, share, `buildRankScores`, sort / limit toggles, organiser message, chosen / frozen state, `renderRankings`, `debouncedRank`
5. **calendar-booking.js**: booking mode (cells, caps, Bookings card, close / reopen, polling)
6. **calendar-main.js**: event listeners, `init()` on `DOMContentLoaded` (validates the token, `Account.require()`, account badge, then loads the calendar)

Function-by-function locations are in `js_functions.md`.

### admin-*.js (~2,700 lines, 5 files)

Loaded by `admin.html` in this order: `admin-core.js` (password or account login, API helper, utilities, tabs), `admin-calendars.js` (Calendars tab and Users expander; unclaimed old names show dashed with "not claimed"), `admin-hubs.js` (Hubs tab), `admin-accounts.js` (Accounts tab: provider status, totals incl. unclaimed names / Hubs, username search, delete account), `admin-setup.js` (Setup tab).

### account-core.js, account.js (~620 lines)

`account-core.js` (`window.Account`) loads on every page after `passkey.js`: `require()` (resolves with `account_me` once signed in and set up, otherwise shows the sign-in panel or goes to `account.html`), `handleApiError()` (for `ACCOUNT_REQUIRED` / `ACCOUNT_SETUP` from any call), `renderBadge()` (name link to the profile page), `renderSignInBadge()` (signed-out **Sign in** button, home page); beside a title in `.acct-page-head` both shrink to an icon-only badge (`fitBadgeToHead()`, class `acct-head-compact`) instead of wrapping under the `h1`, `showSignIn(info, opts)` (`opts.dismissible` adds a close button, Escape and backdrop close), `toast()`, `logout()`. `account.js` runs `account.html`: first-time setup (username + profile name), profile edit, calendars and Hubs lists, sign-in methods (add / remove), sign out, delete account. `checkExistingSession()` runs on `DOMContentLoaded` so every tab file is loaded first.

### calendar.css (~1,650 lines)

Organised in sections:
- Layout and header
- Analysis section (rankings, organiser message, sort/limit toggles)
- Calendar grid (day columns, slots, status colours, organiser dots)
- Modals (People, join/rename, claim, info)
- Date filtering (banner, indicators)
- Chosen/frozen state
- Responsive breakpoint at 700px

### index.js (~2,100 lines)

Calendar creation form logic. Manages slots repeater, status repeater, date range picker, category toggles, and template URL parsing. Signed in, it shows the account badge and the optional organiser name defaults to the profile name; signed out, the form is a preview and `guardFormUntilSignedIn()` opens the closable sign-in panel on any tap (Hub links and unfinished set-up use `Account.require()`). Sends `create_calendar` and redirects to calendar.html. When opened with `?g=TOKEN`, loads Hub context via `group_meta` and passes `group_token` on create (no Hub organiser needed).

### hub.js (~960 lines)

Hub create and view page. Post-create save panel (copy, download, share, email, poster). Public link bar; organiser-only Share/Email (icon-only), Poster, Download, Settings and Remove, shown when `group_meta` says `is_organiser`. Old Hubs show **Claim this Hub** (`claim_hub`). See `js_functions.md` for function catalogue.

### cleanup.php (~490 lines)

CLI-only cron script. Operations include:
1. Delete calendars inactive for N days (Admin Setup or config; default 40). Respects `never_expires`.
2. Delete Hubs inactive for M days (separate `hub_inactive_days`; default follows calendar setting). Respects Hub `never_expires`; detaches child calendars.
3. Delete expired old PIN user sessions (skipped once migration 008 drops the table)
4. Prune old rate limit entries
5. Reset expired claim lockouts (old names); keeps `lockout_level`
6. Delete expired old Hub organiser sessions (skipped once migration 008 drops the table)
7. Reset expired claim lockouts (old Hubs)
8. Reset `lockout_level` after `pin_lockout.reset_after_days` (default 30) without a lockout; skipped until migration 002 is applied
9. Delete expired / orphaned `access_grants` and `access_attempts` rows unlocked and idle for `access_emoji.attempts_keep_days` (default 30); skipped until migration 003 is applied
10. Accounts: delete expired `account_sessions`, passkey sign-ups abandoned before finishing, `account_access` rows for deleted calendars/Hubs, and accounts unused for `accounts.inactive_days` (default 730) that have no names and no Hubs; skipped until migration 007 is applied
11. Invite only: delete pending `access_requests` older than 30 days and requests for deleted calendars/Hubs; skipped until migration 009 is applied

The inactivity default is 40 days everywhere (cleanup.php, admin Setup and `admin_save_config`); a value saved in Admin > Setup wins.

## Common Tasks

### Adding a new API endpoint

1. Add a new `if ($action === 'your_action' && $_SERVER['REQUEST_METHOD'] === 'POST')` block before the final `respond(404, ...)` in api.php
2. Call `requireCsrf()` for POST endpoints
3. The account gate already requires a signed-in account (unless the action name starts with `account_`, `oauth_` or `admin_`); call `requireAccount($pdo)` to get it
4. Call `requireSession($pdo, $calId)` if the account must have joined the calendar, and check `$session['role']` if organiser-only
5. Add sensitive POSTs to `isSensitivePostAction()` so they fail closed without the rate limiter
6. Log security events with `logSecurityEvent()` (never log cookies, provider IDs or other secrets)
7. Put any new shared helper in the matching `includes/` file (or a new one added to the `require_once` block), not in `api.php`

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

5. **Session accumulation**: Each sign-in creates a new `account_sessions` row (one per device). Sign out deletes it; cleanup.php deletes expired ones. Deleting an account removes all of them (FK cascade).

6a. **Never change `accounts.pepper`**: Google / Facebook identities are stored only as HMAC hashes keyed by it. A new pepper means nobody can sign in with Google or Facebook again (passkeys still work).

6b. **OAuth needs HTTPS and an exact redirect URI**: the providers reject a redirect that does not match `{accounts.base_url}/api.php?action=oauth_google|oauth_facebook` exactly. Local testing of Google / Facebook needs a real HTTPS host; passkeys work on `localhost`.

6. **No CORS for cross-origin**: The app is designed for same-origin use only. CORS headers are minimal (OPTIONS support for dev tooling only). The external API architecture has been designed but not yet built.

7. **getRelativeLuminance duplication**: This function exists in both calendar-core.js and index.js. If you change the luminance formula or contrast threshold, update both files.

8. **DateUtils IIFE**: A `DateUtils` utility with `normalizeDateToISO`, `preClean`, `expandTwoDigitYear`, and `isoToDMY` was designed but has NOT been implemented anywhere in the codebase yet.

## Planned Features (Not Yet Built)

- **Marshal scheduling integration** (Session Tracker x When RU Free): v5 plan finalised, not yet building. Starts with config.php + api.php changes.
- **External API**: Key-based access with CORS binding, tiered rate limiting, versioned routing. Architecture designed through v3.1.
- **URL token options**: 4-word "easy link" format under consideration as alternative to 8-char tokens.

## Built: Calendar Hubs

- UI label **Hub**; DB table `groups`. Pages: `hub.html`, `hub.js`, `hub.css`.
- Participant entry: `hub.html?g=TOKEN` lists child calendars for any signed-in account (opening it adds the Hub to that account's profile page via `account_hubs`).
- Hub organiser is the account in `groups.organiser_account_id` (set by `create_group` or `claim_hub`); `group_meta` returns `is_organiser`.
- Post-create save panel: auto copy, auto `.txt` download, Share, Email, Poster, acknowledgement checkbox gate.
- Public Hub link bar: copy link/code for everyone; Share, Email, Poster, Download for organiser only.
- Open contribution: anyone with Hub link can create a calendar via `index.html?g=TOKEN`; server rate limits apply.
- Attach existing calendar: calendar organiser only, from calendar page Hub bar (`add_calendar_to_group`).
- Remove from Hub: Hub organiser or calendar organiser (`remove_calendar_from_group`).
- `go/index.html`: Calendar/Hub toggle; accepts code or full URL (`normalizeLinkInput` prepends `https://` when needed).
- Hub rate limits in `includes/hubs.php`: max 50 calendars/Hub; 5 adds/IP/Hub/hour; 15 adds/IP/hour global (override via `config.php` `hub_limits`).

## Built: Passkeys

- One of the three account sign-in methods (with Google and Facebook). Per account, not per calendar.
- Server: `includes/webauthn.php` (dependency-free; CBOR/COSE parsing, ES256 + RS256 via `openssl_verify`). `includes/` is blocked by its own `.htaccess`. The subject is always an account (`webauthnAccountSubject()`), stored in `account_passkeys` (migration 007).
- Actions: `account_passkey_signup_begin|finish` (new account; the pending account id sits in the PHP session until the passkey is saved), `account_passkey_add_begin|finish` (signed in), `account_passkey_login_begin|finish` (usernameless). Listing and removing go through `account_methods` / `account_remove_method` (the last method can never be removed).
- `residentKey: 'required'` so the device stores the account; sign-in sends no `allowCredentials` and finds the account from the credential ID. The prompt is only opened from a button tap (Safari blocks WebAuthn calls not started by a user gesture).
- Challenges live in the PHP session (`$_SESSION['wruf_webauthn']`), 5-minute TTL, single-use.
- Passkeys are domain-bound: whenrufree.net and sandgroper.net passkeys are separate. Leave `webauthn.rp_id` unset unless you want to pin one domain.
- Browser: `passkey.js` (`window.Passkey`: `create`, `get`, `deviceLabel`, `isCancel`, `isDuplicate`, `signalRemoved`), used by `account-core.js` and `account.js`.
- The old per-calendar tables `user_passkeys` / `group_passkeys` are no longer read and are dropped by migration 008.
- Local test: there is no automated test suite in the repo. Verification was done with a throwaway PHP script that emulates an authenticator. On Windows PHP, `openssl_pkey_new()` needs `OPENSSL_CONF` pointing at `extras/ssl/openssl.cnf`.

## Built: Access Emoji

- Optional invite confirmation on top of the unique link: the organiser picks 1 of 35 emoji for a calendar or Hub; visitors pick it before any data loads, once per account (`account_access`). Organisers and people who already joined are never asked. Not a password - 1 in 35 odds, backed by throttling and the sign-in requirement.
- Stored as a position 0-34 (`calendars.access_emoji`, `groups.access_emoji`). The glyphs and names live only in `emoji.js` (`AccessEmoji.LIST`, written as `\u{...}` escapes to keep files ASCII). **Never reorder or replace entries** - it would silently change every saved emoji. Only append, and bump `ACCESS_EMOJI_COUNT` in `includes/access.php` to match.
- Effective emoji: the calendar's own, else its Hub's. A Hub grant opens every calendar in the Hub.
- Server: `includes/access.php`. `accessGate()` runs in api.php before the action dispatch and resolves the target from `?c=`, then `?g=`, then the POSTed `group_token` on `create_calendar`. Exempt: `csrf_token`, `diag`, `access_check`, `remove_calendar_from_group` (organiser only; exempting it avoids a loop when a Hub organiser removes a calendar that has its own emoji) and `admin_*`.
- Grants: random 64-hex, stored as SHA-256 in `access_grants`, 30 days. Browser keeps them in localStorage (`wruf_ag_c_{token}` / `wruf_ag_g_{token}`, in-memory fallback) and sends up to 3 in `X-Access-Grant` (calendar + Hub when relevant).
- Throttling: per IP + subject in `access_attempts` (3 wrong picks, then 5/15/120/2880 minute locks); per IP per hour in `api_rate_limit` (`aw` wrong picks 20, `nf` unknown codes 30). `access_check`, `set_access_emoji` and `set_group_access_emoji` are sensitive POSTs (fail closed without the limiter).
- Changing or removing an emoji revokes its grants and stored account picks (`accountAccessRevoke()`) and clears its attempt rows; the organiser gets a fresh grant in the response.
- The emoji itself is only returned by organiser-only `access_settings`; `calendar_meta` / `group_meta` expose just `{available, enabled, inherited}`. `share.php` hides the title in link previews for guarded calendars.
- Browser: `emoji.js` / `emoji.css` (`window.AccessEmoji`: grid, fullscreen picker, blocking gate popup, on/off field). `calendar-core.js`, `hub.js`, `index.js` wrap API calls in `accessFetch()`, which shows the gate on 403 `ACCESS_REQUIRED` and retries (max 3 tries).
- Self-disabling: until `migrations/003_access_emoji.sql` runs, `accessTablesReady()` is false, the gate is skipped and the UI hides the switch.
- Admin: badge + Remove emoji (`admin_set_access_emoji`, removal only) for organisers who forget it.

## Built: Booking Mode

- A calendar with `calendars.slot_capacity` set (1-20) is a booking form: each slot can be taken by that many people, first come, first served. `max_per_user` (1-20 or NULL) caps bookings per person per day (counted with `AND day = :day` in `bookingApplyChanges()`), or across the whole calendar when `per_user_total` = 1 (the day filter is dropped); `bookings_closed` locks it. All four are set only in `create_calendar` - there is no endpoint to change them later.
- Bookings are ordinary `availability` rows with status 1. The calendar has exactly one status (the booking label, default "Booked"); Blind privacy is rejected because the organiser must see who booked.
- Server rules live in `includes/booking.php`: `bookingColumnsReady()` (migration check), `bookingLimitValue()`, `bookingSettingsFromRow()`, `bookingLockCalendar()` (`SELECT ... FOR UPDATE` on the calendar row - this is what makes two simultaneous taps on the last place safe) and `bookingApplyChanges()` (cancellations first, then bookings with capacity / per-person checks; returns the refused ones). `save` uses them for booking calendars only; normal calendars keep the old upsert path.
- The organiser booking for themselves skips `max_per_user` (so they can block slots); removing someone else's booking is a `save` for that user with status 0. When closed, participants get 403 `BOOKINGS_CLOSED` from `save` and `reset_user`; the organiser can still save.
- Hidden booking calendars send the anonymous `summary` to accounts that have not joined, so they see Free / Full. Names follow `shouldShowRoster()`.
- Browser: `index.js` BOOKING MODE block (`makeLimitControl()`, `applyBookingMode()`), `calendar-booking.js` (`bookingInfo()`, `onBookingSlotClick()` / `setPendingBooking()` - taps become normal pending changes saved by `savePending()`, which drops the server's `rejected` slots and handles `BOOKINGS_CLOSED`; `queueBooking()` - organiser removals of other people, `renderBookings()`, `setBookingsClosed()`, `refreshBookings()` every 30 s and on tab focus). `renderRankings()`, `refreshCalendarValues()`, `onSlotClick()`, `renderLegend()` and `updateChosenBanner()` branch to the booking versions when `state.booking` is set.
- Self-disabling: until `migrations/004_booking.sql` runs, `features.booking` is false and the create page hides People per slot. Until `migrations/005_booking_total.sql` runs, `features.booking_total` is false, the Per day / In total toggle is hidden and every limit is per day (`bookingTotalColumnReady()`). Until `migrations/006_booking_styles.sql` runs, `features.booking_styles` is false, the Partly booked / Full colour and name settings are hidden and cells use the defaults (`bookingStyleColumnsReady()`; `calendars.partial_color` / `full_color` become the `--bk-partial` / `--bk-full` CSS variables via `applyBookingColors()`, and `partial_label` / `full_label` become `state.booking.partialLabel` / `fullLabel` in `calendar-users.js`).
- Tests: `$env:TEMP\wruf_booking_test.php` (SQLite, not in the repo) covers `includes/booking.php`; there is no browser test.

## Built: Invite only and Block

- **Who can join** is chosen only on the create page (`calendars.invite_only`, `groups.invite_only`, migration 009) and never changes. Direct link is the default. A calendar created inside an Invite only Hub is forced to `invite_only = 1`.
- **Requirement:** `membersRequirement()` - the Hub if its Hub is Invite only, else the calendar if it is, else nothing. So requests for calendars in an Invite only Hub go to the Hub organiser and one Hub approval opens every calendar in it.
- **Gate:** `membersGate()` runs right after `accessGate()` (the emoji is asked first; an approved request also satisfies the emoji in `accessAccountAllowed()`). It uses the same target resolution (`?c=`, `?g=`, POSTed `group_token` on `create_calendar`). Exempt: `csrf_token`, `diag`, `access_check`, `request_access`, `cancel_access_request`, `remove_calendar_from_group`, `admin_*`. `membersDecide()` returns `ok` / `blocked` / `none` / `pending` / `declined`, checked in this order: Hub organiser; Hub-level `blocked` request; the account's name on the calendar (`users.blocked` -> blocked, else ok - this also covers organisers and anyone who joined before); then the request status (a calendar-level approval still counts if the calendar later sits in an Invite only Hub). Non-ok responses are 403 `INVITE_ONLY` with `invite: {kind, status, title, profile_name}` or 403 `BLOCKED`; `Account.handleApiError()` shows the matching panel (`Account.showInvite()`).
- **Requests:** `access_requests` (`kind` calendar/group, `subject_id`, `account_id`, `display_name` snapshot, `status` pending/approved/declined/blocked). Approval only opens the gate; the person then joins with `join_calendar` as usual. Declined people get 403 `REQUEST_DECLINED` on `request_access`, but the organiser can approve them later. Limits: 10 requests per IP per hour (`rqa` + hour), 200 pending per calendar/Hub. No notifications - organisers see counts (`pending_requests` in `calendar_meta`, `group_meta`, memberships and admin lists).
- **Block, delete and report:** `manage_calendar_user` (calendar organiser, not on other organisers) is one call for the whole Manage person menu: `blocked` (1 block, 0 unblock), `delete` (1), and an optional report (`report_reason`, `report_details`). Applied in a fixed order - report first (while the name and account still exist), then the block, then the delete - so a report sent alongside a delete is never lost. Blocked people get 403 `BLOCKED` ("The organiser has blocked you from this calendar"), are hidden from other members in `users`, and their answers are left out of `availability`, the summary and Best Match. On booking calendars their bookings still count towards capacity and they stay listed. On Invite only Hubs the Hub organiser can block an approved person Hub-wide (request status `blocked`).
- **Clean-up:** requests are deleted with their calendar or Hub (`membersForgetSubject()`), when a name is deleted (`membersForgetCalendarAccount()`), with the account (FK cascade), and by cleanup step 11.
- **Browser:** create page `#joinModeField` (`initJoinModeField()`, `renderJoinMode()`, `isInviteOnly()`) and `#hideNamesRow`; `hub.js` `renderHubJoinMode()` and the organiser People card (`loadHubPeople()`, `decideHubRequest()`); `calendar-users.js` People modal (`loadPeopleRequests()`, `decidePeopleRequest()`, `openManageModal()`, `applyManageChoices()`, `updatePeopleBadge()`); `account.js` `renderWaiting()`; admin `inviteBadge()`.
- **Self-disabling:** until `migrations/009_invite_only.sql` runs, `membersTablesReady()` is false, nothing is gated, `features.invite_only` is false and the create pages hide Who can join and Hide names too.
- **Tests:** a throwaway SQLite script (not in the repo) covered `membersDecide()`, `membersRequirement()`, `membersDecideRequest()`, `membersApproveAll()` and `membersNamesHidden()`; there is no browser test.

## Built: People view and organiser marks

- **See someone's calendar (read only):** in the People list, rows where `canViewUser(u)` is true get an eye button (`visibility`, or `visibility_off` while that person is shown); it and a row tap call `toggleUserView(u)`. `openUserView(u)` sets `state.viewUserId`, shows `#viewBar` ("Viewing NAME") above the legend and adds `.is-viewing` to `.calendar-section`. `refreshCalendarValues()` paints `state.viewUserId || state.currentUserId`; `onSlotClick()` only shows a toast while viewing, so `state.pending` (your unsaved changes) is untouched and autosave keeps running. `closeUserView()` runs from the eye button (the list stays open), a tap on your own line, the bar's X, Escape (when no modal is open) or `loadUsers()` when the person is no longer viewable (blocked, deleted). `setViewBarText()` keeps the name current after a rename. Front end only: it draws rows `availability` already returned.
- **Organiser marks:** `calendars.show_organiser_marks` (migration 010, default 1). `calendar_meta` returns `organiser_marks` and `organiser_marks_available`; `set_organiser_marks` (organiser, sensitive POST) changes it. `shouldShowOrganiserDots()` returns `state.organiserMarks` on Open calendars, `true` on Hidden (only the organiser has the rows there, e.g. while viewing someone) and `false` on Blind and booking calendars. The switch sits in Calendar settings (`#settingsMarksField`, `organiserMarksSettingShown()`, `saveOrganiserMarks()`); the gear now shows for organisers when either the access emoji or this switch is available. Turning it off is a nudge, not privacy: on Open calendars the organiser's answers are still in Best Match names and the People view.
- **Self-disabling:** until `migrations/010_organiser_marks.sql` runs, `organiserMarksColumnReady()` is false, the edge always shows on Open calendars and the switch is hidden.

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
