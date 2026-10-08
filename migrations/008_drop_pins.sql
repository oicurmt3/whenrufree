-- DRAFT - do not run yet. Removes the old PIN sign-in data about 90 days after accounts go
-- live (migration 007), once people have had time to claim their old names and Hubs.
-- Old names and Hubs still unclaimed after this lose their PIN and can no longer be claimed:
-- the names stay on their calendars (with their availability) but belong to nobody, and
-- unclaimed Hubs stay listed until cleanup.php removes them for inactivity.
-- Check first in Admin > Accounts how many names and Hubs are still unclaimed.
-- Apply once in phpMyAdmin (MariaDB 10.5+); safe to re-run.

DROP TABLE IF EXISTS user_passkeys;
DROP TABLE IF EXISTS group_passkeys;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS group_sessions;

UPDATE users SET pin_hash = NULL WHERE pin_hash IS NOT NULL;
UPDATE `groups` SET organiser_pin_hash = NULL WHERE organiser_pin_hash IS NOT NULL;
