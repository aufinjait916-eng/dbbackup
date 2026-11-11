import { useState, useEffect, useRef, useCallback } from 'react';
import { DatabaseItem, ServerConfig, ConnectionTestResult, LogEntry } from './types';
import { Header } from './components/Header';
import { ServerEnvBanner } from './components/ServerEnvBanner';
import { DatabaseQueueTable } from './components/DatabaseQueueTable';
import { BatchProgressCard } from './components/BatchProgressCard';
import { SqlPreviewModal } from './components/SqlPreviewModal';
import { WorkflowDocsPanel } from './components/WorkflowDocsPanel';
import { LogDrawer } from './components/LogDrawer';
import {
  triggerBrowserDownload,
  createZipBundle,
  generateClientSampleSql,
  formatBytes,
} from './utils/backupEngine';

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
  const [activeTab, setActiveTab] = useState<'backups' | 'server' | 'deployment'>('backups');
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        window.matchMedia('(prefers-color-scheme: dark)').matches ||
        document.documentElement.classList.contains('dark')
      );
    }
    return false;
  });

  const [databases, setDatabases] = useState<DatabaseItem[]>(INITIAL_DATABASES);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);
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
      message: 'TrueNAS PostgreSQL Backup Manager ready. Load databases from JSON or discover from server.',
    },
  ]);

  const pauseRef = useRef<boolean>(false);
  const stopRef = useRef<boolean>(false);

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
        ...prev.slice(0, 99), // keep latest 100
      ]);
    },
    []
  );

  // Fetch Server Configuration on mount
  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setServerConfig(data);
        addLog(
          'info',
          `Server environment detected: ${data.host}:${data.port} (${data.detectedEnvKeys?.length || 0} env variables found)`
        );
      }
    } catch {
      // If running client-only (e.g. static GitHub Pages), default to simulation mode
      setSimulationMode(true);
      setServerConfig({
        configured: false,
        host: 'truenas.local',
        port: 5432,
        user: 'postgres',
        defaultDb: 'postgres',
        sslEnabled: false,
        hasPassword: true,
        detectedEnvKeys: ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD'],
        truenasPlatform: true,
      });
      addLog(
        'warning',
        'Backend server not reachable directly (running in browser / static mode). Demo / Sandbox mode activated.'
      );
    } finally {
      setLoadingConfig(false);
    }
  }, [addLog]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

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
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        addLog('success', `Connection test passed (${data.latencyMs}ms): ${data.version}`);
      } else {
        addLog('error', `Connection test failed: ${data.message}`);
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
      const res = await fetch('/api/databases');
      const data = await res.json();
      if (data.success && Array.isArray(data.databases)) {
        const discovered = data.databases.map((db: { name: string; size_bytes?: number }, i: number) => ({
          id: `db_${Date.now()}_${i}`,
          name: db.name,
          selected: true,
          status: 'idle' as const,
          progress: 0,
          sizeBytes: db.size_bytes,
          sizePretty: db.size_bytes ? formatBytes(db.size_bytes) : undefined,
        }));
        setDatabases(discovered);
        addLog('success', `Discovered ${discovered.length} databases from PostgreSQL catalog`);
        setActiveTab('backups');
      } else {
        addLog('error', `Database discovery error: ${data.message || 'Unknown response'}`);
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
    targetDb: DatabaseItem
  ): Promise<{ success: boolean; sql?: string; sizeBytes?: number; error?: string }> => {
    const startTime = Date.now();

    // 1. Connecting state
    setDatabases((prev) =>
      prev.map((d) => (d.id === targetDb.id ? { ...d, status: 'connecting', progress: 20 } : d))
    );
    addLog('info', `Connecting to PostgreSQL and preparing backup...`, targetDb.name);

    await new Promise((r) => setTimeout(r, 200));

    // 2. Dumping state
    setDatabases((prev) =>
      prev.map((d) => (d.id === targetDb.id ? { ...d, status: 'dumping', progress: 50 } : d))
    );
    addLog('info', `Exporting schema, constraints, sequences, and tables...`, targetDb.name);

    let sqlContent = '';
    let sizeBytes = 0;

    try {
      if (simulationMode) {
        await new Promise((r) => setTimeout(r, 500));
        sqlContent = generateClientSampleSql(targetDb.name);
        sizeBytes = new Blob([sqlContent]).size;
      } else {
        const res = await fetch(`/api/backup/${encodeURIComponent(targetDb.name)}`, {
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

      // 3. Trigger browser download
      setDatabases((prev) =>
        prev.map((d) => (d.id === targetDb.id ? { ...d, status: 'downloading', progress: 85 } : d))
      );
      addLog('info', `Dumping completed (${formatBytes(sizeBytes)}). Triggering browser download...`, targetDb.name);

      const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${targetDb.name}_backup_${timestampStr}.sql`;
      const blob = new Blob([sqlContent], { type: 'application/sql' });
      triggerBrowserDownload(blob, filename);

      const durationMs = Date.now() - startTime;

      // 4. Completed state
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

  // Backup a single database on user button click
  const handleBackupSingle = async (id: string) => {
    const target = databases.find((d) => d.id === id);
    if (!target || isBatchRunning) return;

    setActiveDbId(id);
    await executeDatabaseBackup(target);
    setActiveDbId(null);
  };

  // Start Batch Sequential Backup & Download
  const handleStartBatchBackup = async () => {
    const targets = databases.filter((d) => d.selected);
    if (targets.length === 0 || isBatchRunning) return;

    setIsBatchRunning(true);
    setIsPaused(false);
    pauseRef.current = false;
    stopRef.current = false;

    // Reset status of selected targets to queued
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

      // Check pause
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

      // Polite throttling delay between sequential downloads
      if (i < targets.length - 1 && !stopRef.current) {
        addLog(
          'info',
          `Waiting ${(delayMs / 1000).toFixed(1)}s before starting next database backup to ensure browser download acceptance...`,
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

  // Download all completed backups as a ZIP bundle
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
      addLog('success', `Downloaded all-in-one backup archive: ${zipFilename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', `Failed to generate ZIP archive: ${msg}`);
    }
  };

  const selectedCount = databases.filter((d) => d.selected).length;
  const completedCount = databases.filter((d) => d.status === 'completed').length;
  const failedCount = databases.filter((d) => d.status === 'failed').length;
  const currentDbItem = activeDbId ? databases.find((d) => d.id === activeDbId) : null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors selection:bg-emerald-500/20 selection:text-emerald-700 dark:selection:text-emerald-300">
      {/* 3-Zone Top Navigation Contract */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDark={isDark}
        toggleDark={toggleDark}
        onPrimaryAction={handleStartBatchBackup}
        isBackingUp={isBatchRunning}
        selectedCount={selectedCount}
      />

      {/* Main Workspace Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* TrueNAS Server Environment Banner */}
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

        {/* Tab Content: Backups Queue */}
        {activeTab === 'backups' && (
          <div className="space-y-6">
            {/* Batch Progress Card (when running or has results) */}
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

            {/* Database Queue Table */}
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

            {/* Live Activity Log Drawer */}
            <LogDrawer logs={logs} onClearLogs={() => setLogs([])} />
          </div>
        )}

        {/* Tab Content: TrueNAS Environment & Config */}
        {activeTab === 'server' && (
          <div className="space-y-6">
            <WorkflowDocsPanel />
          </div>
        )}

        {/* Tab Content: Deployment & GitHub */}
        {activeTab === 'deployment' && (
          <div className="space-y-6">
            <WorkflowDocsPanel />
          </div>
        )}
      </main>

      {/* SQL Preview Modal */}
      {previewDb && (
        <SqlPreviewModal
          database={previewDb}
          onClose={() => setPreviewDb(null)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-4 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
        <span>TrueNAS PostgreSQL Backup Manager</span>
        <span className="mx-2">·</span>
        <span>Sequential 1-by-1 Database Backup &amp; Downloader</span>
        <span className="mx-2">·</span>
        <span>Configured via TrueNAS Environment Variables</span>
      </footer>
    </div>
  );
}
