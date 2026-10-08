/**
 * passkey.js - Browser helpers for passkey sign-in (fingerprint / face / device screen lock, WebAuthn).
 * Used by account-core.js (sign in, create an account) and account.js (add a passkey);
 * those scripts own the API calls and UI.
 */
(function () {
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

  window.Passkey = {
    supported() {
      return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
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

    /** Device already has a passkey for this account (excludeCredentials matched). */
    isDuplicate(e) {
      return !!e && e.name === 'InvalidStateError';
    },

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

    /** Ask the browser to delete a passkey the server no longer accepts (where supported). */
    signalRemoved(credentialId) {
      if (!credentialId || typeof PublicKeyCredential === 'undefined'
        || typeof PublicKeyCredential.signalUnknownCredential !== 'function') return;
      PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId })
        .catch(() => { /* best effort */ });
    }
  };
})();
