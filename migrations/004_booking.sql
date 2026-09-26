-- Booking mode: limit how many people can pick each slot (first come, first served).
-- slot_capacity NULL = normal availability poll; 1..20 = people per slot.
-- max_per_user NULL = no limit; 1..20 = bookings each person can hold per day (organiser exempt).
-- bookings_closed 1 = organiser has closed bookings (no more changes).
-- Apply once in phpMyAdmin (MariaDB); safe to re-run. The option stays hidden until this runs.

ALTER TABLE calendars
  ADD COLUMN IF NOT EXISTS slot_capacity TINYINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_per_user TINYINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bookings_closed TINYINT(1) NOT NULL DEFAULT 0;
