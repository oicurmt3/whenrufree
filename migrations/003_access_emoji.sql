-- Access emoji: an optional single emoji (one of 35) that must be picked before a calendar
-- or Hub opens. A calendar in a Hub with an emoji uses the Hub's emoji unless it has its own.
-- A correct pick stores a 30-day access grant (SHA-256 hash of a random token).
-- Wrong picks are counted per IP address and subject (3 wrong picks lock for 5 min, then
-- 15 min, 2 hours, 2 days); cleanup.php deletes attempt rows after 30 quiet days.
-- Apply once in phpMyAdmin (MariaDB); safe to re-run. The feature stays hidden until this runs.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS access_emoji TINYINT UNSIGNED NULL DEFAULT NULL;

ALTER TABLE `groups`
  ADD COLUMN IF NOT EXISTS access_emoji TINYINT UNSIGNED NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS access_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('calendar','group') NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_grants_hash (token_hash),
  KEY idx_access_grants_subject (kind, subject_id),
  KEY idx_access_grants_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_attempts (
  ip VARCHAR(45) NOT NULL,
  kind ENUM('calendar','group') NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  lockout_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (ip, kind, subject_id),
  KEY idx_access_attempts_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
