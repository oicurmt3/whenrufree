-- Reports can now go to two places: the calendar organiser (a member reporting another
-- member) or the super admin (a member reporting the organiser, or an organiser reporting
-- someone). See includes/reports.php for the routing rule.
--
-- audience        'organiser' (that calendar's inbox) or 'super' (super admin queue)
-- target_role     the reported person's role when it happened ('admin' or 'user')
-- reporter_user_id the reporter's users.id on that calendar, for one-open-report-per-person
-- reporter_name   the reporter's name on that calendar, so the organiser sees who reported
-- calendar_title  snapshot of the calendar title: super-audience reports outlive the calendar
-- outcome         'dismissed' | 'blocked' | 'removed' | 'escalated' once decided
--
-- No foreign keys on purpose (as in migrations/011): a report must survive the calendar, the
-- account and the name it describes. Only organiser-audience reports are deleted with their
-- calendar; reports about an organiser must never be erasable by deleting the calendar.
--
-- Apply once in phpMyAdmin (MariaDB 10.5+); safe to re-run.
-- Until it runs, the existing organiser-to-super-admin reporting keeps working and the new
-- member reporting is not offered.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS audience VARCHAR(10) NOT NULL DEFAULT 'super',
  ADD COLUMN IF NOT EXISTS target_role VARCHAR(10) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS reporter_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS calendar_title VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(12) NULL;

ALTER TABLE reports
  ADD INDEX IF NOT EXISTS idx_reports_cal_audience (calendar_id, audience, status);
