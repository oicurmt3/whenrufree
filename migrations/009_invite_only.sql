-- Invite only, Block and private names.
-- invite_only: chosen once when a calendar or Hub is created. People with the link tap
--   "Request access" and the organiser approves or declines. Calendars in an Invite only Hub
--   are Invite only too, and Hub approval opens every calendar in it.
-- hide_names: Hidden calendars only. Participants see themselves, the organiser and a count
--   instead of every name (Blind calendars always do this).
-- users.blocked: the organiser paused this person's access to the calendar. Their answers
--   are kept but hidden; unblocking restores everything.
-- access_requests: one row per account per calendar or Hub. 'blocked' is only used for
--   Hub-wide blocks; calendar blocks use users.blocked.
-- Apply once in phpMyAdmin (MariaDB 10.5+) BEFORE uploading the Invite only code; safe to re-run.
-- Until it runs, nothing is gated and the create page hides the new options.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS invite_only TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hide_names TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `groups`
  ADD COLUMN IF NOT EXISTS invite_only TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS blocked TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS access_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('calendar','group') NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(40) NOT NULL,
  status ENUM('pending','approved','declined','blocked') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_requests (kind, subject_id, account_id),
  KEY idx_access_requests_subject (kind, subject_id, status),
  KEY idx_access_requests_account (account_id),
  CONSTRAINT fk_access_requests_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
