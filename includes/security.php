<?php
/**
 * includes/security.php - Database connection, security log, per-IP rate limiting, admin login lockout and session, old-PIN checks (claiming) and lockout wrappers.
 * Loaded by api.php.
 */

declare(strict_types=1);

/** Old PINs are only checked, never created: claim_name / claim_hub. */
function verifyPin(string $pin, string $hash): bool {
    $pin = trim($pin);
    if (!preg_match('/^\d{4}$/', $pin)) return false;
    if ($hash === '') return false;
    return password_verify($pin, $hash);
}

function createToken(int $len = 48): string {
    // URL-safe base64 token, trimmed to requested length
    $raw = rtrim(strtr(base64_encode(random_bytes(36)), '+/', '-_'), '=');
    if (strlen($raw) >= $len) return substr($raw, 0, $len);
    // Fallback: extend if needed
    while (strlen($raw) < $len) {
        $raw .= rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '=');
    }
    return substr($raw, 0, $len);
}

const RATE_KEY_MAX_LEN = 16;

/**
 * Fit a rate-limit key into api_rate_limit.minute_key (CHAR(16)). Longer keys would be
 * truncated on insert (non-strict SQL) and never match the SELECT, silently disabling the limit.
 */
function rateLimitKey(string $key): string {
    if (strlen($key) <= RATE_KEY_MAX_LEN) return $key;
    return 'x' . substr(hash('sha256', $key), 0, RATE_KEY_MAX_LEN - 1);
}

/**
 * Rate limit a specific action key stored in api_rate_limit.minute_key.
 */
function enforceActionRateLimit(PDO $pdo, string $ip, string $actionKey, int $maxCount, string $message): void {
    $actionKey = rateLimitKey($actionKey);
    $sql = "
        INSERT INTO api_rate_limit (ip, minute_key, count, updated_at)
        VALUES (:ip, :mk, 1, NOW())
        ON DUPLICATE KEY UPDATE
            count = IF(minute_key = VALUES(minute_key), count + 1, 1),
            minute_key = VALUES(minute_key),
            updated_at = NOW()
    ";
    $pdo->prepare($sql)->execute([':ip' => $ip, ':mk' => $actionKey]);

    $stmt = $pdo->prepare("SELECT count FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk");
    $stmt->execute([':ip' => $ip, ':mk' => $actionKey]);
    $row = $stmt->fetch();
    $count = (int)($row['count'] ?? 0);
    if ($count > $maxCount) {
        respond(429, ['status' => 'error', 'message' => $message]);
    }
}

function pdo(array $config): PDO {
    $db = $config['db'] ?? [];
    $host = (string)($db['host'] ?? 'localhost');
    $name = (string)($db['name'] ?? '');
    $charset = (string)($db['charset'] ?? 'utf8mb4');
    $user = (string)($db['user'] ?? '');
    $pass = (string)($db['pass'] ?? '');

    if ($name === '' || $user === '') {
        respond(500, ['status' => 'error', 'message' => 'Server misconfigured']);
    }

    $dsn = "mysql:host={$host};dbname={$name};charset={$charset}";
    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}

/**
 * Simple file logging for security-relevant events.
 * Log directory should not be web-accessible.
 */
function logSecurityEvent(string $event, array $details = []): void {
    $logDir = dirname(__DIR__) . '/../grape_private/logs';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0750, true);
    }
    $logFile = $logDir . '/security_' . date('Y-m') . '.log';
    $entry = [
        'timestamp' => gmdate('c'),
        'ip' => clientIp(),
        'event' => $event,
        'details' => $details,
    ];
    @file_put_contents($logFile, json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

/** POST actions that must be rate-limited even when the DB limiter is unavailable. */
function isSensitivePostAction(string $action): bool {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') return false;
    static $sensitive = [
        'admin_login',
        'admin_login_account',
        'claim_name',
        'claim_hub',
        'create_calendar',
        'create_group',
        'save',
        'join_calendar',
        'request_access',
        'cancel_access_request',
        'decide_access_request',
        'set_user_blocked',
        'report_user',
        'admin_report_decide',
        'set_organiser_marks',
        'account_update',
        'account_remove_method',
        'account_delete',
        'account_passkey_signup_begin',
        'account_passkey_signup_finish',
        'account_passkey_add_begin',
        'account_passkey_add_finish',
        'account_passkey_login_begin',
        'account_passkey_login_finish',
        'access_check',
        'set_access_emoji',
        'set_group_access_emoji',
        'set_bookings_closed',
    ];
    return in_array($action, $sensitive, true);
}

/**
 * Basic per-IP rate limiting.
 * Expects table api_rate_limit(ip, minute_key, count, updated_at).
 */
function enforceRateLimit(PDO $pdo, int $maxPerMinute = 120): void {
    $ip = clientIp();
    $minuteKey = gmdate('YmdHi');

    // Upsert style pattern compatible with MySQL/MariaDB.
    $sql = "
        INSERT INTO api_rate_limit (ip, minute_key, count, updated_at)
        VALUES (:ip, :mk, 1, NOW())
        ON DUPLICATE KEY UPDATE
            count = IF(minute_key = VALUES(minute_key), count + 1, 1),
            minute_key = VALUES(minute_key),
            updated_at = NOW()
    ";
    $pdo->prepare($sql)->execute([':ip' => $ip, ':mk' => $minuteKey]);

    $stmt = $pdo->prepare("SELECT count FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk");
    $stmt->execute([':ip' => $ip, ':mk' => $minuteKey]);
    $row = $stmt->fetch();
    $count = (int)($row['count'] ?? 0);
    if ($count > $maxPerMinute) {
        respond(429, ['status' => 'error', 'message' => 'Too many requests']);
    }
}

const ADMIN_LOGIN_RATE_KEY = 'admin_login';

function adminLoginLockoutConfig(array $config): array {
    $admin = $config['admin'] ?? [];
    return [
        'max_attempts' => max(1, (int)($admin['max_attempts'] ?? 5)),
        'lockout_minutes' => max(1, (int)($admin['lockout_minutes'] ?? 15)),
    ];
}

/** Per-IP admin login lockout (stored in api_rate_limit). */
function checkAdminLoginLockout(PDO $pdo, array $config): void {
    $limits = adminLoginLockoutConfig($config);
    $maxAttempts = $limits['max_attempts'];
    $lockoutMinutes = $limits['lockout_minutes'];

    $ip = clientIp();
    $stmt = $pdo->prepare(
        "SELECT count, updated_at FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk LIMIT 1"
    );
    $stmt->execute([':ip' => $ip, ':mk' => ADMIN_LOGIN_RATE_KEY]);
    $row = $stmt->fetch();
    if (!$row) return;

    $count = (int)($row['count'] ?? 0);
    if ($count < $maxAttempts) return;

    $lockedAt = strtotime((string)$row['updated_at']);
    if ($lockedAt === false) return;

    $expires = $lockedAt + ($lockoutMinutes * 60);
    if (time() < $expires) {
        $remaining = (int)ceil(($expires - time()) / 60);
        respond(429, [
            'status' => 'error',
            'code' => 'ACCOUNT_LOCKED',
            'message' => "Too many failed login attempts. Try again in {$remaining} minute(s).",
        ]);
    }

    $pdo->prepare("DELETE FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk")
        ->execute([':ip' => $ip, ':mk' => ADMIN_LOGIN_RATE_KEY]);
}

function recordAdminLoginFailedAttempt(PDO $pdo, array $config): void {
    $limits = adminLoginLockoutConfig($config);
    $maxAttempts = $limits['max_attempts'];
    $ip = clientIp();

    $sql = "
        INSERT INTO api_rate_limit (ip, minute_key, count, updated_at)
        VALUES (:ip, :mk, 1, NOW())
        ON DUPLICATE KEY UPDATE count = count + 1, updated_at = NOW()
    ";
    $pdo->prepare($sql)->execute([':ip' => $ip, ':mk' => ADMIN_LOGIN_RATE_KEY]);

    $stmt = $pdo->prepare("SELECT count FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk LIMIT 1");
    $stmt->execute([':ip' => $ip, ':mk' => ADMIN_LOGIN_RATE_KEY]);
    $count = (int)($stmt->fetch()['count'] ?? 0);
    if ($count >= $maxAttempts) {
        logSecurityEvent('ADMIN_LOGIN_LOCKED', ['ip' => $ip, 'attempts' => $count]);
    }
}

function resetAdminLoginAttempts(PDO $pdo): void {
    $ip = clientIp();
    $pdo->prepare("DELETE FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk")
        ->execute([':ip' => $ip, ':mk' => ADMIN_LOGIN_RATE_KEY]);
}

/** Account lockout helpers (escalating schedule in includes/lockout.php) */
function checkAccountLockout(PDO $pdo, int $userId): void {
    pinLockoutCheck($pdo, 'user', $userId, 'This name');
}

/** Returns the lock length in minutes when this wrong PIN started a lockout. */
function recordFailedAttempt(PDO $pdo, int $userId): ?int {
    global $config;
    return pinLockoutRecordFailure($pdo, 'user', $userId, pinLockoutConfig($config ?? []));
}

function resetFailedAttempts(PDO $pdo, int $userId): void {
    pinLockoutReset($pdo, 'user', $userId);
}

/** Account ids allowed to open the admin panel without the password (config admin.account_ids). */
function adminAccountIds(array $config): array {
    $ids = $config['admin']['account_ids'] ?? [];
    if (!is_array($ids)) return [];
    return array_values(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0));
}

/** Start a 1-hour admin session; returns the token and a CSRF token for the panel. */
function adminIssueSession(): array {
    startSecureSession();
    session_regenerate_id(true);
    $adminToken = bin2hex(random_bytes(32));
    $_SESSION['admin_token'] = $adminToken;
    $_SESSION['admin_token_expires'] = time() + 3600;
    return ['admin_token' => $adminToken, 'csrf_token' => generateCsrfToken()];
}

/**
 * Validate admin session token from header
 */
function requireAdminSession(): void {
    startSecureSession();
    
    $token = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($token === '') {
        respond(401, ['status' => 'error', 'message' => 'Admin auth required']);
    }

    $storedToken = (string)($_SESSION['admin_token'] ?? '');
    $expires = (int)($_SESSION['admin_token_expires'] ?? 0);

    if ($storedToken === '' || !hash_equals($storedToken, $token)) {
        respond(401, ['status' => 'error', 'message' => 'Invalid admin session']);
    }

    if ($expires < time()) {
        unset($_SESSION['admin_token'], $_SESSION['admin_token_expires']);
        respond(401, ['status' => 'error', 'message' => 'Admin session expired']);
    }

    // Extend session on activity
    $_SESSION['admin_token_expires'] = time() + 3600;
}
