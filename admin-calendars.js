/**
 * admin-calendars.js - Calendars tab: list, search, sort, selection, delete, bulk delete, pagination and the Users expander.
 * Classic script sharing global scope. Load order: emoji.js, admin-core.js, admin-calendars.js, admin-hubs.js, admin-accounts.js, admin-setup.js.
 */
'use strict';

let calendars = [];             // Full calendar list from server
let filteredCalendars = [];     // After search/filter applied
let selectedIds = new Set();    // Selected calendar IDs for bulk operations
let currentPage = 1;

let sortColumn = 'id';
let sortDirection = 'desc';
let deleteTargetId = null;      // Calendar ID pending single deletion
let expandedCalendarIds = new Set(); // Calendar IDs with user rows expanded
let expandedUsers = {};         // { calendarId: [user, ...] } cached user data
let deleteUserTarget = null;    // { calendarId, userId, name, role } pending user deletion

const searchInput = document.getElementById('searchInput');
const filterPermanent = document.getElementById('filterPermanent');
const refreshBtn = document.getElementById('refreshBtn');

// Bulk actions
const bulkActionsBar = document.getElementById('bulkActionsBar');
const selectedCount = document.getElementById('selectedCount');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const selectAllCheckbox = document.getElementById('selectAll');

const calendarTable = document.getElementById('calendarTable');
const calendarTableBody = document.getElementById('calendarTableBody');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const errorState = document.getElementById('errorState');

const pagination = document.getElementById('pagination');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');

// Single delete modal
const deleteModal = document.getElementById('deleteModal');
const deleteCalendarInfo = document.getElementById('deleteCalendarInfo');
const cancelDelete = document.getElementById('cancelDelete');
const confirmDelete = document.getElementById('confirmDelete');

// Bulk delete modal
const bulkDeleteModal = document.getElementById('bulkDeleteModal');
const bulkDeleteCount = document.getElementById('bulkDeleteCount');
const bulkDeleteList = document.getElementById('bulkDeleteList');
const bulkConfirmInput = document.getElementById('bulkConfirmInput');
const cancelBulkDelete = document.getElementById('cancelBulkDelete');
const confirmBulkDelete = document.getElementById('confirmBulkDelete');

// Delete user modal
const deleteUserModal = document.getElementById('deleteUserModal');
const deleteUserInfo = document.getElementById('deleteUserInfo');
const cancelDeleteUser = document.getElementById('cancelDeleteUser');
const confirmDeleteUser = document.getElementById('confirmDeleteUser');

/**
 * Show/hide UI states
 */
function showState(state) {
    loadingState.classList.add('hide');
    emptyState.classList.add('hide');
    errorState.classList.add('hide');
    calendarTable.classList.add('hide');
    pagination.classList.add('hide');

    switch (state) {
        case 'loading':
            loadingState.classList.remove('hide');
            break;
        case 'empty':
            emptyState.classList.remove('hide');
            break;
        case 'error':
            errorState.classList.remove('hide');
            break;
        case 'data':
            calendarTable.classList.remove('hide');
            if (filteredCalendars.length > pageSize) {
                pagination.classList.remove('hide');
            }
            break;
    }
}

// =========================================
// CALENDAR DATA
// =========================================

/**
 * Load calendars from API
 */
async function loadCalendars() {
    showState('loading');
    selectedIds.clear();
    updateBulkActionsUI();

    try {
        const data = await apiRequest('admin_calendars', 'GET');

        if (data.status === 'success') {
            calendars = data.calendars || [];
            // Update CSRF token if provided
            if (data.csrf_token) {
                csrfToken = data.csrf_token;
                sessionStorage.setItem('csrfToken', csrfToken);
            }
            applyFilters();
        } else {
            throw new Error(data.message || 'Failed to load calendars');
        }
    } catch (err) {
        if (err.message.includes('Auth') || err.message.includes('session')) {
            handleLogout();
        } else {
            errorState.textContent = err.message;
            showState('error');
        }
    }
}

/**
 * Apply search and filter to calendars
 */
function applyFilters() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    const permanentOnly = filterPermanent.checked;

    filteredCalendars = calendars.filter(cal => {
        // Filter by permanent
        if (permanentOnly && !cal.never_expires) {
            return false;
        }

        // Filter by search term
        if (searchTerm) {
            const title = (cal.title || '').toLowerCase();
            const token = (cal.token || '').toLowerCase();
            if (!title.includes(searchTerm) && !token.includes(searchTerm)) {
                return false;
            }
        }

        return true;
    });

    // Apply sorting
    sortCalendars();

    // Reset to page 1 when filters change
    currentPage = 1;
    renderTable();
}

/**
 * Sort calendars by current column/direction
 */
function sortCalendars() {
    filteredCalendars.sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        // Handle null/undefined
        if (aVal == null) aVal = '';
        if (bVal == null) bVal = '';

        // Numeric columns
        if (sortColumn === 'id' || sortColumn === 'user_count') {
            aVal = parseInt(aVal) || 0;
            bVal = parseInt(bVal) || 0;
        }

        // Date columns
        if (sortColumn === 'created_at' || sortColumn === 'last_activity') {
            aVal = aVal ? new Date(aVal).getTime() : 0;
            bVal = bVal ? new Date(bVal).getTime() : 0;
        }

        // String comparison
        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        let result = 0;
        if (aVal < bVal) result = -1;
        else if (aVal > bVal) result = 1;

        return sortDirection === 'asc' ? result : -result;
    });
}

/**
 * Handle column header click for sorting
 */
function handleSort(e) {
    const th = e.target.closest('th.sortable');
    if (!th) return;

    const column = th.dataset.sort;
    if (!column) return;

    // Toggle direction if same column, otherwise default to desc
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'desc';
    }

    // Update header classes
    calendarTable.querySelectorAll('th').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc');
    });
    th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

    sortCalendars();
    renderTable();
}

// =========================================
// SELECTION MANAGEMENT
// =========================================

/**
 * Toggle selection for a single calendar
 */
function toggleSelection(calendarId, checked) {
    const id = parseInt(calendarId); // Ensure integer type
    if (checked) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
    updateBulkActionsUI();
    updateRowHighlights();
    updateSelectAllState();
}

/**
 * Select/deselect all calendars on current page
 */
function toggleSelectAll(checked) {
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredCalendars.length);
    const pageCalendars = filteredCalendars.slice(startIdx, endIdx);

    pageCalendars.forEach(cal => {
        const id = parseInt(cal.id); // Ensure integer type
        if (checked) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
    });

    updateBulkActionsUI();
    updateRowHighlights();
    updateRowCheckboxes();
}

/**
 * Clear all selections
 */
function clearSelection() {
    selectedIds.clear();
    updateBulkActionsUI();
    updateRowHighlights();
    updateRowCheckboxes();
    selectAllCheckbox.checked = false;
}

/**
 * Update bulk actions bar visibility and count
 */
function updateBulkActionsUI() {
    if (selectedIds.size > 0) {
        bulkActionsBar.classList.remove('hide');
        selectedCount.textContent = `${selectedIds.size} selected`;
    } else {
        bulkActionsBar.classList.add('hide');
    }
}

/**
 * Update row highlight classes based on selection
 */
function updateRowHighlights() {
    const rows = calendarTableBody.querySelectorAll('tr[data-id]');
    rows.forEach(row => {
        const id = parseInt(row.dataset.id);
        if (selectedIds.has(id)) {
            row.classList.add('selected');
        } else {
            row.classList.remove('selected');
        }
    });
}

/**
 * Update row checkboxes based on selection state
 */
function updateRowCheckboxes() {
    const checkboxes = calendarTableBody.querySelectorAll('input[type="checkbox"][data-id]');
    checkboxes.forEach(cb => {
        const id = parseInt(cb.dataset.id);
        cb.checked = selectedIds.has(id);
    });
}

/**
 * Update select-all checkbox state
 */
function updateSelectAllState() {
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredCalendars.length);
    const pageCalendars = filteredCalendars.slice(startIdx, endIdx);

    if (pageCalendars.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    const selectedOnPage = pageCalendars.filter(cal => selectedIds.has(parseInt(cal.id))).length;

    if (selectedOnPage === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedOnPage === pageCalendars.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// =========================================
// TABLE RENDERING
// =========================================

/**
 * Render calendar table
 */
function renderTable() {
    if (filteredCalendars.length === 0) {
        showState('empty');
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(filteredCalendars.length / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredCalendars.length);
    const pageCalendars = filteredCalendars.slice(startIdx, endIdx);

    // Build table rows
    calendarTableBody.innerHTML = pageCalendars.map(cal => {
        const calId = parseInt(cal.id);
        const isSelected = selectedIds.has(calId);
        const escapedTitle = escapeHtml(cal.title);
        const hubCell = cal.group_id && cal.group_token
            ? `<a href="hub.html?g=${encodeURIComponent(cal.group_token)}" target="_blank" class="hub-link" title="${escapeHtml(cal.group_title || '')}">${escapeHtml(cal.group_title || cal.group_token)}</a>`
            : '<span class="text-muted">&mdash;</span>';
        return `
        <tr data-id="${cal.id}" class="${isSelected ? 'selected' : ''}">
            <td class="col-checkbox">
                <input type="checkbox" 
                       data-action="toggle-select"
                       data-id="${cal.id}" 
                       ${isSelected ? 'checked' : ''}>
            </td>
            <td class="col-id">${cal.id}</td>
            <td class="col-title">
                <span class="title-cell ${cal.title ? '' : 'no-title'}">
                    ${escapedTitle || '(untitled)'}
                </span>
                ${emojiBadge(cal.access_emoji, cal.access_emoji === null && cal.group_access_emoji !== null)}
                ${cal.slot_capacity ? `<span class="booking-badge" title="Booking: up to ${Number(cal.slot_capacity)} per slot">Booking</span>` : ''}
            </td>
            <td class="col-hub">${hubCell}</td>
            <td class="col-token">
                <span class="token-display" title="${cal.token}">${truncateToken(cal.token)}</span>
            </td>
            <td class="col-created">${formatDate(cal.created_at)}</td>
            <td class="col-activity">${formatDate(cal.last_activity)}</td>
            <td class="col-users">
                <button type="button" class="user-count-btn ${expandedCalendarIds.has(calId) ? 'expanded' : ''}"
                        data-action="toggle-users"
                        data-cal-id="${cal.id}"
                        title="Show/hide users">
                    ${cal.user_count || 0}
                    <span class="material-symbols-outlined expand-icon">expand_more</span>
                </button>
            </td>
            <td class="col-permanent">
                <label class="toggle-switch">
                    <input type="checkbox" 
                           data-action="toggle-permanent"
                           data-perm-id="${cal.id}" 
                           ${cal.never_expires ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            </td>
            <td class="col-actions">
                <div class="action-buttons">
                    ${cal.access_emoji !== null && cal.access_emoji !== undefined ? `<button type="button" class="btn btn-ghost btn-icon btn-unlock"
                            data-action="clear-emoji"
                            data-cal-id="${cal.id}"
                            title="Remove the access emoji">
                        <span class="material-symbols-outlined">key_off</span>
                    </button>` : ''}
                    <button type="button" class="btn btn-ghost btn-icon" 
                            data-action="view"
                            data-cal-id="${cal.id}"
                            title="View calendar">
                        <span class="material-symbols-outlined">open_in_new</span>
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon" 
                            data-action="delete"
                            data-cal-id="${cal.id}"
                            title="Delete calendar">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </td>
        </tr>
        ${expandedCalendarIds.has(calId) ? `<tr class="user-expand-row" data-expand-id="${cal.id}"><td colspan="10"><div class="user-expand-inner" id="userExpand_${cal.id}"><span class="material-symbols-outlined spin" style="font-size:18px;color:#999;">progress_activity</span></div></td></tr>` : ''}
    `}).join('');

    // Update pagination
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${filteredCalendars.length} calendars)`;
    prevPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= totalPages;

    // Update select all state
    updateSelectAllState();

    // Re-render pills for all expanded rows with cached data
    renderAllExpandedPills();

    showState('data');
}

// =========================================
// CALENDAR ACTIONS
// =========================================

/**
 * Toggle selection for a calendar row
 */
function handleToggleSelect(calendarId, checked) {
    toggleSelection(calendarId, checked);
}

/**
 * Toggle never_expires flag for a calendar
 */
async function handleTogglePermanent(calendarId, value) {
    const toggle = document.querySelector(`input[data-perm-id="${calendarId}"]`);
    if (toggle) toggle.disabled = true;

    try {
        const formData = new FormData();
        formData.append('calendar_id', calendarId);
        formData.append('never_expires', value ? '1' : '0');

        const data = await apiRequest('admin_set_permanent', 'POST', formData);

        if (data.status === 'success') {
            const cal = calendars.find(c => c.id === calendarId);
            if (cal) cal.never_expires = value ? 1 : 0;
        } else {
            throw new Error(data.message || 'Failed to update');
        }
    } catch (err) {
        if (toggle) toggle.checked = !value;
        alert('Error: ' + err.message);
    } finally {
        if (toggle) toggle.disabled = false;
    }
}

/**
 * Open calendar in new tab
 */
function viewCalendar(token) {
    window.open('calendar.html?c=' + encodeURIComponent(token), '_blank');
}

/**
 * Initiate single calendar deletion (show modal)
 */
function initiateDeleteCalendar(calendarId) {
    const cal = calendars.find(c => parseInt(c.id, 10) === parseInt(calendarId, 10));
    if (!cal) return;
    deleteTargetId = parseInt(calendarId, 10);
    deleteCalendarInfo.innerHTML = `
        <strong>ID:</strong> ${cal.id}<br>
        <strong>Title:</strong> ${escapeHtml(cal.title) || '(untitled)'}<br>
        <strong>Token:</strong> ${escapeHtml(cal.token)}
    `;
    deleteModal.classList.remove('hide');
}

/**
 * Event delegation for calendar table actions
 */
function handleTableClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !calendarTableBody.contains(btn)) return;

    const action = btn.dataset.action;
    if (action === 'toggle-select' || action === 'toggle-permanent') return;

    const calId = parseInt(btn.dataset.calId || btn.dataset.id, 10);
    if (!calId) return;

    if (action === 'view') {
        const cal = calendars.find(c => parseInt(c.id, 10) === calId);
        if (cal) viewCalendar(cal.token);
    } else if (action === 'delete') {
        initiateDeleteCalendar(calId);
    } else if (action === 'clear-emoji') {
        const cal = calendars.find(c => parseInt(c.id, 10) === calId);
        if (cal) clearAccessEmoji('calendar', cal, btn, renderTable);
    } else if (action === 'toggle-users') {
        toggleUsersExpand(calId);
    }
}

function handleTableChange(e) {
    const target = e.target;
    if (!calendarTableBody.contains(target)) return;

    if (target.matches('input[type="checkbox"][data-action="toggle-select"]')) {
        handleToggleSelect(parseInt(target.dataset.id, 10), target.checked);
    } else if (target.matches('input[type="checkbox"][data-action="toggle-permanent"]')) {
        handleTogglePermanent(parseInt(target.dataset.permId, 10), target.checked);
    }
}

/**
 * Confirm and execute single calendar deletion
 */
async function executeDelete() {
    if (!deleteTargetId) return;

    confirmDelete.disabled = true;
    confirmDelete.innerHTML = '<span class="material-symbols-outlined spin">progress_activity</span> Deleting...';

    try {
        const formData = new FormData();
        formData.append('calendar_id', deleteTargetId);

        const data = await apiRequest('admin_delete_calendar', 'POST', formData);

        if (data.status === 'success') {
            // Remove from local state
            calendars = calendars.filter(c => c.id !== deleteTargetId);
            selectedIds.delete(deleteTargetId);
            applyFilters();
            closeDeleteModal();
        } else {
            throw new Error(data.message || 'Failed to delete');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        confirmDelete.disabled = false;
        confirmDelete.innerHTML = 'Delete';
    }
}

/**
 * Close single delete modal
 */
function closeDeleteModal() {
    deleteModal.classList.add('hide');
    deleteTargetId = null;
}

// =========================================
// USER EXPANSION & DELETION (super admin)
// =========================================

/**
 * Toggle user expansion for a calendar row.
 * Fetches users on first expand, caches locally.
 */
async function toggleUsersExpand(calendarId) {
    const id = parseInt(calendarId, 10);
    if (expandedCalendarIds.has(id)) {
        expandedCalendarIds.delete(id);
        renderTable();
        return;
    }
    expandedCalendarIds.add(id);
    renderTable();

    if (!expandedUsers[id]) {
        try {
            const url = new URL('api.php', window.location.href);
            url.searchParams.set('action', 'admin_list_users');
            url.searchParams.set('calendar_id', id);
            const opts = { method: 'GET', headers: {}, credentials: 'same-origin' };
            if (adminToken) opts.headers['X-Admin-Token'] = adminToken;
            const resp = await fetch(url.toString(), opts);
            const data = await resp.json();
            if (data.status === 'success' && Array.isArray(data.users)) {
                expandedUsers[id] = data.users;
            } else {
                expandedUsers[id] = [];
                var c = document.getElementById('userExpand_' + id);
                if (c) c.innerHTML = '<span style="color:#c00;font-size:.85rem;">' +
                    escapeHtml(data.message || 'Failed to load users') + '</span>';
                return;
            }
        } catch (e) {
            expandedUsers[id] = [];
            var c = document.getElementById('userExpand_' + id);
            if (c) c.innerHTML = '<span style="color:#c00;font-size:.85rem;">Network error</span>';
            return;
        }
    }
    renderUserPills(id);
}

/**
 * Render user pills for a single calendar's expansion row.
 * Creates buttons with addEventListener for click handling.
 */
function renderUserPills(calendarId) {
    var container = document.getElementById('userExpand_' + calendarId);
    if (!container) return;
    var users = expandedUsers[calendarId] || [];
    if (users.length === 0) {
        container.innerHTML = '<span style="color:#999;font-size:.85rem;">No users</span>';
        return;
    }
    container.innerHTML = '';
    for (var i = 0; i < users.length; i++) {
        (function(u) {
            var isAdmin = u.role === 'admin';
            var label = isAdmin ? u.display_name + ' (organiser)' : u.display_name;
            if (!u.has_account) label += ' - not claimed';
            var btn = document.createElement('button');
            btn.className = 'user-pill' + (isAdmin ? ' is-admin' : '') + (u.has_account ? '' : ' is-unclaimed');
            btn.title = 'Click to delete ' + label;
            btn.appendChild(document.createTextNode(label + ' '));
            var icon = document.createElement('span');
            icon.className = 'material-symbols-outlined pill-icon';
            icon.textContent = 'close';
            btn.appendChild(icon);
            btn.addEventListener('click', function() {
                showDeleteUserModal(calendarId, u.id, u.display_name, u.role);
            });
            container.appendChild(btn);
            if (u.locked_seconds > 0) {
                var unlock = document.createElement('button');
                unlock.type = 'button';
                unlock.className = 'user-pill is-locked';
                unlock.title = 'PIN locked for ' + formatWait(u.locked_seconds) + ' - click to unlock ' + u.display_name;
                var lockIcon = document.createElement('span');
                lockIcon.className = 'material-symbols-outlined pill-icon';
                lockIcon.textContent = 'lock_open';
                unlock.appendChild(lockIcon);
                unlock.appendChild(document.createTextNode(' Unlock ' + u.display_name));
                unlock.addEventListener('click', function() {
                    unlockUser(calendarId, u, unlock);
                });
                container.appendChild(unlock);
            }
        })(users[i]);
    }
}

/** Human-readable wait, matching the API wording (e.g. "5 minutes", "2 days"). */
function formatWait(seconds) {
    var s = Math.max(1, parseInt(seconds, 10) || 0);
    var n, unit;
    if (s <= 3600) { n = Math.ceil(s / 60); unit = 'minute'; }
    else if (s < 86400) { n = Math.ceil(s / 3600); unit = 'hour'; }
    else { n = Math.ceil(s / 86400); unit = 'day'; }
    return n + ' ' + unit + (n === 1 ? '' : 's');
}

/** Clear a calendar user's PIN lockout (also resets the escalation level). */
async function unlockUser(calendarId, user, btn) {
    if (!confirm('Unlock ' + user.display_name + '? Their next wrong PIN streak starts again at a 5-minute lock.')) return;
    btn.disabled = true;
    try {
        var formData = new FormData();
        formData.append('calendar_id', calendarId);
        formData.append('user_id', user.id);
        var data = await apiRequest('admin_unlock_user', 'POST', formData);
        if (data.status !== 'success') throw new Error(data.message || 'Failed to unlock');
        user.locked_seconds = 0;
        renderUserPills(calendarId);
    } catch (err) {
        btn.disabled = false;
        alert('Error: ' + err.message);
    }
}

/**
 * Re-render pills for ALL currently expanded rows with cached data.
 * Called after every renderTable() to restore listeners lost in innerHTML rebuild.
 */
function renderAllExpandedPills() {
    expandedCalendarIds.forEach(function(id) {
        if (expandedUsers[id]) {
            renderUserPills(id);
        }
    });
}

/**
 * Show delete user confirmation modal
 */
function showDeleteUserModal(calendarId, userId, name, role) {
    deleteUserTarget = {
        calendarId: parseInt(calendarId),
        userId: parseInt(userId),
        name: name,
        role: role
    };
    var roleLabel = role === 'admin' ? ' (organiser)' : '';
    deleteUserInfo.innerHTML =
        '<strong>Name:</strong> ' + escapeHtml(name) + escapeHtml(roleLabel) + '<br>' +
        '<strong>User ID:</strong> ' + parseInt(userId) + '<br>' +
        '<strong>Calendar ID:</strong> ' + parseInt(calendarId);
    deleteUserModal.classList.remove('hide');
}

/**
 * Execute user deletion from the admin panel
 */
async function executeDeleteUser() {
    if (!deleteUserTarget) return;
    var cId = deleteUserTarget.calendarId;
    var uId = deleteUserTarget.userId;

    confirmDeleteUser.disabled = true;
    confirmDeleteUser.innerHTML = '<span class="material-symbols-outlined spin">progress_activity</span> Deleting...';

    try {
        var formData = new FormData();
        formData.append('calendar_id', cId);
        formData.append('user_id', uId);

        var data = await apiRequest('admin_delete_user', 'POST', formData);

        if (data.status === 'success') {
            if (expandedUsers[cId]) {
                expandedUsers[cId] = expandedUsers[cId].filter(function(u) {
                    return parseInt(u.id) !== uId;
                });
            }
            var cal = calendars.find(function(c) { return parseInt(c.id) === cId; });
            if (cal) {
                cal.user_count = Math.max(0, (parseInt(cal.user_count) || 0) - 1);
            }
            closeDeleteUserModal();
            renderTable();
        } else {
            throw new Error(data.message || 'Failed to delete user');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        confirmDeleteUser.disabled = false;
        confirmDeleteUser.innerHTML = 'Delete User';
    }
}

/**
 * Close delete user modal
 */
function closeDeleteUserModal() {
    deleteUserModal.classList.add('hide');
    deleteUserTarget = null;
}

// =========================================
// BULK DELETE
// =========================================

/**
 * Show bulk delete confirmation modal
 */
function showBulkDeleteModal() {
    if (selectedIds.size === 0) return;

    // Get selected calendar details
    const selectedCalendars = calendars.filter(c => selectedIds.has(parseInt(c.id)));

    bulkDeleteCount.textContent = selectedCalendars.length;

    // Build list of calendars to delete
    bulkDeleteList.innerHTML = selectedCalendars.map(cal => `
        <div class="bulk-item">
            <span class="bulk-item-id">#${cal.id}</span>
            ${escapeHtml(cal.title) || '(untitled)'}
        </div>
    `).join('');

    // Reset confirmation input
    bulkConfirmInput.value = '';
    confirmBulkDelete.disabled = true;

    bulkDeleteModal.classList.remove('hide');
    bulkConfirmInput.focus();
}

/**
 * Handle confirmation input for bulk delete
 */
function handleBulkConfirmInput() {
    const value = bulkConfirmInput.value.trim().toUpperCase();
    confirmBulkDelete.disabled = (value !== 'DELETE');
}

/**
 * Execute bulk delete
 */
async function executeBulkDelete() {
    if (selectedIds.size === 0) return;

    confirmBulkDelete.disabled = true;
    confirmBulkDelete.innerHTML = '<span class="material-symbols-outlined spin">progress_activity</span> Deleting...';

    const idsToDelete = Array.from(selectedIds);
    let successCount = 0;
    let errorCount = 0;

    // Delete one by one (could be batched in a future API endpoint)
    for (const id of idsToDelete) {
        try {
            const formData = new FormData();
            formData.append('calendar_id', id);

            const data = await apiRequest('admin_delete_calendar', 'POST', formData);

            if (data.status === 'success') {
                calendars = calendars.filter(c => c.id !== id);
                selectedIds.delete(id);
                successCount++;
            } else {
                errorCount++;
            }
        } catch (err) {
            errorCount++;
        }
    }

    closeBulkDeleteModal();
    applyFilters();

    // Show result
    if (errorCount > 0) {
        alert(`Deleted ${successCount} calendars. ${errorCount} failed.`);
    }
}

/**
 * Close bulk delete modal
 */
function closeBulkDeleteModal() {
    bulkDeleteModal.classList.add('hide');
    bulkConfirmInput.value = '';
    confirmBulkDelete.disabled = true;
    confirmBulkDelete.innerHTML = 'Delete All';
}

// =========================================
// PAGINATION
// =========================================

function goToPrevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderTable();
    }
}

function goToNextPage() {
    const totalPages = Math.ceil(filteredCalendars.length / pageSize);
    if (currentPage < totalPages) {
        currentPage++;
        renderTable();
    }
}

// Search input (debounced)
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 300);
});

// Filter checkbox
filterPermanent.addEventListener('change', applyFilters);

// Refresh button
refreshBtn.addEventListener('click', loadCalendars);

// Select all checkbox
selectAllCheckbox.addEventListener('change', (e) => {
    toggleSelectAll(e.target.checked);
});

// Calendar table event delegation (no inline handlers)
calendarTableBody.addEventListener('click', handleTableClick);
calendarTableBody.addEventListener('change', handleTableChange);

// Bulk actions
bulkDeleteBtn.addEventListener('click', showBulkDeleteModal);
clearSelectionBtn.addEventListener('click', clearSelection);

// Table header sorting
calendarTable.querySelector('thead').addEventListener('click', handleSort);

// Pagination
prevPage.addEventListener('click', goToPrevPage);
nextPage.addEventListener('click', goToNextPage);

// Single delete modal
cancelDelete.addEventListener('click', closeDeleteModal);
confirmDelete.addEventListener('click', executeDelete);
deleteModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteModal);

// Bulk delete modal
cancelBulkDelete.addEventListener('click', closeBulkDeleteModal);
confirmBulkDelete.addEventListener('click', executeBulkDelete);
bulkConfirmInput.addEventListener('input', handleBulkConfirmInput);
bulkDeleteModal.querySelector('.modal-backdrop').addEventListener('click', closeBulkDeleteModal);

// Delete user modal
cancelDeleteUser.addEventListener('click', closeDeleteUserModal);
confirmDeleteUser.addEventListener('click', executeDeleteUser);
deleteUserModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteUserModal);
