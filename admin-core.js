/**
 * admin-core.js - Admin panel shared core: state, login/logout, API helper, utilities, access emoji helpers, tabs.
 * Classic script sharing global scope. Load order: emoji.js, admin-core.js, admin-calendars.js, admin-hubs.js, admin-accounts.js, admin-setup.js.
 */
'use strict';

// =========================================
// STATE
// =========================================
let adminToken = null;          // Session token after login
let csrfToken = null;           // CSRF token for mutations

const pageSize = 25;

// =========================================
// DOM REFERENCES
// =========================================
const loginScreen = document.getElementById('loginScreen');
const loginForm = document.getElementById('loginForm');
const adminPassword = document.getElementById('adminPassword');
const loginError = document.getElementById('loginError');

const adminPanel = document.getElementById('adminPanel');
const logoutBtn = document.getElementById('logoutBtn');

// =========================================
// UTILITY FUNCTIONS
// =========================================

/**
 * Make API request with admin authentication
 */
async function apiRequest(action, method = 'GET', body = null, params = {}) {
    const url = new URL('api.php', window.location.href);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const options = {
        method: method,
        headers: {}
    };

    // Add admin token if we have one
    if (adminToken) {
        options.headers['X-Admin-Token'] = adminToken;
    }

    // Add CSRF token for mutations
    if (method === 'POST' && csrfToken) {
        options.headers['X-CSRF-Token'] = csrfToken;
    }

    // Add body for POST requests
    if (body && method === 'POST') {
        if (body instanceof FormData) {
            options.body = body;
        } else {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
    }

    const response = await fetch(url.toString(), options);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Request failed');
    }

    return data;
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
    if (!dateStr) return '<span class="date-display never">Never</span>';
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `<span class="date-display">${day}/${mon}/${year}</span>`;
}

/**
 * Truncate token for display
 */
function truncateToken(token) {
    if (!token || token.length <= 12) return token;
    return token.substring(0, 8) + '...' + token.substring(token.length - 4);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m];
    });
}

// =========================================
// AUTHENTICATION
// =========================================

/**
 * Handle login form submission
 */
async function handleLogin(e) {
    e.preventDefault();
    loginError.classList.add('hide');

    const password = adminPassword.value.trim();
    if (!password) {
        showLoginError('Password required');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('password', password);

        const data = await apiRequest('admin_login', 'POST', formData);

        if (data.status === 'success' && data.admin_token) {
            startAdminSession(data);

            // Ask browser to save the password via Credential Management API.
            // This is the only way to trigger save prompts in fetch-based logins.
            if (window.PasswordCredential) {
                try {
                    const cred = new PasswordCredential({
                        id: 'admin',
                        password: password,
                        name: 'When RU Free Admin'
                    });
                    await navigator.credentials.store(cred);
                } catch (credErr) {
                    // Non-fatal - browser may not support or user may dismiss
                    console.warn('Credential store failed:', credErr);
                }
            }

            showAdminPanel();
            loadCalendars();
        } else {
            showLoginError('Authentication failed');
        }
    } catch (err) {
        showLoginError(err.message || 'Login failed');
    }
}

/** Keep the admin session for this tab (sessionStorage is cleared when the browser closes). */
function startAdminSession(data) {
    adminToken = data.admin_token;
    csrfToken = data.csrf_token;
    sessionStorage.setItem('adminToken', adminToken);
    sessionStorage.setItem('csrfToken', csrfToken);
    sessionStorage.removeItem('adminNoAutoAccount');
}

/**
 * Open the panel with the signed-in When RU Free account (config.php admin.account_ids).
 * Silent mode is the automatic try on page load: failures just leave the password form.
 */
async function handleAccountLogin(silent = false) {
    if (!silent) loginError.classList.add('hide');
    try {
        const tokenData = await apiRequest('csrf_token');
        csrfToken = tokenData.csrf_token;
        const data = await apiRequest('admin_login_account', 'POST');
        if (data.status === 'success' && data.admin_token) {
            startAdminSession(data);
            showAdminPanel();
            loadCalendars();
            return;
        }
        if (!silent) showLoginError('Authentication failed');
    } catch (err) {
        csrfToken = null;
        if (!silent) showLoginError(err.message || 'Login failed');
    }
}

/**
 * Show login error message
 */
function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hide');
    adminPassword.focus();
}

/**
 * Handle logout
 */
function handleLogout() {
    adminToken = null;
    csrfToken = null;
    calendars = [];
    filteredCalendars = [];
    selectedIds.clear();
    groups = [];
    filteredGroups = [];
    selectedHubIds.clear();
    expandedHubIds.clear();
    expandedHubCalendars = {};
    hubsLoaded = false;
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('csrfToken');
    sessionStorage.setItem('adminNoAutoAccount', '1');

    adminPanel.classList.add('hide');
    loginScreen.classList.remove('hide');
    adminPassword.value = '';
    adminPassword.focus();
}

/**
 * Check for existing session on page load
 */
function checkExistingSession() {
    const storedToken = sessionStorage.getItem('adminToken');
    const storedCsrf = sessionStorage.getItem('csrfToken');

    if (storedToken) {
        adminToken = storedToken;
        csrfToken = storedCsrf;
        showAdminPanel();
        loadCalendars();
    } else if (!sessionStorage.getItem('adminNoAutoAccount')) {
        handleAccountLogin(true);
    }
}

/**
 * Show admin panel, hide login
 */
function showAdminPanel() {
    loginScreen.classList.add('hide');
    adminPanel.classList.remove('hide');
}

/**
 * Title badge: the access emoji, or "Hub emoji" when a calendar uses its Hub's.
 * @param {number|null} emoji
 * @param {boolean} inherited
 */
function emojiBadge(emoji, inherited) {
    const AE = window.AccessEmoji;
    if (AE && AE.valid(emoji)) {
        return `<span class="emoji-badge" title="Access emoji: ${escapeHtml(AE.name(emoji))}">${AE.glyph(emoji)}</span>`;
    }
    if (inherited) {
        return '<span class="emoji-badge emoji-badge-hub" title="Uses the Hub\'s access emoji">Hub emoji</span>';
    }
    return '';
}

/**
 * Remove the access emoji from a calendar ('calendar') or Hub ('group').
 * Everyone who had opened it with the emoji can then open it without one.
 */
async function clearAccessEmoji(kind, item, btn, rerender) {
    const what = kind === 'calendar' ? 'calendar' : 'Hub';
    if (!confirm('Remove the access emoji from "' + (item.title || 'this ' + what) + '"? Anyone with the link will be able to open it.')) return;
    btn.disabled = true;
    try {
        const formData = new FormData();
        formData.append('kind', kind);
        formData.append('id', item.id);
        const data = await apiRequest('admin_set_access_emoji', 'POST', formData);
        if (data.status !== 'success') throw new Error(data.message || 'Failed to remove the emoji');
        item.access_emoji = null;
        rerender();
    } catch (err) {
        btn.disabled = false;
        alert('Error: ' + err.message);
    }
}

// =========================================
// EVENT LISTENERS
// =========================================

// Login form
loginForm.addEventListener('submit', handleLogin);
document.getElementById('accountLoginBtn').addEventListener('click', () => handleAccountLogin(false));

// Password visibility toggle on login form
const toggleAdminPassword = document.getElementById('toggleAdminPassword');
if (toggleAdminPassword) {
    toggleAdminPassword.addEventListener('click', () => {
        const isPassword = adminPassword.type === 'password';
        adminPassword.type = isPassword ? 'text' : 'password';
        const icon = toggleAdminPassword.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = isPassword ? 'visibility_off' : 'visibility';
        toggleAdminPassword.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
}

// Logout button
logoutBtn.addEventListener('click', handleLogout);

// Escape key closes modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!deleteModal.classList.contains('hide')) {
            closeDeleteModal();
        }
        if (!bulkDeleteModal.classList.contains('hide')) {
            closeBulkDeleteModal();
        }
        if (!deleteUserModal.classList.contains('hide')) {
            closeDeleteUserModal();
        }
        if (!deleteHubModal.classList.contains('hide')) {
            closeDeleteHubModal();
        }
        if (!bulkDeleteHubModal.classList.contains('hide')) {
            closeBulkDeleteHubModal();
        }
    }
});

// =========================================
// INIT
// =========================================

document.addEventListener('DOMContentLoaded', checkExistingSession);

// =========================================
// TAB NAVIGATION
// =========================================

// Declared here so switchTab can reference them without hoisting issues
let setupConfigLoaded = false;
let currentConfig = null;  // Live copy being edited

/**
 * Switch between Calendars and Setup Page tabs.
 */
function switchTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(btn => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.add('hide');
    });
    const panelMap = {
        calendars: 'tabCalendars',
        hubs: 'tabHubs',
        accounts: 'tabAccounts',
        setup: 'tabSetup'
    };
    const target = document.getElementById(panelMap[tabName] || 'tabCalendars');
    if (target) target.classList.remove('hide');

    if (tabName === 'setup' && setupConfigLoaded === false) {
        loadSiteConfig();
    }
    if (tabName === 'hubs' && hubsLoaded === false) {
        loadHubs();
    }
    if (tabName === 'accounts' && accountsLoaded === false) {
        loadAccounts();
    }
}

document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
