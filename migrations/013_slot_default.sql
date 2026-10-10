-- Default option: the option all Slots begin with, so there is no un-answered (null) state.
-- default_status is the 1-based position in statuses_json, or NULL for "no default option"
-- (Slots start un-answered). NULL is not 0: availability.status already uses 0 for un-answered,
-- so 0 would be ambiguous. Booking calendars never use this (their Slots are free until booked).
-- Apply once in phpMyAdmin (MariaDB 10.5+); safe to re-run.
-- Until it runs, Slots start un-answered and the setting is not offered.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS default_status TINYINT UNSIGNED NULL DEFAULT NULL;
