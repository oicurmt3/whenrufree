-- Booking mode: organiser-chosen colours (#rrggbb) and names for partly booked and full slots.
-- NULL = defaults (partly booked: orange #ffb74d "Partly booked"; full: red #c62828 "Full").
-- Needs migrations/004_booking.sql first.
-- Apply once in phpMyAdmin (MariaDB); safe to re-run. The Partly booked / Full settings stay hidden until this runs.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS partial_color CHAR(7) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS full_color CHAR(7) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partial_label VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS full_label VARCHAR(20) NULL DEFAULT NULL;
