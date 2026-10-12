# API Reference

Complete reference for the When RU Free backend API (`api.php`).

All endpoints use the URL pattern `api.php?action=ACTION_NAME&c=CALENDAR_TOKEN`.

Every endpoint lives in `api.php`; the shared helpers it calls (request parsing, CSRF, rate limiting, sessions, validation, Hub helpers, accounts, Google / Facebook sign-in, passkeys, lockout, access emoji, booking rules) live in `includes/*.php`, which are blocked from direct web access. See `handover.md` for the file map.

## Authentication

Everyone signs in with an account (Google, Facebook or a passkey) before they can open, join or create a calendar or Hub. There are no PINs and no per-calendar login tokens: who you are comes from the account cookie, and what you may do on a calendar comes from your name on it (`users.account_id`) and its role.

### Cookies and headers

| Item | Required | Description |
|------|----------|-------------|
| `wruf_account` cookie | Everything except the exemptions below | HttpOnly, Secure (on HTTPS), SameSite=Lax. 64-char hex; only its SHA-256 hash is stored (`account_sessions`). Lasts 30 days, renewed at most once a day while used. Sent automatically by the browser (`credentials: 'same-origin'`). |
| `X-CSRF-Token` | All POST requests | Session-based CSRF token |
| `X-Access-Grant` | Calendars / Hubs with an access emoji, when the account has no stored pick | Up to 3 comma-separated 64-char hex grants from `access_check` (see Access Emoji) |
| `Content-Type` | POST requests | `application/json` |

### Account gate

Before every action, `accountGate()` (`includes/accounts.php`) requires a signed-in account that has chosen a username and profile name. Exempt: `csrf_token`, `diag`, `get_site_config`, every `account_*` and `oauth_*` action, and every `admin_*` action (super admin has its own session).

- Not signed in: HTTP 401 `{ code: "ACCOUNT_REQUIRED", message: "Please sign in." }`
- Signed in but no username / profile name yet: HTTP 403 `{ code: "ACCOUNT_SETUP", message }`
- Before `migrations/007_accounts.sql` has run: HTTP 503 "Sign-in is not set up on this server yet".

The pages call `Account.handleApiError(data)` (`account-core.js`) on these codes: it shows the sign-in panel or sends the person to `account.html` to finish setup.

### Calendar roles

- **Joined:** the account has a row in `users` for that calendar. Actions that change availability or settings return 403 `{ code: "NOT_JOINED", message: "Join this calendar first." }` otherwise.
- **Organiser:** that row has `role = 'admin'` (the account that created the calendar).
- **Hub organiser:** `groups.organiser_account_id` is the account.

### Obtaining tokens

1. **CSRF token:** `GET api.php?action=csrf_token` returns `{csrf_token: "..."}`. Cached per browser session.
2. **Account session:** set by `oauth_google` / `oauth_facebook` (after the provider redirect) or `account_passkey_login_finish` / `account_passkey_signup_finish`. Removed by `account_logout`.

## Rate Limiting

All requests are rate-limited per IP address. Default: 120 requests per minute. Configurable in `config.php` via `rate_limit.per_minute`.

Client IP is taken from `REMOTE_ADDR` by default. `X-Forwarded-For` is honoured only when the direct connection comes from an IP listed in `config.php` `trusted_proxies` (empty by default).

If the rate-limit table is unavailable, read-only GET traffic continues; sensitive POST actions (`admin_login`, `admin_login_account`, `claim_name`, `claim_hub`, `create_calendar`, `create_group`, `save`, `join_calendar`, `account_update`, `account_remove_method`, `account_delete`, the six `account_passkey_*` actions, `access_check`, `set_access_emoji`, `set_group_access_emoji`, `set_bookings_closed`, `manage_calendar_user`, `admin_report_decide` and `set_organiser_marks`) return HTTP 503 instead of running unthrottled.

Exceeding the limit returns HTTP 429:
```json
{"status": "error", "message": "Too many requests"}
```

Extra per-IP limits on account actions (in `api_rate_limit`): profile changes 20/min (`acu`), new passkey accounts 10/hour (`aps`), passkey enrolment 20/min (`apr`), passkey sign-in 30/min (`apl`), Google / Facebook starts and callbacks 20/min each (`oas`, `oac`).

### Hub calendar limits

When adding a calendar to a Hub (`create_calendar` with `group_token`, or `add_calendar_to_group`), additional limits apply per IP:

| Limit | Default | Config key (`hub_limits`) |
|-------|---------|---------------------------|
| Max calendars per Hub | 50 | `max_calendars_per_hub` |
| Adds per IP per Hub per hour | 5 | `per_ip_per_hub_per_hour` |
| Adds per IP global per hour | 15 | `per_ip_global_per_hour` |

Exceeding a Hub limit returns HTTP 429 with a descriptive message.

## Claim Lockout (old PINs)

Names and Hubs created before accounts still have a PIN hash until someone claims them (`claim_name`, `claim_hub`). Wrong PINs use an escalating lockout, implemented in `includes/lockout.php`:

| Lockout | Length |
|---------|--------|
| 1st (5 wrong PINs in a row) | 5 minutes |
| 2nd | 15 minutes |
| 3rd | 2 hours |
| 4th and later | 2 days |

- The 5th wrong PIN returns HTTP 429 with code `ACCOUNT_LOCKED`, `message` (e.g. "Too many wrong PINs. This name is locked for 15 minutes.") and `retry_after` (seconds). While locked, every attempt returns the same code with "Try again in 2 hours." style wording.
- The escalation level (`lockout_level`) survives the lock expiring. It resets on a successful claim, a super admin Unlock, or after 30 days without a lockout (`cleanup.php`).
- Config (optional, `config.php`): `'pin_lockout' => ['max_attempts' => 5, 'schedule_minutes' => [5, 15, 120, 2880], 'reset_after_days' => 30]`. The last step repeats.
- `migrations/008_drop_pins.sql` (run about 90 days after accounts go live) deletes every remaining PIN hash; after that nothing can be claimed.

Admin login uses the same pattern per IP: after 5 failed password attempts (default), the IP is locked for 15 minutes. Configurable via `admin.max_attempts` and `admin.lockout_minutes` in `config.php`.

## Access Emoji

An organiser can give a calendar or Hub one of 35 emoji (stored as its position 0-34; the list lives in `emoji.js` and must never be reordered). The unique link is the invite; the emoji is a small confirmation that the person was told it. Implemented in `includes/access.php`; hidden until `migrations/003_access_emoji.sql` has run.

- **Which emoji applies:** a calendar's own emoji, else its Hub's emoji, else none.
- **Who is never asked:** the calendar or Hub organiser, anyone who already has a name on the calendar, and any account that picked the right emoji before (`account_access`, so it is asked once per account on any device). A right pick on a Hub also opens every calendar in that Hub.
- **Central gate:** before every action, a request naming a calendar (`c`), a Hub (`g`), or a Hub via `group_token` on `create_calendar` needs one of the above or a valid grant in `X-Access-Grant` when that calendar or Hub has an emoji. `c` wins when both `c` and `g` are present. Exempt: `csrf_token`, `diag`, `access_check`, `remove_calendar_from_group` (organiser only, returns no calendar data) and all `admin_*` actions.
- Otherwise: HTTP 403 `{ code: "ACCESS_REQUIRED", message, access: { kind: "calendar"|"hub", inherited } }`. The pages then show the emoji popup, call `access_check`, store the grant (`localStorage` `wruf_ag_c_<token>` / `wruf_ag_g_<token>`) and retry.
- **Grants** last 30 days and are stored only as SHA-256 hashes (`access_grants`). Changing or removing an emoji deletes its grants, the accounts' stored picks and wrong-pick counters.
- **Wrong picks** (per IP address and calendar/Hub, table `access_attempts`): 3 wrong picks lock for 5 minutes, then 15 minutes, 2 hours, 2 days (repeats). A correct pick clears the row; `cleanup.php` deletes rows after 30 days without a wrong pick.
- **Per-IP hourly caps** (in `api_rate_limit`): 20 wrong picks across all calendars/Hubs (`aw` + hour key), and 30 requests for calendar/Hub codes that do not exist (`nf` + hour key; after that every calendar/Hub request from that IP gets 429 until the hour ends).
- Config (optional, `config.php`): `'access_emoji' => ['max_attempts' => 3, 'schedule_minutes' => [5, 15, 120, 2880], 'global_per_hour' => 20, 'not_found_per_hour' => 30, 'grant_days' => 30, 'attempts_keep_days' => 30]`.
- `share.php` shows the generic link preview (no title) for calendars guarded by an emoji.

### GET get_site_config

Public site config for the create pages (no sign-in needed). **Response:** `{ status, config, features: { access_emoji: bool, booking: bool, booking_total: bool, booking_styles: bool, accounts: bool, hide_names: bool } }` - `features.access_emoji` is `true` once migration 003 has run (the create pages show the emoji switch only then); `features.booking` is `true` once migration 004 has run (the create page shows **People per slot** only then); `features.booking_total` is `true` once migration 005 has also run (the create page shows the **Per day / In total** toggle only then); `features.booking_styles` is `true` once migration 006 has also run (the create page shows the Partly booked / Full colour and name settings only then); `features.accounts` is `true` once migration 007 has run; `features.hide_names` is `true` once migration 009 has run (the create page shows the **Show everyone who has joined (but not their choices)** row only then).

### POST access_check

CSRF + `c` or `g`. Body: `emoji` (0-34). A right pick is also stored for the signed-in account.

**Response:** `{ status: "success", kind: "calendar"|"group", access_grant, expires_at }` (`access_grant: null` when no emoji applies). Wrong: 401 `{ code: "ACCESS_WRONG", message, attempts_left }`. Locked or over the hourly cap: 429 `{ code: "ACCESS_LOCKED", message, retry_after }`. Unknown code: 404.

### GET access_settings

Organiser view of the emoji: `c` (calendar organiser) or `g` (Hub organiser).

**Response:** `{ status, available, emoji (0-34 or null), hub_emoji (calendar only: true when the Hub has an emoji) }`

### POST set_access_emoji

Calendar organiser only. CSRF + `c`. Body: `emoji` (0-34, or `null` to remove). Deletes existing grants, stored account picks and wrong-pick rows.

**Response:** `{ status, emoji, access: {available, enabled, inherited}, access_grant?, expires_at? }`

### POST set_group_access_emoji

Hub organiser only. CSRF + `g`. Body: `emoji` (0-34 or `null`). Deletes existing Hub grants and stored account picks.

**Response:** `{ status, emoji, access_grant?, expires_at? }`

---

## Block and private names

Implemented in `includes/members.php`; the `blocked` and `hide_names` columns need `migrations/009_invite_only.sql` (reported as `features.hide_names`).

- **Joining:** anyone signed in with the link can open and join a calendar or Hub. The link is the only access control.
- **Gate:** runs after the access emoji gate, for calendar-scoped actions only. A person the organiser has blocked on that calendar gets HTTP 403 `{ code: "BLOCKED", message }` everywhere on it. Exempt actions: `csrf_token`, `diag`, `access_check` and every `admin_*` action.
- **Blocking:** `users.blocked` blocks one person on one calendar. Their availability is left out of `availability` and its `summary` (not on booking calendars, where their bookings still hold their places), and other members don't see them in `users`. Set or cleared from the Manage person menu, which keeps their answers.
- **Private names:** `calendars.hide_names` (Hidden calendars only) makes members see only themselves, the organisers and a total; it is the Hidden default and the organiser opts out by ticking **Show everyone who has joined (but not their choices)**. Blind calendars always hide names. Reported as `names_hidden` by `users`.

### POST manage_calendar_user

CSRF + `c`, calendar organiser only. One call for the whole Manage person menu. Body: `user_id`, plus any of `blocked` (1 block, 0 unblock), `delete` (1) and a report (`report_reason`, optional `report_details`). Organisers cannot be changed here, and the organiser cannot act on their own row. Choices are applied in a fixed order - the report first (while the name and account still exist), then the block, then the delete - so a report sent alongside a delete is never lost. Block is reversible and keeps the answers; delete cascades to availability. At least one of `blocked` or `delete` is required (400 otherwise). **Response:** `{ status, blocked, deleted, reported, report_id }`

---

## Accounts

Implemented in `includes/accounts.php` (sessions, profile, memberships, deletion), `includes/oauth.php` (Google / Facebook) and `includes/webauthn.php` (passkeys). Needs `migrations/007_accounts.sql` and the `accounts` block in `config.php` (see `deployment.md`).

An account stores only: a private **username** (3-20 lowercase letters, numbers or `_`, unique, never shown to other people), a **profile name** (the default name on calendars, up to 32 characters), a keyed hash (HMAC-SHA-256 with `accounts.pepper`) of each Google / Facebook user ID, passkey public keys, and which calendars and Hubs it belongs to. No email, real name or picture is requested or kept.

### GET account_me

Works when signed out. **Response:** `{ status, available, signed_in, needs_setup, username, display_name, methods: { google, facebook, passkey } }`. `available` is false until migration 007 has run; `methods.google` / `methods.facebook` are true when their keys are in `config.php`.

### POST account_update

CSRF. Signed in (setup not required). Body: `username` and/or `display_name`. Both must be set before the account can be used.

Reserved usernames (`admin`, `administrator`, `root`, `support`, `help`, `owner`, `organiser`, `organizer`, `system`, `moderator`, `staff`, `whenrufree`, `wruf`, `null`, `undefined`, `guest`) are refused, except for accounts listed in `config.php` `admin.account_ids`.

**Response:** `{ status, username, display_name, renamed, conflicts }` - a new profile name is copied to every calendar name that follows it (`name_custom = 0`); `renamed` counts them and `conflicts` lists calendar titles where that name was already taken (those keep the old name). Errors: 400 `USERNAME_INVALID`, 400 `USERNAME_RESERVED`, 400 `NAME_INVALID`, 409 `USERNAME_TAKEN`.

### POST account_logout

CSRF. Deletes the session row and clears the cookie. **Response:** `{ status }`

### GET account_methods

**Response:** `{ status, methods: [{ type: "google"|"facebook"|"passkey", id, label, created_at, last_used_at }] }`

### POST account_remove_method

CSRF. Body: `type`, `id`. The last method can never be removed (409 `LAST_METHOD`). **Response:** `{ status, removed, methods }`

### GET account_memberships

**Response:** `{ status, calendars: [{ token, title, start_date, end_date, role, display_name, name_custom, hub: {token, title}|null, blocked }], hubs: [{ token, title, is_organiser, calendar_count }] }` - calendars the account has a name on, and Hubs it organises or has opened. `blocked` is `true` when the organiser has blocked the account on that calendar.

### GET account_delete_preview

**Response:** `{ status, calendars: [titles], hubs: [titles] }` - what deleting the account would remove (calendars and Hubs it organises).

### POST account_delete

CSRF. Body: `confirm` (the username). Deletes the calendars and Hubs it organises (calendars in a deleted Hub stay, detached), its names and availability on every other calendar, and all its sign-in data, then signs out. Mismatch: 400 `CONFIRM_MISMATCH`. **Response:** `{ status }`

### Passkeys (POST + CSRF)

Discoverable (usernameless) WebAuthn credentials, stored in `account_passkeys`. No libraries: ES256 and RS256 keys, attestation `none`, user verification required. Challenges are single-use and expire after 5 minutes. A passkey is limited to 10 per account.

| Action | Needs | Body | Response |
|--------|-------|------|----------|
| `account_passkey_signup_begin` | Signed out | - | `{status, publicKey}` for `navigator.credentials.create()`; creates a pending account |
| `account_passkey_signup_finish` | Same browser session | `credential`, optional `device_label` | `{status, needs_setup: true}`; signs in |
| `account_passkey_add_begin` | Signed in | - | `{status, publicKey}` |
| `account_passkey_add_finish` | Signed in | `credential`, optional `device_label` | `{status, methods}` |
| `account_passkey_login_begin` | - | - | `{status, publicKey}` for `navigator.credentials.get()` (no `allowCredentials`) |
| `account_passkey_login_finish` | - | `credential` | `{status, needs_setup}`; signs in |

`device_label` is reduced server-side to letters, digits, spaces and `. ( ) / -`, max 40 chars. Errors: 409 `PASSKEY_EXISTS` (this device is already set up), 409 `PASSKEY_LIMIT`, 404 `NO_PASSKEY` (the credential is not linked to any account; the page asks the browser to forget it), 400 `PASSKEY_EXPIRED` (challenge too old) or 400 when verification fails.

### GET oauth_start

Browser navigation, not fetch. Query: `provider` (`google` or `facebook`), optional `mode=link` (add to the signed-in account), optional `return` (a same-site path, cleaned by `oauthCleanReturn`). Sets the signed `wruf_oauth` state cookie (10 minutes; state, OIDC nonce, PKCE verifier, mode, return path) and redirects to the provider.

- Google: scope `openid` only, authorization code + PKCE; the ID token's `sub` is the only value used.
- Facebook: `public_profile` (the minimum Facebook allows); only the user `id` is read from the Graph API.

### GET oauth_google, GET oauth_facebook

The provider redirects back here. Verifies the state cookie, exchanges the code, then signs in (creating the account if new) or links the identity to the signed-in account. Redirects to the return path (or `account.html` for new accounts and link results) with `?signin=` set to `ok`, `new`, `linked`, `taken` (that Google / Facebook login already belongs to another account), `cancelled`, `failed`, `expired` or `unavailable`.

Redirect URIs to register with the providers: `{base_url}/api.php?action=oauth_google` and `{base_url}/api.php?action=oauth_facebook`.

---

## Calendars and Hubs

### GET csrf_token

Returns a CSRF token for the current session.

**Response:**
```json
{"status": "success", "csrf_token": "a1b2c3..."}
```

### GET calendar_meta

Returns full calendar configuration and metadata.

**Parameters:** `c` (calendar token)

**Response:** `{ status, calendar: {...}, account: { profile_name, me, claimable } }`

- `account.me`: `{ id, display_name, role, name_custom }` for the signed-in account's name on this calendar, or `null` until it joins.
- `account.claimable`: `true` when old PIN names are still waiting to be claimed on this calendar.

**`calendar` fields:**

| Field | Type | Description |
|-------|------|-------------|
| id | int | Internal calendar ID |
| token | string | URL token (8-64 chars) |
| title | string | Calendar title (max 80 chars) |
| category | string | JSON array of category keys |
| slots | array | Ordered slot labels |
| statuses | array | Status options with label, color, weight |
| start_date | string | YYYY-MM-DD |
| end_date | string | YYYY-MM-DD |
| exclude_weekends | int | 0 or 1 |
| date_filter_mode | string | "all", "only", or "except" |
| date_filter_dates | array/null | Selected filter dates |
| is_private | int | 0=open, 1=hidden, 2=blind |
| rank_sort_order | string | "score" or "date" |
| organiser_message | string | Organiser's note (max 250 chars) |
| organiser_message_max | int | Server-defined char limit |
| chosen_date | string/null | Locked-in date (YYYY-MM-DD) or null |
| chosen_slot | string/null | Locked-in slot ID or null |
| group | object/null | `{token, title}` when calendar belongs to a Hub |
| access | object | `{available, enabled, inherited}` - access emoji support and whether one guards this calendar (the emoji itself is never returned) |
| slot_capacity | int/null | Booking calendars: people per slot (1-20). `null` = normal availability poll |
| max_per_user | int/null | Booking calendars: bookings each person can hold (1-20), `null` = no limit |
| per_user_total | bool | `true` = `max_per_user` counts across the whole calendar, `false` = per day |
| partial_color / full_color | string/null | Booking calendars: `#rrggbb` cell colours for partly booked / full slots, `null` = default (orange / red) |
| partial_label / full_label | string/null | Booking calendars: names for partly booked / full slots, `null` = default ("Partly booked" / "Full") |
| bookings_closed | bool | Booking calendars: `true` when the organiser has closed bookings |
| hide_names | bool | Hidden calendars: names are private (the organiser did not tick **Show everyone who has joined (but not their choices)**) |
| names_private | bool | `true` on Blind, or Hidden with `hide_names` (members see only themselves, organisers and a total) |
| null_color | string/null | Availability calendars: `#rrggbb` fill for slots nobody has answered (one of five greys), `null` = the default light grey. Always `null` before migration 012 |
| null_color_available | bool | `true` once `migrations/012_null_color.sql` has run and the calendar is not a booking calendar |
| default_status | int/null | Availability calendars: 1-based status option every slot starts on (the **Default option**), `null` = slots start un-answered. Always `null` before migration 013 |
| default_status_available | bool | `true` once `migrations/013_slot_default.sql` has run and the calendar is not a booking calendar |
| organiser_marks | bool | `true` (default) when the organiser's answers show as a coloured slot edge on Open calendars; always `true` before migration 010 |
| organiser_marks_available | bool | `true` once `migrations/010_organiser_marks.sql` has run (the organiser can then change `organiser_marks`) |

Opening a calendar with `from_hub=1&g=HUB_TOKEN` (matching its Hub) counts as Hub activity.

### GET group_meta

Hub listing (secret URL). Parameter: `g` (hub token). Also remembers the Hub on the account's profile page (`account_hubs`).

**Response:** `{ group: {title, token, calendar_count, organiser_name, is_organiser, claimable, access: {available, enabled, inherited}}, calendars: [{token, title, start_date, end_date, is_frozen, slot_capacity, last_activity}] }`. `claimable` is `true` for an old Hub whose organiser PIN has not been claimed yet. `is_frozen` is also `true` for a booking calendar whose bookings are closed; `slot_capacity` is non-null for booking calendars.

### POST create_group

Creates a Hub organised by the signed-in account. CSRF required. Body: `title`, optional `organiser_name` (blank = profile name), optional `access_emoji` (0-34).

**Response:** `{ status, token, title }`

### POST claim_hub

Claims an old Hub (created before accounts) once, with its organiser PIN. CSRF + `g`. Body: `pin`. The PIN hash is then deleted and `organiser_account_id` is set.

**Response:** `{ status, organiser_name }`. Wrong PIN: 401 `Wrong PIN`; locked: 429 `ACCOUNT_LOCKED` (see Claim Lockout); already claimed: 409 `ALREADY_CLAIMED`.

### POST add_calendar_to_group

Attach calendar to hub. CSRF + `c`, calendar organiser only. Body: `group_token` (Hub code or valid token string).

Calendar must not already belong to a Hub. Subject to Hub capacity and per-IP rate limits (see above). If the Hub has an emoji and the account has not picked it, `X-Access-Grant` must include a grant for that Hub, otherwise 403 `HUB_ACCESS_REQUIRED`.

**Response:** `{ status, group: { token, title } }`

### POST remove_calendar_from_group

Detach calendar from its Hub. CSRF + `c`. Allowed for the calendar organiser **or** the Hub organiser.

**Response:** `{ status: "success" }`

### GET users

Returns all names on a calendar.

**Parameters:** `c` (calendar token)

**Response:**
```json
{
  "status": "success",
  "users": [
    {"id": 1, "display_name": "Pete", "role": "admin", "mine": true, "claimable": false},
    {"id": 2, "display_name": "Sally", "role": "member", "mine": false, "claimable": true}
  ],
  "total": 2,
  "names_hidden": false
}
```

`mine` marks the signed-in account's name; `claimable` marks an old PIN name that nobody has claimed yet.

- The organiser gets everyone, each with `blocked` (true when blocked).
- Others never see blocked people, except on booking calendars (their bookings still hold places).
- When names are private (Blind, or Hidden with `hide_names`) and the caller is not the organiser, `names_hidden` is `true` and `users` holds only the caller, the organisers and claimable old names. `total` is the number of people on the calendar, not counting blocked people the caller can't see.

### GET availability

Returns availability data for a date range.

**Parameters:** `c`, `from` (YYYY-MM-DD), `to` (YYYY-MM-DD)

**Response:**
```json
{
  "status": "success",
  "rows": [
    {"calendar_id": 1, "user_id": 1, "day": "2026-03-15", "slot": "Morning", "status": 1}
  ]
}
```

Status values: 0 = NULL (no selection), 1..N = status option index.

The response also has `summary: [{day, slot, status, count}]` (anonymous counts) whenever `rows` holds only the caller's own rows (Hidden participant, Blind). Booking calendars in Hidden mode also send `summary` to accounts that have not joined, so everyone can see which slots are free.

Blocked people's rows are left out of `rows` and `summary` on normal calendars; on booking calendars they stay, so capacity stays correct.

The page's read-only "see someone's calendar" view (People list) and the organiser's coloured slot edge only draw rows returned here, so they can never show more than the privacy mode allows.

---

## Calendar Creation

### POST create_calendar

Creates a new calendar. The signed-in account becomes its organiser.

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | No | Calendar title (max 80 chars) |
| category | string | No | JSON array of category keys (max 3). Default: `["groups"]` |
| slots | array | Yes | 1-6 slot labels (max 20 chars each) |
| statuses | array | No | 1-5 status options with label/color/weight |
| start_date | string | Yes | YYYY-MM-DD (2026-2030) |
| end_date | string | Yes | YYYY-MM-DD (max 360 days from start) |
| exclude_weekends | int | No | 1 to exclude weekends |
| date_filter_mode | string | No | "all", "only", or "except" |
| is_private | int | No | 0=open, 1=hidden, 2=blind |
| admin_name | string | No | Organiser name on this calendar (max 32 chars). Blank = the account's profile name |
| group_token | string | No | Hub token - assigns new calendar to that Hub (valid token only; no Hub organiser needed; rate limited; needs the Hub's emoji if it has one) |
| access_emoji | int | No | 0-34: the calendar's own access emoji |
| hide_names | int | No | Hidden calendars (`is_private` 1) only: 1 = names are private (members see only themselves, the organisers and a total). Omit it for the Hidden default of showing who has joined. Blind always hides names. Ignored for other modes |
| null_color | string | No | Availability calendars only: `#rrggbb` from the five greys (`#000000`, `#404040`, `#808080`, `#bfbfbf`, `#ffffff`) for slots nobody has answered. 400 if not one of them; ignored until migration 012 has run |
| default_status | int | No | Availability calendars only: 1-5 (the **Default option** every slot starts on, clamped to the option count). 400 if out of range; ignored until migration 013 has run, and never stored for booking calendars |
| slot_capacity | int | No | 1-20: makes a booking calendar (people per slot). Omit, `null` or 0 for a normal availability poll |
| max_per_user | int | No | Booking only: 1-20 bookings per person (organiser exempt); omit, `null` or 0 for no limit |
| per_user_total | int | No | Booking only: `1` = count `max_per_user` across the whole calendar, otherwise per day. Ignored without `max_per_user`; 400 if migration 005 has not run |
| partial_color / full_color | string | No | Booking only: `#rrggbb` cell colours for partly booked / full slots (400 if not `#rrggbb`). Ignored until migration 006 has run |
| partial_label / full_label | string | No | Booking only: names for partly booked / full slots, same rules as option labels (400 if invalid). Ignored until migration 006 has run |

Booking calendars must send exactly one status (its weight is forced to 1) and cannot use Blind privacy (`is_private` 2 returns 400). Before migration 004 a `slot_capacity` returns 400 "Booking is not available yet". Booking settings, the default option and the un-answered colour cannot be changed after creation.

**Response:**
```json
{"status": "success", "token": "3PNpKJTs"}
```

---

## Names on a calendar

Names use letters, numbers, spaces, `'` and `-` (up to 32 characters) and are unique per calendar. Each account has at most one name per calendar.

### POST join_calendar

CSRF + `c`. Body: optional `display_name` (blank = the profile name; anything else is a per-calendar name with `name_custom = 1`).

**Response:** `{ status, user: { id, display_name, role: "member", name_custom } }`. Errors: 409 `ALREADY_JOINED`, 409 `NAME_TAKEN` (that name is already on the calendar).

### POST rename_user

CSRF + `c`, joined. Body: `user_id` (defaults to your own) and `display_name`, or `use_profile: true` (your own name only) to go back to following the profile name. Renaming someone else is organiser only.

**Response:** `{ status, display_name, name_custom }`. Name taken: 409 `NAME_TAKEN`.

### POST claim_name

Claims an old name (created before accounts) once, with its PIN. CSRF + `c`. Body: `user_id`, `pin`. The account must not already have a name on the calendar. The name, its role and its availability then belong to the account and the PIN hash is deleted.

**Response:** `{ status, user: { id, display_name, role, name_custom } }`. Wrong PIN: 401 `Wrong PIN`; locked: 429 `ACCOUNT_LOCKED`; 409 `ALREADY_CLAIMED` or `ALREADY_JOINED`.

---

## Availability

### POST save

Saves availability changes. Blocked if calendar is frozen (chosen_date + chosen_slot set).

**Joined.** Body:

```json
{
  "user_id": 1,
  "changes": {
    "2026-03-15": {"Morning": 1, "Evening": 0},
    "2026-03-16": {"Morning": 2}
  }
}
```

`user_id` must be your own name unless you are the organiser. Status 0 deletes the record. Status 1..N sets the value.

**Frozen response (403):**
```json
{"status": "error", "message": "This calendar has been finalised. The organiser has locked in a date and slot."}
```

**Booking calendars** (`slot_capacity` set; rules in `includes/booking.php`):
- The save runs in a transaction that first locks the calendar row (`SELECT ... FOR UPDATE`), so two people tapping the same slot are handled one after the other.
- Each day must be inside the calendar's date range and each slot one of its slot labels; status must be 0 (cancel) or 1 (book). Anything else returns 400.
- Cancellations run before bookings, so swapping a booking in one save works.
- A booking is refused when the slot already has `slot_capacity` people, or when the person already has `max_per_user` bookings on that day (or on the whole calendar when `per_user_total` is set). The organiser booking for themselves is exempt from the per-person limit (so they can block slots), but not from capacity.
- When bookings are closed, participants get 403 `{ code: "BOOKINGS_CLOSED", message: "Bookings are closed." }`; the organiser can still save (e.g. remove someone's booking by saving status 0 for that user).

**Booking response:** `{ status: "success", rejected: [{ day, slot, reason: "full"|"limit" }] }` - accepted changes are saved; the client reverts the rejected ones and reloads.

### POST reset_user

Deletes all availability for a user. Self or organiser. On a booking calendar with bookings closed, participants get 403 `BOOKINGS_CLOSED`.

**Joined.** Body: `user_id`

### POST reset_all

Deletes all availability for all users. Organiser only.

**Organiser only.** Body: `confirm` ("RESET")

---

## Organiser Settings

### POST save_date_filter

Updates date filter selections. Organiser only.

**Organiser only.** Body: `dates` (array of YYYY-MM-DD strings)

### POST save_rank_sort

Sets the ranking sort order. Organiser only.

**Organiser only.** Body: `order` ("score" or "date")

### POST save_organiser_message

Updates the organiser note. Organiser only.

**Organiser only.** Body: `message` (string, max 250 chars)

### POST choose_slot

Locks in a chosen date+slot, freezing the calendar. Organiser only.

**Organiser only.** Body: `chosen_date` (YYYY-MM-DD), `chosen_slot` (slot ID, max 50 chars)

**Response:**
```json
{"status": "success", "chosen_date": "2026-03-20", "chosen_slot": "Dinner"}
```

Booking calendars return 400 ("Booking calendars use Close bookings instead").

### POST unchoose_slot

Reopens a frozen calendar by clearing the chosen date+slot. Organiser only.

**Organiser only.** No body required.

### POST set_bookings_closed

Closes or reopens bookings on a booking calendar. Organiser only; sensitive POST.

**Organiser only.** Body: `closed` (1 = close, 0 = reopen). Returns 400 for a normal calendar or before migration 004.

**Response:** `{ status: "success", bookings_closed: true|false }`

### POST set_organiser_marks

Shows or hides the organiser's own answers as a coloured left edge on everyone's time slots (Open calendars; the edge never shows on Hidden calendars for members, Blind or booking calendars). Organiser only; sensitive POST.

**Organiser only.** Body: `on` (1 = show, 0 = hide). Returns 503 before migration 010, 403 for anyone but the organiser.

**Response:** `{ status: "success", organiser_marks: true|false }`

---

## Super Admin Endpoints

These require a separate admin session via `admin_login` or `admin_login_account`. Not exposed to calendar users, and not affected by the account gate.

### POST admin_login

Authenticates as super admin using the password in `config.php` (`admin.password`, plain or bcrypt), with a per-IP lockout (`admin.max_attempts` / `admin.lockout_minutes`).

**Response:** `{ status, admin_token, csrf_token }` - a 1-hour admin session. Send `admin_token` as the `X-Admin-Token` header on admin actions.

### POST admin_login_account

CSRF. Opens the same 1-hour admin session for the signed-in account when its id is listed in `config.php` `admin.account_ids` (e.g. `'account_ids' => [1]`). The password login stays as a fallback. `admin.html` tries this silently on load (unless the tab has logged out) and from its **Use my When RU Free account** button.

**Response:** `{ status, admin_token, csrf_token }`. Errors: 403 `ADMIN_ACCOUNT_OFF` (no `account_ids` or accounts tables missing), 401 `ACCOUNT_REQUIRED` (not signed in), 403 `NOT_ADMIN` (account not listed; logged as `ADMIN_ACCOUNT_DENIED`).

### GET admin_calendars

Lists all calendars with user counts. Each row may include optional Hub fields: `group_id`, `group_token`, `group_title` (null when not in a Hub), plus `access_emoji` and `group_access_emoji` (0-34 or null), and `slot_capacity` (people per slot for booking calendars, else null).

### POST admin_set_permanent

Sets `never_expires` flag. Body: `calendar_id`, `never_expires` (0/1)

### POST admin_delete_calendar

Deletes a calendar and all associated data. Body: `calendar_id`

### GET admin_groups

Lists all Hubs with calendar counts. Each Hub includes `locked_seconds` (seconds left on a claim lockout, 0 if not locked) and `access_emoji` (0-34 or null).

### GET admin_group_calendars

Lists child calendars for a Hub. Query param: `group_id`

### POST admin_set_group_permanent

Sets `never_expires` on a Hub. Body: `group_id`, `never_expires` (0/1)

### POST admin_delete_group

Deletes a Hub. Child calendars are detached (`group_id` set to NULL), not deleted. Body: `group_id`

### GET admin_list_users

Lists users for a specific calendar. Query param: `calendar_id`. Each user: `{id, display_name, role, locked_seconds, has_account, blocked}` (`locked_seconds` is 0 when not locked; `has_account` is false for an old name not claimed yet; `blocked` is true when the organiser blocked them).

### POST admin_delete_user

Deletes a specific user. Body: `calendar_id`, `user_id`

### POST admin_unlock_user

Clears a claim lockout on an old name (failed attempts and escalation level). CSRF + admin session. Body: `calendar_id`, `user_id`. **Response:** `{status}`

### POST admin_unlock_group

Clears a claim lockout on an old Hub. CSRF + admin session. Body: `group_id`. **Response:** `{status}`

### POST admin_set_access_emoji

Removes the access emoji from a calendar or Hub (for an organiser who forgot it). CSRF + admin session. Body: `kind` (`calendar` or `group`), `id`. Only removal is allowed (`emoji` must be absent or null). Deletes its grants, stored account picks and wrong-pick rows. **Response:** `{status}`

### GET admin_accounts

Accounts tab. Optional query `q` (username prefix, `[a-z0-9_]{1,20}`).

**Response:** `{ status, available, methods: { google, facebook, passkey }, totals: { accounts, active_30d, google, facebook, passkeys, unclaimed_names, unclaimed_hubs } | null, accounts: [{ id, username, display_name, created_at, last_seen_at, calendar_count, hub_count }] }` - up to 100 accounts, most recently seen first. `available` is false (and `totals` null) before migration 007.

### POST admin_delete_account

CSRF + admin session. Body: `account_id`. Same as the person deleting their own account. **Response:** `{status}`

### GET admin_reports

Reports tab. Needs `migrations/011_report_users.sql`.

**Response:** `{ status, available, open, reasons, reports }` - `available` false (with `open` 0 and no `reports`) until migration 011 has run; `open` is the number still awaiting a decision and `reasons` is the key => label map the organiser saw. Up to 200 reports, open ones first then newest first. Each report: `{ id, calendar_id, calendar_title, calendar_token, user_id, account_id, display_name, account_username, account_display_name, reporter_username, reason, details, status, created_at, decided_at }` - `display_name` is the name as it was when reported, `account_username` is the reported account's private username (null for an unclaimed old name) and `reporter_username` identifies the organiser.

### POST admin_report_decide

CSRF + admin session. Body: `report_id`, `decision` = `dismiss` (close the report, leave the person alone) or `delete` (delete the reported account and everything it owns, then close the report - this also closes every other open report naming that account). Deleting needs the report to name an account (400 "That person has no account to delete. Dismiss the report instead."), and an already-closed report is 409. **Response:** `{ status }`

---

## Security Events Logged

All security-relevant actions are logged to `grape_private/logs/security_YYYY-MM.log`. Secrets, cookies, provider IDs and emails are never logged; accounts appear only by numeric `account_id`.

| Event | Trigger |
|-------|---------|
| ACCOUNT_CREATED | New account (`provider`: google, facebook or passkey) |
| ACCOUNT_SIGNIN | Sign-in (`provider`) |
| ACCOUNT_METHOD_LINKED | Google, Facebook or a passkey added to an account |
| ACCOUNT_METHOD_TAKEN | Tried to add a Google / Facebook login that belongs to another account |
| ACCOUNT_METHOD_REMOVED | Sign-in method removed |
| ACCOUNT_DELETED | Account deleted by its owner |
| ACCOUNT_CONFIG_MISSING | `accounts.pepper` missing or invalid in `config.php` |
| OAUTH_STATE_INVALID | Google / Facebook return with a missing or wrong state cookie |
| OAUTH_FAILED | Code exchange or token check failed |
| PASSKEY_COUNTER_REPLAY | Passkey sign counter went backwards (possible cloned authenticator); sign-in rejected |
| CALENDAR_CREATED | Calendar created |
| HUB_CREATED | Hub created |
| NAME_CLAIMED | Old PIN name claimed by an account |
| NAME_CLAIM_FAILED | Wrong PIN when claiming a name |
| ACCOUNT_LOCKED | 5th wrong PIN locks an old name (includes `minutes`) |
| HUB_CLAIMED | Old Hub claimed by an account |
| HUB_CLAIM_FAILED | Wrong organiser PIN when claiming a Hub |
| GROUP_LOCKED | 5th wrong PIN locks an old Hub (includes `minutes`) |
| USER_RESET_SELF | User resets own availability |
| ADMIN_RESET_USER | Organiser resets another user |
| ADMIN_RESET_ALL | Organiser resets all users |
| ORGANISER_DELETE_USER | Organiser deletes a participant |
| USER_BLOCKED | Organiser blocks or unblocks a person on a calendar (`blocked`) |
| CHOOSE_SLOT | Organiser locks in a date+slot |
| UNCHOOSE_SLOT | Organiser reopens the calendar |
| BOOKINGS_CLOSED | Organiser closes bookings on a booking calendar |
| BOOKINGS_REOPENED | Organiser reopens bookings |
| ADD_CALENDAR_TO_GROUP | Calendar attached to a Hub |
| REMOVE_CALENDAR_FROM_GROUP | Calendar detached from a Hub |
| ADMIN_DELETE_CALENDAR | Super admin deletes a calendar |
| ADMIN_DELETE_USER | Super admin deletes a user |
| ADMIN_DELETE_ACCOUNT | Super admin deletes an account |
| ADMIN_SET_PERMANENT | Super admin toggles never_expires |
| ADMIN_SET_GROUP_PERMANENT | Super admin toggles never_expires on a Hub |
| ADMIN_DELETE_GROUP | Super admin deletes a Hub |
| ADMIN_UNLOCK_USER | Super admin clears a claim lockout on an old name |
| ADMIN_UNLOCK_GROUP | Super admin clears a claim lockout on an old Hub |
| ADMIN_SAVE_CONFIG | Super admin saves site config |
| ACCESS_FAILED | Wrong access emoji picked (includes `kind`, `id`) |
| ACCESS_LOCKED | 3rd wrong pick locks this IP out of that calendar/Hub (includes `minutes`) |
| ACCESS_GRANTED | Right emoji picked; grant issued |
| ACCESS_EMOJI_CHANGED | Organiser sets or removes an emoji (`enabled`) |
| ADMIN_ACCESS_EMOJI_CLEARED | Super admin removes an emoji |
| NOT_FOUND_THROTTLED | IP hit the hourly cap for calendar/Hub codes that do not exist |
| RATE_LIMIT_ERROR | Rate-limit table unavailable |
| ADMIN_LOGIN_FAILED | Invalid admin password |
| ADMIN_LOGIN_LOCKED | Admin login lockout triggered (per IP) |
| ADMIN_LOGIN_SUCCESS | Successful admin login (`method`: `password` or `account`, with `account_id`) |
| ADMIN_ACCOUNT_DENIED | Signed-in account not in `admin.account_ids` tried to open the admin panel (`account_id`) |
