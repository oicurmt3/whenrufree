# Data Dictionary

Database schema for When RU Free. MariaDB 10.x, utf8mb4 charset.

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
- `organiser_message` app limit is 250 chars (MESSAGE_MAX_LEN in api.php). Column is VARCHAR(250) to match. Column should always be wider than or equal to the app limit
- Token collision on create retries up to 5 times

---

## Table: users

Participants within a calendar.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| calendar_id | BIGINT UNSIGNED | - | FK to calendars.id (CASCADE DELETE) |
| display_name | VARCHAR(40) | - | User's display name |
| role | VARCHAR(10) | 'member' | "admin" (organiser) or "member" |
| pin_hash | VARCHAR(255) | - | bcrypt hash of 4-digit PIN |
| created_at | DATETIME | CURRENT_TIMESTAMP | Creation timestamp |
| updated_at | DATETIME | NULL | Last update (currently unused) |
| failed_attempts | TINYINT UNSIGNED | 0 | Consecutive failed PIN attempts |
| locked_until | DATETIME | NULL | Account locked until this time. NULL = not locked |

**Indexes:**
- PRIMARY KEY (`id`)
- UNIQUE `ux_users_cal_name` (`calendar_id`, `display_name`)
- INDEX `idx_users_cal` (`calendar_id`)
- INDEX `idx_users_locked` (`locked_until`)

**Constraints:**
- FK `fk_users_calendar` -> calendars.id ON DELETE CASCADE

**Business rules:**
- Each calendar has exactly one admin (the organiser, created with the calendar)
- After 5 failed PIN attempts, `locked_until` is set to NOW() + 15 minutes
- Display names are unique per calendar (enforced by unique index)

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

## Table: user_sessions

Authentication tokens for logged-in users.

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

Hub (group calendar folder) — one private URL lists multiple calendars.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| token | VARCHAR(64) | - | URL token for `hub.html?g=` (8 chars new) |
| title | VARCHAR(80) | '' | Hub display name |
| organiser_name | VARCHAR(40) | - | Single hub organiser display name |
| organiser_pin_hash | VARCHAR(255) | - | bcrypt hash of 4-digit PIN |
| failed_attempts | TINYINT UNSIGNED | 0 | Failed PIN attempts |
| locked_until | DATETIME | NULL | Hub organiser lockout expiry |
| created_at | DATETIME | CURRENT_TIMESTAMP | Creation timestamp |
| last_activity | DATETIME | NULL | Last hub view or child calendar activity |
| never_expires | TINYINT(1) | 0 | 1 = protected from cleanup.php Hub deletion |

**Indexes:** PRIMARY KEY (`id`), UNIQUE `uq_groups_token` (`token`)

---

## Table: group_sessions

Hub organiser auth sessions.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | BIGINT UNSIGNED | AUTO_INCREMENT | Primary key |
| group_id | BIGINT UNSIGNED | - | FK to groups.id CASCADE |
| token | CHAR(64) | - | Hex token (`X-Group-Auth-Token` header) |
| created_at | DATETIME | CURRENT_TIMESTAMP | Session creation |
| expires_at | DATETIME | - | Expiry (1 day) |

---

## Table: user_passkeys

Fingerprint / face unlock (WebAuthn) credentials for calendar users. Created by `migrations/001_passkeys.sql`.

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
- Deleting a calendar or user deletes its passkeys (FK cascade) — no cleanup.php changes needed
- No biometric data is stored; the fingerprint / face check happens on the device

---

## Table: group_passkeys

Same as `user_passkeys`, but for Hub organisers. `group_id` (FK to groups.id, CASCADE DELETE) replaces `calendar_id` / `user_id`.

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
- Hub add limits use action keys such as `hub_add_{groupId}_{YYYYMMDDHH}` and `hub_add_global_{YYYYMMDDHH}` (see `enforceActionRateLimit` in api.php)
- Passkey limits use `pkr{YYYYMMDDHHmm}` (enrolment) and `pkl{YYYYMMDDHHmm}` (login) — kept within the 16-char column
- Known race condition on concurrent upserts (acceptable at current scale)
- Pruned by cleanup.php (default: entries older than 60 minutes)
