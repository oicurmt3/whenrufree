<?php
/**
 * includes/members.php - Blocked people and private names.
 *
 * Blocking: users.blocked blocks one person on one calendar. Their answers are kept but left out
 * of the calendar, Best Match and totals; their bookings still hold their places. The organiser
 * toggles it from the People list (api.php?action=manage_calendar_user) and unblocking restores
 * everything.
 *
 * Private names: on Blind calendars, and Hidden calendars created with hide_names, participants
 * only see themselves, the organisers and a count.
 *
 * Needs the hide_names and blocked columns (added by migrations/009); until they exist they
 * are simply unavailable.
 * Relies on respond(), accountCurrent() and accessRequestTarget().
 */

declare(strict_types=1);

/** True when the hide_names and blocked columns exist. */
function membersTablesReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT hide_names FROM calendars LIMIT 0');
            $pdo->query('SELECT blocked FROM users LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/** True when the account is blocked on this calendar. */
function membersCalendarBlocked(PDO $pdo, int $calendarId, int $accountId): bool {
    $stmt = $pdo->prepare(
        "SELECT blocked FROM users WHERE calendar_id = :cid AND account_id = :aid LIMIT 1"
    );
    $stmt->execute([':cid' => $calendarId, ':aid' => $accountId]);
    $blocked = $stmt->fetchColumn();
    return $blocked !== false && (int)$blocked === 1;
}

function membersRespondBlocked(): void {
    respond(403, [
        'status' => 'error',
        'code' => 'BLOCKED',
        'message' => 'The organiser has blocked you from this calendar.',
    ]);
}

/**
 * Central gate, run after accessGate. A person the organiser has blocked on this calendar is
 * refused everywhere on it.
 */
function membersGate(PDO $pdo, string $action): void {
    static $exempt = ['csrf_token', 'diag', 'access_check'];
    if (in_array($action, $exempt, true) || str_starts_with($action, 'admin_')) return;
    if (!accountsTablesReady($pdo) || !membersTablesReady($pdo)) return;

    $target = accessRequestTarget($action);
    if ($target === null || $target[0] !== 'calendar') return;

    $acct = accountCurrent($pdo);
    if ($acct === null || $acct['needs_setup']) return;

    $stmt = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmt->execute([':t' => $target[1]]);
    $calId = $stmt->fetchColumn();
    if ($calId === false) return;

    if (membersCalendarBlocked($pdo, (int)$calId, (int)$acct['id'])) membersRespondBlocked();
}

/** Blind calendars, and Hidden calendars created with hide_names, hide other participants' names. */
function membersNamesHidden(array $calRow): bool {
    $priv = (int)($calRow['is_private'] ?? 0);
    return $priv === 2 || ($priv === 1 && (int)($calRow['hide_names'] ?? 0) === 1);
}
