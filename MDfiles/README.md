# When RU Free?

Privacy-focused group availability scheduling. Free sign-in with Google, Facebook or a passkey; no email stored, no PINs, no tracking, no ads.

**Live:** [whenrufree.net](https://whenrufree.net) 

## What It Does

An organiser signs in, creates a calendar with custom time slots, date ranges, and status options, and shares its link. Participants sign in, join with their profile name (or a name just for that calendar), and tap slots to mark availability. The app scores and ranks date+slot combinations so the group can find the best match.

## Key Features

- Sign in with Google (openid only), Facebook (user ID only) or a passkey (fingerprint, face or screen lock). Only a keyed hash of the provider's ID is stored - never an email, name or photo
- Private unique username; a profile name used on calendars by default, with a per-calendar override
- Profile page: edit your name, manage sign-in methods, see all your calendars and Hubs, sign out, delete your account
- No PINs: the unique link is the invite, and who you are comes from your account. Names and Hubs from before accounts can be claimed once with their old PIN
- Optional access emoji: the organiser picks 1 of 35 emoji for a calendar or Hub as an invite confirmation; each account picks it once (calendars in a Hub use the Hub's emoji unless they have their own)
- Anyone signed in with the link can open and join a calendar or Hub; the link is the only access control, so share it only with people you trust
- Organisers can block anyone on a calendar; their access is paused and their answers are left out until unblocked
- Three privacy modes: Open (everyone sees all), Hidden (only organiser sees individual choices), Blind (nobody sees individual choices). Names are private on Blind, and on Hidden with "Hide names too"
- Customisable time slots (1-6), status options (1-5 with colours and weights), and date ranges (up to 360 days)
- Date filtering: organiser can show/hide specific dates for participants
- Auto-ranked "Best Match" analysis with expandable rosters
- See anyone's calendar read only from the People list, following the same privacy rules as the Best Match names
- The organiser's answers show as a coloured slot edge on Open calendars; the organiser can turn it off in Calendar settings
- The home page can be browsed while signed out; tapping the form asks you to sign in
- Organiser can lock in a chosen date+slot to finalise the calendar
- Booking mode: limit each slot to 1-20 people (first come, first served) and optionally the bookings per person (per day or in total); taps toggle and save like a normal calendar, full slots are locked, and a Bookings card lists your own (Mine) or Free slots, or Booked / Free for the organiser
- Organiser message visible to all participants
- Auto-save with manual save fallback
- Template URLs for pre-configured calendars
- Google Calendar and ICS export from rank cards
- Mobile-responsive with 44x44px touch targets
- Automatic cleanup of inactive calendars, Hubs and accounts (configurable retention)
- Up to 17 category icons (Material Symbols Outlined)
- **Calendar Hubs:** one private link lists multiple calendars; open create-in-Hub; managed by the account that created it
- Super admin panel: opens with the admin password, or straight away for accounts listed in `config.php` `admin.account_ids`

## Tech Stack

- **Frontend:** Vanilla JS, custom CSS, semantic HTML5
- **Backend:** PHP 8.x (procedural), single api.php entry point with helpers in includes/
- **Database:** MariaDB via PDO
- **Hosting:** cPanel shared hosting
- **Icons:** Material Symbols Outlined (self-hosted woff2)
- **Frameworks:** None. No build step.

## File Structure

```
hub.html         - Hub landing / create page
hub.js           - Hub logic and save panel
hub.css          - Hub styles
go/index.html    - Go to calendar or Hub by code or URL
index.html       - Calendar creation page
index.js         - Creation page logic
index.css        - Creation page styles
calendar.html    - Calendar view/interaction page
calendar-*.js    - Calendar logic, 6 files loaded in order: core, users, grid, rank, booking, main
calendar.css     - Calendar styles
account.html     - Profile page: username, profile name, sign-in methods, calendars and Hubs, sign out, delete
account.js       - Profile page logic
account-core.js  - Sign-in panel, account badge and API error handling shared by every page (window.Account)
account.css      - Sign-in panel, badge and profile page styles
passkey.js       - Passkey browser helper (window.Passkey)
emoji.js         - Access emoji list, picker, gate popup and grant storage (window.AccessEmoji)
emoji.css        - Access emoji picker / gate styles
includes/        - Server-only PHP helpers for api.php (http, data, security, sessions, hubs, accounts, oauth, webauthn, lockout, access, booking, members); blocked by .htaccess
migrations/      - SQL migrations (blocked from the web)
admin.html       - Super admin panel
admin-*.js       - Admin panel logic, 5 files loaded in order: core, calendars, hubs, accounts, setup
admin.css        - Admin panel styles
api.php          - All backend endpoints (~2,400 lines); helpers live in includes/
cleanup.php      - Cron maintenance script
_htaccess        - Apache security rules
guide.html       - User help page
faq.html         - FAQ page
ideas.html       - Template gallery
terms.html       - Terms of service
privacy.html     - Privacy policy
robots.txt       - Search engine directives
```

## Database Tables

- `accounts` - Private username, profile name, created / last seen
- `account_identities` - Google / Facebook logins as keyed hashes of the provider's user ID
- `account_passkeys` - Passkey public keys
- `account_sessions` - Hashed 30-day sign-in sessions
- `account_access` - Access emoji already picked by an account
- `account_hubs` - Hubs an account has opened (profile page list)
- `calendars` - Calendar configuration and metadata (`group_id` FK when in a Hub; `hide_names`, `show_organiser_marks`)
- `groups` - Hub metadata, organiser account (`organiser_account_id`) and, until claimed, the old organiser PIN hash
- `users` - Names per calendar (`account_id`, `name_custom`, role, `blocked`; old unclaimed names still have a PIN hash)
- `availability` - Status selections per user/date/slot
- `access_grants` - Hashed 30-day grants issued after the right access emoji is picked
- `access_attempts` - Wrong emoji picks per IP and calendar/Hub
- `api_rate_limit` - Per-IP request throttling

The old `user_sessions`, `group_sessions`, `user_passkeys` and `group_passkeys` tables are dropped by `migrations/008_drop_pins.sql` about 90 days after accounts go live.

## Security Model

- CSRF tokens on all POST requests
- Per-IP rate limiting (configurable, default 120/min), plus per-action limits on sign-in and account changes
- Account sessions: HttpOnly, Secure, SameSite=Lax cookie; 64-char hex, stored as SHA-256; 30 days, renewed on use
- Google / Facebook: signed state cookie, OIDC nonce and PKCE; provider IDs stored only as HMAC-SHA-256 with a server secret
- Passkeys: user verification required, origin + RP ID checked, single-use challenges, sign-counter replay detection
- Old PIN claims: password_verify; 5 wrong PINs lock for 5 min, then 15 min, 2 hours, 2 days
- Block: checked server-side after the emoji on every calendar request; a blocked person gets 403 `BLOCKED` and their answers are left out of views and Best Match
- Access emoji: checked server-side before every calendar/Hub request; 3 wrong picks lock that IP for 5 min, then 15 min, 2 hours, 2 days; max 20 wrong picks and 30 unknown codes per IP per hour; grants stored as SHA-256 hashes; the emoji is never sent to visitors
- Calendar tokens: 8-char URL-safe (new) or 48-char (legacy)
- All dynamic HTML output escaped
- Prepared statements for all database queries
- Security event logging to private directory
- .htaccess blocks direct access to sensitive files

## Documentation

- [API Reference](API%20Reference.md) - Complete endpoint documentation
- [Deployment Guide](deployment.md) - Server setup and configuration
- [Google Sign-In Setup](google-oauth-setup.md) - Step-by-step Google Cloud console setup (reusable for other sites)
- [User Manual](user_manual.md) - End-user instructions
- [JS Functions Reference](js_functions.md) - Frontend function catalogue
- [Data Dictionary](dictionary.md) - Database schema reference
- [Changelog](changelog.md) - Version history
- [Handover Guide](handover.md) - Developer onboarding
