/**
 * admin-hubs.js - Hubs tab: list, search, sort, selection, delete, bulk delete, pagination and the calendars expander.
 * Classic script sharing global scope. Load order: emoji.js, admin-core.js, admin-calendars.js, admin-hubs.js, admin-accounts.js, admin-setup.js.
 */
'use strict';

// Hub admin state
let groups = [];
let filteredGroups = [];
let selectedHubIds = new Set();
let hubCurrentPage = 1;
let hubSortColumn = 'id';
let hubSortDirection = 'desc';
let deleteHubTargetId = null;
let expandedHubIds = new Set();
let expandedHubCalendars = {};
let hubsLoaded = false;

// Hub tab DOM
const hubSearchInput = document.getElementById('hubSearchInput');
const hubFilterPermanent = document.getElementById('hubFilterPermanent');
const hubRefreshBtn = document.getElementById('hubRefreshBtn');
const hubBulkActionsBar = document.getElementById('hubBulkActionsBar');
const hubSelectedCount = document.getElementById('hubSelectedCount');
const hubBulkDeleteBtn = document.getElementById('hubBulkDeleteBtn');
const hubClearSelectionBtn = document.getElementById('hubClearSelectionBtn');
const hubSelectAllCheckbox = document.getElementById('hubSelectAll');
const hubTable = document.getElementById('hubTable');
const hubTableBody = document.getElementById('hubTableBody');
const hubLoadingState = document.getElementById('hubLoadingState');
const hubEmptyState = document.getElementById('hubEmptyState');
const hubErrorState = document.getElementById('hubErrorState');
const hubPagination = document.getElementById('hubPagination');
const hubPrevPage = document.getElementById('hubPrevPage');
const hubNextPage = document.getElementById('hubNextPage');
const hubPageInfo = document.getElementById('hubPageInfo');
const deleteHubModal = document.getElementById('deleteHubModal');
const deleteHubInfo = document.getElementById('deleteHubInfo');
const cancelDeleteHub = document.getElementById('cancelDeleteHub');
const confirmDeleteHub = document.getElementById('confirmDeleteHub');
const bulkDeleteHubModal = document.getElementById('bulkDeleteHubModal');
const bulkDeleteHubCount = document.getElementById('bulkDeleteHubCount');
const bulkDeleteHubList = document.getElementById('bulkDeleteHubList');
const bulkDeleteHubConfirmInput = document.getElementById('bulkDeleteHubConfirmInput');
const cancelBulkDeleteHub = document.getElementById('cancelBulkDeleteHub');
const confirmBulkDeleteHub = document.getElementById('confirmBulkDeleteHub');

// =========================================
// HUB DATA
// =========================================

function showHubState(state) {
    hubLoadingState.classList.add('hide');
    hubEmptyState.classList.add('hide');
    hubErrorState.classList.add('hide');
    hubTable.classList.add('hide');
    hubPagination.classList.add('hide');

    switch (state) {
        case 'loading':
            hubLoadingState.classList.remove('hide');
            break;
        case 'empty':
            hubEmptyState.classList.remove('hide');
            break;
        case 'error':
            hubErrorState.classList.remove('hide');
            break;
        case 'data':
            hubTable.classList.remove('hide');
            if (filteredGroups.length > pageSize) {
                hubPagination.classList.remove('hide');
            }
            break;
    }
}

async function loadHubs() {
    showHubState('loading');
    selectedHubIds.clear();
    updateHubBulkActionsUI();

    try {
        const data = await apiRequest('admin_groups', 'GET');

        if (data.status === 'success') {
            groups = data.groups || [];
            hubsLoaded = true;
            if (data.csrf_token) {
                csrfToken = data.csrf_token;
                sessionStorage.setItem('csrfToken', csrfToken);
            }
            applyHubFilters();
        } else {
            throw new Error(data.message || 'Failed to load Hubs');
        }
    } catch (err) {
        if (err.message.includes('Auth') || err.message.includes('session')) {
            handleLogout();
        } else {
            hubErrorState.textContent = err.message;
            showHubState('error');
        }
    }
}

function applyHubFilters() {
    const searchTerm = hubSearchInput.value.trim().toLowerCase();
    const permanentOnly = hubFilterPermanent.checked;

    filteredGroups = groups.filter(group => {
        if (permanentOnly && !group.never_expires) {
            return false;
        }
        if (searchTerm) {
            const title = (group.title || '').toLowerCase();
            const token = (group.token || '').toLowerCase();
            const organiser = (group.organiser_name || '').toLowerCase();
            if (!title.includes(searchTerm) && !token.includes(searchTerm) && !organiser.includes(searchTerm)) {
                return false;
            }
        }
        return true;
    });

    sortGroups();
    hubCurrentPage = 1;
    renderHubTable();
}

function sortGroups() {
    filteredGroups.sort((a, b) => {
        let aVal = a[hubSortColumn];
        let bVal = b[hubSortColumn];

        if (aVal == null) aVal = '';
        if (bVal == null) bVal = '';

        if (hubSortColumn === 'id' || hubSortColumn === 'calendar_count') {
            aVal = parseInt(aVal) || 0;
            bVal = parseInt(bVal) || 0;
        }

        if (hubSortColumn === 'created_at' || hubSortColumn === 'last_activity') {
            aVal = aVal ? new Date(aVal).getTime() : 0;
            bVal = bVal ? new Date(bVal).getTime() : 0;
        }

        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        let result = 0;
        if (aVal < bVal) result = -1;
        else if (aVal > bVal) result = 1;

        return hubSortDirection === 'asc' ? result : -result;
    });
}

function handleHubSort(e) {
    const th = e.target.closest('th.sortable');
    if (!th) return;

    const column = th.dataset.sort;
    if (!column) return;

    if (hubSortColumn === column) {
        hubSortDirection = hubSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        hubSortColumn = column;
        hubSortDirection = 'desc';
    }

    hubTable.querySelectorAll('th').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc');
    });
    th.classList.add(hubSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

    sortGroups();
    renderHubTable();
}

function toggleHubSelection(groupId, checked) {
    const id = parseInt(groupId, 10);
    if (checked) {
        selectedHubIds.add(id);
    } else {
        selectedHubIds.delete(id);
    }
    updateHubBulkActionsUI();
    updateHubRowHighlights();
    updateHubSelectAllState();
}

function toggleHubSelectAll(checked) {
    const startIdx = (hubCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredGroups.length);
    const pageGroups = filteredGroups.slice(startIdx, endIdx);

    pageGroups.forEach(group => {
        const id = parseInt(group.id, 10);
        if (checked) {
            selectedHubIds.add(id);
        } else {
            selectedHubIds.delete(id);
        }
    });

    updateHubBulkActionsUI();
    updateHubRowHighlights();
    updateHubRowCheckboxes();
}

function clearHubSelection() {
    selectedHubIds.clear();
    updateHubBulkActionsUI();
    updateHubRowHighlights();
    updateHubRowCheckboxes();
    hubSelectAllCheckbox.checked = false;
}

function updateHubBulkActionsUI() {
    if (selectedHubIds.size > 0) {
        hubBulkActionsBar.classList.remove('hide');
        hubSelectedCount.textContent = `${selectedHubIds.size} selected`;
    } else {
        hubBulkActionsBar.classList.add('hide');
    }
}

function updateHubRowHighlights() {
    const rows = hubTableBody.querySelectorAll('tr[data-id]');
    rows.forEach(row => {
        const id = parseInt(row.dataset.id, 10);
        if (selectedHubIds.has(id)) {
            row.classList.add('selected');
        } else {
            row.classList.remove('selected');
        }
    });
}

function updateHubRowCheckboxes() {
    const checkboxes = hubTableBody.querySelectorAll('input[type="checkbox"][data-id]');
    checkboxes.forEach(cb => {
        const id = parseInt(cb.dataset.id, 10);
        cb.checked = selectedHubIds.has(id);
    });
}

function updateHubSelectAllState() {
    const startIdx = (hubCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredGroups.length);
    const pageGroups = filteredGroups.slice(startIdx, endIdx);

    if (pageGroups.length === 0) {
        hubSelectAllCheckbox.checked = false;
        hubSelectAllCheckbox.indeterminate = false;
        return;
    }

    const selectedOnPage = pageGroups.filter(g => selectedHubIds.has(parseInt(g.id, 10))).length;

    if (selectedOnPage === 0) {
        hubSelectAllCheckbox.checked = false;
        hubSelectAllCheckbox.indeterminate = false;
    } else if (selectedOnPage === pageGroups.length) {
        hubSelectAllCheckbox.checked = true;
        hubSelectAllCheckbox.indeterminate = false;
    } else {
        hubSelectAllCheckbox.checked = false;
        hubSelectAllCheckbox.indeterminate = true;
    }
}

function renderHubTable() {
    if (filteredGroups.length === 0) {
        showHubState('empty');
        return;
    }

    const totalPages = Math.ceil(filteredGroups.length / pageSize);
    if (hubCurrentPage > totalPages) hubCurrentPage = totalPages;
    if (hubCurrentPage < 1) hubCurrentPage = 1;

    const startIdx = (hubCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, filteredGroups.length);
    const pageGroups = filteredGroups.slice(startIdx, endIdx);

    hubTableBody.innerHTML = pageGroups.map(group => {
        const groupId = parseInt(group.id, 10);
        const isSelected = selectedHubIds.has(groupId);
        const escapedTitle = escapeHtml(group.title);
        return `
        <tr data-id="${group.id}" class="${isSelected ? 'selected' : ''}">
            <td class="col-checkbox">
                <input type="checkbox"
                       data-action="toggle-hub-select"
                       data-id="${group.id}"
                       ${isSelected ? 'checked' : ''}>
            </td>
            <td class="col-id">${group.id}</td>
            <td class="col-title">
                <span class="title-cell ${group.title ? '' : 'no-title'}">
                    ${escapedTitle || '(untitled)'}
                </span>
                ${emojiBadge(group.access_emoji, false)}
            </td>
            <td class="col-token">
                <span class="token-display" title="${group.token}">${truncateToken(group.token)}</span>
            </td>
            <td class="col-organiser">${escapeHtml(group.organiser_name) || '&mdash;'}</td>
            <td class="col-created">${formatDate(group.created_at)}</td>
            <td class="col-activity">${formatDate(group.last_activity)}</td>
            <td class="col-cal-count">
                <button type="button" class="user-count-btn ${expandedHubIds.has(groupId) ? 'expanded' : ''}"
                        data-action="toggle-hub-calendars"
                        data-group-id="${group.id}"
                        title="Show/hide calendars">
                    ${group.calendar_count || 0}
                    <span class="material-symbols-outlined expand-icon">expand_more</span>
                </button>
            </td>
            <td class="col-permanent">
                <label class="toggle-switch">
                    <input type="checkbox"
                           data-action="toggle-hub-permanent"
                           data-hub-perm-id="${group.id}"
                           ${group.never_expires ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            </td>
            <td class="col-actions">
                <div class="action-buttons">
                    ${group.locked_seconds > 0 ? `<button type="button" class="btn btn-ghost btn-icon btn-unlock"
                            data-action="unlock-hub"
                            data-group-id="${group.id}"
                            title="Organiser PIN locked for ${formatWait(group.locked_seconds)} - unlock">
                        <span class="material-symbols-outlined">lock_open</span>
                    </button>` : ''}
                    ${group.access_emoji !== null && group.access_emoji !== undefined ? `<button type="button" class="btn btn-ghost btn-icon btn-unlock"
                            data-action="clear-hub-emoji"
                            data-group-id="${group.id}"
                            title="Remove the access emoji">
                        <span class="material-symbols-outlined">key_off</span>
                    </button>` : ''}
                    <button type="button" class="btn btn-ghost btn-icon"
                            data-action="view-hub"
                            data-group-id="${group.id}"
                            title="Open Hub">
                        <span class="material-symbols-outlined">open_in_new</span>
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon"
                            data-action="delete-hub"
                            data-group-id="${group.id}"
                            title="Delete Hub">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </td>
        </tr>
        ${expandedHubIds.has(groupId) ? `<tr class="user-expand-row" data-expand-id="${group.id}"><td colspan="10"><div class="user-expand-inner" id="hubExpand_${group.id}"><span class="material-symbols-outlined spin" style="font-size:18px;color:#999;">progress_activity</span></div></td></tr>` : ''}
    `}).join('');

    hubPageInfo.textContent = `Page ${hubCurrentPage} of ${totalPages} (${filteredGroups.length} Hubs)`;
    hubPrevPage.disabled = hubCurrentPage <= 1;
    hubNextPage.disabled = hubCurrentPage >= totalPages;

    updateHubSelectAllState();
    renderAllExpandedHubCalendars();
    showHubState('data');
}

async function handleToggleHubPermanent(groupId, value) {
    const toggle = document.querySelector(`input[data-hub-perm-id="${groupId}"]`);
    if (toggle) toggle.disabled = true;

    try {
        const formData = new FormData();
        formData.append('group_id', groupId);
        formData.append('never_expires', value ? '1' : '0');

        const data = await apiRequest('admin_set_group_permanent', 'POST', formData);

        if (data.status === 'success') {
            const group = groups.find(g => parseInt(g.id, 10) === parseInt(groupId, 10));
            if (group) group.never_expires = value ? 1 : 0;
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

/** Clear a Hub organiser's PIN lockout (also resets the escalation level). */
async function unlockHub(groupId, btn) {
    const group = groups.find(g => parseInt(g.id, 10) === groupId);
    if (!group) return;
    if (!confirm('Unlock the organiser PIN for "' + (group.title || 'this Hub') + '"?')) return;
    btn.disabled = true;
    try {
        const formData = new FormData();
        formData.append('group_id', groupId);
        const data = await apiRequest('admin_unlock_group', 'POST', formData);
        if (data.status !== 'success') throw new Error(data.message || 'Failed to unlock');
        group.locked_seconds = 0;
        renderHubTable();
    } catch (err) {
        btn.disabled = false;
        alert('Error: ' + err.message);
    }
}

function viewHub(token) {
    window.open('hub.html?g=' + encodeURIComponent(token), '_blank');
}

function initiateDeleteHub(groupId) {
    const group = groups.find(g => parseInt(g.id, 10) === parseInt(groupId, 10));
    if (!group) return;
    deleteHubTargetId = parseInt(groupId, 10);
    deleteHubInfo.innerHTML = `
        <strong>ID:</strong> ${group.id}<br>
        <strong>Title:</strong> ${escapeHtml(group.title) || '(untitled)'}<br>
        <strong>Token:</strong> ${escapeHtml(group.token)}<br>
        <strong>Calendars:</strong> ${group.calendar_count || 0}
    `;
    deleteHubModal.classList.remove('hide');
}

function handleHubTableClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !hubTableBody.contains(btn)) return;

    const action = btn.dataset.action;
    if (action === 'toggle-hub-select' || action === 'toggle-hub-permanent') return;

    const groupId = parseInt(btn.dataset.groupId, 10);
    if (!groupId) return;

    if (action === 'view-hub') {
        const group = groups.find(g => parseInt(g.id, 10) === groupId);
        if (group) viewHub(group.token);
    } else if (action === 'delete-hub') {
        initiateDeleteHub(groupId);
    } else if (action === 'unlock-hub') {
        unlockHub(groupId, btn);
    } else if (action === 'clear-hub-emoji') {
        const group = groups.find(g => parseInt(g.id, 10) === groupId);
        if (group) clearAccessEmoji('group', group, btn, renderHubTable);
    } else if (action === 'toggle-hub-calendars') {
        toggleHubCalendarsExpand(groupId);
    }
}

function handleHubTableChange(e) {
    const target = e.target;
    if (!hubTableBody.contains(target)) return;

    if (target.matches('input[type="checkbox"][data-action="toggle-hub-select"]')) {
        toggleHubSelection(parseInt(target.dataset.id, 10), target.checked);
    } else if (target.matches('input[type="checkbox"][data-action="toggle-hub-permanent"]')) {
        handleToggleHubPermanent(parseInt(target.dataset.hubPermId, 10), target.checked);
    }
}

async function executeDeleteHub() {
    if (!deleteHubTargetId) return;

    confirmDeleteHub.disabled = true;
    confirmDeleteHub.innerHTML = '<span class="material-symbols-outlined spin">progress_activity</span> Deleting...';

    try {
        const formData = new FormData();
        formData.append('group_id', deleteHubTargetId);

        const data = await apiRequest('admin_delete_group', 'POST', formData);

        if (data.status === 'success') {
            groups = groups.filter(g => parseInt(g.id, 10) !== deleteHubTargetId);
            selectedHubIds.delete(deleteHubTargetId);
            expandedHubIds.delete(deleteHubTargetId);
            delete expandedHubCalendars[deleteHubTargetId];
            calendars.forEach(cal => {
                if (parseInt(cal.group_id, 10) === deleteHubTargetId) {
                    cal.group_id = null;
                    cal.group_token = null;
                    cal.group_title = null;
                }
            });
            applyHubFilters();
            closeDeleteHubModal();
        } else {
            throw new Error(data.message || 'Failed to delete');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        confirmDeleteHub.disabled = false;
        confirmDeleteHub.innerHTML = 'Delete Hub';
    }
}

function closeDeleteHubModal() {
    deleteHubModal.classList.add('hide');
    deleteHubTargetId = null;
}

async function toggleHubCalendarsExpand(groupId) {
    const id = parseInt(groupId, 10);
    if (expandedHubIds.has(id)) {
        expandedHubIds.delete(id);
        renderHubTable();
        return;
    }
    expandedHubIds.add(id);
    renderHubTable();

    if (!expandedHubCalendars[id]) {
        try {
            const url = new URL('api.php', window.location.href);
            url.searchParams.set('action', 'admin_group_calendars');
            url.searchParams.set('group_id', id);
            const opts = { method: 'GET', headers: {}, credentials: 'same-origin' };
            if (adminToken) opts.headers['X-Admin-Token'] = adminToken;
            const resp = await fetch(url.toString(), opts);
            const data = await resp.json();
            if (data.status === 'success' && Array.isArray(data.calendars)) {
                expandedHubCalendars[id] = data.calendars;
            } else {
                expandedHubCalendars[id] = [];
                const c = document.getElementById('hubExpand_' + id);
                if (c) {
                    c.innerHTML = '<span style="color:#c00;font-size:.85rem;">' +
                        escapeHtml(data.message || 'Failed to load calendars') + '</span>';
                }
                return;
            }
        } catch (e) {
            expandedHubCalendars[id] = [];
            const c = document.getElementById('hubExpand_' + id);
            if (c) c.innerHTML = '<span style="color:#c00;font-size:.85rem;">Network error</span>';
            return;
        }
    }
    renderHubCalendarList(id);
}

function renderHubCalendarList(groupId) {
    const container = document.getElementById('hubExpand_' + groupId);
    if (!container) return;
    const cals = expandedHubCalendars[groupId] || [];
    if (cals.length === 0) {
        container.innerHTML = '<span style="color:#999;font-size:.85rem;">No calendars in this Hub</span>';
        return;
    }
    container.innerHTML = cals.map(cal => {
        const title = escapeHtml(cal.title) || '(untitled)';
        return `<a href="calendar.html?c=${encodeURIComponent(cal.token)}" target="_blank" class="hub-cal-link">${title}</a>`;
    }).join('');
}

function renderAllExpandedHubCalendars() {
    expandedHubIds.forEach(id => {
        if (expandedHubCalendars[id]) {
            renderHubCalendarList(id);
        }
    });
}

function showBulkDeleteHubModal() {
    if (selectedHubIds.size === 0) return;

    const selectedGroups = groups.filter(g => selectedHubIds.has(parseInt(g.id, 10)));

    bulkDeleteHubCount.textContent = selectedGroups.length;
    bulkDeleteHubList.innerHTML = selectedGroups.map(group => `
        <div class="bulk-item">
            <span class="bulk-item-id">#${group.id}</span>
            ${escapeHtml(group.title) || '(untitled)'}
        </div>
    `).join('');

    bulkDeleteHubConfirmInput.value = '';
    confirmBulkDeleteHub.disabled = true;
    bulkDeleteHubModal.classList.remove('hide');
    bulkDeleteHubConfirmInput.focus();
}

function handleBulkDeleteHubConfirmInput() {
    const value = bulkDeleteHubConfirmInput.value.trim().toUpperCase();
    confirmBulkDeleteHub.disabled = (value !== 'DELETE');
}

async function executeBulkDeleteHub() {
    if (selectedHubIds.size === 0) return;

    confirmBulkDeleteHub.disabled = true;
    confirmBulkDeleteHub.innerHTML = '<span class="material-symbols-outlined spin">progress_activity</span> Deleting...';

    const idsToDelete = Array.from(selectedHubIds);
    let successCount = 0;
    let errorCount = 0;

    for (const id of idsToDelete) {
        try {
            const formData = new FormData();
            formData.append('group_id', id);

            const data = await apiRequest('admin_delete_group', 'POST', formData);

            if (data.status === 'success') {
                groups = groups.filter(g => parseInt(g.id, 10) !== id);
                selectedHubIds.delete(id);
                expandedHubIds.delete(id);
                delete expandedHubCalendars[id];
                calendars.forEach(cal => {
                    if (parseInt(cal.group_id, 10) === id) {
                        cal.group_id = null;
                        cal.group_token = null;
                        cal.group_title = null;
                    }
                });
                successCount++;
            } else {
                errorCount++;
            }
        } catch (err) {
            errorCount++;
        }
    }

    closeBulkDeleteHubModal();
    applyHubFilters();

    if (errorCount > 0) {
        alert(`Deleted ${successCount} Hubs. ${errorCount} failed.`);
    }
}

function closeBulkDeleteHubModal() {
    bulkDeleteHubModal.classList.add('hide');
    bulkDeleteHubConfirmInput.value = '';
    confirmBulkDeleteHub.disabled = true;
    confirmBulkDeleteHub.innerHTML = 'Delete All';
}

function goToHubPrevPage() {
    if (hubCurrentPage > 1) {
        hubCurrentPage--;
        renderHubTable();
    }
}

function goToHubNextPage() {
    const totalPages = Math.ceil(filteredGroups.length / pageSize);
    if (hubCurrentPage < totalPages) {
        hubCurrentPage++;
        renderHubTable();
    }
}

hubSelectAllCheckbox.addEventListener('change', (e) => toggleHubSelectAll(e.target.checked));
hubTableBody.addEventListener('click', handleHubTableClick);
hubTableBody.addEventListener('change', handleHubTableChange);
hubTable.querySelector('thead').addEventListener('click', handleHubSort);
hubPrevPage.addEventListener('click', goToHubPrevPage);
hubNextPage.addEventListener('click', goToHubNextPage);
hubBulkDeleteBtn.addEventListener('click', showBulkDeleteHubModal);
hubClearSelectionBtn.addEventListener('click', clearHubSelection);

let hubSearchTimeout;
hubSearchInput.addEventListener('input', () => {
    clearTimeout(hubSearchTimeout);
    hubSearchTimeout = setTimeout(applyHubFilters, 300);
});
hubFilterPermanent.addEventListener('change', applyHubFilters);
hubRefreshBtn.addEventListener('click', loadHubs);

cancelDeleteHub.addEventListener('click', closeDeleteHubModal);
confirmDeleteHub.addEventListener('click', executeDeleteHub);
deleteHubModal.querySelector('.modal-backdrop').addEventListener('click', closeDeleteHubModal);

cancelBulkDeleteHub.addEventListener('click', closeBulkDeleteHubModal);
confirmBulkDeleteHub.addEventListener('click', executeBulkDeleteHub);
bulkDeleteHubConfirmInput.addEventListener('input', handleBulkDeleteHubConfirmInput);
bulkDeleteHubModal.querySelector('.modal-backdrop').addEventListener('click', closeBulkDeleteHubModal);
