<?php
/**
 * includes/webauthn.php - Passkey (fingerprint / face / device screen lock) helpers.
 *
 * Minimal WebAuthn verifier with no Composer dependencies. Supports ES256 (P-256)
 * and RS256 public keys, attestation "none". Adapted from the loyalty app.
 *
 * A passkey subject is an account:
 *   ['kind' => 'account', 'id' => accounts.id, 'name' => string, 'context' => string]
 *
 * Account passkeys are discoverable, so signing in needs no username: the device offers the
 * passkeys it holds for this site and the server finds the account from the credential ID.
 */

declare(strict_types=1);

const WEBAUTHN_MAX_PER_SUBJECT = 10;
const WEBAUTHN_CHALLENGE_TTL = 300;
const WEBAUTHN_ALG_ES256 = -7;
const WEBAUTHN_ALG_RS256 = -257;

function webauthnFail(string $message, int $status = 400, ?string $code = null): void {
    $payload = ['status' => 'error', 'message' => $message];
    if ($code !== null) $payload['code'] = $code;
    respond($status, $payload);
}

/** Relying-party ID: config webauthn.rp_id, else the request host without port. */
function webauthnRpId(array $config): string {
    $configured = strtolower(trim((string)($config['webauthn']['rp_id'] ?? '')));
    if ($configured !== '') return $configured;

    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $host = preg_replace('/:\d+$/', '', $host) ?? '';
    if ($host === '' || !preg_match('/^[a-z0-9.-]+$/', $host)) {
        webauthnFail('Server misconfigured', 500);
    }
    return $host;
}

/** Expected browser origin: config webauthn.origin, else scheme + request host. */
function webauthnOrigin(array $config): string {
    $configured = rtrim(trim((string)($config['webauthn']['origin'] ?? '')), '/');
    if ($configured !== '') return $configured;

    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '' || !preg_match('/^[a-z0-9.-]+(:\d+)?$/', $host)) {
        webauthnFail('Server misconfigured', 500);
    }
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on';
    return ($https ? 'https' : 'http') . '://' . $host;
}

function webauthnB64uEncode(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function webauthnB64uDecode(string $b64u): string {
    if ($b64u === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $b64u)) {
        webauthnFail('Invalid passkey data');
    }
    $b64 = strtr($b64u, '-_', '+/');
    $pad = strlen($b64) % 4;
    if ($pad) $b64 .= str_repeat('=', 4 - $pad);
    $raw = base64_decode($b64, true);
    if ($raw === false) webauthnFail('Invalid passkey data');
    return $raw;
}

/** Challenge key: one account ('a:<id>'), or 'a:*' for a usernameless sign-in. */
function webauthnSubjectKey(array $subject): string {
    return $subject['kind'] === 'discover' ? 'a:*' : 'a:' . (int)$subject['id'];
}

function webauthnAccountSubject(int $accountId, string $name = ''): array {
    return ['kind' => 'account', 'id' => $accountId, 'name' => $name, 'context' => ''];
}

/** WebAuthn user handle for an account: stable, opaque, 32 bytes. */
function webauthnAccountUserHandle(int $accountId): string {
    return hash('sha256', 'wruf-' . webauthnSubjectKey(webauthnAccountSubject($accountId)), true);
}

function webauthnChallengeStore(string $purpose, array $subject): string {
    startSecureSession();
    $challenge = webauthnB64uEncode(random_bytes(32));
    $_SESSION['wruf_webauthn'] = [
        'challenge' => $challenge,
        'purpose' => $purpose,
        'subject' => webauthnSubjectKey($subject),
        'exp' => time() + WEBAUTHN_CHALLENGE_TTL,
    ];
    return $challenge;
}

function webauthnChallengeTake(string $purpose, array $subject): string {
    startSecureSession();
    $w = $_SESSION['wruf_webauthn'] ?? null;
    unset($_SESSION['wruf_webauthn']);
    if (!is_array($w)
        || ($w['purpose'] ?? '') !== $purpose
        || ($w['subject'] ?? '') !== webauthnSubjectKey($subject)
        || (int)($w['exp'] ?? 0) < time()) {
        webauthnFail('Request expired. Please try again.', 400, 'PASSKEY_EXPIRED');
    }
    return (string)$w['challenge'];
}

/** @return array{table:string, column:string} */
function webauthnTableFor(array $subject): array {
    return ['table' => 'account_passkeys', 'column' => 'account_id'];
}

/** @return list<array{type:string,id:string,transports?:list<string>}> */
function webauthnCredentialDescriptors(PDO $pdo, array $subject): array {
    $t = webauthnTableFor($subject);
    $stmt = $pdo->prepare("SELECT credential_id, transports_json FROM {$t['table']} WHERE {$t['column']} = :sid");
    $stmt->execute([':sid' => (int)$subject['id']]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $item = ['type' => 'public-key', 'id' => webauthnB64uEncode((string)$row['credential_id'])];
        $tr = json_decode((string)($row['transports_json'] ?? ''), true);
        if (is_array($tr) && $tr) {
            $item['transports'] = array_values(array_map('strval', $tr));
        }
        $out[] = $item;
    }
    return $out;
}

function webauthnRegisterOptions(PDO $pdo, array $config, array $subject): array {
    $existing = webauthnCredentialDescriptors($pdo, $subject);
    if (count($existing) >= WEBAUTHN_MAX_PER_SUBJECT) {
        webauthnFail('Too many passkeys for this account. Remove one first.', 409, 'PASSKEY_LIMIT');
    }

    $label = (string)$subject['name'];
    if ((string)$subject['context'] !== '') {
        $label .= ' - ' . (string)$subject['context'];
    }
    $label = mb_substr($label, 0, 64);

    return [
        'challenge' => webauthnChallengeStore('register', $subject),
        'rp' => ['name' => 'When RU Free', 'id' => webauthnRpId($config)],
        'user' => [
            'id' => webauthnB64uEncode(webauthnAccountUserHandle((int)$subject['id'])),
            'name' => $label,
            'displayName' => $label,
        ],
        'pubKeyCredParams' => [
            ['type' => 'public-key', 'alg' => WEBAUTHN_ALG_ES256],
            ['type' => 'public-key', 'alg' => WEBAUTHN_ALG_RS256],
        ],
        'timeout' => 120000,
        'attestation' => 'none',
        'excludeCredentials' => $existing,
        'authenticatorSelection' => [
            'residentKey' => 'required',
            'requireResidentKey' => true,
            'userVerification' => 'required',
        ],
    ];
}

/** Verify clientDataJSON type, challenge and origin; returns the raw JSON bytes. */
function webauthnCheckClientData(array $cred, string $type, string $expectedChallenge, array $config): string {
    $clientDataJSON = webauthnB64uDecode((string)($cred['response']['clientDataJSON'] ?? ''));
    $client = json_decode($clientDataJSON, true);
    if (!is_array($client) || ($client['type'] ?? '') !== $type) {
        webauthnFail('Invalid passkey response');
    }
    if (!hash_equals($expectedChallenge, (string)($client['challenge'] ?? ''))) {
        webauthnFail('Passkey challenge mismatch');
    }
    if (!hash_equals(webauthnOrigin($config), (string)($client['origin'] ?? ''))) {
        webauthnFail('Passkey origin mismatch');
    }
    return $clientDataJSON;
}

function webauthnCheckFlags(array $parsed, array $config): void {
    if (!hash_equals(hash('sha256', webauthnRpId($config), true), $parsed['rp_id_hash'])) {
        webauthnFail('Passkey site mismatch');
    }
    if (($parsed['flags'] & 0x01) === 0 || ($parsed['flags'] & 0x04) === 0) {
        webauthnFail('Passkey needs your fingerprint, face or screen lock.');
    }
}

/** Client-supplied device name ("iPhone", "Windows PC"), reduced to a short plain-text label or null. */
function webauthnCleanLabel(mixed $label): ?string {
    if (!is_string($label)) return null;
    $clean = preg_replace('/\s+/', ' ', $label) ?? '';
    $clean = preg_replace('/[^A-Za-z0-9 .()\/-]/', '', $clean) ?? '';
    $clean = trim(preg_replace('/ {2,}/', ' ', $clean) ?? '');
    return $clean === '' ? null : rtrim(substr($clean, 0, 40));
}

/** Verify a registration response and store the new credential. Returns its base64url ID. */
function webauthnRegisterFinish(PDO $pdo, array $config, array $subject, array $cred, ?string $deviceLabel = null): string {
    $expected = webauthnChallengeTake('register', $subject);
    webauthnCheckClientData($cred, 'webauthn.create', $expected, $config);

    $attestationObject = webauthnB64uDecode((string)($cred['response']['attestationObject'] ?? ''));
    $att = webauthnCborDecode($attestationObject);
    if (!is_array($att) || !isset($att['authData']) || !is_string($att['authData'])) {
        webauthnFail('Invalid passkey response');
    }

    $parsed = webauthnParseAuthData($att['authData'], true);
    webauthnCheckFlags($parsed, $config);
    if ($parsed['credential_id'] === '' || $parsed['public_key_pem'] === '') {
        webauthnFail('The passkey type on this device is not supported.');
    }
    if (strlen($parsed['credential_id']) > 255) {
        webauthnFail('Invalid passkey response');
    }

    $clientId = (string)($cred['rawId'] ?? $cred['id'] ?? '');
    if ($clientId !== '' && !hash_equals($parsed['credential_id'], webauthnB64uDecode($clientId))) {
        webauthnFail('Invalid passkey response');
    }

    $transports = $cred['transports'] ?? ($cred['response']['transports'] ?? null);
    $transJson = null;
    if (is_array($transports)) {
        $clean = array_values(array_filter(array_map('strval', $transports), static fn($t) => preg_match('/^[a-z-]{1,20}$/', $t) === 1));
        $transJson = json_encode(array_slice($clean, 0, 8));
    }

    $t = webauthnTableFor($subject);
    $params = [
        ':sid' => (int)$subject['id'],
        ':cred' => $parsed['credential_id'],
        ':pem' => $parsed['public_key_pem'],
        ':alg' => $parsed['alg'],
        ':sc' => $parsed['sign_count'],
        ':tr' => $transJson,
        ':lbl' => webauthnCleanLabel($deviceLabel),
    ];

    try {
        $pdo->prepare(
            "INSERT INTO {$t['table']} ({$t['column']}, credential_id, public_key_pem, alg, sign_count, transports_json, device_label, created_at)
             VALUES (:sid, :cred, :pem, :alg, :sc, :tr, :lbl, NOW())"
        )->execute($params);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000') {
            webauthnFail('A passkey is already set up on this device.', 409, 'PASSKEY_EXISTS');
        }
        throw $e;
    }

    return webauthnB64uEncode($parsed['credential_id']);
}

/** Options for signing in with a discoverable account passkey (no username needed). */
function webauthnDiscoverOptions(array $config): array {
    return [
        'challenge' => webauthnChallengeStore('login', ['kind' => 'discover', 'id' => 0]),
        'timeout' => 120000,
        'rpId' => webauthnRpId($config),
        'userVerification' => 'required',
        'allowCredentials' => [],
    ];
}

/** Verify a discoverable passkey sign-in and return the account ID it belongs to. */
function webauthnDiscoverFinish(PDO $pdo, array $config, array $cred): int {
    $expected = webauthnChallengeTake('login', ['kind' => 'discover', 'id' => 0]);
    $rawId = webauthnB64uDecode((string)($cred['rawId'] ?? $cred['id'] ?? ''));

    $stmt = $pdo->prepare(
        "SELECT id, account_id, public_key_pem, sign_count FROM account_passkeys
         WHERE credential_id = :cred LIMIT 1"
    );
    $stmt->execute([':cred' => $rawId]);
    $row = $stmt->fetch();
    if (!$row) {
        webauthnFail('This passkey is not linked to an account here. Sign in another way, or remove it from your device.', 404, 'NO_PASSKEY');
    }
    $accountId = (int)$row['account_id'];

    $handle = (string)($cred['response']['userHandle'] ?? '');
    if ($handle !== '' && !hash_equals(webauthnAccountUserHandle($accountId), webauthnB64uDecode($handle))) {
        webauthnFail('Passkey could not be verified');
    }
    webauthnVerifyAssertion($pdo, $config, 'account_passkeys', $row, $cred, $expected, 'a:' . $accountId);
    return $accountId;
}

/** Check an assertion against a stored credential row and bump its counter. */
function webauthnVerifyAssertion(PDO $pdo, array $config, string $table, array $row, array $cred, string $expected, string $logKey): void {
    $clientDataJSON = webauthnCheckClientData($cred, 'webauthn.get', $expected, $config);
    $authenticatorData = webauthnB64uDecode((string)($cred['response']['authenticatorData'] ?? ''));
    $signature = webauthnB64uDecode((string)($cred['response']['signature'] ?? ''));

    $parsed = webauthnParseAuthData($authenticatorData, false);
    webauthnCheckFlags($parsed, $config);

    $prev = (int)$row['sign_count'];
    $next = $parsed['sign_count'];
    if ($prev > 0 && $next > 0 && $next <= $prev) {
        logSecurityEvent('PASSKEY_COUNTER_REPLAY', ['subject' => $logKey, 'passkey_id' => (int)$row['id']]);
        webauthnFail('Passkey could not be verified');
    }

    $pem = (string)$row['public_key_pem'];
    $key = openssl_pkey_get_public($pem);
    if ($key === false) {
        webauthnFail('Passkey could not be verified');
    }
    $details = openssl_pkey_get_details($key);
    if (($details['type'] ?? null) === OPENSSL_KEYTYPE_EC) {
        $signature = webauthnEcdsaRawToDer($signature);
    }

    $payload = $authenticatorData . hash('sha256', $clientDataJSON, true);
    if (openssl_verify($payload, $signature, $key, OPENSSL_ALGO_SHA256) !== 1) {
        webauthnFail('Passkey could not be verified');
    }

    $pdo->prepare("UPDATE {$table} SET sign_count = :sc, last_used_at = NOW() WHERE id = :id")
        ->execute([':sc' => max($prev, $next), ':id' => (int)$row['id']]);
}

/**
 * Devices set up for a subject, oldest first. Dates are server-local DATETIME strings.
 * @return list<array{credential_id:string, device_label:?string, created_at:string, last_used_at:?string}>
 */
function webauthnList(PDO $pdo, array $subject): array {
    $t = webauthnTableFor($subject);
    $stmt = $pdo->prepare(
        "SELECT credential_id, device_label, created_at, last_used_at FROM {$t['table']}
         WHERE {$t['column']} = :sid ORDER BY id"
    );
    $stmt->execute([':sid' => (int)$subject['id']]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[] = [
            'credential_id' => webauthnB64uEncode((string)$row['credential_id']),
            'device_label' => $row['device_label'] !== null ? (string)$row['device_label'] : null,
            'created_at' => (string)$row['created_at'],
            'last_used_at' => $row['last_used_at'] !== null ? (string)$row['last_used_at'] : null,
        ];
    }
    return $out;
}

function webauthnDelete(PDO $pdo, array $subject, string $credentialIdB64u): bool {
    $t = webauthnTableFor($subject);
    $stmt = $pdo->prepare("DELETE FROM {$t['table']} WHERE credential_id = :cred AND {$t['column']} = :sid");
    $stmt->execute([':cred' => webauthnB64uDecode($credentialIdB64u), ':sid' => (int)$subject['id']]);
    return $stmt->rowCount() > 0;
}

/**
 * @return array{rp_id_hash:string, flags:int, sign_count:int, credential_id:string, public_key_pem:string, alg:int}
 */
function webauthnParseAuthData(string $authData, bool $expectAttested): array {
    if (strlen($authData) < 37) webauthnFail('Invalid passkey response');

    $out = [
        'rp_id_hash' => substr($authData, 0, 32),
        'flags' => ord($authData[32]),
        'sign_count' => (int)unpack('N', substr($authData, 33, 4))[1],
        'credential_id' => '',
        'public_key_pem' => '',
        'alg' => 0,
    ];
    if (!$expectAttested) return $out;

    if (($out['flags'] & 0x40) === 0 || strlen($authData) < 55) {
        webauthnFail('Invalid passkey response');
    }
    $offset = 37 + 16; // skip AAGUID
    $credLen = (int)unpack('n', substr($authData, $offset, 2))[1];
    $offset += 2;
    if ($credLen < 1 || strlen($authData) < $offset + $credLen) {
        webauthnFail('Invalid passkey response');
    }
    $out['credential_id'] = substr($authData, $offset, $credLen);
    $offset += $credLen;

    $cose = webauthnCborDecode(substr($authData, $offset));
    if (is_array($cose)) {
        [$out['public_key_pem'], $out['alg']] = webauthnCoseToPem($cose);
    }
    return $out;
}

/** @return array{0:string, 1:int} PEM + COSE alg, or ['', 0] if unsupported. */
function webauthnCoseToPem(array $cose): array {
    $kty = (int)($cose[1] ?? 0);
    $alg = (int)($cose[3] ?? 0);

    if ($kty === 2 && $alg === WEBAUTHN_ALG_ES256) {
        $crv = (int)($cose[-1] ?? 0);
        $x = $cose[-2] ?? null;
        $y = $cose[-3] ?? null;
        if ($crv !== 1 || !is_string($x) || !is_string($y) || strlen($x) !== 32 || strlen($y) !== 32) {
            return ['', 0];
        }
        $algId = webauthnDerSequence(hex2bin('06072a8648ce3d0201') . hex2bin('06082a8648ce3d030107'));
        $point = "\x04" . $x . $y;
        $spki = webauthnDerSequence($algId . "\x03" . webauthnDerLength(strlen($point) + 1) . "\x00" . $point);
        return [webauthnPem($spki), WEBAUTHN_ALG_ES256];
    }

    if ($kty === 3 && $alg === WEBAUTHN_ALG_RS256) {
        $n = $cose[-1] ?? null;
        $e = $cose[-2] ?? null;
        if (!is_string($n) || !is_string($e) || strlen($n) < 256 || $e === '') {
            return ['', 0];
        }
        $rsaKey = webauthnDerSequence(webauthnDerInteger($n) . webauthnDerInteger($e));
        $algId = webauthnDerSequence(hex2bin('06092a864886f70d010101') . "\x05\x00");
        $spki = webauthnDerSequence($algId . "\x03" . webauthnDerLength(strlen($rsaKey) + 1) . "\x00" . $rsaKey);
        return [webauthnPem($spki), WEBAUTHN_ALG_RS256];
    }

    return ['', 0];
}

function webauthnPem(string $spki): string {
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function webauthnDerLength(int $len): string {
    if ($len < 128) return chr($len);
    $bin = ltrim(pack('N', $len), "\x00");
    return chr(0x80 | strlen($bin)) . $bin;
}

function webauthnDerSequence(string $contents): string {
    return "\x30" . webauthnDerLength(strlen($contents)) . $contents;
}

function webauthnDerInteger(string $bytes): string {
    $bytes = ltrim($bytes, "\x00");
    if ($bytes === '' || (ord($bytes[0]) & 0x80)) $bytes = "\x00" . $bytes;
    return "\x02" . webauthnDerLength(strlen($bytes)) . $bytes;
}

/** Convert a raw R||S ECDSA signature to DER (authenticators normally already send DER). */
function webauthnEcdsaRawToDer(string $sig): string {
    if (strlen($sig) !== 64) return $sig;
    return webauthnDerSequence(webauthnDerInteger(substr($sig, 0, 32)) . webauthnDerInteger(substr($sig, 32, 32)));
}

/** Minimal CBOR decoder (maps, arrays, byte/text strings, ints, bool, null). */
function webauthnCborDecode(string $bin) {
    try {
        $offset = 0;
        return webauthnCborRead($bin, $offset, 0);
    } catch (RuntimeException $e) {
        webauthnFail('Invalid passkey response');
    }
    return null;
}

function webauthnCborRead(string $bin, int &$offset, int $depth) {
    if ($depth > 8) throw new RuntimeException('CBOR too deep');
    if ($offset >= strlen($bin)) throw new RuntimeException('CBOR truncated');

    $ib = ord($bin[$offset++]);
    $major = $ib >> 5;
    $add = $ib & 0x1f;

    if ($major === 7) {
        if ($add === 20) return false;
        if ($add === 21) return true;
        if ($add === 22) return null;
        throw new RuntimeException('Unsupported CBOR simple value');
    }

    $val = webauthnCborLength($bin, $offset, $add);

    switch ($major) {
        case 0:
            return $val;
        case 1:
            return -1 - $val;
        case 2:
        case 3:
            if ($offset + $val > strlen($bin)) throw new RuntimeException('CBOR truncated');
            $s = substr($bin, $offset, $val);
            $offset += $val;
            return $s;
        case 4:
            if ($val > 64) throw new RuntimeException('CBOR array too large');
            $arr = [];
            for ($i = 0; $i < $val; $i++) $arr[] = webauthnCborRead($bin, $offset, $depth + 1);
            return $arr;
        case 5:
            if ($val > 64) throw new RuntimeException('CBOR map too large');
            $map = [];
            for ($i = 0; $i < $val; $i++) {
                $k = webauthnCborRead($bin, $offset, $depth + 1);
                $v = webauthnCborRead($bin, $offset, $depth + 1);
                if (is_int($k) || is_string($k)) $map[$k] = $v;
            }
            return $map;
        case 6:
            return webauthnCborRead($bin, $offset, $depth + 1);
    }
    throw new RuntimeException('Unsupported CBOR type');
}

function webauthnCborLength(string $bin, int &$offset, int $add): int {
    if ($add < 24) return $add;
    $sizes = [24 => 1, 25 => 2, 26 => 4, 27 => 8];
    if (!isset($sizes[$add])) throw new RuntimeException('Unsupported CBOR length');
    $n = $sizes[$add];
    if ($offset + $n > strlen($bin)) throw new RuntimeException('CBOR truncated');
    $chunk = substr($bin, $offset, $n);
    $offset += $n;
    $v = 0;
    for ($i = 0; $i < $n; $i++) $v = ($v << 8) | ord($chunk[$i]);
    if ($v < 0) throw new RuntimeException('CBOR length overflow');
    return $v;
}
