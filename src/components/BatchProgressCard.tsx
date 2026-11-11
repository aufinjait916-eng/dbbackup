import React from 'react';
import {
  Loader2,
  CheckCircle2,
  Pause,
  Play,
  Square,
  Archive,
  Info,
  Sliders,
} from 'lucide-react';

interface BatchProgressCardProps {
  isBatchRunning: boolean;
  isPaused: boolean;
  onPauseToggle: () => void;
  onStopBatch: () => void;
  onDownloadZip: () => void;
  currentDbName: string | null;
  currentIndex: number;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  delayMs: number;
  setDelayMs: (ms: number) => void;
  hasCompletedBackups: boolean;
}

export const BatchProgressCard: React.FC<BatchProgressCardProps> = ({
  isBatchRunning,
  isPaused,
  onPauseToggle,
  onStopBatch,
  onDownloadZip,
  currentDbName,
  currentIndex,
  totalCount,
  completedCount,
  failedCount,
  delayMs,
  setDelayMs,
  hasCompletedBackups,
}) => {
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isBatchRunning ? (
            <Loader2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          )}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isBatchRunning
                ? isPaused
                  ? 'Batch Backup Paused'
                  : 'Sequential Backup & Download in Progress'
                : 'Batch Backup Status'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isBatchRunning && currentDbName ? (
                <span>
                  Processing database <strong className="font-mono text-slate-700 dark:text-slate-300">{currentDbName}</strong> ({currentIndex + 1} of {totalCount})
                </span>
              ) : (
                <span>{completedCount} of {totalCount} completed {failedCount > 0 ? `· ${failedCount} failed` : ''}</span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {isBatchRunning && (
            <>
              <button
                onClick={onPauseToggle}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                onClick={onStopBatch}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center gap-1.5"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </>
          )}

          {hasCompletedBackups && (
            <button
              onClick={onDownloadZip}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-1.5"
              title="Download all generated SQL backups bundled into one ZIP file"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Download All as ZIP</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Progress</span>
          <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 font-semibold">
            {percent}% ({completedCount}/{totalCount})
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Throttling Delay + Browser Multi-download tip */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>
            Downloads trigger sequentially one by one. If your browser asks permission for multiple downloads, choose <strong>Allow</strong>.
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Sliders className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-500 dark:text-slate-400">Download spacing:</span>
          <select
            value={delayMs}
            onChange={(e) => setDelayMs(Number(e.target.value))}
            className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono"
          >
            <option value={800}>0.8s (Fast)</option>
            <option value={1200}>1.2s (Standard)</option>
            <option value={2000}>2.0s (Polite)</option>
            <option value={3000}>3.0s (Relaxed)</option>
          </select>
        </div>
      </div>
    </div>
  );
};
