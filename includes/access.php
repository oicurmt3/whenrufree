<?php
/**
 * includes/access.php - Optional access emoji for calendars and Hubs.
 *
 * An organiser can pick one of ACCESS_EMOJI_COUNT emoji (stored as its position 0-34). Anyone
 * opening the link must pick the same emoji first. A calendar without its own emoji uses its
 * Hub's emoji. A correct pick is remembered for the signed-in account (account_access), so it
 * is asked once per account on any device. It also returns a random grant token (stored only as
 * a SHA-256 hash) that the browser sends back in the X-Access-Grant header; a Hub grant also
 * opens every calendar in that Hub. Organisers and people who already have a name on the
 * calendar are never asked. Changing or removing an emoji deletes its grants.
 *
 * Wrong picks are limited per IP address and subject (max_attempts, then an escalating lock
 * from schedule_minutes), per IP overall (global_per_hour), and requests for links that do not
 * exist are throttled per IP (not_found_per_hour). Hourly counters live in api_rate_limit.
 *
 * Needs migrations/003_access_emoji.sql; until it runs, nothing is gated.
 * Relies on respond(), clientIp() and logSecurityEvent() from api.php.
 */

declare(strict_types=1);

const ACCESS_EMOJI_COUNT = 35;
const ACCESS_DEFAULT_MAX_ATTEMPTS = 3;
const ACCESS_DEFAULT_SCHEDULE = [5, 15, 120, 2880];
const ACCESS_DEFAULT_GLOBAL_PER_HOUR = 20;
const ACCESS_DEFAULT_NOT_FOUND_PER_HOUR = 30;
const ACCESS_DEFAULT_GRANT_DAYS = 30;
const ACCESS_MAX_GRANTS_PER_REQUEST = 3;

/** Normalise the optional 'access_emoji' config block. */
function accessConfig(array $config): array {
    $c = is_array($config['access_emoji'] ?? null) ? $config['access_emoji'] : [];
    $schedule = [];
    foreach ((array)($c['schedule_minutes'] ?? ACCESS_DEFAULT_SCHEDULE) as $m) {
        $m = (int)$m;
        if ($m > 0) $schedule[] = $m;
    }
    $pos = static fn ($v, int $def): int => ((int)$v > 0) ? (int)$v : $def;
    return [
        'max_attempts' => $pos($c['max_attempts'] ?? 0, ACCESS_DEFAULT_MAX_ATTEMPTS),
        'schedule_minutes' => $schedule ?: ACCESS_DEFAULT_SCHEDULE,
        'global_per_hour' => $pos($c['global_per_hour'] ?? 0, ACCESS_DEFAULT_GLOBAL_PER_HOUR),
        'not_found_per_hour' => $pos($c['not_found_per_hour'] ?? 0, ACCESS_DEFAULT_NOT_FOUND_PER_HOUR),
        'grant_days' => $pos($c['grant_days'] ?? 0, ACCESS_DEFAULT_GRANT_DAYS),
    ];
}

/** True when the columns and tables from migration 003 exist. */
function accessTablesReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT access_emoji FROM calendars LIMIT 0');
            $pdo->query('SELECT access_emoji FROM `groups` LIMIT 0');
            $pdo->query('SELECT token_hash FROM access_grants LIMIT 0');
            $pdo->query('SELECT lockout_level FROM access_attempts LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/**
 * Parse a submitted emoji position. Returns the position, null for "no emoji"
 * (null, '' or false), or false when the value is not a valid position.
 */
function accessEmojiValue(mixed $v): int|null|false {
    if ($v === null || $v === '' || $v === false) return null;
    if (is_int($v)) {
        $n = $v;
    } elseif (is_string($v) && preg_match('/^\d{1,2}$/', $v)) {
        $n = (int)$v;
    } else {
        return false;
    }
    return ($n >= 0 && $n < ACCESS_EMOJI_COUNT) ? $n : false;
}

function accessNow(int $offsetSeconds = 0): string {
    return date('Y-m-d H:i:s', time() + $offsetSeconds);
}

function accessValidKind(string $kind): string {
    if ($kind !== 'calendar' && $kind !== 'group') {
        throw new InvalidArgumentException('Unknown access kind');
    }
    return $kind;
}

// -------------------------
// Subjects and requirements
// -------------------------

/** Calendar row: id, group_id, access_emoji, group_emoji (emoji fields only when migrated). */
function accessCalendarRow(PDO $pdo, string $token): ?array {
    if (accessTablesReady($pdo)) {
        $stmt = $pdo->prepare(
            "SELECT c.id, c.group_id, c.access_emoji, g.access_emoji AS group_emoji
             FROM calendars c
             LEFT JOIN `groups` g ON g.id = c.group_id
             WHERE c.token = :t"
        );
    } else {
        $stmt = $pdo->prepare("SELECT id, group_id FROM calendars WHERE token = :t");
    }
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/** Hub row: id, access_emoji (emoji only when migrated). */
function accessGroupRow(PDO $pdo, string $token): ?array {
    $cols = accessTablesReady($pdo) ? 'id, access_emoji' : 'id';
    $stmt = $pdo->prepare("SELECT {$cols} FROM `groups` WHERE token = :t");
    $stmt->execute([':t' => $token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * Which emoji a calendar needs: its own, else its Hub's, else none.
 * @return array{kind:string, id:int, emoji:int, inherited:bool}|null
 */
function accessRequirementForCalendar(array $row): ?array {
    if (isset($row['access_emoji']) && $row['access_emoji'] !== null) {
        return ['kind' => 'calendar', 'id' => (int)$row['id'], 'emoji' => (int)$row['access_emoji'], 'inherited' => false];
    }
    if (!empty($row['group_id']) && isset($row['group_emoji']) && $row['group_emoji'] !== null) {
        return ['kind' => 'group', 'id' => (int)$row['group_id'], 'emoji' => (int)$row['group_emoji'], 'inherited' => true];
    }
    return null;
}

/** @return array{kind:string, id:int, emoji:int, inherited:bool}|null */
function accessRequirementForGroup(array $row): ?array {
    if (isset($row['access_emoji']) && $row['access_emoji'] !== null) {
        return ['kind' => 'group', 'id' => (int)$row['id'], 'emoji' => (int)$row['access_emoji'], 'inherited' => false];
    }
    return null;
}

/** Grants that open a calendar: its own, or its Hub's. */
function accessAllowedForCalendar(array $row): array {
    $allowed = [['calendar', (int)$row['id']]];
    if (!empty($row['group_id'])) $allowed[] = ['group', (int)$row['group_id']];
    return $allowed;
}

/** Public summary for calendar_meta / group_meta (never includes the emoji itself). */
function accessPublicInfo(PDO $pdo, ?array $req): array {
    return [
        'available' => accessTablesReady($pdo),
        'enabled' => $req !== null,
        'inherited' => $req !== null && $req['inherited'],
    ];
}

// -------------------------
// Grants
// -------------------------

/** Up to ACCESS_MAX_GRANTS_PER_REQUEST well-formed grant tokens from the X-Access-Grant header. */
function accessGrantTokensFromHeader(): array {
    $raw = (string)($_SERVER['HTTP_X_ACCESS_GRANT'] ?? '');
    if ($raw === '') return [];
    $out = [];
    foreach (explode(',', $raw) as $part) {
        $part = strtolower(trim($part));
        if (preg_match('/^[a-f0-9]{64}$/', $part) && !in_array($part, $out, true)) {
            $out[] = $part;
            if (count($out) >= ACCESS_MAX_GRANTS_PER_REQUEST) break;
        }
    }
    return $out;
}

/**
 * True when any token is an unexpired grant for one of $allowed.
 * @param list<string> $tokens
 * @param list<array{0:string,1:int}> $allowed
 */
function accessGrantValid(PDO $pdo, array $tokens, array $allowed): bool {
    if (!$tokens || !$allowed) return false;
    $params = [':now' => accessNow()];
    $ph = [];
    foreach (array_values($tokens) as $i => $tok) {
        $ph[] = ":h{$i}";
        $params[":h{$i}"] = hash('sha256', $tok);
    }
    $stmt = $pdo->prepare(
        'SELECT kind, subject_id FROM access_grants
         WHERE token_hash IN (' . implode(',', $ph) . ') AND expires_at > :now'
    );
    $stmt->execute($params);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $g) {
        foreach ($allowed as [$kind, $id]) {
            if ($g['kind'] === $kind && (int)$g['subject_id'] === $id) return true;
        }
    }
    return false;
}

/** @return array{access_grant:string, expires_at:string} */
function accessGrantIssue(PDO $pdo, string $kind, int $id, int $days): array {
    $token = bin2hex(random_bytes(32));
    $expires = accessNow($days * 86400);
    $pdo->prepare(
        "INSERT INTO access_grants (kind, subject_id, token_hash, created_at, expires_at)
         VALUES (:k, :sid, :h, :now, :exp)"
    )->execute([
        ':k' => accessValidKind($kind),
        ':sid' => $id,
        ':h' => hash('sha256', $token),
        ':now' => accessNow(),
        ':exp' => $expires,
    ]);
    return ['access_grant' => $token, 'expires_at' => gmdate('c', strtotime($expires))];
}

function accessGrantRevoke(PDO $pdo, string $kind, int $id): void {
    $pdo->prepare("DELETE FROM access_grants WHERE kind = :k AND subject_id = :sid")
        ->execute([':k' => accessValidKind($kind), ':sid' => $id]);
}

/** Set or remove an emoji: every existing grant and wrong-pick counter for it is dropped. */
function accessSetEmoji(PDO $pdo, string $kind, int $id, ?int $emoji): void {
    $table = accessValidKind($kind) === 'calendar' ? 'calendars' : '`groups`';
    $pdo->prepare("UPDATE {$table} SET access_emoji = :e WHERE id = :id")
        ->execute([':e' => $emoji, ':id' => $id]);
    accessGrantRevoke($pdo, $kind, $id);
    accountAccessRevoke($pdo, $kind, $id);
    $pdo->prepare("DELETE FROM access_attempts WHERE kind = :k AND subject_id = :sid")
        ->execute([':k' => $kind, ':sid' => $id]);
}

// -------------------------
// Wrong-pick limits
// -------------------------

/**
 * Seconds left on this IP's lock for the subject (0 when free). An expired lock is cleared
 * but the level is kept, so the next lock is longer.
 */
function accessAttemptCheck(PDO $pdo, string $ip, string $kind, int $id): int {
    $stmt = $pdo->prepare(
        "SELECT locked_until FROM access_attempts WHERE ip = :ip AND kind = :k AND subject_id = :sid"
    );
    $stmt->execute([':ip' => $ip, ':k' => $kind, ':sid' => $id]);
    $lockedUntil = $stmt->fetchColumn();
    if ($lockedUntil === false || $lockedUntil === null || $lockedUntil === '') return 0;

    $remaining = pinLockoutRemaining((string)$lockedUntil);
    if ($remaining > 0) return $remaining;

    $pdo->prepare(
        "UPDATE access_attempts SET failed_attempts = 0, locked_until = NULL
         WHERE ip = :ip AND kind = :k AND subject_id = :sid AND locked_until = :lu"
    )->execute([':ip' => $ip, ':k' => $kind, ':sid' => $id, ':lu' => $lockedUntil]);
    return 0;
}

/**
 * Record a wrong pick.
 * @return array{locked_minutes:?int, left:int} locked_minutes is set when this pick started a lock.
 */
function accessAttemptFail(PDO $pdo, string $ip, string $kind, int $id, array $cfg): array {
    $key = [':ip' => $ip, ':k' => accessValidKind($kind), ':sid' => $id];
    $now = accessNow();

    $upd = $pdo->prepare(
        "UPDATE access_attempts SET failed_attempts = failed_attempts + 1, updated_at = :now
         WHERE ip = :ip AND kind = :k AND subject_id = :sid"
    );
    $upd->execute($key + [':now' => $now]);
    if ($upd->rowCount() === 0) {
        try {
            $pdo->prepare(
                "INSERT INTO access_attempts (ip, kind, subject_id, failed_attempts, locked_until, lockout_level, updated_at)
                 VALUES (:ip, :k, :sid, 1, NULL, 0, :now)"
            )->execute($key + [':now' => $now]);
        } catch (PDOException $e) {
            $upd->execute($key + [':now' => $now]);
        }
    }

    $stmt = $pdo->prepare(
        "SELECT failed_attempts, lockout_level FROM access_attempts
         WHERE ip = :ip AND kind = :k AND subject_id = :sid"
    );
    $stmt->execute($key);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $max = (int)$cfg['max_attempts'];
    $failed = (int)($row['failed_attempts'] ?? 0);
    if ($failed < $max) return ['locked_minutes' => null, 'left' => $max - $failed];

    $schedule = $cfg['schedule_minutes'];
    $steps = count($schedule);
    $level = max(0, (int)$row['lockout_level']);
    $mins = (int)$schedule[min($level, $steps - 1)];

    // Only one concurrent request may escalate: the level must still be what we read.
    $lock = $pdo->prepare(
        "UPDATE access_attempts
         SET failed_attempts = 0, lockout_level = :next, locked_until = :until, updated_at = :now
         WHERE ip = :ip AND kind = :k AND subject_id = :sid AND failed_attempts >= :max AND lockout_level = :level"
    );
    $lock->execute($key + [
        ':next' => min($level + 1, $steps),
        ':until' => accessNow($mins * 60),
        ':now' => $now,
        ':max' => $max,
        ':level' => $level,
    ]);
    return ['locked_minutes' => $lock->rowCount() > 0 ? $mins : null, 'left' => 0];
}

function accessAttemptReset(PDO $pdo, string $ip, string $kind, int $id): void {
    $pdo->prepare("DELETE FROM access_attempts WHERE ip = :ip AND kind = :k AND subject_id = :sid")
        ->execute([':ip' => $ip, ':k' => $kind, ':sid' => $id]);
}

/** Current value of an hourly per-IP counter in api_rate_limit. */
function accessCounterGet(PDO $pdo, string $ip, string $key): int {
    $stmt = $pdo->prepare("SELECT count FROM api_rate_limit WHERE ip = :ip AND minute_key = :mk");
    $stmt->execute([':ip' => $ip, ':mk' => $key]);
    return (int)($stmt->fetchColumn() ?: 0);
}

function accessCounterBump(PDO $pdo, string $ip, string $key): void {
    $params = [':ip' => $ip, ':mk' => $key];
    $upd = $pdo->prepare(
        "UPDATE api_rate_limit SET count = count + 1, updated_at = NOW() WHERE ip = :ip AND minute_key = :mk"
    );
    $upd->execute($params);
    if ($upd->rowCount() > 0) return;
    try {
        $pdo->prepare(
            "INSERT INTO api_rate_limit (ip, minute_key, count, updated_at) VALUES (:ip, :mk, 1, NOW())"
        )->execute($params);
    } catch (PDOException $e) {
        $upd->execute($params);
    }
}

function accessWrongPickKey(): string { return 'aw' . gmdate('YmdH'); }
function accessNotFoundKey(): string { return 'nf' . gmdate('YmdH'); }

function accessSecondsToNextHour(): int {
    return 3600 - (time() % 3600);
}

// -------------------------
// Request handling
// -------------------------

/**
 * The calendar or Hub a request targets: ?c= wins over ?g= (calendar links opened from a Hub
 * carry both), then a POSTed group_token when creating a calendar inside a Hub.
 * @return array{0:string,1:string}|null [kind, token]
 */
function accessRequestTarget(string $action): ?array {
    $valid = static fn ($t): bool => is_string($t) && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $t) === 1;
    if (isset($_GET['c'])) {
        return $valid($_GET['c']) ? ['calendar', (string)$_GET['c']] : null;
    }
    if (isset($_GET['g'])) {
        return $valid($_GET['g']) ? ['group', (string)$_GET['g']] : null;
    }
    if ($action === 'create_calendar') {
        $gt = trim((string)($_POST['group_token'] ?? ''));
        return $valid($gt) ? ['group', $gt] : null;
    }
    return null;
}

/** Respond 429 once this IP has asked for too many links that do not exist this hour. */
function accessNotFoundThrottle(PDO $pdo, array $cfg): void {
    $ip = clientIp();
    if (accessCounterGet($pdo, $ip, accessNotFoundKey()) >= $cfg['not_found_per_hour']) {
        logSecurityEvent('NOT_FOUND_THROTTLED', []);
        respond(429, [
            'status' => 'error',
            'message' => 'Too many links that do not exist. Try again later.',
            'retry_after' => accessSecondsToNextHour(),
        ]);
    }
}

/**
 * Look up the request target. Returns [kind, row, requirement, allowed grants], or null when
 * there is no target. A target that does not exist counts towards the wrong-link throttle.
 */
function accessResolveTarget(PDO $pdo, array $cfg, string $action): ?array {
    $target = accessRequestTarget($action);
    if ($target === null) return null;
    accessNotFoundThrottle($pdo, $cfg);

    [$kind, $token] = $target;
    $row = $kind === 'calendar' ? accessCalendarRow($pdo, $token) : accessGroupRow($pdo, $token);
    if (!$row) {
        accessCounterBump($pdo, clientIp(), accessNotFoundKey());
        return [$kind, null, null, []];
    }
    if ($kind === 'calendar') {
        return [$kind, $row, accessRequirementForCalendar($row), accessAllowedForCalendar($row)];
    }
    return [$kind, $row, accessRequirementForGroup($row), [['group', (int)$row['id']]]];
}

function accessRespondRequired(string $targetKind, array $req): void {
    $whose = $req['kind'] === 'group' ? 'hub' : 'calendar';
    respond(403, [
        'status' => 'error',
        'code' => 'ACCESS_REQUIRED',
        'message' => $targetKind === 'group' ? 'Pick the emoji to open this Hub.' : 'Pick the emoji to open this calendar.',
        'access' => ['kind' => $whose, 'inherited' => $req['inherited']],
    ]);
}

/**
 * Central gate, run before every action. Actions that name a calendar or Hub need a valid
 * grant when it has an emoji. A missing target is left for the action to report (404).
 * Exempt: access_check itself, super admin actions, and remove_calendar_from_group (it needs
 * the calendar or Hub organiser's account and returns no calendar data).
 */
function accessGate(PDO $pdo, array $config, string $action): void {
    static $exempt = ['csrf_token', 'diag', 'access_check', 'remove_calendar_from_group'];
    if (in_array($action, $exempt, true) || str_starts_with($action, 'admin_')) {
        return;
    }
    $resolved = accessResolveTarget($pdo, accessConfig($config), $action);
    if ($resolved === null) return;
    [$kind, $row, $req, $allowed] = $resolved;
    if ($row === null || $req === null) return;
    if (accessAccountAllowed($pdo, $kind, $row, $allowed)) return;
    if (accessGrantValid($pdo, accessGrantTokensFromHeader(), $allowed)) return;
    accessRespondRequired($kind, $req);
}

/**
 * True when the signed-in account needs no emoji here: it organises the calendar or Hub, has a
 * name on the calendar, or picked the right emoji before.
 */
function accessAccountAllowed(PDO $pdo, string $kind, array $row, array $allowed): bool {
    $acct = accountCurrent($pdo);
    if ($acct === null || !accountsTablesReady($pdo)) return false;
    $aid = $acct['id'];
    $groupId = $kind === 'group' ? (int)$row['id'] : (int)($row['group_id'] ?? 0);
    if ($kind === 'calendar' && accountCalendarUser($pdo, (int)$row['id'], $aid) !== null) return true;
    if ($groupId > 0) {
        $stmt = $pdo->prepare("SELECT 1 FROM `groups` WHERE id = :gid AND organiser_account_id = :aid LIMIT 1");
        $stmt->execute([':gid' => $groupId, ':aid' => $aid]);
        if ($stmt->fetchColumn()) return true;
    }
    return accountAccessValid($pdo, $aid, $allowed);
}

/** access_check: verify a picked emoji and issue a grant. CSRF is checked by the caller. */
function accessHandleCheck(PDO $pdo, array $config): void {
    $cfg = accessConfig($config);
    $resolved = accessResolveTarget($pdo, $cfg, 'access_check');
    if ($resolved === null) respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    [$kind, $row, $req] = $resolved;
    if ($row === null) {
        respond(404, ['status' => 'error', 'message' => $kind === 'group' ? 'Hub not found' : 'Calendar not found']);
    }
    if ($req === null) {
        respond(200, ['status' => 'success', 'access_grant' => null]);
    }

    $emoji = accessEmojiValue($_POST['emoji'] ?? null);
    if (!is_int($emoji)) respond(400, ['status' => 'error', 'message' => 'Pick an emoji.']);

    $ip = clientIp();
    $subject = ['kind' => $req['kind'], 'id' => $req['id']];

    if (accessCounterGet($pdo, $ip, accessWrongPickKey()) >= $cfg['global_per_hour']) {
        respond(429, [
            'status' => 'error',
            'code' => 'ACCESS_LOCKED',
            'message' => 'Too many wrong picks. Try again later.',
            'retry_after' => accessSecondsToNextHour(),
        ]);
    }

    $remaining = accessAttemptCheck($pdo, $ip, $req['kind'], $req['id']);
    if ($remaining > 0) {
        respond(429, [
            'status' => 'error',
            'code' => 'ACCESS_LOCKED',
            'message' => 'Too many wrong picks. Try again in ' . pinLockoutDuration($remaining) . '.',
            'retry_after' => $remaining,
        ]);
    }

    if ($emoji !== $req['emoji']) {
        accessCounterBump($pdo, $ip, accessWrongPickKey());
        $result = accessAttemptFail($pdo, $ip, $req['kind'], $req['id'], $cfg);
        logSecurityEvent('ACCESS_FAILED', $subject);
        if ($result['locked_minutes'] !== null) {
            logSecurityEvent('ACCESS_LOCKED', $subject + ['minutes' => $result['locked_minutes']]);
            respond(429, [
                'status' => 'error',
                'code' => 'ACCESS_LOCKED',
                'message' => 'Too many wrong picks. Try again in ' . pinLockoutDuration($result['locked_minutes'] * 60) . '.',
                'retry_after' => $result['locked_minutes'] * 60,
            ]);
        }
        $left = $result['left'];
        respond(401, [
            'status' => 'error',
            'code' => 'ACCESS_WRONG',
            'message' => $left > 0
                ? "That's not the right emoji. {$left} " . ($left === 1 ? 'try' : 'tries') . ' left.'
                : "That's not the right emoji.",
            'attempts_left' => $left,
        ]);
    }

    accessAttemptReset($pdo, $ip, $req['kind'], $req['id']);
    $acct = accountCurrent($pdo);
    if ($acct !== null) accountAccessGrant($pdo, $acct['id'], $req['kind'], $req['id']);
    $grant = accessGrantIssue($pdo, $req['kind'], $req['id'], $cfg['grant_days']);
    logSecurityEvent('ACCESS_GRANTED', $subject);
    respond(200, ['status' => 'success', 'kind' => $req['kind']] + $grant);
}
