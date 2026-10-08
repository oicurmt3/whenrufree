# api.md - Quick Reference

Concise endpoint list for `api.php?action=...&c=TOKEN`. Endpoints are in `api.php`; helpers are in `includes/*.php`.

## Request Format

- GET endpoints: query parameters
- POST endpoints: JSON body, requires `X-CSRF-Token` header
- Who you are: the HttpOnly `wruf_account` cookie (30 days, sent automatically). There are no PINs and no auth headers
- Everything except `csrf_token`, `diag`, `get_site_config`, `account_*`, `oauth_*` and `admin_*` needs a signed-in account with a username and profile name (401 `ACCOUNT_REQUIRED`, 403 `ACCOUNT_SETUP`)
- Calendars / Hubs with an access emoji: the organiser, people with a name on the calendar and accounts that picked it before pass; others add `X-Access-Grant` (grants from `access_check`, comma-separated, max 3) or get 403 `ACCESS_REQUIRED`

## Endpoints

Role column: "joined" = the account has a name on the calendar; "organiser" = that name has role `admin`; "Hub organiser" = `groups.organiser_account_id`.

| Action | Method | Auth | Role | Description |
|--------|--------|------|------|-------------|
| `csrf_token` | GET | - | - | Get CSRF token |
| `get_site_config` | GET | - | - | Public site config and feature flags for the create pages |
| `account_me` | GET | - | - | Signed in?, username, profile name, which sign-in methods are on |
| `account_update` | POST | Account | - | Set username (`username`) and/or profile name (`display_name`) |
| `account_logout` | POST | CSRF | - | Sign out on this device |
| `account_methods` | GET | Account | - | List Google / Facebook / passkey methods |
| `account_remove_method` | POST | Account | - | Remove one method (`type`, `id`); never the last |
| `account_memberships` | GET | Account | - | Calendars and Hubs for the profile page |
| `account_delete_preview` | GET | Account | - | What deleting the account would remove |
| `account_delete` | POST | Account | - | Delete account and everything it owns (`confirm` = username) |
| `account_passkey_signup_begin` / `_finish` | POST | CSRF | - | Create an account with a passkey |
| `account_passkey_add_begin` / `_finish` | POST | Account | - | Add a passkey to the account |
| `account_passkey_login_begin` / `_finish` | POST | CSRF | - | Sign in with a passkey (usernameless) |
| `oauth_start` | GET | - | - | Browser redirect to Google / Facebook (`provider`, optional `mode=link`, `return`) |
| `oauth_google` / `oauth_facebook` | GET | - | - | Provider redirect back; signs in or links, then redirects with `?signin=` |
| `access_check` | POST | CSRF | - | Check a picked emoji (`emoji` 0-34) for `c` or `g`; remembers it for the account and returns a 30-day `access_grant` |
| `access_settings` | GET | Account | organiser / Hub organiser | Current emoji (`c` or `g`) |
| `set_access_emoji` | POST | Account | organiser | Set or remove the calendar's emoji (`emoji` 0-34 or null) |
| `set_group_access_emoji` | POST | Account | Hub organiser | Set or remove the Hub's emoji |
| `calendar_meta` | GET | Account | - | Calendar config + `account: {profile_name, me, claimable}` |
| `group_meta` | GET | Account | - | Hub listing (`g` param, not `c`) with `organiser_name`, `is_organiser`, `claimable` |
| `create_group` | POST | Account | - | Create Hub (optional `organiser_name`) |
| `claim_hub` | POST | Account | - | Claim an old Hub once with its organiser PIN (`g`, `pin`) |
| `add_calendar_to_group` | POST | Account | organiser | Attach calendar to Hub |
| `remove_calendar_from_group` | POST | Account | organiser or Hub organiser | Detach calendar from Hub |
| `users` | GET | Account | - | List names (`mine`, `claimable` flags) |
| `availability` | GET | Account | - | Read availability (from/to params) |
| `create_calendar` | POST | Account | - | Create calendar; the account is organiser (optional `admin_name`, `group_token`) |
| `join_calendar` | POST | Account | - | Join with the profile name or a per-calendar `display_name` |
| `rename_user` | POST | Account | joined (self) / organiser | Rename (`display_name`, or `use_profile` for yourself) |
| `claim_name` | POST | Account | - | Claim an old name once with its PIN (`user_id`, `pin`) |
| `save` | POST | Account | joined (self) / organiser | Save availability changes (booking calendars: capacity checks, returns `rejected`) |
| `reset_user` | POST | Account | joined (self) / organiser | Delete user's availability |
| `reset_all` | POST | Account | organiser | Delete ALL availability |
| `delete_user` | POST | Account | organiser | Remove participant |
| `save_date_filter` | POST | Account | organiser | Update date filter selections |
| `save_rank_sort` | POST | Account | organiser | Set score/date sort order |
| `save_organiser_message` | POST | Account | organiser | Update organiser note |
| `choose_slot` | POST | Account | organiser | Lock in date+slot (freeze) |
| `unchoose_slot` | POST | Account | organiser | Reopen frozen calendar |
| `set_bookings_closed` | POST | Account | organiser | Close (`closed` 1) or reopen (0) bookings on a booking calendar |
| `admin_login` | POST | CSRF | - | Super admin login |
| `admin_calendars` | GET | Admin | super | List all calendars (includes optional Hub fields) |
| `admin_set_permanent` | POST | Admin | super | Toggle never_expires |
| `admin_delete_calendar` | POST | Admin | super | Delete calendar |
| `admin_groups` | GET | Admin | super | List all Hubs |
| `admin_group_calendars` | GET | Admin | super | List calendars in a Hub |
| `admin_set_group_permanent` | POST | Admin | super | Toggle Hub never_expires |
| `admin_delete_group` | POST | Admin | super | Delete Hub (detaches calendars) |
| `admin_list_users` | GET | Admin | super | List users for calendar (`has_account`, `locked_seconds`) |
| `admin_delete_user` | POST | Admin | super | Delete user from calendar |
| `admin_unlock_user` | POST | Admin | super | Clear a claim lockout on an old name |
| `admin_unlock_group` | POST | Admin | super | Clear a claim lockout on an old Hub |
| `admin_set_access_emoji` | POST | Admin | super | Remove a calendar's or Hub's emoji (`kind`, `id`) |
| `admin_accounts` | GET | Admin | super | Account totals and list (optional `q` username prefix) |
| `admin_delete_account` | POST | Admin | super | Delete an account (`account_id`) |

"Account" in the Auth column also means CSRF on POSTs.

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Validation error (`USERNAME_INVALID`, `NAME_INVALID`, `CONFIRM_MISMATCH`) |
| 401 | Not signed in (`ACCOUNT_REQUIRED`), wrong old PIN when claiming, or wrong access emoji (`ACCESS_WRONG`, with `attempts_left`) |
| 403 | Account setup unfinished (`ACCOUNT_SETUP`), not joined (`NOT_JOINED`), CSRF failure or insufficient role, calendar frozen, bookings closed (`BOOKINGS_CLOSED`), or access emoji needed (`ACCESS_REQUIRED`, `HUB_ACCESS_REQUIRED`) |
| 404 | Calendar/user/action not found, or passkey not linked to any account (`NO_PASSKEY`) |
| 409 | `ALREADY_JOINED`, `NAME_TAKEN`, `USERNAME_TAKEN`, `ALREADY_CLAIMED`, `LAST_METHOD`, `PASSKEY_EXISTS`, `PASSKEY_LIMIT` |
| 429 | Rate limited, old name / Hub locked after wrong PINs (`ACCOUNT_LOCKED`), too many wrong emoji picks (`ACCESS_LOCKED`) or too many unknown codes |
| 500 | Server misconfiguration (e.g. missing `accounts.pepper`) |
| 503 | Rate limiter unavailable on a sensitive POST, or accounts tables missing (migration 007 not run) |

## Data Conventions

- Calendar token: `?c=TOKEN` on all calendar-scoped requests
- Hub token: `?g=TOKEN` on `group_meta`, `claim_hub`, Hub emoji calls, and Hub pages
- Dates: YYYY-MM-DD strings
- Availability status: integer (0=null/clear, 1..N=status option)
- Roles: "admin" (organiser) or "member" (participant)
- Names: letters, numbers, spaces, `'` and `-`, up to 32 characters, unique per calendar; one name per account per calendar
- Usernames: 3-20 lowercase letters, numbers or `_`, unique, private
- Privacy: 0=open, 1=hidden, 2=blind
- Frozen calendar: `chosen_date` + `chosen_slot` both non-null blocks `save` endpoint
- Booking calendar: `slot_capacity` 1-20 (people per slot), `max_per_user` 1-20 or null, `per_user_total` (limit per day or in total), `bookings_closed`; one status (1 = booked); no Blind privacy. Set only at creation (`create_calendar`)
