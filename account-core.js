/**
 * account-core.js - Shared sign-in helpers for every page (window.Account).
 *
 * The account session is an HttpOnly cookie set by api.php, so pages never see or store a
 * token. Account.require() resolves with the signed-in account, or shows a sign-in panel
 * (Google, Facebook, passkey) that cannot be dismissed, because calendars and Hubs are only
 * for signed-in accounts. Accounts without a username / name yet are sent to account.html.
 *
 * Load after passkey.js (for passkey sign-in). All text is set with textContent.
 */
(function () {
  const script = document.currentScript;
  const BASE = new URL('.', script ? script.src : location.href);
  const API = new URL('api.php', BASE).toString();
  const ACCOUNT_PAGE = new URL('account.html', BASE).toString();

  let csrfToken = null;
  let mePromise = null;
  let signinResult;

  const SIGNIN_MESSAGES = {
    failed: "Sign-in didn't work. Please try again.",
    expired: 'That sign-in took too long or was interrupted. Please try again.',
    unavailable: "That sign-in method isn't available right now.",
    linked: 'Sign-in method added.',
    taken: 'That account is already linked to a different When RU Free account.',
  };

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else node.setAttribute(k, v);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    return el('span', { className: 'material-symbols-outlined', 'aria-hidden': 'true' }, name);
  }

  const BRAND_LOGOS = {
    google: {
      viewBox: '0 0 48 48',
      paths: [
        ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
        ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
        ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
        ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
        ['none', 'M0 0h48v48H0z'],
      ],
    },
    facebook: {
      viewBox: '0 0 24 24',
      paths: [
        ['currentColor', 'M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07'],
      ],
    },
  };

  /** Google or Facebook logo as an inline SVG (no external requests). */
  function brandLogo(provider) {
    const NS = 'http://www.w3.org/2000/svg';
    const brand = BRAND_LOGOS[provider];
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', brand.viewBox);
    svg.setAttribute('class', `acct-logo acct-logo-${provider}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    brand.paths.forEach(([fill, d]) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('fill', fill);
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /**
   * Google's own "Sign in with Google" HTML button (branding configurator markup, gsi-material-button
   * styles in account.css). Google app verification requires this design; don't restyle it.
   */
  function googleButton(label, onClick) {
    const b = el('button', { type: 'button', className: 'gsi-material-button' });
    b.appendChild(el('div', { className: 'gsi-material-button-state' }));
    const wrap = el('div', { className: 'gsi-material-button-content-wrapper' });
    const iconBox = el('div', { className: 'gsi-material-button-icon' });
    iconBox.appendChild(brandLogo('google'));
    wrap.appendChild(iconBox);
    wrap.appendChild(el('span', { className: 'gsi-material-button-contents' }, label));
    b.appendChild(wrap);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Current page path + query without our own signin= result flag. */
  function currentReturnPath() {
    const url = new URL(location.href);
    url.searchParams.delete('signin');
    return url.pathname + url.search;
  }

  async function csrf() {
    if (csrfToken) return csrfToken;
    const res = await fetch(`${API}?action=csrf_token`, { credentials: 'same-origin' });
    const data = await res.json();
    csrfToken = data.csrf_token || '';
    return csrfToken;
  }

  async function getJson(action, params) {
    const qs = new URLSearchParams({ action, ...(params || {}) });
    const res = await fetch(`${API}?${qs}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({ status: 'error', message: 'Server error' }));
    return { ok: res.ok, status: res.status, data };
  }

  async function postJson(action, body, params) {
    const qs = new URLSearchParams({ action, ...(params || {}) });
    const token = await csrf();
    const res = await fetch(`${API}?${qs}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({ status: 'error', message: 'Server error' }));
    return { ok: res.ok, status: res.status, data };
  }

  function me(force) {
    if (!mePromise || force) {
      mePromise = getJson('account_me').then((r) => (r.ok ? r.data : { available: false, signed_in: false, methods: {} }));
    }
    return mePromise;
  }

  function goToSetup() {
    location.href = `${ACCOUNT_PAGE}?return=${encodeURIComponent(currentReturnPath())}`;
  }

  function startOAuth(provider, mode) {
    const qs = new URLSearchParams({ action: 'oauth_start', provider, mode: mode || 'login', return: currentReturnPath() });
    location.href = `${API}?${qs}`;
  }

  /** After a passkey sign-in / sign-up: finish setup first if needed, else reload the page. */
  function afterSignIn(needsSetup) {
    if (needsSetup) goToSetup();
    else location.reload();
  }

  async function passkeyLogin(statusEl) {
    const say = (t) => { if (statusEl) statusEl.textContent = t; };
    try {
      say('Waiting for your fingerprint, face or screen lock...');
      const begin = await postJson('account_passkey_login_begin');
      if (!begin.ok) throw new Error(begin.data.message || 'Could not start');
      const credential = await window.Passkey.get(begin.data.publicKey);
      const fin = await postJson('account_passkey_login_finish', { credential });
      if (!fin.ok) {
        if (fin.data.code === 'NO_PASSKEY') window.Passkey.signalRemoved(credential.id);
        throw new Error(fin.data.message || 'Sign-in failed');
      }
      afterSignIn(!!fin.data.needs_setup);
    } catch (e) {
      say(window.Passkey.isCancel(e) ? '' : (e.message || 'Sign-in failed'));
    }
  }

  async function passkeySignup(statusEl) {
    const say = (t) => { if (statusEl) statusEl.textContent = t; };
    try {
      say('Creating your passkey...');
      const begin = await postJson('account_passkey_signup_begin');
      if (!begin.ok) throw new Error(begin.data.message || 'Could not start');
      const credential = await window.Passkey.create(begin.data.publicKey);
      const fin = await postJson('account_passkey_signup_finish', { credential, device_label: window.Passkey.deviceLabel() });
      if (!fin.ok) throw new Error(fin.data.message || 'Could not create the account');
      afterSignIn(true);
    } catch (e) {
      if (window.Passkey.isDuplicate(e)) say('This device already has a passkey for When RU Free. Use "Sign in with a passkey".');
      else say(window.Passkey.isCancel(e) ? '' : (e.message || 'Could not create the account'));
    }
  }

  /**
   * Sign-in buttons for the methods this site offers. Used by the overlay and account.html.
   * @returns {HTMLElement}
   */
  function renderSignInButtons(methods) {
    const wrap = el('div', { className: 'acct-methods' });
    const status = el('p', { className: 'acct-status', role: 'status', 'aria-live': 'polite' });

    const addBtn = (cls, iconNode, label, onClick) => {
      const b = el('button', { type: 'button', className: `acct-btn ${cls}` });
      b.appendChild(iconNode);
      b.appendChild(el('span', { className: 'acct-btn-label' }, label));
      b.addEventListener('click', onClick);
      wrap.appendChild(b);
      return b;
    };

    if (methods.google) wrap.appendChild(googleButton('Continue with Google', () => startOAuth('google')));
    if (methods.facebook) addBtn('acct-btn-facebook', brandLogo('facebook'), 'Continue with Facebook', () => startOAuth('facebook'));
    if (methods.passkey && window.Passkey && window.Passkey.supported()) {
      addBtn('acct-btn-secondary', icon('fingerprint'), 'Sign in with a passkey', () => passkeyLogin(status));
      addBtn('acct-btn-ghost', icon('person_add'), 'New here? Create an account with a passkey', () => passkeySignup(status));
    }
    if (!wrap.children.length) {
      wrap.appendChild(el('p', { className: 'acct-status' }, 'No sign-in method is available on this device.'));
    }
    wrap.appendChild(status);
    return wrap;
  }

  /**
   * Full-screen sign-in panel. Not dismissible by default: nothing on the page works without an
   * account. With opts.dismissible (the home page preview) it has a close button, Escape and a
   * backdrop tap to close.
   */
  function showSignIn(info, opts) {
    if (document.getElementById('acctOverlay')) return;
    const dismissible = !!(opts && opts.dismissible);
    const overlay = el('div', { id: 'acctOverlay', className: 'acct-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acctTitle' });
    const box = el('div', { className: 'acct-box' });

    if (dismissible) {
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      const close = () => {
        overlay.remove();
        document.body.classList.remove('acct-locked');
        document.removeEventListener('keydown', onKey);
      };
      overlay.classList.add('acct-overlay-soft');
      const x = el('button', { type: 'button', className: 'acct-close', 'aria-label': 'Close', title: 'Close' });
      x.appendChild(icon('close'));
      x.addEventListener('click', close);
      box.appendChild(x);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', onKey);
    }

    box.appendChild(el('h2', { id: 'acctTitle', className: 'acct-title' }, 'Sign in to continue'));

    if (!info.available) {
      box.appendChild(el('p', { className: 'acct-text' }, 'Sign-in is not set up on this server yet. Please try again later.'));
    } else {
      box.appendChild(el('p', { className: 'acct-text' },
        'You need a free account to open, join or create calendars and Hubs.'));
      box.appendChild(renderSignInButtons(info.methods || {}));
    }

    const links = el('p', { className: 'acct-links' });
    [['index.html', 'Home'], ['faq.html', 'FAQs'], ['guide.html', 'Guide'], ['privacy.html', 'Privacy']].forEach(([href, label], i) => {
      if (i) links.appendChild(document.createTextNode(' | '));
      links.appendChild(el('a', { href: new URL(href, BASE).toString() }, label));
    });
    box.appendChild(links);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.body.classList.add('acct-locked');
    const first = box.querySelector('.acct-methods button') || box.querySelector('button, a');
    if (first) first.focus();
  }

  /**
   * Resolve with the signed-in, set-up account. Otherwise show the sign-in panel or go to
   * account.html to finish setup, and never resolve.
   */
  async function requireSignedIn() {
    const info = await me();
    if (info.signed_in && !info.needs_setup) return info;
    if (info.signed_in) goToSetup();
    else showSignIn(info);
    return new Promise(() => {});
  }

  /** The calendar (?c=) or Hub (?g=) this page is for, as API params. */
  function pageTarget() {
    const qs = new URL(location.href).searchParams;
    if (qs.get('c')) return { c: qs.get('c') };
    if (qs.get('g')) return { g: qs.get('g') };
    return {};
  }

  const INVITE_TEXT = {
    none: (what, name) => [
      `${what} is invite only`,
      `Ask the organiser to let you in. They will see your profile name${name ? ` (${name})` : ''}.`,
    ],
    pending: (what) => [
      'Request sent',
      `Waiting for the organiser to approve you. Come back to this link later: ${what.toLowerCase()} opens once you are approved. It is also listed on your profile under "Waiting for approval".`,
    ],
    declined: () => ['Not approved', 'The organiser did not approve your request.'],
    blocked: () => ['Access paused', 'The organiser has paused your access.'],
  };

  /**
   * Panel for an Invite only calendar or Hub (403 INVITE_ONLY) or a blocked person (403 BLOCKED).
   * Not dismissible: the page cannot load until the organiser lets the account in.
   */
  function showInvite(invite) {
    let overlay = document.getElementById('acctInvite');
    if (!overlay) {
      overlay = el('div', { id: 'acctInvite', className: 'acct-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acctInviteTitle' });
      document.body.appendChild(overlay);
      document.body.classList.add('acct-locked');
    }
    overlay.textContent = '';
    const what = invite.kind === 'hub' ? 'This Hub' : 'This calendar';
    const status = INVITE_TEXT[invite.status] ? invite.status : 'none';
    const [title, text] = INVITE_TEXT[status](what, invite.profile_name || '');

    const box = el('div', { className: 'acct-box' });
    box.appendChild(el('h2', { id: 'acctInviteTitle', className: 'acct-title' }, title));
    if (invite.title) box.appendChild(el('p', { className: 'acct-invite-name' }, invite.title));
    box.appendChild(el('p', { className: 'acct-text' }, text));

    const msg = el('p', { className: 'acct-status', role: 'status', 'aria-live': 'polite' });
    const actions = el('div', { className: 'acct-invite-actions' });
    const button = (cls, iconName, label, onClick) => {
      const b = el('button', { type: 'button', className: `acct-btn ${cls}` });
      b.appendChild(icon(iconName));
      b.appendChild(el('span', {}, label));
      b.addEventListener('click', async () => {
        b.disabled = true;
        await onClick();
        b.disabled = false;
      });
      actions.appendChild(b);
      return b;
    };

    if (status === 'none') {
      button('acct-btn-primary', 'how_to_reg', 'Request access', async () => {
        const r = await postJson('request_access', {}, pageTarget());
        if (r.ok && r.data.request_status === 'approved') { location.reload(); return; }
        if (r.ok) { showInvite({ ...invite, status: 'pending' }); return; }
        if (r.data.code === 'BLOCKED' || r.data.code === 'REQUEST_DECLINED') {
          showInvite({ ...invite, status: r.data.code === 'BLOCKED' ? 'blocked' : 'declined' });
          return;
        }
        msg.textContent = r.data.message || 'Could not send the request. Please try again.';
      });
    } else if (status === 'pending') {
      button('acct-btn-primary', 'refresh', 'Check again', async () => { location.reload(); });
      button('acct-btn-ghost', 'close', 'Cancel request', async () => {
        const r = await postJson('cancel_access_request', {}, pageTarget());
        if (r.ok) showInvite({ ...invite, status: 'none' });
        else msg.textContent = r.data.message || 'Could not cancel. Please try again.';
      });
    }
    box.appendChild(actions);
    box.appendChild(msg);

    const links = el('p', { className: 'acct-links' });
    [['index.html', 'Home'], ['account.html', 'Your profile'], ['faq.html', 'FAQs']].forEach(([href, label], i) => {
      if (i) links.appendChild(document.createTextNode(' | '));
      links.appendChild(el('a', { href: new URL(href, BASE).toString() }, label));
    });
    box.appendChild(links);
    overlay.appendChild(box);
    const first = box.querySelector('button, a');
    if (first) first.focus();
  }

  /**
   * React to an API error that means "not signed in", "not set up", "invite only" or "blocked".
   * Returns true when handled (the page should stop).
   */
  function handleApiError(data) {
    const code = data && data.code;
    if (code === 'ACCOUNT_REQUIRED') {
      me(true).then(showSignIn);
      return true;
    }
    if (code === 'ACCOUNT_SETUP') {
      goToSetup();
      return true;
    }
    if (code === 'INVITE_ONLY' || code === 'BLOCKED') {
      showInvite({ ...(data.invite || {}), status: code === 'BLOCKED' ? 'blocked' : ((data.invite || {}).status || 'none') });
      return true;
    }
    return false;
  }

  /** Show (and remove from the URL) the result of a Google / Facebook round trip. */
  function takeSigninResult() {
    if (signinResult !== undefined) return signinResult;
    const url = new URL(location.href);
    const result = url.searchParams.get('signin');
    signinResult = result;
    if (!result) return null;
    url.searchParams.delete('signin');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    const message = SIGNIN_MESSAGES[result];
    if (message && result !== 'linked' && result !== 'taken') toast(message);
    return result;
  }

  function toast(message) {
    const t = el('div', { className: 'acct-toast', role: 'status' }, message);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  /** Small "profile" link showing the profile name, for page headers. */
  function renderBadge(info, parent) {
    if (!parent || !info || !info.signed_in) return null;
    const a = el('a', { href: ACCOUNT_PAGE, className: 'acct-badge', title: 'Your profile, calendars and Hubs' });
    a.appendChild(icon('account_circle'));
    a.appendChild(el('span', { className: 'acct-badge-name' }, info.display_name || 'Profile'));
    parent.appendChild(a);
    return a;
  }

  /** "Sign in" button in the badge spot for signed-out visitors (home page preview). */
  function renderSignInBadge(parent, onClick) {
    if (!parent) return null;
    const b = el('button', { type: 'button', className: 'acct-badge acct-badge-signin', title: 'Sign in or create a free account' });
    b.appendChild(icon('login'));
    b.appendChild(el('span', { className: 'acct-badge-name' }, 'Sign in'));
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }

  async function logout() {
    await postJson('account_logout');
    mePromise = null;
  }

  window.Account = {
    API,
    ACCOUNT_PAGE,
    SIGNIN_MESSAGES,
    me,
    require: requireSignedIn,
    csrf,
    getJson,
    postJson,
    startOAuth,
    brandLogo,
    googleButton,
    passkeyLogin,
    passkeySignup,
    renderSignInButtons,
    showSignIn,
    showInvite,
    handleApiError,
    takeSigninResult,
    toast,
    renderBadge,
    renderSignInBadge,
    logout,
    currentReturnPath,
  };

  document.addEventListener('DOMContentLoaded', takeSigninResult);
})();
