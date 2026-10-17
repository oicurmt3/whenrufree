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
            <td class="col-title">${a.is_test ? '<span class="test-user-badge">test</span> ' : ''}${a.username ? escapeHtml(a.username) : '<span class="no-title">(not set up)</span>'}</td>
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
        // The deleted account may have been a test user, so keep that list in step too
        if (testUsersLoaded) loadTestUsers();
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

// =========================================
// TEST USERS (admin-created accounts, for testing only)
// =========================================

let testUsersLoaded = false;
let adminTestUsers = [];
/** Username of the test user currently signed in on this browser, or null. */
let currentTestUsername = null;

const testUserTable = document.getElementById('testUserTable');
const testUserTableBody = document.getElementById('testUserTableBody');
const testUserEmpty = document.getElementById('testUserEmpty');
const testUserUnavailable = document.getElementById('testUserUnavailable');
const testUsernameInput = document.getElementById('testUsernameInput');
const testNameInput = document.getElementById('testNameInput');
const testCountInput = document.getElementById('testCountInput');
const addTestUserBtn = document.getElementById('addTestUserBtn');
const wipeTestUsersBtn = document.getElementById('wipeTestUsersBtn');
const testUserStatus = document.getElementById('testUserStatus');
const testUserRefreshBtn = document.getElementById('testUserRefreshBtn');

const impersonateBar = document.getElementById('impersonateBar');
const impersonateName = document.getElementById('impersonateName');
const impersonateBackBtn = document.getElementById('impersonateBackBtn');

function setTestUserStatus(msg, kind) {
    if (!testUserStatus) return;
    testUserStatus.textContent = msg || '';
    testUserStatus.classList.remove('setup-status-ok', 'setup-status-error');
    if (kind === 'ok') testUserStatus.classList.add('setup-status-ok');
    if (kind === 'error') testUserStatus.classList.add('setup-status-error');
}

/**
 * Show or hide the "a test user is open" bar. Test users have no sign-in method of their
 * own, so being signed in as one means the admin opened it from this panel.
 */
async function refreshImpersonateBar() {
    if (!impersonateBar) return;
    try {
        const res = await fetch('api.php?action=account_me', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        const data = await res.json();
        if (data && data.is_test_user) {
            currentTestUsername = data.username || null;
            impersonateName.textContent = data.display_name || data.username || 'test user';
            impersonateBar.classList.remove('hide');
        } else {
            currentTestUsername = null;
            impersonateBar.classList.add('hide');
        }
    } catch (err) {
        // The bar is an indicator only; leaving it hidden must never break the panel.
        currentTestUsername = null;
    }
    if (testUsersLoaded) renderTestUserTable();
}

async function loadTestUsers() {
    if (!testUserTable) return;
    setTestUserStatus('Loading...');
    try {
        const data = await apiRequest('admin_test_users', 'GET');
        testUsersLoaded = true;
        if (!data.available) {
            testUserUnavailable.classList.remove('hide');
            testUserTable.classList.add('hide');
            testUserEmpty.classList.add('hide');
            if (addTestUserBtn) addTestUserBtn.disabled = true;
            if (wipeTestUsersBtn) wipeTestUsersBtn.disabled = true;
            setTestUserStatus('');
            return;
        }
        testUserUnavailable.classList.add('hide');
        if (addTestUserBtn) addTestUserBtn.disabled = false;
        if (wipeTestUsersBtn) wipeTestUsersBtn.disabled = false;
        adminTestUsers = data.users || [];
        renderTestUserTable();
        setTestUserStatus('');
        await refreshImpersonateBar();
    } catch (err) {
        if (err.message.includes('Auth') || err.message.includes('session')) {
            handleLogout();
        } else {
            setTestUserStatus(err.message || 'Could not load test users', 'error');
        }
    }
}

function renderTestUserTable() {
    if (!testUserTable) return;
    if (!adminTestUsers.length) {
        testUserTable.classList.add('hide');
        testUserEmpty.classList.remove('hide');
        return;
    }
    testUserEmpty.classList.add('hide');
    testUserTable.classList.remove('hide');
    testUserTableBody.innerHTML = adminTestUsers.map(u => {
        const isOpen = currentTestUsername !== null && currentTestUsername === u.username;
        return `
        <tr${isOpen ? ' class="test-user-open"' : ''}>
            <td class="col-id">${u.id}</td>
            <td class="col-title"><span class="test-user-badge">test</span> ${u.username ? escapeHtml(u.username) : '&mdash;'}</td>
            <td class="col-organiser">${u.display_name ? escapeHtml(u.display_name) : '&mdash;'}</td>
            <td class="col-created">${formatDate(u.created_at)}</td>
            <td class="col-activity">${formatDate(u.last_seen_at)}</td>
            <td class="col-users">${u.calendar_count}</td>
            <td class="col-cal-count">${u.hub_count}</td>
            <td class="col-actions">
                <div class="action-buttons">
                    <button type="button" class="btn btn-ghost btn-icon"
                            data-action="open-test-user" data-account-id="${u.id}"
                            title="${isOpen ? 'This test user is open' : 'Open as this test user'}">
                        <span class="material-symbols-outlined">${isOpen ? 'check_circle' : 'login'}</span>
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon"
                            data-action="delete-test-user" data-account-id="${u.id}"
                            title="Delete test user">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function openTestUser(accountId, btn) {
    const u = adminTestUsers.find(x => x.id === accountId);
    if (!u) return;
    btn.disabled = true;
    try {
        await apiRequest('admin_impersonate', 'POST', { account_id: accountId });
        await refreshImpersonateBar();
        setTestUserStatus(`Signed in as ${u.display_name || u.username}. Open or join a calendar as them.`, 'ok');
    } catch (err) {
        setTestUserStatus(err.message || 'Could not open that test user', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function returnFromTestUser(btn) {
    if (btn) btn.disabled = true;
    try {
        const data = await apiRequest('admin_impersonate_end', 'POST', {});
        await refreshImpersonateBar();
        setTestUserStatus(data && data.restored ? 'Back to your own account.' : 'Test user signed out.', 'ok');
    } catch (err) {
        setTestUserStatus(err.message || 'Could not return to your account', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function addTestUser() {
    const username = (testUsernameInput.value || '').trim().toLowerCase();
    const displayName = (testNameInput.value || '').trim();
    const count = Math.max(1, Math.min(10, parseInt(testCountInput.value, 10) || 1));

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        setTestUserStatus('Username must be 3-20 characters: a-z, 0-9 or _.', 'error');
        return;
    }
    if (!displayName) {
        setTestUserStatus('Give the test user a name to show on calendars.', 'error');
        return;
    }

    addTestUserBtn.disabled = true;
    try {
        const data = await apiRequest('admin_create_test_user', 'POST', {
            username,
            display_name: displayName,
            count,
        });
        adminTestUsers = data.users || [];
        testUsersLoaded = true;
        renderTestUserTable();
        testUsernameInput.value = '';
        testNameInput.value = '';
        testCountInput.value = '1';
        const n = (data.created || []).length;
        setTestUserStatus(n === 1 ? 'Test user created.' : `${n} test users created.`, 'ok');
        await loadAccounts();
    } catch (err) {
        setTestUserStatus(err.message || 'Could not create the test user', 'error');
    } finally {
        addTestUserBtn.disabled = false;
    }
}

async function deleteTestUser(accountId, btn) {
    const u = adminTestUsers.find(x => x.id === accountId);
    if (!u) return;
    const word = u.username || 'DELETE';
    const typed = prompt(
        `Delete test user ${u.username || '#' + u.id}?\n\n`
        + 'This also deletes the calendars and Hubs it owns and any lists it joined. '
        + `This cannot be undone.\n\nType ${word} to confirm:`
    );
    if (typed === null) return;
    if (typed.trim() !== word) {
        setTestUserStatus('Confirmation did not match. Nothing was deleted.', 'error');
        return;
    }
    btn.disabled = true;
    try {
        await apiRequest('admin_delete_account', 'POST', { account_id: accountId });
        calendarsNeedReload();
        await loadTestUsers();
        await loadAccounts();
        setTestUserStatus('Test user deleted.', 'ok');
    } catch (err) {
        setTestUserStatus(err.message || 'Delete failed', 'error');
        btn.disabled = false;
    }
}

async function wipeTestUsers(btn) {
    if (!adminTestUsers.length) {
        setTestUserStatus('There are no test users to delete.', 'error');
        return;
    }
    const typed = prompt(
        `Delete all ${adminTestUsers.length} test user(s)?\n\n`
        + 'This also deletes the calendars and Hubs they own and any lists they joined. '
        + 'Real accounts are not touched. This cannot be undone.\n\nType DELETE to confirm:'
    );
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'DELETE') {
        setTestUserStatus('Confirmation did not match. Nothing was deleted.', 'error');
        return;
    }
    btn.disabled = true;
    try {
        const data = await apiRequest('admin_delete_test_users', 'POST', {});
        adminTestUsers = [];
        renderTestUserTable();
        calendarsNeedReload();
        await refreshImpersonateBar();
        await loadAccounts();
        setTestUserStatus(`Deleted ${data.deleted} test user(s).`, 'ok');
    } catch (err) {
        setTestUserStatus(err.message || 'Could not delete the test users', 'error');
    } finally {
        btn.disabled = false;
    }
}

if (testUserTableBody) {
    testUserTableBody.addEventListener('click', (e) => {
        const openBtn = e.target.closest('[data-action="open-test-user"]');
        if (openBtn) {
            openTestUser(Number(openBtn.dataset.accountId), openBtn);
            return;
        }
        const delBtn = e.target.closest('[data-action="delete-test-user"]');
        if (delBtn) deleteTestUser(Number(delBtn.dataset.accountId), delBtn);
    });
}
if (addTestUserBtn) addTestUserBtn.addEventListener('click', addTestUser);
if (wipeTestUsersBtn) wipeTestUsersBtn.addEventListener('click', (e) => wipeTestUsers(e.currentTarget));
if (testUserRefreshBtn) testUserRefreshBtn.addEventListener('click', loadTestUsers);
if (impersonateBackBtn) impersonateBackBtn.addEventListener('click', (e) => returnFromTestUser(e.currentTarget));

// admin-core's switchTab loads Accounts the first time its tab opens; do the same for test users.
const accountsTabBtn = document.querySelector('.admin-tab[data-tab="accounts"]');
if (accountsTabBtn) {
    accountsTabBtn.addEventListener('click', () => {
        if (!testUsersLoaded) loadTestUsers();
        refreshImpersonateBar();
    });
}

// Show the bar as soon as the panel is up, so an open test user is never invisible.
document.addEventListener('DOMContentLoaded', refreshImpersonateBar);
