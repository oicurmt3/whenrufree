# Deployment Guide

## Requirements

- PHP 8.x with PDO MySQL and OpenSSL extensions
- MariaDB 10.x or MySQL 8.x
- Apache with mod_rewrite (shared hosting via cPanel)
- HTTPS certificate (Let's Encrypt or cPanel AutoSSL)

## Initial Setup

### 1. Database

Create a MariaDB database and import the schema. The SQL dump is in `perthrel_grape_calendar__1_.sql` but the core CREATE TABLE statements are:

```sql
-- See dictionary.md for full schema
-- Tables: calendars, groups, group_sessions, users, availability, user_sessions, api_rate_limit
-- (migrations add user_passkeys, group_passkeys, access_grants, access_attempts)
```

After importing, run migrations in order:

1. **Choose/freeze columns** (if not in base dump):

```sql
ALTER TABLE calendars
  ADD COLUMN chosen_date VARCHAR(10) DEFAULT NULL AFTER organiser_message,
  ADD COLUMN chosen_slot VARCHAR(50) DEFAULT NULL AFTER chosen_date;
```

2. **Calendar Hubs** - run `migrations/add_groups.sql` (creates `groups`, `group_sessions`, adds `calendars.group_id`).

3. **Fingerprint / face unlock** - run `migrations/001_passkeys.sql` (creates `user_passkeys`, `group_passkeys`). Safe to re-run (`CREATE TABLE IF NOT EXISTS`). Until this runs, the feature is hidden automatically and the site works with PINs only.

4. **Escalating PIN lockout** - run `migrations/002_escalating_lockout.sql` (adds `lockout_level`, `last_locked_at` to `users` and `groups`). Safe to re-run (`ADD COLUMN IF NOT EXISTS`, MariaDB). Until this runs, wrong PINs use the old flat 15-minute lock.

5. **Access emoji** - run `migrations/003_access_emoji.sql` (adds `access_emoji` to `calendars` and `groups`; creates `access_grants`, `access_attempts`). Safe to re-run. Until this runs, the emoji switch is hidden and no calendar or Hub asks for an emoji.

6. **Booking** - run `migrations/004_booking.sql` (adds `slot_capacity`, `max_per_user`, `bookings_closed` to `calendars`). Safe to re-run. Until this runs, **People per slot** is hidden on the create page and every calendar is a normal availability poll. Then run `migrations/005_booking_total.sql` (adds `per_user_total`) to show the **Per day / In total** toggle under Bookings per person; until then every limit is per day. Then run `migrations/006_booking_styles.sql` (adds `partial_color`, `full_color`, `partial_label`, `full_label`) to show the Partly booked / Full colour and name settings; until then cells use the default orange / red and names.

And fix the known column width issue:

```sql
ALTER TABLE calendars MODIFY organiser_message VARCHAR(250) DEFAULT NULL;
```

### 2. Config File

Create `/home/perthrel/grape_private/config.php` (outside webroot):

```php
<?php
return [
    'db' => [
        'host' => 'localhost',
        'name' => 'your_db_name',
        'charset' => 'utf8mb4',
        'user' => 'your_db_user',
        'pass' => 'your_db_password',
    ],
    'rate_limit' => [
        'per_minute' => 120,
        'retention_minutes' => 60,
    ],
    // Only set when behind a reverse proxy (e.g. Cloudflare). Empty = trust REMOTE_ADDR only.
    'trusted_proxies' => [],
    'hub_limits' => [
        'max_calendars_per_hub' => 50,
        'per_ip_per_hub_per_hour' => 5,
        'per_ip_global_per_hour' => 15,
    ],
    'retention' => [
        'inactive_days' => 40,
        'hub_inactive_days' => 40,
    ],
    'admin' => [
        'user' => 'your_admin_username',
        'pass' => 'your_admin_password_hash',
        'max_attempts' => 5,
        'lockout_minutes' => 15,
    ],
    // Optional. PIN lockout for calendar users and Hub organisers. Defaults shown:
    // 5 wrong PINs lock for 5 min, then 15 min, 2 hours, 2 days (last step repeats);
    // the escalation resets after 30 days without a lockout.
    // 'pin_lockout' => [
    //     'max_attempts' => 5,
    //     'schedule_minutes' => [5, 15, 120, 2880],
    //     'reset_after_days' => 30,
    // ],
    // Optional. Access emoji limits. Defaults shown: 3 wrong picks lock that IP out of
    // that calendar/Hub for 5 min, then 15 min, 2 hours, 2 days; max 20 wrong picks and
    // 30 unknown calendar/Hub codes per IP per hour; grants last 30 days.
    // 'access_emoji' => [
    //     'max_attempts' => 3,
    //     'schedule_minutes' => [5, 15, 120, 2880],
    //     'global_per_hour' => 20,
    //     'not_found_per_hour' => 30,
    //     'grant_days' => 30,
    //     'attempts_keep_days' => 30,
    // ],
    // Optional. Fingerprint / face unlock (passkeys). Leave out to use the request host,
    // which is best when the site answers on more than one domain.
    // 'webauthn' => [
    //     'rp_id' => 'whenrufree.net',
    //     'origin' => 'https://whenrufree.net',
    // ],
];
```

Passkeys are tied to the domain they were created on. A passkey set up on `whenrufree.net` will not work on `sandgroper.net` (the PIN still does). Changing `rp_id` later invalidates every existing passkey; users simply fall back to their PIN and can turn it on again.

### 3. File Upload

Upload all project files to the web-accessible directory (e.g. `/home/perthrel/public_html/grape/` or equivalent subfolder on sandgroper.net).

Include the whole `includes/` folder (`http.php`, `data.php`, `security.php`, `sessions.php`, `hubs.php`, `webauthn.php`, `lockout.php`, `access.php`, `booking.php`, `.htaccess`); `api.php` stops with a fatal error if any is missing. The calendar page needs all six `calendar-*.js` files and the admin panel all four `admin-*.js` files.

Rename `_htaccess` to `.htaccess`.

### 4. Font File

Place the Material Symbols Outlined woff2 font at `fonts/material-symbols-outlined.woff2`. This is self-hosted to avoid external CDN dependencies.

### 5. Cron Job

Set up the cleanup script to run daily:

```
0 3 * * * /usr/bin/php /home/perthrel/public_html/grape/cleanup.php >> /home/perthrel/grape_private/logs/cleanup.log 2>&1
```

This handles: inactive calendar deletion, expired session cleanup, rate limit table pruning, PIN lockout resets, resetting the PIN lockout escalation after 30 days without a lockout, and deleting expired access emoji grants and old wrong-pick counters.

## Security Checklist

- [ ] Config file is outside webroot (`/home/perthrel/grape_private/config.php`)
- [ ] `.htaccess` blocks `cleanup.php`, `config.php`, `error_log`, `*.sql`
- [ ] `includes/.htaccess` (`Require all denied`) is uploaded
- [ ] HTTPS is enabled and HSTS header is active (browsers only allow fingerprint / face unlock over HTTPS)
- [ ] PHP `openssl` extension is enabled (needed to verify passkey signatures)
- [ ] Log directory (`grape_private/logs/`) exists with 0750 permissions
- [ ] `cleanup.php` runs as CLI only (has `php_sapi_name()` guard)
- [ ] Database user has minimal privileges (SELECT, INSERT, UPDATE, DELETE on app tables only)
- [ ] `robots.txt` blocks `calendar.html` and `api.php` from indexing

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `GRAPE_DIAG_ENABLED` | Enables `/api.php?action=diag` endpoint | Disabled (not set) |

## Encoding Constraint

All files must use plain ASCII only. No em dashes, curly quotes, or Unicode characters. cPanel File Manager corrupts non-ASCII on save. Use straight quotes, hyphens, and `...` instead of ellipsis.

## Updating

1. Upload changed files via cPanel File Manager or SFTP
2. Run any new SQL migrations via phpMyAdmin
3. Clear browser cache if CSS/JS changed (or use versioned query strings)
4. No build step required
5. When files are renamed or split, delete the old ones from the server too. The 2026-09-27 split replaced `calendar.js` with `calendar-core.js`, `calendar-users.js`, `calendar-grid.js`, `calendar-rank.js`, `calendar-booking.js`, `calendar-main.js`, and `admin.js` with `admin-core.js`, `admin-calendars.js`, `admin-hubs.js`, `admin-setup.js`; `api.php` now needs `includes/http.php`, `data.php`, `security.php`, `sessions.php` and `hubs.php`. Upload `api.php` together with the new includes, and the HTML pages together with their new scripts.

## Monitoring

- Security logs: `grape_private/logs/security_YYYY-MM.log`
- Cleanup logs: `grape_private/logs/cleanup.log`
- PHP error log: `error_log` in webroot (blocked by .htaccess)
- Rate limit table size: check `api_rate_limit` row count periodically

## Scaling Notes

- The app is designed for shared hosting with tens of thousands of calendar entries
- Rate limiting uses a MariaDB upsert pattern (known race condition, acceptable at current scale)
- Session tokens are stored in DB, not files (works across load-balanced instances)
- No external dependencies at runtime (no CDNs, no npm, no build)
