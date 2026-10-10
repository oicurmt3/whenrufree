<?php
/**
 * includes/reports.php - Reporting a person to the super admin.
 *
 * When a calendar organiser blocks someone, they can report them at the same time (Report and
 * block). A report keeps a snapshot of the name the person was using, the account it belonged
 * to, the calendar and the reason, so a super admin can review it later even if the person has
 * since been removed. Blocking on its own never creates a report.
 *
 * Reports never store a username: the private username is only looked up live for the super
 * admin's own screens. Reasons are a fixed list so the panel can group them.
 *
 * Needs migrations/011_report_users.sql. Until it runs, blocking still works and the report
 * option is not offered (see reportsTablesReady() in includes/data.php).
 */

declare(strict_types=1);

const REPORTS_MAX_DETAILS = 200;
const REPORTS_DEFAULT_LIMIT = 200;

/** The reasons the block modal offers: key => label. First entry is the default. */
function reportReasons(): array {
    return [
        'inappropriate_name' => 'Inappropriate name',
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
 * Record a report. Called together with blocking; the person stays on the calendar.
 * @return int the new report id
 */
function reportCreate(
    PDO $pdo,
    int $calendarId,
    ?int $userId,
    ?int $accountId,
    int $reporterAccountId,
    ?string $displayName,
    string $reason,
    ?string $details
): int {
    $stmt = $pdo->prepare(
        "INSERT INTO reports
            (calendar_id, user_id, account_id, reporter_account_id, display_name, reason, details, status, created_at)
         VALUES
            (:cid, :uid, :aid, :rid, :name, :reason, :details, 'open', :now)"
    );
    $stmt->execute([
        ':cid' => $calendarId,
        ':uid' => $userId,
        ':aid' => $accountId,
        ':rid' => $reporterAccountId,
        ':name' => $displayName !== null ? mb_substr($displayName, 0, 40) : null,
        ':reason' => $reason,
        ':details' => $details,
        ':now' => accountNow(),
    ]);
    return (int)$pdo->lastInsertId();
}

/** How many reports are still open (super admin badge). */
function reportsOpenCount(PDO $pdo): int {
    if (!reportsTablesReady($pdo)) return 0;
    $n = $pdo->query("SELECT COUNT(*) FROM reports WHERE status = 'open'")->fetchColumn();
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
                c.title AS calendar_title, c.token AS calendar_token,
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
 * Close a report ('dismiss'). Deleting the account is done by the caller through accountDelete(),
 * then this closes the report so the queue stays tidy.
 */
function reportClose(PDO $pdo, int $reportId): bool {
    if (!reportsTablesReady($pdo)) return false;
    $stmt = $pdo->prepare("UPDATE reports SET status = 'closed', decided_at = :now WHERE id = :id AND status = 'open'");
    $stmt->execute([':now' => accountNow(), ':id' => $reportId]);
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
