<?php
/**
 * api.php - Grape Calendar backend API
 *
 * Tech constraints:
 *  - PHP 8.x procedural
 *  - MariaDB/MySQL via PDO
 *  - JSON request bodies (Content-Type: application/json)
 *
 * This file implements:
 *  - CSRF protection (session-based token)
 *  - Security headers
 *  - Basic per-IP rate limiting using api_rate_limit
 *  - PIN authentication with lockout (failed_attempts/locked_until)
 *  - Calendar and availability CRUD endpoints
 */

declare(strict_types=1);

// -------------------------
// CORS (same-origin safe default)
// -------------------------
// This app is designed for same-origin use. We reply to OPTIONS for dev tooling.
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token, X-CSRF-Token, X-Group-Auth-Token');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

// -------------------------
// Security headers
// -------------------------
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

// -------------------------
// Helpers
// -------------------------
function respond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/** @var list<string>|null */
$GLOBALS['_wruf_trusted_proxies'] = null;

/**
 * Configure which REMOTE_ADDR values may supply X-Forwarded-For.
 * Call once after loading config; defaults to trusting no proxies.
 */
function initClientIpTrust(array $config): void {
    $proxies = $config['trusted_proxies'] ?? [];
    $GLOBALS['_wruf_trusted_proxies'] = is_array($proxies) ? array_values($proxies) : [];
}

function isValidIp(string $ip): bool {
    return filter_var($ip, FILTER_VALIDATE_IP) !== false;
}

/** @param list<string> $trustedProxies */
function isTrustedProxy(string $ip, array $trustedProxies): bool {
    if ($ip === '' || !isValidIp($ip)) return false;
    return in_array($ip, $trustedProxies, true);
}

/**
 * Resolve client IP from X-Forwarded-For, skipping trusted proxy hops (right to left).
 * @param list<string> $trustedProxies
 */
function clientIpFromForwardedFor(string $xff, array $trustedProxies): ?string {
    $parts = array_map('trim', explode(',', $xff));
    $parts = array_values(array_filter($parts, static fn($p) => $p !== ''));
    if (count($parts) === 0) return null;

    for ($i = count($parts) - 1; $i >= 0; $i--) {
        $candidate = $parts[$i];
        if (!isValidIp($candidate)) continue;
        if (!isTrustedProxy($candidate, $trustedProxies)) {
            return $candidate;
        }
    }

    // All hops are trusted proxies - use leftmost valid IP.
    foreach ($parts as $part) {
        if (isValidIp($part)) return $part;
    }
    return null;
}

function clientIp(): string {
    $remoteAddr = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if (!isValidIp($remoteAddr)) {
        $remoteAddr = '0.0.0.0';
    }

    $trustedProxies = $GLOBALS['_wruf_trusted_proxies'];
    if (!is_array($trustedProxies)) {
        $trustedProxies = [];
    }

    // Only honour X-Forwarded-For when the direct connection is from a known proxy.
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR']) && isTrustedProxy($remoteAddr, $trustedProxies)) {
        $xffIp = clientIpFromForwardedFor((string)$_SERVER['HTTP_X_FORWARDED_FOR'], $trustedProxies);
        if ($xffIp !== null) {
            return $xffIp;
        }
    }

    return $remoteAddr;
}

function readJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function startSecureSession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();
    }
}

function generateCsrfToken(): string {
    startSecureSession();
    if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return (string)$_SESSION['csrf_token'];
}

function validateCsrfToken(string $token): bool {
    startSecureSession();
    if (empty($_SESSION['csrf_token']) || empty($token)) return false;
    return hash_equals((string)$_SESSION['csrf_token'], $token);
}

function requireCsrf(): void {
    $token = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!validateCsrfToken($token)) {
        respond(403, ['status' => 'error', 'message' => 'Invalid or missing CSRF token']);
    }
}

function normaliseTitle(?string $t): ?string {
    $t = trim(preg_replace('/\s+/', ' ', (string)$t));
    $t = str_replace(['<', '>'], '', $t);
    if ($t === '') return null;
    return mb_substr($t, 0, 80);
}

function normaliseName(?string $n): ?string {
    $n = trim(preg_replace('/\s+/', ' ', (string)$n));
    $n = str_replace(['<', '>'], '', $n);
    if ($n === '') return null;
    return mb_substr($n, 0, 32);
}

function validateSlotsArray($slotsIn): array {
    if (!is_array($slotsIn)) return [false, []];
    $out = [];
    $seen = [];
    foreach ($slotsIn as $s) {
        $s = trim(preg_replace('/\s+/', ' ', (string)$s));
        if ($s === '') continue;
        $s = mb_substr($s, 0, 20);
        // Must match SLOT_REGEX in index.js / calendar.js (includes apostrophe)
        if (!preg_match("/^[A-Za-z0-9][A-Za-z0-9'\\- .]{0,19}$/u", $s)) return [false, []];
        $k = mb_strtolower($s);
        if (!isset($seen[$k])) {
            $seen[$k] = true;
            $out[] = $s;
        }
    }
    if (count($out) < 1) return [false, []];
    return [true, $out];
}

function validateStatusesArray($in): array {
    // Default: Yes / Maybe / No with weights
    $palette = ['#357A38', '#e58800', '#880000', '#1f5aa6', '#6a1b9a'];
    $default = [
        ['label' => 'Yes', 'color' => $palette[0], 'weight' => 2],
        ['label' => 'Maybe', 'color' => $palette[1], 'weight' => 1],
        ['label' => 'No', 'color' => $palette[2], 'weight' => 0],
    ];

    if ($in === null || $in === '' || $in === false) {
        return [true, $default];
    }
    if (!is_array($in)) return [false, []];

    $out = [];
    $seen = [];
    $i = 0;

    foreach ($in as $item) {
        $label = '';
        $color = '';
        $weight = null;

        if (is_array($item)) {
            $label = (string)($item['label'] ?? '');
            $color = (string)($item['color'] ?? '');
            // Accept weight from input (0-5 range)
            if (isset($item['weight'])) {
                $weight = max(0, min(5, (int)$item['weight']));
            }
        } else {
            $label = (string)$item;
        }

        $label = trim(preg_replace('/\s+/', ' ', $label));
        if ($label === '') continue;
        $label = mb_substr($label, 0, 20);

        // Must match STATUS_REGEX in index.js / calendar.js (includes apostrophe)
        if (!preg_match("/^[A-Za-z0-9][A-Za-z0-9'\\- ]{0,19}$/u", $label)) return [false, []];

        $k = mb_strtolower($label);
        if (isset($seen[$k])) continue;
        $seen[$k] = true;

        $color = trim($color);
        if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
            $color = $palette[$i % count($palette)];
        }

        // Default weight based on position if not provided
        if ($weight === null) {
            $weight = max(0, count($in) - 1 - $i);
        }

        $out[] = ['label' => $label, 'color' => $color, 'weight' => $weight];
        $i++;
    }

    if (count($out) < 1) return [false, []];
    return [true, $out];
}

function dateRangeOk(string $start, string $end): array {
    if ($start === '' || $end === '') return [false, 'Start/end date required'];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) return [false, 'Invalid date format'];
    if ($start > $end) return [false, 'Start date must be on/before end date'];

    // Bound to 2026-2030 (as per UI requirement)
    if ($start < '2026-01-01' || $end > '2030-12-31') return [false, 'Date range must be between 2026 and 2030'];

    $sd = strtotime($start . 'T00:00:00Z');
    $ed = strtotime($end . 'T00:00:00Z');
    if ($sd === false || $ed === false) return [false, 'Invalid date values'];

    $days = (int)floor(($ed - $sd) / 86400) + 1;
    if ($days > 360) return [false, 'Date range too long'];

    return [true, ''];
}

function hashPin(string $pin): ?string {
    $pin = trim($pin);
    if (!preg_match('/^\d{4}$/', $pin)) return null;
    return password_hash($pin, PASSWORD_DEFAULT);
}

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

function requireAction(): string {
    $action = (string)($_GET['action'] ?? '');
    if ($action === '') respond(400, ['status' => 'error', 'message' => 'Missing action']);
    return $action;
}

function requireToken(): string {
    $t = (string)($_GET['c'] ?? '');
    // Accept 8-64 chars for backward compatibility (old tokens were 48 chars, new are 8)
    if ($t === '' || !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $t)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar token']);
    }
    return $t;
}

function requireConfig(): array {
    // Explicit, known-good path to private config
    $configPath = '/home/perthrel/grape_private/config.php';

    if (!is_file($configPath)) {
        respond(500, ['status' => 'error', 'message' => 'Server misconfigured']);
    }

    /** @var array $config */
    $config = require $configPath;
    return is_array($config) ? $config : [];
}


// -------------------------
// Configurable limits
// -------------------------
// Max length for organiser message (single source of truth; sent to frontend via calendar_meta)
const MESSAGE_MAX_LEN = 250;

/** Hub calendar limits (override via $config['hub_limits'] on server) */
const HUB_MAX_CALENDARS = 50;
const HUB_ADD_PER_IP_PER_HUB_HOUR = 5;
const HUB_ADD_PER_IP_GLOBAL_HOUR = 15;

function hubLimitsConfig(array $config): array {
    $hl = $config['hub_limits'] ?? [];
    return [
        'max_calendars_per_hub' => (int)($hl['max_calendars_per_hub'] ?? HUB_MAX_CALENDARS),
        'per_ip_per_hub_per_hour' => (int)($hl['per_ip_per_hub_per_hour'] ?? HUB_ADD_PER_IP_PER_HUB_HOUR),
        'per_ip_global_per_hour' => (int)($hl['per_ip_global_per_hour'] ?? HUB_ADD_PER_IP_GLOBAL_HOUR),
    ];
}

/**
 * Rate limit a specific action key stored in api_rate_limit.minute_key.
 */
function enforceActionRateLimit(PDO $pdo, string $ip, string $actionKey, int $maxCount, string $message): void {
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

function enforceHubCalendarCapacity(PDO $pdo, int $groupId, array $limits): void {
    $stmt = $pdo->prepare("SELECT COUNT(*) AS cnt FROM calendars WHERE group_id = :gid");
    $stmt->execute([':gid' => $groupId]);
    $cnt = (int)($stmt->fetch()['cnt'] ?? 0);
    if ($cnt >= $limits['max_calendars_per_hub']) {
        respond(429, [
            'status' => 'error',
            'message' => 'This Hub has reached the maximum number of calendars.',
        ]);
    }
}

function enforceHubCalendarRateLimit(PDO $pdo, int $groupId, array $limits): void {
    $ip = clientIp();
    $hourKey = gmdate('YmdH');
    enforceActionRateLimit(
        $pdo,
        $ip,
        "hub_cal_{$groupId}_{$hourKey}",
        $limits['per_ip_per_hub_per_hour'],
        'Too many calendars added to this Hub. Try again later.'
    );
    enforceActionRateLimit(
        $pdo,
        $ip,
        "hub_cal_ip_{$hourKey}",
        $limits['per_ip_global_per_hour'],
        'Too many calendars added. Try again later.'
    );
}

function prepareHubCalendarAdd(PDO $pdo, int $groupId, array $config): void {
    $limits = hubLimitsConfig($config);
    enforceHubCalendarCapacity($pdo, $groupId, $limits);
    enforceHubCalendarRateLimit($pdo, $groupId, $limits);
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
    $logDir = __DIR__ . '/../grape_private/logs';
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
        'auth_user',
        'auth_group',
        'create_calendar',
        'create_group',
        'save',
        'add_user',
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

/** Account lockout helpers */
function checkAccountLockout(PDO $pdo, int $userId): void {
    $stmt = $pdo->prepare("SELECT locked_until FROM users WHERE id = :uid");
    $stmt->execute([':uid' => $userId]);
    $user = $stmt->fetch();

    if ($user && !empty($user['locked_until'])) {
        $lockedUntil = strtotime((string)$user['locked_until']);
        if ($lockedUntil !== false && $lockedUntil > time()) {
            $remaining = (int)ceil(($lockedUntil - time()) / 60);
            respond(429, [
                'status' => 'error',
                'code' => 'ACCOUNT_LOCKED',
                'message' => "Account temporarily locked. Try again in {$remaining} minute(s).",
            ]);
        }

        // Lock expired: reset
        $pdo->prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = :uid")
            ->execute([':uid' => $userId]);
    }
}

function recordFailedAttempt(PDO $pdo, int $userId, int $maxAttempts = 5, int $lockoutMinutes = 15): void {
    $sql = "
        UPDATE users
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
                WHEN failed_attempts + 1 >= :max THEN DATE_ADD(NOW(), INTERVAL :mins MINUTE)
                ELSE locked_until
            END
        WHERE id = :uid
    ";
    $pdo->prepare($sql)->execute([':max' => $maxAttempts, ':mins' => $lockoutMinutes, ':uid' => $userId]);
}

function resetFailedAttempts(PDO $pdo, int $userId): void {
    $pdo->prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = :uid")
        ->execute([':uid' => $userId]);
}

/**
 * Validates an auth token and returns session details.
 * @returns array{user_id:int, role:string, calendar_id:int}
 */
function requireSession(PDO $pdo, int $calendarId): array {
    $token = (string)($_SERVER['HTTP_X_AUTH_TOKEN'] ?? '');
    if ($token === '' || !preg_match('/^[A-Fa-f0-9]{64}$/', $token)) {
        respond(401, ['status' => 'error', 'message' => 'Auth required']);
    }

    $sql = "
        SELECT s.user_id, u.role, s.calendar_id
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = :t AND s.expires_at > NOW()
        LIMIT 1
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch();
    if (!$row || (int)$row['calendar_id'] !== $calendarId) {
        respond(401, ['status' => 'error', 'message' => 'Invalid or expired session']);
    }

    return [
        'user_id' => (int)$row['user_id'],
        'role' => (string)$row['role'],
        'calendar_id' => (int)$row['calendar_id'],
    ];
}

/**
 * Optional session lookup — returns null when no valid token is present.
 * @returns array{user_id:int, role:string, calendar_id:int}|null
 */
function getOptionalSession(PDO $pdo, int $calendarId): ?array {
    $token = (string)($_SERVER['HTTP_X_AUTH_TOKEN'] ?? '');
    if ($token === '' || !preg_match('/^[A-Fa-f0-9]{64}$/', $token)) {
        return null;
    }

    $sql = "
        SELECT s.user_id, u.role, s.calendar_id
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = :t AND s.expires_at > NOW()
        LIMIT 1
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch();
    if (!$row || (int)$row['calendar_id'] !== $calendarId) {
        return null;
    }

    return [
        'user_id' => (int)$row['user_id'],
        'role' => (string)$row['role'],
        'calendar_id' => (int)$row['calendar_id'],
    ];
}

/**
 * Aggregate availability counts per day/slot/status (no user identifiers).
 */
function buildAvailabilitySummary(PDO $pdo, int $calId, string $from, string $to): array {
    $stmt = $pdo->prepare(
        "SELECT day, slot, status, COUNT(*) AS cnt
         FROM availability
         WHERE calendar_id = :cid AND day BETWEEN :f AND :t
         GROUP BY day, slot, status
         ORDER BY day, slot, status"
    );
    $stmt->execute([':cid' => $calId, ':f' => $from, ':t' => $to]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[] = [
            'day' => (string)$row['day'],
            'slot' => (string)$row['slot'],
            'status' => (int)$row['status'],
            'count' => (int)$row['cnt'],
        ];
    }
    return $out;
}

/** Respond 409 when a unique display_name constraint is violated. */
function respondDuplicateName(): void {
    respond(409, ['status' => 'error', 'message' => 'Name already taken']);
}

// -------------------------
// Group (Hub) helpers
// -------------------------

function requireGroupTokenParam(): string {
    $t = (string)($_GET['g'] ?? '');
    if ($t === '' || !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $t)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group token']);
    }
    return $t;
}

function getGroupByToken(PDO $pdo, string $token): ?array {
    $stmt = $pdo->prepare(
        "SELECT id, token, title, organiser_name, organiser_pin_hash, failed_attempts, locked_until,
                created_at, last_activity, never_expires
         FROM `groups` WHERE token = :t LIMIT 1"
    );
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function touchGroupActivity(PDO $pdo, int $groupId): void {
    $pdo->prepare("UPDATE `groups` SET last_activity = NOW() WHERE id = :gid")
        ->execute([':gid' => $groupId]);
}

function touchGroupForCalendar(PDO $pdo, int $calendarId): void {
    $stmt = $pdo->prepare("SELECT group_id FROM calendars WHERE id = :cid LIMIT 1");
    $stmt->execute([':cid' => $calendarId]);
    $row = $stmt->fetch();
    if ($row && !empty($row['group_id'])) {
        touchGroupActivity($pdo, (int)$row['group_id']);
    }
}

function checkGroupLockout(PDO $pdo, int $groupId): void {
    $stmt = $pdo->prepare("SELECT locked_until FROM `groups` WHERE id = :gid");
    $stmt->execute([':gid' => $groupId]);
    $group = $stmt->fetch();

    if ($group && !empty($group['locked_until'])) {
        $lockedUntil = strtotime((string)$group['locked_until']);
        if ($lockedUntil !== false && $lockedUntil > time()) {
            $remaining = (int)ceil(($lockedUntil - time()) / 60);
            respond(429, [
                'status' => 'error',
                'code' => 'ACCOUNT_LOCKED',
                'message' => "Hub temporarily locked. Try again in {$remaining} minute(s).",
            ]);
        }

        $pdo->prepare("UPDATE `groups` SET failed_attempts = 0, locked_until = NULL WHERE id = :gid")
            ->execute([':gid' => $groupId]);
    }
}

function recordGroupFailedAttempt(PDO $pdo, int $groupId, int $maxAttempts = 5, int $lockoutMinutes = 15): void {
    $sql = "
        UPDATE `groups`
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
                WHEN failed_attempts + 1 >= :max THEN DATE_ADD(NOW(), INTERVAL :mins MINUTE)
                ELSE locked_until
            END
        WHERE id = :gid
    ";
    $pdo->prepare($sql)->execute([':max' => $maxAttempts, ':mins' => $lockoutMinutes, ':gid' => $groupId]);
}

function resetGroupFailedAttempts(PDO $pdo, int $groupId): void {
    $pdo->prepare("UPDATE `groups` SET failed_attempts = 0, locked_until = NULL WHERE id = :gid")
        ->execute([':gid' => $groupId]);
}

/**
 * @returns array{group_id:int, role:string}|null
 */
function getOptionalGroupSession(PDO $pdo, int $groupId): ?array {
    $token = (string)($_SERVER['HTTP_X_GROUP_AUTH_TOKEN'] ?? '');
    if ($token === '' || !preg_match('/^[A-Fa-f0-9]{64}$/', $token)) {
        return null;
    }

    $stmt = $pdo->prepare(
        "SELECT group_id FROM group_sessions
         WHERE token = :t AND expires_at > NOW() AND group_id = :gid
         LIMIT 1"
    );
    $stmt->execute([':t' => $token, ':gid' => $groupId]);
    $row = $stmt->fetch();
    if (!$row) return null;

    return ['group_id' => (int)$row['group_id'], 'role' => 'admin'];
}

function requireGroupOrganiserSession(PDO $pdo, int $groupId): array {
    $session = getOptionalGroupSession($pdo, $groupId);
    if (!$session) {
        respond(401, ['status' => 'error', 'message' => 'Hub auth required']);
    }
    return $session;
}

function resolveGroupTokenFromPost(): ?string {
    $gt = trim((string)($_POST['group_token'] ?? ''));
    if ($gt === '') return null;
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $gt)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group token']);
    }
    return $gt;
}

// -------------------------
// Main routing
// -------------------------
$action = requireAction();
$config = requireConfig();
initClientIpTrust($config);
$pdo = pdo($config);

// Decode JSON bodies into $_POST-compatible array
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json = readJsonBody();
    if (!empty($json)) {
        foreach ($json as $k => $v) {
            $_POST[$k] = $v;
        }
    }
}

// Rate limit all requests (safe even for GET)
try {
    enforceRateLimit($pdo, (int)($config['rate_limit']['per_minute'] ?? 120));
} catch (Throwable $e) {
    logSecurityEvent('RATE_LIMIT_ERROR', [
        'error' => $e->getMessage(),
        'action' => $action,
    ]);
    // Fail closed for auth/write POSTs when the DB limiter is unavailable.
    if (isSensitivePostAction($action)) {
        respond(503, [
            'status' => 'error',
            'message' => 'Service temporarily unavailable. Try again shortly.',
        ]);
    }
}

// CSRF token endpoint
if ($action === 'csrf_token' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    respond(200, ['status' => 'success', 'csrf_token' => generateCsrfToken()]);
}

// Diagnostic endpoint (disabled by default)
if ($action === 'diag' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    if (getenv('GRAPE_DIAG_ENABLED') !== '1') {
        respond(404, ['status' => 'error', 'message' => 'Unknown action']);
    }
    $payload = [
        'status' => 'success',
        'php_version' => PHP_VERSION,
        'timestamp' => gmdate('c'),
        'db_connect' => 'OK',
    ];
    try {
        $pdo->query('SELECT 1');
    } catch (Throwable $e) {
        $payload['db_connect'] = 'FAILED';
    }
    respond(200, $payload);
}

// -------------------------
// Actions
// -------------------------

// Create calendar
if ($action === 'create_calendar' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();

    $title = normaliseTitle($_POST['title'] ?? null);
    // Category: accepts JSON array string (new) or plain string (legacy)
    $rawCat = (string)($_POST['category'] ?? '["groups"]');
    $decoded = json_decode($rawCat, true);
    if (is_array($decoded) && count($decoded) > 0) {
        // Sanitise: only keep alphanumeric/underscore values, max 3
        $cats = array_slice(array_filter($decoded, function($c){
            return is_string($c) && preg_match('/^[a-z_]+$/', $c);
        }), 0, 3);
        $category = count($cats) > 0 ? json_encode(array_values($cats)) : '["groups"]';
    } else {
        // Legacy single string - wrap in JSON array
        $cat = preg_match('/^[a-z_]+$/', $rawCat) ? $rawCat : 'groups';
        $category = json_encode([$cat]);
    }

    [$okSlots, $slots] = validateSlotsArray($_POST['slots'] ?? []);
    if (!$okSlots) respond(400, ['status' => 'error', 'message' => 'Invalid slots']);

    [$okStatuses, $statuses] = validateStatusesArray($_POST['statuses'] ?? null);
    if (!$okStatuses) respond(400, ['status' => 'error', 'message' => 'Invalid status options']);

    $startDate = (string)($_POST['start_date'] ?? '');
    $endDate = (string)($_POST['end_date'] ?? '');
    [$okRange, $rangeMsg] = dateRangeOk($startDate, $endDate);
    if (!$okRange) respond(400, ['status' => 'error', 'message' => $rangeMsg ?: 'Invalid date range']);

    $excludeWeekends = (int)((($_POST['exclude_weekends'] ?? 0) ? 1 : 0));

    // Date filter mode: 'all' (default), 'only', 'except'
    $dateFilterMode = (string)($_POST['date_filter_mode'] ?? 'all');
    if (!in_array($dateFilterMode, ['all', 'only', 'except'], true)) {
        $dateFilterMode = 'all';
    }

    // Privacy mode: 0=open, 1=hidden, 2=blind
    $isPrivate = (int)($_POST['is_private'] ?? 0);
    if ($isPrivate < 0 || $isPrivate > 2) $isPrivate = 0;

    $adminName = normaliseName($_POST['admin_name'] ?? null);
    $pinHash = hashPin((string)($_POST['admin_pin'] ?? ''));
    if ($adminName === null || $pinHash === null) {
        respond(400, ['status' => 'error', 'message' => 'Organiser name or PIN invalid']);
    }

    $titleForDb = $title === null ? '' : $title;
    $slotsJson = json_encode($slots, JSON_UNESCAPED_UNICODE);
    $statusesJson = json_encode($statuses, JSON_UNESCAPED_UNICODE);

    $startMonth = substr($startDate, 0, 7);
    $endMonth = substr($endDate, 0, 7);

    // Optional: assign new calendar to a hub (valid hub token + rate limits)
    $groupId = null;
    $groupTokenPost = resolveGroupTokenFromPost();
    if ($groupTokenPost !== null) {
        $grp = getGroupByToken($pdo, $groupTokenPost);
        if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
        $groupId = (int)$grp['id'];
        prepareHubCalendarAdd($pdo, $groupId, $config);
    }

    for ($i = 0; $i < 5; $i++) {
        // Generate shorter 8-char URL-safe tokens for cleaner URLs
        $token = createToken(8);
        try {
            $stmt = $pdo->prepare(
                "INSERT INTO calendars
                    (token, group_id, title, category, slots_json, statuses_json, start_date, end_date, exclude_weekends, date_filter_mode, is_private, created_at, last_activity, start_month, end_month)
                 VALUES
                    (:t, :gid, :title, :cat, :slots, :statuses, :sd, :ed, :exw, :dfm, :priv, NOW(), NULL, :sm, :em)"
            );
            $stmt->execute([
                ':t' => $token,
                ':gid' => $groupId,
                ':title' => $titleForDb,
                ':cat' => $category,
                ':slots' => $slotsJson,
                ':statuses' => $statusesJson,
                ':sd' => $startDate,
                ':ed' => $endDate,
                ':exw' => $excludeWeekends,
                ':dfm' => $dateFilterMode,
                ':priv' => $isPrivate,
                ':sm' => $startMonth,
                ':em' => $endMonth,
            ]);
            $calId = (int)$pdo->lastInsertId();

            $stmtU = $pdo->prepare(
                "INSERT INTO users (calendar_id, display_name, role, pin_hash, created_at)
                 VALUES (:cid, :dn, 'admin', :ph, NOW())"
            );
            $stmtU->execute([':cid' => $calId, ':dn' => $adminName, ':ph' => $pinHash]);

            if ($groupId !== null) {
                touchGroupActivity($pdo, $groupId);
            }

            respond(200, ['status' => 'success', 'token' => $token]);
        } catch (PDOException $e) {
            if ((string)$e->getCode() === '23000') {
                // Token collision
                continue;
            }
            respond(500, ['status' => 'error', 'message' => 'Failed to create calendar']);
        }
    }

    respond(500, ['status' => 'error', 'message' => 'Failed to create calendar after retries']);
}

// Create hub (group)
if ($action === 'create_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();

    $title = normaliseTitle($_POST['title'] ?? null);
    $titleForDb = $title === null ? '' : $title;

    $organiserName = normaliseName($_POST['organiser_name'] ?? null);
    $pinHash = hashPin((string)($_POST['organiser_pin'] ?? ''));
    if ($organiserName === null || $pinHash === null) {
        respond(400, ['status' => 'error', 'message' => 'Organiser name or PIN invalid']);
    }

    for ($i = 0; $i < 5; $i++) {
        $token = createToken(8);
        try {
            $stmt = $pdo->prepare(
                "INSERT INTO `groups`
                    (token, title, organiser_name, organiser_pin_hash, created_at, last_activity)
                 VALUES
                    (:t, :title, :oname, :ph, NOW(), NOW())"
            );
            $stmt->execute([
                ':t' => $token,
                ':title' => $titleForDb,
                ':oname' => $organiserName,
                ':ph' => $pinHash,
            ]);

            respond(200, [
                'status' => 'success',
                'token' => $token,
                'title' => $titleForDb,
            ]);
        } catch (PDOException $e) {
            if ((string)$e->getCode() === '23000') {
                continue;
            }
            respond(500, ['status' => 'error', 'message' => 'Failed to create hub']);
        }
    }

    respond(500, ['status' => 'error', 'message' => 'Failed to create hub after retries']);
}

// Hub meta (public list with secret URL)
if ($action === 'group_meta' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireGroupTokenParam();
    $grp = getGroupByToken($pdo, $token);
    if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);

    $groupId = (int)$grp['id'];

    $stmt = $pdo->prepare(
        "SELECT token, title, start_date, end_date, chosen_date, chosen_slot, last_activity
         FROM calendars
         WHERE group_id = :gid
         ORDER BY last_activity DESC, created_at DESC"
    );
    $stmt->execute([':gid' => $groupId]);
    $calRows = $stmt->fetchAll();

    $calendars = [];
    foreach ($calRows as $row) {
        $calendars[] = [
            'token' => (string)$row['token'],
            'title' => (string)($row['title'] ?? ''),
            'start_date' => $row['start_date'] ?? null,
            'end_date' => $row['end_date'] ?? null,
            'is_frozen' => !empty($row['chosen_date']) && !empty($row['chosen_slot']),
            'last_activity' => $row['last_activity'] ?? null,
        ];
    }

    respond(200, [
        'status' => 'success',
        'group' => [
            'title' => (string)($grp['title'] ?? ''),
            'token' => (string)$grp['token'],
            'calendar_count' => count($calendars),
        ],
        'calendars' => $calendars,
    ]);
}

// Hub organiser auth
if ($action === 'auth_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireGroupTokenParam();

    $grp = getGroupByToken($pdo, $token);
    if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    $groupId = (int)$grp['id'];

    $pin = (string)($_POST['pin'] ?? '');
    if (!preg_match('/^\d{4}$/', $pin)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    checkGroupLockout($pdo, $groupId);

    if (!verifyPin($pin, (string)$grp['organiser_pin_hash'])) {
        recordGroupFailedAttempt($pdo, $groupId);
        logSecurityEvent('GROUP_AUTH_FAILED', ['group_id' => $groupId]);
        respond(401, ['status' => 'error', 'message' => 'Invalid PIN']);
    }

    resetGroupFailedAttempts($pdo, $groupId);

    $sessTok = bin2hex(random_bytes(32));
    $stmtS = $pdo->prepare(
        "INSERT INTO group_sessions (group_id, token, created_at, expires_at)
         VALUES (:gid, :tok, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))"
    );
    $stmtS->execute([':gid' => $groupId, ':tok' => $sessTok]);

    touchGroupActivity($pdo, $groupId);

    respond(200, [
        'status' => 'success',
        'auth_token' => $sessTok,
        'role' => 'admin',
        'organiser_name' => (string)$grp['organiser_name'],
    ]);
}

// Attach calendar to hub (calendar organiser only)
if ($action === 'add_calendar_to_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $calToken = requireToken();

    $stmtC = $pdo->prepare("SELECT id, group_id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $calToken]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    if (!empty($cal['group_id'])) {
        respond(400, ['status' => 'error', 'message' => 'Calendar is already in a hub']);
    }

    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the calendar organiser can add to a hub']);
    }

    $groupTokenPost = resolveGroupTokenFromPost();
    if ($groupTokenPost === null) {
        respond(400, ['status' => 'error', 'message' => 'Hub token required']);
    }

    $grp = getGroupByToken($pdo, $groupTokenPost);
    if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    $groupId = (int)$grp['id'];

    prepareHubCalendarAdd($pdo, $groupId, $config);

    $pdo->prepare("UPDATE calendars SET group_id = :gid WHERE id = :cid")
        ->execute([':gid' => $groupId, ':cid' => $calId]);

    touchGroupActivity($pdo, $groupId);
    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    logSecurityEvent('ADD_CALENDAR_TO_GROUP', ['calendar_id' => $calId, 'group_id' => $groupId]);

    respond(200, [
        'status' => 'success',
        'group' => [
            'token' => (string)$grp['token'],
            'title' => (string)($grp['title'] ?? ''),
        ],
    ]);
}

// Detach calendar from hub (hub organiser or calendar organiser)
if ($action === 'remove_calendar_from_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $calToken = requireToken();

    $stmtC = $pdo->prepare("SELECT id, group_id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $calToken]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];
    $groupId = (int)($cal['group_id'] ?? 0);

    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Calendar is not in a hub']);
    }

    $calSession = getOptionalSession($pdo, $calId);
    $groupSession = getOptionalGroupSession($pdo, $groupId);

    $calAdmin = $calSession && $calSession['role'] === 'admin';
    $groupAdmin = $groupSession !== null;

    if (!$calAdmin && !$groupAdmin) {
        respond(403, ['status' => 'error', 'message' => 'Auth required to remove from hub']);
    }

    $pdo->prepare("UPDATE calendars SET group_id = NULL WHERE id = :cid")
        ->execute([':cid' => $calId]);

    touchGroupActivity($pdo, $groupId);
    logSecurityEvent('REMOVE_CALENDAR_FROM_GROUP', ['calendar_id' => $calId, 'group_id' => $groupId]);

    respond(200, ['status' => 'success']);
}

// Calendar meta
if ($action === 'calendar_meta' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireToken();
    $stmt = $pdo->prepare(
        "SELECT c.id, c.token, c.group_id, c.title, c.category, c.slots_json, c.statuses_json,
                c.start_date, c.end_date, c.exclude_weekends, c.date_filter_mode, c.date_filter_dates,
                c.is_private, c.rank_sort_order, c.organiser_message, c.chosen_date, c.chosen_slot,
                c.created_at, c.last_activity,
                g.token AS group_token, g.title AS group_title
         FROM calendars c
         LEFT JOIN `groups` g ON g.id = c.group_id
         WHERE c.token = :t"
    );
    $stmt->execute([':t' => $token]);
    $cal = $stmt->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);

    $slots = null;
    if (isset($cal['slots_json']) && is_string($cal['slots_json']) && $cal['slots_json'] !== '') {
        $decoded = json_decode($cal['slots_json'], true);
        if (is_array($decoded)) $slots = $decoded;
    }
    $cal['slots'] = $slots;

    $statuses = null;
    if (isset($cal['statuses_json']) && is_string($cal['statuses_json']) && $cal['statuses_json'] !== '') {
        $decoded = json_decode($cal['statuses_json'], true);
        if (is_array($decoded)) $statuses = $decoded;
    }
    if ($statuses === null) {
        // Backward compatibility with calendars created before statuses_json existed
        $statuses = [
            ['label' => 'Yes', 'color' => '#357A38'],
            ['label' => 'Maybe', 'color' => '#e58800'],
            ['label' => 'No', 'color' => '#880000'],
        ];
    }
    $cal['statuses'] = $statuses;
    $cal['exclude_weekends'] = (int)($cal['exclude_weekends'] ?? 0);
    $cal['is_private'] = (int)($cal['is_private'] ?? 0);

    // Date filter: mode and selected dates
    $cal['date_filter_mode'] = (string)($cal['date_filter_mode'] ?? 'all');
    if (!in_array($cal['date_filter_mode'], ['all', 'only', 'except'], true)) {
        $cal['date_filter_mode'] = 'all';
    }
    $dfDates = null;
    if (isset($cal['date_filter_dates']) && is_string($cal['date_filter_dates']) && $cal['date_filter_dates'] !== '') {
        $decoded = json_decode($cal['date_filter_dates'], true);
        if (is_array($decoded)) $dfDates = $decoded;
    }
    $cal['date_filter_dates'] = $dfDates;

    // Rank sort order: 'score' (default) or 'date' (chronological)
    $rso = (string)($cal['rank_sort_order'] ?? 'score');
    $cal['rank_sort_order'] = in_array($rso, ['score', 'date'], true) ? $rso : 'score';

    // Organiser message: plain text, limit defined by MESSAGE_MAX_LEN constant
    $cal['organiser_message'] = (string)($cal['organiser_message'] ?? '');
    $cal['organiser_message_max'] = MESSAGE_MAX_LEN;

    // Chosen slot: if organiser has locked in a date+slot, expose it
    $cal['chosen_date'] = $cal['chosen_date'] ?? null;
    $cal['chosen_slot'] = $cal['chosen_slot'] ?? null;

    // Hub breadcrumb when calendar belongs to a group
    if (!empty($cal['group_id']) && !empty($cal['group_token'])) {
        $cal['group'] = [
            'token' => (string)$cal['group_token'],
            'title' => (string)($cal['group_title'] ?? ''),
        ];
    }

    // Opening a calendar from the Hub (from_hub=1 + matching g token) counts as Hub activity
    if ((string)($_GET['from_hub'] ?? '') === '1'
        && !empty($cal['group_id'])
        && !empty($cal['group_token'])) {
        $hubTokenParam = (string)($_GET['g'] ?? '');
        if ($hubTokenParam !== ''
            && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $hubTokenParam)
            && hash_equals((string)$cal['group_token'], $hubTokenParam)) {
            touchGroupActivity($pdo, (int)$cal['group_id']);
        }
    }

    unset($cal['group_id'], $cal['group_token'], $cal['group_title']);

    respond(200, ['status' => 'success', 'calendar' => $cal]);
}

// Save date filter dates (admin only)
// Updates the date_filter_dates JSON column with the organiser's selected dates.
// Requires admin auth token. Does NOT change date_filter_mode (set at creation).
if ($action === 'save_date_filter' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Look up calendar
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Verify session and require admin role
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can update date filters']);
    }

    // Validate incoming dates array
    $dates = $_POST['dates'] ?? null;
    if ($dates !== null && !is_array($dates)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid dates format']);
    }

    $validDates = [];
    if (is_array($dates)) {
        foreach ($dates as $d) {
            $d = (string)$d;
            // Validate YYYY-MM-DD format
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                $validDates[] = $d;
            }
        }
        // Remove duplicates and sort
        $validDates = array_values(array_unique($validDates));
        sort($validDates);
    }

    // Store as JSON (null if empty array to keep DB clean)
    $datesJson = count($validDates) > 0 ? json_encode($validDates) : null;

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET date_filter_dates = :dates WHERE id = :cid"
    );
    $stmtU->execute([':dates' => $datesJson, ':cid' => $calId]);

    respond(200, ['status' => 'success', 'dates' => $validDates]);
}

// Save rank sort order (admin only)
// Toggles the ranking display between 'score' (best first) and 'date' (chronological).
// Persisted so all users see the same order chosen by the organiser.
if ($action === 'save_rank_sort' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Look up calendar
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Verify session and require admin role
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can change rank sort order']);
    }

    // Validate sort order value
    $order = (string)($_POST['order'] ?? '');
    if (!in_array($order, ['score', 'date'], true)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid sort order. Use "score" or "date".']);
    }

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET rank_sort_order = :ord WHERE id = :cid"
    );
    $stmtU->execute([':ord' => $order, ':cid' => $calId]);

    respond(200, ['status' => 'success', 'rank_sort_order' => $order]);
}

// Save organiser message (admin only)
// Updates the short message displayed to all calendar participants.
// Length enforced by MESSAGE_MAX_LEN constant. Empty string clears the message.
if ($action === 'save_organiser_message' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Look up calendar
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Verify session and require admin role
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can update the message']);
    }

    // Sanitise: trim, strip tags, enforce max length from constant
    $msg = trim(strip_tags((string)($_POST['message'] ?? '')));
    if (mb_strlen($msg) > MESSAGE_MAX_LEN) {
        $msg = mb_substr($msg, 0, MESSAGE_MAX_LEN);
    }

    // Empty string stored as NULL for cleanliness
    $stmtU = $pdo->prepare(
        "UPDATE calendars SET organiser_message = :msg WHERE id = :cid"
    );
    $stmtU->execute([':msg' => $msg === '' ? null : $msg, ':cid' => $calId]);

    respond(200, ['status' => 'success', 'organiser_message' => $msg]);
}

// List users
if ($action === 'users' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireToken();
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE calendar_id = :cid ORDER BY created_at ASC, id ASC");
    $stmtU->execute([':cid' => $calId]);
    $users = $stmtU->fetchAll();

    respond(200, ['status' => 'success', 'users' => $users]);
}

// Add user
if ($action === 'add_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $name = normaliseName($_POST['display_name'] ?? ($_POST['name'] ?? null));
    $pinHash = hashPin((string)($_POST['pin'] ?? ''));
    if ($name === null || $pinHash === null) respond(400, ['status' => 'error', 'message' => 'Invalid name or PIN']);

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO users (calendar_id, display_name, role, pin_hash, created_at)
             VALUES (:cid, :dn, 'member', :ph, NOW())"
        );
        $stmt->execute([':cid' => $calId, ':dn' => $name, ':ph' => $pinHash]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000') {
            respondDuplicateName();
        }
        respond(500, ['status' => 'error', 'message' => 'Failed to add user']);
    }

    // IMPORTANT: Get lastInsertId immediately after INSERT, before any other queries
    $newId = (int)$pdo->lastInsertId();

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    respond(200, [
        'status' => 'success',
        'user_id' => $newId,
        'user' => [
            'id' => $newId,
            'display_name' => $name,
            'role' => 'member',
        ],
    ]);
}

// Rename user (self or admin)
if ($action === 'rename_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $session = requireSession($pdo, $calId);

    $targetId = (int)($_POST['user_id'] ?? 0);
    $newName = normaliseName($_POST['display_name'] ?? ($_POST['name'] ?? null));
    if ($targetId <= 0 || $newName === null) respond(400, ['status' => 'error', 'message' => 'Invalid request']);

    if ($session['role'] !== 'admin' && $session['user_id'] !== $targetId) {
        respond(403, ['status' => 'error', 'message' => 'Not permitted']);
    }

    try {
        $stmt = $pdo->prepare("UPDATE users SET display_name = :dn WHERE id = :uid AND calendar_id = :cid");
        $stmt->execute([':dn' => $newName, ':uid' => $targetId, ':cid' => $calId]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000') {
            respondDuplicateName();
        }
        respond(500, ['status' => 'error', 'message' => 'Failed to rename user']);
    }

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    respond(200, ['status' => 'success']);
}

// Authenticate user by PIN
if ($action === 'auth_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $userId = (int)($_POST['user_id'] ?? 0);
    $pin = (string)($_POST['pin'] ?? '');
    if ($userId <= 0 || !preg_match('/^\d{4}$/', $pin)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $stmtU = $pdo->prepare("SELECT id, pin_hash, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calId]);
    $user = $stmtU->fetch();
    if (!$user) respond(404, ['status' => 'error', 'message' => 'User not found']);

    checkAccountLockout($pdo, $userId);

    if (!verifyPin($pin, (string)$user['pin_hash'])) {
        recordFailedAttempt($pdo, $userId);
        logSecurityEvent('AUTH_FAILED', ['user_id' => $userId, 'calendar_id' => $calId]);

        // If this attempt triggers a lockout, record it.
        $stmtL = $pdo->prepare("SELECT locked_until, failed_attempts FROM users WHERE id = :uid");
        $stmtL->execute([':uid' => $userId]);
        $after = $stmtL->fetch();
        if ($after && !empty($after['locked_until'])) {
            logSecurityEvent('ACCOUNT_LOCKED', ['user_id' => $userId, 'calendar_id' => $calId]);
        }

        respond(401, ['status' => 'error', 'message' => 'Invalid PIN']);
    }

    resetFailedAttempts($pdo, $userId);

    $tok = bin2hex(random_bytes(32));
    $stmtS = $pdo->prepare(
        "INSERT INTO user_sessions (calendar_id, user_id, token, created_at, expires_at)
         VALUES (:cid, :uid, :tok, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))"
    );
    $stmtS->execute([':cid' => $calId, ':uid' => $userId, ':tok' => $tok]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    respond(200, ['status' => 'success', 'auth_token' => $tok, 'role' => (string)$user['role'], 'user_id' => $userId]);
}

// Availability fetch (read-only)
if ($action === 'availability' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireToken();
    $from = (string)($_GET['from'] ?? '');
    $to = (string)($_GET['to'] ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || $from > $to) {
        respond(400, ['status' => 'error', 'message' => 'Invalid range']);
    }

    $stmtC = $pdo->prepare("SELECT id, is_private FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];
    $isPrivate = (int)($cal['is_private'] ?? 0);

    $session = getOptionalSession($pdo, $calId);
    $rows = [];
    $summary = [];

    if ($isPrivate === 0) {
        // Open: anyone with the calendar link sees all rows
        $stmt = $pdo->prepare(
            "SELECT calendar_id, user_id, day, slot, status
             FROM availability
             WHERE calendar_id = :cid AND day BETWEEN :f AND :t"
        );
        $stmt->execute([':cid' => $calId, ':f' => $from, ':t' => $to]);
        $rows = $stmt->fetchAll();
    } elseif ($session === null) {
        // Hidden/Blind without auth: no data
        $rows = [];
        $summary = [];
    } elseif ($isPrivate === 1 && $session['role'] === 'admin') {
        // Hidden + organiser: full detail
        $stmt = $pdo->prepare(
            "SELECT calendar_id, user_id, day, slot, status
             FROM availability
             WHERE calendar_id = :cid AND day BETWEEN :f AND :t"
        );
        $stmt->execute([':cid' => $calId, ':f' => $from, ':t' => $to]);
        $rows = $stmt->fetchAll();
    } else {
        // Hidden member or Blind (any role): own rows + anonymous summary
        $stmt = $pdo->prepare(
            "SELECT calendar_id, user_id, day, slot, status
             FROM availability
             WHERE calendar_id = :cid AND user_id = :uid AND day BETWEEN :f AND :t"
        );
        $stmt->execute([':cid' => $calId, ':uid' => $session['user_id'], ':f' => $from, ':t' => $to]);
        $rows = $stmt->fetchAll();
        $summary = buildAvailabilitySummary($pdo, $calId, $from, $to);
    }

    respond(200, ['status' => 'success', 'rows' => $rows, 'summary' => $summary]);
}

// Save availability changes
if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Need statuses_json to validate per-calendar status range (1..5 supported).
    $stmtC = $pdo->prepare("SELECT id, statuses_json, chosen_date, chosen_slot FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Block saves if the organiser has locked in a chosen slot (calendar is frozen)
    if (!empty($cal['chosen_date']) && !empty($cal['chosen_slot'])) {
        respond(403, ['status' => 'error', 'message' => 'This calendar has been finalised. The organiser has locked in a date and slot.']);
    }

    // Determine the maximum allowed status value for this calendar.
    // Statuses are stored as integers: 0 = NULL, 1..N = per-calendar options (1..5 options supported).
    $rawStatuses = null;
    if (isset($cal['statuses_json']) && is_string($cal['statuses_json']) && trim($cal['statuses_json']) !== '') {
        $decoded = json_decode($cal['statuses_json'], true);
        if (is_array($decoded)) $rawStatuses = $decoded;
    }
    [$okStatuses, $normStatuses] = validateStatusesArray($rawStatuses);
    // Fallback to 3 if the calendar has no valid custom statuses.
    $maxStatus = ($okStatuses && is_array($normStatuses) && count($normStatuses) >= 1 && count($normStatuses) <= 5)
        ? count($normStatuses)
        : 3;

    $session = requireSession($pdo, $calId);

    $userId = (int)($_POST['user_id'] ?? 0);
    $changes = $_POST['changes'] ?? null;
    if ($userId <= 0 || !is_array($changes)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    // Members can only save themselves. Admin can save anyone.
    if ($session['role'] !== 'admin' && $session['user_id'] !== $userId) {
        respond(403, ['status' => 'error', 'message' => 'Not permitted']);
    }

    // Validate that user belongs to this calendar
    $stmtU = $pdo->prepare("SELECT id FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calId]);
    if (!$stmtU->fetch()) respond(404, ['status' => 'error', 'message' => 'User not found']);

    // Transaction: apply changes
    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare(
            "INSERT INTO availability (calendar_id, user_id, day, slot, status)
             VALUES (:cid, :uid, :day, :slot, :st)
             ON DUPLICATE KEY UPDATE status = VALUES(status)"
        );
        $del = $pdo->prepare(
            "DELETE FROM availability
             WHERE calendar_id = :cid AND user_id = :uid AND day = :day AND slot = :slot"
        );

        foreach ($changes as $day => $slots) {
            if (!is_string($day) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
                throw new RuntimeException('Invalid day');
            }
            if (!is_array($slots)) {
                throw new RuntimeException('Invalid slots');
            }
            foreach ($slots as $slot => $st) {
                $slot = trim(preg_replace('/\s+/', ' ', (string)$slot));
                if ($slot === '' || strlen($slot) > 20) {
                    throw new RuntimeException('Invalid slot');
                }
                $stNum = (int)$st;
                if ($stNum === 0) {
                    $del->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot]);
                } else {
                    if ($stNum < 1 || $stNum > $maxStatus) {
                        throw new RuntimeException('Invalid status');
                    }
                    $ins->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot, ':st' => $stNum]);
                }
            }
        }

        $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);
        touchGroupForCalendar($pdo, $calId);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        respond(400, ['status' => 'error', 'message' => 'Failed to save changes']);
    }

    respond(200, ['status' => 'success']);
}

// Reset user availability (self or admin)
// Authenticated users can reset their own availability.
// Admin can reset any user's availability.
if ($action === 'reset_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $session = requireSession($pdo, $calId);

    $targetId = (int)($_POST['user_id'] ?? 0);
    if ($targetId <= 0) respond(400, ['status' => 'error', 'message' => 'Invalid request']);

    // Members can only reset themselves; admin can reset anyone
    if ($session['role'] !== 'admin' && $session['user_id'] !== $targetId) {
        respond(403, ['status' => 'error', 'message' => 'Not permitted']);
    }

    $stmt = $pdo->prepare("DELETE FROM availability WHERE calendar_id = :cid AND user_id = :uid");
    $stmt->execute([':cid' => $calId, ':uid' => $targetId]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    $eventType = ($session['user_id'] === $targetId) ? 'USER_RESET_SELF' : 'ADMIN_RESET_USER';
    logSecurityEvent($eventType, ['actor_id' => $session['user_id'], 'target_id' => $targetId, 'calendar_id' => $calId]);

    respond(200, ['status' => 'success']);
}

/**
 * Reset ALL availability for ALL users in a calendar (admin only)
 * Requires double confirmation on frontend (confirm + type "RESET")
 */
if ($action === 'reset_all' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Not permitted - admin only']);
    }

    // Require confirmation code from frontend
    $confirmCode = trim($_POST['confirm_code'] ?? '');
    if (strtoupper($confirmCode) !== 'RESET') {
        respond(400, ['status' => 'error', 'message' => 'Invalid confirmation code']);
    }

    // Delete ALL availability for this calendar
    $stmt = $pdo->prepare("DELETE FROM availability WHERE calendar_id = :cid");
    $stmt->execute([':cid' => $calId]);
    $deletedCount = $stmt->rowCount();

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    logSecurityEvent('ADMIN_RESET_ALL', ['actor_id' => $session['user_id'], 'calendar_id' => $calId, 'deleted_rows' => $deletedCount]);

    respond(200, ['status' => 'success', 'deleted' => $deletedCount]);
}

// =========================================================================
// SITE ADMIN ENDPOINTS
// These endpoints require the site admin password from config.php
// =========================================================================

/**
 * Verify site admin password and return session token.
 * Password is stored in config.php as $config['admin']['password']
 */
if ($action === 'admin_login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    checkAdminLoginLockout($pdo, $config);

    $password = trim((string)($_POST['password'] ?? ''));
    
    if ($password === '') {
        respond(400, ['status' => 'error', 'message' => 'Password required']);
    }

    // Get admin password from config
    $adminPassword = (string)($config['admin']['password'] ?? '');
    if ($adminPassword === '') {
        logSecurityEvent('ADMIN_LOGIN_FAILED', ['reason' => 'No admin password configured']);
        respond(500, ['status' => 'error', 'message' => 'Admin not configured']);
    }

    // Verify password (supports both plain text and hashed)
    $valid = false;
    if (strlen($adminPassword) === 60 && strpos($adminPassword, '$2') === 0) {
        // Password is hashed with password_hash()
        $valid = password_verify($password, $adminPassword);
    } else {
        // Plain text comparison (less secure, but simple for initial setup)
        $valid = hash_equals($adminPassword, $password);
    }

    if (!$valid) {
        recordAdminLoginFailedAttempt($pdo, $config);
        logSecurityEvent('ADMIN_LOGIN_FAILED', ['reason' => 'Invalid password']);
        respond(401, ['status' => 'error', 'message' => 'Invalid password']);
    }

    resetAdminLoginAttempts($pdo);

    // Generate admin session token (stored in PHP session)
    startSecureSession();
    $adminToken = bin2hex(random_bytes(32));
    $_SESSION['admin_token'] = $adminToken;
    $_SESSION['admin_token_expires'] = time() + 3600; // 1 hour expiry

    logSecurityEvent('ADMIN_LOGIN_SUCCESS', []);

    respond(200, [
        'status' => 'success',
        'admin_token' => $adminToken,
        'csrf_token' => generateCsrfToken()
    ]);
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

/**
 * Get list of all calendars for admin panel
 */
if ($action === 'admin_calendars' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $sql = "
        SELECT 
            c.id,
            c.token,
            c.title,
            c.category,
            c.created_at,
            c.last_activity,
            c.never_expires,
            c.group_id,
            g.token AS group_token,
            g.title AS group_title,
            COUNT(DISTINCT u.id) AS user_count
        FROM calendars c
        LEFT JOIN users u ON u.calendar_id = c.id
        LEFT JOIN `groups` g ON g.id = c.group_id
        GROUP BY c.id
        ORDER BY c.id DESC
    ";
    
    $stmt = $pdo->query($sql);
    $calendars = $stmt->fetchAll();

    // Convert never_expires to int for JS
    foreach ($calendars as &$cal) {
        $cal['never_expires'] = (int)($cal['never_expires'] ?? 0);
        $cal['user_count'] = (int)($cal['user_count'] ?? 0);
        $cal['group_id'] = $cal['group_id'] !== null ? (int)$cal['group_id'] : null;
    }

    respond(200, [
        'status' => 'success',
        'calendars' => $calendars,
        'csrf_token' => generateCsrfToken()
    ]);
}

/**
 * Set never_expires flag for a calendar
 */
if ($action === 'admin_set_permanent' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);
    $neverExpires = (int)($_POST['never_expires'] ?? 0);

    if ($calendarId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar ID']);
    }

    // Verify calendar exists
    $stmt = $pdo->prepare("SELECT id FROM calendars WHERE id = :id");
    $stmt->execute([':id' => $calendarId]);
    if (!$stmt->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    }

    // Update never_expires flag
    $stmt = $pdo->prepare("UPDATE calendars SET never_expires = :ne WHERE id = :id");
    $stmt->execute([':ne' => $neverExpires ? 1 : 0, ':id' => $calendarId]);

    logSecurityEvent('ADMIN_SET_PERMANENT', [
        'calendar_id' => $calendarId,
        'never_expires' => $neverExpires ? 1 : 0
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a calendar (admin only)
 */
if ($action === 'admin_delete_calendar' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);

    if ($calendarId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar ID']);
    }

    // Verify calendar exists
    $stmt = $pdo->prepare("SELECT id, token, title FROM calendars WHERE id = :id");
    $stmt->execute([':id' => $calendarId]);
    $cal = $stmt->fetch();
    if (!$cal) {
        respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    }

    // Delete calendar (cascades to users, sessions, availability)
    $stmt = $pdo->prepare("DELETE FROM calendars WHERE id = :id");
    $stmt->execute([':id' => $calendarId]);

    logSecurityEvent('ADMIN_DELETE_CALENDAR', [
        'calendar_id' => $calendarId,
        'token' => $cal['token'],
        'title' => $cal['title']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Get list of all Hubs (groups) for admin panel
 */
if ($action === 'admin_groups' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $sql = "
        SELECT g.id, g.token, g.title, g.organiser_name,
               g.created_at, g.last_activity, g.never_expires,
               COUNT(c.id) AS calendar_count
        FROM `groups` g
        LEFT JOIN calendars c ON c.group_id = g.id
        GROUP BY g.id
        ORDER BY g.id DESC
    ";

    $stmt = $pdo->query($sql);
    $groups = $stmt->fetchAll();

    foreach ($groups as &$group) {
        $group['never_expires'] = (int)($group['never_expires'] ?? 0);
        $group['calendar_count'] = (int)($group['calendar_count'] ?? 0);
    }

    respond(200, [
        'status' => 'success',
        'groups' => $groups,
        'csrf_token' => generateCsrfToken()
    ]);
}

/**
 * List child calendars for a Hub (super admin only)
 */
if ($action === 'admin_group_calendars' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $groupId = (int)($_GET['group_id'] ?? 0);
    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmtG = $pdo->prepare("SELECT id FROM `groups` WHERE id = :id");
    $stmtG->execute([':id' => $groupId]);
    if (!$stmtG->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    $sql = "
        SELECT c.id, c.token, c.title, c.created_at, c.last_activity,
               COUNT(DISTINCT u.id) AS user_count
        FROM calendars c
        LEFT JOIN users u ON u.calendar_id = c.id
        WHERE c.group_id = :gid
        GROUP BY c.id
        ORDER BY c.id DESC
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':gid' => $groupId]);
    $calendars = $stmt->fetchAll();

    foreach ($calendars as &$cal) {
        $cal['user_count'] = (int)($cal['user_count'] ?? 0);
    }

    respond(200, ['status' => 'success', 'calendars' => $calendars]);
}

/**
 * Set never_expires flag for a Hub (group)
 */
if ($action === 'admin_set_group_permanent' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $groupId = (int)($_POST['group_id'] ?? 0);
    $neverExpires = (int)($_POST['never_expires'] ?? 0);

    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmt = $pdo->prepare("SELECT id FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);
    if (!$stmt->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    $stmt = $pdo->prepare("UPDATE `groups` SET never_expires = :ne WHERE id = :id");
    $stmt->execute([':ne' => $neverExpires ? 1 : 0, ':id' => $groupId]);

    logSecurityEvent('ADMIN_SET_GROUP_PERMANENT', [
        'group_id' => $groupId,
        'never_expires' => $neverExpires ? 1 : 0
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a Hub (group) — detaches child calendars, does not delete them
 */
if ($action === 'admin_delete_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $groupId = (int)($_POST['group_id'] ?? 0);

    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmt = $pdo->prepare("SELECT id, token, title FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);
    $group = $stmt->fetch();
    if (!$group) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    $stmt = $pdo->prepare("DELETE FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);

    logSecurityEvent('ADMIN_DELETE_GROUP', [
        'group_id' => $groupId,
        'token' => $group['token'],
        'title' => $group['title']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * List all users for a specific calendar (super admin only)
 * Returns user id, display_name, and role for inline display in admin panel.
 */
if ($action === 'admin_list_users' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $calendarId = (int)($_GET['calendar_id'] ?? 0);
    if ($calendarId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar ID']);
    }

    // Verify calendar exists
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE id = :id");
    $stmtC->execute([':id' => $calendarId]);
    if (!$stmtC->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    }

    $stmtU = $pdo->prepare(
        "SELECT id, display_name, role FROM users WHERE calendar_id = :cid ORDER BY role DESC, created_at ASC"
    );
    $stmtU->execute([':cid' => $calendarId]);
    $users = $stmtU->fetchAll();

    respond(200, ['status' => 'success', 'users' => $users]);
}

/**
 * Delete a specific user from a calendar (super admin only)
 * Cascades to availability and sessions via foreign keys.
 */
if ($action === 'admin_delete_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);
    $userId = (int)($_POST['user_id'] ?? 0);

    if ($calendarId <= 0 || $userId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar or user ID']);
    }

    // Verify user belongs to this calendar
    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calendarId]);
    $user = $stmtU->fetch();
    if (!$user) {
        respond(404, ['status' => 'error', 'message' => 'User not found in this calendar']);
    }

    // Delete user (cascades to availability and sessions)
    $stmtD = $pdo->prepare("DELETE FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtD->execute([':uid' => $userId, ':cid' => $calendarId]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calendarId]);

    logSecurityEvent('ADMIN_DELETE_USER', [
        'calendar_id' => $calendarId,
        'user_id' => $userId,
        'display_name' => $user['display_name'],
        'role' => $user['role']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a specific user from a calendar (organiser only)
 * Organisers cannot delete themselves. Cascades via foreign keys.
 */
if ($action === 'delete_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Require organiser session
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can delete users']);
    }

    $targetId = (int)($_POST['user_id'] ?? 0);
    if ($targetId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid user ID']);
    }

    // Prevent organiser from deleting themselves
    if ($targetId === (int)$session['user_id']) {
        respond(400, ['status' => 'error', 'message' => 'You cannot delete yourself. Use Reset Mine instead.']);
    }

    // Verify target user exists in this calendar
    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $targetId, ':cid' => $calId]);
    $targetUser = $stmtU->fetch();
    if (!$targetUser) {
        respond(404, ['status' => 'error', 'message' => 'User not found']);
    }

    // Delete user (cascades to availability and sessions)
    $stmtD = $pdo->prepare("DELETE FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtD->execute([':uid' => $targetId, ':cid' => $calId]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    logSecurityEvent('ORGANISER_DELETE_USER', [
        'actor_id' => $session['user_id'],
        'target_id' => $targetId,
        'target_name' => $targetUser['display_name'],
        'calendar_id' => $calId
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Choose (lock in) a specific date+slot as the final decision (organiser only).
 * Sets chosen_date and chosen_slot on the calendar, freezing availability edits.
 */
if ($action === 'choose_slot' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Require organiser session
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can finalise a slot']);
    }

    // Validate chosen_date (YYYY-MM-DD) and chosen_slot (non-empty string, max 50)
    $chosenDate = (string)($_POST['chosen_date'] ?? '');
    $chosenSlot = trim((string)($_POST['chosen_slot'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $chosenDate)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid date format']);
    }
    if ($chosenSlot === '' || mb_strlen($chosenSlot) > 50) {
        respond(400, ['status' => 'error', 'message' => 'Invalid slot']);
    }

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET chosen_date = :cd, chosen_slot = :cs, last_activity = NOW() WHERE id = :cid"
    );
    $stmtU->execute([':cd' => $chosenDate, ':cs' => $chosenSlot, ':cid' => $calId]);

    logSecurityEvent('CHOOSE_SLOT', [
        'calendar_id' => $calId,
        'actor_id' => $session['user_id'],
        'chosen_date' => $chosenDate,
        'chosen_slot' => $chosenSlot
    ]);

    respond(200, ['status' => 'success', 'chosen_date' => $chosenDate, 'chosen_slot' => $chosenSlot]);
}

/**
 * Unchoose (reopen) a previously locked-in slot (organiser only).
 * Nulls chosen_date and chosen_slot, allowing availability edits again.
 */
if ($action === 'unchoose_slot' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Require organiser session
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can reopen the calendar']);
    }

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET chosen_date = NULL, chosen_slot = NULL, last_activity = NOW() WHERE id = :cid"
    );
    $stmtU->execute([':cid' => $calId]);

    logSecurityEvent('UNCHOOSE_SLOT', [
        'calendar_id' => $calId,
        'actor_id' => $session['user_id']
    ]);

    respond(200, ['status' => 'success']);
}


/**
 * Public endpoint: return site config from the DB so index.js can
 * hydrate the setup page with admin-customised defaults.
 * No auth required - read-only public data, contains no secrets.
 * Falls back gracefully (returns empty object) if the table does not exist yet.
 */
if ($action === 'get_site_config' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $stmt = $pdo->query("SELECT config_json FROM site_config WHERE id = 1 LIMIT 1");
        $row  = $stmt->fetch();
    } catch (Throwable $e) {
        // Table may not exist yet - silently return empty so index.js uses hardcoded defaults
        respond(200, ['status' => 'success', 'config' => new stdClass()]);
    }

    if (!$row || empty($row['config_json'])) {
        respond(200, ['status' => 'success', 'config' => new stdClass()]);
    }

    $cfg = json_decode((string)$row['config_json'], true);
    if (!is_array($cfg)) {
        respond(200, ['status' => 'success', 'config' => new stdClass()]);
    }

    respond(200, ['status' => 'success', 'config' => $cfg]);
}

/**
 * Admin endpoint: validate and persist site config to the DB.
 * Requires admin session token + CSRF.
 *
 * Validated structure:
 *  - slots.max: int >= 1 (no upper limit)
 *  - slots.examples: string[]                      max 30 items, 20 chars each
 *  - slots.defaults: string[]                      up to slots.max items
 *  - options.max: int >= 1 (no upper limit)
 *  - options.presets: [{key, label, items[]}]      max 20 presets
 *  - options.defaults: [{label, weight}]           max 5
 *  - dates.max_range_days: int 1-365
 *  - dates.presets: [{key, label, days}]           max 20
 *  - retention.inactive_days: int 1-3650           (calendar auto-delete threshold)
 *  - retention.hub_inactive_days: int 1-3650       (Hub auto-delete threshold)
 */
if ($action === 'admin_save_config' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    // Parse incoming config from POST body.
    // apiRequest sends {config: object} as JSON; readJsonBody decodes the outer
    // envelope so $_POST['config'] arrives as an array directly.
    $incoming = $_POST['config'] ?? null;
    if (is_string($incoming)) {
        // Fallback: handle legacy double-encoded string just in case
        $incoming = json_decode($incoming, true);
    }
    if (!is_array($incoming)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid config payload']);
    }

    // --- Sanitiser helpers ---
    $sanitiseStr = function($v, int $max = 50): string {
        $s = trim((string)($v ?? ''));
        // Strip non-printable ASCII and HTML-dangerous characters
        $s = preg_replace('/[^\x20-\x7E]/', '', $s);
        $s = str_replace(['<', '>', '"', "'"], '', $s);
        return mb_substr($s, 0, $max);
    };

    $sanitiseKey = function($v): string {
        // Keys stored in JSON: alphanumeric + underscores only
        return preg_replace('/[^a-zA-Z0-9_]/', '', (string)($v ?? ''));
    };

    $cfg = [];

    // --- slots ---
    $rawSlots = is_array($incoming['slots'] ?? null) ? $incoming['slots'] : [];
    $slotsMax = max(1, (int)($rawSlots['max'] ?? 6));

    $rawExamples = is_array($rawSlots['examples'] ?? null) ? $rawSlots['examples'] : [];
    $slotExamples = [];
    foreach (array_slice($rawExamples, 0, 30) as $e) {
        $s = $sanitiseStr($e, 20);
        if ($s !== '') $slotExamples[] = $s;
    }

    $rawDefaults = is_array($rawSlots['defaults'] ?? null) ? $rawSlots['defaults'] : [];
    $slotDefaults = [];
    foreach (array_slice($rawDefaults, 0, $slotsMax) as $d) {
        $s = $sanitiseStr($d, 20);
        if ($s !== '') $slotDefaults[] = $s;
    }
    if (empty($slotDefaults)) $slotDefaults = ['Morning', 'Afternoon', 'Evening'];

    $cfg['slots'] = [
        'max'      => $slotsMax,
        'examples' => $slotExamples,
        'defaults' => $slotDefaults,
    ];

    // --- options ---
    $rawOpts = is_array($incoming['options'] ?? null) ? $incoming['options'] : [];
    $optsMax = max(1, (int)($rawOpts['max'] ?? 5));

    $rawPresets = is_array($rawOpts['presets'] ?? null) ? $rawOpts['presets'] : [];
    $optPresets = [];
    foreach (array_slice($rawPresets, 0, 20) as $p) {
        if (!is_array($p)) continue;
        $key   = $sanitiseKey($p['key']   ?? '');
        $label = $sanitiseStr($p['label'] ?? '', 60);
        $rawItems = is_array($p['items'] ?? null) ? $p['items'] : [];
        $items = [];
        foreach (array_slice($rawItems, 0, 5) as $item) {
            if (!is_array($item)) continue;
            $il = $sanitiseStr($item['label'] ?? '', 20);
            $iw = max(0, min(5, (int)($item['weight'] ?? 0)));
            if ($il !== '') $items[] = ['label' => $il, 'weight' => $iw];
        }
        if ($key !== '' && $label !== '' && !empty($items)) {
            $optPresets[] = ['key' => $key, 'label' => $label, 'items' => $items];
        }
    }

    $rawOptDef = is_array($rawOpts['defaults'] ?? null) ? $rawOpts['defaults'] : [];
    $optDefaults = [];
    foreach (array_slice($rawOptDef, 0, $optsMax) as $item) {
        if (!is_array($item)) continue;
        $il = $sanitiseStr($item['label'] ?? '', 20);
        $iw = max(0, min(5, (int)($item['weight'] ?? 0)));
        if ($il !== '') $optDefaults[] = ['label' => $il, 'weight' => $iw];
    }
    if (empty($optDefaults)) {
        $optDefaults = [
            ['label' => 'Yes',   'weight' => 2],
            ['label' => 'Maybe', 'weight' => 1],
            ['label' => 'No',    'weight' => 0],
        ];
    }

    $cfg['options'] = [
        'max'      => $optsMax,
        'presets'  => $optPresets,
        'defaults' => $optDefaults,
    ];

    // --- dates ---
    $rawDates = is_array($incoming['dates'] ?? null) ? $incoming['dates'] : [];
    $maxRange = max(1, min(365, (int)($rawDates['max_range_days'] ?? 360)));

    $rawDatePresets = is_array($rawDates['presets'] ?? null) ? $rawDates['presets'] : [];
    $datePresets = [];
    foreach (array_slice($rawDatePresets, 0, 20) as $dp) {
        if (!is_array($dp)) continue;
        $key   = $sanitiseKey($dp['key']   ?? '');
        $label = $sanitiseStr($dp['label'] ?? '', 30);
        $days  = max(0, min(365, (int)($dp['days'] ?? 0)));
        if ($key !== '' && $label !== '') {
            $datePresets[] = ['key' => $key, 'label' => $label, 'days' => $days];
        }
    }

    $cfg['dates'] = [
        'max_range_days' => $maxRange,
        'presets'        => $datePresets,
    ];

    // --- retention (auto-delete) ---
    // inactive_days: number of days a non-permanent calendar can sit without
    // any Submit/Save (last_activity update) before cleanup.php removes it.
    // hub_inactive_days: same rule for Hubs (separate threshold).
    // Permanent calendars/Hubs (never_expires = 1) are always protected by cleanup.php.
    $rawRetention = is_array($incoming['retention'] ?? null) ? $incoming['retention'] : [];
    $inactiveDays = (int)($rawRetention['inactive_days'] ?? 30);
    if ($inactiveDays < 1)    $inactiveDays = 1;
    if ($inactiveDays > 3650) $inactiveDays = 3650;

    $hubInactiveDays = (int)($rawRetention['hub_inactive_days'] ?? 30);
    if ($hubInactiveDays < 1)    $hubInactiveDays = 1;
    if ($hubInactiveDays > 3650) $hubInactiveDays = 3650;

    $cfg['retention'] = [
        'inactive_days' => $inactiveDays,
        'hub_inactive_days' => $hubInactiveDays,
    ];

    // Encode and upsert into site_config table (single enforced row, id = 1).
    // INSERT ... ON DUPLICATE KEY UPDATE handles both first-save and updates.
    $encoded = json_encode($cfg, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        respond(500, ['status' => 'error', 'message' => 'Failed to encode config']);
    }

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO site_config (id, config_json)
             VALUES (1, :json)
             ON DUPLICATE KEY UPDATE config_json = :json2, updated_at = NOW()"
        );
        $stmt->execute([':json' => $encoded, ':json2' => $encoded]);
    } catch (Throwable $e) {
        respond(500, ['status' => 'error', 'message' => 'DB write failed: ' . $e->getMessage()]);
    }

    logSecurityEvent('ADMIN_SAVE_CONFIG', ['sections' => array_keys($cfg)]);

    respond(200, ['status' => 'success', 'message' => 'Config saved']);
}


respond(404, ['status' => 'error', 'message' => 'Unknown action']);