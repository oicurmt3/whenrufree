# API Reference

Complete reference for the When RU Free backend API (`api.php`).

All endpoints use the URL pattern `api.php?action=ACTION_NAME&c=CALENDAR_TOKEN`.

## Authentication

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-CSRF-Token` | All POST requests | Session-based CSRF token |
| `X-Auth-Token` | Authenticated endpoints | 64-char hex session token |
| `X-Group-Auth-Token` | Hub organiser endpoints | 64-char hex hub session token |
| `X-Access-Grant` | Calendars / Hubs with an access emoji | Up to 3 comma-separated 64-char hex grants from `access_check` (see Access Emoji) |
| `Content-Type` | POST requests | `application/json` |

### Obtaining Tokens

1. **CSRF token:** `GET api.php?action=csrf_token` returns `{csrf_token: "..."}`. Cached per browser session.
2. **Auth token:** `POST api.php?action=auth_user` with valid PIN (or `passkey_login_finish` with a verified fingerprint / face unlock) returns `{auth_token: "..."}`. Expires after 24 hours.

## Rate Limiting

All requests are rate-limited per IP address. Default: 120 requests per minute. Configurable in `config.php` via `rate_limit.per_minute`.

Client IP is taken from `REMOTE_ADDR` by default. `X-Forwarded-For` is honoured only when the direct connection comes from an IP listed in `config.php` `trusted_proxies` (empty by default).

If the rate-limit table is unavailable, read-only GET traffic continues; sensitive POST actions (`admin_login`, `auth_user`, `auth_group`, `create_calendar`, `create_group`, `save`, `add_user`, the five `passkey_*` actions, `access_check`, `set_access_emoji`, `set_group_access_emoji` and `set_bookings_closed`) return HTTP 503 instead of running unthrottled.

Exceeding the limit returns HTTP 429:
```json
{"status": "error", "message": "Too many requests"}
```

### Hub calendar limits

When adding a calendar to a Hub (`create_calendar` with `group_token`, or `add_calendar_to_group`), additional limits apply per IP:

| Limit | Default | Config key (`hub_limits`) |
|-------|---------|---------------------------|
| Max calendars per Hub | 50 | `max_calendars_per_hub` |
| Adds per IP per Hub per hour | 5 | `per_ip_per_hub_per_hour` |
| Adds per IP global per hour | 15 | `per_ip_global_per_hour` |

Exceeding a Hub limit returns HTTP 429 with a descriptive message.

## Account Lockout

PIN logins (`auth_user` for calendar users and organisers, `auth_group` for Hub organisers) use an escalating lockout, implemented in `includes/lockout.php`:

| Lockout | Length |
|---------|--------|
| 1st (5 wrong PINs in a row) | 5 minutes |
| 2nd | 15 minutes |
| 3rd | 2 hours |
| 4th and later | 2 days |

- The 5th wrong PIN returns HTTP 429 with code `ACCOUNT_LOCKED`, `message` (e.g. "Too many wrong PINs. This name is locked for 15 minutes.") and `retry_after` (seconds). While locked, every PIN attempt returns the same code with "Try again in 2 hours." style wording.
- The escalation level (`lockout_level`) survives the lock expiring. It resets to 0 on a correct PIN, a passkey login (passkeys work during a lockout), a super admin Unlock, or after 30 days without a lockout (`cleanup.php`).
- Config (optional, `config.php`): `'pin_lockout' => ['max_attempts' => 5, 'schedule_minutes' => [5, 15, 120, 2880], 'reset_after_days' => 30]`. The last step repeats.
- Until `migrations/002_escalating_lockout.sql` is applied, a flat 15-minute lock is used.

Admin login uses the same pattern per IP: after 5 failed password attempts (default), the IP is locked for 15 minutes. Configurable via `admin.max_attempts` and `admin.lockout_minutes` in `config.php`.

## Access Emoji

An organiser can give a calendar or Hub one of 35 emoji (stored as its position 0-34; the list lives in `emoji.js` and must never be reordered). Implemented in `includes/access.php`; hidden until `migrations/003_access_emoji.sql` has run.

- **Which emoji applies:** a calendar's own emoji, else its Hub's emoji, else none.
- **Central gate:** before every action, a request naming a calendar (`c`), a Hub (`g`), or a Hub via `group_token` on `create_calendar` must carry a valid grant in `X-Access-Grant` when that calendar or Hub has an emoji. `c` wins when both `c` and `g` are present. A Hub grant also opens every calendar in that Hub. Exempt: `csrf_token`, `access_check`, `remove_calendar_from_group` (needs an organiser PIN session) and all `admin_*` actions.
- Without a grant: HTTP 403 `{ code: "ACCESS_REQUIRED", message, access: { kind: "calendar"|"hub", inherited } }`. The pages then show the emoji popup, call `access_check`, store the grant (`localStorage` `wruf_ag_c_<token>` / `wruf_ag_g_<token>`) and retry.
- **Grants** last 30 days and are stored only as SHA-256 hashes (`access_grants`). Changing or removing an emoji deletes its grants and wrong-pick counters.
- **Wrong picks** (per IP address and calendar/Hub, table `access_attempts`): 3 wrong picks lock for 5 minutes, then 15 minutes, 2 hours, 2 days (repeats). A correct pick clears the row; `cleanup.php` deletes rows after 30 days without a wrong pick.
- **Per-IP hourly caps** (in `api_rate_limit`): 20 wrong picks across all calendars/Hubs (`aw` + hour key), and 30 requests for calendar/Hub codes that do not exist (`nf` + hour key; after that every calendar/Hub request from that IP gets 429 until the hour ends).
- Config (optional, `config.php`): `'access_emoji' => ['max_attempts' => 3, 'schedule_minutes' => [5, 15, 120, 2880], 'global_per_hour' => 20, 'not_found_per_hour' => 30, 'grant_days' => 30, 'attempts_keep_days' => 30]`.
- `share.php` shows the generic link preview (no title) for calendars guarded by an emoji.

### GET get_site_config

Public site config for the create pages. **Response:** `{ status, config, features: { access_emoji: bool, booking: bool, booking_total: bool } }` - `features.access_emoji` is `true` once migration 003 has run (the create pages show the emoji switch only then); `features.booking` is `true` once migration 004 has run (the create page shows **People per slot** only then); `features.booking_total` is `true` once migration 005 has also run (the create page shows the **Per day / In total** toggle only then).

### POST access_check

CSRF + `c` or `g`. Body: `emoji` (0-34).

**Response:** `{ status: "success", kind: "calendar"|"group", access_grant, expires_at }` (`access_grant: null` when no emoji applies). Wrong: 401 `{ code: "ACCESS_WRONG", message, attempts_left }`. Locked or over the hourly cap: 429 `{ code: "ACCESS_LOCKED", message, retry_after }`. Unknown code: 404.

### GET access_settings

Organiser view of the emoji. `c` + calendar organiser `X-Auth-Token`, or `g` + `X-Group-Auth-Token`.

**Response:** `{ status, available, emoji (0-34 or null), hub_emoji (calendar only: true when the Hub has an emoji) }`

### POST set_access_emoji

Calendar organiser only. CSRF + `c` + `X-Auth-Token`. Body: `emoji` (0-34, or `null` to remove). Deletes existing grants and wrong-pick rows.

**Response:** `{ status, emoji, access: {available, enabled, inherited}, access_grant?, expires_at? }` (a fresh grant for the organiser whenever an emoji still applies).

### POST set_group_access_emoji

Hub organiser only. CSRF + `g` + `X-Group-Auth-Token`. Body: `emoji` (0-34 or `null`). Deletes existing Hub grants.

**Response:** `{ status, emoji, access_grant?, expires_at? }`

---

## Public Endpoints

### GET csrf_token

Returns a CSRF token for the current session.

**Response:**
```json
{"status": "success", "csrf_token": "a1b2c3..."}
```

### GET calendar_meta

Returns full calendar configuration and metadata.

**Parameters:** `c` (calendar token)

**Response fields:**

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
| passkeys | bool | `true` when fingerprint / face unlock is available on this server (passkey tables exist) |
| access | object | `{available, enabled, inherited}` - access emoji support and whether one guards this calendar (the emoji itself is never returned) |
| slot_capacity | int/null | Booking calendars: people per slot (1-20). `null` = normal availability poll |
| max_per_user | int/null | Booking calendars: bookings each person can hold (1-20), `null` = no limit |
| per_user_total | bool | `true` = `max_per_user` counts across the whole calendar, `false` = per day |
| bookings_closed | bool | Booking calendars: `true` when the organiser has closed bookings |

### GET group_meta

Public hub listing (secret URL). Parameter: `g` (hub token).

**Response:** `{ group: {title, token, calendar_count, passkeys, access: {available, enabled, inherited}}, calendars: [{token, title, start_date, end_date, is_frozen, slot_capacity, last_activity}] }`. `is_frozen` is also `true` for a booking calendar whose bookings are closed; `slot_capacity` is non-null for booking calendars.

### POST create_group

Creates a Hub. CSRF required. Body: `title`, `organiser_name`, `organiser_pin`, optional `access_emoji` (0-34).

**Response:** `{ status, token, title, access_grant?, expires_at? }` (grant only when an emoji was set)

### POST auth_group

Hub organiser PIN login. CSRF + `g` param. Body: `pin`.

**Response:** `{ status, auth_token, role, organiser_name }`. Wrong PIN: 401 `Invalid PIN`; locked: 429 `ACCOUNT_LOCKED` (see Account Lockout).

### POST add_calendar_to_group

Attach calendar to hub. CSRF + `c` + calendar organiser `X-Auth-Token`. Body: `group_token` (Hub code or valid token string).

Calendar must not already belong to a Hub. Subject to Hub capacity and per-IP rate limits (see above). If the Hub has an emoji, `X-Access-Grant` must also include a grant for that Hub, otherwise 403 `HUB_ACCESS_REQUIRED`.

**Response:** `{ status, group: { token, title } }`

### POST remove_calendar_from_group

Detach calendar from its Hub. CSRF + `c`. Auth: calendar organiser `X-Auth-Token` **or** Hub organiser `X-Group-Auth-Token`.

**Response:** `{ status: "success" }`

### GET users

Returns all users for a calendar.

**Parameters:** `c` (calendar token)

**Response:**
```json
{
  "status": "success",
  "users": [
    {"id": 1, "display_name": "Pete", "role": "admin"},
    {"id": 2, "display_name": "Sally", "role": "member"}
  ]
}
```

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

The response also has `summary: [{day, slot, status, count}]` (anonymous counts) whenever `rows` holds only the caller's own rows (Hidden participant, Blind). Booking calendars in Hidden mode also send `summary` to visitors without a session, so everyone can see which slots are free.

---

## Calendar Creation

### POST create_calendar

Creates a new calendar with an organiser account.

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
| admin_name | string | Yes | Organiser name (max 32 chars) |
| admin_pin | string | Yes | 4-digit PIN |
| group_token | string | No | Hub token - assigns new calendar to that Hub (valid token only; no Hub organiser auth; rate limited; needs the Hub's grant if it has an emoji) |
| access_emoji | int | No | 0-34: the calendar's own access emoji |
| slot_capacity | int | No | 1-20: makes a booking calendar (people per slot). Omit, `null` or 0 for a normal availability poll |
| max_per_user | int | No | Booking only: 1-20 bookings per person (organiser exempt); omit, `null` or 0 for no limit |
| per_user_total | int | No | Booking only: `1` = count `max_per_user` across the whole calendar, otherwise per day. Ignored without `max_per_user`; 400 if migration 005 has not run |

Booking calendars must send exactly one status (its weight is forced to 1) and cannot use Blind privacy (`is_private` 2 returns 400). Before migration 004 a `slot_capacity` returns 400 "Booking is not available yet". Booking settings cannot be changed after creation.

**Response:**
```json
{"status": "success", "token": "3PNpKJTs"}
```

When an emoji guards the new calendar (its own or its Hub's), the response also has `access_grant` and `expires_at` for the creator.

---

## User Management

### POST add_user

Adds a participant to a calendar.

**Body:** `display_name` (max 32 chars), `pin` (4 digits)

**Response:** `{status, user_id, user: {id, display_name, role}}`

### POST auth_user

Authenticates a user by PIN.

**Body:** `user_id` (int), `pin` (4 digits)

**Response:** `{status, auth_token, role, user_id}`. Wrong PIN: 401 `Invalid PIN`; locked: 429 `ACCOUNT_LOCKED` (see Account Lockout).

### POST rename_user

Renames a user. Self or organiser.

**Auth required.** Body: `user_id`, `display_name`

### POST delete_user

Organiser deletes a participant (not themselves). Cascades to availability and sessions.

**Auth required (admin).** Body: `user_id`

---

## Passkeys (fingerprint / face unlock)

Optional WebAuthn login for calendar users (including organisers) and Hub organisers. The 4-digit PIN always remains as the backup. Server code lives in `includes/webauthn.php` (no libraries): ES256 and RS256 keys, attestation `none`, user verification required.

All six actions are **POST + CSRF** and take either:
- `?c=CALENDAR_TOKEN` - a calendar user, or
- `?g=HUB_TOKEN` - the Hub organiser.

If the passkey tables have not been created, every action returns HTTP 503 with code `PASSKEYS_UNAVAILABLE` (and `calendar_meta` / `group_meta` report `passkeys: false`, so the UI hides the feature).

Rate limits per IP: enrolment 20/min (`pkr` key), login 30/min (`pkl` key). Challenges are single-use, bound to the specific user or Hub, and expire after 5 minutes.

### POST passkey_register_begin

Starts enrolling this device. **Auth required** - `X-Auth-Token` (calendar) or `X-Group-Auth-Token` (Hub). No body.

**Response:** `{status, publicKey}` - options for `navigator.credentials.create()` (binary fields base64url-encoded). Returns 409 `PASSKEY_LIMIT` when the user or Hub already has 10 devices.

### POST passkey_register_finish

**Auth required.** Body: `credential` (serialized `PublicKeyCredential` from `passkey.js`), optional `device_label` (e.g. "iPhone"; reduced server-side to letters, digits, spaces and `. ( ) / -`, max 40 chars).

**Response:** `{status, credential_id}`. Returns 409 `PASSKEY_EXISTS` if this device is already set up.

### POST passkey_login_begin

Starts a login. No session. Body (calendar only): `user_id`.

**Response:** `{status, publicKey}` - options for `navigator.credentials.get()`, with `allowCredentials` limited to that user's (or Hub's) devices. Returns 404 `NO_PASSKEY` when none are set up.

### POST passkey_login_finish

No session. Body: `credential`, plus `user_id` for calendars.

Verifies origin, RP ID hash, user-presence and user-verification flags, signature and sign counter. On success it clears any PIN lockout and responds exactly like the PIN login:
- Calendar: `{status, auth_token, role, user_id}` (same as `auth_user`)
- Hub: `{status, auth_token, role: "admin", organiser_name}` (same as `auth_group`)

### POST passkey_list

Devices set up for the logged-in user or Hub organiser. **Auth required.** No body.

**Response:**
```json
{
  "status": "success",
  "credentials": [
    {"credential_id": "base64url", "device_label": "iPhone", "created_at": "2026-09-26 08:51:00", "last_used_at": null}
  ]
}
```

The client marks the entry whose `credential_id` matches its own remembered ID as "this device". Dates are server-local.

### POST passkey_remove

Turns off fingerprint / face unlock for one device - any of the owner's devices, so a lost phone can be removed from another device. **Auth required.** Body: `credential_id` (base64url).

**Response:** `{status, removed, credentials}` (`removed` is false if the credential did not belong to this user or Hub; `credentials` is the updated list).

---

## Availability

### POST save

Saves availability changes. Blocked if calendar is frozen (chosen_date + chosen_slot set).

**Auth required.** Body:

```json
{
  "user_id": 1,
  "changes": {
    "2026-03-15": {"Morning": 1, "Evening": 0},
    "2026-03-16": {"Morning": 2}
  }
}
```

Status 0 deletes the record. Status 1..N sets the value.

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

**Auth required.** Body: `user_id`

### POST reset_all

Deletes all availability for all users. Organiser only.

**Auth required (admin).** Body: `confirm` ("RESET")

---

## Organiser Settings

### POST save_date_filter

Updates date filter selections. Organiser only.

**Auth required (admin).** Body: `dates` (array of YYYY-MM-DD strings)

### POST save_rank_sort

Sets the ranking sort order. Organiser only.

**Auth required (admin).** Body: `order` ("score" or "date")

### POST save_organiser_message

Updates the organiser note. Organiser only.

**Auth required (admin).** Body: `message` (string, max 250 chars)

### POST choose_slot

Locks in a chosen date+slot, freezing the calendar. Organiser only.

**Auth required (admin).** Body: `chosen_date` (YYYY-MM-DD), `chosen_slot` (slot ID, max 50 chars)

**Response:**
```json
{"status": "success", "chosen_date": "2026-03-20", "chosen_slot": "Dinner"}
```

Booking calendars return 400 ("Booking calendars use Close bookings instead").

### POST unchoose_slot

Reopens a frozen calendar by clearing the chosen date+slot. Organiser only.

**Auth required (admin).** No body required.

### POST set_bookings_closed

Closes or reopens bookings on a booking calendar. Organiser only; sensitive POST.

**Auth required (admin).** Body: `closed` (1 = close, 0 = reopen). Returns 400 for a normal calendar or before migration 004.

**Response:** `{ status: "success", bookings_closed: true|false }`

---

## Super Admin Endpoints

These require a separate admin session via `admin_login`. Not exposed to calendar users.

### POST admin_login

Authenticates as super admin using credentials from `config.php`.

### GET admin_calendars

Lists all calendars with user counts. Each row may include optional Hub fields: `group_id`, `group_token`, `group_title` (null when not in a Hub), plus `access_emoji` and `group_access_emoji` (0-34 or null) and `slot_capacity` (people per slot for booking calendars, else null).

### POST admin_set_permanent

Sets `never_expires` flag. Body: `calendar_id`, `never_expires` (0/1)

### POST admin_delete_calendar

Deletes a calendar and all associated data. Body: `calendar_id`

### GET admin_groups

Lists all Hubs with calendar counts. Each Hub includes `locked_seconds` (seconds left on an organiser PIN lockout, 0 if not locked) and `access_emoji` (0-34 or null).

### GET admin_group_calendars

Lists child calendars for a Hub. Query param: `group_id`

### POST admin_set_group_permanent

Sets `never_expires` on a Hub. Body: `group_id`, `never_expires` (0/1)

### POST admin_delete_group

Deletes a Hub. Child calendars are detached (`group_id` set to NULL), not deleted. Body: `group_id`

### GET admin_list_users

Lists users for a specific calendar. Query param: `calendar_id`. Each user: `{id, display_name, role, locked_seconds}` (`locked_seconds` is 0 when not locked).

### POST admin_delete_user

Deletes a specific user. Body: `calendar_id`, `user_id`

### POST admin_unlock_user

Clears a calendar user's PIN lockout, failed attempts and escalation level. CSRF + admin session. Body: `calendar_id`, `user_id`. **Response:** `{status}`

### POST admin_unlock_group

Clears a Hub organiser's PIN lockout, failed attempts and escalation level. CSRF + admin session. Body: `group_id`. **Response:** `{status}`

### POST admin_set_access_emoji

Removes the access emoji from a calendar or Hub (for an organiser who forgot it). CSRF + admin session. Body: `kind` (`calendar` or `group`), `id`. Only removal is allowed (`emoji` must be absent or null). Deletes its grants and wrong-pick rows. **Response:** `{status}`

---

## Security Events Logged

All security-relevant actions are logged to `grape_private/logs/security_YYYY-MM.log`:

| Event | Trigger |
|-------|---------|
| AUTH_FAILED | Invalid PIN attempt |
| ACCOUNT_LOCKED | 5th failed attempt triggers a calendar user lockout (includes `minutes`) |
| USER_RESET_SELF | User resets own availability |
| ADMIN_RESET_USER | Organiser resets another user |
| ADMIN_RESET_ALL | Organiser resets all users |
| ORGANISER_DELETE_USER | Organiser deletes a participant |
| CHOOSE_SLOT | Organiser locks in a date+slot |
| UNCHOOSE_SLOT | Organiser reopens the calendar |
| BOOKINGS_CLOSED | Organiser closes bookings on a booking calendar |
| BOOKINGS_REOPENED | Organiser reopens bookings |
| GROUP_AUTH_FAILED | Invalid Hub organiser PIN attempt |
| GROUP_LOCKED | 5th failed attempt triggers a Hub organiser lockout (includes `minutes`) |
| PASSKEY_ADDED | Fingerprint / face unlock turned on for a device |
| PASSKEY_LOGIN | Successful fingerprint / face unlock |
| PASSKEY_REMOVED | Fingerprint / face unlock turned off for a device |
| PASSKEY_COUNTER_REPLAY | Passkey sign counter went backwards (possible cloned authenticator); login rejected |
| ADD_CALENDAR_TO_GROUP | Calendar attached to a Hub |
| REMOVE_CALENDAR_FROM_GROUP | Calendar detached from a Hub |
| ADMIN_DELETE_CALENDAR | Super admin deletes a calendar |
| ADMIN_DELETE_USER | Super admin deletes a user |
| ADMIN_SET_PERMANENT | Super admin toggles never_expires |
| ADMIN_SET_GROUP_PERMANENT | Super admin toggles never_expires on a Hub |
| ADMIN_DELETE_GROUP | Super admin deletes a Hub |
| ADMIN_UNLOCK_USER | Super admin clears a calendar user's PIN lockout |
| ADMIN_UNLOCK_GROUP | Super admin clears a Hub organiser's PIN lockout |
| ACCESS_FAILED | Wrong access emoji picked (includes `kind`, `id`) |
| ACCESS_LOCKED | 3rd wrong pick locks this IP out of that calendar/Hub (includes `minutes`) |
| ACCESS_GRANTED | Right emoji picked; grant issued |
| ACCESS_EMOJI_CHANGED | Organiser sets or removes an emoji (`enabled`) |
| ADMIN_ACCESS_EMOJI_CLEARED | Super admin removes an emoji |
| NOT_FOUND_THROTTLED | IP hit the hourly cap for calendar/Hub codes that do not exist |
| ADMIN_LOGIN_FAILED | Invalid admin password |
| ADMIN_LOGIN_LOCKED | Admin login lockout triggered (per IP) |
| ADMIN_LOGIN_SUCCESS | Successful admin login |
