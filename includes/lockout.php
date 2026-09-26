<?php
/**
 * includes/lockout.php - Escalating PIN lockout for calendar users and Hub organisers.
 *
 * After max_attempts wrong PINs in a row the account locks, each time for the next step of
 * schedule_minutes (default 5 min, 15 min, 2 hours, 2 days; the last step repeats). The
 * escalation level survives the lock expiring; a correct PIN, a passkey login or an admin
 * unlock resets it, and cleanup.php resets it after 30 days without a lockout.
 *
 * If migrations/002_escalating_lockout.sql has not been applied yet, a flat 15-minute lock
 * is used instead.
 *
 * Relies on respond() from api.php.
 */

declare(strict_types=1);

const PIN_LOCKOUT_DEFAULT_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_DEFAULT_SCHEDULE = [5, 15, 120, 2880];
const PIN_LOCKOUT_LEGACY_MINUTES = 15;

/** Normalise the optional 'pin_lockout' config block. */
function pinLockoutConfig(array $config): array {
    $c = is_array($config['pin_lockout'] ?? null) ? $config['pin_lockout'] : [];
    $max = (int)($c['max_attempts'] ?? PIN_LOCKOUT_DEFAULT_MAX_ATTEMPTS);
    $schedule = [];
    foreach ((array)($c['schedule_minutes'] ?? PIN_LOCKOUT_DEFAULT_SCHEDULE) as $m) {
        $m = (int)$m;
        if ($m > 0) $schedule[] = $m;
    }
    return [
        'max_attempts' => $max > 0 ? $max : PIN_LOCKOUT_DEFAULT_MAX_ATTEMPTS,
        'schedule_minutes' => $schedule ?: PIN_LOCKOUT_DEFAULT_SCHEDULE,
    ];
}

/** Table for a lockout subject kind; only 'user' and 'group' are allowed. */
function pinLockoutTable(string $kind): string {
    return match ($kind) {
        'user' => 'users',
        'group' => '`groups`',
        default => throw new InvalidArgumentException('Unknown lockout kind'),
    };
}

/** True when the escalation columns from migration 002 exist. */
function pinLockoutEscalationReady(PDO $pdo, string $kind): bool {
    static $cache = [];
    $key = spl_object_id($pdo) . ':' . $kind;
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT lockout_level, last_locked_at FROM ' . pinLockoutTable($kind) . ' LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/** Human-readable wait, e.g. "5 minutes", "2 hours", "2 days". */
function pinLockoutDuration(int $seconds): string {
    $seconds = max(1, $seconds);
    if ($seconds <= 3600) {
        $n = (int)ceil($seconds / 60);
        $unit = 'minute';
    } elseif ($seconds < 86400) {
        $n = (int)ceil($seconds / 3600);
        $unit = 'hour';
    } else {
        $n = (int)ceil($seconds / 86400);
        $unit = 'day';
    }
    return $n . ' ' . $unit . ($n === 1 ? '' : 's');
}

/** Seconds left on an active lock, or 0 when not locked. */
function pinLockoutRemaining(?string $lockedUntil): int {
    if ($lockedUntil === null || $lockedUntil === '') return 0;
    $until = strtotime($lockedUntil);
    return ($until !== false && $until > time()) ? $until - time() : 0;
}

/** Respond 429 for the wrong PIN that has just started a lockout. */
function pinLockoutRespondLocked(string $what, int $minutes): void {
    respond(429, [
        'status' => 'error',
        'code' => 'ACCOUNT_LOCKED',
        'message' => "Too many wrong PINs. {$what} is locked for " . pinLockoutDuration($minutes * 60) . '.',
        'retry_after' => $minutes * 60,
    ]);
}

/**
 * Respond 429 while the subject is locked. An expired lock is cleared but the escalation
 * level is kept, so the next lockout is longer.
 */
function pinLockoutCheck(PDO $pdo, string $kind, int $id, string $what): void {
    $table = pinLockoutTable($kind);
    $stmt = $pdo->prepare("SELECT locked_until FROM {$table} WHERE id = :id");
    $stmt->execute([':id' => $id]);
    $lockedUntil = $stmt->fetchColumn();
    if ($lockedUntil === false || $lockedUntil === null || $lockedUntil === '') return;

    $remaining = pinLockoutRemaining((string)$lockedUntil);
    if ($remaining > 0) {
        respond(429, [
            'status' => 'error',
            'code' => 'ACCOUNT_LOCKED',
            'message' => "{$what} is locked after too many wrong PINs. Try again in " . pinLockoutDuration($remaining) . '.',
            'retry_after' => $remaining,
        ]);
    }

    $pdo->prepare("UPDATE {$table} SET failed_attempts = 0, locked_until = NULL WHERE id = :id AND locked_until = :lu")
        ->execute([':id' => $id, ':lu' => $lockedUntil]);
}

/**
 * Record a wrong PIN. Returns the lock length in minutes when this attempt started a
 * lockout, otherwise null.
 */
function pinLockoutRecordFailure(PDO $pdo, string $kind, int $id, array $cfg): ?int {
    $table = pinLockoutTable($kind);
    $escalating = pinLockoutEscalationReady($pdo, $kind);
    $max = (int)$cfg['max_attempts'];

    $pdo->prepare("UPDATE {$table} SET failed_attempts = failed_attempts + 1 WHERE id = :id")
        ->execute([':id' => $id]);

    $cols = $escalating ? 'failed_attempts, lockout_level' : 'failed_attempts';
    $stmt = $pdo->prepare("SELECT {$cols} FROM {$table} WHERE id = :id");
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int)$row['failed_attempts'] < $max) return null;

    $until = static fn (int $mins): string => date('Y-m-d H:i:s', time() + $mins * 60);

    if (!$escalating) {
        $mins = PIN_LOCKOUT_LEGACY_MINUTES;
        $upd = $pdo->prepare(
            "UPDATE {$table} SET failed_attempts = 0, locked_until = :until
             WHERE id = :id AND failed_attempts >= :max"
        );
        $upd->execute([':until' => $until($mins), ':id' => $id, ':max' => $max]);
        return $upd->rowCount() > 0 ? $mins : null;
    }

    $schedule = $cfg['schedule_minutes'];
    $steps = count($schedule);
    $level = max(0, (int)$row['lockout_level']);
    $mins = (int)$schedule[min($level, $steps - 1)];

    // Only one concurrent request may escalate: the level must still be what we read.
    $upd = $pdo->prepare(
        "UPDATE {$table}
         SET failed_attempts = 0, lockout_level = :next, locked_until = :until, last_locked_at = :now
         WHERE id = :id AND failed_attempts >= :max AND lockout_level = :level"
    );
    $upd->execute([
        ':next' => min($level + 1, $steps),
        ':until' => $until($mins),
        ':now' => date('Y-m-d H:i:s'),
        ':id' => $id,
        ':max' => $max,
        ':level' => $level,
    ]);
    return $upd->rowCount() > 0 ? $mins : null;
}

/** Clear failed attempts, any active lock and the escalation level. */
function pinLockoutReset(PDO $pdo, string $kind, int $id): void {
    $table = pinLockoutTable($kind);
    $set = 'failed_attempts = 0, locked_until = NULL';
    if (pinLockoutEscalationReady($pdo, $kind)) $set .= ', lockout_level = 0';
    $pdo->prepare("UPDATE {$table} SET {$set} WHERE id = :id")->execute([':id' => $id]);
}
