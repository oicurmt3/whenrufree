-- Reports: a calendar organiser can report a person when blocking them (inappropriate name,
-- spam, harassment, impersonation or other). A report is a snapshot: it keeps the person's
-- name as it was and the account it belonged to, so a super admin can review it even after
-- the person is removed. Usernames stay private, so reports never store one.
-- No foreign keys on purpose: the report survives the calendar and the account it names.
-- Apply once in phpMyAdmin (MariaDB 10.5+); safe to re-run.
-- Until it runs, blocking still works and the "Report" option is simply not offered.

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  calendar_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  account_id BIGINT UNSIGNED NULL,
  reporter_account_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(40) NULL,
  reason VARCHAR(32) NOT NULL,
  details VARCHAR(200) NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_reports_status (status, created_at),
  KEY idx_reports_calendar (calendar_id),
  KEY idx_reports_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
