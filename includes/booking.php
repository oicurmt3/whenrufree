<?php
/**
 * Booking mode: each slot can be taken by a limited number of people (first come, first served).
 *
 * calendars.slot_capacity  NULL = normal availability poll, 1..BOOKING_MAX_PER_SLOT = people per slot
 * calendars.max_per_user   NULL = no limit, 1..BOOKING_MAX_PER_USER = bookings per person (organiser exempt)
 * calendars.per_user_total 0 = max_per_user counts per day, 1 = across the whole calendar (migration 005)
 * calendars.bookings_closed 1 = organiser closed bookings
 *
 * Bookings reuse the availability table (status 1 = booked). The save endpoint locks the calendar
 * row (SELECT ... FOR UPDATE) so concurrent saves are checked one at a time.
 */

const BOOKING_MAX_PER_SLOT = 20;
const BOOKING_MAX_PER_USER = 20;

/** True once migrations/004_booking.sql has been applied. */
function bookingColumnsReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT slot_capacity, max_per_user, bookings_closed FROM calendars LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/** True once migrations/005_booking_total.sql has been applied. */
function bookingTotalColumnReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT per_user_total FROM calendars LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/**
 * Parse a submitted limit. Returns null for "no limit" (null, '', 0, false), the limit (1..$max),
 * or false when the value is invalid.
 */
function bookingLimitValue(mixed $v, int $max): int|null|false {
    if ($v === null || $v === '' || $v === false || $v === 0 || $v === '0') return null;
    if (is_string($v) && !preg_match('/^\d{1,3}$/', $v)) return false;
    if (!is_int($v) && !is_string($v)) return false;
    $n = (int)$v;
    return ($n >= 1 && $n <= $max) ? $n : false;
}

/**
 * Booking settings for a calendar row (columns may be missing before migrations 004 / 005).
 * per_user_total is true only when a per-person limit is set and counts across the whole calendar.
 * @return array{capacity:int|null, per_user:int|null, per_user_total:bool, closed:bool}
 */
function bookingSettingsFromRow(array $row): array {
    $cap = isset($row['slot_capacity']) && $row['slot_capacity'] !== null ? (int)$row['slot_capacity'] : null;
    $per = isset($row['max_per_user']) && $row['max_per_user'] !== null ? (int)$row['max_per_user'] : null;
    if ($cap !== null && ($cap < 1 || $cap > BOOKING_MAX_PER_SLOT)) $cap = null;
    if ($cap === null || ($per !== null && ($per < 1 || $per > BOOKING_MAX_PER_USER))) $per = null;
    return [
        'capacity' => $cap,
        'per_user' => $per,
        'per_user_total' => $per !== null && !empty($row['per_user_total']),
        'closed' => $cap !== null && !empty($row['bookings_closed']),
    ];
}

/**
 * Lock the calendar row for the rest of the transaction and return its booking settings.
 * @return array{capacity:int|null, per_user:int|null, per_user_total:bool, closed:bool}
 */
function bookingLockCalendar(PDO $pdo, int $calId): array {
    $totalCol = bookingTotalColumnReady($pdo) ? ', per_user_total' : '';
    $stmt = $pdo->prepare(
        "SELECT slot_capacity, max_per_user, bookings_closed{$totalCol} FROM calendars WHERE id = :id FOR UPDATE"
    );
    $stmt->execute([':id' => $calId]);
    return bookingSettingsFromRow($stmt->fetch() ?: []);
}

/**
 * Apply one user's booking changes inside the caller's transaction (after bookingLockCalendar).
 * Cancellations run first, so swapping one booking for another in a single save works.
 *
 * @param array $changes  [day => [slot => status]] (0 = cancel, 1 = book)
 * @param list<string> $slots  The calendar's slot labels
 * @param bool $exempt  True when the organiser books for themselves (no per-person limit)
 * @return list<array{day:string, slot:string, reason:string}>  Bookings that were refused ('full' or 'limit')
 * @throws RuntimeException on malformed input (caller rolls back and responds 400)
 */
function bookingApplyChanges(
    PDO $pdo, int $calId, int $userId, array $settings, array $changes,
    array $slots, string $startDate, string $endDate, bool $exempt
): array {
    $cancel = [];
    $book = [];
    foreach ($changes as $day => $daySlots) {
        if (!is_string($day) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) throw new RuntimeException('Invalid day');
        if ($day < $startDate || $day > $endDate) throw new RuntimeException('Day out of range');
        if (!is_array($daySlots)) throw new RuntimeException('Invalid slots');
        foreach ($daySlots as $slot => $st) {
            $slot = trim(preg_replace('/\s+/', ' ', (string)$slot));
            if (!in_array($slot, $slots, true)) throw new RuntimeException('Invalid slot');
            $st = (int)$st;
            if ($st === 0) $cancel[] = [$day, $slot];
            elseif ($st === 1) $book[] = [$day, $slot];
            else throw new RuntimeException('Invalid status');
        }
    }

    $del = $pdo->prepare(
        "DELETE FROM availability WHERE calendar_id = :cid AND user_id = :uid AND day = :day AND slot = :slot"
    );
    foreach ($cancel as [$day, $slot]) {
        $del->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot]);
    }

    // Per-person count: per day, or one running total when the limit covers the whole calendar
    $total = !empty($settings['per_user_total']);
    $mineStmt = $pdo->prepare($total
        ? "SELECT COUNT(*) FROM availability WHERE calendar_id = :cid AND user_id = :uid"
        : "SELECT COUNT(*) FROM availability WHERE calendar_id = :cid AND user_id = :uid AND day = :day"
    );
    $mine = [];

    $hasStmt = $pdo->prepare(
        "SELECT COUNT(*) FROM availability WHERE calendar_id = :cid AND user_id = :uid AND day = :day AND slot = :slot"
    );
    $takenStmt = $pdo->prepare(
        "SELECT COUNT(*) FROM availability WHERE calendar_id = :cid AND day = :day AND slot = :slot"
    );
    $ins = $pdo->prepare(
        "INSERT INTO availability (calendar_id, user_id, day, slot, status) VALUES (:cid, :uid, :day, :slot, 1)"
    );

    $rejected = [];
    foreach ($book as [$day, $slot]) {
        $hasStmt->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot]);
        if ((int)$hasStmt->fetchColumn() > 0) continue;

        $takenStmt->execute([':cid' => $calId, ':day' => $day, ':slot' => $slot]);
        if ($settings['capacity'] !== null && (int)$takenStmt->fetchColumn() >= $settings['capacity']) {
            $rejected[] = ['day' => $day, 'slot' => $slot, 'reason' => 'full'];
            continue;
        }
        $mineKey = $total ? '*' : $day;
        if (!isset($mine[$mineKey])) {
            $params = [':cid' => $calId, ':uid' => $userId];
            if (!$total) $params[':day'] = $day;
            $mineStmt->execute($params);
            $mine[$mineKey] = (int)$mineStmt->fetchColumn();
        }
        if (!$exempt && $settings['per_user'] !== null && $mine[$mineKey] >= $settings['per_user']) {
            $rejected[] = ['day' => $day, 'slot' => $slot, 'reason' => 'limit'];
            continue;
        }
        $ins->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot]);
        $mine[$mineKey]++;
    }
    return $rejected;
}
