# Deployment Guide

## Requirements

- PHP 8.x with PDO MySQL, OpenSSL and cURL extensions (cURL talks to Google / Facebook during sign-in)
- MariaDB 10.x or MySQL 8.x
- Apache with mod_rewrite (shared hosting via cPanel)
- HTTPS certificate (Let's Encrypt or cPanel AutoSSL)

## Initial Setup

### 1. Database

Create a MariaDB database and import the schema. The SQL dump is in `perthrel_grape_calendar__1_.sql` but the core CREATE TABLE statements are:

```sql
-- See dictionary.md for full schema
-- Tables: calendars, groups, group_sessions, users, availability, user_sessions, api_rate_limit
-- (migrations add access_grants, access_attempts and the account_* tables;
--  008 later drops group_sessions, user_sessions, user_passkeys, group_passkeys)
```

After importing, run migrations in order:

1. **Choose/freeze columns** (if not in base dump):

```sql
ALTER TABLE calendars
  ADD COLUMN chosen_date VARCHAR(10) DEFAULT NULL AFTER organiser_message,
  ADD COLUMN chosen_slot VARCHAR(50) DEFAULT NULL AFTER chosen_date;
```

2. **Calendar Hubs** - run `migrations/add_groups.sql` (creates `groups`, `group_sessions`, adds `calendars.group_id`).

3. **Old per-calendar passkeys** - `migrations/001_passkeys.sql` (creates `user_passkeys`, `group_passkeys`). Not needed on a new install; the accounts code no longer uses these tables and migration 008 drops them.

4. **Escalating PIN lockout** - run `migrations/002_escalating_lockout.sql` (adds `lockout_level`, `last_locked_at` to `users` and `groups`). Safe to re-run (`ADD COLUMN IF NOT EXISTS`, MariaDB). It is now used only when claiming old PIN names and Hubs.

5. **Access emoji** - run `migrations/003_access_emoji.sql` (adds `access_emoji` to `calendars` and `groups`; creates `access_grants`, `access_attempts`). Safe to re-run. Until this runs, the emoji switch is hidden and no calendar or Hub asks for an emoji.

6. **Booking** - run `migrations/004_booking.sql` (adds `slot_capacity`, `max_per_user`, `bookings_closed` to `calendars`). Safe to re-run. Until this runs, **People per slot** is hidden on the create page and every calendar is a normal availability poll. Then run `migrations/005_booking_total.sql` (adds `per_user_total`) to show the **Per day / In total** toggle under Bookings per person; until then every limit is per day. Then run `migrations/006_booking_styles.sql` (adds `partial_color`, `full_color`, `partial_label`, `full_label`) to show the Partly booked / Full colour and name settings; until then cells use the default orange / red and names.

7. **Accounts** - run `migrations/007_accounts.sql` **before** uploading the accounts code (creates `accounts`, `account_identities`, `account_passkeys`, `account_sessions`, `account_access`, `account_hubs`; adds `users.account_id`, `users.name_custom`, `groups.organiser_account_id`; makes the PIN hashes nullable). Safe to re-run. Until it runs, every page shows "Sign-in is not set up on this server yet".

8. **Drop old PINs** - `migrations/008_drop_pins.sql` is a draft: run it about 90 days after accounts go live, once Admin > Accounts shows few unclaimed names and Hubs. It deletes all remaining PIN hashes (they can no longer be claimed) and drops the old session and passkey tables.

9. **Hide names and Block** - run `migrations/009_invite_only.sql` (adds `calendars.hide_names`, `users.blocked`). Safe to re-run. Until it runs, the **Show everyone who has joined (but not their choices)** row is hidden on the create page (Hidden calendars keep names private) and nobody can be blocked. Migration 009 also added the Invite only feature (`calendars.invite_only`, `groups.invite_only`, `access_requests`); `migrations/014_drop_invite_only.sql` removes those again.

10. **Organiser marks** - run `migrations/010_organiser_marks.sql` (adds `calendars.show_organiser_marks`, default 1). Safe to re-run. Until it runs, the organiser's coloured slot edge always shows on Open calendars and Calendar settings doesn't offer the switch.

11. **Reports** - run `migrations/011_report_users.sql` **before** uploading the reports code (creates `reports`: a snapshot of who was reported, by whom, why, with no foreign keys so it survives the calendar and the account). Safe to re-run. Until it runs, blocking, deleting and reporting all still work but the **Report** dropdown is hidden and the admin **Reports** tab says to run the migration.

12. **No option colour** - run `migrations/012_null_color.sql` (adds `calendars.null_color`). Safe to re-run. Until it runs, Slots use the default light grey and the **No option** row's colour picker stores nothing.

13. **Default option** - run `migrations/013_slot_default.sql` (adds `calendars.default_status`). Safe to re-run. Until it runs, Slots start un-answered and the option-row **Default option** checkboxes store nothing.

14. **Remove Invite only** - run `migrations/014_drop_invite_only.sql` **after** uploading the code that no longer uses it (drops `access_requests` and the `invite_only` columns on `calendars` and `groups`). Safe to re-run. `calendars.hide_names` and `users.blocked` from migration 009 stay.

15. **Test users** - run `migrations/015_admin_test_users.sql` (adds `accounts.created_by_admin`, default 0). Safe to re-run. Until it runs, sign-in is unaffected; the admin **Test users** section says to run the migration.

16. **Reports for everyone** - run `migrations/016_report_audience.sql` (adds `reports.audience`, `target_role`, `reporter_user_id`, `reporter_name`, `calendar_title`, `outcome` and an index). Safe to re-run. Until it runs, member reporting and the organiser **Reports** inbox are hidden and the organiser's **Manage person** menu no longer offers Report; blocking, deleting and the existing super-admin reports keep working.
17. **Hub add policy** - run `migrations/017_hub_add_policy.sql` (adds `groups.allow_member_calendars`, default 0). Safe to re-run. Until it runs, every Hub only accepts calendars from its organiser and the **Let other people add their own calendars** switch is hidden on the create form and in Hub settings.

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
        'password' => 'your_admin_password_or_bcrypt_hash',
        'max_attempts' => 5,
        'lockout_minutes' => 15,
        // Optional. Account ids (Admin > Accounts > ID) that open the admin panel
        // without the password and may use reserved usernames. The password still works.
        'account_ids' => [],
    ],
    // Required. Sign-in accounts. pepper: 64+ hex characters, generated once with
    //   php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
    // and never changed (changing it breaks every Google / Facebook login).
    // Leave a provider's keys empty to hide its button. Passkeys need no keys.
    'accounts' => [
        'pepper' => 'paste_64_hex_characters_here',
        'base_url' => 'https://whenrufree.net',
        'google' => ['client_id' => '', 'client_secret' => ''],
        'facebook' => ['app_id' => '', 'app_secret' => '', 'graph_version' => 'v21.0'],
        'inactive_days' => 730,   // cleanup.php deletes accounts unused this long with no calendars or Hubs
    ],
    // Optional. Lockout when claiming old PIN names and Hubs. Defaults shown:
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
    // Optional. Passkeys. Leave out to use the request host,
    // which is best when the site answers on more than one domain.
    // 'webauthn' => [
    //     'rp_id' => 'whenrufree.net',
    //     'origin' => 'https://whenrufree.net',
    // ],
];
```

Passkeys are tied to the domain they were created on. A passkey set up on `whenrufree.net` will not work on `sandgroper.net`. Changing `rp_id` later invalidates every existing passkey; people then need Google or Facebook on the same account, or a new account.

### 2a. Google and Facebook sign-in

Both are optional; with neither, people sign in with passkeys only. The redirect URIs use `accounts.base_url`:

- `https://whenrufree.net/api.php?action=oauth_google`
- `https://whenrufree.net/api.php?action=oauth_facebook`

**Google** (Google Cloud console > APIs & Services; full walkthrough with troubleshooting in [google-oauth-setup.md](google-oauth-setup.md)):
1. OAuth consent screen: External, app name "When RU Free", privacy policy `https://whenrufree.net/privacy.html`, terms `https://whenrufree.net/terms.html`. Add no scopes beyond `openid`.
2. Credentials > Create OAuth client ID > Web application. Authorised redirect URI: the `oauth_google` URL above.
3. Copy the client ID and secret into `accounts.google`.

**Facebook** (Meta for Developers):
1. Create an app and add **Facebook Login** (the "Authenticate and request data from users" use case). Keep only the default `public_profile` permission and don't add `email`; the app reads nothing but the user ID, so no App Review is needed.
2. Facebook Login > Settings: Client OAuth login **Yes**, Web OAuth login **Yes**, Enforce HTTPS **Yes**, Use Strict Mode for redirect URIs **Yes**, Login with the JavaScript SDK **No**. Valid OAuth Redirect URIs: the `oauth_facebook` URL above (exact match, no trailing slash). Check it with **Redirect URI to check**.
3. Skip the web quick-start's SDK snippet, **Check Login Status** and **Login Button** steps. They load Facebook's JavaScript SDK (which tracks page views); the site uses its own button and a server-side redirect instead.
4. App settings > Basic: App domains `whenrufree.net`, privacy policy `https://whenrufree.net/privacy.html`, terms `https://whenrufree.net/terms.html`, **User data deletion** > Data deletion instructions URL `https://whenrufree.net/privacy.html#delete-account`, a 1024 x 1024 app icon and a category.
5. Copy the app ID and secret into `accounts.facebook` (never into chat or screenshots; use **Reset** if the secret leaks), then switch the app to Live. Until then only people with a role on the app can sign in.
6. Ignore access tokens shown by Meta's tools: the site never stores one, it only needs the app ID and secret.

### 2b. Admin sign-in with your account

After signing in on the site, find your account's ID in **Admin > Accounts** and add it to `admin.account_ids` (e.g. `'account_ids' => [1]`), then run `php -l` on `config.php`. `admin.html` then opens without the password while you're signed in, and the **Use my When RU Free account** button does the same. That account may also use reserved usernames such as `whenrufree`. The admin password keeps working as a fallback.

### 3. File Upload

Upload all project files to the web-accessible directory (e.g. `/home/perthrel/public_html/grape/` or equivalent subfolder on sandgroper.net).

Include the whole `includes/` folder (`http.php`, `data.php`, `security.php`, `sessions.php`, `hubs.php`, `accounts.php`, `oauth.php`, `webauthn.php`, `lockout.php`, `access.php`, `booking.php`, `.htaccess`); `api.php` stops with a fatal error if any is missing. Every page needs `passkey.js`, `account-core.js` and `account.css`; the profile page is `account.html` + `account.js`. The calendar page needs all six `calendar-*.js` files and the admin panel all five `admin-*.js` files.

Rename `_htaccess` to `.htaccess`.

### 4. Font File

Place the Material Symbols Outlined woff2 font at `fonts/material-symbols-outlined.woff2`. This is self-hosted to avoid external CDN dependencies.

### 5. Cron Job

Set up the cleanup script to run daily:

```
0 3 * * * /usr/bin/php /home/perthrel/public_html/grape/cleanup.php >> /home/perthrel/grape_private/logs/cleanup.log 2>&1
```

This handles: inactive calendar and Hub deletion, rate limit table pruning, claim lockout resets, resetting the lockout escalation after 30 days without a lockout, deleting expired access emoji grants and old wrong-pick counters, and (step 10) expired account sessions, abandoned passkey sign-ups, emoji picks for deleted calendars/Hubs, and accounts unused for `accounts.inactive_days` that have no calendars or Hubs, and (step 11) closed reports kept for `accounts.reports_keep_days` (default 180) as an audit trail. Open reports are never touched. Steps 3 and 6 (old PIN sessions) are skipped once migration 008 has run.

## Security Checklist

- [ ] Config file is outside webroot (`/home/perthrel/grape_private/config.php`)
- [ ] `.htaccess` blocks `cleanup.php`, `config.php`, `error_log`, `*.sql`
- [ ] `includes/.htaccess` (`Require all denied`) is uploaded
- [ ] HTTPS is enabled and HSTS header is active (browsers only allow passkeys over HTTPS, and the account cookie is Secure)
- [ ] PHP `openssl` extension is enabled (needed to verify passkey signatures) and `curl` is enabled (Google / Facebook)
- [ ] `accounts.pepper` is set to 64+ random hex characters and backed up with the config
- [ ] Google and Facebook redirect URIs match `accounts.base_url` exactly
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
6. **Accounts release:** run migration 007, add the `accounts` block to `config.php`, then upload `api.php`, all of `includes/` (new `accounts.php`, `oauth.php`), `cleanup.php`, every HTML page, `account.html`, `account.js`, `account-core.js`, `account.css`, `passkey.js`, the `calendar-*.js`, `admin-*.js` (new `admin-accounts.js`), `hub.js`, `index.js` and the CSS files. Existing PIN names and Hubs keep working as "claimable" until migration 008.
7. **Invite only release:** run migration 009, then upload `api.php`, `cleanup.php`, `includes/` (new `members.php`; changed `access.php`, `accounts.php`, `data.php`, `security.php`), every HTML page (new `?v=` cache-busters), `account-core.js`, `account.js`, `emoji.js`, `calendar-core.js`, `calendar-users.js`, `hub.js`, `index.js`, `admin-core.js`, `admin-calendars.js`, `admin-hubs.js` and the CSS files (`account.css`, `calendar.css`, `hub.css`, `index.css`, `admin.css`). No config changes.
8. **2026-10-09 release** (signed-out home page, People view with eye toggle, rename in People, organiser marks, compact account badge, template privacy / join): run migration 010, then upload `api.php`, `includes/data.php`, `includes/security.php`, `index.html`, `hub.html`, `calendar.html`, `account.html`, `admin.html`, `go/index.html`, `faq.html`, `guide.html`, `ideas.html`, `privacy.html`, `account-core.js`, `account.css`, `index.js`, `hub.js`, `admin-setup.js`, `calendar-core.js`, `calendar-users.js`, `calendar-grid.js`, `calendar-main.js` and `calendar.css`. No config changes.
9. **2026-10-10 release** (Manage person menu, reports, private usernames): run migration 011, then upload `api.php`, `includes/data.php`, `includes/members.php`, `includes/reports.php`, `includes/security.php`, `cleanup.php`, `calendar.html`, `calendar.css`, `calendar-core.js`, `calendar-users.js`, `calendar-main.js`, `account.html`, `account-core.js`, `account.js`, `hub.html`, `hub.js`, `admin.html`, `admin-reports.js`, `admin-core.js`, `admin.css`, `index.html`, `go/index.html`, `faq.html`, `guide.html`, `privacy.html` and `ideas.html`. No config changes.
10. **Invite only removal** (the link is the only access control): run migration 014, then upload `api.php`, `cleanup.php`, `includes/access.php`, `includes/accounts.php`, `includes/members.php`, `includes/security.php`, `index.html`, `index.js`, `index.css`, `calendar.html`, `calendar-core.js`, `calendar-users.js`, `calendar.css`, `hub.html`, `hub.js`, `hub.css`, `account.html`, `account-core.js`, `account.js`, `account.css`, `admin-core.js`, `admin-calendars.js`, `admin-hubs.js`, `admin.css`, `faq.html`, `guide.html`, `ideas.html` and `privacy.html`. No config changes.
11. **2026-10-17 release** (reports for everyone, profile leave / delete, admin test users, template examples in Setup): run migrations 015 and 016, then upload `api.php`, `cleanup.php`, `includes/accounts.php`, `includes/data.php`, `includes/reports.php`, `includes/security.php`, `calendar.html`, `calendar.css`, `calendar-core.js`, `calendar-users.js`, `calendar-main.js`, `account.html`, `account.css`, `account-core.js`, `account.js`, `admin.html`, `admin.css`, `admin-accounts.js`, `admin-reports.js`, `admin-setup.js`, `index.html`, `index.js`, `index.css`, `page.css`, `hub.html`, `go/index.html`, `ideas.html`, `faq.html`, `guide.html` and `privacy.html`. No config changes.

## Monitoring

- Security logs: `grape_private/logs/security_YYYY-MM.log`
- Cleanup logs: `grape_private/logs/cleanup.log`
- PHP error log: `error_log` in webroot (blocked by .htaccess)
- Rate limit table size: check `api_rate_limit` row count periodically

## Scaling Notes

- The app is designed for shared hosting with tens of thousands of calendar entries
- Rate limiting uses a MariaDB upsert pattern (known race condition, acceptable at current scale)
- Account sessions are stored in DB, not files (works across load-balanced instances)
- No external dependencies at runtime (no CDNs, no npm, no build)
