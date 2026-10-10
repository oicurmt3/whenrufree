# Data Dictionary

Database schema for When RU Free. MariaDB 10.x, utf8mb4 charset.

## Table: accounts

One row per person. Created by `migrations/007_accounts.sql`. No email, real name or picture is stored.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| username | VARCHAR(20) | NULL | Private unique username: 3-20 lowercase letters, numbers or `_`, not reserved (admin accounts in `admin.account_ids` may use reserved names). NULL until setup is finished |
| display_name | VARCHAR(40) | NULL | Profile name used on calendars by default (app limit 32). NULL until setup is finished |
| created_at | DATETIME | - | Created |
| last_seen_at | DATETIME | - | Last use (updated at most once a day with the session renewal) |

**Indexes:** PRIMARY KEY (`id`), UNIQUE `uq_accounts_username` (`username`), INDEX `idx_accounts_last_seen` (`last_seen_at`)

**Business rules:**
- An account without `username` or `display_name` "needs setup" and can only use `account_*` actions
- Deleting an account removes the calendars and Hubs it organises, its names and availability elsewhere, and every `account_*` row (FK cascades)
- cleanup.php deletes accounts unused for `accounts.inactive_days` (default 730) that have no names and no Hubs, and passkey sign-ups abandoned before a passkey was saved

---

## Table: account_identities

Google / Facebook logins linked to an account.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| account_id | BIGINT UNSIGNED | - | FK to accounts.id (CASCADE DELETE) |
| provider | ENUM('google','facebook') | - | Provider |
| subject_hash | BINARY(32) | - | HMAC-SHA-256 of the provider's user ID (Google `sub`, Facebook app-scoped `id`) keyed with `accounts.pepper`. The raw ID is never stored |
| created_at | DATETIME | - | Linked |
| last_used_at | DATETIME | NULL | Last sign-in with it |

**Indexes:** PRIMARY KEY (`id`), UNIQUE `uq_account_identity` (`provider`, `subject_hash`), INDEX (`account_id`)

---

## Table: account_passkeys

Passkeys (discoverable WebAuthn credentials) for accounts.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| account_id | BIGINT UNSIGNED | - | FK to accounts.id (CASCADE DELETE) |
| credential_id | VARBINARY(255) | - | Raw WebAuthn credential ID (unique across the site) |
| public_key_pem | TEXT | - | Device public key (SPKI PEM). Not a secret |
| alg | SMALLINT | -7 | COSE algorithm: -7 = ES256, -257 = RS256 |
| sign_count | INT UNSIGNED | 0 | Last authenticator counter (replay / clone detection) |
| transports_json | VARCHAR(255) | NULL | JSON array of transports reported by the browser |
| device_label | VARCHAR(40) | NULL | Short device name shown on the profile page ("iPhone", "Windows PC"). Sanitised plain text |
| created_at | DATETIME | CURRENT_TIMESTAMP | When the passkey was added |
| last_used_at | DATETIME | NULL | Last sign-in with it |

**Business rules:**
- Max 10 passkeys per account (`WEBAUTHN_MAX_PER_SUBJECT`)
- No biometric data is stored; the fingerprint / face check happens on the device

---

## Table: account_sessions

Signed-in devices.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| account_id | BIGINT UNSIGNED | - | FK to accounts.id (CASCADE DELETE) |
| token_hash | BINARY(32) | - | SHA-256 of the 64-hex `wruf_account` cookie. The raw token is never stored |
| created_at | DATETIME | - | Signed in |
| expires_at | DATETIME | - | 30 days; pushed forward at most once a day while used |

**Indexes:** PRIMARY KEY (`id`), UNIQUE `uq_account_sessions_hash` (`token_hash`), INDEX (`expires_at`)

---

## Table: account_access

Access emoji already picked by an account (asked once per account, on any device).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| account_id | BIGINT UNSIGNED | - | FK to accounts.id (CASCADE DELETE) |
| kind | ENUM('calendar','group') | - | Calendar or Hub |
| subject_id | BIGINT UNSIGNED | - | calendars.id or groups.id (no FK; orphans removed by cleanup.php) |
| created_at | DATETIME | - | When it was picked |

**Indexes:** PRIMARY KEY (`account_id`, `kind`, `subject_id`), INDEX (`kind`, `subject_id`)

**Business rules:** changing or removing the emoji deletes every row for that calendar/Hub.

---

## Table: account_hubs

Hubs an account has opened (listed on its profile page).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| account_id | BIGINT UNSIGNED | - | FK to accounts.id (CASCADE DELETE) |
| group_id | BIGINT UNSIGNED | - | FK to groups.id (CASCADE DELETE) |
| created_at | DATETIME | - | First opened |
| last_opened_at | DATETIME | - | Last opened |

---

## Table: calendars

Core configuration for each scheduling calendar.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| token | VARCHAR(64) | - | URL-safe unique identifier. 8 chars (new) or 48 chars (legacy) |
| group_id | BIGINT UNSIGNED | NULL | FK to groups.id. NULL if standalone calendar |
| created_at | DATETIME | CURRENT_TIMESTAMP | Creation timestamp |
| last_activity | DATETIME | NULL | Last user interaction. NULL if never used after creation |
| title | VARCHAR(80) | '' | Calendar title. Empty string if untitled |
| category | VARCHAR(120) | '["groups"]' | JSON array of category keys (max 3). e.g. `["groups","sport"]` |
| slots_json | TEXT | NULL | JSON array of slot labels. e.g. `["Morning","Afternoon","Evening"]` |
| statuses_json | TEXT | NULL | JSON array of status objects. e.g. `[{"label":"Yes","color":"#4caf50","weight":2}]` |
| start_date | DATE | NULL | Calendar start date |
| end_date | DATE | NULL | Calendar end date. Max 360 days from start |
| exclude_weekends | TINYINT(1) | 0 | 1 = hide Saturday/Sunday columns |
| date_filter_mode | VARCHAR(10) | 'all' | "all" (no filter), "only" (show selected), "except" (hide selected) |
| date_filter_dates | TEXT | NULL | JSON array of YYYY-MM-DD strings selected by organiser |
| is_private | TINYINT(1) | 0 | 0=open, 1=hidden, 2=blind. Controls roster visibility |
| start_month | CHAR(7) | NULL | YYYY-MM for start_date (query optimisation) |
| end_month | CHAR(7) | NULL | YYYY-MM for end_date (query optimisation) |
| never_expires | TINYINT(1) | 0 | 1 = protected from cleanup.php deletion |
| rank_sort_order | VARCHAR(5) | 'score' | "score" (best first) or "date" (chronological) |
| organiser_message | VARCHAR(250) | NULL | Short note from organiser. NULL if empty |
| chosen_date | VARCHAR(10) | NULL | Locked-in date (YYYY-MM-DD) or NULL if open |
| chosen_slot | VARCHAR(50) | NULL | Locked-in slot ID or NULL if open |
| access_emoji | TINYINT UNSIGNED | NULL | Access emoji position 0-34 (list in `emoji.js`), NULL = none. Migration 003 |
| slot_capacity | TINYINT UNSIGNED | NULL | Booking calendars: people per slot 1-20. NULL = normal availability poll. Migration 004 |
| max_per_user | TINYINT UNSIGNED | NULL | Booking calendars: bookings each person can hold 1-20 (per day, or in total when `per_user_total` = 1), NULL = no limit. Migration 004 |
| partial_color | CHAR(7) | NULL | Booking calendars: `#rrggbb` cell colour for partly booked slots, NULL = default orange. Migration 006 |
| partial_label | VARCHAR(20) | NULL | Booking calendars: legend name for partly booked slots (option-label rules), NULL = "Partly booked". Migration 006 |
| full_label | VARCHAR(20) | NULL | Booking calendars: legend and cell name for full slots (option-label rules), NULL = "Full". Migration 006 |
| full_color | CHAR(7) | NULL | Booking calendars: `#rrggbb` cell colour for full slots, NULL = default red. Migration 006 |
| per_user_total | TINYINT(1) | 0 | Booking calendars: 1 = `max_per_user` counts across the whole calendar, 0 = per day. Ignored when `max_per_user` is NULL. Migration 005 |
| bookings_closed | TINYINT(1) | 0 | Booking calendars: 1 = organiser closed bookings. Migration 004 |
| hide_names | TINYINT(1) | 0 | Hidden calendars: 1 = members see only themselves, the organisers and a total (Blind always does this). Migration 009 |
| show_organiser_marks | TINYINT(1) | 1 | Open calendars: 1 = the organiser's answers show as a coloured left edge on everyone's slots, 0 = hidden. The organiser changes it in Calendar settings (`set_organiser_marks`). Migration 010 |

**Indexes:**
- PRIMARY KEY (`id`)
- UNIQUE `uq_cal_token` (`token`)
- INDEX `idx_cal_last_activity` (`last_activity`)
- INDEX `idx_cal_created_at` (`created_at`)
- INDEX `idx_cal_never_expires` (`never_expires`)
- INDEX `idx_cal_group_id` (`group_id`)

**Business rules:**
- At most one Hub per calendar (`group_id` nullable)
- When both `chosen_date` and `chosen_slot` are non-NULL, the calendar is "frozen" -- availability saves are blocked server-side
- `organiser_message` app limit is 250 chars (MESSAGE_MAX_LEN in includes/data.php). Column is VARCHAR(250) to match. Column should always be wider than or equal to the app limit
- Token collision on create retries up to 5 times
- A calendar with `access_emoji` NULL inside a Hub with an emoji uses the Hub's emoji
- Booking calendars (`slot_capacity` set) have exactly one status (1 = booked, weight 1), never Blind privacy (`is_private` 0 or 1), and store bookings as `availability` rows. `save` locks the calendar row and refuses bookings beyond `slot_capacity` per slot or `max_per_user` per person per day (or in total when `per_user_total` = 1; the organiser booking for themselves is exempt from `max_per_user`). The booking columns are set only at creation
- While `bookings_closed` = 1, participants cannot save or reset; the organiser still can
- `hide_names` is set only in `create_calendar` (Hidden calendars only)
- `show_organiser_marks` only changes what the page draws; on Open calendars the organiser's answers are still in `availability` responses (Best Match names, People view)

---

## Table: users

Names on a calendar. Each belongs to an account, except old names from before accounts that nobody has claimed yet.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| calendar_id | BIGINT UNSIGNED | - | FK to calendars.id (CASCADE DELETE) |
| display_name | VARCHAR(40) | - | Name shown on this calendar (app limit 32) |
| role | VARCHAR(10) | 'member' | "admin" (organiser) or "member" |
| account_id | BIGINT UNSIGNED | NULL | FK to accounts.id (CASCADE DELETE). NULL = old name not claimed yet. Migration 007 |
| name_custom | TINYINT(1) | 0 | 0 = follows the account's profile name; 1 = a name just for this calendar. Migration 007 |
| pin_hash | VARCHAR(255) | NULL | Old names only: bcrypt hash of the 4-digit PIN, set to NULL when claimed (and for all rows by migration 008) |
| created_at | DATETIME | CURRENT_TIMESTAMP | Creation timestamp |
| updated_at | DATETIME | NULL | Last update (currently unused) |
| failed_attempts | TINYINT UNSIGNED | 0 | Consecutive wrong PINs when claiming |
| locked_until | DATETIME | NULL | Claim locked until this time. NULL = not locked |
| lockout_level | TINYINT UNSIGNED | 0 | Lockouts so far (0-4); picks the next lock length. Migration 002 |
| last_locked_at | DATETIME | NULL | When the last lockout started; used for the 30-day reset. Migration 002 |
| blocked | TINYINT(1) | 0 | 1 = the organiser has blocked this person: 403 `BLOCKED`, answers left out of views and Best Match (bookings still count). Never set on the organiser. Migration 009 |

**Indexes:**
- PRIMARY KEY (`id`)
- UNIQUE `ux_users_cal_name` (`calendar_id`, `display_name`)
- UNIQUE `ux_users_cal_account` (`calendar_id`, `account_id`) - one name per account per calendar
- INDEX `idx_users_cal` (`calendar_id`)
- INDEX `idx_users_locked` (`locked_until`)

**Constraints:**
- FK `fk_users_calendar` -> calendars.id ON DELETE CASCADE
- FK `fk_users_account` -> accounts.id ON DELETE CASCADE

**Business rules:**
- Each calendar has exactly one admin (the organiser: the account that created the calendar)
- A claimable name has `account_id` NULL and a `pin_hash`. `claim_name` checks the PIN once, sets `account_id`, clears `pin_hash`
- After 5 wrong PINs in a row the claim locks for 5 minutes, then 15 minutes, then 2 hours, then 2 days (repeats); `lockout_level` goes up by one each time and `failed_attempts` restarts at 0
- A successful claim or super admin Unlock sets `lockout_level` back to 0; so does `cleanup.php` after 30 days without a lockout
- Changing the profile name updates every row with `name_custom` = 0 (a calendar where that name is taken keeps the old one)
- Names are unique per calendar (enforced by unique index)

---

## Table: availability

Individual status selections per user, date, and slot.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| calendar_id | BIGINT UNSIGNED | - | FK to calendars.id (CASCADE DELETE) |
| user_id | BIGINT UNSIGNED | - | FK to users.id (CASCADE DELETE) |
| day | DATE | - | The date this selection applies to |
| slot | VARCHAR(20) | - | Slot label (matches slots_json entry) |
| status | TINYINT UNSIGNED | - | 1..5 (maps to statuses_json index). 0 = delete row |
| updated_at | DATETIME | CURRENT_TIMESTAMP ON UPDATE | Last modification |

**Indexes:**
- PRIMARY KEY (`id`)
- UNIQUE `uq_avail` (`calendar_id`, `user_id`, `day`, `slot`)
- INDEX `idx_avail_range` (`calendar_id`, `day`)
- INDEX `idx_avail_cal_day` (`calendar_id`, `day`)

**Constraints:**
- FK `fk_avail_calendar` -> calendars.id ON DELETE CASCADE
- FK `fk_avail_user` -> users.id ON DELETE CASCADE

**Business rules:**
- Status 0 is never stored -- the row is deleted instead (save endpoint uses DELETE for status=0)
- The unique constraint enables INSERT ... ON DUPLICATE KEY UPDATE for upserts
- Status values are integer-indexed (1-based), mapped to statuses_json array (0-based) on the client

---

## Table: user_sessions (legacy)

Old PIN login tokens. No longer written; cleanup.php deletes expired rows, and `migrations/008_drop_pins.sql` drops the table.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| calendar_id | BIGINT UNSIGNED | - | FK to calendars.id (CASCADE DELETE) |
| user_id | BIGINT UNSIGNED | - | FK to users.id (CASCADE DELETE) |
| token | CHAR(64) | - | Hex auth token (sent via X-Auth-Token header) |
| created_at | DATETIME | CURRENT_TIMESTAMP | Session creation |
| expires_at | DATETIME | - | Expiry (created_at + 24 hours) |

**Indexes:**
- PRIMARY KEY (`id`)
- UNIQUE `uq_sessions_token` (`token`)
- INDEX `idx_sess_cal_user` (`calendar_id`, `user_id`)
- INDEX `idx_sess_exp` (`expires_at`)

**Constraints:**
- FK `fk_sess_cal` -> calendars.id ON DELETE CASCADE
- FK `fk_sess_user` -> users.id ON DELETE CASCADE

**Notes:**
- Sessions are not invalidated on new login -- multiple concurrent sessions are allowed
- Expired sessions are cleaned up by cleanup.php cron job

---

## Table: groups

Hub (group calendar folder) - one private URL lists multiple calendars.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| token | VARCHAR(64) | - | URL token for `hub.html?g=` (8 chars new) |
| title | VARCHAR(80) | '' | Hub display name |
| organiser_name | VARCHAR(40) | - | Organiser name shown on the Hub (profile name unless one was typed) |
| organiser_account_id | BIGINT UNSIGNED | NULL | FK to accounts.id (ON DELETE SET NULL). NULL = old Hub not claimed yet. Migration 007 |
| organiser_pin_hash | VARCHAR(255) | NULL | Old Hubs only: bcrypt hash of the organiser PIN, set to NULL when claimed (and for all rows by migration 008) |
| failed_attempts | TINYINT UNSIGNED | 0 | Wrong PINs when claiming |
| locked_until | DATETIME | NULL | Claim lockout expiry |
| lockout_level | TINYINT UNSIGNED | 0 | Escalation level, same rules as `users.lockout_level`. Migration 002 |
| last_locked_at | DATETIME | NULL | When the last organiser lockout started. Migration 002 |
| created_at | DATETIME | CURRENT_TIMESTAMP | Creation timestamp |
| last_activity | DATETIME | NULL | Last hub view or child calendar activity |
| never_expires | TINYINT(1) | 0 | 1 = protected from cleanup.php Hub deletion |
| access_emoji | TINYINT UNSIGNED | NULL | Hub access emoji position 0-34, NULL = none. Also guards every calendar in the Hub that has no emoji of its own. Migration 003 |

**Indexes:** PRIMARY KEY (`id`), UNIQUE `uq_groups_token` (`token`), INDEX `idx_groups_organiser_account` (`organiser_account_id`)

**Business rules:** deleting the organiser's account deletes its Hubs (calendars in them are detached, not deleted). Old Hubs are claimed once with `claim_hub`.

---

## Table: group_sessions (legacy)

Old Hub organiser PIN sessions. No longer written; dropped by migration 008.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| group_id | BIGINT UNSIGNED | - | FK to groups.id CASCADE |
| token | CHAR(64) | - | Hex token (`X-Group-Auth-Token` header) |
| created_at | DATETIME | CURRENT_TIMESTAMP | Session creation |
| expires_at | DATETIME | - | Expiry (1 day) |

---

## Table: user_passkeys (legacy)

Old per-calendar passkeys, from `migrations/001_passkeys.sql`. No longer read (passkeys now belong to accounts, see `account_passkeys`); rows are deleted when a name is claimed, and migration 008 drops the table.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| calendar_id | BIGINT UNSIGNED | - | FK to calendars.id (CASCADE DELETE) |
| user_id | BIGINT UNSIGNED | - | FK to users.id (CASCADE DELETE) |
| credential_id | VARBINARY(255) | - | Raw WebAuthn credential ID (unique across the site) |
| public_key_pem | TEXT | - | Device public key (SPKI PEM). Not a secret |
| alg | SMALLINT | -7 | COSE algorithm: -7 = ES256, -257 = RS256 |
| sign_count | INT UNSIGNED | 0 | Last authenticator counter (replay / clone detection) |
| transports_json | VARCHAR(255) | NULL | JSON array of transports reported by the browser |
| device_label | VARCHAR(40) | NULL | Short device name shown in the device list ("iPhone", "Windows PC"). Sanitised plain text |
| created_at | DATETIME | CURRENT_TIMESTAMP | When the device was set up |
| last_used_at | DATETIME | NULL | Last successful unlock |

**Business rules:**
- Max 10 devices per user (`WEBAUTHN_MAX_PER_SUBJECT`)
- Deleting a calendar or user deletes its passkeys (FK cascade) - no cleanup.php changes needed
- No biometric data is stored; the fingerprint / face check happens on the device

---

## Table: group_passkeys (legacy)

Same as `user_passkeys`, but for old Hub organisers. `group_id` (FK to groups.id, CASCADE DELETE) replaces `calendar_id` / `user_id`.

---

## Table: access_grants

Proof that a browser picked the right access emoji (the account-wide record is `account_access`). Created by `migrations/003_access_emoji.sql`.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| kind | ENUM('calendar','group') | - | What the grant opens |
| subject_id | BIGINT UNSIGNED | - | calendars.id or groups.id (no FK; orphans removed by cleanup.php) |
| token_hash | CHAR(64) | - | SHA-256 of the 64-hex grant sent in `X-Access-Grant`. The raw grant is never stored |
| created_at | DATETIME | CURRENT_TIMESTAMP | Issued |
| expires_at | DATETIME | - | Expiry (30 days, `access_emoji.grant_days`) |

**Indexes:** PRIMARY KEY (`id`), UNIQUE (`token_hash`), INDEX (`kind`, `subject_id`), INDEX (`expires_at`)

**Business rules:**
- A `group` grant opens the Hub and every calendar in it
- Changing or removing an emoji deletes all grants for that calendar/Hub
- cleanup.php deletes expired and orphaned rows

---

## Table: access_attempts

Wrong emoji picks per IP address and calendar/Hub. Created by `migrations/003_access_emoji.sql`.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| ip | VARCHAR(45) | - | Client IP |
| kind | ENUM('calendar','group') | - | Calendar or Hub |
| subject_id | BIGINT UNSIGNED | - | calendars.id or groups.id |
| failed_attempts | TINYINT UNSIGNED | 0 | Wrong picks since the last lock |
| locked_until | DATETIME | NULL | Lock expiry |
| lockout_level | TINYINT UNSIGNED | 0 | Escalation: 5 min, 15 min, 2 h, 2 days (repeats) |
| updated_at | DATETIME | - | Last wrong pick |

**Indexes:** PRIMARY KEY (`ip`, `kind`, `subject_id`), INDEX (`updated_at`)

**Business rules:**
- 3 wrong picks (`access_emoji.max_attempts`) lock that IP out of that calendar/Hub
- A right pick deletes the row; changing or removing the emoji deletes all rows for it
- cleanup.php deletes unlocked rows with no wrong pick for 30 days (`access_emoji.attempts_keep_days`)

---

## Table: reports

Reports an organiser sends about a person from the **Manage person** menu. Created by `migrations/011_report_users.sql`.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| calendar_id | BIGINT UNSIGNED | - | calendars.id the person was on (no FK: the report outlives the calendar) |
| user_id | BIGINT UNSIGNED | NULL | users.id at the time of the report (snapshot, no FK) |
| account_id | BIGINT UNSIGNED | NULL | The reported account, when the name had one (no FK) |
| reporter_account_id | BIGINT UNSIGNED | - | The organiser's accounts.id |
| display_name | VARCHAR(40) | NULL | The name the person was using, as it was then |
| reason | VARCHAR(32) | - | Reason key from `reportReasons()` (e.g. `inappropriate_name`, `spam`) |
| details | VARCHAR(200) | NULL | Optional free text from the organiser |
| status | VARCHAR(10) | 'open' | `open` until the super admin decides, then `closed` |
| created_at | DATETIME | - | When the report was sent |
| decided_at | DATETIME | NULL | When the super admin decided |

**Indexes:** PRIMARY KEY (`id`), INDEX `idx_reports_status` (`status`, `created_at`), INDEX `idx_reports_calendar` (`calendar_id`), INDEX `idx_reports_account` (`account_id`)

**Business rules:**
- No foreign keys on purpose: a report is a snapshot and survives the calendar, the name and the account it names
- Usernames are never stored here (they stay private to the super admin)
- Written by `manage_calendar_user` *before* any block or delete, so a report sent with a delete still records the name and account
- Super admin resolves them in the admin **Reports** tab (`admin_reports`, `admin_report_decide`); cleanup.php step 11 prunes closed reports older than `accounts.reports_keep_days` (default 180)

---

## Table: api_rate_limit

Per-IP request throttling.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| ip | VARCHAR(45) | - | Client IP (supports IPv6) |
| minute_key | CHAR(16) | - | YYYYMMDDHHmm format |
| count | INT UNSIGNED | 0 | Requests in this minute window |
| updated_at | DATETIME | CURRENT_TIMESTAMP ON UPDATE | Last request time |

**Indexes:**
- PRIMARY KEY (`ip`, `minute_key`)
- INDEX `idx_rate_updated` (`updated_at`)

**Notes:**
- Upsert pattern resets count when minute_key changes (new minute window)
- General API limit uses `minute_key` as `YYYYMMDDHHmm`
- Hub add limits use `hg{YYYYMMDDHH}{groupId in base 36}` (per Hub) and `hi{YYYYMMDDHH}` (all Hubs) (see `enforceHubCalendarRateLimit` in includes/hubs.php)
- Every action key must fit the 16-char column: `enforceActionRateLimit` passes keys through `rateLimitKey()`, which replaces longer keys with `x` + 15 hex chars of their SHA-256. A too-long key would be truncated on insert and never match the count query, silently disabling the limit
- Account limits use `apr{YYYYMMDDHHmm}` (passkey enrolment), `apl{YYYYMMDDHHmm}` (passkey sign-in), `aps{YYYYMMDDHH}` (new passkey accounts, 10/hour), `acu{YYYYMMDDHHmm}` (profile changes), `oas` / `oac{YYYYMMDDHHmm}` (Google / Facebook start and callback) - kept within the 16-char column
- Access emoji hourly caps use `aw{YYYYMMDDHH}` (wrong picks, default 20/hour) and `nf{YYYYMMDDHH}` (unknown calendar/Hub codes, default 30/hour)
- Known race condition on concurrent upserts (acceptable at current scale)
- Pruned by cleanup.php (default: entries older than 60 minutes)
