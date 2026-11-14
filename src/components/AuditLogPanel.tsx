import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, Download, AlertCircle } from 'lucide-react';
import { AuditLogRecord } from '../types';
import { apiFetch } from '../utils/apiClient';
import { triggerBrowserDownload } from '../utils/backupEngine';

export const AuditLogPanel: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'SUCCESS' | 'FAILURE' | 'DENIED'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'AUTH' | 'BACKUP' | 'ADMIN'>('ALL');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/audit-logs?limit=500');
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to load audit logs.');
        return;
      }
      setLogs(data.logs || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch audit logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs = logs.filter((entry) => {
    if (outcomeFilter !== 'ALL' && entry.outcome !== outcomeFilter) return false;

    if (categoryFilter === 'AUTH') {
      if (
        ![
          'LOGIN_PASSWORD_OK',
          'LOGIN_FAILED',
          'ACCOUNT_LOCKED',
          'RATE_LIMIT_BLOCKED',
          'MFA_SETUP_INIT',
          'MFA_SETUP_COMPLETED',
          'MFA_VERIFY_SUCCESS',
          'MFA_VERIFY_FAILED',
          'MFA_BACKUP_CODE_USED',
          'LOGOUT',
          'SESSION_EXPIRED',
          'PASSWORD_CHANGED',
          'CSRF_REJECTED',
          'RBAC_DENIED',
        ].includes(entry.action)
      ) {
        return false;
      }
    } else if (categoryFilter === 'BACKUP') {
      if (
        ![
          'CONNECTION_TESTED',
          'DATABASES_DISCOVERED',
          'BACKUP_STARTED',
          'BACKUP_COMPLETED',
          'BACKUP_FAILED',
          'ZIP_BUNDLE_DOWNLOADED',
        ].includes(entry.action)
      ) {
        return false;
      }
    } else if (categoryFilter === 'ADMIN') {
      if (
        ![
          'SYSTEM_BOOTSTRAP',
          'USER_CREATED',
          'USER_UPDATED',
          'USER_DELETED',
          'USER_UNLOCKED',
          'MFA_RESET',
        ].includes(entry.action)
      ) {
        return false;
      }
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      return (
        entry.actorUsername.toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q) ||
        (entry.target || '').toLowerCase().includes(q) ||
        entry.details.toLowerCase().includes(q) ||
        entry.ip.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], {
      type: 'application/json',
    });
    triggerBrowserDownload(blob, `truenas-pg-audit-log-${new Date().toISOString().slice(0, 10)}.json`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Security &amp; Backup Audit Log
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Immutable record of authentication attempts, MFA changes, user administration, and PostgreSQL backup exports.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportJson}
              disabled={filteredLogs.length === 0}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search actor, action, target DB, IP, or details..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Category Tabs */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
              {(['ALL', 'AUTH', 'BACKUP', 'ADMIN'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {cat === 'ALL'
                    ? 'All Events'
                    : cat === 'AUTH'
                    ? 'Auth & MFA'
                    : cat === 'BACKUP'
                    ? 'Backups'
                    : 'User Admin'}
                </button>
              ))}
            </div>

            {/* Outcome Filter */}
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200"
            >
              <option value="ALL">All Outcomes</option>
              <option value="SUCCESS">Success Only</option>
              <option value="FAILURE">Failures Only</option>
              <option value="DENIED">Denied Only</option>
            </select>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Audit Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-900/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4 w-44">Timestamp</th>
                <th className="py-3 px-4 w-40">Actor</th>
                <th className="py-3 px-4 w-44">Action</th>
                <th className="py-3 px-4 w-24">Outcome</th>
                <th className="py-3 px-4 w-32">Source IP</th>
                <th className="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    No audit events match the active filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                        {entry.actorUsername}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-1">
                        · {entry.actorRole}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                      {entry.action}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-medium ${
                          entry.outcome === 'SUCCESS'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : entry.outcome === 'DENIED'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                      {entry.ip}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                      {entry.target && (
                        <span className="font-mono text-slate-800 dark:text-slate-200 mr-1.5">
                          [{entry.target}]
                        </span>
                      )}
                      {entry.details}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
