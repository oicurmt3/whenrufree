<?php
/**
 * includes/data.php - Input normalisation and validation (titles, names, slots, statuses, date ranges) and data shaping.
 * Loaded by api.php.
 */

declare(strict_types=1);

function normaliseTitle(?string $t): ?string {
    $t = trim(preg_replace('/\s+/', ' ', (string)$t));
    $t = str_replace(['<', '>'], '', $t);
    if ($t === '') return null;
    return mb_substr($t, 0, 80);
}

function normaliseName(?string $n): ?string {
    $n = trim(preg_replace('/\s+/', ' ', (string)$n));
    $n = str_replace(['<', '>'], '', $n);
    if ($n === '') return null;
    return mb_substr($n, 0, 32);
}

function validateSlotsArray($slotsIn): array {
    if (!is_array($slotsIn)) return [false, []];
    $out = [];
    $seen = [];
    foreach ($slotsIn as $s) {
        $s = trim(preg_replace('/\s+/', ' ', (string)$s));
        if ($s === '') continue;
        $s = mb_substr($s, 0, 20);
        // Must match SLOT_REGEX in index.js (includes apostrophe)
        if (!preg_match("/^[A-Za-z0-9][A-Za-z0-9'\\- .]{0,19}$/u", $s)) return [false, []];
        $k = mb_strtolower($s);
        if (!isset($seen[$k])) {
            $seen[$k] = true;
            $out[] = $s;
        }
    }
    if (count($out) < 1) return [false, []];
    return [true, $out];
}

function validateStatusesArray($in): array {
    // Default: Yes / Maybe / No with weights
    $palette = ['#357A38', '#e58800', '#880000', '#1f5aa6', '#6a1b9a'];
    $default = [
        ['label' => 'Yes', 'color' => $palette[0], 'weight' => 2],
        ['label' => 'Maybe', 'color' => $palette[1], 'weight' => 1],
        ['label' => 'No', 'color' => $palette[2], 'weight' => 0],
    ];

    if ($in === null || $in === '' || $in === false) {
        return [true, $default];
    }
    if (!is_array($in)) return [false, []];

    $out = [];
    $seen = [];
    $i = 0;

    foreach ($in as $item) {
        $label = '';
        $color = '';
        $weight = null;

        if (is_array($item)) {
            $label = (string)($item['label'] ?? '');
            $color = (string)($item['color'] ?? '');
            // Accept weight from input (0-5 range)
            if (isset($item['weight'])) {
                $weight = max(0, min(5, (int)$item['weight']));
            }
        } else {
            $label = (string)$item;
        }

        $label = trim(preg_replace('/\s+/', ' ', $label));
        if ($label === '') continue;
        $label = mb_substr($label, 0, 20);

        // Must match STATUS_REGEX in index.js (includes apostrophe)
        if (!preg_match("/^[A-Za-z0-9][A-Za-z0-9'\\- ]{0,19}$/u", $label)) return [false, []];

        $k = mb_strtolower($label);
        if (isset($seen[$k])) continue;
        $seen[$k] = true;

        $color = trim($color);
        if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
            $color = $palette[$i % count($palette)];
        }

        // Default weight based on position if not provided
        if ($weight === null) {
            $weight = max(0, count($in) - 1 - $i);
        }

        $out[] = ['label' => $label, 'color' => $color, 'weight' => $weight];
        $i++;
    }

    if (count($out) < 1) return [false, []];
    return [true, $out];
}

function dateRangeOk(string $start, string $end): array {
    if ($start === '' || $end === '') return [false, 'Start/end date required'];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) return [false, 'Invalid date format'];
    if ($start > $end) return [false, 'Start date must be on/before end date'];

    // Bound to 2026-2030 (as per UI requirement)
    if ($start < '2026-01-01' || $end > '2030-12-31') return [false, 'Date range must be between 2026 and 2030'];

    $sd = strtotime($start . 'T00:00:00Z');
    $ed = strtotime($end . 'T00:00:00Z');
    if ($sd === false || $ed === false) return [false, 'Invalid date values'];

    $days = (int)floor(($ed - $sd) / 86400) + 1;
    if ($days > 360) return [false, 'Date range too long'];

    return [true, ''];
}

// Max length for organiser message (single source of truth; sent to frontend via calendar_meta)
const MESSAGE_MAX_LEN = 250;

/**
 * Aggregate availability counts per day/slot/status (no user identifiers).
 */
function buildAvailabilitySummary(PDO $pdo, int $calId, string $from, string $to, bool $skipBlocked = false): array {
    $blockedSql = $skipBlocked
        ? ' AND user_id NOT IN (SELECT id FROM users WHERE calendar_id = :cidb AND blocked = 1)'
        : '';
    $stmt = $pdo->prepare(
        "SELECT day, slot, status, COUNT(*) AS cnt
         FROM availability
         WHERE calendar_id = :cid AND day BETWEEN :f AND :t{$blockedSql}
         GROUP BY day, slot, status
         ORDER BY day, slot, status"
    );
    $params = [':cid' => $calId, ':f' => $from, ':t' => $to];
    if ($skipBlocked) $params[':cidb'] = $calId;
    $stmt->execute($params);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[] = [
            'day' => (string)$row['day'],
            'slot' => (string)$row['slot'],
            'status' => (int)$row['status'],
            'count' => (int)$row['cnt'],
        ];
    }
    return $out;
}

/** True once migrations/010_organiser_marks.sql has been applied. */
function organiserMarksColumnReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT show_organiser_marks FROM calendars LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/** True once migrations/012_null_color.sql has been applied. */
function nullColorColumnReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT null_color FROM calendars LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/**
 * The five greys an organiser may pick for a Slot nobody has answered yet (migrations/012).
 * INFO: keep in sync with NULL_COLOR_CHOICES in calendar-core.js and index.js.
 */
const NULL_COLOR_CHOICES = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff'];

/**
 * Normalise a submitted un-answered Slot colour.
 * @return string|null|false One of the five greys, null for empty (the default grey), false when invalid.
 */
function nullColorValue(mixed $v): string|null|false {
    if ($v === null || $v === '') return null;
    if (!is_string($v)) return false;
    $v = strtolower(trim($v));
    return in_array($v, NULL_COLOR_CHOICES, true) ? $v : false;
}

/** True once migrations/013_slot_default.sql has been applied. */
function slotDefaultColumnReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT default_status FROM calendars LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/**
 * Normalise a submitted default-option position.
 * @param int $max Number of options this calendar has (1..5).
 * @return int|null|false 1..$max for that option, null for empty ("no default option"), false when invalid.
 */
function slotDefaultValue(mixed $v, int $max): int|null|false {
    if ($v === null || $v === '' || $v === false || $v === 0 || $v === '0') return null;
    if ($max < 1) return false;
    if (is_string($v) && !preg_match('/^\d{1,2}$/', $v)) return false;
    if (!is_int($v) && !is_string($v)) return false;
    $n = (int)$v;
    return ($n >= 1 && $n <= $max) ? $n : false;
}

/** True once migrations/011_report_users.sql has been applied. */
function reportsTablesReady(PDO $pdo): bool {
    static $cache = [];
    $key = spl_object_id($pdo);
    if (!isset($cache[$key])) {
        try {
            $pdo->query('SELECT id FROM reports LIMIT 0');
            $cache[$key] = true;
        } catch (PDOException $e) {
            $cache[$key] = false;
        }
    }
    return $cache[$key];
}

/** Respond 409 when a unique display_name constraint is violated. */
function respondDuplicateName(): void {
    respond(409, ['status' => 'error', 'code' => 'NAME_TAKEN', 'message' => 'Someone on this calendar already uses that name. Add a letter or number to make it unique.']);
}
