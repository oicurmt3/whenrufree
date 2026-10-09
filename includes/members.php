<?php
/**
 * includes/members.php - Invite only calendars and Hubs, blocked people and private names.
 *
 * Invite only is chosen once when a calendar or Hub is created. People with the link tap
 * "Request access" (one row per account in access_requests) and the organiser approves or
 * declines. A calendar inside an Invite only Hub is gated by the Hub: requests go to the Hub
 * organiser and Hub approval opens every calendar in it. Approval only opens the gate; the
 * person then joins with the normal join modal.
 *
 * Blocking: users.blocked pauses one person on one calendar (any calendar); an access_requests
 * row with status 'blocked' pauses an approved person on a whole Invite only Hub.
 *
 * Private names: on Blind calendars, and Hidden calendars created with hide_names, participants
 * only see themselves, the organisers and a count.
 *
 * Needs migrations/009_invite_only.sql; until it runs, nothing is gated.
 * Relies on respond(), clientIp(), logSecurityEvent() and the accounts / access helpers.
 */

declare(strict_types=1);

const MEMBERS_MAX_PENDING = 200;
const MEMBERS_REQUESTS_PER_HOUR = 10;
const MEMBERS_PENDING_DAYS = 30;

/** True when the columns and table from migration 009 exist. */
function membersTablesReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT invite_only, hide_names FROM calendars LIMIT 0');
            $pdo->query('SELECT invite_only FROM `groups` LIMIT 0');
            $pdo->query('SELECT blocked FROM users LIMIT 0');
            $pdo->query('SELECT status FROM access_requests LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

function membersNow(int $offsetSeconds = 0): string {
    return date('Y-m-d H:i:s', time() + $offsetSeconds);
}

function membersValidKind(string $kind): string {
    if ($kind !== 'calendar' && $kind !== 'group') {
        throw new InvalidArgumentException('Unknown request kind');
    }
    return $kind;
}

// -------------------------
// Subjects
// -------------------------

/** Calendar row for the gate: id, title, group_id, invite_only and its Hub's. */
function membersCalendarRow(PDO $pdo, string $token): ?array {
    $stmt = $pdo->prepare(
        "SELECT c.id, c.title, c.group_id, c.invite_only,
                g.invite_only AS group_invite_only, g.title AS group_title
         FROM calendars c
         LEFT JOIN `groups` g ON g.id = c.group_id
         WHERE c.token = :t"
    );
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function membersGroupRow(PDO $pdo, string $token): ?array {
    $stmt = $pdo->prepare("SELECT id, title, invite_only FROM `groups` WHERE token = :t");
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * Which subject owns the Invite only gate: an Invite only Hub first (so Hub approval covers
 * every calendar in it), else the calendar itself. Null when the target is not Invite only.
 * @return array{kind:string, id:int, title:string}|null
 */
function membersRequirement(string $kind, array $row): ?array {
    if ($kind === 'group') {
        return (int)($row['invite_only'] ?? 0) === 1
            ? ['kind' => 'group', 'id' => (int)$row['id'], 'title' => (string)($row['title'] ?? '')]
            : null;
    }
    if (!empty($row['group_id']) && (int)($row['group_invite_only'] ?? 0) === 1) {
        return ['kind' => 'group', 'id' => (int)$row['group_id'], 'title' => (string)($row['group_title'] ?? '')];
    }
    if ((int)($row['invite_only'] ?? 0) === 1) {
        return ['kind' => 'calendar', 'id' => (int)$row['id'], 'title' => (string)($row['title'] ?? '')];
    }
    return null;
}

/** The account's request status on a subject: pending, approved, declined, blocked or null. */
function membersRequestStatus(PDO $pdo, string $kind, int $id, int $accountId): ?string {
    $stmt = $pdo->prepare(
        "SELECT status FROM access_requests WHERE kind = :k AND subject_id = :sid AND account_id = :aid LIMIT 1"
    );
    $stmt->execute([':k' => membersValidKind($kind), ':sid' => $id, ':aid' => $accountId]);
    $status = $stmt->fetchColumn();
    return $status === false ? null : (string)$status;
}

function membersIsHubOrganiser(PDO $pdo, int $groupId, int $accountId): bool {
    if ($groupId <= 0) return false;
    $stmt = $pdo->prepare("SELECT 1 FROM `groups` WHERE id = :gid AND organiser_account_id = :aid LIMIT 1");
    $stmt->execute([':gid' => $groupId, ':aid' => $accountId]);
    return (bool)$stmt->fetchColumn();
}

/** The account's name on a calendar with its blocked flag, or null. */
function membersCalendarUser(PDO $pdo, int $calendarId, int $accountId): ?array {
    $stmt = $pdo->prepare(
        "SELECT id, role, blocked FROM users WHERE calendar_id = :cid AND account_id = :aid LIMIT 1"
    );
    $stmt->execute([':cid' => $calendarId, ':aid' => $accountId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    return ['id' => (int)$row['id'], 'role' => (string)$row['role'], 'blocked' => (int)$row['blocked'] === 1];
}

/**
 * Gate decision for an account: 'ok', 'blocked', or the request state 'none', 'pending' or
 * 'declined' when an Invite only subject still needs approval.
 */
function membersDecide(PDO $pdo, string $kind, array $row, int $accountId): string {
    $groupId = $kind === 'group' ? (int)$row['id'] : (int)($row['group_id'] ?? 0);
    if (membersIsHubOrganiser($pdo, $groupId, $accountId)) return 'ok';
    if ($groupId > 0 && membersRequestStatus($pdo, 'group', $groupId, $accountId) === 'blocked') return 'blocked';

    if ($kind === 'calendar') {
        $user = membersCalendarUser($pdo, (int)$row['id'], $accountId);
        if ($user !== null) return $user['blocked'] ? 'blocked' : 'ok';
    }

    $req = membersRequirement($kind, $row);
    if ($req === null) return 'ok';
    $status = membersRequestStatus($pdo, $req['kind'], $req['id'], $accountId);
    if ($status === null && $kind === 'calendar' && $req['kind'] === 'group' && (int)($row['invite_only'] ?? 0) === 1) {
        // Approved on the calendar itself before it joined an Invite only Hub.
        if (membersRequestStatus($pdo, 'calendar', (int)$row['id'], $accountId) === 'approved') return 'ok';
    }
    if ($status === 'approved') return 'ok';
    if ($status === 'blocked') return 'blocked';
    return $status ?? 'none';
}

/** Resolve the request target (?c=, ?g= or a POSTed group_token) to [kind, row], or null. */
function membersResolveTarget(PDO $pdo, string $action): ?array {
    $target = accessRequestTarget($action);
    if ($target === null) return null;
    [$kind, $token] = $target;
    $row = $kind === 'calendar' ? membersCalendarRow($pdo, $token) : membersGroupRow($pdo, $token);
    return $row ? [$kind, $row] : null;
}

function membersRespondBlocked(string $kind): void {
    respond(403, [
        'status' => 'error',
        'code' => 'BLOCKED',
        'message' => $kind === 'group'
            ? 'The organiser has paused your access to this Hub.'
            : 'The organiser has paused your access to this calendar.',
        'invite' => ['kind' => $kind === 'group' ? 'hub' : 'calendar', 'status' => 'blocked'],
    ]);
}

/**
 * Central gate, run after accessGate. Calendars and Hubs that are Invite only (or inside an
 * Invite only Hub) need approval; blocked people are refused everywhere on that calendar/Hub.
 */
function membersGate(PDO $pdo, string $action): void {
    static $exempt = ['csrf_token', 'diag', 'access_check', 'request_access', 'cancel_access_request', 'remove_calendar_from_group'];
    if (in_array($action, $exempt, true) || str_starts_with($action, 'admin_')) return;
    if (!accountsTablesReady($pdo) || !membersTablesReady($pdo)) return;

    $resolved = membersResolveTarget($pdo, $action);
    if ($resolved === null) return;
    [$kind, $row] = $resolved;

    $acct = accountCurrent($pdo);
    if ($acct === null || $acct['needs_setup']) return;

    $decision = membersDecide($pdo, $kind, $row, $acct['id']);
    if ($decision === 'ok') return;
    if ($decision === 'blocked') membersRespondBlocked($kind);

    $req = membersRequirement($kind, $row);
    $isHub = ($req['kind'] ?? $kind) === 'group';
    respond(403, [
        'status' => 'error',
        'code' => 'INVITE_ONLY',
        'message' => $isHub ? 'This Hub is invite only.' : 'This calendar is invite only.',
        'invite' => [
            'kind' => $isHub ? 'hub' : 'calendar',
            'status' => $decision,
            'title' => (string)($req['title'] ?? ''),
            'profile_name' => (string)($acct['display_name'] ?? ''),
        ],
    ]);
}

// -------------------------
// Requests
// -------------------------

/** Create a pending request (or keep the existing one). Returns the resulting status. */
function membersRequestCreate(PDO $pdo, array $req, array $acct): string {
    $pdo->prepare(
        "INSERT IGNORE INTO access_requests (kind, subject_id, account_id, display_name, status, created_at)
         VALUES (:k, :sid, :aid, :dn, 'pending', :now)"
    )->execute([
        ':k' => membersValidKind($req['kind']),
        ':sid' => $req['id'],
        ':aid' => $acct['id'],
        ':dn' => mb_substr((string)$acct['display_name'], 0, 40),
        ':now' => membersNow(),
    ]);
    return membersRequestStatus($pdo, $req['kind'], $req['id'], $acct['id']) ?? 'pending';
}

function membersPendingCount(PDO $pdo, string $kind, int $id): int {
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM access_requests WHERE kind = :k AND subject_id = :sid AND status = 'pending'"
    );
    $stmt->execute([':k' => membersValidKind($kind), ':sid' => $id]);
    return (int)$stmt->fetchColumn();
}

/** Requests on a subject, grouped by status (profile names only). */
function membersRequestLists(PDO $pdo, string $kind, int $id): array {
    $stmt = $pdo->prepare(
        "SELECT id, display_name, status, created_at, decided_at FROM access_requests
         WHERE kind = :k AND subject_id = :sid
         ORDER BY created_at ASC, id ASC"
    );
    $stmt->execute([':k' => membersValidKind($kind), ':sid' => $id]);
    $out = ['pending' => [], 'approved' => [], 'declined' => [], 'blocked' => []];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $status = (string)$r['status'];
        if (!isset($out[$status])) continue;
        $out[$status][] = [
            'id' => (int)$r['id'],
            'display_name' => (string)$r['display_name'],
            'created_at' => (string)$r['created_at'],
            'decided_at' => $r['decided_at'] !== null ? (string)$r['decided_at'] : null,
        ];
    }
    return $out;
}

/** True when the account organises the subject (calendar organiser role, or Hub organiser). */
function membersIsOrganiserOf(PDO $pdo, string $kind, int $id, int $accountId): bool {
    if ($kind === 'group') return membersIsHubOrganiser($pdo, $id, $accountId);
    $user = membersCalendarUser($pdo, $id, $accountId);
    return $user !== null && $user['role'] === 'admin';
}

/**
 * The subject whose requests the signed-in organiser of ?c= or ?g= manages. A calendar inside an
 * Invite only Hub is managed by the Hub organiser, so its calendar organiser gets a 200 with
 * managed_by 'hub' and no lists. Responds and exits unless the caller may manage requests.
 * @return array{0: array, 1: array{kind:string, id:int, title:string}}
 */
function membersOrganiserSubject(PDO $pdo, string $action): array {
    $acct = requireAccount($pdo);
    if (!membersTablesReady($pdo)) respond(503, ['status' => 'error', 'message' => 'Invite only is not available yet']);
    $resolved = membersResolveTarget($pdo, $action);
    if ($resolved === null) respond(404, ['status' => 'error', 'message' => 'Not found']);
    [$kind, $row] = $resolved;
    $req = membersRequirement($kind, $row);
    if ($req === null) respond(200, ['status' => 'success', 'invite_only' => false]);
    if (!membersIsOrganiserOf($pdo, $req['kind'], $req['id'], $acct['id'])) {
        if ($kind === 'calendar' && $req['kind'] === 'group' && membersIsOrganiserOf($pdo, 'calendar', (int)$row['id'], $acct['id'])) {
            respond(200, ['status' => 'success', 'invite_only' => true, 'managed_by' => 'hub']);
        }
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can see requests']);
    }
    return [$acct, $req];
}

/**
 * Apply an organiser's decision. approve: any state -> approved; decline: pending/approved ->
 * declined; block / unblock: Hub approvals only. Returns false when the move is not allowed.
 */
function membersDecideRequest(PDO $pdo, int $requestId, string $decision): bool {
    $to = ['approve' => 'approved', 'decline' => 'declined', 'block' => 'blocked', 'unblock' => 'approved'][$decision] ?? null;
    if ($to === null) return false;
    $from = [
        'approve' => ['pending', 'declined', 'blocked'],
        'decline' => ['pending', 'approved'],
        'block' => ['approved'],
        'unblock' => ['blocked'],
    ][$decision];
    $stmt = $pdo->prepare("SELECT kind, status FROM access_requests WHERE id = :id");
    $stmt->execute([':id' => $requestId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || !in_array((string)$row['status'], $from, true)) return false;
    if (($decision === 'block' || $decision === 'unblock') && $row['kind'] !== 'group') return false;
    $pdo->prepare("UPDATE access_requests SET status = :s, decided_at = :now WHERE id = :id")
        ->execute([':s' => $to, ':now' => membersNow(), ':id' => $requestId]);
    return true;
}

function membersApproveAll(PDO $pdo, string $kind, int $id): int {
    $stmt = $pdo->prepare(
        "UPDATE access_requests SET status = 'approved', decided_at = :now
         WHERE kind = :k AND subject_id = :sid AND status = 'pending'"
    );
    $stmt->execute([':now' => membersNow(), ':k' => membersValidKind($kind), ':sid' => $id]);
    return $stmt->rowCount();
}

/** Delete every request on a calendar or Hub (when it is deleted). */
function membersForgetSubject(PDO $pdo, string $kind, int $id): void {
    if (!membersTablesReady($pdo)) return;
    $pdo->prepare("DELETE FROM access_requests WHERE kind = :k AND subject_id = :sid")
        ->execute([':k' => membersValidKind($kind), ':sid' => $id]);
}

/** Delete one account's request on a calendar (when the organiser deletes their name). */
function membersForgetCalendarAccount(PDO $pdo, int $calendarId, ?int $accountId): void {
    if ($accountId === null || !membersTablesReady($pdo)) return;
    $pdo->prepare("DELETE FROM access_requests WHERE kind = 'calendar' AND subject_id = :sid AND account_id = :aid")
        ->execute([':sid' => $calendarId, ':aid' => $accountId]);
}

/** The account's own pending and declined requests, for the profile page. */
function membersAccountRequests(PDO $pdo, int $accountId): array {
    if (!membersTablesReady($pdo)) return [];
    $stmt = $pdo->prepare(
        "SELECT r.kind, r.status, r.created_at,
                c.token AS cal_token, c.title AS cal_title,
                g.token AS group_token, g.title AS group_title
         FROM access_requests r
         LEFT JOIN calendars c ON r.kind = 'calendar' AND c.id = r.subject_id
         LEFT JOIN `groups` g ON r.kind = 'group' AND g.id = r.subject_id
         WHERE r.account_id = :aid AND r.status IN ('pending', 'declined')
         ORDER BY r.created_at DESC"
    );
    $stmt->execute([':aid' => $accountId]);
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $isHub = $r['kind'] === 'group';
        $token = $isHub ? $r['group_token'] : $r['cal_token'];
        if ($token === null) continue;
        $out[] = [
            'kind' => $isHub ? 'hub' : 'calendar',
            'token' => (string)$token,
            'title' => (string)(($isHub ? $r['group_title'] : $r['cal_title']) ?? ''),
            'status' => (string)$r['status'],
            'created_at' => (string)$r['created_at'],
        ];
    }
    return $out;
}

// -------------------------
// Private names
// -------------------------

/** Blind calendars, and Hidden calendars created with hide_names, hide other participants' names. */
function membersNamesHidden(array $calRow): bool {
    $priv = (int)($calRow['is_private'] ?? 0);
    return $priv === 2 || ($priv === 1 && (int)($calRow['hide_names'] ?? 0) === 1);
}
