import React from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { LogEntry } from '../types';

interface LogDrawerProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

export const LogDrawer: React.FC<LogDrawerProps> = ({ logs, onClearLogs }) => {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
          <Terminal className="w-3.5 h-3.5 text-slate-500" />
          <span>Execution & Download Activity Log</span>
          <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] tabular-nums">
            ({logs.length})
          </span>
        </div>
        <button
          onClick={onClearLogs}
          disabled={logs.length === 0}
          className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors disabled:opacity-40 flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" />
          <span>Clear</span>
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] select-text">
        {logs.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-500 italic py-2">
            No activity yet. Backups and downloads will log live events here.
          </div>
        ) : (
          logs.map((log) => {
            const colorClass =
              log.type === 'error'
                ? 'text-rose-600 dark:text-rose-400'
                : log.type === 'warning'
                ? 'text-amber-600 dark:text-amber-400'
                : log.type === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-600 dark:text-slate-400';

            return (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                <span className="text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className={colorClass}>
                  {log.database && (
                    <strong className="mr-1.5 text-slate-800 dark:text-slate-200">
                      [{log.database}]
                    </strong>
                  )}
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
