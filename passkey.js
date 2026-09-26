/**
 * passkey.js - Browser helpers for fingerprint / face / device screen lock login (WebAuthn).
 * Shared by calendar.js and hub.js; page scripts own the API calls and UI.
 *
 * Remembers per device which names have a passkey (localStorage), because passkeys
 * live on the device and the server only knows which identities have one somewhere.
 */
(function () {
  const DEVICE_PREFIX = 'wruf_pk_';
  const DISMISS_PREFIX = 'wruf_pk_no_';

  function b64uToBuf(b64u) {
    const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
    const bin = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function bufToB64u(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function reviveOptions(pk) {
    const o = JSON.parse(JSON.stringify(pk));
    o.challenge = b64uToBuf(o.challenge);
    if (o.user && o.user.id) o.user.id = b64uToBuf(o.user.id);
    ['excludeCredentials', 'allowCredentials'].forEach((k) => {
      if (Array.isArray(o[k])) o[k] = o[k].map((c) => ({ ...c, id: b64uToBuf(c.id) }));
    });
    return o;
  }

  function serialize(cred) {
    const r = cred.response;
    const out = { id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type, response: {} };
    ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'].forEach((k) => {
      if (r[k]) out.response[k] = bufToB64u(r[k]);
    });
    if (typeof r.getTransports === 'function') {
      try { out.transports = r.getTransports(); } catch (e) { /* ignore */ }
    }
    return out;
  }

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* private mode */ }
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "2026-09-26 08:51:00" -> "26 Sep 2026" (date part only, so no timezone shift). */
  function formatDay(sqlDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(sqlDate || ''));
    return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
  }

  function isPhoneLabel(label) {
    return /iphone|ipad|android/i.test(label || '');
  }

  window.Passkey = {
    supported() {
      return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
    },

    /** True when this device has a built-in fingerprint / face / screen-lock authenticator. */
    async platformAvailable() {
      if (!this.supported()) return false;
      try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch (e) {
        return false;
      }
    },

    async create(publicKey) {
      const cred = await navigator.credentials.create({ publicKey: reviveOptions(publicKey) });
      if (!cred) throw new Error('Cancelled');
      return serialize(cred);
    },

    async get(publicKey) {
      const cred = await navigator.credentials.get({ publicKey: reviveOptions(publicKey) });
      if (!cred) throw new Error('Cancelled');
      return serialize(cred);
    },

    /** User cancelled or the prompt timed out (not a real failure). */
    isCancel(e) {
      return !!e && (e.name === 'NotAllowedError' || e.name === 'AbortError' || e.message === 'Cancelled');
    },

    /** Device already has a passkey for this name (excludeCredentials matched). */
    isDuplicate(e) {
      return !!e && e.name === 'InvalidStateError';
    },

    /** Base64url credential ID of this device's passkey for the identity, or null. */
    deviceCredential(id) { return read(DEVICE_PREFIX + id); },
    rememberDevice(id, credentialId) { store(DEVICE_PREFIX + id, credentialId || '1'); store(DISMISS_PREFIX + id, null); },
    forgetDevice(id) { store(DEVICE_PREFIX + id, null); },

    wasDismissed(id) { return read(DISMISS_PREFIX + id) === '1'; },
    dismiss(id) { store(DISMISS_PREFIX + id, '1'); },

    /** Short name for this device, stored with the passkey so the owner can tell devices apart. */
    deviceLabel() {
      const ua = navigator.userAgent || '';
      if (/iPhone/.test(ua)) return 'iPhone';
      if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
      if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
      if (/CrOS/.test(ua)) return 'Chromebook';
      if (/Windows/.test(ua)) return 'Windows PC';
      if (/Macintosh/.test(ua)) return 'Mac';
      if (/Linux/.test(ua)) return 'Linux PC';
      return 'Device';
    },

    /**
     * Forget this device's enrolment if the server no longer has it (removed from another device).
     * Returns the credential ID still remembered for this device, or null.
     */
    syncDevice(id, credentials) {
      const mine = this.deviceCredential(id);
      if (!mine) return null;
      const list = Array.isArray(credentials) ? credentials : [];
      const known = mine === '1' ? list.length > 0 : list.some((c) => c.credential_id === mine);
      if (!known) {
        this.forgetDevice(id);
        return null;
      }
      return mine;
    },

    /**
     * Fill a <ul> with the owner's devices. onRemove(credential) is called from each Remove button.
     * All text is set via textContent.
     */
    renderList(listEl, credentials, thisDeviceCredId, onRemove) {
      listEl.textContent = '';
      const list = Array.isArray(credentials) ? credentials : [];
      if (!list.length) {
        const li = document.createElement('li');
        li.className = 'passkey-empty';
        li.textContent = 'No passkeys yet. Add one to unlock with your fingerprint, face or screen lock.';
        listEl.appendChild(li);
        return;
      }
      list.forEach((c) => {
        const label = c.device_label || 'Device';
        const li = document.createElement('li');
        li.className = 'passkey-item';

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined passkey-item-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = isPhoneLabel(label) ? 'smartphone' : 'computer';

        const text = document.createElement('span');
        text.className = 'passkey-item-text';
        const name = document.createElement('strong');
        name.textContent = label + (thisDeviceCredId && c.credential_id === thisDeviceCredId ? ' (this device)' : '');
        const sub = document.createElement('span');
        sub.className = 'passkey-item-sub';
        const added = formatDay(c.created_at);
        const used = formatDay(c.last_used_at);
        sub.textContent = (added ? `Added ${added}` : '') + (used ? ` - last used ${used}` : '');
        text.appendChild(name);
        text.appendChild(sub);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'passkey-remove';
        del.textContent = 'Remove';
        del.setAttribute('aria-label', `Remove ${label}`);
        del.addEventListener('click', () => onRemove(c, del));

        li.appendChild(icon);
        li.appendChild(text);
        li.appendChild(del);
        listEl.appendChild(li);
      });
    },

    /** Ask the browser to delete a passkey the server no longer accepts (where supported). */
    signalRemoved(credentialId) {
      if (!credentialId || typeof PublicKeyCredential === 'undefined'
        || typeof PublicKeyCredential.signalUnknownCredential !== 'function') return;
      PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId })
        .catch(() => { /* best effort */ });
    }
  };
})();
