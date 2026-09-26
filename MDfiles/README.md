# When RU Free?

Privacy-focused group availability scheduling. No accounts, no tracking, no ads.

**Live:** [whenrufree.net](https://whenrufree.net) 

## What It Does

An organiser creates a calendar with custom time slots, date ranges, and status options. They share a link. Participants add their name, set a 4-digit PIN, and tap slots to mark availability. The app scores and ranks date+slot combinations so the group can find the best match.

## Key Features

- No sign-up required -- PIN-based authentication per calendar
- Optional fingerprint / face unlock (WebAuthn passkeys) for users and organisers, with the PIN as backup
- Three privacy modes: Open (everyone sees all), Hidden (only organiser sees individual choices), Blind (nobody sees individual choices)
- Customisable time slots (1-6), status options (1-5 with colours and weights), and date ranges (up to 360 days)
- Date filtering: organiser can show/hide specific dates for participants
- Auto-ranked "Best Match" analysis with expandable rosters
- Organiser can lock in a chosen date+slot to finalise the calendar
- Organiser message visible to all participants
- Auto-save with manual save fallback
- Template URLs for pre-configured calendars
- Google Calendar and ICS export from rank cards
- Mobile-responsive with 44x44px touch targets
- Automatic cleanup of inactive calendars (configurable retention)
- Up to 17 category icons (Material Symbols Outlined)
- **Calendar Hubs:** one private link lists multiple calendars; open create-in-Hub; organiser PIN for management

## Tech Stack

- **Frontend:** Vanilla JS, custom CSS, semantic HTML5
- **Backend:** PHP 8.x (procedural), single api.php file
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
calendar.js      - Calendar logic (3,000+ lines)
calendar.css     - Calendar styles
passkey.js       - Fingerprint / face unlock browser helper (window.Passkey)
includes/        - Server-only PHP (webauthn.php); blocked by .htaccess
migrations/      - SQL migrations (blocked from the web)
admin.html       - Super admin panel
admin.js         - Admin panel logic
admin.css        - Admin panel styles
api.php          - All backend endpoints (~1,400 lines)
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

- `calendars` - Calendar configuration and metadata (`group_id` FK when in a Hub)
- `groups` - Hub metadata and organiser PIN hash
- `group_sessions` - Hub organiser auth tokens
- `users` - Participants per calendar (name, PIN hash, role)
- `availability` - Status selections per user/date/slot
- `user_sessions` - Auth tokens with expiry
- `user_passkeys` / `group_passkeys` - Fingerprint / face unlock public keys
- `api_rate_limit` - Per-IP request throttling

## Security Model

- CSRF tokens on all POST requests
- Per-IP rate limiting (configurable, default 120/min)
- PIN hashing with password_hash/password_verify
- Account lockout after 5 failed attempts (15 min)
- Passkeys: user verification required, origin + RP ID checked, single-use challenges bound to the user, sign-counter replay detection
- Session tokens: 64-char hex, 24-hour expiry
- Calendar tokens: 8-char URL-safe (new) or 48-char (legacy)
- All dynamic HTML output escaped
- Prepared statements for all database queries
- Security event logging to private directory
- .htaccess blocks direct access to sensitive files

## Documentation

- [API Reference](API%20Reference.md) - Complete endpoint documentation
- [Deployment Guide](deployment.md) - Server setup and configuration
- [User Manual](user_manual.md) - End-user instructions
- [JS Functions Reference](js_functions.md) - Frontend function catalogue
- [Data Dictionary](dictionary.md) - Database schema reference
- [Changelog](changelog.md) - Version history
- [Handover Guide](handover.md) - Developer onboarding
