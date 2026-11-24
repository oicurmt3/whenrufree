-- 018_app_link.sql
-- One-time codes that let the Android app pick up a browser sign-in.
-- includes/app_link.php also creates this table on first use, so running the
-- migration by hand is optional; it exists so the schema is documented in git.

CREATE TABLE IF NOT EXISTS `account_app_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `code_hash` BINARY(32) NOT NULL,
  `created_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_account_app_links_hash` (`code_hash`),
  KEY `idx_account_app_links_account` (`account_id`),
  CONSTRAINT `fk_account_app_links_account`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
