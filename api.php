<?php
/**
 * api.php - Grape Calendar backend API
 *
 * Tech constraints:
 *  - PHP 8.x procedural
 *  - MariaDB/MySQL via PDO
 *  - JSON request bodies (Content-Type: application/json)
 *
 * This file implements:
 *  - CSRF protection (session-based token)
 *  - Security headers
 *  - Basic per-IP rate limiting using api_rate_limit
 *  - PIN authentication with escalating lockout (includes/lockout.php)
 *  - Calendar and availability CRUD endpoints
 */

declare(strict_types=1);

// -------------------------
// CORS (same-origin safe default)
// -------------------------
// This app is designed for same-origin use. We reply to OPTIONS for dev tooling.
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token, X-CSRF-Token, X-Group-Auth-Token, X-Access-Grant');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

// -------------------------
// Security headers
// -------------------------
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

// -------------------------
// Helpers (includes/)
// -------------------------
require_once __DIR__ . '/includes/http.php';
require_once __DIR__ . '/includes/data.php';
require_once __DIR__ . '/includes/security.php';
require_once __DIR__ . '/includes/sessions.php';
require_once __DIR__ . '/includes/hubs.php';
require_once __DIR__ . '/includes/webauthn.php';
require_once __DIR__ . '/includes/lockout.php';
require_once __DIR__ . '/includes/access.php';
require_once __DIR__ . '/includes/booking.php';

// -------------------------
// Main routing
// -------------------------
$action = requireAction();
$config = requireConfig();
initClientIpTrust($config);
$pdo = pdo($config);

// Decode JSON bodies into $_POST-compatible array
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json = readJsonBody();
    if (!empty($json)) {
        foreach ($json as $k => $v) {
            $_POST[$k] = $v;
        }
    }
}

// Rate limit all requests (safe even for GET)
try {
    enforceRateLimit($pdo, (int)($config['rate_limit']['per_minute'] ?? 120));
} catch (Throwable $e) {
    logSecurityEvent('RATE_LIMIT_ERROR', [
        'error' => $e->getMessage(),
        'action' => $action,
    ]);
    // Fail closed for auth/write POSTs when the DB limiter is unavailable.
    if (isSensitivePostAction($action)) {
        respond(503, [
            'status' => 'error',
            'message' => 'Service temporarily unavailable. Try again shortly.',
        ]);
    }
}

// Access emoji: calendars and Hubs with an emoji need a grant (includes/access.php)
accessGate($pdo, $config, $action);

// CSRF token endpoint
if ($action === 'csrf_token' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    respond(200, ['status' => 'success', 'csrf_token' => generateCsrfToken()]);
}

// Diagnostic endpoint (disabled by default)
if ($action === 'diag' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    if (getenv('GRAPE_DIAG_ENABLED') !== '1') {
        respond(404, ['status' => 'error', 'message' => 'Unknown action']);
    }
    $payload = [
        'status' => 'success',
        'php_version' => PHP_VERSION,
        'timestamp' => gmdate('c'),
        'db_connect' => 'OK',
    ];
    try {
        $pdo->query('SELECT 1');
    } catch (Throwable $e) {
        $payload['db_connect'] = 'FAILED';
    }
    respond(200, $payload);
}

// -------------------------
// Access emoji
// -------------------------

// Check a picked emoji for ?c= or ?g= and issue a 30-day grant
if ($action === 'access_check' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    accessHandleCheck($pdo, $config);
}

/**
 * Organiser view of the emoji setting: the calendar organiser (?c=, X-Auth-Token) or the
 * Hub organiser (?g=, X-Group-Auth-Token).
 */
if ($action === 'access_settings' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!accessTablesReady($pdo)) {
        respond(200, ['status' => 'success', 'available' => false, 'emoji' => null, 'hub_emoji' => false]);
    }
    if (isset($_GET['c'])) {
        $row = accessCalendarRow($pdo, requireToken());
        if (!$row) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
        $session = requireSession($pdo, (int)$row['id']);
        if ($session['role'] !== 'admin') {
            respond(403, ['status' => 'error', 'message' => 'Only the organiser can change settings']);
        }
        respond(200, [
            'status' => 'success',
            'available' => true,
            'emoji' => $row['access_emoji'] !== null ? (int)$row['access_emoji'] : null,
            'hub_emoji' => !empty($row['group_id']) && $row['group_emoji'] !== null,
        ]);
    }
    $row = accessGroupRow($pdo, requireGroupTokenParam());
    if (!$row) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    requireGroupOrganiserSession($pdo, (int)$row['id']);
    respond(200, [
        'status' => 'success',
        'available' => true,
        'emoji' => $row['access_emoji'] !== null ? (int)$row['access_emoji'] : null,
        'hub_emoji' => false,
    ]);
}

// Set or remove a calendar's emoji (calendar organiser). Existing grants stop working.
if ($action === 'set_access_emoji' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    if (!accessTablesReady($pdo)) respond(503, ['status' => 'error', 'message' => 'Access emoji is not available yet']);
    $row = accessCalendarRow($pdo, requireToken());
    if (!$row) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$row['id'];
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can change settings']);
    }
    $emoji = accessEmojiValue($_POST['emoji'] ?? null);
    if ($emoji === false) respond(400, ['status' => 'error', 'message' => 'Invalid emoji']);

    accessSetEmoji($pdo, 'calendar', $calId, $emoji);
    logSecurityEvent('ACCESS_EMOJI_CHANGED', ['calendar_id' => $calId, 'enabled' => $emoji !== null]);

    $row['access_emoji'] = $emoji;
    $req = accessRequirementForCalendar($row);
    $payload = ['status' => 'success', 'emoji' => $emoji, 'access' => accessPublicInfo($pdo, $req)];
    if ($req !== null) {
        $payload += accessGrantIssue($pdo, $req['kind'], $req['id'], accessConfig($config)['grant_days']);
    }
    respond(200, $payload);
}

// Set or remove a Hub's emoji (Hub organiser). Existing Hub grants stop working.
if ($action === 'set_group_access_emoji' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    if (!accessTablesReady($pdo)) respond(503, ['status' => 'error', 'message' => 'Access emoji is not available yet']);
    $row = accessGroupRow($pdo, requireGroupTokenParam());
    if (!$row) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    $groupId = (int)$row['id'];
    requireGroupOrganiserSession($pdo, $groupId);
    $emoji = accessEmojiValue($_POST['emoji'] ?? null);
    if ($emoji === false) respond(400, ['status' => 'error', 'message' => 'Invalid emoji']);

    accessSetEmoji($pdo, 'group', $groupId, $emoji);
    touchGroupActivity($pdo, $groupId);
    logSecurityEvent('ACCESS_EMOJI_CHANGED', ['group_id' => $groupId, 'enabled' => $emoji !== null]);

    $payload = ['status' => 'success', 'emoji' => $emoji];
    if ($emoji !== null) {
        $payload += accessGrantIssue($pdo, 'group', $groupId, accessConfig($config)['grant_days']);
    }
    respond(200, $payload);
}

// -------------------------
// Actions
// -------------------------

// Create calendar
if ($action === 'create_calendar' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();

    $title = normaliseTitle($_POST['title'] ?? null);
    // Category: accepts JSON array string (new) or plain string (legacy)
    $rawCat = (string)($_POST['category'] ?? '["groups"]');
    $decoded = json_decode($rawCat, true);
    if (is_array($decoded) && count($decoded) > 0) {
        // Sanitise: only keep alphanumeric/underscore values, max 3
        $cats = array_slice(array_filter($decoded, function($c){
            return is_string($c) && preg_match('/^[a-z_]+$/', $c);
        }), 0, 3);
        $category = count($cats) > 0 ? json_encode(array_values($cats)) : '["groups"]';
    } else {
        // Legacy single string - wrap in JSON array
        $cat = preg_match('/^[a-z_]+$/', $rawCat) ? $rawCat : 'groups';
        $category = json_encode([$cat]);
    }

    [$okSlots, $slots] = validateSlotsArray($_POST['slots'] ?? []);
    if (!$okSlots) respond(400, ['status' => 'error', 'message' => 'Invalid slots']);

    [$okStatuses, $statuses] = validateStatusesArray($_POST['statuses'] ?? null);
    if (!$okStatuses) respond(400, ['status' => 'error', 'message' => 'Invalid status options']);

    $startDate = (string)($_POST['start_date'] ?? '');
    $endDate = (string)($_POST['end_date'] ?? '');
    [$okRange, $rangeMsg] = dateRangeOk($startDate, $endDate);
    if (!$okRange) respond(400, ['status' => 'error', 'message' => $rangeMsg ?: 'Invalid date range']);

    $excludeWeekends = (int)((($_POST['exclude_weekends'] ?? 0) ? 1 : 0));

    // Date filter mode: 'all' (default), 'only', 'except'
    $dateFilterMode = (string)($_POST['date_filter_mode'] ?? 'all');
    if (!in_array($dateFilterMode, ['all', 'only', 'except'], true)) {
        $dateFilterMode = 'all';
    }

    // Privacy mode: 0=open, 1=hidden, 2=blind
    $isPrivate = (int)($_POST['is_private'] ?? 0);
    if ($isPrivate < 0 || $isPrivate > 2) $isPrivate = 0;

    $adminName = normaliseName($_POST['admin_name'] ?? null);
    $pinHash = hashPin((string)($_POST['admin_pin'] ?? ''));
    if ($adminName === null || $pinHash === null) {
        respond(400, ['status' => 'error', 'message' => 'Organiser name or PIN invalid']);
    }

    $accessEmoji = accessEmojiValue($_POST['access_emoji'] ?? null);
    if ($accessEmoji === false) respond(400, ['status' => 'error', 'message' => 'Invalid emoji']);
    if ($accessEmoji !== null && !accessTablesReady($pdo)) {
        respond(400, ['status' => 'error', 'message' => 'Access emoji is not available yet']);
    }

    // Booking mode (includes/booking.php): one option, weight 1, no Blind privacy
    $slotCapacity = bookingLimitValue($_POST['slot_capacity'] ?? null, BOOKING_MAX_PER_SLOT);
    if ($slotCapacity === false) respond(400, ['status' => 'error', 'message' => 'Invalid people per slot']);
    $maxPerUser = null;
    $perUserTotal = false;
    $bookingStyles = [];
    if ($slotCapacity !== null) {
        if (!bookingColumnsReady($pdo)) {
            respond(400, ['status' => 'error', 'message' => 'Booking is not available yet']);
        }
        $maxPerUser = bookingLimitValue($_POST['max_per_user'] ?? null, BOOKING_MAX_PER_USER);
        if ($maxPerUser === false) respond(400, ['status' => 'error', 'message' => 'Invalid bookings per person']);
        $perUserTotal = (string)($_POST['per_user_total'] ?? '0') === '1' && $maxPerUser !== null;
        if ($perUserTotal && !bookingTotalColumnReady($pdo)) {
            respond(400, ['status' => 'error', 'message' => 'Bookings per person in total is not available yet']);
        }
        // Partly booked / Full colours and names are cosmetic: ignored until migration 006 has run
        foreach (['partial_color', 'full_color'] as $k) {
            $bookingStyles[$k] = bookingColorValue($_POST[$k] ?? null);
            if ($bookingStyles[$k] === false) respond(400, ['status' => 'error', 'message' => 'Invalid booking colour']);
        }
        foreach (['partial_label', 'full_label'] as $k) {
            $bookingStyles[$k] = bookingStateLabelValue($_POST[$k] ?? null);
            if ($bookingStyles[$k] === false) respond(400, ['status' => 'error', 'message' => 'Invalid booking name']);
        }
        if (!bookingStyleColumnsReady($pdo)) $bookingStyles = [];
        if (count($statuses) !== 1) respond(400, ['status' => 'error', 'message' => 'Bookings use one choice']);
        $statuses[0]['weight'] = 1;
        if ($isPrivate === 2) {
            respond(400, ['status' => 'error', 'message' => 'Blind privacy is not available for bookings']);
        }
    }

    $titleForDb = $title === null ? '' : $title;
    $slotsJson = json_encode($slots, JSON_UNESCAPED_UNICODE);
    $statusesJson = json_encode($statuses, JSON_UNESCAPED_UNICODE);

    $startMonth = substr($startDate, 0, 7);
    $endMonth = substr($endDate, 0, 7);

    // Optional: assign new calendar to a hub (valid hub token + rate limits)
    $groupId = null;
    $groupTokenPost = resolveGroupTokenFromPost();
    if ($groupTokenPost !== null) {
        $grp = getGroupByToken($pdo, $groupTokenPost);
        if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
        $groupId = (int)$grp['id'];
        prepareHubCalendarAdd($pdo, $groupId, $config);
    }

    for ($i = 0; $i < 5; $i++) {
        // Generate shorter 8-char URL-safe tokens for cleaner URLs
        $token = createToken(8);
        try {
            $stmt = $pdo->prepare(
                "INSERT INTO calendars
                    (token, group_id, title, category, slots_json, statuses_json, start_date, end_date, exclude_weekends, date_filter_mode, is_private, created_at, last_activity, start_month, end_month)
                 VALUES
                    (:t, :gid, :title, :cat, :slots, :statuses, :sd, :ed, :exw, :dfm, :priv, NOW(), NULL, :sm, :em)"
            );
            $stmt->execute([
                ':t' => $token,
                ':gid' => $groupId,
                ':title' => $titleForDb,
                ':cat' => $category,
                ':slots' => $slotsJson,
                ':statuses' => $statusesJson,
                ':sd' => $startDate,
                ':ed' => $endDate,
                ':exw' => $excludeWeekends,
                ':dfm' => $dateFilterMode,
                ':priv' => $isPrivate,
                ':sm' => $startMonth,
                ':em' => $endMonth,
            ]);
            $calId = (int)$pdo->lastInsertId();

            $stmtU = $pdo->prepare(
                "INSERT INTO users (calendar_id, display_name, role, pin_hash, created_at)
                 VALUES (:cid, :dn, 'admin', :ph, NOW())"
            );
            $stmtU->execute([':cid' => $calId, ':dn' => $adminName, ':ph' => $pinHash]);

            if ($slotCapacity !== null) {
                $pdo->prepare("UPDATE calendars SET slot_capacity = :cap, max_per_user = :per WHERE id = :id")
                    ->execute([':cap' => $slotCapacity, ':per' => $maxPerUser, ':id' => $calId]);
                if ($perUserTotal) {
                    $pdo->prepare("UPDATE calendars SET per_user_total = 1 WHERE id = :id")
                        ->execute([':id' => $calId]);
                }
                if (array_filter($bookingStyles, fn ($v) => $v !== null)) {
                    $pdo->prepare(
                        "UPDATE calendars SET partial_color = :pc, full_color = :fc, partial_label = :pl, full_label = :fl
                         WHERE id = :id"
                    )->execute([
                        ':pc' => $bookingStyles['partial_color'], ':fc' => $bookingStyles['full_color'],
                        ':pl' => $bookingStyles['partial_label'], ':fl' => $bookingStyles['full_label'],
                        ':id' => $calId,
                    ]);
                }
            }

            if ($groupId !== null) {
                touchGroupActivity($pdo, $groupId);
            }

            $payload = ['status' => 'success', 'token' => $token];
            if (accessTablesReady($pdo)) {
                if ($accessEmoji !== null) {
                    $pdo->prepare("UPDATE calendars SET access_emoji = :e WHERE id = :id")
                        ->execute([':e' => $accessEmoji, ':id' => $calId]);
                }
                // The creator gets a grant for whichever emoji now guards the calendar (own or Hub's).
                $req = accessRequirementForCalendar(accessCalendarRow($pdo, $token) ?? []);
                if ($req !== null) {
                    $payload += accessGrantIssue($pdo, $req['kind'], $req['id'], accessConfig($config)['grant_days']);
                }
            }
            respond(200, $payload);
        } catch (PDOException $e) {
            if ((string)$e->getCode() === '23000') {
                // Token collision
                continue;
            }
            respond(500, ['status' => 'error', 'message' => 'Failed to create calendar']);
        }
    }

    respond(500, ['status' => 'error', 'message' => 'Failed to create calendar after retries']);
}

// Create hub (group)
if ($action === 'create_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();

    $title = normaliseTitle($_POST['title'] ?? null);
    $titleForDb = $title === null ? '' : $title;

    $organiserName = normaliseName($_POST['organiser_name'] ?? null);
    $pinHash = hashPin((string)($_POST['organiser_pin'] ?? ''));
    if ($organiserName === null || $pinHash === null) {
        respond(400, ['status' => 'error', 'message' => 'Organiser name or PIN invalid']);
    }

    $accessEmoji = accessEmojiValue($_POST['access_emoji'] ?? null);
    if ($accessEmoji === false) respond(400, ['status' => 'error', 'message' => 'Invalid emoji']);
    if ($accessEmoji !== null && !accessTablesReady($pdo)) {
        respond(400, ['status' => 'error', 'message' => 'Access emoji is not available yet']);
    }

    for ($i = 0; $i < 5; $i++) {
        $token = createToken(8);
        try {
            $stmt = $pdo->prepare(
                "INSERT INTO `groups`
                    (token, title, organiser_name, organiser_pin_hash, created_at, last_activity)
                 VALUES
                    (:t, :title, :oname, :ph, NOW(), NOW())"
            );
            $stmt->execute([
                ':t' => $token,
                ':title' => $titleForDb,
                ':oname' => $organiserName,
                ':ph' => $pinHash,
            ]);

            $payload = [
                'status' => 'success',
                'token' => $token,
                'title' => $titleForDb,
            ];
            if ($accessEmoji !== null) {
                $groupId = (int)$pdo->lastInsertId();
                $pdo->prepare("UPDATE `groups` SET access_emoji = :e WHERE id = :id")
                    ->execute([':e' => $accessEmoji, ':id' => $groupId]);
                $payload += accessGrantIssue($pdo, 'group', $groupId, accessConfig($config)['grant_days']);
            }
            respond(200, $payload);
        } catch (PDOException $e) {
            if ((string)$e->getCode() === '23000') {
                continue;
            }
            respond(500, ['status' => 'error', 'message' => 'Failed to create hub']);
        }
    }

    respond(500, ['status' => 'error', 'message' => 'Failed to create hub after retries']);
}

// Hub meta (public list with secret URL)
if ($action === 'group_meta' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireGroupTokenParam();
    $grp = getGroupByToken($pdo, $token);
    if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);

    $groupId = (int)$grp['id'];

    $bookingCols = bookingColumnsReady($pdo) ? ', slot_capacity, max_per_user, bookings_closed' : '';
    $stmt = $pdo->prepare(
        "SELECT token, title, start_date, end_date, chosen_date, chosen_slot, last_activity{$bookingCols}
         FROM calendars
         WHERE group_id = :gid
         ORDER BY last_activity DESC, created_at DESC"
    );
    $stmt->execute([':gid' => $groupId]);
    $calRows = $stmt->fetchAll();

    $calendars = [];
    foreach ($calRows as $row) {
        $booking = bookingSettingsFromRow($row);
        $calendars[] = [
            'token' => (string)$row['token'],
            'title' => (string)($row['title'] ?? ''),
            'start_date' => $row['start_date'] ?? null,
            'end_date' => $row['end_date'] ?? null,
            'is_frozen' => (!empty($row['chosen_date']) && !empty($row['chosen_slot'])) || $booking['closed'],
            'slot_capacity' => $booking['capacity'],
            'last_activity' => $row['last_activity'] ?? null,
        ];
    }

    respond(200, [
        'status' => 'success',
        'group' => [
            'title' => (string)($grp['title'] ?? ''),
            'token' => (string)$grp['token'],
            'calendar_count' => count($calendars),
            'passkeys' => webauthnTablesReady($pdo),
            'access' => accessPublicInfo($pdo, accessRequirementForGroup(accessGroupRow($pdo, $token) ?? [])),
        ],
        'calendars' => $calendars,
    ]);
}

// Hub organiser auth
if ($action === 'auth_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireGroupTokenParam();

    $grp = getGroupByToken($pdo, $token);
    if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    $groupId = (int)$grp['id'];

    $pin = (string)($_POST['pin'] ?? '');
    if (!preg_match('/^\d{4}$/', $pin)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    checkGroupLockout($pdo, $groupId);

    if (!verifyPin($pin, (string)$grp['organiser_pin_hash'])) {
        $lockMins = recordGroupFailedAttempt($pdo, $groupId);
        logSecurityEvent('GROUP_AUTH_FAILED', ['group_id' => $groupId]);
        if ($lockMins !== null) {
            logSecurityEvent('GROUP_LOCKED', ['group_id' => $groupId, 'minutes' => $lockMins]);
            pinLockoutRespondLocked('This Hub', $lockMins);
        }
        respond(401, ['status' => 'error', 'message' => 'Invalid PIN']);
    }

    resetGroupFailedAttempts($pdo, $groupId);

    $sessTok = createGroupSession($pdo, $groupId);

    touchGroupActivity($pdo, $groupId);

    respond(200, [
        'status' => 'success',
        'auth_token' => $sessTok,
        'role' => 'admin',
        'organiser_name' => (string)$grp['organiser_name'],
    ]);
}

// Attach calendar to hub (calendar organiser only)
if ($action === 'add_calendar_to_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $calToken = requireToken();

    $stmtC = $pdo->prepare("SELECT id, group_id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $calToken]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    if (!empty($cal['group_id'])) {
        respond(400, ['status' => 'error', 'message' => 'Calendar is already in a hub']);
    }

    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the calendar organiser can add to a hub']);
    }

    $groupTokenPost = resolveGroupTokenFromPost();
    if ($groupTokenPost === null) {
        respond(400, ['status' => 'error', 'message' => 'Hub token required']);
    }

    $grp = getGroupByToken($pdo, $groupTokenPost);
    if (!$grp) respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    $groupId = (int)$grp['id'];

    $hubReq = accessTablesReady($pdo) ? accessRequirementForGroup(accessGroupRow($pdo, $groupTokenPost) ?? []) : null;
    if ($hubReq !== null && !accessGrantValid($pdo, accessGrantTokensFromHeader(), [['group', $groupId]])) {
        respond(403, [
            'status' => 'error',
            'code' => 'HUB_ACCESS_REQUIRED',
            'message' => 'This Hub has an emoji. Open the Hub link and pick its emoji first, then try again.',
        ]);
    }

    prepareHubCalendarAdd($pdo, $groupId, $config);

    $pdo->prepare("UPDATE calendars SET group_id = :gid WHERE id = :cid")
        ->execute([':gid' => $groupId, ':cid' => $calId]);

    touchGroupActivity($pdo, $groupId);
    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    logSecurityEvent('ADD_CALENDAR_TO_GROUP', ['calendar_id' => $calId, 'group_id' => $groupId]);

    respond(200, [
        'status' => 'success',
        'group' => [
            'token' => (string)$grp['token'],
            'title' => (string)($grp['title'] ?? ''),
        ],
    ]);
}

// Detach calendar from hub (hub organiser or calendar organiser)
if ($action === 'remove_calendar_from_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $calToken = requireToken();

    $stmtC = $pdo->prepare("SELECT id, group_id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $calToken]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];
    $groupId = (int)($cal['group_id'] ?? 0);

    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Calendar is not in a hub']);
    }

    $calSession = getOptionalSession($pdo, $calId);
    $groupSession = getOptionalGroupSession($pdo, $groupId);

    $calAdmin = $calSession && $calSession['role'] === 'admin';
    $groupAdmin = $groupSession !== null;

    if (!$calAdmin && !$groupAdmin) {
        respond(403, ['status' => 'error', 'message' => 'Auth required to remove from hub']);
    }

    $pdo->prepare("UPDATE calendars SET group_id = NULL WHERE id = :cid")
        ->execute([':cid' => $calId]);

    touchGroupActivity($pdo, $groupId);
    logSecurityEvent('REMOVE_CALENDAR_FROM_GROUP', ['calendar_id' => $calId, 'group_id' => $groupId]);

    respond(200, ['status' => 'success']);
}

// Calendar meta
if ($action === 'calendar_meta' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireToken();
    $bookingCols = bookingColumnsReady($pdo) ? 'c.slot_capacity, c.max_per_user, c.bookings_closed,' : '';
    if ($bookingCols !== '' && bookingTotalColumnReady($pdo)) $bookingCols .= ' c.per_user_total,';
    if ($bookingCols !== '' && bookingStyleColumnsReady($pdo)) {
        $bookingCols .= ' c.partial_color, c.full_color, c.partial_label, c.full_label,';
    }
    $stmt = $pdo->prepare(
        "SELECT c.id, c.token, c.group_id, c.title, c.category, c.slots_json, c.statuses_json,
                c.start_date, c.end_date, c.exclude_weekends, c.date_filter_mode, c.date_filter_dates,
                c.is_private, c.rank_sort_order, c.organiser_message, c.chosen_date, c.chosen_slot,
                c.created_at, c.last_activity, {$bookingCols}
                g.token AS group_token, g.title AS group_title
         FROM calendars c
         LEFT JOIN `groups` g ON g.id = c.group_id
         WHERE c.token = :t"
    );
    $stmt->execute([':t' => $token]);
    $cal = $stmt->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);

    $slots = null;
    if (isset($cal['slots_json']) && is_string($cal['slots_json']) && $cal['slots_json'] !== '') {
        $decoded = json_decode($cal['slots_json'], true);
        if (is_array($decoded)) $slots = $decoded;
    }
    $cal['slots'] = $slots;

    $statuses = null;
    if (isset($cal['statuses_json']) && is_string($cal['statuses_json']) && $cal['statuses_json'] !== '') {
        $decoded = json_decode($cal['statuses_json'], true);
        if (is_array($decoded)) $statuses = $decoded;
    }
    if ($statuses === null) {
        // Backward compatibility with calendars created before statuses_json existed
        $statuses = [
            ['label' => 'Yes', 'color' => '#357A38'],
            ['label' => 'Maybe', 'color' => '#e58800'],
            ['label' => 'No', 'color' => '#880000'],
        ];
    }
    $cal['statuses'] = $statuses;
    $cal['exclude_weekends'] = (int)($cal['exclude_weekends'] ?? 0);
    $cal['is_private'] = (int)($cal['is_private'] ?? 0);

    // Date filter: mode and selected dates
    $cal['date_filter_mode'] = (string)($cal['date_filter_mode'] ?? 'all');
    if (!in_array($cal['date_filter_mode'], ['all', 'only', 'except'], true)) {
        $cal['date_filter_mode'] = 'all';
    }
    $dfDates = null;
    if (isset($cal['date_filter_dates']) && is_string($cal['date_filter_dates']) && $cal['date_filter_dates'] !== '') {
        $decoded = json_decode($cal['date_filter_dates'], true);
        if (is_array($decoded)) $dfDates = $decoded;
    }
    $cal['date_filter_dates'] = $dfDates;

    // Rank sort order: 'score' (default) or 'date' (chronological)
    $rso = (string)($cal['rank_sort_order'] ?? 'score');
    $cal['rank_sort_order'] = in_array($rso, ['score', 'date'], true) ? $rso : 'score';

    // Organiser message: plain text, limit defined by MESSAGE_MAX_LEN constant
    $cal['organiser_message'] = (string)($cal['organiser_message'] ?? '');
    $cal['organiser_message_max'] = MESSAGE_MAX_LEN;

    // Chosen slot: if organiser has locked in a date+slot, expose it
    $cal['chosen_date'] = $cal['chosen_date'] ?? null;
    $cal['chosen_slot'] = $cal['chosen_slot'] ?? null;

    // Booking mode (null capacity = normal availability poll)
    $booking = bookingSettingsFromRow($cal);
    $cal['slot_capacity'] = $booking['capacity'];
    $cal['max_per_user'] = $booking['per_user'];
    $cal['per_user_total'] = $booking['per_user_total'];
    $cal['bookings_closed'] = $booking['closed'];
    foreach (bookingStylesFromRow($cal) as $k => $v) {
        $cal[$k] = $booking['capacity'] !== null ? $v : null;
    }

    // Hub breadcrumb when calendar belongs to a group
    if (!empty($cal['group_id']) && !empty($cal['group_token'])) {
        $cal['group'] = [
            'token' => (string)$cal['group_token'],
            'title' => (string)($cal['group_title'] ?? ''),
        ];
    }

    // Opening a calendar from the Hub (from_hub=1 + matching g token) counts as Hub activity
    if ((string)($_GET['from_hub'] ?? '') === '1'
        && !empty($cal['group_id'])
        && !empty($cal['group_token'])) {
        $hubTokenParam = (string)($_GET['g'] ?? '');
        if ($hubTokenParam !== ''
            && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $hubTokenParam)
            && hash_equals((string)$cal['group_token'], $hubTokenParam)) {
            touchGroupActivity($pdo, (int)$cal['group_id']);
        }
    }

    unset($cal['group_id'], $cal['group_token'], $cal['group_title']);

    $cal['passkeys'] = webauthnTablesReady($pdo);
    $cal['access'] = accessPublicInfo($pdo, accessRequirementForCalendar(accessCalendarRow($pdo, $token) ?? []));

    respond(200, ['status' => 'success', 'calendar' => $cal]);
}

// Save date filter dates (admin only)
// Updates the date_filter_dates JSON column with the organiser's selected dates.
// Requires admin auth token. Does NOT change date_filter_mode (set at creation).
if ($action === 'save_date_filter' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Look up calendar
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Verify session and require admin role
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can update date filters']);
    }

    // Validate incoming dates array
    $dates = $_POST['dates'] ?? null;
    if ($dates !== null && !is_array($dates)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid dates format']);
    }

    $validDates = [];
    if (is_array($dates)) {
        foreach ($dates as $d) {
            $d = (string)$d;
            // Validate YYYY-MM-DD format
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                $validDates[] = $d;
            }
        }
        // Remove duplicates and sort
        $validDates = array_values(array_unique($validDates));
        sort($validDates);
    }

    // Store as JSON (null if empty array to keep DB clean)
    $datesJson = count($validDates) > 0 ? json_encode($validDates) : null;

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET date_filter_dates = :dates WHERE id = :cid"
    );
    $stmtU->execute([':dates' => $datesJson, ':cid' => $calId]);

    respond(200, ['status' => 'success', 'dates' => $validDates]);
}

// Save rank sort order (admin only)
// Toggles the ranking display between 'score' (best first) and 'date' (chronological).
// Persisted so all users see the same order chosen by the organiser.
if ($action === 'save_rank_sort' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Look up calendar
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Verify session and require admin role
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can change rank sort order']);
    }

    // Validate sort order value
    $order = (string)($_POST['order'] ?? '');
    if (!in_array($order, ['score', 'date'], true)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid sort order. Use "score" or "date".']);
    }

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET rank_sort_order = :ord WHERE id = :cid"
    );
    $stmtU->execute([':ord' => $order, ':cid' => $calId]);

    respond(200, ['status' => 'success', 'rank_sort_order' => $order]);
}

// Save organiser message (admin only)
// Updates the short message displayed to all calendar participants.
// Length enforced by MESSAGE_MAX_LEN constant. Empty string clears the message.
if ($action === 'save_organiser_message' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Look up calendar
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Verify session and require admin role
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can update the message']);
    }

    // Sanitise: trim, strip tags, enforce max length from constant
    $msg = trim(strip_tags((string)($_POST['message'] ?? '')));
    if (mb_strlen($msg) > MESSAGE_MAX_LEN) {
        $msg = mb_substr($msg, 0, MESSAGE_MAX_LEN);
    }

    // Empty string stored as NULL for cleanliness
    $stmtU = $pdo->prepare(
        "UPDATE calendars SET organiser_message = :msg WHERE id = :cid"
    );
    $stmtU->execute([':msg' => $msg === '' ? null : $msg, ':cid' => $calId]);

    respond(200, ['status' => 'success', 'organiser_message' => $msg]);
}

// List users
if ($action === 'users' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireToken();
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE calendar_id = :cid ORDER BY created_at ASC, id ASC");
    $stmtU->execute([':cid' => $calId]);
    $users = $stmtU->fetchAll();

    respond(200, ['status' => 'success', 'users' => $users]);
}

// Add user
if ($action === 'add_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $name = normaliseName($_POST['display_name'] ?? ($_POST['name'] ?? null));
    $pinHash = hashPin((string)($_POST['pin'] ?? ''));
    if ($name === null || $pinHash === null) respond(400, ['status' => 'error', 'message' => 'Invalid name or PIN']);

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO users (calendar_id, display_name, role, pin_hash, created_at)
             VALUES (:cid, :dn, 'member', :ph, NOW())"
        );
        $stmt->execute([':cid' => $calId, ':dn' => $name, ':ph' => $pinHash]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000') {
            respondDuplicateName();
        }
        respond(500, ['status' => 'error', 'message' => 'Failed to add user']);
    }

    // IMPORTANT: Get lastInsertId immediately after INSERT, before any other queries
    $newId = (int)$pdo->lastInsertId();

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    respond(200, [
        'status' => 'success',
        'user_id' => $newId,
        'user' => [
            'id' => $newId,
            'display_name' => $name,
            'role' => 'member',
        ],
    ]);
}

// Rename user (self or admin)
if ($action === 'rename_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $session = requireSession($pdo, $calId);

    $targetId = (int)($_POST['user_id'] ?? 0);
    $newName = normaliseName($_POST['display_name'] ?? ($_POST['name'] ?? null));
    if ($targetId <= 0 || $newName === null) respond(400, ['status' => 'error', 'message' => 'Invalid request']);

    if ($session['role'] !== 'admin' && $session['user_id'] !== $targetId) {
        respond(403, ['status' => 'error', 'message' => 'Not permitted']);
    }

    try {
        $stmt = $pdo->prepare("UPDATE users SET display_name = :dn WHERE id = :uid AND calendar_id = :cid");
        $stmt->execute([':dn' => $newName, ':uid' => $targetId, ':cid' => $calId]);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000') {
            respondDuplicateName();
        }
        respond(500, ['status' => 'error', 'message' => 'Failed to rename user']);
    }

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    respond(200, ['status' => 'success']);
}

// Authenticate user by PIN
if ($action === 'auth_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $userId = (int)($_POST['user_id'] ?? 0);
    $pin = (string)($_POST['pin'] ?? '');
    if ($userId <= 0 || !preg_match('/^\d{4}$/', $pin)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $stmtU = $pdo->prepare("SELECT id, pin_hash, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calId]);
    $user = $stmtU->fetch();
    if (!$user) respond(404, ['status' => 'error', 'message' => 'User not found']);

    checkAccountLockout($pdo, $userId);

    if (!verifyPin($pin, (string)$user['pin_hash'])) {
        $lockMins = recordFailedAttempt($pdo, $userId);
        logSecurityEvent('AUTH_FAILED', ['user_id' => $userId, 'calendar_id' => $calId]);

        if ($lockMins !== null) {
            logSecurityEvent('ACCOUNT_LOCKED', ['user_id' => $userId, 'calendar_id' => $calId, 'minutes' => $lockMins]);
            pinLockoutRespondLocked('This name', $lockMins);
        }

        respond(401, ['status' => 'error', 'message' => 'Invalid PIN']);
    }

    resetFailedAttempts($pdo, $userId);

    $tok = createUserSession($pdo, $calId, $userId);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    respond(200, ['status' => 'success', 'auth_token' => $tok, 'role' => (string)$user['role'], 'user_id' => $userId]);
}

// -------------------------
// Passkeys: fingerprint / face / device screen lock login (PIN stays as backup)
// Every action takes ?c=<calendar token> (calendar user) or ?g=<hub token> (Hub organiser).
// -------------------------
if (str_starts_with($action, 'passkey_') && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    webauthnRequireTables($pdo);
    $ip = clientIp();
    $minute = gmdate('YmdHi');

    // Start enrolling this device (must already be logged in with PIN)
    if ($action === 'passkey_register_begin') {
        $subject = resolvePasskeySubject($pdo, true);
        enforceActionRateLimit($pdo, $ip, 'pkr' . $minute, 20, 'Too many attempts. Try again shortly.');
        respond(200, ['status' => 'success', 'publicKey' => webauthnRegisterOptions($pdo, $config, $subject)]);
    }

    if ($action === 'passkey_register_finish') {
        $subject = resolvePasskeySubject($pdo, true);
        enforceActionRateLimit($pdo, $ip, 'pkr' . $minute, 20, 'Too many attempts. Try again shortly.');
        $cred = $_POST['credential'] ?? null;
        if (!is_array($cred)) respond(400, ['status' => 'error', 'message' => 'Invalid request']);

        $credentialId = webauthnRegisterFinish($pdo, $config, $subject, $cred, $_POST['device_label'] ?? null);
        logSecurityEvent('PASSKEY_ADDED', ['subject' => webauthnSubjectKey($subject)]);
        respond(200, ['status' => 'success', 'credential_id' => $credentialId]);
    }

    // Start a passkey login for a chosen name (calendar: POST user_id) or the Hub organiser
    if ($action === 'passkey_login_begin') {
        $subject = resolvePasskeySubject($pdo, false);
        enforceActionRateLimit($pdo, $ip, 'pkl' . $minute, 30, 'Too many attempts. Try again shortly.');
        respond(200, ['status' => 'success', 'publicKey' => webauthnLoginOptions($pdo, $config, $subject)]);
    }

    if ($action === 'passkey_login_finish') {
        $subject = resolvePasskeySubject($pdo, false);
        enforceActionRateLimit($pdo, $ip, 'pkl' . $minute, 30, 'Too many attempts. Try again shortly.');
        $cred = $_POST['credential'] ?? null;
        if (!is_array($cred)) respond(400, ['status' => 'error', 'message' => 'Invalid request']);

        webauthnLoginFinish($pdo, $config, $subject, $cred);
        logSecurityEvent('PASSKEY_LOGIN', ['subject' => webauthnSubjectKey($subject)]);

        // A verified passkey is stronger than a PIN, so it also clears any PIN lockout.
        if ($subject['kind'] === 'group') {
            resetGroupFailedAttempts($pdo, $subject['id']);
            $sessTok = createGroupSession($pdo, $subject['id']);
            touchGroupActivity($pdo, $subject['id']);
            respond(200, [
                'status' => 'success',
                'auth_token' => $sessTok,
                'role' => 'admin',
                'organiser_name' => $subject['name'],
            ]);
        }

        resetFailedAttempts($pdo, $subject['id']);
        $tok = createUserSession($pdo, $subject['calendar_id'], $subject['id']);
        $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")
            ->execute([':cid' => $subject['calendar_id']]);
        respond(200, [
            'status' => 'success',
            'auth_token' => $tok,
            'role' => $subject['role'],
            'user_id' => $subject['id'],
        ]);
    }

    // Devices with fingerprint / face unlock for the logged-in user or Hub organiser
    if ($action === 'passkey_list') {
        $subject = resolvePasskeySubject($pdo, true);
        respond(200, ['status' => 'success', 'credentials' => webauthnList($pdo, $subject)]);
    }

    // Turn off fingerprint / face unlock for one device (owner only, from any of their devices)
    if ($action === 'passkey_remove') {
        $subject = resolvePasskeySubject($pdo, true);
        $credentialId = (string)($_POST['credential_id'] ?? '');
        $removed = webauthnDelete($pdo, $subject, $credentialId);
        if ($removed) logSecurityEvent('PASSKEY_REMOVED', ['subject' => webauthnSubjectKey($subject)]);
        respond(200, ['status' => 'success', 'removed' => $removed, 'credentials' => webauthnList($pdo, $subject)]);
    }
}

// Availability fetch (read-only)
if ($action === 'availability' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = requireToken();
    $from = (string)($_GET['from'] ?? '');
    $to = (string)($_GET['to'] ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || $from > $to) {
        respond(400, ['status' => 'error', 'message' => 'Invalid range']);
    }

    $bookingCols = bookingColumnsReady($pdo) ? ', slot_capacity' : '';
    $stmtC = $pdo->prepare("SELECT id, is_private{$bookingCols} FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];
    $isPrivate = (int)($cal['is_private'] ?? 0);
    $isBooking = bookingSettingsFromRow($cal)['capacity'] !== null;

    $session = getOptionalSession($pdo, $calId);
    $rows = [];
    $summary = [];

    if ($isPrivate === 0) {
        // Open: anyone with the calendar link sees all rows
        $stmt = $pdo->prepare(
            "SELECT calendar_id, user_id, day, slot, status
             FROM availability
             WHERE calendar_id = :cid AND day BETWEEN :f AND :t"
        );
        $stmt->execute([':cid' => $calId, ':f' => $from, ':t' => $to]);
        $rows = $stmt->fetchAll();
    } elseif ($session === null) {
        // Hidden/Blind without auth: no data, except booking counts so visitors can see free slots
        $rows = [];
        $summary = $isBooking ? buildAvailabilitySummary($pdo, $calId, $from, $to) : [];
    } elseif ($isPrivate === 1 && $session['role'] === 'admin') {
        // Hidden + organiser: full detail
        $stmt = $pdo->prepare(
            "SELECT calendar_id, user_id, day, slot, status
             FROM availability
             WHERE calendar_id = :cid AND day BETWEEN :f AND :t"
        );
        $stmt->execute([':cid' => $calId, ':f' => $from, ':t' => $to]);
        $rows = $stmt->fetchAll();
    } else {
        // Hidden member or Blind (any role): own rows + anonymous summary
        $stmt = $pdo->prepare(
            "SELECT calendar_id, user_id, day, slot, status
             FROM availability
             WHERE calendar_id = :cid AND user_id = :uid AND day BETWEEN :f AND :t"
        );
        $stmt->execute([':cid' => $calId, ':uid' => $session['user_id'], ':f' => $from, ':t' => $to]);
        $rows = $stmt->fetchAll();
        $summary = buildAvailabilitySummary($pdo, $calId, $from, $to);
    }

    respond(200, ['status' => 'success', 'rows' => $rows, 'summary' => $summary]);
}

// Save availability changes
if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    // Need statuses_json to validate per-calendar status range (1..5 supported).
    $bookingCols = bookingColumnsReady($pdo) ? ', slot_capacity, max_per_user, bookings_closed' : '';
    $stmtC = $pdo->prepare(
        "SELECT id, statuses_json, slots_json, start_date, end_date, chosen_date, chosen_slot{$bookingCols}
         FROM calendars WHERE token = :t"
    );
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];
    $isBooking = bookingSettingsFromRow($cal)['capacity'] !== null;

    // Block saves if the organiser has locked in a chosen slot (calendar is frozen)
    if (!empty($cal['chosen_date']) && !empty($cal['chosen_slot'])) {
        respond(403, ['status' => 'error', 'message' => 'This calendar has been finalised. The organiser has locked in a date and slot.']);
    }

    // Determine the maximum allowed status value for this calendar.
    // Statuses are stored as integers: 0 = NULL, 1..N = per-calendar options (1..5 options supported).
    $rawStatuses = null;
    if (isset($cal['statuses_json']) && is_string($cal['statuses_json']) && trim($cal['statuses_json']) !== '') {
        $decoded = json_decode($cal['statuses_json'], true);
        if (is_array($decoded)) $rawStatuses = $decoded;
    }
    [$okStatuses, $normStatuses] = validateStatusesArray($rawStatuses);
    // Fallback to 3 if the calendar has no valid custom statuses.
    $maxStatus = ($okStatuses && is_array($normStatuses) && count($normStatuses) >= 1 && count($normStatuses) <= 5)
        ? count($normStatuses)
        : 3;

    $session = requireSession($pdo, $calId);

    $userId = (int)($_POST['user_id'] ?? 0);
    $changes = $_POST['changes'] ?? null;
    if ($userId <= 0 || !is_array($changes)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }

    // Members can only save themselves. Admin can save anyone.
    if ($session['role'] !== 'admin' && $session['user_id'] !== $userId) {
        respond(403, ['status' => 'error', 'message' => 'Not permitted']);
    }

    // Validate that user belongs to this calendar
    $stmtU = $pdo->prepare("SELECT id FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calId]);
    if (!$stmtU->fetch()) respond(404, ['status' => 'error', 'message' => 'User not found']);

    if ($isBooking) {
        $calSlots = json_decode((string)($cal['slots_json'] ?? ''), true);
        $calSlots = is_array($calSlots) ? array_values(array_filter($calSlots, 'is_string')) : [];
        $pdo->beginTransaction();
        try {
            // Row lock: concurrent bookings on this calendar are checked one at a time
            $booking = bookingLockCalendar($pdo, $calId);
            if ($booking['closed'] && $session['role'] !== 'admin') {
                $pdo->rollBack();
                respond(403, ['status' => 'error', 'message' => 'Bookings are closed.', 'code' => 'BOOKINGS_CLOSED']);
            }
            $exempt = $session['role'] === 'admin' && $session['user_id'] === $userId;
            $rejected = bookingApplyChanges(
                $pdo, $calId, $userId, $booking, $changes, $calSlots,
                (string)$cal['start_date'], (string)$cal['end_date'], $exempt
            );
            $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);
            touchGroupForCalendar($pdo, $calId);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(400, ['status' => 'error', 'message' => 'Failed to save changes']);
        }
        respond(200, ['status' => 'success', 'rejected' => $rejected]);
    }

    // Transaction: apply changes
    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare(
            "INSERT INTO availability (calendar_id, user_id, day, slot, status)
             VALUES (:cid, :uid, :day, :slot, :st)
             ON DUPLICATE KEY UPDATE status = VALUES(status)"
        );
        $del = $pdo->prepare(
            "DELETE FROM availability
             WHERE calendar_id = :cid AND user_id = :uid AND day = :day AND slot = :slot"
        );

        foreach ($changes as $day => $slots) {
            if (!is_string($day) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
                throw new RuntimeException('Invalid day');
            }
            if (!is_array($slots)) {
                throw new RuntimeException('Invalid slots');
            }
            foreach ($slots as $slot => $st) {
                $slot = trim(preg_replace('/\s+/', ' ', (string)$slot));
                if ($slot === '' || strlen($slot) > 20) {
                    throw new RuntimeException('Invalid slot');
                }
                $stNum = (int)$st;
                if ($stNum === 0) {
                    $del->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot]);
                } else {
                    if ($stNum < 1 || $stNum > $maxStatus) {
                        throw new RuntimeException('Invalid status');
                    }
                    $ins->execute([':cid' => $calId, ':uid' => $userId, ':day' => $day, ':slot' => $slot, ':st' => $stNum]);
                }
            }
        }

        $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);
        touchGroupForCalendar($pdo, $calId);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        respond(400, ['status' => 'error', 'message' => 'Failed to save changes']);
    }

    respond(200, ['status' => 'success']);
}

// Reset user availability (self or admin)
// Authenticated users can reset their own availability.
// Admin can reset any user's availability.
if ($action === 'reset_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $session = requireSession($pdo, $calId);

    $targetId = (int)($_POST['user_id'] ?? 0);
    if ($targetId <= 0) respond(400, ['status' => 'error', 'message' => 'Invalid request']);

    // Members can only reset themselves; admin can reset anyone
    if ($session['role'] !== 'admin' && $session['user_id'] !== $targetId) {
        respond(403, ['status' => 'error', 'message' => 'Not permitted']);
    }

    if ($session['role'] !== 'admin' && bookingColumnsReady($pdo)) {
        $stmtB = $pdo->prepare("SELECT slot_capacity, max_per_user, bookings_closed FROM calendars WHERE id = :cid");
        $stmtB->execute([':cid' => $calId]);
        if (bookingSettingsFromRow($stmtB->fetch() ?: [])['closed']) {
            respond(403, ['status' => 'error', 'message' => 'Bookings are closed.', 'code' => 'BOOKINGS_CLOSED']);
        }
    }

    $stmt = $pdo->prepare("DELETE FROM availability WHERE calendar_id = :cid AND user_id = :uid");
    $stmt->execute([':cid' => $calId, ':uid' => $targetId]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    $eventType = ($session['user_id'] === $targetId) ? 'USER_RESET_SELF' : 'ADMIN_RESET_USER';
    logSecurityEvent($eventType, ['actor_id' => $session['user_id'], 'target_id' => $targetId, 'calendar_id' => $calId]);

    respond(200, ['status' => 'success']);
}

/**
 * Reset ALL availability for ALL users in a calendar (admin only)
 * Requires double confirmation on frontend (confirm + type "RESET")
 */
if ($action === 'reset_all' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Not permitted - admin only']);
    }

    // Require confirmation code from frontend
    $confirmCode = trim($_POST['confirm_code'] ?? '');
    if (strtoupper($confirmCode) !== 'RESET') {
        respond(400, ['status' => 'error', 'message' => 'Invalid confirmation code']);
    }

    // Delete ALL availability for this calendar
    $stmt = $pdo->prepare("DELETE FROM availability WHERE calendar_id = :cid");
    $stmt->execute([':cid' => $calId]);
    $deletedCount = $stmt->rowCount();

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    logSecurityEvent('ADMIN_RESET_ALL', ['actor_id' => $session['user_id'], 'calendar_id' => $calId, 'deleted_rows' => $deletedCount]);

    respond(200, ['status' => 'success', 'deleted' => $deletedCount]);
}

// =========================================================================
// SITE ADMIN ENDPOINTS
// These endpoints require the site admin password from config.php
// =========================================================================

/**
 * Verify site admin password and return session token.
 * Password is stored in config.php as $config['admin']['password']
 */
if ($action === 'admin_login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    checkAdminLoginLockout($pdo, $config);

    $password = trim((string)($_POST['password'] ?? ''));
    
    if ($password === '') {
        respond(400, ['status' => 'error', 'message' => 'Password required']);
    }

    // Get admin password from config
    $adminPassword = (string)($config['admin']['password'] ?? '');
    if ($adminPassword === '') {
        logSecurityEvent('ADMIN_LOGIN_FAILED', ['reason' => 'No admin password configured']);
        respond(500, ['status' => 'error', 'message' => 'Admin not configured']);
    }

    // Verify password (supports both plain text and hashed)
    $valid = false;
    if (strlen($adminPassword) === 60 && strpos($adminPassword, '$2') === 0) {
        // Password is hashed with password_hash()
        $valid = password_verify($password, $adminPassword);
    } else {
        // Plain text comparison (less secure, but simple for initial setup)
        $valid = hash_equals($adminPassword, $password);
    }

    if (!$valid) {
        recordAdminLoginFailedAttempt($pdo, $config);
        logSecurityEvent('ADMIN_LOGIN_FAILED', ['reason' => 'Invalid password']);
        respond(401, ['status' => 'error', 'message' => 'Invalid password']);
    }

    resetAdminLoginAttempts($pdo);

    // Generate admin session token (stored in PHP session)
    startSecureSession();
    $adminToken = bin2hex(random_bytes(32));
    $_SESSION['admin_token'] = $adminToken;
    $_SESSION['admin_token_expires'] = time() + 3600; // 1 hour expiry

    logSecurityEvent('ADMIN_LOGIN_SUCCESS', []);

    respond(200, [
        'status' => 'success',
        'admin_token' => $adminToken,
        'csrf_token' => generateCsrfToken()
    ]);
}

/**
 * Get list of all calendars for admin panel
 */
if ($action === 'admin_calendars' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $emojiCols = accessTablesReady($pdo)
        ? 'c.access_emoji, g.access_emoji AS group_access_emoji,'
        : 'NULL AS access_emoji, NULL AS group_access_emoji,';
    $bookingCol = bookingColumnsReady($pdo) ? 'c.slot_capacity,' : 'NULL AS slot_capacity,';
    $sql = "
        SELECT 
            c.id,
            c.token,
            c.title,
            c.category,
            c.created_at,
            c.last_activity,
            c.never_expires,
            {$emojiCols}
            {$bookingCol}
            c.group_id,
            g.token AS group_token,
            g.title AS group_title,
            COUNT(DISTINCT u.id) AS user_count
        FROM calendars c
        LEFT JOIN users u ON u.calendar_id = c.id
        LEFT JOIN `groups` g ON g.id = c.group_id
        GROUP BY c.id
        ORDER BY c.id DESC
    ";
    
    $stmt = $pdo->query($sql);
    $calendars = $stmt->fetchAll();

    // Convert never_expires to int for JS
    foreach ($calendars as &$cal) {
        $cal['never_expires'] = (int)($cal['never_expires'] ?? 0);
        $cal['user_count'] = (int)($cal['user_count'] ?? 0);
        $cal['group_id'] = $cal['group_id'] !== null ? (int)$cal['group_id'] : null;
        $cal['access_emoji'] = $cal['access_emoji'] !== null ? (int)$cal['access_emoji'] : null;
        $cal['group_access_emoji'] = $cal['group_access_emoji'] !== null ? (int)$cal['group_access_emoji'] : null;
        $cal['slot_capacity'] = $cal['slot_capacity'] !== null ? (int)$cal['slot_capacity'] : null;
    }

    respond(200, [
        'status' => 'success',
        'calendars' => $calendars,
        'csrf_token' => generateCsrfToken()
    ]);
}

/**
 * Set never_expires flag for a calendar
 */
if ($action === 'admin_set_permanent' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);
    $neverExpires = (int)($_POST['never_expires'] ?? 0);

    if ($calendarId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar ID']);
    }

    // Verify calendar exists
    $stmt = $pdo->prepare("SELECT id FROM calendars WHERE id = :id");
    $stmt->execute([':id' => $calendarId]);
    if (!$stmt->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    }

    // Update never_expires flag
    $stmt = $pdo->prepare("UPDATE calendars SET never_expires = :ne WHERE id = :id");
    $stmt->execute([':ne' => $neverExpires ? 1 : 0, ':id' => $calendarId]);

    logSecurityEvent('ADMIN_SET_PERMANENT', [
        'calendar_id' => $calendarId,
        'never_expires' => $neverExpires ? 1 : 0
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a calendar (admin only)
 */
if ($action === 'admin_delete_calendar' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);

    if ($calendarId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar ID']);
    }

    // Verify calendar exists
    $stmt = $pdo->prepare("SELECT id, token, title FROM calendars WHERE id = :id");
    $stmt->execute([':id' => $calendarId]);
    $cal = $stmt->fetch();
    if (!$cal) {
        respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    }

    // Delete calendar (cascades to users, sessions, availability)
    $stmt = $pdo->prepare("DELETE FROM calendars WHERE id = :id");
    $stmt->execute([':id' => $calendarId]);

    logSecurityEvent('ADMIN_DELETE_CALENDAR', [
        'calendar_id' => $calendarId,
        'token' => $cal['token'],
        'title' => $cal['title']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Get list of all Hubs (groups) for admin panel
 */
if ($action === 'admin_groups' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $emojiCol = accessTablesReady($pdo) ? 'g.access_emoji' : 'NULL AS access_emoji';
    $sql = "
        SELECT g.id, g.token, g.title, g.organiser_name,
               g.created_at, g.last_activity, g.never_expires, g.locked_until, {$emojiCol},
               COUNT(c.id) AS calendar_count
        FROM `groups` g
        LEFT JOIN calendars c ON c.group_id = g.id
        GROUP BY g.id
        ORDER BY g.id DESC
    ";

    $stmt = $pdo->query($sql);
    $groups = $stmt->fetchAll();

    foreach ($groups as &$group) {
        $group['never_expires'] = (int)($group['never_expires'] ?? 0);
        $group['calendar_count'] = (int)($group['calendar_count'] ?? 0);
        $group['locked_seconds'] = pinLockoutRemaining($group['locked_until'] ?? null);
        $group['access_emoji'] = $group['access_emoji'] !== null ? (int)$group['access_emoji'] : null;
        unset($group['locked_until']);
    }
    unset($group);

    respond(200, [
        'status' => 'success',
        'groups' => $groups,
        'csrf_token' => generateCsrfToken()
    ]);
}

/**
 * List child calendars for a Hub (super admin only)
 */
if ($action === 'admin_group_calendars' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $groupId = (int)($_GET['group_id'] ?? 0);
    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmtG = $pdo->prepare("SELECT id FROM `groups` WHERE id = :id");
    $stmtG->execute([':id' => $groupId]);
    if (!$stmtG->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    $sql = "
        SELECT c.id, c.token, c.title, c.created_at, c.last_activity,
               COUNT(DISTINCT u.id) AS user_count
        FROM calendars c
        LEFT JOIN users u ON u.calendar_id = c.id
        WHERE c.group_id = :gid
        GROUP BY c.id
        ORDER BY c.id DESC
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':gid' => $groupId]);
    $calendars = $stmt->fetchAll();

    foreach ($calendars as &$cal) {
        $cal['user_count'] = (int)($cal['user_count'] ?? 0);
    }

    respond(200, ['status' => 'success', 'calendars' => $calendars]);
}

/**
 * Set never_expires flag for a Hub (group)
 */
if ($action === 'admin_set_group_permanent' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $groupId = (int)($_POST['group_id'] ?? 0);
    $neverExpires = (int)($_POST['never_expires'] ?? 0);

    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmt = $pdo->prepare("SELECT id FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);
    if (!$stmt->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    $stmt = $pdo->prepare("UPDATE `groups` SET never_expires = :ne WHERE id = :id");
    $stmt->execute([':ne' => $neverExpires ? 1 : 0, ':id' => $groupId]);

    logSecurityEvent('ADMIN_SET_GROUP_PERMANENT', [
        'group_id' => $groupId,
        'never_expires' => $neverExpires ? 1 : 0
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a Hub (group) ??? detaches child calendars, does not delete them
 */
if ($action === 'admin_delete_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $groupId = (int)($_POST['group_id'] ?? 0);

    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmt = $pdo->prepare("SELECT id, token, title FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);
    $group = $stmt->fetch();
    if (!$group) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    $stmt = $pdo->prepare("DELETE FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);

    logSecurityEvent('ADMIN_DELETE_GROUP', [
        'group_id' => $groupId,
        'token' => $group['token'],
        'title' => $group['title']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * List all users for a specific calendar (super admin only)
 * Returns user id, display_name, and role for inline display in admin panel.
 */
if ($action === 'admin_list_users' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAdminSession();

    $calendarId = (int)($_GET['calendar_id'] ?? 0);
    if ($calendarId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar ID']);
    }

    // Verify calendar exists
    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE id = :id");
    $stmtC->execute([':id' => $calendarId]);
    if (!$stmtC->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    }

    $stmtU = $pdo->prepare(
        "SELECT id, display_name, role, locked_until FROM users WHERE calendar_id = :cid ORDER BY role DESC, created_at ASC"
    );
    $stmtU->execute([':cid' => $calendarId]);
    $users = $stmtU->fetchAll();

    foreach ($users as &$u) {
        $u['locked_seconds'] = pinLockoutRemaining($u['locked_until'] ?? null);
        unset($u['locked_until']);
    }
    unset($u);

    respond(200, ['status' => 'success', 'users' => $users]);
}

/**
 * Clear a calendar user's PIN lockout and escalation level (super admin only)
 */
if ($action === 'admin_unlock_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);
    $userId = (int)($_POST['user_id'] ?? 0);
    if ($calendarId <= 0 || $userId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar or user ID']);
    }

    $stmtU = $pdo->prepare("SELECT id FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calendarId]);
    if (!$stmtU->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'User not found in this calendar']);
    }

    resetFailedAttempts($pdo, $userId);
    logSecurityEvent('ADMIN_UNLOCK_USER', ['calendar_id' => $calendarId, 'user_id' => $userId]);

    respond(200, ['status' => 'success']);
}

/**
 * Clear a Hub organiser's PIN lockout and escalation level (super admin only)
 */
if ($action === 'admin_unlock_group' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $groupId = (int)($_POST['group_id'] ?? 0);
    if ($groupId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid group ID']);
    }

    $stmt = $pdo->prepare("SELECT id FROM `groups` WHERE id = :id");
    $stmt->execute([':id' => $groupId]);
    if (!$stmt->fetch()) {
        respond(404, ['status' => 'error', 'message' => 'Hub not found']);
    }

    resetGroupFailedAttempts($pdo, $groupId);
    logSecurityEvent('ADMIN_UNLOCK_GROUP', ['group_id' => $groupId]);

    respond(200, ['status' => 'success']);
}

/**
 * Remove the access emoji from a calendar or Hub (super admin only), e.g. when the organiser
 * has forgotten it. Existing grants are deleted.
 */
if ($action === 'admin_set_access_emoji' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();
    if (!accessTablesReady($pdo)) respond(503, ['status' => 'error', 'message' => 'Access emoji is not available yet']);

    $kind = (string)($_POST['kind'] ?? '');
    $id = (int)($_POST['id'] ?? 0);
    if (!in_array($kind, ['calendar', 'group'], true) || $id <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid request']);
    }
    if (($_POST['emoji'] ?? null) !== null) {
        respond(400, ['status' => 'error', 'message' => 'Admins can only remove an emoji']);
    }

    $table = $kind === 'calendar' ? 'calendars' : '`groups`';
    $stmt = $pdo->prepare("SELECT id FROM {$table} WHERE id = :id");
    $stmt->execute([':id' => $id]);
    if (!$stmt->fetch()) {
        respond(404, ['status' => 'error', 'message' => $kind === 'calendar' ? 'Calendar not found' : 'Hub not found']);
    }

    accessSetEmoji($pdo, $kind, $id, null);
    logSecurityEvent('ADMIN_ACCESS_EMOJI_CLEARED', ['kind' => $kind, 'id' => $id]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a specific user from a calendar (super admin only)
 * Cascades to availability and sessions via foreign keys.
 */
if ($action === 'admin_delete_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    $calendarId = (int)($_POST['calendar_id'] ?? 0);
    $userId = (int)($_POST['user_id'] ?? 0);

    if ($calendarId <= 0 || $userId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid calendar or user ID']);
    }

    // Verify user belongs to this calendar
    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $userId, ':cid' => $calendarId]);
    $user = $stmtU->fetch();
    if (!$user) {
        respond(404, ['status' => 'error', 'message' => 'User not found in this calendar']);
    }

    // Delete user (cascades to availability and sessions)
    $stmtD = $pdo->prepare("DELETE FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtD->execute([':uid' => $userId, ':cid' => $calendarId]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calendarId]);

    logSecurityEvent('ADMIN_DELETE_USER', [
        'calendar_id' => $calendarId,
        'user_id' => $userId,
        'display_name' => $user['display_name'],
        'role' => $user['role']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Delete a specific user from a calendar (organiser only)
 * Organisers cannot delete themselves. Cascades via foreign keys.
 */
if ($action === 'delete_user' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Require organiser session
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can delete users']);
    }

    $targetId = (int)($_POST['user_id'] ?? 0);
    if ($targetId <= 0) {
        respond(400, ['status' => 'error', 'message' => 'Invalid user ID']);
    }

    // Prevent organiser from deleting themselves
    if ($targetId === (int)$session['user_id']) {
        respond(400, ['status' => 'error', 'message' => 'You cannot delete yourself. Use Reset Mine instead.']);
    }

    // Verify target user exists in this calendar
    $stmtU = $pdo->prepare("SELECT id, display_name, role FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtU->execute([':uid' => $targetId, ':cid' => $calId]);
    $targetUser = $stmtU->fetch();
    if (!$targetUser) {
        respond(404, ['status' => 'error', 'message' => 'User not found']);
    }

    // Delete user (cascades to availability and sessions)
    $stmtD = $pdo->prepare("DELETE FROM users WHERE id = :uid AND calendar_id = :cid");
    $stmtD->execute([':uid' => $targetId, ':cid' => $calId]);

    $pdo->prepare("UPDATE calendars SET last_activity = NOW() WHERE id = :cid")->execute([':cid' => $calId]);

    logSecurityEvent('ORGANISER_DELETE_USER', [
        'actor_id' => $session['user_id'],
        'target_id' => $targetId,
        'target_name' => $targetUser['display_name'],
        'calendar_id' => $calId
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Choose (lock in) a specific date+slot as the final decision (organiser only).
 * Sets chosen_date and chosen_slot on the calendar, freezing availability edits.
 */
if ($action === 'choose_slot' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Require organiser session
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can finalise a slot']);
    }
    if (bookingColumnsReady($pdo)) {
        $stmtB = $pdo->prepare("SELECT slot_capacity FROM calendars WHERE id = :cid");
        $stmtB->execute([':cid' => $calId]);
        if ($stmtB->fetchColumn() !== null) {
            respond(400, ['status' => 'error', 'message' => 'Booking calendars use Close bookings instead']);
        }
    }

    // Validate chosen_date (YYYY-MM-DD) and chosen_slot (non-empty string, max 50)
    $chosenDate = (string)($_POST['chosen_date'] ?? '');
    $chosenSlot = trim((string)($_POST['chosen_slot'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $chosenDate)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid date format']);
    }
    if ($chosenSlot === '' || mb_strlen($chosenSlot) > 50) {
        respond(400, ['status' => 'error', 'message' => 'Invalid slot']);
    }

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET chosen_date = :cd, chosen_slot = :cs, last_activity = NOW() WHERE id = :cid"
    );
    $stmtU->execute([':cd' => $chosenDate, ':cs' => $chosenSlot, ':cid' => $calId]);

    logSecurityEvent('CHOOSE_SLOT', [
        'calendar_id' => $calId,
        'actor_id' => $session['user_id'],
        'chosen_date' => $chosenDate,
        'chosen_slot' => $chosenSlot
    ]);

    respond(200, ['status' => 'success', 'chosen_date' => $chosenDate, 'chosen_slot' => $chosenSlot]);
}

/**
 * Unchoose (reopen) a previously locked-in slot (organiser only).
 * Nulls chosen_date and chosen_slot, allowing availability edits again.
 */
if ($action === 'unchoose_slot' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();

    $stmtC = $pdo->prepare("SELECT id FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];

    // Require organiser session
    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can reopen the calendar']);
    }

    $stmtU = $pdo->prepare(
        "UPDATE calendars SET chosen_date = NULL, chosen_slot = NULL, last_activity = NOW() WHERE id = :cid"
    );
    $stmtU->execute([':cid' => $calId]);

    logSecurityEvent('UNCHOOSE_SLOT', [
        'calendar_id' => $calId,
        'actor_id' => $session['user_id']
    ]);

    respond(200, ['status' => 'success']);
}

/**
 * Close or reopen bookings on a booking calendar (organiser only).
 * Closed: nobody can book or cancel; the organiser can still remove bookings and reset.
 */
if ($action === 'set_bookings_closed' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireCsrf();
    $token = requireToken();
    if (!bookingColumnsReady($pdo)) respond(400, ['status' => 'error', 'message' => 'Booking is not available yet']);

    $stmtC = $pdo->prepare("SELECT id, slot_capacity FROM calendars WHERE token = :t");
    $stmtC->execute([':t' => $token]);
    $cal = $stmtC->fetch();
    if (!$cal) respond(404, ['status' => 'error', 'message' => 'Calendar not found']);
    $calId = (int)$cal['id'];
    if ($cal['slot_capacity'] === null) respond(400, ['status' => 'error', 'message' => 'Not a booking calendar']);

    $session = requireSession($pdo, $calId);
    if ($session['role'] !== 'admin') {
        respond(403, ['status' => 'error', 'message' => 'Only the organiser can close bookings']);
    }

    $closed = !empty($_POST['closed']) ? 1 : 0;
    $pdo->prepare("UPDATE calendars SET bookings_closed = :c, last_activity = NOW() WHERE id = :cid")
        ->execute([':c' => $closed, ':cid' => $calId]);

    logSecurityEvent($closed ? 'BOOKINGS_CLOSED' : 'BOOKINGS_REOPENED', [
        'calendar_id' => $calId,
        'actor_id' => $session['user_id'],
    ]);

    respond(200, ['status' => 'success', 'bookings_closed' => (bool)$closed]);
}

/**
 * Public endpoint: return site config from the DB so index.js can
 * hydrate the setup page with admin-customised defaults.
 * No auth required - read-only public data, contains no secrets.
 * Falls back gracefully (returns empty object) if the table does not exist yet.
 */
if ($action === 'get_site_config' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    // Optional features whose migrations have been applied
    $features = [
        'access_emoji' => accessTablesReady($pdo),
        'booking' => bookingColumnsReady($pdo),
        'booking_total' => bookingColumnsReady($pdo) && bookingTotalColumnReady($pdo),
        'booking_styles' => bookingColumnsReady($pdo) && bookingStyleColumnsReady($pdo),
    ];
    try {
        $stmt = $pdo->query("SELECT config_json FROM site_config WHERE id = 1 LIMIT 1");
        $row  = $stmt->fetch();
    } catch (Throwable $e) {
        // Table may not exist yet - silently return empty so index.js uses hardcoded defaults
        respond(200, ['status' => 'success', 'config' => new stdClass(), 'features' => $features]);
    }

    if (!$row || empty($row['config_json'])) {
        respond(200, ['status' => 'success', 'config' => new stdClass(), 'features' => $features]);
    }

    $cfg = json_decode((string)$row['config_json'], true);
    if (!is_array($cfg)) {
        respond(200, ['status' => 'success', 'config' => new stdClass(), 'features' => $features]);
    }

    respond(200, ['status' => 'success', 'config' => $cfg, 'features' => $features]);
}

/**
 * Admin endpoint: validate and persist site config to the DB.
 * Requires admin session token + CSRF.
 *
 * Validated structure:
 *  - slots.max: int >= 1 (no upper limit)
 *  - slots.examples: string[]                      max 30 items, 20 chars each
 *  - slots.defaults: string[]                      up to slots.max items
 *  - options.max: int >= 1 (no upper limit)
 *  - options.presets: [{key, label, items[]}]      max 20 presets
 *  - options.defaults: [{label, weight}]           max 5
 *  - dates.max_range_days: int 1-365
 *  - dates.presets: [{key, label, days}]           max 20
 *  - retention.inactive_days: int 1-3650           (calendar auto-delete threshold)
 *  - retention.hub_inactive_days: int 1-3650       (Hub auto-delete threshold)
 */
if ($action === 'admin_save_config' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    requireAdminSession();
    requireCsrf();

    // Parse incoming config from POST body.
    // apiRequest sends {config: object} as JSON; readJsonBody decodes the outer
    // envelope so $_POST['config'] arrives as an array directly.
    $incoming = $_POST['config'] ?? null;
    if (is_string($incoming)) {
        // Fallback: handle legacy double-encoded string just in case
        $incoming = json_decode($incoming, true);
    }
    if (!is_array($incoming)) {
        respond(400, ['status' => 'error', 'message' => 'Invalid config payload']);
    }

    // --- Sanitiser helpers ---
    $sanitiseStr = function($v, int $max = 50): string {
        $s = trim((string)($v ?? ''));
        // Strip non-printable ASCII and HTML-dangerous characters
        $s = preg_replace('/[^\x20-\x7E]/', '', $s);
        $s = str_replace(['<', '>', '"', "'"], '', $s);
        return mb_substr($s, 0, $max);
    };

    $sanitiseKey = function($v): string {
        // Keys stored in JSON: alphanumeric + underscores only
        return preg_replace('/[^a-zA-Z0-9_]/', '', (string)($v ?? ''));
    };

    $cfg = [];

    // --- slots ---
    $rawSlots = is_array($incoming['slots'] ?? null) ? $incoming['slots'] : [];
    $slotsMax = max(1, (int)($rawSlots['max'] ?? 6));

    $rawExamples = is_array($rawSlots['examples'] ?? null) ? $rawSlots['examples'] : [];
    $slotExamples = [];
    foreach (array_slice($rawExamples, 0, 30) as $e) {
        $s = $sanitiseStr($e, 20);
        if ($s !== '') $slotExamples[] = $s;
    }

    $rawDefaults = is_array($rawSlots['defaults'] ?? null) ? $rawSlots['defaults'] : [];
    $slotDefaults = [];
    foreach (array_slice($rawDefaults, 0, $slotsMax) as $d) {
        $s = $sanitiseStr($d, 20);
        if ($s !== '') $slotDefaults[] = $s;
    }
    if (empty($slotDefaults)) $slotDefaults = ['Morning', 'Afternoon', 'Evening'];

    $cfg['slots'] = [
        'max'      => $slotsMax,
        'examples' => $slotExamples,
        'defaults' => $slotDefaults,
    ];

    // --- options ---
    $rawOpts = is_array($incoming['options'] ?? null) ? $incoming['options'] : [];
    $optsMax = max(1, (int)($rawOpts['max'] ?? 5));

    $rawPresets = is_array($rawOpts['presets'] ?? null) ? $rawOpts['presets'] : [];
    $optPresets = [];
    foreach (array_slice($rawPresets, 0, 20) as $p) {
        if (!is_array($p)) continue;
        $key   = $sanitiseKey($p['key']   ?? '');
        $label = $sanitiseStr($p['label'] ?? '', 60);
        $rawItems = is_array($p['items'] ?? null) ? $p['items'] : [];
        $items = [];
        foreach (array_slice($rawItems, 0, 5) as $item) {
            if (!is_array($item)) continue;
            $il = $sanitiseStr($item['label'] ?? '', 20);
            $iw = max(0, min(5, (int)($item['weight'] ?? 0)));
            if ($il !== '') $items[] = ['label' => $il, 'weight' => $iw];
        }
        if ($key !== '' && $label !== '' && !empty($items)) {
            $optPresets[] = ['key' => $key, 'label' => $label, 'items' => $items];
        }
    }

    $rawOptDef = is_array($rawOpts['defaults'] ?? null) ? $rawOpts['defaults'] : [];
    $optDefaults = [];
    foreach (array_slice($rawOptDef, 0, $optsMax) as $item) {
        if (!is_array($item)) continue;
        $il = $sanitiseStr($item['label'] ?? '', 20);
        $iw = max(0, min(5, (int)($item['weight'] ?? 0)));
        if ($il !== '') $optDefaults[] = ['label' => $il, 'weight' => $iw];
    }
    if (empty($optDefaults)) {
        $optDefaults = [
            ['label' => 'Yes',   'weight' => 2],
            ['label' => 'Maybe', 'weight' => 1],
            ['label' => 'No',    'weight' => 0],
        ];
    }

    $cfg['options'] = [
        'max'      => $optsMax,
        'presets'  => $optPresets,
        'defaults' => $optDefaults,
    ];

    // --- dates ---
    $rawDates = is_array($incoming['dates'] ?? null) ? $incoming['dates'] : [];
    $maxRange = max(1, min(365, (int)($rawDates['max_range_days'] ?? 360)));

    $rawDatePresets = is_array($rawDates['presets'] ?? null) ? $rawDates['presets'] : [];
    $datePresets = [];
    foreach (array_slice($rawDatePresets, 0, 20) as $dp) {
        if (!is_array($dp)) continue;
        $key   = $sanitiseKey($dp['key']   ?? '');
        $label = $sanitiseStr($dp['label'] ?? '', 30);
        $days  = max(0, min(365, (int)($dp['days'] ?? 0)));
        if ($key !== '' && $label !== '') {
            $datePresets[] = ['key' => $key, 'label' => $label, 'days' => $days];
        }
    }

    $cfg['dates'] = [
        'max_range_days' => $maxRange,
        'presets'        => $datePresets,
    ];

    // --- retention (auto-delete) ---
    // inactive_days: number of days a non-permanent calendar can sit without
    // any Submit/Save (last_activity update) before cleanup.php removes it.
    // hub_inactive_days: same rule for Hubs (separate threshold).
    // Permanent calendars/Hubs (never_expires = 1) are always protected by cleanup.php.
    $rawRetention = is_array($incoming['retention'] ?? null) ? $incoming['retention'] : [];
    $inactiveDays = (int)($rawRetention['inactive_days'] ?? 30);
    if ($inactiveDays < 1)    $inactiveDays = 1;
    if ($inactiveDays > 3650) $inactiveDays = 3650;

    $hubInactiveDays = (int)($rawRetention['hub_inactive_days'] ?? 30);
    if ($hubInactiveDays < 1)    $hubInactiveDays = 1;
    if ($hubInactiveDays > 3650) $hubInactiveDays = 3650;

    $cfg['retention'] = [
        'inactive_days' => $inactiveDays,
        'hub_inactive_days' => $hubInactiveDays,
    ];

    // Encode and upsert into site_config table (single enforced row, id = 1).
    // INSERT ... ON DUPLICATE KEY UPDATE handles both first-save and updates.
    $encoded = json_encode($cfg, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        respond(500, ['status' => 'error', 'message' => 'Failed to encode config']);
    }

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO site_config (id, config_json)
             VALUES (1, :json)
             ON DUPLICATE KEY UPDATE config_json = :json2, updated_at = NOW()"
        );
        $stmt->execute([':json' => $encoded, ':json2' => $encoded]);
    } catch (Throwable $e) {
        respond(500, ['status' => 'error', 'message' => 'DB write failed: ' . $e->getMessage()]);
    }

    logSecurityEvent('ADMIN_SAVE_CONFIG', ['sections' => array_keys($cfg)]);

    respond(200, ['status' => 'success', 'message' => 'Config saved']);
}


respond(404, ['status' => 'error', 'message' => 'Unknown action']);
