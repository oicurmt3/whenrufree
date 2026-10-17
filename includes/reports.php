<?php
/**
 * includes/reports.php - Reporting a person on a calendar.
 *
 * There are two audiences, decided by who is involved (see reportAudienceFor()):
 *  - 'organiser': a member reporting another member. The calendar's organiser decides it.
 *  - 'super':     anything involving the organiser (a member reporting them, or an organiser
 *                 reporting someone). The super admin queue decides it.
 *
 * A report keeps a snapshot of the name the person was using, the reporter's name on that
 * calendar, the account the target belonged to, the calendar title and the reason, so it can be
 * reviewed later even if the person, the calendar or the account has since been removed.
 * Reports never store a username: the private username is only looked up live for the super
 * admin's own screens. Reasons are a fixed list so the panel can group them.
 *
 * Needs migrations/011_report_users.sql and migrations/016_report_audience.sql. Until 016 runs,
 * reportsTablesReady() is false, the new member reporting is not offered and the organiser's own
 * reporting is not offered either (blocking still works).
 */

declare(strict_types=1);

const REPORTS_MAX_DETAILS = 200;
const REPORTS_DEFAULT_LIMIT = 200;
const REPORTS_AUDIENCE_ORGANISER = 'organiser';
const REPORTS_AUDIENCE_SUPER = 'super';

/** The reasons a report can carry: key => label. First entry is the default. */
function reportReasons(): array {
    return [
        'inappropriate_name' => 'Inappropriate name',
        'behaviour' => 'Behaviour or conduct',
        'spam' => 'Spam or unwanted messages',
        'harassment' => 'Harassment or abuse',
        'impersonation' => 'Impersonation',
        'other' => 'Other',
    ];
}

/** True when $reason is one of reportReasons(). */
function reportReasonValid(string $reason): bool {
    return array_key_exists($reason, reportReasons());
}

/** Trim a free-text report detail to the column limit (null when empty). */
function reportCleanDetails(mixed $v): ?string {
    if (!is_string($v)) return null;
    $t = trim(preg_replace('/\s+/u', ' ', $v) ?? '');
    if ($t === '') return null;
    return mb_substr($t, 0, REPORTS_MAX_DETAILS);
}

/**
 * Who decides a report. Anything involving the organiser, on either side, goes to the super
 * admin: an organiser cannot arbitrate a complaint about themselves, and a member's report
 * about the organiser is exactly the one that must not be theirs to dismiss.
 */
function reportAudienceFor(string $reporterRole, string $targetRole): string {
    if ($reporterRole === 'admin' || $targetRole === 'admin') return REPORTS_AUDIENCE_SUPER;
    return REPORTS_AUDIENCE_ORGANISER;
}

/**
 * Record a report.
 *
 * @param array{
 *   calendar_id:int, user_id:?int, account_id:?int, reporter_account_id:int,
 *   reporter_user_id:?int, reporter_name:?string, display_name:?string,
 *   calendar_title:?string, target_role:string, audience:string, reason:string,
 *   details:?string
 * } $r
 * @return int the new report id
 */
function reportCreate(PDO $pdo, array $r): int {
    $stmt = $pdo->prepare(
        "INSERT INTO reports
            (calendar_id, user_id, account_id, reporter_account_id, reporter_user_id,
             reporter_name, display_name, calendar_title, target_role, audience, reason,
             details, status, created_at)
         VALUES
            (:cid, :uid, :aid, :rid, :ruid, :rname, :name, :ctitle, :trole, :audience, :reason,
             :details, 'open', :now)"
    );
    $stmt->execute([
        ':cid' => (int)$r['calendar_id'],
        ':uid' => $r['user_id'] !== null ? (int)$r['user_id'] : null,
        ':aid' => $r['account_id'] !== null ? (int)$r['account_id'] : null,
        ':rid' => (int)$r['reporter_account_id'],
        ':ruid' => $r['reporter_user_id'] !== null ? (int)$r['reporter_user_id'] : null,
        ':rname' => reportsShortName($r['reporter_name'] ?? null),
        ':name' => reportsShortName($r['display_name'] ?? null),
        ':ctitle' => reportsShortTitle($r['calendar_title'] ?? null),
        ':trole' => (string)$r['target_role'] === 'admin' ? 'admin' : 'user',
        ':audience' => (string)$r['audience'] === REPORTS_AUDIENCE_ORGANISER
            ? REPORTS_AUDIENCE_ORGANISER
            : REPORTS_AUDIENCE_SUPER,
        ':reason' => (string)$r['reason'],
        ':details' => $r['details'] ?? null,
        ':now' => accountNow(),
    ]);
    return (int)$pdo->lastInsertId();
}

/** Names are snapshots, not identities: clamp to the users.display_name size. */
function reportsShortName(?string $v): ?string {
    if ($v === null) return null;
    $t = trim($v);
    return $t === '' ? null : mb_substr($t, 0, 40);
}

/** Calendar titles are snapshotted too, for reports that outlive the calendar. */
function reportsShortTitle(?string $v): ?string {
    if ($v === null) return null;
    $t = trim($v);
    return $t === '' ? null : mb_substr($t, 0, 100);
}

/** How many reports are still open for the super admin (badge). */
function reportsOpenCount(PDO $pdo): int {
    if (!reportsTablesReady($pdo)) return 0;
    $n = $pdo->query("SELECT COUNT(*) FROM reports WHERE status = 'open'")->fetchColumn();
    return $n === false ? 0 : (int)$n;
}

/** How many reports on this calendar are waiting for its organiser (badge). */
function reportsOpenCountForCalendar(PDO $pdo, int $calendarId): int {
    if (!reportsTablesReady($pdo)) return 0;
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM reports
         WHERE calendar_id = :cid AND audience = 'organiser' AND status = 'open'"
    );
    $stmt->execute([':cid' => $calendarId]);
    $n = $stmt->fetchColumn();
    return $n === false ? 0 : (int)$n;
}

/**
 * Reports for the super admin, newest first. Includes the reported person's private username
 * (super admin only) and the calendar title, so no lookup is needed in the panel.
 * @return list<array<string,mixed>>
 */
function reportList(PDO $pdo, int $limit = REPORTS_DEFAULT_LIMIT): array {
    if (!reportsTablesReady($pdo)) return [];
    $limit = max(1, min(500, $limit));
    $stmt = $pdo->prepare(
        "SELECT r.id, r.calendar_id, r.user_id, r.account_id, r.reporter_account_id,
                r.display_name, r.reason, r.details, r.status, r.created_at, r.decided_at,
                r.audience, r.target_role, r.reporter_name, r.outcome,
                COALESCE(c.title, r.calendar_title) AS calendar_title,
                c.token AS calendar_token,
                a.username AS account_username, a.display_name AS account_display_name,
                p.username AS reporter_username
         FROM reports r
         LEFT JOIN calendars c ON c.id = r.calendar_id
         LEFT JOIN accounts a ON a.id = r.account_id
         LEFT JOIN accounts p ON p.id = r.reporter_account_id
         ORDER BY (r.status = 'open') DESC, r.created_at DESC
         LIMIT {$limit}"
    );
    $stmt->execute();
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['id'] = (int)$row['id'];
        $row['calendar_id'] = (int)$row['calendar_id'];
        $row['user_id'] = $row['user_id'] !== null ? (int)$row['user_id'] : null;
        $row['account_id'] = $row['account_id'] !== null ? (int)$row['account_id'] : null;
        $out[] = $row;
    }
    return $out;
}

/**
 * Open reports waiting for this calendar's organiser, oldest first so the queue drains in order.
 * Deliberately carries no username or account: the organiser sees names on the calendar only.
 * @return list<array<string,mixed>>
 */
function reportListForOrganiser(PDO $pdo, int $calendarId): array {
    if (!reportsTablesReady($pdo)) return [];
    $stmt = $pdo->prepare(
        "SELECT id, user_id, display_name, reporter_user_id, reporter_name, target_role,
                reason, details, created_at
         FROM reports
         WHERE calendar_id = :cid AND audience = 'organiser' AND status = 'open'
         ORDER BY created_at ASC, id ASC
         LIMIT " . REPORTS_DEFAULT_LIMIT
    );
    $stmt->execute([':cid' => $calendarId]);
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['id'] = (int)$row['id'];
        $row['user_id'] = $row['user_id'] !== null ? (int)$row['user_id'] : null;
        $row['reporter_user_id'] = $row['reporter_user_id'] !== null ? (int)$row['reporter_user_id'] : null;
        $out[] = $row;
    }
    return $out;
}

/**
 * A report about this exact pair that is still open, or that was closed less than $days ago.
 * One open report per reporter and person stops a single person flooding the queue, and the
 * cooldown after a decision stops them immediately re-reporting whatever was dismissed.
 */
function reportRecentId(PDO $pdo, int $calendarId, int $reporterUserId, int $targetUserId, int $days): ?int {
    if (!reportsTablesReady($pdo)) return null;
    $stmt = $pdo->prepare(
        "SELECT id FROM reports
         WHERE calendar_id = :cid AND reporter_user_id = :ruid AND user_id = :uid
           AND (status = 'open' OR COALESCE(decided_at, created_at) > DATE_SUB(NOW(), INTERVAL :days DAY))
         ORDER BY (status = 'open') DESC, id DESC
         LIMIT 1"
    );
    $stmt->execute([
        ':cid' => $calendarId,
        ':ruid' => $reporterUserId,
        ':uid' => $targetUserId,
        ':days' => max(1, $days),
    ]);
    $id = $stmt->fetchColumn();
    return $id === false ? null : (int)$id;
}

/**
 * Close a report with the decision that closed it. Deleting the account is done by the caller
 * through accountDelete(), then this closes the report so the queue stays tidy.
 */
function reportClose(PDO $pdo, int $reportId, string $outcome = 'dismissed'): bool {
    if (!reportsTablesReady($pdo)) return false;
    $allowed = ['dismissed', 'blocked', 'removed', 'escalated'];
    if (!in_array($outcome, $allowed, true)) $outcome = 'dismissed';
    $stmt = $pdo->prepare(
        "UPDATE reports SET status = 'closed', outcome = :outcome, decided_at = :now
         WHERE id = :id AND status = 'open'"
    );
    $stmt->execute([':outcome' => $outcome, ':now' => accountNow(), ':id' => $reportId]);
    return $stmt->rowCount() > 0;
}

/**
 * Hand an organiser-audience report to the super admin. The report stays open, so it joins the
 * super admin queue; the calendar it came from keeps its title via the snapshot.
 */
function reportEscalate(PDO $pdo, int $reportId): bool {
    if (!reportsTablesReady($pdo)) return false;
    $stmt = $pdo->prepare(
        "UPDATE reports SET audience = 'super', outcome = 'escalated'
         WHERE id = :id AND status = 'open' AND audience = 'organiser'"
    );
    $stmt->execute([':id' => $reportId]);
    return $stmt->rowCount() > 0;
}

/** The report row, or null. */
function reportFind(PDO $pdo, int $reportId): ?array {
    if (!reportsTablesReady($pdo)) return null;
    $stmt = $pdo->prepare("SELECT * FROM reports WHERE id = :id LIMIT 1");
    $stmt->execute([':id' => $reportId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * Organiser-audience reports die with their calendar, because they are between two people on
 * it and the organiser inbox no longer exists. Super-audience reports are kept: deleting the
 * calendar must never be a way for an organiser to erase complaints about themselves.
 */
function reportsDeleteForCalendar(PDO $pdo, int $calendarId): void {
    if (!reportsTablesReady($pdo)) return;
    $pdo->prepare(
        "DELETE FROM reports WHERE calendar_id = :cid AND audience = 'organiser'"
    )->execute([':cid' => $calendarId]);
}
