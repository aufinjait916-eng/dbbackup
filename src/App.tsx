import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Clock } from 'lucide-react';
import {
  DatabaseItem,
  ServerConfig,
  ConnectionTestResult,
  LogEntry,
  AuthFlowStatus,
  AuthUser,
  BackupScheduleConfig,
} from './types';
import { Header, AppTab } from './components/Header';
import { ServerEnvBanner } from './components/ServerEnvBanner';
import { DatabaseQueueTable } from './components/DatabaseQueueTable';
import { BatchProgressCard } from './components/BatchProgressCard';
import { SqlPreviewModal } from './components/SqlPreviewModal';
import { WorkflowDocsPanel } from './components/WorkflowDocsPanel';
import { LogDrawer } from './components/LogDrawer';
import { LoginDashboard } from './components/LoginDashboard';
import { UserManagementPanel } from './components/UserManagementPanel';
import { AuditLogPanel } from './components/AuditLogPanel';
import { AccountSecurityModal } from './components/AccountSecurityModal';
import { AutoSchedulePanel } from './components/AutoSchedulePanel';
import {
  triggerBrowserDownload,
  createZipBundle,
  generateClientSampleSql,
  formatBytes,
} from './utils/backupEngine';
import {
  apiFetch,
  setCsrfToken,
  registerSessionExpiredHandler,
} from './utils/apiClient';
import {
  computeNextScheduledRun,
  describeSchedule,
  formatCountdown,
  isScheduleDueNow,
} from './utils/scheduleUtils';

const INITIAL_DATABASES: DatabaseItem[] = [
  {
    id: 'db_1',
    name: 'nextcloud_db',
    selected: true,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'db_2',
    name: 'vaultwarden_db',
    selected: true,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'db_3',
    name: 'homeassistant_db',
    selected: true,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'db_4',
    name: 'immich_db',
    selected: true,
    status: 'idle',
    progress: 0,
  },
  {
    id: 'db_5',
    name: 'gitea_db',
    selected: true,
    status: 'idle',
    progress: 0,
  },
];

export default function App() {
  // Theme state
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        window.matchMedia('(prefers-color-scheme: dark)').matches ||
        document.documentElement.classList.contains('dark')
      );
    }
    return false;
  });

  // Authentication & MFA state
  const [authStatus, setAuthStatus] = useState<AuthFlowStatus>('LOADING');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [inactivityTimeoutMinutes, setInactivityTimeoutMinutes] = useState<number>(15);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<boolean>(false);
  const [showSecurityModal, setShowSecurityModal] = useState<boolean>(false);

  // Automatic Backup Schedule State
  const [backupSchedule, setBackupSchedule] = useState<BackupScheduleConfig>({
    enabled: false,
    frequency: 'daily',
    timeOfDay: '02:00',
    dayOfWeek: 0,
    dayOfMonth: 1,
    downloadMode: 'sequential',
    targetDatabases: [],
    lastRunAt: null,
    lastRunKey: null,
    lastRunStatus: null,
    lastRunSummary: null,
    updatedAt: null,
    updatedBy: null,
  });

  // Dashboard Navigation & Operational State
  const [activeTab, setActiveTab] = useState<AppTab>('backups');
  const [databases, setDatabases] = useState<DatabaseItem[]>(INITIAL_DATABASES);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(false);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [simulationMode, setSimulationMode] = useState<boolean>(false);

  // Batch Execution State
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [activeDbId, setActiveDbId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [delayMs, setDelayMs] = useState<number>(1200);

  // Modals & Logs
  const [previewDb, setPreviewDb] = useState<DatabaseItem | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'init_1',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'TrueNAS PostgreSQL Backup Manager ready. Discover databases from server or add manually.',
    },
  ]);

  const pauseRef = useRef<boolean>(false);
  const stopRef = useRef<boolean>(false);
  const scheduledRunningRef = useRef<boolean>(false);

  // Sync dark class on <html>
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const toggleDark = () => {
    setIsDark((prev) => !prev);
  };

  const addLog = useCallback(
    (type: LogEntry['type'], message: string, database?: string) => {
      setLogs((prev) => [
        {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          timestamp: new Date().toISOString(),
          type,
          message,
          database,
        },
        ...prev.slice(0, 99),
      ]);
    },
    []
  );

  // Handle session expiration cleanly
  const handleSessionExpired = useCallback(async () => {
    stopRef.current = true;
    setIsBatchRunning(false);
    setActiveDbId(null);
    setShowSecurityModal(false);
    setPreviewDb(null);
    setCurrentUser(null);
    setServerConfig(null);
    setSessionExpiredNotice(true);
    setAuthStatus('UNAUTHENTICATED');

    try {
      const res = await fetch('/api/auth/csrf', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCsrfToken(data.csrfToken || '');
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    registerSessionExpiredHandler(handleSessionExpired);
  }, [handleSessionExpired]);

  // Check current session status on mount
  const checkAuthSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      setCsrfToken(data.csrfToken || '');
      if (data.inactivityTimeoutMinutes) {
        setInactivityTimeoutMinutes(data.inactivityTimeoutMinutes);
      }

      if (data.authenticated && data.user) {
        setCurrentUser(data.user);
        setAuthStatus('AUTHENTICATED');
      } else if (data.status === 'MFA_SETUP_REQUIRED' || data.status === 'MFA_REQUIRED') {
        setCurrentUser(data.user || null);
        setAuthStatus(data.status);
      } else {
        setCurrentUser(null);
        setAuthStatus('UNAUTHENTICATED');
      }
    } catch {
      setAuthStatus('UNAUTHENTICATED');
    }
  }, []);

  useEffect(() => {
    checkAuthSession();
  }, [checkAuthSession]);

  // Client-side inactivity auto-lock synced with server timeout
  useEffect(() => {
    if (authStatus !== 'AUTHENTICATED') return;

    let idleTimer: ReturnType<typeof setTimeout>;
    const timeoutMs = inactivityTimeoutMinutes * 60 * 1000;

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        apiFetch('/api/auth/logout', { method: 'POST' }).finally(() => {
          handleSessionExpired();
        });
      }, timeoutMs);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [authStatus, inactivityTimeoutMinutes, handleSessionExpired]);

  // Fetch Server Configuration & Backup Schedule ONLY after full authentication
  const fetchConfig = useCallback(async () => {
    if (authStatus !== 'AUTHENTICATED') return;
    setLoadingConfig(true);
    try {
      const res = await apiFetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setServerConfig(data);
        addLog(
          'info',
          `Server environment detected: ${data.host}:${data.port}`
        );
      }
    } catch {
      addLog('warning', 'Unable to reach /api/config endpoint.');
    } finally {
      setLoadingConfig(false);
    }
  }, [authStatus, addLog]);

  const fetchSchedule = useCallback(async () => {
    if (authStatus !== 'AUTHENTICATED') return;
    try {
      const res = await apiFetch('/api/schedule');
      if (res.ok) {
        const data = await res.json();
        if (data.schedule) {
          setBackupSchedule(data.schedule);
        }
      }
    } catch {
      // ignore transient error
    }
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === 'AUTHENTICATED') {
      fetchConfig();
      fetchSchedule();
    }
  }, [authStatus, fetchConfig, fetchSchedule]);

  // Enforce RBAC on activeTab if user role is Manager
  useEffect(() => {
    if (
      currentUser?.role === 'Manager' &&
      ['users', 'audit', 'deployment', 'server'].includes(activeTab)
    ) {
      setActiveTab('backups');
    }
  }, [currentUser, activeTab]);

  // Logout action
  const handleLogout = async () => {
    stopRef.current = true;
    setIsBatchRunning(false);
    setActiveDbId(null);
    setShowSecurityModal(false);
    setPreviewDb(null);

    try {
      const res = await apiFetch('/api/auth/logout', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setCsrfToken(data.csrfToken || '');
    } catch {
      setCsrfToken('');
    }

    setCurrentUser(null);
    setServerConfig(null);
    setSessionExpiredNotice(false);
    setActiveTab('backups');
    setAuthStatus('UNAUTHENTICATED');
  };

  // Test Server Connection
  const handleTestConnection = async (): Promise<ConnectionTestResult> => {
    addLog('info', 'Testing connection to PostgreSQL server...');
    if (simulationMode) {
      await new Promise((r) => setTimeout(r, 600));
      const mockResult: ConnectionTestResult = {
        success: true,
        message: 'Successfully connected in Sandbox / Demo mode',
        version: 'PostgreSQL 16.4 (Debian 16.4-1.pgdg120+1) on x86_64-pc-linux-gnu (TrueNAS SCALE App)',
        currentDatabase: 'postgres',
        currentUser: serverConfig?.user || 'postgres',
        latencyMs: 14,
      };
      addLog('success', 'Connection test succeeded: PostgreSQL 16.4 (Demo Mode)');
      return mockResult;
    }

    try {
      const res = await apiFetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        addLog('success', `Connection test passed (${data.latencyMs}ms): ${data.version}`);
      } else {
        addLog('error', `Connection test failed: ${data.message || data.error}`);
      }
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', `Connection test network failure: ${msg}`);
      return {
        success: false,
        message: msg,
        hint: 'Verify server is running and port 5432 is accessible from this applet.',
      };
    }
  };

  // Discover databases from server catalog
  const handleDiscoverDatabases = async () => {
    setDiscovering(true);
    addLog('info', 'Querying PostgreSQL server for existing databases...');

    if (simulationMode) {
      await new Promise((r) => setTimeout(r, 700));
      const sampleNames = [
        'nextcloud_db',
        'vaultwarden_db',
        'homeassistant_db',
        'immich_db',
        'gitea_db',
        'authentik_db',
        'paperless_db',
        'grafana_db',
      ];
      const newItems: DatabaseItem[] = sampleNames.map((name, i) => ({
        id: `discovered_${Date.now()}_${i}`,
        name,
        selected: true,
        status: 'idle',
        progress: 0,
      }));
      setDatabases(newItems);
      setDiscovering(false);
      addLog('success', `Discovered ${newItems.length} databases from PostgreSQL catalog (Demo Mode)`);
      setActiveTab('backups');
      return;
    }

    try {
      const res = await apiFetch('/api/databases');
      const data = await res.json();
      if (data.success && Array.isArray(data.databases)) {
        const discovered = data.databases.map(
          (db: { name: string; size_bytes?: number }, i: number) => ({
            id: `db_${Date.now()}_${i}`,
            name: db.name,
            selected: true,
            status: 'idle' as const,
            progress: 0,
            sizeBytes: db.size_bytes,
            sizePretty: db.size_bytes ? formatBytes(db.size_bytes) : undefined,
          })
        );
        setDatabases(discovered);
        addLog('success', `Discovered ${discovered.length} databases from PostgreSQL catalog`);
        setActiveTab('backups');
      } else {
        addLog('error', `Database discovery error: ${data.message || data.error || 'Unknown response'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', `Discovery request failed: ${msg}. Try enabling Demo / Sandbox Mode.`);
    } finally {
      setDiscovering(false);
    }
  };

  // Database queue item operations
  const handleToggleSelect = (id: string) => {
    setDatabases((prev) =>
      prev.map((db) => (db.id === id ? { ...db, selected: !db.selected } : db))
    );
  };

  const handleToggleSelectAll = (select: boolean) => {
    setDatabases((prev) => prev.map((db) => ({ ...db, selected: select })));
  };

  const handleRemove = (id: string) => {
    setDatabases((prev) => prev.filter((db) => db.id !== id));
  };

  const handleClearAll = () => {
    setDatabases([]);
    addLog('info', 'Cleared all databases from queue');
  };

  const handleAddDatabase = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newItem: DatabaseItem = {
      id: `db_manual_${Date.now()}`,
      name: trimmed,
      selected: true,
      status: 'idle',
      progress: 0,
    };
    setDatabases((prev) => [...prev, newItem]);
    addLog('info', `Added database '${trimmed}' to queue`);
  };

  // Core Backup Execution for a Single Database
  const executeDatabaseBackup = async (
    targetDb: DatabaseItem,
    skipBrowserDownload = false
  ): Promise<{ success: boolean; sql?: string; sizeBytes?: number; error?: string }> => {
    const startTime = Date.now();

    setDatabases((prev) =>
      prev.map((d) => (d.id === targetDb.id ? { ...d, status: 'connecting', progress: 20 } : d))
    );
    addLog('info', `Connecting to PostgreSQL and preparing backup...`, targetDb.name);

    await new Promise((r) => setTimeout(r, 200));

    setDatabases((prev) =>
      prev.map((d) => (d.id === targetDb.id ? { ...d, status: 'dumping', progress: 50 } : d))
    );
    addLog('info', `Exporting schema, constraints, sequences, and tables...`, targetDb.name);

    let sqlContent = '';
    let sizeBytes = 0;

    try {
      if (simulationMode) {
        // Call server in simulation mode so the action is properly audited & authenticated
        const res = await apiFetch(`/api/backup/${encodeURIComponent(targetDb.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simulation: true }),
        });

        if (res.ok) {
          sqlContent = await res.text();
        } else {
          sqlContent = generateClientSampleSql(targetDb.name);
        }
        sizeBytes = new Blob([sqlContent]).size;
      } else {
        const res = await apiFetch(`/api/backup/${encodeURIComponent(targetDb.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simulation: false }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server returned status ${res.status}`);
        }

        sqlContent = await res.text();
        sizeBytes = new Blob([sqlContent]).size;
      }

      const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${targetDb.name}_backup_${timestampStr}.sql`;

      if (!skipBrowserDownload) {
        setDatabases((prev) =>
          prev.map((d) => (d.id === targetDb.id ? { ...d, status: 'downloading', progress: 85 } : d))
        );
        addLog(
          'info',
          `Dumping completed (${formatBytes(sizeBytes)}). Triggering browser download...`,
          targetDb.name
        );

        const blob = new Blob([sqlContent], { type: 'application/sql' });
        triggerBrowserDownload(blob, filename);
      }

      const durationMs = Date.now() - startTime;

      setDatabases((prev) =>
        prev.map((d) =>
          d.id === targetDb.id
            ? {
                ...d,
                status: 'completed',
                progress: 100,
                sizeBytes,
                sizePretty: formatBytes(sizeBytes),
                durationMs,
                sqlContent,
                lastBackupAt: new Date().toISOString(),
                error: undefined,
              }
            : d
        )
      );

      addLog(
        'success',
        `Successfully downloaded backup '${filename}' (${formatBytes(sizeBytes)} in ${(durationMs / 1000).toFixed(1)}s)`,
        targetDb.name
      );

      return { success: true, sql: sqlContent, sizeBytes };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setDatabases((prev) =>
        prev.map((d) =>
          d.id === targetDb.id
            ? {
                ...d,
                status: 'failed',
                progress: 0,
                error: errMsg,
              }
            : d
        )
      );
      addLog('error', `Backup failed: ${errMsg}`, targetDb.name);
      return { success: false, error: errMsg };
    }
  };

  const handleBackupSingle = async (id: string) => {
    const target = databases.find((d) => d.id === id);
    if (!target || isBatchRunning) return;

    setActiveDbId(id);
    await executeDatabaseBackup(target);
    setActiveDbId(null);
  };

  const handleStartBatchBackup = async () => {
    const targets = databases.filter((d) => d.selected);
    if (targets.length === 0 || isBatchRunning) return;

    setActiveTab('backups');
    setIsBatchRunning(true);
    setIsPaused(false);
    pauseRef.current = false;
    stopRef.current = false;

    setDatabases((prev) =>
      prev.map((d) => (d.selected ? { ...d, status: 'queued', progress: 0, error: undefined } : d))
    );

    addLog(
      'info',
      `Starting sequential backup batch for ${targets.length} selected databases with ${delayMs}ms spacing...`
    );

    let completed = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) {
        addLog('warning', 'Batch backup aborted by user');
        break;
      }

      while (pauseRef.current && !stopRef.current) {
        await new Promise((r) => setTimeout(r, 400));
      }

      if (stopRef.current) break;

      const currentDb = targets[i];
      setCurrentIndex(i);
      setActiveDbId(currentDb.id);

      const result = await executeDatabaseBackup(currentDb);
      if (result.success) {
        completed++;
      } else {
        failed++;
      }

      if (i < targets.length - 1 && !stopRef.current) {
        addLog(
          'info',
          `Waiting ${(delayMs / 1000).toFixed(1)}s before starting next database backup...`,
          currentDb.name
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setIsBatchRunning(false);
    setActiveDbId(null);
    stopRef.current = false;

    addLog(
      'success',
      `Batch sequence finished: ${completed} databases backed up and downloaded successfully (${failed} failed)`
    );
  };

  const handlePauseToggle = () => {
    setIsPaused((prev) => {
      const next = !prev;
      pauseRef.current = next;
      addLog('info', next ? 'Batch backup paused' : 'Batch backup resumed');
      return next;
    });
  };

  const handleStopBatch = () => {
    stopRef.current = true;
    setIsBatchRunning(false);
    setActiveDbId(null);
    addLog('warning', 'Stopping batch backup process...');
  };

  const handleDownloadZip = async () => {
    const completedDbs = databases.filter((d) => d.status === 'completed' && d.sqlContent);
    if (completedDbs.length === 0) {
      addLog('warning', 'No completed database backups available to bundle into ZIP');
      return;
    }

    addLog('info', `Creating ZIP archive containing ${completedDbs.length} database backups...`);
    try {
      const zipBlob = await createZipBundle(completedDbs);
      const zipFilename = `truenas_postgres_backups_${new Date().toISOString().slice(0, 10)}.zip`;
      triggerBrowserDownload(zipBlob, zipFilename);

      // Record ZIP download in audit log
      await apiFetch('/api/audit/zip-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databases: completedDbs.map((d) => d.name) }),
      }).catch(() => {});

      addLog('success', `Downloaded all-in-one backup archive: ${zipFilename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', `Failed to generate ZIP archive: ${msg}`);
    }
  };

  // Save Automatic Backup Schedule
  const handleSaveSchedule = async (
    updated: Partial<BackupScheduleConfig>
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await apiFetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to update schedule.' };
      }
      setBackupSchedule(data.schedule);
      addLog(
        'info',
        data.schedule.enabled
          ? `Saved automatic backup schedule: ${describeSchedule(data.schedule)} (${data.schedule.downloadMode})`
          : 'Automatic backup schedule paused.'
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Network error saving schedule.',
      };
    }
  };

  // Execute a Scheduled Backup Batch & Automatic Download
  const runScheduledBackup = useCallback(
    async (configToRun: BackupScheduleConfig, slotKey?: string) => {
      if (scheduledRunningRef.current || isBatchRunning) return;

      const targetNames =
        configToRun.targetDatabases.length > 0
          ? configToRun.targetDatabases
          : databases.filter((d) => d.selected).map((d) => d.name);

      if (targetNames.length === 0) {
        addLog('warning', 'Scheduled backup skipped: no target databases selected.');
        return;
      }

      scheduledRunningRef.current = true;
      if (slotKey) {
        setBackupSchedule((prev) => ({ ...prev, lastRunKey: slotKey }));
      }

      const targets: DatabaseItem[] = targetNames.map((name, idx) => {
        const existing = databases.find((d) => d.name === name);
        return (
          existing || {
            id: `sched_${Date.now()}_${idx}`,
            name,
            selected: true,
            status: 'idle',
            progress: 0,
          }
        );
      });

      setIsBatchRunning(true);
      setIsPaused(false);
      pauseRef.current = false;
      stopRef.current = false;

      const targetNameSet = new Set(targetNames);
      setDatabases((prev) =>
        prev.map((d) =>
          targetNameSet.has(d.name) ? { ...d, status: 'queued', progress: 0, error: undefined } : d
        )
      );

      addLog(
        'info',
        `Automatic ${configToRun.frequency} backup started for ${targets.length} database(s) [${configToRun.downloadMode} mode]...`
      );

      let completed = 0;
      let failed = 0;
      const completedPayloads: DatabaseItem[] = [];
      const skipPerFileDownload = configToRun.downloadMode === 'zip';

      for (let i = 0; i < targets.length; i++) {
        if (stopRef.current) break;
        const currentDb = targets[i];
        setCurrentIndex(i);
        setActiveDbId(currentDb.id);

        const result = await executeDatabaseBackup(currentDb, skipPerFileDownload);
        if (result.success && result.sql) {
          completed++;
          completedPayloads.push({
            ...currentDb,
            status: 'completed',
            progress: 100,
            sqlContent: result.sql,
            sizeBytes: result.sizeBytes,
          });
        } else {
          failed++;
        }

        if (i < targets.length - 1 && !stopRef.current && !skipPerFileDownload) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (skipPerFileDownload && completedPayloads.length > 0 && !stopRef.current) {
        try {
          const zipBlob = await createZipBundle(completedPayloads);
          const zipFilename = `truenas_auto_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
          triggerBrowserDownload(zipBlob, zipFilename);
          await apiFetch('/api/audit/zip-download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ databases: completedPayloads.map((d) => d.name) }),
          }).catch(() => {});
          addLog('success', `Automatic ZIP bundle downloaded: ${zipFilename}`);
        } catch (err) {
          addLog(
            'error',
            `Automatic ZIP generation failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      setIsBatchRunning(false);
      setActiveDbId(null);
      stopRef.current = false;
      scheduledRunningRef.current = false;

      const runStatus: 'success' | 'partial' | 'failed' =
        completed === targets.length ? 'success' : completed > 0 ? 'partial' : 'failed';
      const summary = `Auto ${configToRun.frequency} backup (${configToRun.downloadMode}): ${completed}/${targets.length} succeeded (${failed} failed).`;
      addLog(runStatus === 'failed' ? 'error' : 'success', summary);

      try {
        const recRes = await apiFetch('/api/schedule/run-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runKey: slotKey, status: runStatus, summary }),
        });
        if (recRes.ok) {
          const recData = await recRes.json();
          if (recData.schedule) {
            setBackupSchedule(recData.schedule);
          }
        }
      } catch {
        // ignore telemetry persistence error
      }
    },
    [databases, delayMs, isBatchRunning, addLog]
  );

  // Background 15s Scheduler Loop (while console is authenticated & active)
  useEffect(() => {
    if (authStatus !== 'AUTHENTICATED' || !backupSchedule.enabled) return;

    const checkAndRun = () => {
      if (scheduledRunningRef.current || isBatchRunning) return;
      const { due, slotKey } = isScheduleDueNow(backupSchedule, new Date());
      if (due) {
        runScheduledBackup(backupSchedule, slotKey);
      }
    };

    const timer = setInterval(checkAndRun, 15000);
    return () => clearInterval(timer);
  }, [authStatus, backupSchedule, isBatchRunning, runScheduledBackup]);

  // Auth loading state
  if (authStatus === 'LOADING') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 flex items-center justify-center font-sans">
        <div className="flex items-center gap-2.5 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
          <span>Verifying session security...</span>
        </div>
      </div>
    );
  }

  // Lock all dashboard pages behind Login & Mandatory MFA
  if (authStatus !== 'AUTHENTICATED' || !currentUser) {
    return (
      <LoginDashboard
        status={authStatus}
        pendingUser={currentUser}
        sessionExpiredNotice={sessionExpiredNotice}
        inactivityTimeoutMinutes={inactivityTimeoutMinutes}
        isDark={isDark}
        toggleDark={toggleDark}
        onStepChange={(nextStatus, user, csrf) => {
          setCsrfToken(csrf);
          setCurrentUser(user);
          setSessionExpiredNotice(false);
          setAuthStatus(nextStatus);
        }}
        onAuthSuccess={(user, csrf) => {
          setCsrfToken(csrf);
          setCurrentUser(user);
          setSessionExpiredNotice(false);
          setActiveTab('backups');
          setAuthStatus('AUTHENTICATED');
          addLog('success', `Authenticated as '${user.username}' (${user.role}) with TOTP MFA.`);
        }}
      />
    );
  }

  const isIT = currentUser.role === 'IT';
  const selectedCount = databases.filter((d) => d.selected).length;
  const completedCount = databases.filter((d) => d.status === 'completed').length;
  const failedCount = databases.filter((d) => d.status === 'failed').length;
  const currentDbItem = activeDbId ? databases.find((d) => d.id === activeDbId) : null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-300">
      {/* Protected 3-Zone Top Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDark={isDark}
        toggleDark={toggleDark}
        onPrimaryAction={handleStartBatchBackup}
        isBackingUp={isBatchRunning}
        selectedCount={selectedCount}
        currentUser={currentUser}
        onOpenSecurityModal={() => setShowSecurityModal(true)}
        onLogout={handleLogout}
      />

      {/* Responsive Mobile Tab Switcher */}
      <div className="lg:hidden border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 flex items-center gap-2 overflow-x-auto text-xs font-medium">
        <button
          onClick={() => setActiveTab('backups')}
          className={`px-3 py-1.5 rounded-md whitespace-nowrap ${
            activeTab === 'backups'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Database Queue
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-3 py-1.5 rounded-md whitespace-nowrap ${
            activeTab === 'schedule'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Auto Schedule
        </button>
        {isIT && (
          <>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-md whitespace-nowrap ${
                activeTab === 'users'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              User Management
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-md whitespace-nowrap ${
                activeTab === 'audit'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Audit Log
            </button>
            <button
              onClick={() => setActiveTab('deployment')}
              className={`px-3 py-1.5 rounded-md whitespace-nowrap ${
                activeTab === 'deployment'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Deployment
            </button>
          </>
        )}
      </div>

      {/* Main Protected Workspace Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Tab Content: Backups Queue (IT & Manager) */}
        {activeTab === 'backups' && (
          <div className="space-y-6">
            <ServerEnvBanner
              config={serverConfig}
              loadingConfig={loadingConfig}
              onRefreshConfig={fetchConfig}
              onTestConnection={handleTestConnection}
              onDiscoverDatabases={handleDiscoverDatabases}
              discovering={discovering}
              simulationMode={simulationMode}
              setSimulationMode={setSimulationMode}
            />

            {/* Compact Auto-Backup Schedule Strip */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 text-slate-600 dark:text-slate-300">
                <Clock className={`w-4 h-4 shrink-0 ${backupSchedule.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`} />
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Automatic Backup:
                  </span>{' '}
                  {backupSchedule.enabled ? (
                    <>
                      <span>{describeSchedule(backupSchedule)}</span>
                      <span className="mx-1.5">·</span>
                      <span className="font-mono uppercase">{backupSchedule.downloadMode}</span>
                      {(() => {
                        const nextRun = computeNextScheduledRun(backupSchedule);
                        return nextRun ? (
                          <>
                            <span className="mx-1.5">·</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                              Next in {formatCountdown(nextRun)}
                            </span>
                          </>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">
                      Not scheduled (manual trigger only)
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline self-start sm:self-auto"
              >
                {backupSchedule.enabled ? 'Edit Auto Schedule' : 'Configure Daily / Weekly Schedule'}
              </button>
            </div>

            {(isBatchRunning || completedCount > 0) && (
              <BatchProgressCard
                isBatchRunning={isBatchRunning}
                isPaused={isPaused}
                onPauseToggle={handlePauseToggle}
                onStopBatch={handleStopBatch}
                onDownloadZip={handleDownloadZip}
                currentDbName={currentDbItem?.name || null}
                currentIndex={currentIndex}
                totalCount={selectedCount}
                completedCount={completedCount}
                failedCount={failedCount}
                delayMs={delayMs}
                setDelayMs={setDelayMs}
                hasCompletedBackups={completedCount > 0}
              />
            )}

            <DatabaseQueueTable
              databases={databases}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onRemove={handleRemove}
              onClearAll={handleClearAll}
              onAddDatabase={handleAddDatabase}
              onBackupSingle={handleBackupSingle}
              onPreviewSql={(db) => setPreviewDb(db)}
              isBatchRunning={isBatchRunning}
              activeDbId={activeDbId}
            />

            <LogDrawer logs={logs} onClearLogs={() => setLogs([])} />
          </div>
        )}

        {/* Tab Content: Automatic Schedule (IT & Manager) */}
        {activeTab === 'schedule' && (
          <AutoSchedulePanel
            schedule={backupSchedule}
            databases={databases}
            isRunningBackup={isBatchRunning}
            inactivityTimeoutMinutes={inactivityTimeoutMinutes}
            onSaveSchedule={handleSaveSchedule}
            onRunNow={(cfg) => runScheduledBackup(cfg)}
          />
        )}

        {/* Tab Content: User Management (IT Full Admin Only) */}
        {activeTab === 'users' && isIT && (
          <UserManagementPanel currentUser={currentUser} />
        )}

        {/* Tab Content: Audit Log (IT Full Admin Only) */}
        {activeTab === 'audit' && isIT && <AuditLogPanel />}

        {/* Tab Content: Deployment & TrueNAS Environment (IT Full Admin Only) */}
        {(activeTab === 'deployment' || activeTab === 'server') && isIT && (
          <WorkflowDocsPanel />
        )}
      </main>

      {/* SQL Preview Modal */}
      {previewDb && (
        <SqlPreviewModal
          database={previewDb}
          onClose={() => setPreviewDb(null)}
        />
      )}

      {/* Self-Service Account & Session Security Modal */}
      {showSecurityModal && (
        <AccountSecurityModal
          user={currentUser}
          inactivityTimeoutMinutes={inactivityTimeoutMinutes}
          onClose={() => setShowSecurityModal(false)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-4 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
        <span>TrueNAS PostgreSQL Backup Manager</span>
        <span className="mx-2">·</span>
        <span>Signed in as {currentUser.username} ({currentUser.role})</span>
        <span className="mx-2">·</span>
        <span className="tabular-nums">Idle Timeout: {inactivityTimeoutMinutes}m</span>
      </footer>
    </div>
  );
}
