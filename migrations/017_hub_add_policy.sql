-- Hub add policy: whether people other than the Hub organiser may add their own calendars to a
-- Hub (and create a new calendar inside it). Off by default so an existing Hub stays closed to
-- strangers until its organiser opts in. The Hub organiser can always add.
-- Apply once in phpMyAdmin (MariaDB); safe to re-run. Until this runs, only Hub organisers can add.

ALTER TABLE `groups`
  ADD COLUMN IF NOT EXISTS allow_member_calendars TINYINT(1) NOT NULL DEFAULT 0;
