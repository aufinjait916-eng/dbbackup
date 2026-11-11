import React, { useState } from 'react';
import { X, Copy, Check, Download, FileText } from 'lucide-react';
import { DatabaseItem } from '../types';
import { triggerBrowserDownload } from '../utils/backupEngine';

interface SqlPreviewModalProps {
  database: DatabaseItem | null;
  onClose: () => void;
}

export const SqlPreviewModal: React.FC<SqlPreviewModalProps> = ({
  database,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!database) return null;

  const content = database.sqlContent || '-- No SQL content available';

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'application/sql' });
    const filename = `${database.name}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    triggerBrowserDownload(blob, filename);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                SQL Backup Preview: <span className="font-mono text-emerald-600 dark:text-emerald-400">{database.name}</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Size: {database.sizePretty || '—'} · Generated: {database.lastBackupAt ? new Date(database.lastBackupAt).toLocaleTimeString() : 'Recent'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy SQL'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 font-mono text-xs bg-slate-950 text-slate-200 whitespace-pre-wrap leading-relaxed select-text">
          {content}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>To restore: <code className="text-emerald-600 dark:text-emerald-400">psql -h $POSTGRES_HOST -U $POSTGRES_USER -d {database.name} &lt; backup.sql</code></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
