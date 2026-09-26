-- Escalating PIN lockout: 5 wrong PINs lock for 5 min, then 15 min, then 2 hours, then 2 days
-- (2 days repeats). A correct PIN or passkey login resets the level; cleanup.php also resets it
-- after 30 days without a lockout. Apply once in phpMyAdmin (MariaDB); safe to re-run.
-- Until this runs, the API keeps the old flat 15-minute lockout.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lockout_level TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER locked_until,
  ADD COLUMN IF NOT EXISTS last_locked_at DATETIME NULL AFTER lockout_level;

ALTER TABLE `groups`
  ADD COLUMN IF NOT EXISTS lockout_level TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER locked_until,
  ADD COLUMN IF NOT EXISTS last_locked_at DATETIME NULL AFTER lockout_level;
