-- Remove the Invite only feature.
-- Drops the request rows and the invite_only flags added by migrations/009_invite_only.sql.
-- Kept from 009: calendars.hide_names (Hidden calendars with private names) and users.blocked
-- (the organiser pausing one person on a calendar).
-- Hub-wide blocking was part of Invite only Hubs and goes with this migration.
-- Apply once in phpMyAdmin (MariaDB 10.5+), after uploading the code that stops using them.

DROP TABLE IF EXISTS access_requests;

ALTER TABLE calendars
  DROP COLUMN IF EXISTS invite_only;

ALTER TABLE `groups`
  DROP COLUMN IF EXISTS invite_only;
