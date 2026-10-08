<?php
/**
 * includes/sessions.php - Who the signed-in account is on a calendar or Hub.
 *
 * The signed-in account (includes/accounts.php) is the only session. On a calendar it acts as
 * the name it owns there (users.account_id); on a Hub it is the organiser when it matches
 * groups.organiser_account_id. Loaded by api.php.
 */

declare(strict_types=1);

/**
 * The signed-in account's name on this calendar, or null when it has not joined.
 * @returns array{user_id:int, role:string, calendar_id:int, account_id:int}|null
 */
function getOptionalSession(PDO $pdo, int $calendarId): ?array {
    $acct = accountCurrent($pdo);
    if ($acct === null || $acct['needs_setup']) return null;
    $user = accountCalendarUser($pdo, $calendarId, $acct['id']);
    if ($user === null) return null;
    return [
        'user_id' => $user['id'],
        'role' => $user['role'],
        'calendar_id' => $calendarId,
        'account_id' => $acct['id'],
    ];
}

/**
 * Like getOptionalSession, but responds 401 when signed out and 403 NOT_JOINED when the
 * account has no name on this calendar yet.
 * @returns array{user_id:int, role:string, calendar_id:int, account_id:int}
 */
function requireSession(PDO $pdo, int $calendarId): array {
    requireAccount($pdo);
    $session = getOptionalSession($pdo, $calendarId);
    if ($session === null) {
        respond(403, ['status' => 'error', 'code' => 'NOT_JOINED', 'message' => 'Join this calendar first.']);
    }
    return $session;
}

/**
 * The signed-in account when it organises this Hub, else null.
 * @returns array{group_id:int, role:string, account_id:int}|null
 */
function getOptionalGroupSession(PDO $pdo, int $groupId): ?array {
    $acct = accountCurrent($pdo);
    if ($acct === null || $acct['needs_setup']) return null;
    $stmt = $pdo->prepare("SELECT 1 FROM `groups` WHERE id = :gid AND organiser_account_id = :aid LIMIT 1");
    $stmt->execute([':gid' => $groupId, ':aid' => $acct['id']]);
    if (!$stmt->fetchColumn()) return null;
    return ['group_id' => $groupId, 'role' => 'admin', 'account_id' => $acct['id']];
}

function requireGroupOrganiserSession(PDO $pdo, int $groupId): array {
    requireAccount($pdo);
    $session = getOptionalGroupSession($pdo, $groupId);
    if (!$session) {
        respond(403, ['status' => 'error', 'code' => 'NOT_ORGANISER', 'message' => 'Only the Hub organiser can do that.']);
    }
    return $session;
}
