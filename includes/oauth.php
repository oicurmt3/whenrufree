<?php
/**
 * includes/oauth.php - Sign in with Google (OpenID Connect) or Facebook (Facebook Login).
 *
 * Google is asked only for scope "openid" and Facebook only for "public_profile"; the only
 * value read is the provider's user ID, which is stored as a keyed hash (accountSubjectHash).
 * No email, name or picture is requested or kept.
 *
 * The round trip is protected by a short-lived signed cookie (wruf_oauth, SameSite=Lax so it
 * comes back on the provider's redirect) holding the state, the OIDC nonce, the PKCE verifier,
 * the mode (sign in or add to the signed-in account) and where to return afterwards.
 *
 * Config (config.php, 'accounts' block): pepper, base_url, google.client_id/client_secret,
 * facebook.app_id/app_secret/graph_version. Redirect URIs to register with each provider:
 *   {base_url}/api.php?action=oauth_google
 *   {base_url}/api.php?action=oauth_facebook
 */

declare(strict_types=1);

const OAUTH_COOKIE = 'wruf_oauth';
const OAUTH_TTL = 600;
const OAUTH_PROVIDERS = ['google', 'facebook'];

/** True when the provider has its keys in config.php. */
function oauthProviderEnabled(array $config, string $provider): bool {
    $a = accountConfig($config);
    return match ($provider) {
        'google' => $a['google']['client_id'] !== '' && $a['google']['client_secret'] !== '',
        'facebook' => $a['facebook']['app_id'] !== '' && $a['facebook']['app_secret'] !== '',
        default => false,
    };
}

/** Site base URL (no trailing slash): config accounts.base_url, else scheme + host + folder. */
function oauthBaseUrl(array $config): string {
    $configured = accountConfig($config)['base_url'];
    if ($configured !== '') return $configured;
    $dir = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api.php'))), '/');
    return webauthnOrigin($config) . $dir;
}

function oauthRedirectUri(array $config, string $provider): string {
    return oauthBaseUrl($config) . '/api.php?action=oauth_' . $provider;
}

/** A same-site path to return to after signing in, or '/'. */
function oauthCleanReturn(mixed $v): string {
    if (!is_string($v) || $v === '' || strlen($v) > 300) return '/';
    if ($v[0] !== '/' || str_starts_with($v, '//') || preg_match('/[\\\\\s\x00-\x1f]/', $v)) return '/';
    return $v;
}

// -------------------------
// Signed state cookie
// -------------------------

function oauthSign(array $config, string $body): string {
    return webauthnB64uEncode(hash_hmac('sha256', 'oauth|' . $body, accountPepper($config), true));
}

function oauthStateSet(array $config, array $data): void {
    $body = webauthnB64uEncode((string)json_encode($data));
    setcookie(OAUTH_COOKIE, $body . '.' . oauthSign($config, $body), [
        'expires' => time() + OAUTH_TTL,
        'path' => '/',
        'secure' => accountIsHttps(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Read and clear the state cookie. Null when missing, tampered with or expired. */
function oauthStateTake(array $config): ?array {
    $raw = (string)($_COOKIE[OAUTH_COOKIE] ?? '');
    setcookie(OAUTH_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => accountIsHttps(), 'httponly' => true, 'samesite' => 'Lax']);
    if (!preg_match('/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/', $raw, $m)) return null;
    if (!hash_equals(oauthSign($config, $m[1]), $m[2])) return null;
    $json = base64_decode(strtr($m[1], '-_', '+/'), true);
    $data = $json !== false ? json_decode($json, true) : null;
    if (!is_array($data) || (int)($data['exp'] ?? 0) < time()) return null;
    return $data;
}

// -------------------------
// HTTP
// -------------------------

/** POST form or GET to a provider; returns the decoded JSON body or null. */
function oauthHttp(string $url, ?array $form = null): ?array {
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    ];
    if ($form !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = http_build_query($form);
    }
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if (!is_string($body) || $status < 200 || $status >= 300) return null;
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

// -------------------------
// Start
// -------------------------

/** Build the provider's sign-in URL and set the state cookie. */
function oauthAuthorizeUrl(array $config, string $provider, string $mode, string $return): string {
    $a = accountConfig($config);
    $state = webauthnB64uEncode(random_bytes(24));
    $nonce = webauthnB64uEncode(random_bytes(24));
    $verifier = webauthnB64uEncode(random_bytes(48));
    oauthStateSet($config, [
        'p' => $provider,
        's' => $state,
        'n' => $nonce,
        'v' => $verifier,
        'm' => $mode,
        'r' => $return,
        'exp' => time() + OAUTH_TTL,
    ]);
    $redirect = oauthRedirectUri($config, $provider);

    if ($provider === 'google') {
        return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
            'client_id' => $a['google']['client_id'],
            'redirect_uri' => $redirect,
            'response_type' => 'code',
            'scope' => 'openid',
            'state' => $state,
            'nonce' => $nonce,
            'code_challenge' => webauthnB64uEncode(hash('sha256', $verifier, true)),
            'code_challenge_method' => 'S256',
            'prompt' => 'select_account',
        ]);
    }
    return 'https://www.facebook.com/' . $a['facebook']['graph_version'] . '/dialog/oauth?' . http_build_query([
        'client_id' => $a['facebook']['app_id'],
        'redirect_uri' => $redirect,
        'response_type' => 'code',
        'scope' => 'public_profile',
        'state' => $state,
    ]);
}

// -------------------------
// Callback
// -------------------------

/** Exchange Google's code and return the verified user ID ("sub"), or null. */
function oauthGoogleSubject(array $config, string $code, array $state): ?string {
    $g = accountConfig($config)['google'];
    $tok = oauthHttp('https://oauth2.googleapis.com/token', [
        'code' => $code,
        'client_id' => $g['client_id'],
        'client_secret' => $g['client_secret'],
        'redirect_uri' => oauthRedirectUri($config, 'google'),
        'grant_type' => 'authorization_code',
        'code_verifier' => (string)$state['v'],
    ]);
    $idToken = is_array($tok) ? (string)($tok['id_token'] ?? '') : '';
    $parts = explode('.', $idToken);
    if (count($parts) !== 3) return null;

    // Received straight from Google's token endpoint over verified TLS, so the claims are
    // trusted without checking the signature (OpenID Connect Core 3.1.3.7).
    $json = base64_decode(strtr($parts[1], '-_', '+/'), true);
    $claims = $json !== false ? json_decode($json, true) : null;
    if (!is_array($claims)) return null;

    $iss = (string)($claims['iss'] ?? '');
    $aud = $claims['aud'] ?? '';
    $audOk = is_array($aud) ? in_array($g['client_id'], $aud, true) : hash_equals($g['client_id'], (string)$aud);
    $sub = (string)($claims['sub'] ?? '');
    if (!in_array($iss, ['https://accounts.google.com', 'accounts.google.com'], true)
        || !$audOk
        || (int)($claims['exp'] ?? 0) < time() - 60
        || !hash_equals((string)$state['n'], (string)($claims['nonce'] ?? ''))
        || !preg_match('/^[A-Za-z0-9_-]{1,255}$/', $sub)) {
        return null;
    }
    return $sub;
}

/** Exchange Facebook's code and return the app-scoped user ID, or null. */
function oauthFacebookSubject(array $config, string $code): ?string {
    $f = accountConfig($config)['facebook'];
    $graph = 'https://graph.facebook.com/' . $f['graph_version'];
    $tok = oauthHttp($graph . '/oauth/access_token?' . http_build_query([
        'client_id' => $f['app_id'],
        'client_secret' => $f['app_secret'],
        'redirect_uri' => oauthRedirectUri($config, 'facebook'),
        'code' => $code,
    ]));
    $accessToken = is_array($tok) ? (string)($tok['access_token'] ?? '') : '';
    if ($accessToken === '') return null;

    // Confirm the token was issued to this app, and read only the user ID.
    $dbg = oauthHttp($graph . '/debug_token?' . http_build_query([
        'input_token' => $accessToken,
        'access_token' => $f['app_id'] . '|' . $f['app_secret'],
    ]));
    $d = is_array($dbg['data'] ?? null) ? $dbg['data'] : [];
    $uid = (string)($d['user_id'] ?? '');
    if (empty($d['is_valid']) || (string)($d['app_id'] ?? '') !== $f['app_id'] || !preg_match('/^\d{1,30}$/', $uid)) {
        return null;
    }
    return $uid;
}

/** Send the browser back to the site with a short result code for the page to show. */
function oauthFinish(string $return, string $result): void {
    $sep = str_contains($return, '?') ? '&' : '?';
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('Location: ' . $return . $sep . 'signin=' . rawurlencode($result), true, 302);
    exit;
}

/**
 * Handle the provider's redirect back: sign in (creating the account if new) or add the
 * provider to the signed-in account.
 */
function oauthHandleCallback(PDO $pdo, array $config, string $provider): void {
    $state = oauthStateTake($config);
    $page = oauthAccountPage($config);
    $return = oauthCleanReturn($state['r'] ?? $page);
    if ($state === null
        || ($state['p'] ?? '') !== $provider
        || !hash_equals((string)($state['s'] ?? ''), (string)($_GET['state'] ?? ''))) {
        logSecurityEvent('OAUTH_STATE_INVALID', ['provider' => $provider]);
        oauthFinish($page, 'expired');
    }
    if (isset($_GET['error']) || !isset($_GET['code'])) {
        oauthFinish($return, 'cancelled');
    }
    $code = (string)$_GET['code'];
    if ($code === '' || strlen($code) > 2048) oauthFinish($return, 'failed');

    $subject = $provider === 'google'
        ? oauthGoogleSubject($config, $code, $state)
        : oauthFacebookSubject($config, $code);
    if ($subject === null) {
        logSecurityEvent('OAUTH_FAILED', ['provider' => $provider]);
        oauthFinish($return, 'failed');
    }

    if (($state['m'] ?? '') === 'link') {
        $acct = accountCurrent($pdo);
        if ($acct === null) oauthFinish($page, 'expired');
        $result = accountLinkIdentity($pdo, $config, $acct['id'], $provider, $subject);
        logSecurityEvent('ACCOUNT_METHOD_' . strtoupper($result), ['account_id' => $acct['id'], 'provider' => $provider]);
        oauthFinish($page, $result === 'linked' || $result === 'already' ? 'linked' : 'taken');
    }

    $res = accountSignInWithIdentity($pdo, $config, $provider, $subject);
    accountCreateSession($pdo, $res['account_id']);
    logSecurityEvent($res['created'] ? 'ACCOUNT_CREATED' : 'ACCOUNT_SIGNIN', ['account_id' => $res['account_id'], 'provider' => $provider]);
    if (accountNeedsSetup($pdo, $res['account_id'])) {
        oauthFinish($page . '?return=' . rawurlencode($return), 'new');
    }
    oauthFinish($return, 'ok');
}

/** Path of the profile page, e.g. /account.html (or /sub/account.html). */
function oauthAccountPage(array $config): string {
    $path = (string)(parse_url(oauthBaseUrl($config), PHP_URL_PATH) ?? '');
    return rtrim($path, '/') . '/account.html';
}
