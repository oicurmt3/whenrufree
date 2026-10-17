<?php
/**
 * includes/accounts.php - Accounts: sessions, sign-in identities, profile, memberships and deletion.
 *
 * Signing in (Google, Facebook or a passkey) is required to open, join or create calendars and
 * Hubs. An account stores a private username, a profile name, a keyed hash of each provider's
 * user ID (never the ID itself, and never an email or picture), passkey public keys, and which
 * calendars and Hubs it belongs to.
 *
 * The session is an HttpOnly cookie (SameSite=Lax so the Google / Facebook redirect back to the
 * site keeps it). Only its SHA-256 hash is stored. It lasts 30 days and is renewed at most once a
 * day while the account is used.
 *
 * Needs migrations/007_accounts.sql. Relies on respond(), clientIp(), normaliseName() and
 * logSecurityEvent() from api.php's other includes.
 */

declare(strict_types=1);

const ACCOUNT_COOKIE = 'wruf_account';
const ACCOUNT_SESSION_DAYS = 30;
const ACCOUNT_DEFAULT_INACTIVE_DAYS = 730;
const ACCOUNT_USERNAME_RESERVED = [
    'admin', 'administrator', 'root', 'support', 'help', 'owner', 'organiser', 'organizer',
    'system', 'moderator', 'staff', 'whenrufree', 'wruf', 'null', 'undefined', 'guest',
];

/** Normalise the 'accounts' block of config.php. */
function accountConfig(array $config): array {
    $a = is_array($config['accounts'] ?? null) ? $config['accounts'] : [];
    $g = is_array($a['google'] ?? null) ? $a['google'] : [];
    $f = is_array($a['facebook'] ?? null) ? $a['facebook'] : [];
    $days = (int)($a['inactive_days'] ?? 0);
    $graph = (string)($f['graph_version'] ?? 'v21.0');
    return [
        'pepper' => (string)($a['pepper'] ?? ''),
        'base_url' => rtrim(trim((string)($a['base_url'] ?? '')), '/'),
        'google' => [
            'client_id' => trim((string)($g['client_id'] ?? '')),
            'client_secret' => trim((string)($g['client_secret'] ?? '')),
        ],
        'facebook' => [
            'app_id' => trim((string)($f['app_id'] ?? '')),
            'app_secret' => trim((string)($f['app_secret'] ?? '')),
            'graph_version' => preg_match('/^v\d{1,2}\.\d$/', $graph) ? $graph : 'v21.0',
        ],
        'inactive_days' => $days > 0 ? $days : ACCOUNT_DEFAULT_INACTIVE_DAYS,
    ];
}

/** Secret key (binary) for provider ID hashes and signed OAuth cookies. */
function accountPepper(array $config): string {
    $hex = accountConfig($config)['pepper'];
    if (!preg_match('/^[a-f0-9]{64,128}$/i', $hex)) {
        logSecurityEvent('ACCOUNT_CONFIG_MISSING', ['key' => 'accounts.pepper']);
        respond(500, ['status' => 'error', 'message' => 'Server misconfigured']);
    }
    return (string)hex2bin($hex);
}

/** True when the tables and columns from migration 007 exist. */
function accountsTablesReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT username FROM accounts LIMIT 0');
            $pdo->query('SELECT subject_hash FROM account_identities LIMIT 0');
            $pdo->query('SELECT credential_id FROM account_passkeys LIMIT 0');
            $pdo->query('SELECT token_hash FROM account_sessions LIMIT 0');
            $pdo->query('SELECT account_id, name_custom FROM users LIMIT 0');
            $pdo->query('SELECT organiser_account_id FROM `groups` LIMIT 0');
            $pdo->query('SELECT account_id FROM account_access LIMIT 0');
            $pdo->query('SELECT account_id FROM account_hubs LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

function accountRequireTables(PDO $pdo): void {
    if (!accountsTablesReady($pdo)) {
        respond(503, ['status' => 'error', 'code' => 'ACCOUNTS_UNAVAILABLE', 'message' => 'Sign-in is not set up on this server yet.']);
    }
}

function accountIsHttps(): bool {
    return !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
}

function accountSetCookie(string $value, int $expires): void {
    setcookie(ACCOUNT_COOKIE, $value, [
        'expires' => $expires,
        'path' => '/',
        'secure' => accountIsHttps(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function accountNow(int $offsetSeconds = 0): string {
    return date('Y-m-d H:i:s', time() + $offsetSeconds);
}

// -------------------------
// Sessions
// -------------------------

/** Start a 30-day session for the account and set the cookie. */
function accountCreateSession(PDO $pdo, int $accountId): void {
    $token = bin2hex(random_bytes(32));
    $expires = time() + ACCOUNT_SESSION_DAYS * 86400;
    $pdo->prepare(
        "INSERT INTO account_sessions (account_id, token_hash, created_at, expires_at)
         VALUES (:aid, :h, :now, :exp)"
    )->execute([
        ':aid' => $accountId,
        ':h' => hash('sha256', $token, true),
        ':now' => accountNow(),
        ':exp' => date('Y-m-d H:i:s', $expires),
    ]);
    $pdo->prepare("UPDATE accounts SET last_seen_at = :now WHERE id = :id")
        ->execute([':now' => accountNow(), ':id' => $accountId]);
    accountSetCookie($token, $expires);
    $GLOBALS['_wruf_account'] = null;
    $GLOBALS['_wruf_account_loaded'] = false;
}

function accountCookieToken(): ?string {
    $raw = (string)($_COOKIE[ACCOUNT_COOKIE] ?? '');
    return preg_match('/^[a-f0-9]{64}$/', $raw) ? $raw : null;
}

/**
 * The signed-in account, or null.
 * @return array{id:int, username:?string, display_name:?string, needs_setup:bool}|null
 */
function accountCurrent(PDO $pdo): ?array {
    if (!empty($GLOBALS['_wruf_account_loaded'])) return $GLOBALS['_wruf_account'];
    $GLOBALS['_wruf_account_loaded'] = true;
    $GLOBALS['_wruf_account'] = null;

    $token = accountCookieToken();
    if ($token === null || !accountsTablesReady($pdo)) return null;

    $stmt = $pdo->prepare(
        "SELECT a.id, a.username, a.display_name, s.id AS session_id, s.expires_at
         FROM account_sessions s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = :h AND s.expires_at > :now
         LIMIT 1"
    );
    $stmt->execute([':h' => hash('sha256', $token, true), ':now' => accountNow()]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;

    // Renew at most once a day: a session used within 30 days never expires.
    $renewAfter = strtotime((string)$row['expires_at']) - (ACCOUNT_SESSION_DAYS - 1) * 86400;
    if (time() >= $renewAfter) {
        $expires = time() + ACCOUNT_SESSION_DAYS * 86400;
        $pdo->prepare("UPDATE account_sessions SET expires_at = :exp WHERE id = :sid")
            ->execute([':exp' => date('Y-m-d H:i:s', $expires), ':sid' => (int)$row['session_id']]);
        $pdo->prepare("UPDATE accounts SET last_seen_at = :now WHERE id = :id")
            ->execute([':now' => accountNow(), ':id' => (int)$row['id']]);
        accountSetCookie($token, $expires);
    }

    // Accounts made before usernames were assigned get one the first time they are seen
    $username = $row['username'] !== null ? (string)$row['username'] : accountEnsureUsername($pdo, (int)$row['id']);
    $GLOBALS['_wruf_account'] = [
        'id' => (int)$row['id'],
        'username' => $username,
        'display_name' => $row['display_name'] !== null ? (string)$row['display_name'] : null,
        'needs_setup' => $username === null || $row['display_name'] === null,
    ];
    return $GLOBALS['_wruf_account'];
}

/** True until the account has a name to use on calendars (its username is assigned at sign-up). */
function accountNeedsSetup(PDO $pdo, int $accountId): bool {
    $stmt = $pdo->prepare("SELECT username, display_name FROM accounts WHERE id = :id");
    $stmt->execute([':id' => $accountId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return !$row || $row['username'] === null || $row['display_name'] === null;
}

/** Respond 401 unless signed in (and, by default, with a name for calendars chosen). */
function requireAccount(PDO $pdo, bool $setupDone = true): array {
    accountRequireTables($pdo);
    $acct = accountCurrent($pdo);
    if ($acct === null) {
        respond(401, ['status' => 'error', 'code' => 'ACCOUNT_REQUIRED', 'message' => 'Please sign in.']);
    }
    if ($setupDone && $acct['needs_setup']) {
        respond(403, ['status' => 'error', 'code' => 'ACCOUNT_SETUP', 'message' => 'Choose the name to show on calendars first.']);
    }
    return $acct;
}

/**
 * Central gate, run before every action: calendars and Hubs are only for signed-in accounts.
 * Exempt: CSRF, diagnostics, sign-in and account actions, super admin actions and the public
 * site config used by the create page.
 */
function accountGate(PDO $pdo, string $action): void {
    static $exempt = ['csrf_token', 'diag', 'get_site_config'];
    if (in_array($action, $exempt, true)
        || str_starts_with($action, 'account_')
        || str_starts_with($action, 'oauth_')
        || str_starts_with($action, 'admin_')) {
        return;
    }
    requireAccount($pdo);
}

function accountLogout(PDO $pdo): void {
    $token = accountCookieToken();
    if ($token !== null && accountsTablesReady($pdo)) {
        $pdo->prepare("DELETE FROM account_sessions WHERE token_hash = :h")
            ->execute([':h' => hash('sha256', $token, true)]);
    }
    accountSetCookie('', time() - 3600);
    $GLOBALS['_wruf_account'] = null;
    $GLOBALS['_wruf_account_loaded'] = true;
}

// -------------------------
// Identities (Google / Facebook)
// -------------------------

/** Keyed hash of a provider's user ID; the ID itself is never stored. */
function accountSubjectHash(array $config, string $provider, string $subject): string {
    return hash_hmac('sha256', $provider . ':' . $subject, accountPepper($config), true);
}

function accountIdForIdentity(PDO $pdo, string $provider, string $hash): ?int {
    $stmt = $pdo->prepare("SELECT account_id FROM account_identities WHERE provider = :p AND subject_hash = :h LIMIT 1");
    $stmt->execute([':p' => $provider, ':h' => $hash]);
    $id = $stmt->fetchColumn();
    return $id === false ? null : (int)$id;
}

/**
 * A free private username: "user" + six digits. Assigned at sign-up and never shown to anyone
 * but the account itself and the super admin, so it is not chosen by the person.
 */
function accountGenerateUsername(PDO $pdo): string {
    $stmt = $pdo->prepare("SELECT 1 FROM accounts WHERE username = :u LIMIT 1");
    for ($i = 0; $i < 20; $i++) {
        $candidate = 'user' . sprintf('%06d', random_int(0, 999999));
        if (accountNormaliseUsername($candidate) !== $candidate) continue;
        $stmt->execute([':u' => $candidate]);
        if (!$stmt->fetchColumn()) return $candidate;
    }
    logSecurityEvent('ACCOUNT_USERNAME_GENERATE_FAILED');
    respond(500, ['status' => 'error', 'message' => 'Server busy. Please try again.']);
}

/** Give an account without a username one (accounts made before usernames were assigned). */
function accountEnsureUsername(PDO $pdo, int $accountId): ?string {
    try {
        $pdo->prepare("UPDATE accounts SET username = :u WHERE id = :id AND username IS NULL")
            ->execute([':u' => accountGenerateUsername($pdo), ':id' => $accountId]);
    } catch (Throwable $e) {
        logSecurityEvent('ACCOUNT_USERNAME_BACKFILL_FAILED', ['account_id' => $accountId]);
        return null;
    }
    $stmt = $pdo->prepare("SELECT username FROM accounts WHERE id = :id");
    $stmt->execute([':id' => $accountId]);
    $v = $stmt->fetchColumn();
    return is_string($v) && $v !== '' ? $v : null;
}

function accountCreate(PDO $pdo): int {
    $pdo->prepare("INSERT INTO accounts (username, created_at, last_seen_at) VALUES (:u, :now, :now2)")
        ->execute([':u' => accountGenerateUsername($pdo), ':now' => accountNow(), ':now2' => accountNow()]);
    return (int)$pdo->lastInsertId();
}

// -------------------------
// Test users (accounts created from the admin panel)
// -------------------------

/**
 * True when migration 015 has added the created_by_admin flag. Checked separately from
 * accountsTablesReady() so that a server without the column keeps working: adding the column
 * to that probe would take the whole sign-in system offline until the migration is applied.
 */
function adminTestUsersReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT created_by_admin FROM accounts LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

function adminTestUsersRequire(PDO $pdo): void {
    if (!adminTestUsersReady($pdo)) {
        respond(503, [
            'status' => 'error',
            'code' => 'TEST_USERS_UNAVAILABLE',
            'message' => 'Test users are not set up on this server yet. Run migrations/015_admin_test_users.sql.',
        ]);
    }
}

/** True when this account was created from the admin panel. Impersonation is allowed for these only. */
function accountIsAdminCreated(PDO $pdo, int $accountId): bool {
    if ($accountId <= 0 || !adminTestUsersReady($pdo)) return false;
    $stmt = $pdo->prepare("SELECT created_by_admin FROM accounts WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $accountId]);
    return (int)($stmt->fetchColumn() ?: 0) === 1;
}

/**
 * Create a test user. Unlike accountCreate() the caller supplies both the username and the
 * name for calendars, because a NULL display_name would make accountCurrent() report
 * needs_setup and every calendar action would answer 403 ACCOUNT_SETUP.
 */
function accountCreateTestUser(PDO $pdo, string $username, string $displayName): int {
    $pdo->prepare(
        "INSERT INTO accounts (username, display_name, created_by_admin, created_at, last_seen_at)
         VALUES (:u, :dn, 1, :now, :now2)"
    )->execute([':u' => $username, ':dn' => $displayName, ':now' => accountNow(), ':now2' => accountNow()]);
    return (int)$pdo->lastInsertId();
}

/** A free username based on $candidate: the candidate itself, or it with a number appended. */
function accountFreeTestUsername(PDO $pdo, string $candidate): ?string {
    $candidate = mb_substr($candidate, 0, 20);
    if ($candidate === '') return null;
    $stmt = $pdo->prepare("SELECT 1 FROM accounts WHERE username = :u LIMIT 1");
    for ($n = 0; $n < 100; $n++) {
        $try = $n === 0 ? $candidate : mb_substr($candidate, 0, 20 - mb_strlen((string)$n)) . $n;
        $stmt->execute([':u' => $try]);
        if (!$stmt->fetchColumn()) return $try;
    }
    return null;
}

/** Test users for the admin panel, newest first. */
function accountListTestUsers(PDO $pdo, int $limit = 200): array {
    $limit = max(1, min(500, $limit));
    $stmt = $pdo->query(
        "SELECT a.id, a.username, a.display_name, a.created_at, a.last_seen_at,
                (SELECT COUNT(*) FROM users u WHERE u.account_id = a.id) AS calendar_count,
                (SELECT COUNT(*) FROM `groups` g WHERE g.organiser_account_id = a.id) AS hub_count
         FROM accounts a
         WHERE a.created_by_admin = 1
         ORDER BY a.id DESC
         LIMIT {$limit}"
    );
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[] = [
            'id' => (int)$r['id'],
            'username' => $r['username'] !== null ? (string)$r['username'] : null,
            'display_name' => $r['display_name'] !== null ? (string)$r['display_name'] : null,
            'created_at' => (string)$r['created_at'],
            'last_seen_at' => (string)$r['last_seen_at'],
            'calendar_count' => (int)$r['calendar_count'],
            'hub_count' => (int)$r['hub_count'],
        ];
    }
    return $out;
}

/** Ids of every test user, for the bulk delete. */
function accountTestUserIds(PDO $pdo): array {
    $stmt = $pdo->query("SELECT id FROM accounts WHERE created_by_admin = 1");
    return array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN));
}

/**
 * Sign in with a verified provider ID: the existing account, or a new one.
 * @return array{account_id:int, created:bool}
 */
function accountSignInWithIdentity(PDO $pdo, array $config, string $provider, string $subject): array {
    $hash = accountSubjectHash($config, $provider, $subject);
    $existing = accountIdForIdentity($pdo, $provider, $hash);
    if ($existing !== null) {
        $pdo->prepare("UPDATE account_identities SET last_used_at = :now WHERE provider = :p AND subject_hash = :h")
            ->execute([':now' => accountNow(), ':p' => $provider, ':h' => $hash]);
        return ['account_id' => $existing, 'created' => false];
    }
    $pdo->beginTransaction();
    try {
        $accountId = accountCreate($pdo);
        $pdo->prepare(
            "INSERT INTO account_identities (account_id, provider, subject_hash, created_at, last_used_at)
             VALUES (:aid, :p, :h, :now, :now2)"
        )->execute([':aid' => $accountId, ':p' => $provider, ':h' => $hash, ':now' => accountNow(), ':now2' => accountNow()]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        // A parallel sign-in with the same ID won the race: use its account.
        $raced = accountIdForIdentity($pdo, $provider, $hash);
        if ($raced !== null) return ['account_id' => $raced, 'created' => false];
        throw $e;
    }
    return ['account_id' => $accountId, 'created' => true];
}

/** Add a provider to a signed-in account. Returns 'linked', 'already' or 'taken'. */
function accountLinkIdentity(PDO $pdo, array $config, int $accountId, string $provider, string $subject): string {
    $hash = accountSubjectHash($config, $provider, $subject);
    $owner = accountIdForIdentity($pdo, $provider, $hash);
    if ($owner === $accountId) return 'already';
    if ($owner !== null) return 'taken';
    try {
        $pdo->prepare(
            "INSERT INTO account_identities (account_id, provider, subject_hash, created_at, last_used_at)
             VALUES (:aid, :p, :h, :now, :now2)"
        )->execute([':aid' => $accountId, ':p' => $provider, ':h' => $hash, ':now' => accountNow(), ':now2' => accountNow()]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000') return 'taken';
        throw $e;
    }
    return 'linked';
}

// -------------------------
// Profile
// -------------------------

/** Lowercase 3-20 letters, numbers or underscores, not reserved (unless allowed). Null when invalid. */
function accountNormaliseUsername(mixed $v, bool $allowReserved = false): ?string {
    if (!is_string($v)) return null;
    $u = strtolower(trim($v));
    if (!preg_match('/^[a-z0-9_]{3,20}$/', $u)) return null;
    if (!$allowReserved && accountUsernameReserved($u)) return null;
    return $u;
}

function accountUsernameReserved(string $username): bool {
    return in_array(strtolower(trim($username)), ACCOUNT_USERNAME_RESERVED, true);
}

/** Profile / calendar name: same rules as calendar names (letters, numbers, spaces, ' and -). */
function accountNormaliseName(mixed $v): ?string {
    if (!is_string($v)) return null;
    $n = normaliseName($v);
    if ($n === null || !preg_match("/^[A-Za-z0-9][A-Za-z0-9'\\- ]*$/", $n)) return null;
    return $n;
}

/**
 * Name to use on a calendar: the posted one when given (400 if invalid), else the profile name.
 * @return array{0:string, 1:bool} [name, true when it differs from the profile name]
 */
function accountNameForCalendar(array $acct, mixed $posted): array {
    $profile = (string)$acct['display_name'];
    if ($posted === null || (is_string($posted) && trim($posted) === '')) return [$profile, false];
    $name = accountNormaliseName($posted);
    if ($name === null) {
        respond(400, ['status' => 'error', 'message' => "Use letters, numbers, spaces, ' or - (up to 32)."]);
    }
    return [$name, $name !== $profile];
}

/**
 * Change the profile name. The username is assigned at sign-up and never changes.
 * A new profile name is copied to every calendar
 * name that follows it (name_custom = 0); calendars where that name is already taken keep
 * the old name and are returned so the page can say so.
 * @return array{renamed:int, conflicts:list<string>}
 */
function accountUpdateProfile(PDO $pdo, int $accountId, ?string $displayName): array {
    $result = ['renamed' => 0, 'conflicts' => []];
    if ($displayName === null) return $result;

    $pdo->prepare("UPDATE accounts SET display_name = :dn WHERE id = :id")
        ->execute([':dn' => $displayName, ':id' => $accountId]);

    $stmt = $pdo->prepare(
        "SELECT u.id, u.display_name, c.title
         FROM users u JOIN calendars c ON c.id = u.calendar_id
         WHERE u.account_id = :aid AND u.name_custom = 0"
    );
    $stmt->execute([':aid' => $accountId]);
    $upd = $pdo->prepare("UPDATE users SET display_name = :dn WHERE id = :uid");
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if ((string)$row['display_name'] === $displayName) continue;
        try {
            $upd->execute([':dn' => $displayName, ':uid' => (int)$row['id']]);
            $result['renamed']++;
        } catch (PDOException $e) {
            if ((string)$e->getCode() !== '23000') throw $e;
            $result['conflicts'][] = trim((string)$row['title']) !== '' ? (string)$row['title'] : 'Untitled calendar';
        }
    }
    return $result;
}

// -------------------------
// Login methods
// -------------------------

/**
 * Google, Facebook and passkeys on the account, oldest first.
 * @return list<array{type:string, id:string, label:?string, created_at:string, last_used_at:?string}>
 */
function accountMethods(PDO $pdo, int $accountId): array {
    $out = [];
    $stmt = $pdo->prepare("SELECT id, provider, created_at, last_used_at FROM account_identities WHERE account_id = :aid ORDER BY id");
    $stmt->execute([':aid' => $accountId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $out[] = [
            'type' => (string)$row['provider'],
            'id' => (string)$row['id'],
            'label' => null,
            'created_at' => (string)$row['created_at'],
            'last_used_at' => $row['last_used_at'] !== null ? (string)$row['last_used_at'] : null,
        ];
    }
    foreach (webauthnList($pdo, webauthnAccountSubject($accountId)) as $pk) {
        $out[] = [
            'type' => 'passkey',
            'id' => $pk['credential_id'],
            'label' => $pk['device_label'],
            'created_at' => $pk['created_at'],
            'last_used_at' => $pk['last_used_at'],
        ];
    }
    return $out;
}

/** Remove one login method; the last one can never be removed. */
function accountRemoveMethod(PDO $pdo, int $accountId, string $type, string $methodId): bool {
    if (count(accountMethods($pdo, $accountId)) <= 1) {
        respond(409, ['status' => 'error', 'code' => 'LAST_METHOD', 'message' => 'You need at least one way to sign in.']);
    }
    if ($type === 'passkey') {
        return webauthnDelete($pdo, webauthnAccountSubject($accountId), $methodId);
    }
    if (!in_array($type, ['google', 'facebook'], true) || !preg_match('/^\d{1,20}$/', $methodId)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }
    $stmt = $pdo->prepare("DELETE FROM account_identities WHERE id = :id AND account_id = :aid AND provider = :p");
    $stmt->execute([':id' => (int)$methodId, ':aid' => $accountId, ':p' => $type]);
    return $stmt->rowCount() > 0;
}

// -------------------------
// Calendars and Hubs
// -------------------------

/** This account's name on a calendar, or null. */
function accountCalendarUser(PDO $pdo, int $calendarId, int $accountId): ?array {
    $stmt = $pdo->prepare(
        "SELECT id, display_name, role, name_custom FROM users
         WHERE calendar_id = :cid AND account_id = :aid LIMIT 1"
    );
    $stmt->execute([':cid' => $calendarId, ':aid' => $accountId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    return [
        'id' => (int)$row['id'],
        'display_name' => (string)$row['display_name'],
        'role' => (string)$row['role'],
        'name_custom' => (int)$row['name_custom'] === 1,
    ];
}

/** Remember that the account opened a Hub (listed on the profile page). */
function accountTouchHub(PDO $pdo, int $accountId, int $groupId): void {
    $pdo->prepare(
        "INSERT INTO account_hubs (account_id, group_id, created_at, last_opened_at)
         VALUES (:aid, :gid, :now, :now2)
         ON DUPLICATE KEY UPDATE last_opened_at = VALUES(last_opened_at)"
    )->execute([':aid' => $accountId, ':gid' => $groupId, ':now' => accountNow(), ':now2' => accountNow()]);
}

/**
 * Calendars the account has a name on, and Hubs it organises or has opened.
 * @return array{calendars:list<array>, hubs:list<array>}
 */
function accountMemberships(PDO $pdo, int $accountId): array {
    $members = function_exists('membersTablesReady') && membersTablesReady($pdo);
    $calBlocked = $members ? 'u.blocked' : '0 AS blocked';
    $stmt = $pdo->prepare(
        "SELECT c.token, c.title, c.start_date, c.end_date, c.last_activity, u.role, u.display_name, u.name_custom,
                g.token AS group_token, g.title AS group_title, {$calBlocked}
         FROM users u
         JOIN calendars c ON c.id = u.calendar_id
         LEFT JOIN `groups` g ON g.id = c.group_id
         WHERE u.account_id = :aid
         ORDER BY COALESCE(c.last_activity, c.created_at) DESC"
    );
    $stmt->execute([':aid' => $accountId]);
    $calendars = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $calendars[] = [
            'token' => (string)$r['token'],
            'title' => (string)($r['title'] ?? ''),
            'start_date' => $r['start_date'],
            'end_date' => $r['end_date'],
            'role' => (string)$r['role'],
            'display_name' => (string)$r['display_name'],
            'name_custom' => (int)$r['name_custom'] === 1,
            'hub' => $r['group_token'] !== null ? ['token' => (string)$r['group_token'], 'title' => (string)($r['group_title'] ?? '')] : null,
            'blocked' => (int)$r['blocked'] === 1,
        ];
    }

    $stmt = $pdo->prepare(
        "SELECT g.token, g.title, (g.organiser_account_id = :aid) AS is_organiser,
                (SELECT COUNT(*) FROM calendars c WHERE c.group_id = g.id) AS calendar_count,
                COALESCE(ah.last_opened_at, g.created_at) AS sort_at
         FROM `groups` g
         LEFT JOIN account_hubs ah ON ah.group_id = g.id AND ah.account_id = :aid2
         WHERE g.organiser_account_id = :aid3 OR ah.account_id IS NOT NULL
         ORDER BY sort_at DESC"
    );
    $stmt->execute([':aid' => $accountId, ':aid2' => $accountId, ':aid3' => $accountId]);
    $hubs = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $hubs[] = [
            'token' => (string)$r['token'],
            'title' => (string)($r['title'] ?? ''),
            'is_organiser' => (int)$r['is_organiser'] === 1,
            'calendar_count' => (int)$r['calendar_count'],
        ];
    }
    return ['calendars' => $calendars, 'hubs' => $hubs];
}

/** What deleting the account would remove (shown before confirming). */
function accountDeletionSummary(PDO $pdo, int $accountId): array {
    $stmt = $pdo->prepare(
        "SELECT c.title FROM users u JOIN calendars c ON c.id = u.calendar_id
         WHERE u.account_id = :aid AND u.role = 'admin' ORDER BY c.id"
    );
    $stmt->execute([':aid' => $accountId]);
    $calendars = array_map(static fn ($t) => trim((string)$t) !== '' ? (string)$t : 'Untitled calendar', $stmt->fetchAll(PDO::FETCH_COLUMN));

    $stmt = $pdo->prepare("SELECT title FROM `groups` WHERE organiser_account_id = :aid ORDER BY id");
    $stmt->execute([':aid' => $accountId]);
    $hubs = array_map(static fn ($t) => trim((string)$t) !== '' ? (string)$t : 'Untitled Hub', $stmt->fetchAll(PDO::FETCH_COLUMN));

    return ['calendars' => $calendars, 'hubs' => $hubs];
}

/**
 * Delete an account: calendars and Hubs it organises, its names and availability on every
 * other calendar, and all its sign-in data. Calendars in a deleted Hub stay (detached).
 */
function accountDelete(PDO $pdo, int $accountId): void {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT calendar_id FROM users WHERE account_id = :aid AND role = 'admin'");
        $stmt->execute([':aid' => $accountId]);
        $delCal = $pdo->prepare("DELETE FROM calendars WHERE id = :cid");
        $delAccess = $pdo->prepare("DELETE FROM account_access WHERE kind = 'calendar' AND subject_id = :cid");
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $cid) {
            $delCal->execute([':cid' => (int)$cid]);
            $delAccess->execute([':cid' => (int)$cid]);
            reportsDeleteForCalendar($pdo, (int)$cid);
        }
        $stmt = $pdo->prepare("SELECT id FROM `groups` WHERE organiser_account_id = :aid");
        $stmt->execute([':aid' => $accountId]);
        $delGroup = $pdo->prepare("DELETE FROM `groups` WHERE id = :gid");
        $delGroupAccess = $pdo->prepare("DELETE FROM account_access WHERE kind = 'group' AND subject_id = :gid");
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $gid) {
            $delGroup->execute([':gid' => (int)$gid]);
            $delGroupAccess->execute([':gid' => (int)$gid]);
        }
        $pdo->prepare("DELETE FROM users WHERE account_id = :aid")->execute([':aid' => $accountId]);
        $pdo->prepare("DELETE FROM accounts WHERE id = :aid")->execute([':aid' => $accountId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// -------------------------
// Old PIN sign-in data (tables dropped by migration 008)
// -------------------------

/** Remove a claimed name's old passkeys and PIN sessions. */
function legacyForgetUser(PDO $pdo, int $userId): void {
    foreach (['user_passkeys', 'user_sessions'] as $table) {
        try {
            $pdo->prepare("DELETE FROM {$table} WHERE user_id = :uid")->execute([':uid' => $userId]);
        } catch (PDOException $e) {
            // Table already dropped.
        }
    }
}

/** Remove a claimed Hub's old organiser passkeys and PIN sessions. */
function legacyForgetGroup(PDO $pdo, int $groupId): void {
    foreach (['group_passkeys', 'group_sessions'] as $table) {
        try {
            $pdo->prepare("DELETE FROM {$table} WHERE group_id = :gid")->execute([':gid' => $groupId]);
        } catch (PDOException $e) {
            // Table already dropped.
        }
    }
}

// -------------------------
// Emoji picked once per account
// -------------------------

/** @param list<array{0:string,1:int}> $allowed */
function accountAccessValid(PDO $pdo, int $accountId, array $allowed): bool {
    foreach ($allowed as [$kind, $id]) {
        $stmt = $pdo->prepare(
            "SELECT 1 FROM account_access WHERE account_id = :aid AND kind = :k AND subject_id = :sid LIMIT 1"
        );
        $stmt->execute([':aid' => $accountId, ':k' => $kind, ':sid' => $id]);
        if ($stmt->fetchColumn()) return true;
    }
    return false;
}

function accountAccessGrant(PDO $pdo, int $accountId, string $kind, int $id): void {
    $pdo->prepare(
        "INSERT IGNORE INTO account_access (account_id, kind, subject_id, created_at)
         VALUES (:aid, :k, :sid, :now)"
    )->execute([':aid' => $accountId, ':k' => $kind, ':sid' => $id, ':now' => accountNow()]);
}

function accountAccessRevoke(PDO $pdo, string $kind, int $id): void {
    if (!accountsTablesReady($pdo)) return;
    $pdo->prepare("DELETE FROM account_access WHERE kind = :k AND subject_id = :sid")
        ->execute([':k' => $kind, ':sid' => $id]);
}
