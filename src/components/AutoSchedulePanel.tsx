import React, { useState, useEffect } from 'react';
import {
  Clock,
  Calendar,
  Play,
  Save,
  CheckCircle2,
  AlertCircle,
  FileArchive,
  Download,
  Database,
  Info,
} from 'lucide-react';
import {
  BackupScheduleConfig,
  DatabaseItem,
  ScheduleDownloadMode,
  ScheduleFrequency,
} from '../types';
import {
  DAY_OF_WEEK_LABELS,
  computeNextScheduledRun,
  describeSchedule,
  formatCountdown,
} from '../utils/scheduleUtils';

interface AutoSchedulePanelProps {
  schedule: BackupScheduleConfig;
  databases: DatabaseItem[];
  isRunningBackup: boolean;
  inactivityTimeoutMinutes: number;
  onSaveSchedule: (updated: Partial<BackupScheduleConfig>) => Promise<{ ok: boolean; error?: string }>;
  onRunNow: (overrideConfig: BackupScheduleConfig) => Promise<void>;
}

export const AutoSchedulePanel: React.FC<AutoSchedulePanelProps> = ({
  schedule,
  databases,
  isRunningBackup,
  inactivityTimeoutMinutes,
  onSaveSchedule,
  onRunNow,
}) => {
  const [enabled, setEnabled] = useState<boolean>(schedule.enabled);
  const [frequency, setFrequency] = useState<ScheduleFrequency>(schedule.frequency);
  const [timeOfDay, setTimeOfDay] = useState<string>(schedule.timeOfDay);
  const [dayOfWeek, setDayOfWeek] = useState<number>(schedule.dayOfWeek);
  const [dayOfMonth, setDayOfMonth] = useState<number>(schedule.dayOfMonth);
  const [downloadMode, setDownloadMode] = useState<ScheduleDownloadMode>(schedule.downloadMode);
  const [useAllSelectedInQueue, setUseAllSelectedInQueue] = useState<boolean>(
    schedule.targetDatabases.length === 0
  );
  const [explicitDatabases, setExplicitDatabases] = useState<string[]>(schedule.targetDatabases);

  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [nowTick, setNowTick] = useState<Date>(() => new Date());

  // Sync local draft when server schedule updates
  useEffect(() => {
    setEnabled(schedule.enabled);
    setFrequency(schedule.frequency);
    setTimeOfDay(schedule.timeOfDay);
    setDayOfWeek(schedule.dayOfWeek);
    setDayOfMonth(schedule.dayOfMonth);
    setDownloadMode(schedule.downloadMode);
    setUseAllSelectedInQueue(schedule.targetDatabases.length === 0);
    setExplicitDatabases(schedule.targetDatabases);
  }, [schedule]);

  // Live 1-second clock for next-run countdown
  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const draftSchedule: BackupScheduleConfig = {
    ...schedule,
    enabled,
    frequency,
    timeOfDay,
    dayOfWeek,
    dayOfMonth,
    downloadMode,
    targetDatabases: useAllSelectedInQueue ? [] : explicitDatabases,
  };

  const nextRunDate = computeNextScheduledRun(draftSchedule, nowTick);
  const selectedQueueDbs = databases.filter((d) => d.selected).map((d) => d.name);
  const effectiveTargetCount = useAllSelectedInQueue
    ? selectedQueueDbs.length
    : explicitDatabases.length;

  const isDirty =
    enabled !== schedule.enabled ||
    frequency !== schedule.frequency ||
    timeOfDay !== schedule.timeOfDay ||
    dayOfWeek !== schedule.dayOfWeek ||
    dayOfMonth !== schedule.dayOfMonth ||
    downloadMode !== schedule.downloadMode ||
    JSON.stringify(useAllSelectedInQueue ? [] : explicitDatabases) !==
      JSON.stringify(schedule.targetDatabases);

  const toggleExplicitDb = (name: string) => {
    setExplicitDatabases((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!useAllSelectedInQueue && explicitDatabases.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Select at least one database or choose "Use selected databases in Queue".',
      });
      return;
    }

    setSaving(true);
    const res = await onSaveSchedule({
      enabled,
      frequency,
      timeOfDay,
      dayOfWeek,
      dayOfMonth,
      downloadMode,
      targetDatabases: useAllSelectedInQueue ? [] : explicitDatabases,
    });
    setSaving(false);

    if (res.ok) {
      setFeedback({
        type: 'success',
        text: enabled
          ? `Automatic schedule saved (${describeSchedule(draftSchedule)}).`
          : 'Automatic backup schedule saved (currently paused).',
      });
    } else {
      setFeedback({
        type: 'error',
        text: res.error || 'Failed to save schedule settings.',
      });
    }
  };

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Time';

  return (
    <div className="space-y-6">
      {/* Header & Live Status Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Automated Scheduler</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{localTz}</span>
              <span aria-hidden="true">·</span>
              <span className={enabled ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
                {enabled ? 'Active' : 'Paused'}
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Automatic Scheduled Backups &amp; Downloads
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure recurring hourly, daily, weekly, or monthly backups to execute and download automatically at your chosen time.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isRunningBackup || effectiveTargetCount === 0}
              onClick={() => onRunNow(draftSchedule)}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5 text-emerald-600" />
              <span>Run Scheduled Backup Now</span>
            </button>
          </div>
        </div>

        {/* Summary Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">Current Cadence</div>
            <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
              {enabled ? describeSchedule(draftSchedule) : 'Disabled'}
            </div>
          </div>

          <div>
            <div className="text-slate-500 dark:text-slate-400">Next Scheduled Download</div>
            <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {nextRunDate ? (
                <>
                  {nextRunDate.toLocaleString()} ·{' '}
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    in {formatCountdown(nextRunDate, nowTick)}
                  </span>
                </>
              ) : (
                'Enable schedule to activate timer'
              )}
            </div>
          </div>

          <div>
            <div className="text-slate-500 dark:text-slate-400">Last Automatic Run</div>
            <div className="mt-1 font-medium text-slate-800 dark:text-slate-200 tabular-nums">
              {schedule.lastRunAt ? (
                <span>
                  {new Date(schedule.lastRunAt).toLocaleString()} ·{' '}
                  <span
                    className={
                      schedule.lastRunStatus === 'failed'
                        ? 'text-rose-600 dark:text-rose-400'
                        : schedule.lastRunStatus === 'partial'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }
                  >
                    {schedule.lastRunStatus}
                  </span>
                </span>
              ) : (
                'No automatic runs yet'
              )}
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Configuration Form */}
      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Card: Frequency & Timing */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Schedule Frequency &amp; Timing
              </h3>
            </div>

            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {enabled ? 'Auto Backup Enabled' : 'Auto Backup Off'}
              </span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Frequency Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Backup Frequency
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {(
                [
                  { id: 'hourly', label: 'Hourly', sub: 'Every hour' },
                  { id: 'daily', label: 'Daily', sub: 'Once per day' },
                  { id: 'weekly', label: 'Weekly', sub: 'Pick weekday' },
                  { id: 'monthly', label: 'Monthly', sub: 'Pick day 1-28' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFrequency(item.id)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    frequency === item.id
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="text-xs font-semibold">{item.label}</div>
                  <div className="text-[11px] opacity-75 mt-0.5">{item.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Time & Day Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="schedule-time"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {frequency === 'hourly' ? 'Minute of Hour (uses :MM)' : 'Backup Start Time (Local)'}
              </label>
              <input
                id="schedule-time"
                type="time"
                required
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {frequency === 'weekly' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="schedule-dow"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Day of Week
                </label>
                <select
                  id="schedule-dow"
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  {DAY_OF_WEEK_LABELS.map((label, idx) => (
                    <option key={label} value={idx}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {frequency === 'monthly' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="schedule-dom"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Day of Month (1–28)
                </label>
                <select
                  id="schedule-dom"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(frequency === 'daily' || frequency === 'hourly') && (
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Recurrence Window
                </span>
                <div className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    {frequency === 'hourly'
                      ? `Triggers every hour at :${timeOfDay.split(':')[1] || '00'}`
                      : `Triggers every day at ${timeOfDay}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Download Delivery Mode */}
          <div className="space-y-2 pt-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Automatic Download Format
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDownloadMode('sequential')}
                className={`p-3 rounded-lg border text-left transition-colors flex items-start gap-2.5 ${
                  downloadMode === 'sequential'
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Download className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <div>
                  <div className="text-xs font-semibold">Sequential .sql Files (1-by-1)</div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    Downloads each database individually with queue delay.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDownloadMode('zip')}
                className={`p-3 rounded-lg border text-left transition-colors flex items-start gap-2.5 ${
                  downloadMode === 'zip'
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300'
                }`}
              >
                <FileArchive className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <div>
                  <div className="text-xs font-semibold">Combined .zip Bundle</div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    Single archive download (avoids multi-download prompts).
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {isDirty ? 'Unsaved changes' : 'Schedule synced with server'}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Schedule'}</span>
            </button>
          </div>
        </div>

        {/* Right Card: Target Databases & Session Info */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <Database className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Target Databases ({effectiveTargetCount})
              </h3>
            </div>

            <div className="space-y-2.5 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
                <input
                  type="radio"
                  name="target-scope"
                  checked={useAllSelectedInQueue}
                  onChange={() => setUseAllSelectedInQueue(true)}
                  className="mt-0.5 accent-emerald-600"
                />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    All currently selected databases in Queue ({selectedQueueDbs.length})
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Dynamically backs up whichever databases are checked in the Database Queue tab.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
                <input
                  type="radio"
                  name="target-scope"
                  checked={!useAllSelectedInQueue}
                  onChange={() => {
                    setUseAllSelectedInQueue(false);
                    if (explicitDatabases.length === 0 && selectedQueueDbs.length > 0) {
                      setExplicitDatabases(selectedQueueDbs);
                    }
                  }}
                  className="mt-0.5 accent-emerald-600"
                />
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    Specific databases only
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Lock the automatic backup to a fixed subset of databases.
                  </div>
                </div>
              </label>
            </div>

            {!useAllSelectedInQueue && (
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {databases.map((db) => (
                  <label
                    key={db.id}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={explicitDatabases.includes(db.name)}
                      onChange={() => toggleExplicitDb(db.name)}
                      className="accent-emerald-600 rounded"
                    />
                    <span className="font-mono text-slate-800 dark:text-slate-200">{db.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-2 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Info className="w-4 h-4 text-emerald-600" />
              <span>Automatic Download Requirements</span>
            </div>
            <ul className="space-y-1.5 list-disc pl-4 leading-relaxed">
              <li>
                Keep this console signed in and open so your browser can receive and save automatic downloads at the scheduled time.
              </li>
              <li>
                Your current idle session timeout is <strong className="tabular-nums">{inactivityTimeoutMinutes} minutes</strong> (configured via <code className="font-mono">SESSION_INACTIVITY_MINUTES</code>).
              </li>
              <li>
                {schedule.lastRunSummary
                  ? `Last run summary: ${schedule.lastRunSummary}`
                  : 'Use "Combined .zip Bundle" if your browser prompts before allowing multiple automatic file downloads.'}
              </li>
            </ul>
          </div>
        </div>
      </form>
    </div>
  );
};
