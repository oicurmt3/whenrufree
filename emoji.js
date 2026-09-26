/**
 * emoji.js - Access emoji: the 35-emoji grid, the fullscreen picker used by organisers,
 * the "pick this emoji" gate shown to visitors, and storage for access grants.
 *
 * The server only knows emoji positions (0-34), so this list must not be reordered.
 * Exposes window.AccessEmoji. Styles live in emoji.css.
 */
(function () {
  'use strict';

  const LIST = [
    { e: '\u{1F436}', n: 'Dog' },
    { e: '\u{1F431}', n: 'Cat' },
    { e: '\u{1F98A}', n: 'Fox' },
    { e: '\u{1F43C}', n: 'Panda' },
    { e: '\u{1F438}', n: 'Frog' },

    { e: '\u{1F981}', n: 'Lion' },
    { e: '\u{1F427}', n: 'Penguin' },
    { e: '\u{1F989}', n: 'Owl' },
    { e: '\u{1F419}', n: 'Octopus' },
    { e: '\u{1F98B}', n: 'Butterfly' },

    { e: '\u{1F34E}', n: 'Apple' },
    { e: '\u{1F34C}', n: 'Banana' },
    { e: '\u{1F347}', n: 'Grapes' },
    { e: '\u{1F353}', n: 'Strawberry' },
    { e: '\u{1F349}', n: 'Watermelon' },

    { e: '\u{1F355}', n: 'Pizza' },
    { e: '\u{1F354}', n: 'Burger' },
    { e: '\u{1F32E}', n: 'Taco' },
    { e: '\u{1F366}', n: 'Ice cream' },
    { e: '\u{1F369}', n: 'Doughnut' },

    { e: '\u2600\uFE0F', n: 'Sun' },
    { e: '\u{1F319}', n: 'Moon' },
    { e: '\u{1F308}', n: 'Rainbow' },
    { e: '\u2744\uFE0F', n: 'Snowflake' },
    { e: '\u26A1', n: 'Lightning' },

    { e: '\u{1F697}', n: 'Car' },
    { e: '\u{1F6B2}', n: 'Bicycle' },
    { e: '\u{1F680}', n: 'Rocket' },
    { e: '\u26F5', n: 'Sailboat' },
    { e: '\u2708\uFE0F', n: 'Plane' },

    { e: '\u{1F3B8}', n: 'Guitar' },
    { e: '\u26BD', n: 'Soccer ball' },
    { e: '\u{1F381}', n: 'Gift' },
    { e: '\u{1F511}', n: 'Key' },
    { e: '\u{1F451}', n: 'Crown' }
  ];

  const GRANT_PREFIX = 'wruf_ag_';

  function valid(i) {
    return Number.isInteger(i) && i >= 0 && i < LIST.length;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function lockScroll(on) {
    document.documentElement.classList.toggle('ae-lock', on);
  }

  /**
   * Fill container with the 5-column grid. onSelect(i) runs on each tap.
   * Returns { select(i), focus() }.
   */
  function renderGrid(container, opts = {}) {
    const { selected = null, onSelect = null } = opts;
    container.innerHTML = '';
    container.classList.add('ae-grid');
    container.setAttribute('role', 'group');
    const cells = LIST.map((item, i) => {
      const b = el('button', 'ae-cell', item.e);
      b.type = 'button';
      b.setAttribute('aria-label', item.n);
      b.setAttribute('aria-pressed', 'false');
      b.title = item.n;
      b.addEventListener('click', () => {
        api.select(i);
        if (onSelect) onSelect(i);
      });
      container.appendChild(b);
      return b;
    });
    const api = {
      select(i) {
        cells.forEach((c, j) => {
          const on = j === i;
          c.classList.toggle('is-selected', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      },
      focus() {
        const cur = cells.find(c => c.classList.contains('is-selected')) || cells[0];
        cur.focus();
      }
    };
    if (valid(selected)) api.select(selected);
    return api;
  }

  /**
   * Fullscreen picker for organisers. Resolves with the chosen position, or null on cancel.
   */
  function openPicker(opts = {}) {
    const {
      title = 'Choose your emoji',
      hint = 'People pick this emoji before the page opens.',
      confirmLabel = 'Use this emoji',
      selected = null
    } = opts;

    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      let choice = valid(selected) ? selected : null;

      const root = el('div', 'ae-picker');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'aePickerTitle');

      const head = el('div', 'ae-picker-head');
      const h = el('h2', 'ae-picker-title', title);
      h.id = 'aePickerTitle';
      const cancel = el('button', 'ae-btn ae-btn-ghost', 'Cancel');
      cancel.type = 'button';
      head.append(h, cancel);

      const body = el('div', 'ae-picker-body');
      const gridEl = el('div');
      body.appendChild(gridEl);

      const foot = el('div', 'ae-picker-foot');
      const current = el('p', 'ae-picker-current');
      const hintEl = el('p', 'ae-picker-hint', hint);
      const ok = el('button', 'ae-btn ae-btn-primary ae-btn-block', confirmLabel);
      ok.type = 'button';
      foot.append(current, hintEl, ok);

      root.append(head, body, foot);

      const showChoice = () => {
        ok.disabled = choice === null;
        current.textContent = choice === null ? 'Tap an emoji' : `${LIST[choice].e} ${LIST[choice].n}`;
      };
      const grid = renderGrid(gridEl, {
        selected: choice,
        onSelect: i => { choice = i; showChoice(); }
      });
      showChoice();

      const close = value => {
        document.removeEventListener('keydown', onKey, true);
        root.remove();
        lockScroll(false);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(value);
      };
      const onKey = e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(null);
        }
      };
      cancel.addEventListener('click', () => close(null));
      ok.addEventListener('click', () => { if (choice !== null) close(choice); });
      document.addEventListener('keydown', onKey, true);

      lockScroll(true);
      document.body.appendChild(root);
      grid.focus();
    });
  }

  /**
   * Blocking "pick the emoji" popup for visitors. submit(i) must resolve to
   * { ok: true } or { ok: false, message }. Resolves once submit succeeds.
   */
  function gate(opts = {}) {
    const {
      title = 'Pick the emoji',
      hint = "Ask the organiser if you don't know it.",
      submit
    } = opts;

    return new Promise(resolve => {
      let choice = null;
      let busy = false;

      const overlay = el('div', 'ae-gate-overlay');
      const card = el('div', 'ae-gate');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', 'aeGateTitle');

      const h = el('h2', null, title);
      h.id = 'aeGateTitle';
      const p = el('p', 'ae-gate-hint', hint);
      const gridEl = el('div');
      const err = el('p', 'ae-gate-error');
      err.setAttribute('role', 'alert');

      const actions = el('div', 'ae-gate-actions');
      const home = el('a', 'ae-btn ae-btn-ghost', 'Home');
      home.href = 'index.html';
      const open = el('button', 'ae-btn ae-btn-primary', 'Open');
      open.type = 'button';
      open.disabled = true;
      actions.append(home, open);

      card.append(h, p, gridEl, err, actions);
      overlay.appendChild(card);

      const grid = renderGrid(gridEl, {
        onSelect: i => {
          choice = i;
          err.textContent = '';
          open.disabled = busy;
        }
      });

      const tryOpen = async () => {
        if (choice === null || busy) return;
        busy = true;
        open.disabled = true;
        err.textContent = '';
        let res;
        try {
          res = await submit(choice);
        } catch (e) {
          res = { ok: false, message: 'Could not check the emoji. Check your connection.' };
        }
        busy = false;
        if (res && res.ok) {
          overlay.remove();
          lockScroll(false);
          resolve();
          return;
        }
        err.textContent = (res && res.message) || "That's not the right emoji.";
        choice = null;
        grid.select(-1);
      };
      open.addEventListener('click', tryOpen);

      lockScroll(true);
      document.body.appendChild(overlay);
      grid.focus();
    });
  }

  /**
   * On/off switch with the chosen emoji and a Change button, built inside container.
   * Switching on or pressing Change opens the fullscreen picker. onChange(next) may be async
   * and return false to keep the current value (e.g. a failed save).
   * Returns { get value, set(v), setOffHint(text) }.
   */
  function field(container, opts = {}) {
    const {
      label = 'Access emoji',
      pickerTitle = 'Choose your emoji',
      pickerHint,
      offHint = 'Anyone with the link can open it.',
      onHint = 'People pick this emoji before the page opens.',
      value = null,
      onChange = async () => true
    } = opts;
    let current = valid(value) ? value : null;
    let off = offHint;
    let busy = false;

    container.innerHTML = '';
    container.classList.add('ae-field');
    const row = el('div', 'ae-switch-row');
    const lab = el('span', 'ae-switch-label', label);
    lab.id = `aeLabel${Math.random().toString(36).slice(2, 8)}`;
    const sw = el('button', 'ae-switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-labelledby', lab.id);
    row.append(lab, sw);

    const chosen = el('div', 'ae-chosen');
    const glyph = el('span', 'ae-chosen-glyph');
    glyph.setAttribute('aria-hidden', 'true');
    const nameEl = el('span', 'ae-chosen-name');
    const change = el('button', 'ae-btn ae-btn-ghost', 'Change');
    change.type = 'button';
    chosen.append(glyph, nameEl, change);

    const note = el('p', 'ae-note');
    container.append(row, chosen, note);

    const paint = () => {
      const on = current !== null;
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      chosen.classList.toggle('hideme-ae', !on);
      glyph.textContent = on ? LIST[current].e : '';
      nameEl.textContent = on ? LIST[current].n : '';
      note.textContent = on ? onHint : off;
    };

    const apply = async next => {
      if (busy) return;
      busy = true;
      sw.disabled = true;
      change.disabled = true;
      try {
        if (await onChange(next)) current = next;
      } finally {
        busy = false;
        sw.disabled = false;
        change.disabled = false;
        paint();
      }
    };

    const pick = async () => {
      const i = await openPicker({ title: pickerTitle, hint: pickerHint, selected: current });
      if (i !== null && i !== current) await apply(i);
    };

    sw.addEventListener('click', () => {
      if (current === null) pick();
      else apply(null);
    });
    change.addEventListener('click', pick);
    paint();

    return {
      get value() { return current; },
      set(v) { current = valid(v) ? v : null; paint(); },
      setOffHint(text) { off = text; paint(); }
    };
  }

  // -------------------------
  // Grants (localStorage, keyed 'c_<calendar token>' or 'g_<hub token>')
  // -------------------------

  // Copy for this page view, so a browser that blocks storage is not asked again at once.
  const memory = {};

  function saveGrant(key, token, expiresAt) {
    if (!key || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return;
    const exp = Date.parse(expiresAt || '') || (Date.now() + 30 * 86400000);
    memory[key] = { t: token, exp };
    try {
      localStorage.setItem(GRANT_PREFIX + key, JSON.stringify({ t: token, exp }));
    } catch (e) { /* storage full or blocked: memory copy only */ }
  }

  function getGrant(key) {
    if (!key) return null;
    const mem = memory[key];
    if (mem && mem.exp > Date.now()) return mem.t;
    try {
      const raw = localStorage.getItem(GRANT_PREFIX + key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.t !== 'string' || !(obj.exp > Date.now())) {
        localStorage.removeItem(GRANT_PREFIX + key);
        return null;
      }
      return obj.t;
    } catch (e) {
      return null;
    }
  }

  function clearGrant(key) {
    delete memory[key];
    try { localStorage.removeItem(GRANT_PREFIX + key); } catch (e) { /* ignore */ }
  }

  /** Comma-separated grants for the X-Access-Grant header ('' when none). */
  function grantHeader(keys) {
    const out = [];
    for (const k of keys) {
      const t = getGrant(k);
      if (t && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 3).join(',');
  }

  /**
   * Text line for links that are copied, shared, emailed, downloaded or printed:
   * "Emoji: <glyph> <name>", the Hub's emoji when inherited, or '' when there is none.
   */
  function shareLine(i, inherited = false) {
    if (valid(i)) return `Emoji: ${LIST[i].e} ${LIST[i].n}`;
    if (inherited) return "Emoji: use the Hub's emoji";
    return '';
  }

  window.AccessEmoji = {
    COUNT: LIST.length,
    list: LIST,
    valid,
    glyph(i) { return valid(i) ? LIST[i].e : ''; },
    name(i) { return valid(i) ? LIST[i].n : ''; },
    shareLine,
    renderGrid,
    openPicker,
    gate,
    field,
    saveGrant,
    getGrant,
    clearGrant,
    grantHeader
  };
})();
