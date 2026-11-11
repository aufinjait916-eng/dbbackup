import React, { useState } from 'react';
import {
  Database,
  Download,
  Eye,
  Trash2,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { DatabaseItem } from '../types';
import { formatBytes } from '../utils/backupEngine';

interface DatabaseQueueTableProps {
  databases: DatabaseItem[];
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (select: boolean) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onAddDatabase: (name: string) => void;
  onBackupSingle: (id: string) => void;
  onPreviewSql: (db: DatabaseItem) => void;
  isBatchRunning: boolean;
  activeDbId: string | null;
}

export const DatabaseQueueTable: React.FC<DatabaseQueueTableProps> = ({
  databases,
  onToggleSelect,
  onToggleSelectAll,
  onRemove,
  onClearAll,
  onAddDatabase,
  onBackupSingle,
  onPreviewSql,
  isBatchRunning,
  activeDbId,
}) => {
  const [filterText, setFilterText] = useState('');
  const [newDbName, setNewDbName] = useState('');

  const filteredDatabases = databases.filter((db) =>
    db.name.toLowerCase().includes(filterText.toLowerCase().trim())
  );

  const selectedCount = databases.filter((db) => db.selected).length;
  const allSelected = databases.length > 0 && selectedCount === databases.length;

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDbName.trim();
    if (trimmed) {
      onAddDatabase(trimmed);
      setNewDbName('');
    }
  };

  const getStatusDisplay = (db: DatabaseItem) => {
    switch (db.status) {
      case 'idle':
        return (
          <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Ready</span>
          </span>
        );
      case 'queued':
        return (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            <span>Queued</span>
          </span>
        );
      case 'connecting':
        return (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Connecting</span>
          </span>
        );
      case 'dumping':
        return (
          <span className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Dumping SQL</span>
          </span>
        );
      case 'downloading':
        return (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <Download className="w-3.5 h-3.5 animate-bounce" />
            <span>Downloading</span>
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Downloaded</span>
          </span>
        );
      case 'failed':
        return (
          <span
            className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium"
            title={db.error || 'Backup failed'}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Failed</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
      {/* Top Controls Toolbar */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search & Stats */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter databases in queue..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Add manual database form */}
        <form onSubmit={handleAddSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={newDbName}
            onChange={(e) => setNewDbName(e.target.value)}
            placeholder="Add database name..."
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={!newDbName.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </form>

        {/* Selection & Clear Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleSelectAll(!allSelected)}
            className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <button
            onClick={onClearAll}
            disabled={databases.length === 0 || isBatchRunning}
            className="px-2.5 py-1 text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 transition-colors disabled:opacity-50"
          >
            Clear Queue
          </button>
        </div>
      </div>

      {/* Database Table */}
      {filteredDatabases.length === 0 ? (
        <div className="p-12 text-center text-slate-500 dark:text-slate-400">
          <Database className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium">No databases in queue</p>
          <p className="text-xs mt-1">
            Click &quot;Discover Server DBs&quot; above to automatically query all non-template databases from PostgreSQL, or add a database name manually.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-900/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => onToggleSelectAll(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Database Name</th>
                <th className="py-3 px-4 w-36">Status</th>
                <th className="py-3 px-4 w-28 text-right">Size</th>
                <th className="py-3 px-4 w-24 text-right">Duration</th>
                <th className="py-3 px-4 w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredDatabases.map((db) => {
                const isActive = activeDbId === db.id;
                return (
                  <tr
                    key={db.id}
                    className={`transition-colors ${
                      isActive
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={db.selected}
                        onChange={() => onToggleSelect(db.id)}
                        disabled={isBatchRunning}
                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                          {db.name}
                        </span>
                      </div>
                      {db.error && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 truncate max-w-md">
                          {db.error}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">{getStatusDisplay(db)}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {formatBytes(db.sizeBytes)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {db.durationMs !== undefined ? `${(db.durationMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {db.sqlContent && (
                          <button
                            onClick={() => onPreviewSql(db)}
                            title="Preview SQL dump"
                            className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => onBackupSingle(db.id)}
                          disabled={isBatchRunning || isActive}
                          title="Backup and download this database"
                          className="p-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors disabled:opacity-40"
                        >
                          {db.status === 'failed' ? (
                            <RotateCcw className="w-3.5 h-3.5" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          onClick={() => onRemove(db.id)}
                          disabled={isBatchRunning}
                          title="Remove from queue"
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer queue stats */}
      <div className="px-4 py-3 bg-slate-50/50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span>Total Databases: <strong className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">{databases.length}</strong></span>
          <span>·</span>
          <span>Selected for Backup: <strong className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">{selectedCount}</strong></span>
          <span>·</span>
          <span>Completed: <strong className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">{databases.filter((d) => d.status === 'completed').length}</strong></span>
        </div>
      </div>
    </div>
  );
};
