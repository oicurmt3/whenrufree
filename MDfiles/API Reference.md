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
| `Content-Type` | POST requests | `application/json` |

### Obtaining Tokens

1. **CSRF token:** `GET api.php?action=csrf_token` returns `{csrf_token: "..."}`. Cached per browser session.
2. **Auth token:** `POST api.php?action=auth_user` with valid PIN returns `{auth_token: "..."}`. Expires after 24 hours.

## Rate Limiting

All requests are rate-limited per IP address. Default: 120 requests per minute. Configurable in `config.php` via `rate_limit.per_minute`.

Client IP is taken from `REMOTE_ADDR` by default. `X-Forwarded-For` is honoured only when the direct connection comes from an IP listed in `config.php` `trusted_proxies` (empty by default).

If the rate-limit table is unavailable, read-only GET traffic continues; sensitive POST actions (`admin_login`, `auth_user`, `auth_group`, `create_calendar`, `create_group`, `save`, `add_user`) return HTTP 503 instead of running unthrottled.

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

After 5 failed PIN attempts, the account is locked for 15 minutes. Returns HTTP 429 with code `ACCOUNT_LOCKED`.

Admin login uses the same pattern per IP: after 5 failed password attempts (default), the IP is locked for 15 minutes. Configurable via `admin.max_attempts` and `admin.lockout_minutes` in `config.php`.

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

### GET group_meta

Public hub listing (secret URL). Parameter: `g` (hub token).

**Response:** `{ group: {title, token, calendar_count}, calendars: [{token, title, start_date, end_date, is_frozen, last_activity}] }`

### POST create_group

Creates a Hub. CSRF required. Body: `title`, `organiser_name`, `organiser_pin`.

**Response:** `{ status, token, title }`

### POST auth_group

Hub organiser PIN login. CSRF + `g` param. Body: `pin`.

**Response:** `{ status, auth_token, role, organiser_name }`

### POST add_calendar_to_group

Attach calendar to hub. CSRF + `c` + calendar organiser `X-Auth-Token`. Body: `group_token` (Hub code or valid token string).

Calendar must not already belong to a Hub. Subject to Hub capacity and per-IP rate limits (see above).

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
| group_token | string | No | Hub token — assigns new calendar to that Hub (valid token only; no Hub organiser auth; rate limited) |

**Response:**
```json
{"status": "success", "token": "3PNpKJTs"}
```

---

## User Management

### POST add_user

Adds a participant to a calendar.

**Body:** `display_name` (max 32 chars), `pin` (4 digits)

**Response:** `{status, user_id, user: {id, display_name, role}}`

### POST auth_user

Authenticates a user by PIN.

**Body:** `user_id` (int), `pin` (4 digits)

**Response:** `{status, auth_token, role, user_id}`

### POST rename_user

Renames a user. Self or organiser.

**Auth required.** Body: `user_id`, `display_name`

### POST delete_user

Organiser deletes a participant (not themselves). Cascades to availability and sessions.

**Auth required (admin).** Body: `user_id`

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

### POST reset_user

Deletes all availability for a user. Self or organiser.

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

### POST unchoose_slot

Reopens a frozen calendar by clearing the chosen date+slot. Organiser only.

**Auth required (admin).** No body required.

---

## Super Admin Endpoints

These require a separate admin session via `admin_login`. Not exposed to calendar users.

### POST admin_login

Authenticates as super admin using credentials from `config.php`.

### GET admin_calendars

Lists all calendars with user counts. Each row may include optional Hub fields: `group_id`, `group_token`, `group_title` (null when not in a Hub).

### POST admin_set_permanent

Sets `never_expires` flag. Body: `calendar_id`, `never_expires` (0/1)

### POST admin_delete_calendar

Deletes a calendar and all associated data. Body: `calendar_id`

### GET admin_groups

Lists all Hubs with calendar counts.

### GET admin_group_calendars

Lists child calendars for a Hub. Query param: `group_id`

### POST admin_set_group_permanent

Sets `never_expires` on a Hub. Body: `group_id`, `never_expires` (0/1)

### POST admin_delete_group

Deletes a Hub. Child calendars are detached (`group_id` set to NULL), not deleted. Body: `group_id`

### GET admin_list_users

Lists users for a specific calendar. Query param: `calendar_id`

### POST admin_delete_user

Deletes a specific user. Body: `calendar_id`, `user_id`

---

## Security Events Logged

All security-relevant actions are logged to `grape_private/logs/security_YYYY-MM.log`:

| Event | Trigger |
|-------|---------|
| AUTH_FAILED | Invalid PIN attempt |
| ACCOUNT_LOCKED | 5th failed attempt triggers lockout |
| USER_RESET_SELF | User resets own availability |
| ADMIN_RESET_USER | Organiser resets another user |
| ADMIN_RESET_ALL | Organiser resets all users |
| ORGANISER_DELETE_USER | Organiser deletes a participant |
| CHOOSE_SLOT | Organiser locks in a date+slot |
| UNCHOOSE_SLOT | Organiser reopens the calendar |
| GROUP_AUTH_FAILED | Invalid Hub organiser PIN attempt |
| ADD_CALENDAR_TO_GROUP | Calendar attached to a Hub |
| REMOVE_CALENDAR_FROM_GROUP | Calendar detached from a Hub |
| ADMIN_DELETE_CALENDAR | Super admin deletes a calendar |
| ADMIN_DELETE_USER | Super admin deletes a user |
| ADMIN_SET_PERMANENT | Super admin toggles never_expires |
| ADMIN_SET_GROUP_PERMANENT | Super admin toggles never_expires on a Hub |
| ADMIN_DELETE_GROUP | Super admin deletes a Hub |
| ADMIN_LOGIN_FAILED | Invalid admin password |
| ADMIN_LOGIN_LOCKED | Admin login lockout triggered (per IP) |
| ADMIN_LOGIN_SUCCESS | Successful admin login |
