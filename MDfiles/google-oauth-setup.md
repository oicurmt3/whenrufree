# Google Sign-In (OAuth) Setup - Step by Step

How to set up "Sign in with Google" on the Google side, for When RU Free or any other website.
Everything here is done by you in the Google Cloud console; the website code is already written.

When RU Free values are shown like this: **WhenRUFree:** `value`. For another site, swap in its own values
(see [Reusing this for another website](#reusing-this-for-another-website)).

---

## What you need before starting

- A Google account to own the project. Use one you will keep long term (losing it means losing the client).
  A shared admin account or a Google Workspace account is better than a personal one.
- The site live on **HTTPS** with its final domain. Google refuses plain `http://` redirect URIs (except `localhost`).
- Public pages for:
  - Home page - **WhenRUFree:** `https://whenrufree.net/`
  - Privacy policy - **WhenRUFree:** `https://whenrufree.net/privacy.html`
  - Terms of service - **WhenRUFree:** `https://whenrufree.net/terms.html`
- The exact redirect URI the site uses (the address Google sends people back to after they sign in):
  - **WhenRUFree:** `https://whenrufree.net/api.php?action=oauth_google`
  - It is built from `accounts.base_url` in `config.php` + `/api.php?action=oauth_google`.

The privacy policy must say what you get from Google and what you do with it
(When RU Free: only an ID, stored as a keyed hash; no email, name or photo).

---

## Step 1 - Create a project

1. Go to <https://console.cloud.google.com/> and sign in with the owner account.
2. Top bar > project picker > **New project**.
3. Project name: something recognisable - **WhenRUFree:** `When RU Free`. Organisation: leave as "No organisation" unless you use Workspace.
4. **Create**, then make sure the new project is selected in the project picker for all the steps below.

Use **one project per website**. The consent screen branding (name, logo, links) belongs to the project,
so two sites in one project would show the same name to users.

---

## Step 2 - Set up the consent screen (Google Auth Platform)

Menu > **APIs & Services** > **OAuth consent screen** (newer consoles call this area **Google Auth Platform**,
with tabs Branding, Audience, Clients, Data Access). If asked, click **Get started**.

### 2a. App information / Branding

| Field | What to enter |
|---|---|
| App name | The name users see: "Sign in to *App name*". **WhenRUFree:** `When RU Free` |
| User support email | An address users can see. Use a support alias, not your personal inbox if you can avoid it |
| App logo | Optional. Adding a logo means Google must verify the brand before it is shown (see Step 6). Skip it at first |
| App home page | **WhenRUFree:** `https://whenrufree.net/` |
| Privacy policy link | **WhenRUFree:** `https://whenrufree.net/privacy.html` |
| Terms of service link | **WhenRUFree:** `https://whenrufree.net/terms.html` |
| Authorised domains | The bare domain, no `https://` or path. **WhenRUFree:** `whenrufree.net` |
| Developer contact email | Where Google sends notices about the project. Must be monitored |

### 2b. Audience

- User type: **External** (anyone with a Google account). "Internal" only works for your own Workspace organisation.
- Leave it in **Testing** while you set up. In Testing, only the **test users** you add (up to 100) can sign in;
  everyone else gets "Access blocked". Add your own Google address as a test user now.

### 2c. Data Access (scopes)

- Add **only** `openid`. This gives a stable, private user ID (the `sub` value) and nothing else.
- Do **not** add `email` or `profile` (or `.../auth/userinfo.email`, `.../auth/userinfo.profile`).
  The site doesn't use them, and asking for less keeps the consent screen short and avoids review.
- `openid` is a non-sensitive scope, so no scope verification is needed.

**Save** each section.

---

## Step 3 - Create the OAuth client (the keys)

1. **APIs & Services** > **Credentials** > **Create credentials** > **OAuth client ID**
   (newer consoles: **Google Auth Platform** > **Clients** > **Create client**).
2. Application type: **Web application**.
3. Name: only you see it. **WhenRUFree:** `When RU Free - web`.
4. **Authorised JavaScript origins:** leave empty. The site does the sign-in on the server, not in browser JavaScript.
5. **Authorised redirect URIs** > **Add URI**, paste the exact redirect URI:
   - **WhenRUFree:** `https://whenrufree.net/api.php?action=oauth_google`
   - It must match character for character: `https`, with or without `www` exactly as the site uses it,
     same path, same `?action=...`, no trailing slash added.
   - If the site answers on more than one domain, the redirect still only uses `accounts.base_url`, so one URI is enough.
6. **Create**.
7. Copy the **Client ID** and **Client secret** straight away, or click **Download JSON**.
   Newer consoles show the secret **only once**. If you lose it, open the client, **Add secret**, update the site, then delete the old secret.

Store the secret like a password (password manager). Never email it, paste it in chat, or commit it to git.

---

## Step 4 - Put the keys on the server

Edit the private config file (outside the webroot, never in git).
**WhenRUFree:** `/home/perthrel/grape_private/config.php`, in the `accounts` block:

```php
'accounts' => [
    'pepper'   => '...64+ hex characters, already set - never change it...',
    'base_url' => 'https://whenrufree.net',
    'google'   => [
        'client_id'     => '1234567890-abc123def456.apps.googleusercontent.com',
        'client_secret' => 'GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx',
    ],
    // ...
],
```

- The **Continue with Google** button appears as soon as both values are filled in, and disappears if either is empty.
- `base_url` must be the same address as the redirect URI in Step 3 (without the `/api.php...` part).
- The server needs PHP's **cURL** extension (it calls `https://oauth2.googleapis.com/token`).

---

## Step 5 - Test

1. Open the site in a private/incognito window and click **Continue with Google**.
2. Sign in with an address you added as a **test user**.
3. Google shows the consent screen once ("*App name* wants to access your Google Account" with no extra permissions listed),
   then sends you back to the site signed in. New accounts go to the profile page to pick a username.

If something goes wrong:

| What you see | Cause | Fix |
|---|---|---|
| Google: `Error 400: redirect_uri_mismatch` | Redirect URI in the client doesn't match what the site sent | Compare them exactly (https, www, path, `?action=oauth_google`). Changes can take a few minutes to apply |
| Google: `Error 403: access_denied` / "Access blocked: app has not completed verification" | App is in Testing and this Google account isn't a test user | Add the account as a test user, or publish the app (Step 6) |
| Google: `Error 401: invalid_client` | Wrong or deleted client ID | Re-copy the client ID into `config.php` |
| Back on the site with "Sign-in didn't work" (`?signin=failed`) | Wrong client secret, cURL missing, or the server can't reach Google | Check the secret, check cURL is enabled, check `grape_private/logs/` for `OAUTH_FAILED` events |
| Back on the site with "That sign-in took too long or was interrupted" (`?signin=expired`) | More than 10 minutes on Google's page, or cookies blocked (logged as `OAUTH_STATE_INVALID`) | Try again; allow cookies for the site |
| Back on the site with "That sign-in method isn't available right now" (`?signin=unavailable`) | Google keys missing in `config.php` | Fill in both `accounts.google` values |
| No Google button at all | `client_id` or `client_secret` empty, or config not loaded | Check the `accounts.google` block |

---

## Step 6 - Go live (publish)

1. **OAuth consent screen / Audience** > **Publish app** > confirm. Status changes to **In production**.
2. With only `openid`, publishing is immediate - no Google review of scopes.
3. Optional **brand verification** (Google Auth Platform > **Branding** / **Verification centre**):
   lets Google show your app name and logo on the consent screen. Google checks that you own the domain,
   usually by verifying it in [Google Search Console](https://search.google.com/search-console) with the same Google account.
   It can take a few business days. Until then users may see the domain instead of the app name, which is fine.
4. Keep the privacy policy and terms links working - Google may re-check them, and broken links can get the app suspended.

---

## Ongoing care

- **Rotate the secret** if it may have leaked: open the client > **Add secret** > put the new one in `config.php` > test > delete the old secret.
- **Watch the developer contact email.** Google emails about policy changes, unused clients (unused clients can be deleted after a long period of no sign-ins) and required actions.
- **Don't delete the project or the client.** Every user's Google login is tied to it. A new client in the *same* project
  keeps the same user IDs, but a new *project* gives users new IDs, so existing accounts would no longer recognise their Google login.
- **Never change `accounts.pepper`** on the server - it turns Google IDs into the stored hashes, so changing it disconnects every Google login.
- Button design must follow Google's [branding guidelines](https://developers.google.com/identity/branding-guidelines).
  When RU Free uses Google's official HTML button (`gsi-material-button` in `account.css`); don't restyle it.

---

## Reusing this for another website

Repeat Steps 1-6 with a **new project** and the new site's values:

| Setting | Where | Change to |
|---|---|---|
| Project name | Step 1 | New site's name |
| App name, support email, logo | Step 2a | New site's name and contact |
| Home / privacy / terms links | Step 2a | New site's pages (the privacy policy must describe what it takes from Google) |
| Authorised domain | Step 2a | New site's bare domain, e.g. `example.com` |
| Scopes | Step 2c | Only what the new site really needs. `openid` alone for sign-in; `email` / `profile` only if it must show or store them (then say so in the privacy policy) |
| Redirect URI | Step 3 | New site's callback URL, exactly |
| Client ID / secret | Step 4 | New site's own config file |

If the new site reuses When RU Free's PHP code (`includes/oauth.php`), the redirect URI is `https://NEWDOMAIN/api.php?action=oauth_google`
and the keys go in the same `accounts` block. For different code, the site must do the standard server-side flow:

1. Send the user to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid`,
   a random `state`, a random `nonce` and a PKCE `code_challenge` (S256).
2. On the redirect back, check `state`, then POST the `code` (with the client secret and PKCE `code_verifier`) to `https://oauth2.googleapis.com/token`.
3. From the returned `id_token`, check `iss` is `https://accounts.google.com`, `aud` is your client ID, it hasn't expired, and `nonce` matches.
4. Use the `sub` claim as the user's Google ID (store a keyed hash of it rather than the raw value, as When RU Free does).

---

## Local testing (optional)

Google allows `http://localhost` redirect URIs. To test on your own computer, add a second redirect URI such as
`http://localhost/whenrufree/api.php?action=oauth_google` to the same client, and set `base_url` in your local config to match.
Remove it when you no longer need it. Note that the site's sign-in cookie is only marked `Secure` on HTTPS, so localhost works over plain HTTP.

---

## Quick checklist

- [ ] Project created (one per site)
- [ ] Consent screen: External, name, support email, home/privacy/terms links, authorised domain, developer email
- [ ] Scope: `openid` only
- [ ] Test user added (while in Testing)
- [ ] Web application client created, redirect URI exact, no JavaScript origins
- [ ] Client ID and secret saved in the password manager
- [ ] Keys in the private `config.php`; `base_url` matches the redirect URI
- [ ] Tested sign-in in an incognito window
- [ ] App published (In production)
- [ ] Optional: brand verification / domain verified in Search Console
