/**
 * admin-accounts.js - Admin panel Accounts tab: sign-in provider status, totals, recent accounts, delete.
 * Classic script sharing global scope. Load order: emoji.js, admin-core.js, admin-calendars.js, admin-hubs.js, admin-accounts.js, admin-setup.js.
 */
'use strict';

let accountsLoaded = false;
let adminAccounts = [];

const accountStats = document.getElementById('accountStats');
const accountSearchInput = document.getElementById('accountSearchInput');
const accountRefreshBtn = document.getElementById('accountRefreshBtn');
const accountTable = document.getElementById('accountTable');
const accountTableBody = document.getElementById('accountTableBody');
const accountLoadingState = document.getElementById('accountLoadingState');
const accountEmptyState = document.getElementById('accountEmptyState');
const accountErrorState = document.getElementById('accountErrorState');

function showAccountState(state) {
    accountLoadingState.classList.toggle('hide', state !== 'loading');
    accountEmptyState.classList.toggle('hide', state !== 'empty');
    accountErrorState.classList.toggle('hide', state !== 'error');
    accountTable.classList.toggle('hide', state !== 'data');
}

function statTile(label, value) {
    return `<div class="account-stat"><span class="account-stat-value">${escapeHtml(String(value))}</span><span class="account-stat-label">${escapeHtml(label)}</span></div>`;
}

function renderAccountStats(data) {
    const m = data.methods || {};
    const on = (v) => v ? 'On' : 'Off (not configured)';
    let html = '<div class="account-providers">'
        + `<span><strong>Google:</strong> ${on(m.google)}</span>`
        + `<span><strong>Facebook:</strong> ${on(m.facebook)}</span>`
        + `<span><strong>Passkey:</strong> ${on(m.passkey)}</span>`
        + '</div>';
    if (!data.available) {
        html += '<p class="account-note">Account tables are missing. Run <code>migrations/007_accounts.sql</code> first.</p>';
    } else if (data.totals) {
        const t = data.totals;
        html += '<div class="account-stat-row">'
            + statTile('Accounts', t.accounts)
            + statTile('Active (30 days)', t.active_30d)
            + statTile('Google links', t.google)
            + statTile('Facebook links', t.facebook)
            + statTile('Passkeys', t.passkeys)
            + statTile('Unclaimed old names', t.unclaimed_names)
            + statTile('Unclaimed old Hubs', t.unclaimed_hubs)
            + '</div>';
    }
    accountStats.innerHTML = html;
}

async function loadAccounts() {
    showAccountState('loading');
    const q = (accountSearchInput.value || '').trim().toLowerCase();
    if (q && !/^[a-z0-9_]{1,20}$/.test(q)) {
        accountErrorState.textContent = 'Usernames only use a-z, 0-9 and _.';
        showAccountState('error');
        return;
    }
    try {
        const data = await apiRequest('admin_accounts', 'GET', null, q ? { q } : {});
        accountsLoaded = true;
        renderAccountStats(data);
        adminAccounts = data.accounts || [];
        renderAccountTable();
    } catch (err) {
        if (err.message.includes('Auth') || err.message.includes('session')) {
            handleLogout();
        } else {
            accountErrorState.textContent = err.message;
            showAccountState('error');
        }
    }
}

function renderAccountTable() {
    if (!adminAccounts.length) {
        showAccountState('empty');
        return;
    }
    accountTableBody.innerHTML = adminAccounts.map(a => `
        <tr>
            <td class="col-id">${a.id}</td>
            <td class="col-title">${a.username ? escapeHtml(a.username) : '<span class="no-title">(not set up)</span>'}</td>
            <td class="col-organiser">${escapeHtml(a.display_name) || '&mdash;'}</td>
            <td class="col-created">${formatDate(a.created_at)}</td>
            <td class="col-activity">${formatDate(a.last_seen_at)}</td>
            <td class="col-users">${a.calendar_count}</td>
            <td class="col-cal-count">${a.hub_count}</td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button type="button" class="btn btn-ghost btn-icon"
                            data-action="delete-account"
                            data-account-id="${a.id}"
                            title="Delete account">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    showAccountState('data');
}

async function deleteAdminAccount(accountId, btn) {
    const acct = adminAccounts.find(a => a.id === accountId);
    if (!acct) return;
    const word = acct.username || 'DELETE';
    const typed = prompt(
        `Delete account ${acct.username || '#' + acct.id}?\n\n`
        + `This also deletes ${acct.calendar_count} name(s) on calendars (and every calendar it organises) `
        + `and ${acct.hub_count} Hub(s). This cannot be undone.\n\nType ${word} to confirm:`
    );
    if (typed === null) return;
    if (typed.trim() !== word) {
        alert('Confirmation did not match. Nothing was deleted.');
        return;
    }
    btn.disabled = true;
    try {
        await apiRequest('admin_delete_account', 'POST', { account_id: accountId });
        calendarsNeedReload();
        await loadAccounts();
    } catch (err) {
        alert(err.message || 'Delete failed');
        btn.disabled = false;
    }
}

/** Deleting an account can remove calendars and Hubs, so the other tabs reload next time. */
function calendarsNeedReload() {
    hubsLoaded = false;
    loadCalendars();
}

accountTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="delete-account"]');
    if (btn) deleteAdminAccount(Number(btn.dataset.accountId), btn);
});
accountRefreshBtn.addEventListener('click', loadAccounts);
let accountSearchTimeout;
accountSearchInput.addEventListener('input', () => {
    clearTimeout(accountSearchTimeout);
    accountSearchTimeout = setTimeout(loadAccounts, 350);
});
