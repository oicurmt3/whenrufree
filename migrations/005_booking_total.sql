-- Booking mode: count Bookings per person per day (0, default) or across the whole calendar (1).
-- per_user_total only matters when max_per_user is set. Needs migrations/004_booking.sql first.
-- Apply once in phpMyAdmin (MariaDB); safe to re-run. The Per day / In total toggle stays hidden until this runs.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS per_user_total TINYINT(1) NOT NULL DEFAULT 0;
