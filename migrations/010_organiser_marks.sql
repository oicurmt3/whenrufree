-- Organiser marks: on Open calendars the organiser's own answers show as a coloured left edge
-- on everyone's time slots. show_organiser_marks = 0 turns that off (the organiser chooses in
-- Calendar settings, any time). Existing calendars keep the edge (default 1).
-- Apply once in phpMyAdmin (MariaDB 10.5+); safe to re-run.
-- Until it runs, the edge always shows and the setting is not offered.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS show_organiser_marks TINYINT(1) NOT NULL DEFAULT 1;
