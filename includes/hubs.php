<?php
/**
 * includes/hubs.php - Hub (group) limits, lookup, activity and PIN lockout helpers.
 * Loaded by api.php.
 */

declare(strict_types=1);

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
        'hg' . $hourKey . base_convert((string)$groupId, 10, 36),
        $limits['per_ip_per_hub_per_hour'],
        'Too many calendars added to this Hub. Try again later.'
    );
    enforceActionRateLimit(
        $pdo,
        $ip,
        'hi' . $hourKey,
        $limits['per_ip_global_per_hour'],
        'Too many calendars added. Try again later.'
    );
}

function prepareHubCalendarAdd(PDO $pdo, int $groupId, array $config): void {
    $limits = hubLimitsConfig($config);
    enforceHubCalendarCapacity($pdo, $groupId, $limits);
    enforceHubCalendarRateLimit($pdo, $groupId, $limits);
}

function requireGroupTokenParam(): string {
    $t = (string)($_GET['g'] ?? '');
    if ($t === '' || !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $t)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group token']);
    }
    return $t;
}

function getGroupByToken(PDO $pdo, string $token): ?array {
    $stmt = $pdo->prepare(
        "SELECT id, token, title, organiser_name, organiser_pin_hash, organiser_account_id, failed_attempts, locked_until,
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
    pinLockoutCheck($pdo, 'group', $groupId, 'This Hub');
}

/** Returns the lock length in minutes when this wrong PIN started a lockout. */
function recordGroupFailedAttempt(PDO $pdo, int $groupId): ?int {
    global $config;
    return pinLockoutRecordFailure($pdo, 'group', $groupId, pinLockoutConfig($config ?? []));
}

function resetGroupFailedAttempts(PDO $pdo, int $groupId): void {
    pinLockoutReset($pdo, 'group', $groupId);
}

function resolveGroupTokenFromPost(): ?string {
    $gt = trim((string)($_POST['group_token'] ?? ''));
    if ($gt === '') return null;
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $gt)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group token']);
    }
    return $gt;
}
