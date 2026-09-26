# api.md - Quick Reference

Concise endpoint list for `api.php?action=...&c=TOKEN`.

## Request Format

- GET endpoints: query parameters
- POST endpoints: JSON body, requires `X-CSRF-Token` header
- Authenticated endpoints: add `X-Auth-Token` header (calendar session)
- Hub organiser endpoints: add `X-Group-Auth-Token` header

## Endpoints

| Action | Method | Auth | Role | Description |
|--------|--------|------|------|-------------|
| `csrf_token` | GET | - | - | Get CSRF token |
| `calendar_meta` | GET | - | - | Calendar config + metadata |
| `group_meta` | GET | - | - | Hub listing (`g` param, not `c`) |
| `create_group` | POST | CSRF | - | Create Hub + organiser PIN |
| `auth_group` | POST | CSRF | - | Hub organiser PIN login (`g` param) |
| `add_calendar_to_group` | POST | Auth | calendar admin | Attach calendar to Hub |
| `remove_calendar_from_group` | POST | Auth | calendar admin or Hub organiser | Detach calendar from Hub |
| `users` | GET | - | - | List participants |
| `availability` | GET | - | - | Read availability (from/to params) |
| `create_calendar` | POST | CSRF | - | Create calendar + organiser (optional `group_token`) |
| `add_user` | POST | CSRF | - | Add participant |
| `auth_user` | POST | CSRF | - | PIN login, returns auth_token |
| `passkey_register_begin` | POST | Auth | self / Hub organiser | Start fingerprint / face enrolment (`c` or `g`) |
| `passkey_register_finish` | POST | Auth | self / Hub organiser | Save device credential |
| `passkey_login_begin` | POST | CSRF | - | Start fingerprint / face login (`user_id` for calendars) |
| `passkey_login_finish` | POST | CSRF | - | Verify passkey, returns auth_token (same shape as PIN login) |
| `passkey_list` | POST | Auth | self / Hub organiser | List devices with fingerprint / face unlock |
| `passkey_remove` | POST | Auth | self / Hub organiser | Remove any one of the owner's devices (`credential_id`) |
| `rename_user` | POST | Auth | self/admin | Rename user |
| `save` | POST | Auth | self/admin | Save availability changes |
| `reset_user` | POST | Auth | self/admin | Delete user's availability |
| `reset_all` | POST | Auth | admin | Delete ALL availability |
| `delete_user` | POST | Auth | admin | Remove participant |
| `save_date_filter` | POST | Auth | admin | Update date filter selections |
| `save_rank_sort` | POST | Auth | admin | Set score/date sort order |
| `save_organiser_message` | POST | Auth | admin | Update organiser note |
| `choose_slot` | POST | Auth | admin | Lock in date+slot (freeze) |
| `unchoose_slot` | POST | Auth | admin | Reopen frozen calendar |
| `admin_login` | POST | CSRF | - | Super admin login |
| `admin_calendars` | GET | Admin | super | List all calendars (includes optional Hub fields) |
| `admin_set_permanent` | POST | Admin | super | Toggle never_expires |
| `admin_delete_calendar` | POST | Admin | super | Delete calendar |
| `admin_groups` | GET | Admin | super | List all Hubs |
| `admin_group_calendars` | GET | Admin | super | List calendars in a Hub |
| `admin_set_group_permanent` | POST | Admin | super | Toggle Hub never_expires |
| `admin_delete_group` | POST | Admin | super | Delete Hub (detaches calendars) |
| `admin_list_users` | GET | Admin | super | List users for calendar |
| `admin_delete_user` | POST | Admin | super | Delete user from calendar |

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Validation error |
| 401 | Auth required or invalid session |
| 403 | CSRF failure or insufficient role, or calendar frozen |
| 404 | Calendar/user/action not found, or no passkey set up (`NO_PASSKEY`) |
| 409 | Passkey already set up (`PASSKEY_EXISTS`) or device limit reached (`PASSKEY_LIMIT`) |
| 429 | Rate limited or account locked |
| 500 | Server misconfiguration |
| 503 | Rate limiter unavailable on a sensitive POST, or passkey tables missing (`PASSKEYS_UNAVAILABLE`) |

## Data Conventions

- Calendar token: `?c=TOKEN` on all calendar-scoped requests
- Hub token: `?g=TOKEN` on `group_meta`, `auth_group`, Hub `passkey_*` calls, and Hub pages
- Hub organiser header: `X-Group-Auth-Token`
- Dates: YYYY-MM-DD strings
- Availability status: integer (0=null/clear, 1..N=status option)
- Roles: "admin" (organiser) or "member" (participant)
- Privacy: 0=open, 1=hidden, 2=blind
- Frozen calendar: `chosen_date` + `chosen_slot` both non-null blocks `save` endpoint
