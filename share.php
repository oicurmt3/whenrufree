<?php
/**
 * share.php – Dynamic OG/social preview endpoint for shared calendar links.
 *
 * Usage: https://whenrufree.net/share.php?c=TOKEN
 *
 * Social crawlers (WhatsApp, iMessage, Slack, Twitter, etc.) fetch this URL,
 * read the OG meta tags, and display a rich preview card with the real calendar
 * title. Human visitors are redirected immediately to calendar.html?c=TOKEN
 * via both <meta http-equiv="refresh"> and a JS redirect, so they never notice
 * the detour.
 *
 * This file is intentionally minimal – it only reads the calendar title and
 * category. No auth, no CSRF, no sensitive data is exposed.
 */

declare(strict_types=1);

// ── Token validation ──────────────────────────────────────────────────────────
$token = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)($_GET['c'] ?? ''));

if ($token === '') {
    header('Location: index.html', true, 302);
    exit;
}

$calUrl = 'https://whenrufree.net/calendar.html?c=' . urlencode($token);
$ogUrl  = 'https://whenrufree.net/share.php?c='     . urlencode($token);

// ── Defaults (used when DB lookup fails) ─────────────────────────────────────
$ogTitle = 'When RU Free – Group Availability Calendar';
$ogDesc  = 'Join this shared availability calendar. Mark when you\'re free and find the best time for your group. No sign-up required.';

// ── DB lookup ─────────────────────────────────────────────────────────────────
try {
    $configPath = '/home/perthrel/grape_private/config.php';
    if (is_file($configPath)) {
        /** @var array $config */
        $config  = require $configPath;
        $db      = $config['db'] ?? [];
        $host    = (string)($db['host']    ?? 'localhost');
        $name    = (string)($db['name']    ?? '');
        $charset = (string)($db['charset'] ?? 'utf8mb4');
        $user    = (string)($db['user']    ?? '');
        $pass    = (string)($db['pass']    ?? '');

        if ($name !== '' && $user !== '') {
            $pdo  = new PDO(
                "mysql:host={$host};dbname={$name};charset={$charset}",
                $user, $pass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                 PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
            $stmt = $pdo->prepare("SELECT title FROM calendars WHERE token = :t LIMIT 1");
            $stmt->execute([':t' => $token]);
            $row  = $stmt->fetch();

            if ($row && trim((string)($row['title'] ?? '')) !== '') {
                $calTitle = trim((string)$row['title']);
                $ogTitle  = $calTitle . ' – When RU Free';
                $ogDesc   = 'Join the "' . $calTitle . '" availability calendar. Mark when you\'re free and find the best time for your group.';
            }
        }
    }
} catch (Throwable $e) {
    // Silently fall back to defaults – never expose DB errors
}

// ── Escape for HTML output ─────────────────────────────────────────────────────
$ogTitleHtml = htmlspecialchars($ogTitle, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$ogDescHtml  = htmlspecialchars($ogDesc,  ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$calUrlHtml  = htmlspecialchars($calUrl,  ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$ogUrlHtml   = htmlspecialchars($ogUrl,   ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

// ── Output ────────────────────────────────────────────────────────────────────
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta http-equiv="refresh" content="0; url=<?= $calUrlHtml ?>">
  <title><?= $ogTitleHtml ?></title>
  <meta name="description" content="<?= $ogDescHtml ?>">
  <meta name="theme-color" content="#3f51b5">

  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="<?= $ogUrlHtml ?>">
  <meta property="og:title"       content="<?= $ogTitleHtml ?>">
  <meta property="og:description" content="<?= $ogDescHtml ?>">
  <meta property="og:image"       content="https://whenrufree.net/og-image.png">
  <meta property="og:site_name"   content="When RU Free">

  <!-- Twitter / X Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="<?= $ogTitleHtml ?>">
  <meta name="twitter:description" content="<?= $ogDescHtml ?>">
  <meta name="twitter:image"       content="https://whenrufree.net/og-image.png">
</head>
<body>
  <script>window.location.replace(<?= json_encode($calUrl) ?>);</script>
</body>
</html>
