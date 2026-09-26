-- Passkeys (fingerprint / face / device screen lock) as an alternative to the 4-digit PIN.
-- The PIN remains the backup. Apply once in phpMyAdmin; safe to re-run.
-- Rows are removed automatically when their user, calendar or Hub is deleted.

CREATE TABLE IF NOT EXISTS user_passkeys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  calendar_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  credential_id VARBINARY(255) NOT NULL,
  public_key_pem TEXT NOT NULL,
  alg SMALLINT NOT NULL DEFAULT -7,
  sign_count INT UNSIGNED NOT NULL DEFAULT 0,
  transports_json VARCHAR(255) NULL,
  device_label VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_user_passkey_cred (credential_id),
  KEY idx_user_passkeys_user (user_id),
  CONSTRAINT fk_user_passkeys_cal FOREIGN KEY (calendar_id) REFERENCES calendars (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_passkeys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_passkeys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT UNSIGNED NOT NULL,
  credential_id VARBINARY(255) NOT NULL,
  public_key_pem TEXT NOT NULL,
  alg SMALLINT NOT NULL DEFAULT -7,
  sign_count INT UNSIGNED NOT NULL DEFAULT 0,
  transports_json VARCHAR(255) NULL,
  device_label VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_group_passkey_cred (credential_id),
  KEY idx_group_passkeys_group (group_id),
  CONSTRAINT fk_group_passkeys_group FOREIGN KEY (group_id) REFERENCES `groups` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
