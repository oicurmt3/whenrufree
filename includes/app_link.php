<?php
/**
 * includes/app_link.php - Hand a browser sign-in over to the Android app.
 *
 * The site signs people in with a browser cookie, and Google refuses to run its
 * sign-in inside an embedded WebView. So the app opens a normal browser tab; once
 * the person is signed in there, the site makes a short-lived one-time code and
 * sends it back to the app. The app swaps that code for a normal session token
 * (the same value the browser keeps in its cookie) and sends it as a cookie itself.
 *
 * Codes are random, single-use, hashed at rest, and expire after APP_LINK_TTL
 * seconds, so a leaked code is useless a few minutes later.
 */

declare(strict_types=1);

/** How long a handoff code stays valid, in seconds. */
const APP_LINK_TTL = 300;

/** Newest codes per account to keep around (older ones are pruned on mint). */
const APP_LINK_KEEP = 5;

function appLinkEnsureTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `account_app_links` (
            `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `account_id` BIGINT UNSIGNED NOT NULL,
            `code_hash` BINARY(32) NOT NULL,
            `created_at` DATETIME NOT NULL,
            `expires_at` DATETIME NOT NULL,
            `used_at` DATETIME NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `uq_account_app_links_hash` (`code_hash`),
            KEY `idx_account_app_links_account` (`account_id`),
            CONSTRAINT `fk_account_app_links_account`
                FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/** Create a one-time code for this account and return it in plain text (only once). */
function appLinkMint(PDO $pdo, int $accountId): string {
    appLinkEnsureTable($pdo);

    // Drop this account's dead codes so the table cannot grow without bound.
    $pdo->prepare(
        "DELETE FROM `account_app_links`
          WHERE `account_id` = :aid AND (`used_at` IS NOT NULL OR `expires_at` < :now)"
    )->execute([':aid' => $accountId, ':now' => accountNow()]);

    $code = bin2hex(random_bytes(16));
    $pdo->prepare(
        "INSERT INTO `account_app_links` (`account_id`, `code_hash`, `created_at`, `expires_at`)
         VALUES (:aid, :hash, :now, :exp)"
    )->execute([
        ':aid' => $accountId,
        ':hash' => hash('sha256', $code, true),
        ':now' => accountNow(),
        ':exp' => date('Y-m-d H:i:s', time() + APP_LINK_TTL),
    ]);

    return $code;
}

/**
 * Redeem a code: returns a fresh session token, or null when the code is unknown,
 * already used, or expired. Exactly one caller can win because the row is locked.
 */
function appLinkExchange(PDO $pdo, string $code): ?string {
    if (!preg_match('/^[a-f0-9]{32}$/', $code)) return null;
    appLinkEnsureTable($pdo);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            "SELECT `id`, `account_id` FROM `account_app_links`
              WHERE `code_hash` = :hash AND `used_at` IS NULL AND `expires_at` > :now
              LIMIT 1 FOR UPDATE"
        );
        $stmt->execute([':hash' => hash('sha256', $code, true), ':now' => accountNow()]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            $pdo->rollBack();
            return null;
        }

        $now = accountNow();
        $pdo->prepare("UPDATE `account_app_links` SET `used_at` = :now WHERE `id` = :id")
            ->execute([':now' => $now, ':id' => (int)$row['id']]);

        $token = bin2hex(random_bytes(32));
        $expires = time() + ACCOUNT_SESSION_DAYS * 86400;
        $pdo->prepare(
            "INSERT INTO `account_sessions` (`account_id`, `token_hash`, `created_at`, `expires_at`)
             VALUES (:aid, :hash, :now, :exp)"
        )->execute([
            ':aid' => (int)$row['account_id'],
            ':hash' => hash('sha256', $token, true),
            ':now' => $now,
            ':exp' => date('Y-m-d H:i:s', $expires),
        ]);
        $pdo->prepare("UPDATE `accounts` SET `last_seen_at` = :now WHERE `id` = :id")
            ->execute([':now' => $now, ':id' => (int)$row['account_id']]);

        $pdo->commit();
        return $token;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}
