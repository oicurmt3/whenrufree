<?php
/**
 * includes/sessions.php - Calendar user sessions, Hub organiser sessions and passkey subject lookup.
 * Loaded by api.php.
 */

declare(strict_types=1);

/** Issue a 24-hour calendar user session token (sent back via X-Auth-Token). */
function createUserSession(PDO $pdo, int $calendarId, int $userId): string {
    $tok = bin2hex(random_bytes(32));
    $pdo->prepare(
        "INSERT INTO user_sessions (calendar_id, user_id, token, created_at, expires_at)
         VALUES (:cid, :uid, :tok, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))"
    )->execute([':cid' => $calendarId, ':uid' => $userId, ':tok' => $tok]);
    return $tok;
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
 * Optional session lookup - returns null when no valid token is present.
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

/** Issue a 24-hour Hub organiser session token (sent back via X-Group-Auth-Token). */
function createGroupSession(PDO $pdo, int $groupId): string {
    $tok = bin2hex(random_bytes(32));
    $pdo->prepare(
        "INSERT INTO group_sessions (group_id, token, created_at, expires_at)
         VALUES (:gid, :tok, NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))"
    )->execute([':gid' => $groupId, ':tok' => $tok]);
    return $tok;
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

/**
 * Resolve who a passkey request is for.
 * ?g= targets the Hub organiser; ?c= targets a calendar user - the logged-in user
 * when $requireSession, otherwise the POSTed user_id (login).
 */
function resolvePasskeySubject(PDO $pdo, bool $requireSession): array {
    if (isset($_GET['g'])) {
        $grp = getGroupByToken($pdo, requireGroupTokenParam());
        if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
        if ($requireSession) requireGroupOrganiserSession($pdo, (int)$grp['id']);
        return [
            'kind' => 'group',
            'id' => (int)$grp['id'],
            'name' => (string)$grp['organiser_name'],
            'context' => (string)($grp['title'] ?: 'Hub'),
        ];
    }

    $stmtC = $pdo->prepare("SELECT id, title FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => requireToken()]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    if ($requireSession) {
        $userId = requireSession($pdo, $calId)['user_id'];
    } else {
        $userId = (int)($_POST['user_id'] ?? 0);
        if ($userId <= 0) respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calId]);
    $user = $stmtU->fetch();
    if (!$user) respond(404, ['status' => 'error', 'message' => 'User not found']);

    return [
        'kind' => 'user',
        'id' => (int)$user['id'],
        'calendar_id' => $calId,
        'role' => (string)$user['role'],
        'name' => (string)$user['display_name'],
        'context' => (string)($cal['title'] ?: 'Calendar'),
    ];
}
