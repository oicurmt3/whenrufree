<?php
/**
 * cleanup.php - Grape Calendar Maintenance Script
 *
 * Run via cron (recommended: daily at low-traffic hours).
 * Example crontab entry:
 *   0 3 * * * /usr/bin/php /path/to/cleanup.php >> /var/log/grape_cleanup.log 2>&1
 *
 * Responsibilities:
 *  1) Delete calendars inactive for N days (based on last_activity/created_at).
 *     The retention threshold is read from the site_config table first
 *     (Admin -> Setup Page -> Auto-delete), then falls back to
 *     $config['retention']['inactive_days'] in config.php, then 40 days.
 *     Calendars with never_expires = 1 are always protected.
 *  2) Delete Hubs inactive for M days (separate threshold: hub_inactive_days).
 *     Hub last_activity is updated by Hub management actions, by Submit/Save
 *     on linked calendars, and when a calendar is opened from the Hub page. Child calendars are detached, not deleted.
 *     Hubs with never_expires = 1 are always protected.
 *  3) Delete expired user sessions
 *  4) Delete old API rate limit entries (auto-prune to prevent table bloat)
 *  5) Reset expired PIN lockouts (cleanup failed_attempts/locked_until)
 *  6) Delete expired Hub sessions
 *  7) Reset expired Hub organiser PIN lockouts
 *  8) Reset PIN lockout escalation (lockout_level) after 30 days without a lockout
 *  9) Access emoji: delete expired or orphaned grants, and wrong-pick rows after 30 quiet days
 *
 * Security Notes:
 *  - This script should NOT be web-accessible. Place outside webroot or protect via .htaccess.
 *  - Run with appropriate filesystem permissions (read config, write logs).
 *
 * @version 1.1.0 - Phase 1 improvements: enhanced rate_limit pruning
 */

declare(strict_types=1);

// -------------------------------------------------------------------------
// CLI-only guard - block web access even if .htaccess is bypassed
// -------------------------------------------------------------------------
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    echo 'Forbidden';
    exit(1);
}

// -------------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------------

// Try private config location first (production), fallback to local (dev)
$configPath = '/home/perthrel/grape_private/config.php';
if (!is_file($configPath)) {
    $configPath = __DIR__ . '/config.php';
}

if (!is_file($configPath)) {
    fwrite(STDERR, "ERROR: Missing config.php\n");
    exit(1);
}

/** @var array $config */
$config = require $configPath;

// -------------------------------------------------------------------------
// Database Connection
// -------------------------------------------------------------------------

/**
 * Creates a PDO connection to the database.
 *
 * @param array $config Application configuration array
 * @return PDO Database connection
 * @throws RuntimeException If configuration is incomplete
 */
function pdo(array $config): PDO {
    $db = $config['db'] ?? [];
    $host = (string)($db['host'] ?? 'localhost');
    $name = (string)($db['name'] ?? '');
    $charset = (string)($db['charset'] ?? 'utf8mb4');
    $user = (string)($db['user'] ?? '');
    $pass = (string)($db['pass'] ?? '');

    if ($name === '' || $user === '') {
        throw new RuntimeException('Database configuration incomplete');
    }

    $dsn = "mysql:host={$host};dbname={$name};charset={$charset}";
    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}

try {
    $pdo = pdo($config);
} catch (Throwable $e) {
    fwrite(STDERR, "ERROR: DB connection failed - " . $e->getMessage() . "\n");
    exit(1);
}

// -------------------------------------------------------------------------
// Configuration Defaults
// -------------------------------------------------------------------------

// Calendar retention: delete calendars with no activity for this many days.
//
// Resolution order (admin-controlled wins over server config):
//   1. site_config table (set via Admin -> Setup Page -> Auto-delete)
//   2. config.php -> $config['retention']['inactive_days']
//   3. Hardcoded default (40 days)
//
// Calendars with never_expires = 1 (Permanent) are always protected
// regardless of this setting (see WHERE clause below).
$retentionDays = 0;
$retentionSource = 'default';
$hubRetentionDays = 0;
$hubRetentionSource = 'default';
$siteCfg = null;

try {
    $stmtCfg = $pdo->query("SELECT config_json FROM site_config WHERE id = 1 LIMIT 1");
    $cfgRow  = $stmtCfg ? $stmtCfg->fetch() : null;
    if ($cfgRow && !empty($cfgRow['config_json'])) {
        $siteCfg = json_decode((string)$cfgRow['config_json'], true);
        if (is_array($siteCfg) && isset($siteCfg['retention']['inactive_days'])) {
            $candidate = (int)$siteCfg['retention']['inactive_days'];
            if ($candidate >= 1 && $candidate <= 3650) {
                $retentionDays   = $candidate;
                $retentionSource = 'site_config (admin)';
            }
        }
        if (is_array($siteCfg) && isset($siteCfg['retention']['hub_inactive_days'])) {
            $hubCandidate = (int)$siteCfg['retention']['hub_inactive_days'];
            if ($hubCandidate >= 1 && $hubCandidate <= 3650) {
                $hubRetentionDays   = $hubCandidate;
                $hubRetentionSource = 'site_config (admin)';
            }
        }
    }
} catch (Throwable $e) {
    // Table may not exist yet on a fresh install - silently fall through.
}

if ($retentionDays < 1) {
    $retentionDays   = (int)($config['retention']['inactive_days'] ?? 40);
    $retentionSource = 'config.php';
}
if ($retentionDays < 1) {
    $retentionDays   = 40;
    $retentionSource = 'hardcoded default';
}

if ($hubRetentionDays < 1) {
    $hubRetentionDays   = (int)($config['retention']['hub_inactive_days'] ?? 0);
    $hubRetentionSource = 'config.php';
}
if ($hubRetentionDays < 1) {
    $hubRetentionDays   = $retentionDays;
    $hubRetentionSource = 'calendar retention fallback';
}

// Rate limit pruning: delete entries older than this many minutes
// Default: 60 minutes (1 hour) - keeps table small while allowing burst detection
$rateLimitRetentionMinutes = (int)($config['rate_limit']['retention_minutes'] ?? 60);
if ($rateLimitRetentionMinutes < 5) {
    $rateLimitRetentionMinutes = 60; // Minimum 5 minutes, default 60
}

// -------------------------------------------------------------------------
// Cleanup Operations
// -------------------------------------------------------------------------

$stats = [
    'calendars_deleted' => 0,
    'hubs_deleted' => 0,
    'sessions_deleted' => 0,
    'rate_limits_deleted' => 0,
    'lockouts_reset' => 0,
    'lockout_levels_reset' => 0,
    'access_grants_deleted' => 0,
    'access_attempts_deleted' => 0,
    'errors' => [],
];

echo "=== Grape Calendar Cleanup - " . date('Y-m-d H:i:s T') . " ===\n";
echo "Config: calendar_retention={$retentionDays} days (source: {$retentionSource}), hub_retention={$hubRetentionDays} days (source: {$hubRetentionSource}), rate_limit_prune={$rateLimitRetentionMinutes} min\n\n";

// 1. Delete inactive calendars
// -----------------------------------------------------------------------------
// Calendars are deleted if:
//   - never_expires is FALSE (0), AND
//   - last_activity is NULL AND created_at is older than retention period, OR
//   - last_activity is older than retention period
// Foreign key cascades will automatically delete associated users, sessions, and availability.
// Note: Calendars with never_expires = 1 are protected from automatic deletion.
try {
    $sqlCalendars = "
        DELETE FROM calendars
        WHERE
            never_expires = 0
            AND (
                (last_activity IS NULL AND created_at < (NOW() - INTERVAL :days DAY))
                OR
                (last_activity IS NOT NULL AND last_activity < (NOW() - INTERVAL :days DAY))
            )
    ";
    $stmt = $pdo->prepare($sqlCalendars);
    $stmt->execute([':days' => $retentionDays]);
    $stats['calendars_deleted'] = $stmt->rowCount();
    echo "[1] Calendars deleted (inactive >{$retentionDays} days): {$stats['calendars_deleted']}\n";

    // Count permanent calendars for reference
    $stmtPerm = $pdo->query("SELECT COUNT(*) AS cnt FROM calendars WHERE never_expires = 1");
    $permCount = (int)($stmtPerm->fetch()['cnt'] ?? 0);
    echo "    (Permanent calendars protected: {$permCount})\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Calendars: " . $e->getMessage();
    echo "[1] ERROR deleting calendars: " . $e->getMessage() . "\n";
}

// 2. Delete inactive Hubs (groups)
// -----------------------------------------------------------------------------
// Hubs are deleted if:
//   - never_expires is FALSE (0), AND
//   - last_activity is NULL AND created_at is older than hub retention period, OR
//   - last_activity is older than hub retention period
// Child calendars are detached (group_id set NULL) via FK ON DELETE SET NULL.
// Hubs with never_expires = 1 are protected from automatic deletion.
try {
    $sqlGroups = "
        DELETE FROM `groups`
        WHERE
            never_expires = 0
            AND (
                (last_activity IS NULL AND created_at < (NOW() - INTERVAL :days DAY))
                OR
                (last_activity IS NOT NULL AND last_activity < (NOW() - INTERVAL :days DAY))
            )
    ";
    $stmt = $pdo->prepare($sqlGroups);
    $stmt->execute([':days' => $hubRetentionDays]);
    $stats['hubs_deleted'] = $stmt->rowCount();
    echo "[2] Hubs deleted (inactive >{$hubRetentionDays} days): {$stats['hubs_deleted']}\n";

    $stmtPermHub = $pdo->query("SELECT COUNT(*) AS cnt FROM `groups` WHERE never_expires = 1");
    $permHubCount = (int)($stmtPermHub->fetch()['cnt'] ?? 0);
    echo "    (Permanent Hubs protected: {$permHubCount})\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Hubs: " . $e->getMessage();
    echo "[2] ERROR deleting Hubs: " . $e->getMessage() . "\n";
}

// 3. Delete expired user sessions
// -----------------------------------------------------------------------------
// Sessions have an expires_at timestamp. Clean up any that have passed.
try {
    $stmt = $pdo->prepare("DELETE FROM user_sessions WHERE expires_at < NOW()");
    $stmt->execute();
    $stats['sessions_deleted'] = $stmt->rowCount();
    echo "[3] Sessions deleted (expired): {$stats['sessions_deleted']}\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Sessions: " . $e->getMessage();
    echo "[3] ERROR deleting sessions: " . $e->getMessage() . "\n";
}

// 4. Auto-prune API rate limit table
// -----------------------------------------------------------------------------
// The api_rate_limit table can grow quickly with high traffic. This cleanup
// removes old entries to prevent table bloat and maintain query performance.
// Rate limiting is per-minute based, so entries older than 1 hour are stale.
try {
    $stmt = $pdo->prepare("DELETE FROM api_rate_limit WHERE updated_at < (NOW() - INTERVAL :mins MINUTE)");
    $stmt->execute([':mins' => $rateLimitRetentionMinutes]);
    $stats['rate_limits_deleted'] = $stmt->rowCount();
    echo "[4] Rate limit entries pruned (>{$rateLimitRetentionMinutes} min old): {$stats['rate_limits_deleted']}\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Rate limits: " . $e->getMessage();
    echo "[4] ERROR pruning rate limits: " . $e->getMessage() . "\n";
}

// 5. Reset expired PIN lockouts
// -----------------------------------------------------------------------------
// Users locked due to failed PIN attempts have locked_until set.
// Once that time passes, reset their failed_attempts counter.
// This is a safety cleanup - the API also resets on next valid request.
try {
    $stmt = $pdo->prepare("
        UPDATE users 
        SET failed_attempts = 0, locked_until = NULL 
        WHERE locked_until IS NOT NULL AND locked_until < NOW()
    ");
    $stmt->execute();
    $stats['lockouts_reset'] = $stmt->rowCount();
    echo "[5] Lockouts reset (expired): {$stats['lockouts_reset']}\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Lockouts: " . $e->getMessage();
    echo "[5] ERROR resetting lockouts: " . $e->getMessage() . "\n";
}

// 6. Delete expired group (Hub) sessions
try {
    $stmt = $pdo->prepare("DELETE FROM group_sessions WHERE expires_at < NOW()");
    $stmt->execute();
    $groupSessionsDeleted = $stmt->rowCount();
    echo "[6] Group sessions deleted (expired): {$groupSessionsDeleted}\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Group sessions: " . $e->getMessage();
    echo "[6] ERROR deleting group sessions: " . $e->getMessage() . "\n";
}

// 7. Reset expired Hub organiser PIN lockouts
try {
    $stmt = $pdo->prepare("
        UPDATE `groups`
        SET failed_attempts = 0, locked_until = NULL
        WHERE locked_until IS NOT NULL AND locked_until < NOW()
    ");
    $stmt->execute();
    $groupLockoutsReset = $stmt->rowCount();
    echo "[7] Hub lockouts reset (expired): {$groupLockoutsReset}\n";
} catch (Throwable $e) {
    $stats['errors'][] = "Hub lockouts: " . $e->getMessage();
    echo "[7] ERROR resetting hub lockouts: " . $e->getMessage() . "\n";
}

// 8. Forget PIN lockout escalation after a quiet period
// -----------------------------------------------------------------------------
// Steps 5 and 7 keep lockout_level so repeat offenders get longer locks. After
// pin_lockout.reset_after_days (default 30) without a new lockout, start again at 5 minutes.
$lockoutResetDays = max(1, (int)($config['pin_lockout']['reset_after_days'] ?? 30));
foreach (['users' => 'users', 'groups' => '`groups`'] as $label => $table) {
    try {
        try {
            $pdo->query("SELECT lockout_level FROM {$table} LIMIT 0");
        } catch (PDOException $e) {
            echo "[8] Lockout levels ({$label}): skipped - run migrations/002_escalating_lockout.sql\n";
            continue;
        }
        $stmt = $pdo->prepare("
            UPDATE {$table}
            SET lockout_level = 0
            WHERE lockout_level > 0
              AND (locked_until IS NULL OR locked_until < NOW())
              AND (last_locked_at IS NULL OR last_locked_at < DATE_SUB(NOW(), INTERVAL :days DAY))
        ");
        $stmt->execute([':days' => $lockoutResetDays]);
        $stats['lockout_levels_reset'] += $stmt->rowCount();
        echo "[8] Lockout levels reset ({$label}, >{$lockoutResetDays} days quiet): {$stmt->rowCount()}\n";
    } catch (Throwable $e) {
        $stats['errors'][] = "Lockout levels ({$label}): " . $e->getMessage();
        echo "[8] ERROR resetting lockout levels ({$label}): " . $e->getMessage() . "\n";
    }
}

// 9. Access emoji grants and wrong-pick counters
// -----------------------------------------------------------------------------
// Grants and lock times are written with PHP time by includes/access.php, so compare with PHP
// time here too. Grants for deleted calendars/Hubs go straight away; wrong-pick rows (and their
// escalation level) are forgotten after access_emoji.attempts_keep_days (default 30) without a
// wrong pick, once any lock has ended.
try {
    $accessReady = true;
    try {
        $pdo->query("SELECT token_hash FROM access_grants LIMIT 0");
        $pdo->query("SELECT lockout_level FROM access_attempts LIMIT 0");
    } catch (PDOException $e) {
        $accessReady = false;
        echo "[9] Access emoji: skipped - run migrations/003_access_emoji.sql\n";
    }
    if ($accessReady) {
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("DELETE FROM access_grants WHERE expires_at < :now");
        $stmt->execute([':now' => $now]);
        $stats['access_grants_deleted'] = $stmt->rowCount();

        $stats['access_grants_deleted'] += $pdo->exec("
            DELETE FROM access_grants
            WHERE (kind = 'calendar' AND NOT EXISTS (SELECT 1 FROM calendars c WHERE c.id = access_grants.subject_id))
               OR (kind = 'group' AND NOT EXISTS (SELECT 1 FROM `groups` g WHERE g.id = access_grants.subject_id))
        ");
        echo "[9] Access grants deleted (expired or orphaned): {$stats['access_grants_deleted']}\n";

        $attemptsKeepDays = max(1, (int)($config['access_emoji']['attempts_keep_days'] ?? 30));
        $stmt = $pdo->prepare("
            DELETE FROM access_attempts
            WHERE (locked_until IS NULL OR locked_until < :now)
              AND updated_at < :cutoff
        ");
        $stmt->execute([':now' => $now, ':cutoff' => date('Y-m-d H:i:s', time() - $attemptsKeepDays * 86400)]);
        $stats['access_attempts_deleted'] = $stmt->rowCount();
        echo "[9] Access wrong-pick rows deleted (>{$attemptsKeepDays} days quiet): {$stats['access_attempts_deleted']}\n";
    }
} catch (Throwable $e) {
    $stats['errors'][] = "Access emoji: " . $e->getMessage();
    echo "[9] ERROR cleaning access emoji data: " . $e->getMessage() . "\n";
}

// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

echo "\n=== Cleanup Summary ===\n";
echo "Calendars deleted:     {$stats['calendars_deleted']}\n";
echo "Hubs deleted:          {$stats['hubs_deleted']}\n";
echo "Sessions deleted:      {$stats['sessions_deleted']}\n";
echo "Rate limits pruned:    {$stats['rate_limits_deleted']}\n";
echo "Lockouts reset:        {$stats['lockouts_reset']}\n";
echo "Lockout levels reset:  {$stats['lockout_levels_reset']}\n";
echo "Access grants deleted: {$stats['access_grants_deleted']}\n";
echo "Access picks deleted:  {$stats['access_attempts_deleted']}\n";

if (!empty($stats['errors'])) {
    echo "\nErrors encountered:\n";
    foreach ($stats['errors'] as $err) {
        echo "  - {$err}\n";
    }
    exit(1);
}

echo "\nCleanup completed successfully.\n";
exit(0);