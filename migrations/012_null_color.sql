-- Un-answered Slots: the organiser chooses the colour of a Slot nobody has answered yet.
-- null_color is one of five greys (#000000, #404040, #808080, #bfbfbf, #ffffff), or NULL for the
-- default light grey (#bfbfbf, the same colour Slots use until a choice is made). Chosen at
-- creation and changeable any time in Calendar settings.
-- Apply once in phpMyAdmin (MariaDB 10.5+); safe to re-run.
-- Until it runs, Slots keep the default light grey and the setting is not offered.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS null_color VARCHAR(7) NULL DEFAULT NULL;
