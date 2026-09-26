<?php
/**
 * includes/http.php - Request/response basics: JSON responses, request parsing, config loading, client IP, secure session and CSRF.
 * Loaded by api.php.
 */

declare(strict_types=1);

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
