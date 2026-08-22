/**
 * admin.js - Admin Panel for When RU Free?
 * 
 * Handles:
 * - Admin authentication (password stored in config.php)
 * - Calendar listing with search/filter/sort
 * - Toggle never_expires flag
 * - Delete single calendar
 * - Bulk delete multiple calendars
 * - Pagination
 */

(function() {
    'use strict';

    // =========================================
    // STATE
    // =========================================
    let adminToken = null;          // Session token after login
    let csrfToken = null;           // CSRF token for mutations
    let calendars = [];             // Full calendar list from server
    let filteredCalendars = [];     // After search/filter applied
    let selectedIds = new Set();    // Selected calendar IDs for bulk operations
    let currentPage = 1;
    const pageSize = 25;
    let sortColumn = 'id';
    let sortDirection = 'desc';
    let deleteTargetId = null;      // Calendar ID pending single deletion
    let expandedCalendarIds = new Set(); // Calendar IDs with user rows expanded
    let expandedUsers = {};         // { calendarId: [user, ...] } cached user data
    let deleteUserTarget = null;    // { calendarId, userId, name, role } pending user deletion

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

    // =========================================
    // DOM REFERENCES
    // =========================================
    const loginScreen = document.getElementById('loginScreen');
    const loginForm = document.getElementById('loginForm');
    const adminPassword = document.getElementById('adminPassword');
    const loginError = document.getElementById('loginError');

    const adminPanel = document.getElementById('adminPanel');
    const logoutBtn = document.getElementById('logoutBtn');
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

    // =========================================
    // UTILITY FUNCTIONS
    // =========================================

    /**
     * Make API request with admin authentication
     */
    async function apiRequest(action, method = 'GET', body = null) {
        const url = new URL('api.php', window.location.href);
        url.searchParams.set('action', action);

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
                adminToken = data.admin_token;
                csrfToken = data.csrf_token;

                // Store in session storage (cleared on browser close)
                sessionStorage.setItem('adminToken', adminToken);
                sessionStorage.setItem('csrfToken', csrfToken);

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
        }
    }

    /**
     * Show admin panel, hide login
     */
    function showAdminPanel() {
        loginScreen.classList.add('hide');
        adminPanel.classList.remove('hide');
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
                var btn = document.createElement('button');
                btn.className = 'user-pill' + (isAdmin ? ' is-admin' : '');
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
            })(users[i]);
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

    // =========================================
    // EVENT LISTENERS
    // =========================================

    // Login form
    loginForm.addEventListener('submit', handleLogin);

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

    checkExistingSession();

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
    }

    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

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
            retention: {
                inactive_days: 30,
                hub_inactive_days: 30
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

        // Retention / auto-delete
        if (retentionDaysInput) {
            const days = parseInt(cfg.retention?.inactive_days, 10);
            retentionDaysInput.value = (days >= 1 && days <= 3650) ? days : 30;
        }
        if (hubRetentionDaysInput) {
            const hubDays = parseInt(cfg.retention?.hub_inactive_days, 10);
            hubRetentionDaysInput.value = (hubDays >= 1 && hubDays <= 3650) ? hubDays : 30;
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
            retention: {
                inactive_days: Math.max(1, Math.min(3650, parseInt(retentionDaysInput?.value, 10) || 30)),
                hub_inactive_days: Math.max(1, Math.min(3650, parseInt(hubRetentionDaysInput?.value, 10) || 30))
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

})();