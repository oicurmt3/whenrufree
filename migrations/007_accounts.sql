-- Accounts: sign in with Google, Facebook or a passkey. Required to open, join or create
-- calendars and Hubs. No email, name or picture is requested from Google or Facebook; only a
-- keyed hash of the provider's user ID is stored. Each account has a private username and a
-- profile name that is used on calendars (with an optional per-calendar override).
-- Existing names keep their PIN until someone claims them once while signed in.
-- Apply once in phpMyAdmin (MariaDB 10.5+) BEFORE uploading the accounts code; safe to re-run.
-- Without it the site answers "Sign-in is not set up on this server yet".

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(20) NULL,
  display_name VARCHAR(40) NULL,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_username (username),
  KEY idx_accounts_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('google','facebook') NOT NULL,
  subject_hash BINARY(32) NOT NULL,
  created_at DATETIME NOT NULL,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_identity (provider, subject_hash),
  KEY idx_account_identities_account (account_id),
  CONSTRAINT fk_account_identities_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_passkeys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  credential_id VARBINARY(255) NOT NULL,
  public_key_pem TEXT NOT NULL,
  alg SMALLINT NOT NULL DEFAULT -7,
  sign_count INT UNSIGNED NOT NULL DEFAULT 0,
  transports_json VARCHAR(255) NULL,
  device_label VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_passkey_cred (credential_id),
  KEY idx_account_passkeys_account (account_id),
  CONSTRAINT fk_account_passkeys_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_sessions_hash (token_hash),
  KEY idx_account_sessions_expires (expires_at),
  CONSTRAINT fk_account_sessions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The account picked the right emoji for this calendar or Hub (no need to pick again on
-- other devices). Deleted when the organiser changes or removes the emoji.
CREATE TABLE IF NOT EXISTS account_access (
  account_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('calendar','group') NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (account_id, kind, subject_id),
  KEY idx_account_access_subject (kind, subject_id),
  CONSTRAINT fk_account_access_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hubs an account has opened (listed on its profile page).
CREATE TABLE IF NOT EXISTS account_hubs (
  account_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  last_opened_at DATETIME NOT NULL,
  PRIMARY KEY (account_id, group_id),
  KEY idx_account_hubs_group (group_id),
  CONSTRAINT fk_account_hubs_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_account_hubs_group FOREIGN KEY (group_id) REFERENCES `groups` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Calendar names owned by an account. name_custom = 1: a per-calendar name that does not
-- follow the profile name. account_id NULL: an old name not claimed yet (still has a PIN).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_id BIGINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS name_custom TINYINT(1) NOT NULL DEFAULT 0,
  MODIFY pin_hash VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE users
  ADD UNIQUE KEY IF NOT EXISTS ux_users_cal_account (calendar_id, account_id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_account FOREIGN KEY IF NOT EXISTS (account_id) REFERENCES accounts (id) ON DELETE CASCADE;

-- Hub organiser account. NULL: an old Hub not claimed yet (still has an organiser PIN).
ALTER TABLE `groups`
  ADD COLUMN IF NOT EXISTS organiser_account_id BIGINT UNSIGNED NULL DEFAULT NULL,
  MODIFY organiser_pin_hash VARCHAR(255) NULL DEFAULT NULL;

ALTER TABLE `groups`
  ADD KEY IF NOT EXISTS idx_groups_organiser_account (organiser_account_id);

ALTER TABLE `groups`
  ADD CONSTRAINT fk_groups_organiser_account FOREIGN KEY IF NOT EXISTS (organiser_account_id) REFERENCES accounts (id) ON DELETE SET NULL;
