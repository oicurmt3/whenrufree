/**
 * admin-setup.js - Setup tab: site config editor (slots, options, presets, dates, retention) and save/reload.
 * Classic script sharing global scope. Load order: emoji.js, admin-core.js, admin-calendars.js, admin-hubs.js, admin-accounts.js, admin-setup.js.
 */
'use strict';

// =========================================
// SETUP PAGE EDITOR
// =========================================

// DOM refs for setup tab
const saveConfigBtn    = document.getElementById('saveConfigBtn');
const saveConfigBtn2   = document.getElementById('saveConfigBtn2');
const reloadConfigBtn  = document.getElementById('reloadConfigBtn');
const setupStatus      = document.getElementById('setupStatus');
const slotsMaxInput    = document.getElementById('slotsMaxInput');
const slotExamplesWrap = document.getElementById('slotExamplesWrap');
const slotDefaultsWrap = document.getElementById('slotDefaultsWrap');
const addSlotExBtn     = document.getElementById('addSlotExampleBtn');
const addSlotDefBtn    = document.getElementById('addSlotDefaultBtn');
const optionsMaxInput  = document.getElementById('optionsMaxInput');
const presetsWrap      = document.getElementById('presetsWrap');
const optDefaultsWrap  = document.getElementById('optDefaultsWrap');
const addPresetBtn     = document.getElementById('addPresetBtn');
const addOptDefBtn     = document.getElementById('addOptDefaultBtn');
const maxRangeDaysInput= document.getElementById('maxRangeDaysInput');
const datePresetsWrap  = document.getElementById('datePresetsWrap');
const addDatePresetBtn = document.getElementById('addDatePresetBtn');
const retentionDaysInput = document.getElementById('retentionDaysInput');
const hubRetentionDaysInput = document.getElementById('hubRetentionDaysInput');
const examplesWrap     = document.getElementById('examplesWrap');
const addExampleBtn    = document.getElementById('addExampleBtn');

/**
 * Template cards available on ideas.html, as {key, label} pairs. Read from the page itself
 * (loadTemplateCards) so the admin list can never drift from the cards that exist.
 * @type {Array<{key:string, label:string}>}
 */
let templateCardOptions = [];

/**
 * Show a status message in all save bars (top, bottom, and per-section).
 * @param {string} msg
 * @param {'ok'|'error'|''} type
 * @param {boolean} mainOnly - if true, only update top/bottom bars (not section spans)
 */
function setSetupStatus(msg, type, mainOnly) {
    const cls = 'setup-status' + (type ? ' setup-status-' + type : '');
    // Always update the main named bars
    ['setupStatus', 'setupStatus2'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg;
        el.className = cls;
    });
    // Only update section spans for final results (not transient "Loading..."/"Saving...")
    if (!mainOnly) {
        document.querySelectorAll('.js-setup-status').forEach(el => {
            el.textContent = msg;
            // Preserve js-setup-status class alongside the status colour class
            el.className = 'setup-status js-setup-status' + (type ? ' setup-status-' + type : '');
        });
    }
}

/**
 * Fetch site_config.json from the server and populate the editor.
 */
async function loadSiteConfig() {
    setSetupStatus('Loading...', '', true);
    await loadTemplateCards();
    try {
        const data = await apiRequest('get_site_config', 'GET');
        if (data && data.config && typeof data.config === 'object' && Object.keys(data.config).length > 0) {
            currentConfig = JSON.parse(JSON.stringify(data.config)); // deep clone
            renderSetupEditor(currentConfig);
            setupConfigLoaded = true;
            setSetupStatus('', '', true);
        } else {
            // Empty or missing config - seed editor with defaults
            currentConfig = getDefaultConfig();
            renderSetupEditor(currentConfig);
            setupConfigLoaded = true;
            setSetupStatus('Loaded defaults - save to apply.', '', true);
        }
    } catch (e) {
        setSetupStatus('Failed to load config: ' + e.message, 'error');
    }
}

/**
 * Read the template cards from ideas.html so the admin can pick one by name instead of
 * typing a key. Cards carry a data-tpl key; the heading text becomes the label.
 * Failure is not fatal: the rows fall back to a free-text key box.
 */
async function loadTemplateCards() {
    if (templateCardOptions.length > 0) return;
    const found = [];
    try {
        const resp = await fetch('ideas.html', { method: 'GET', credentials: 'same-origin' });
        if (resp.ok) {
            const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
            doc.querySelectorAll('.template-card').forEach(card => {
                const key = (card.dataset.tpl || '').trim();
                if (!key || found.some(o => o.key === key)) return;
                // Take the heading text without the leading icon span, which would otherwise
                // contribute its ligature name ("sports_soccer Weekday Sports Tryouts")
                const heading = card.querySelector('h3');
                let label = key;
                if (heading) {
                    const clone = heading.cloneNode(true);
                    clone.querySelectorAll('.material-symbols-outlined').forEach(sp => sp.remove());
                    label = clone.textContent.trim() || key;
                }
                found.push({ key, label });
            });
        }
    } catch (e) {
        console.warn('Could not read the template card list from ideas.html:', e);
    }
    templateCardOptions = found;
}

/**
 * Returns a sensible default config object matching the bundled site_config.json.
 */
function getDefaultConfig() {
    return {
        slots: {
            max: 6,
            examples: ['Morning','Lunch','Afternoon','Evening','Dinner','Day','Night','After work'],
            defaults: ['Morning','Afternoon','Evening']
        },
        options: {
            max: 5,
            presets: [
                {key:'yes_maybe_no',          label:'Yes / No / Maybe (default)', items:[{label:'Yes',weight:2},{label:'Maybe',weight:1},{label:'No',weight:0}]},
                {key:'available_unavailable',  label:'Available / Unavailable',    items:[{label:'Available',weight:2},{label:'Unavailable',weight:0}]},
                {key:'attending_not_attending',label:'Attending / Not Attending',  items:[{label:'Attending',weight:2},{label:'Not attending',weight:0}]}
            ],
            defaults: [{label:'Yes',weight:2},{label:'Maybe',weight:1},{label:'No',weight:0}]
        },
        dates: {
            max_range_days: 360,
            presets: [
                {key:'1day',  label:'1 day',   days:0},
                {key:'1week', label:'1 week',  days:6},
                {key:'2weeks',label:'2 weeks', days:13},
                {key:'1month',label:'1 month', days:30}
            ]
        },
        examples: {
            items: [
                {card:'team-name-vote',     url:'calendar.html?c=Ua1dsF5q', label:'See an example', icon:'visibility', emoji:'\u{1F680}'},
                {card:'ranked-choice',      url:'calendar.html?c=Ua1dsF5q', label:'See an example', icon:'visibility', emoji:'\u{1F680}'},
                {card:'workplace-catchup',  url:'calendar.html?c=Ua1dsF5q', label:'See an example', icon:'visibility', emoji:'\u{1F680}'}
            ]
        },
        retention: {
            inactive_days: 40,
            hub_inactive_days: 40
        }
    };
}

/**
 * Sanitise a plain text string for safe insertion as text content.
 * No HTML is injected so this is belt-and-braces only.
 */
function setupSanitise(str, maxLen) {
    return String(str || '').replace(/[<>"'\\]/g, '').trim().slice(0, maxLen || 100);
}

// =========================================
// ROW ACTION BUTTONS (up / down / delete)
// =========================================

/**
 * Create up/down/delete action buttons for any setup row.
 * @param {HTMLElement} row - The row element these actions belong to.
 * @param {Function} [onDelete] - Optional callback after row is removed.
 * @returns {HTMLElement} The actions container.
 */
function makeActionButtons(row, onDelete) {
    const actions = document.createElement('div');
    actions.className = 'setup-actions';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn btn-icon btn-ghost btn-small setup-move-btn';
    up.dataset.action = 'up';
    up.title = 'Move up';
    up.setAttribute('aria-label', 'Move up');
    up.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">arrow_upward</span>';
    up.addEventListener('click', () => {
        const prev = row.previousElementSibling;
        if (prev) {
            row.parentNode.insertBefore(row, prev);
            updateMoveButtons(row.parentNode);
        }
    });

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn btn-icon btn-ghost btn-small setup-move-btn';
    down.dataset.action = 'down';
    down.title = 'Move down';
    down.setAttribute('aria-label', 'Move down');
    down.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">arrow_downward</span>';
    down.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next) {
            row.parentNode.insertBefore(next, row);
            updateMoveButtons(row.parentNode);
        }
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-icon btn-ghost btn-small setup-move-btn';
    del.dataset.action = 'delete';
    del.title = 'Remove';
    del.setAttribute('aria-label', 'Remove');
    del.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">delete</span>';
    del.addEventListener('click', () => {
        const parent = row.parentNode;
        row.remove();
        if (onDelete) onDelete();
        if (parent) updateMoveButtons(parent);
    });

    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(del);
    return actions;
}

/**
 * Disable up on first row and down on last row for all children of a container.
 * @param {HTMLElement} container
 */
function updateMoveButtons(container) {
    if (!container) return;
    const rows = Array.from(container.children);
    rows.forEach((r, idx) => {
        const up = r.querySelector('[data-action="up"]');
        const down = r.querySelector('[data-action="down"]');
        if (up) up.disabled = (idx === 0);
        if (down) down.disabled = (idx === rows.length - 1);
    });
}

// -------------------------
// SLOT EXAMPLES EDITOR (simple chip list)
// -------------------------

/**
 * Make a simple editable chip row (single text input + delete).
 * Used for slot examples, slot defaults.
 * @param {string} val
 * @param {string} placeholder
 * @returns {HTMLElement}
 */
function makeChipRow(val, placeholder) {
    const row = document.createElement('div');
    row.className = 'setup-row setup-chip-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'setup-input';
    input.placeholder = placeholder || 'Label';
    input.maxLength = 20;
    input.value = val || '';

    const actions = makeActionButtons(row);

    row.appendChild(input);
    row.appendChild(actions);
    return row;
}

/**
 * Read all chip row values from a container.
 * @param {HTMLElement} wrap
 * @returns {string[]}
 */
function readChipList(wrap) {
    const out = [];
    wrap.querySelectorAll('.setup-chip-row input').forEach(inp => {
        const v = setupSanitise(inp.value, 20);
        if (v) out.push(v);
    });
    return out;
}

if (addSlotExBtn) {
    addSlotExBtn.addEventListener('click', () => {
        slotExamplesWrap.appendChild(makeChipRow('', 'e.g. Morning'));
        slotExamplesWrap.lastElementChild.querySelector('input').focus();
        updateMoveButtons(slotExamplesWrap);
    });
}
if (addSlotDefBtn) {
    addSlotDefBtn.addEventListener('click', () => {
        slotDefaultsWrap.appendChild(makeChipRow('', 'e.g. Morning'));
        slotDefaultsWrap.lastElementChild.querySelector('input').focus();
        updateMoveButtons(slotDefaultsWrap);
    });
}

// -------------------------
// TEMPLATE EXAMPLES EDITOR
// -------------------------

/**
 * Make a template example row: card picker, link, and the optional button text / icon / emoji.
 * @param {{card:string, url:string, label:string, icon:string, emoji:string}} item
 * @returns {HTMLElement}
 */
function makeExampleRow(item) {
    const row = document.createElement('div');
    row.className = 'setup-row setup-example-row';

    // Card picker: a dropdown once ideas.html has been read, otherwise a plain key box
    let cardField;
    if (templateCardOptions.length > 0) {
        cardField = document.createElement('select');
        cardField.className = 'setup-select setup-example-card';
        cardField.setAttribute('aria-label', 'Template card');
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '- Pick a card -';
        cardField.appendChild(blank);
        // Repair a key that only differs by punctuation: earlier saves stripped the hyphens
        // ("team-name-vote" became "teamnamevote"). Selecting the real card means re-saving
        // writes the correct key back.
        let selected = item.card || '';
        if (selected && !templateCardOptions.some(o => o.key === selected)) {
            const want = String(selected).toLowerCase().replace(/[^a-z0-9]/g, '');
            const match = templateCardOptions.find(o => o.key.toLowerCase().replace(/[^a-z0-9]/g, '') === want);
            if (match) {
                selected = match.key;
            } else {
                // Genuinely gone from the page: keep it visible so the row cannot silently retarget
                const stale = document.createElement('option');
                stale.value = item.card;
                stale.textContent = item.card + ' (not found on the page)';
                cardField.appendChild(stale);
            }
        }
        templateCardOptions.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.key;
            opt.textContent = o.label;
            cardField.appendChild(opt);
        });
        cardField.value = selected;
    } else {
        cardField = document.createElement('input');
        cardField.type = 'text';
        cardField.className = 'setup-input setup-example-card';
        cardField.placeholder = 'Card key, e.g. team-name-vote';
        cardField.maxLength = 40;
        cardField.value = item.card || '';
        cardField.setAttribute('aria-label', 'Template card key');
    }

    const urlIn = document.createElement('input');
    urlIn.type = 'text';
    urlIn.className = 'setup-input setup-example-url';
    urlIn.placeholder = 'calendar.html?c=TOKEN';
    urlIn.maxLength = 300;
    urlIn.value = item.url || '';
    urlIn.setAttribute('aria-label', 'Example link');

    const labelIn = document.createElement('input');
    labelIn.type = 'text';
    labelIn.className = 'setup-input setup-example-label';
    labelIn.placeholder = 'See an example';
    labelIn.maxLength = 30;
    labelIn.value = item.label || '';
    labelIn.setAttribute('aria-label', 'Example button text');

    const iconIn = document.createElement('input');
    iconIn.type = 'text';
    iconIn.className = 'setup-input setup-example-icon';
    iconIn.placeholder = 'visibility';
    iconIn.maxLength = 40;
    iconIn.value = item.icon || '';
    iconIn.setAttribute('aria-label', 'Example button icon');
    iconIn.title = 'Material Symbols name, e.g. visibility';

    const emojiIn = document.createElement('input');
    emojiIn.type = 'text';
    emojiIn.className = 'setup-input setup-example-emoji';
    emojiIn.placeholder = '\u{1F680}';
    emojiIn.maxLength = 8;
    emojiIn.value = item.emoji || '';
    emojiIn.setAttribute('aria-label', 'Access emoji hint');
    emojiIn.title = 'Emoji for this demo, shown in the button tooltip';

    const actions = makeActionButtons(row);

    row.appendChild(cardField);
    row.appendChild(urlIn);
    row.appendChild(labelIn);
    row.appendChild(iconIn);
    row.appendChild(emojiIn);
    row.appendChild(actions);
    return row;
}

/**
 * Read all template example rows. Rows without a card or link are dropped, so the saved
 * list only holds usable buttons.
 * @returns {Array<{card:string, url:string, label?:string, icon?:string, emoji?:string}>}
 */
function readExamples() {
    const out = [];
    if (!examplesWrap) return out;
    examplesWrap.querySelectorAll('.setup-example-row').forEach(row => {
        const card = setupSanitise(row.querySelector('.setup-example-card')?.value, 40);
        const url  = String(row.querySelector('.setup-example-url')?.value || '').trim().slice(0, 300);
        if (!card || !url) return;
        const item = {card, url};
        const label = setupSanitise(row.querySelector('.setup-example-label')?.value, 30);
        const icon  = setupSanitise(row.querySelector('.setup-example-icon')?.value, 40);
        const emoji = String(row.querySelector('.setup-example-emoji')?.value || '').trim().slice(0, 8);
        if (label) item.label = label;
        if (icon)  item.icon  = icon;
        if (emoji) item.emoji = emoji;
        out.push(item);
    });
    return out;
}

if (addExampleBtn) {
    addExampleBtn.addEventListener('click', () => {
        if (!examplesWrap) return;
        examplesWrap.appendChild(makeExampleRow({card:'', url:'', label:'', icon:'', emoji:''}));
        const first = examplesWrap.lastElementChild.querySelector('.setup-example-card');
        if (first) first.focus();
        updateMoveButtons(examplesWrap);
    });
}

// -------------------------
// OPTION PRESETS EDITOR
// -------------------------

/**
 * Make an option default row: label text + weight number + delete.
 * @param {{label:string, weight:number}} item
 * @returns {HTMLElement}
 */
function makeOptDefaultRow(item) {
    const row = document.createElement('div');
    row.className = 'setup-row setup-opt-default-row';

    const labelIn = document.createElement('input');
    labelIn.type = 'text';
    labelIn.className = 'setup-input';
    labelIn.placeholder = 'e.g. Yes';
    labelIn.maxLength = 20;
    labelIn.value = item.label || '';
    labelIn.setAttribute('aria-label', 'Option label');

    const weightIn = document.createElement('input');
    weightIn.type = 'number';
    weightIn.className = 'setup-num-input';
    weightIn.min = 0;
    weightIn.max = 5;
    weightIn.value = item.weight !== undefined ? item.weight : 1;
    weightIn.setAttribute('aria-label', 'Weight 0-5');
    weightIn.title = 'Weight 0-5';

    const actions = makeActionButtons(row);

    row.appendChild(labelIn);
    row.appendChild(weightIn);
    row.appendChild(actions);
    return row;
}

/**
 * Read all option default rows.
 * @returns {Array<{label:string, weight:number}>}
 */
function readOptDefaults() {
    const out = [];
    optDefaultsWrap.querySelectorAll('.setup-opt-default-row').forEach(row => {
        const label  = setupSanitise(row.querySelector('input[type="text"]')?.value, 20);
        const weight = Math.max(0, Math.min(5, parseInt(row.querySelector('input[type="number"]')?.value, 10) || 0));
        if (label) out.push({label, weight});
    });
    return out;
}

if (addOptDefBtn) {
    addOptDefBtn.addEventListener('click', () => {
        optDefaultsWrap.appendChild(makeOptDefaultRow({label:'', weight:1}));
        optDefaultsWrap.lastElementChild.querySelector('input[type="text"]').focus();
        updateMoveButtons(optDefaultsWrap);
    });
}

/**
 * Make a preset group editor row.
 * Each preset has a key, a label (chip display text), and an array of items.
 * Items are edited as comma-separated "Label:weight" pairs for brevity.
 * @param {{key:string, label:string, items:Array}} preset
 * @returns {HTMLElement}
 */
function makePresetRow(preset) {
    const row = document.createElement('div');
    row.className = 'setup-row setup-preset-row';

    // Chip label (what the user sees on the button)
    const chipLabel = document.createElement('input');
    chipLabel.type = 'text';
    chipLabel.className = 'setup-input setup-preset-label';
    chipLabel.placeholder = 'Chip label, e.g. Yes / No';
    chipLabel.maxLength = 60;
    chipLabel.value = preset.label || '';
    chipLabel.setAttribute('aria-label', 'Preset chip label');

    // Items encoded as "Label:weight, Label:weight, ..."
    const itemsToStr = (items) => {
        if (!Array.isArray(items)) return '';
        return items.map(it => `${it.label}:${it.weight}`).join(', ');
    };
    const itemsIn = document.createElement('input');
    itemsIn.type = 'text';
    itemsIn.className = 'setup-input setup-preset-items';
    itemsIn.placeholder = 'e.g. Yes:2, Maybe:1, No:0';
    itemsIn.maxLength = 200;
    itemsIn.value = itemsToStr(preset.items);
    itemsIn.setAttribute('aria-label', 'Options as Label:weight pairs, comma-separated');
    itemsIn.title = 'Format: Label:weight, Label:weight ...';

    const actions = makeActionButtons(row);

    row.appendChild(chipLabel);
    row.appendChild(itemsIn);
    row.appendChild(actions);
    return row;
}

/**
 * Parse item string "Label:weight, Label:weight" into items array.
 * @param {string} str
 * @returns {Array<{label:string, weight:number}>}
 */
function parsePresetItems(str) {
    return String(str || '').split(',').map(part => {
        const [rawLabel, rawWeight] = part.trim().split(':');
        const label = setupSanitise(rawLabel, 20);
        const weight = Math.max(0, Math.min(5, parseInt(rawWeight, 10) || 0));
        return label ? {label, weight} : null;
    }).filter(Boolean);
}

/**
 * Read all preset rows.
 * @returns {Array}
 */
function readPresets() {
    const out = [];
    let idx = 0;
    presetsWrap.querySelectorAll('.setup-preset-row').forEach(row => {
        const label = setupSanitise(row.querySelector('.setup-preset-label')?.value, 60);
        const items = parsePresetItems(row.querySelector('.setup-preset-items')?.value);
        if (label && items.length > 0) {
            // Auto-generate a stable key from label if not stored separately
            const key = 'preset_' + (idx++);
            out.push({key, label, items});
        }
    });
    return out;
}

if (addPresetBtn) {
    addPresetBtn.addEventListener('click', () => {
        presetsWrap.appendChild(makePresetRow({key:'', label:'', items:[]}));
        presetsWrap.lastElementChild.querySelector('input').focus();
        updateMoveButtons(presetsWrap);
    });
}

// -------------------------
// DATE PRESETS EDITOR
// -------------------------

/**
 * Make a date preset row: label + days offset + delete.
 * @param {{key:string, label:string, days:number}} preset
 * @returns {HTMLElement}
 */
function makeDatePresetRow(preset) {
    const row = document.createElement('div');
    row.className = 'setup-row setup-date-row';

    const labelIn = document.createElement('input');
    labelIn.type = 'text';
    labelIn.className = 'setup-input';
    labelIn.placeholder = 'e.g. 1 week';
    labelIn.maxLength = 30;
    labelIn.value = preset.label || '';
    labelIn.setAttribute('aria-label', 'Preset label');

    const daysIn = document.createElement('input');
    daysIn.type = 'number';
    daysIn.className = 'setup-num-input';
    daysIn.min = 0;
    daysIn.max = 365;
    daysIn.value = preset.days !== undefined ? preset.days : 6;
    daysIn.setAttribute('aria-label', 'Days offset from today');
    daysIn.title = 'Days offset from today (0 = today only)';

    const actions = makeActionButtons(row);

    row.appendChild(labelIn);
    row.appendChild(daysIn);
    row.appendChild(actions);
    return row;
}

/**
 * Read all date preset rows.
 * @returns {Array<{key:string, label:string, days:number}>}
 */
function readDatePresets() {
    const out = [];
    let idx = 0;
    datePresetsWrap.querySelectorAll('.setup-date-row').forEach(row => {
        const label = setupSanitise(row.querySelector('input[type="text"]')?.value, 30);
        const days  = Math.max(0, Math.min(365, parseInt(row.querySelector('input[type="number"]')?.value, 10) || 0));
        if (label) out.push({key: 'dp_' + (idx++), label, days});
    });
    return out;
}

if (addDatePresetBtn) {
    addDatePresetBtn.addEventListener('click', () => {
        datePresetsWrap.appendChild(makeDatePresetRow({key:'', label:'', days:7}));
        datePresetsWrap.lastElementChild.querySelector('input[type="text"]').focus();
        updateMoveButtons(datePresetsWrap);
    });
}

// -------------------------
// RENDER FULL EDITOR
// -------------------------

/**
 * Populate all editor sections from a config object.
 * @param {object} cfg
 */
function renderSetupEditor(cfg) {
    if (!cfg) return;

    // Slots
    if (slotsMaxInput) slotsMaxInput.value = cfg.slots?.max ?? 6;
    slotExamplesWrap.innerHTML = '';
    (cfg.slots?.examples || []).forEach(ex => slotExamplesWrap.appendChild(makeChipRow(ex, 'e.g. Morning')));
    updateMoveButtons(slotExamplesWrap);
    slotDefaultsWrap.innerHTML = '';
    (cfg.slots?.defaults || []).forEach(d => slotDefaultsWrap.appendChild(makeChipRow(d, 'e.g. Morning')));
    updateMoveButtons(slotDefaultsWrap);

    // Options
    if (optionsMaxInput) optionsMaxInput.value = cfg.options?.max ?? 5;
    presetsWrap.innerHTML = '';
    (cfg.options?.presets || []).forEach(p => presetsWrap.appendChild(makePresetRow(p)));
    updateMoveButtons(presetsWrap);
    optDefaultsWrap.innerHTML = '';
    (cfg.options?.defaults || []).forEach(d => optDefaultsWrap.appendChild(makeOptDefaultRow(d)));
    updateMoveButtons(optDefaultsWrap);

    // Dates
    if (maxRangeDaysInput) maxRangeDaysInput.value = cfg.dates?.max_range_days ?? 360;
    datePresetsWrap.innerHTML = '';
    (cfg.dates?.presets || []).forEach(p => datePresetsWrap.appendChild(makeDatePresetRow(p)));
    updateMoveButtons(datePresetsWrap);

    // Template examples
    if (examplesWrap) {
        examplesWrap.innerHTML = '';
        (cfg.examples?.items || []).forEach(it => examplesWrap.appendChild(makeExampleRow(it)));
        updateMoveButtons(examplesWrap);
    }

    // Retention / auto-delete
    if (retentionDaysInput) {
        const days = parseInt(cfg.retention?.inactive_days, 10);
        retentionDaysInput.value = (days >= 1 && days <= 3650) ? days : 40;
    }
    if (hubRetentionDaysInput) {
        const hubDays = parseInt(cfg.retention?.hub_inactive_days, 10);
        hubRetentionDaysInput.value = (hubDays >= 1 && hubDays <= 3650) ? hubDays : 40;
    }
}

// -------------------------
// READ + SAVE CONFIG
// -------------------------

/**
 * Read the current editor state into a config object.
 * @returns {object}
 */
function readEditorConfig() {
    return {
        slots: {
            max: Math.max(1, parseInt(slotsMaxInput?.value, 10) || 6),
            examples: readChipList(slotExamplesWrap),
            defaults: readChipList(slotDefaultsWrap)
        },
        options: {
            max: Math.max(1, parseInt(optionsMaxInput?.value, 10) || 5),
            presets: readPresets(),
            defaults: readOptDefaults()
        },
        dates: {
            max_range_days: Math.max(1, Math.min(365, parseInt(maxRangeDaysInput?.value, 10) || 360)),
            presets: readDatePresets()
        },
        examples: {
            items: readExamples()
        },
        retention: {
            inactive_days: Math.max(1, Math.min(3650, parseInt(retentionDaysInput?.value, 10) || 40)),
            hub_inactive_days: Math.max(1, Math.min(3650, parseInt(hubRetentionDaysInput?.value, 10) || 40))
        }
    };
}

/**
 * Validate the config before saving.
 * Returns null if valid, or an error string.
 * @param {object} cfg
 * @returns {string|null}
 */
function validateEditorConfig(cfg) {
    if (cfg.slots.defaults.length === 0) {
        return 'At least one default slot is required.';
    }
    if (cfg.options.defaults.length === 0) {
        return 'At least one default option is required.';
    }
    return null;
}

/**
 * Save the current editor state to the server.
 */
async function saveConfig() {
    const cfg = readEditorConfig();
    const err = validateEditorConfig(cfg);
    if (err) {
        setSetupStatus(err, 'error');
        return;
    }

    setSetupStatus('Saving...', '', true);
    if (saveConfigBtn) saveConfigBtn.disabled = true;
    if (saveConfigBtn2) saveConfigBtn2.disabled = true;

    try {
        const data = await apiRequest('admin_save_config', 'POST', { config: cfg });
        if (data && data.status === 'success') {
            currentConfig = cfg;
            setSetupStatus('Saved successfully.', 'ok');
            setTimeout(() => setSetupStatus('', ''), 3000);
        } else {
            setSetupStatus('Save failed: ' + (data?.message || 'Unknown error'), 'error');
        }
    } catch (e) {
        setSetupStatus('Save failed: ' + e.message, 'error');
    } finally {
        if (saveConfigBtn) saveConfigBtn.disabled = false;
        if (saveConfigBtn2) saveConfigBtn2.disabled = false;
    }
}

if (saveConfigBtn)  saveConfigBtn.addEventListener('click', saveConfig);
if (saveConfigBtn2) saveConfigBtn2.addEventListener('click', saveConfig);

// Wire per-section Save buttons via delegation on the tab panel
const tabSetup = document.getElementById('tabSetup');
if (tabSetup) {
    tabSetup.addEventListener('click', (e) => {
        if (e.target.closest('.js-save-config')) saveConfig();
    });
}

if (reloadConfigBtn) {
    reloadConfigBtn.addEventListener('click', () => {
        setupConfigLoaded = false;
        loadSiteConfig();
    });
}
