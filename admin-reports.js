/**
 * admin-reports.js - Admin panel Reports tab: reports sent by organisers when blocking someone.
 * Open reports come first; a super admin can Dismiss (leave the person alone) or Delete the
 * account. Usernames are shown here and nowhere else.
 * Classic script sharing global scope. Load order: emoji.js, admin-core.js, admin-calendars.js,
 * admin-hubs.js, admin-accounts.js, admin-reports.js, admin-setup.js.
 */
'use strict';

let reportsLoaded = false;
let adminReports = [];
let reportReasons = {};

const reportsStatus = document.getElementById('reportsStatus');
const reportsRefreshBtn = document.getElementById('reportsRefreshBtn');
const reportsTabBadge = document.getElementById('reportsTabBadge');
const reportTable = document.getElementById('reportTable');
const reportTableBody = document.getElementById('reportTableBody');
const reportLoadingState = document.getElementById('reportLoadingState');
const reportEmptyState = document.getElementById('reportEmptyState');
const reportErrorState = document.getElementById('reportErrorState');

function showReportState(state) {
    reportLoadingState.classList.toggle('hide', state !== 'loading');
    reportEmptyState.classList.toggle('hide', state !== 'empty');
    reportErrorState.classList.toggle('hide', state !== 'error');
    reportTable.classList.toggle('hide', state !== 'data');
}

/** "Open reports: N" badge on the tab, hidden when there are none. */
function updateReportsBadge(count) {
    const n = Number(count) || 0;
    reportsTabBadge.textContent = String(n);
    reportsTabBadge.classList.toggle('hide', n === 0);
}

function reasonLabel(key) {
    return reportReasons[key] || String(key || 'Other');
}

function reportRow(r) {
    const label = r.display_name ? escapeHtml(r.display_name) : '<span class="no-title">(no name)</span>';
    const details = r.details ? `<div class="report-details">${escapeHtml(r.details)}</div>` : '';
    const username = r.account_username
        ? escapeHtml(r.account_username)
        : (r.account_id ? `#${r.account_id}` : '<span class="no-title">(no account)</span>');
    // calendar_title is the live title, or the snapshot for a report that outlived its calendar
    const calendar = r.calendar_token
        ? `<a href="calendar.html?c=${encodeURIComponent(r.calendar_token || '')}" target="_blank" rel="noopener">${escapeHtml(r.calendar_title || 'Untitled calendar')}</a>`
        : `<span class="no-title">${r.calendar_title ? escapeHtml(r.calendar_title) + ' (deleted)' : `deleted (#${r.calendar_id})`}</span>`;
    // Reports about an organiser reach the WhenRUFree admin directly; escalated ones came through an organiser
    const origin = r.outcome === 'escalated' ? ' <span class="acct-tag acct-tag-muted">escalated</span>' : '';
    const closed = r.status !== 'open';
    return `
        <tr class="${closed ? 'report-closed' : ''}">
            <td class="rp-id">${r.id}</td>
            <td class="rp-name">${label}${origin}${details}</td>
            <td class="rp-username">${username}</td>
            <td class="rp-reason">${escapeHtml(reasonLabel(r.reason))}</td>
            <td class="rp-calendar">${calendar}</td>
            <td class="rp-reporter">${r.reporter_username ? escapeHtml(r.reporter_username) : (r.reporter_name ? escapeHtml(r.reporter_name) : '&mdash;')}</td>
            <td class="rp-when">${formatDate(r.created_at)}</td>
            <td class="rp-actions">
                <div class="action-buttons">
                    ${closed ? '<span class="report-done">Closed</span>' : `
                    <button type="button" class="btn btn-ghost btn-small"
                            data-action="dismiss-report" data-report-id="${r.id}"
                            title="Dismiss: leave the person alone">
                        Dismiss
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon" ${r.account_id ? '' : 'disabled'}
                            data-action="delete-report-account" data-report-id="${r.id}"
                            title="${r.account_id ? 'Delete the reported account' : 'No account to delete'}">
                        <span class="material-symbols-outlined">delete</span>
                    </button>`}
                </div>
            </td>
        </tr>
    `;
}

function renderReports() {
    if (!adminReports.length) {
        showReportState('empty');
        return;
    }
    reportTableBody.innerHTML = adminReports.map(reportRow).join('');
    showReportState('data');
}

async function loadReports() {
    showReportState('loading');
    try {
        const data = await apiRequest('admin_reports', 'GET');
        reportsLoaded = true;
        if (!data.available) {
            reportErrorState.textContent = 'Reports are not available yet. Run migrations/011_report_users.sql and migrations/016_report_audience.sql.';
            updateReportsBadge(0);
            showReportState('error');
            return;
        }
        reportReasons = data.reasons || {};
        adminReports = data.reports || [];
        updateReportsBadge(data.open);
        renderReports();
    } catch (err) {
        if (err.message.includes('Auth') || err.message.includes('session')) {
            handleLogout();
        } else {
            reportErrorState.textContent = err.message;
            showReportState('error');
        }
    }
}

async function decideReport(reportId, decision, btn) {
    const r = adminReports.find(x => x.id === reportId);
    if (!r) return;
    if (decision === 'dismiss') {
        if (!confirm(`Dismiss report #${reportId}?\n\nThe person stays on the calendar and is not deleted.`)) return;
    } else {
        const who = r.account_username || (r.display_name ? `"${r.display_name}"` : `account #${r.account_id}`);
        const typed = prompt(
            `Delete the account ${who}?\n\n`
            + 'This deletes their calendars and Hubs, their names on other calendars and all their '
            + 'sign-in data, the same as them deleting it themselves. You cannot undo this.\n\n'
            + `Type ${r.account_username || 'DELETE'} to confirm:`
        );
        if (typed === null) return;
        if (typed.trim() !== (r.account_username || 'DELETE')) {
            alert('Confirmation did not match. Nothing was deleted.');
            return;
        }
    }
    btn.disabled = true;
    reportsStatus.textContent = '';
    try {
        const data = await apiRequest('admin_report_decide', 'POST', { report_id: reportId, decision });
        reportsStatus.textContent = decision === 'delete' ? 'Account deleted.' : 'Report dismissed.';
        updateReportsBadge(data.open);
        if (decision === 'delete') calendarsNeedReload();
        await loadReports();
    } catch (err) {
        alert(err.message || 'That did not work');
        btn.disabled = false;
    }
}

reportTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const reportId = Number(btn.dataset.reportId);
    if (btn.dataset.action === 'dismiss-report') decideReport(reportId, 'dismiss', btn);
    if (btn.dataset.action === 'delete-report-account') decideReport(reportId, 'delete', btn);
});
reportsRefreshBtn.addEventListener('click', () => { reportsLoaded = false; loadReports(); });
