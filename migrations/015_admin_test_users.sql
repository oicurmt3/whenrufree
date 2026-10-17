-- Test users: accounts created from the admin panel that exist only for testing.
-- They have no sign-in method of their own (no Google, Facebook or passkey) and are only
-- ever entered by the super admin with "Open as" on the Accounts tab. This flag is what
-- makes that safe: impersonation is refused for every account without it, so a real
-- person's account can never be opened from the panel.
--
-- Apply once in phpMyAdmin (MariaDB 10.5+) BEFORE uploading the code that uses it; safe to
-- re-run. Without it the panel reports that test users are not set up yet.
--
-- Note: the flag cannot be inferred. account_passkey_signup_begin() calls accountCreate()
-- before the passkey exists, so credential-less accounts already occur naturally and would
-- otherwise be indistinguishable from a test user.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS created_by_admin TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE accounts
  ADD KEY IF NOT EXISTS idx_accounts_created_by_admin (created_by_admin);
