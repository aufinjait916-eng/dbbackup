import React, { useState } from 'react';
import { Server, RefreshCw, CheckCircle2, XCircle, Terminal, HelpCircle, HardDrive } from 'lucide-react';
import { ServerConfig, ConnectionTestResult } from '../types';

interface ServerEnvBannerProps {
  config: ServerConfig | null;
  loadingConfig: boolean;
  onRefreshConfig: () => void;
  onTestConnection: () => Promise<ConnectionTestResult>;
  onDiscoverDatabases: () => void;
  discovering: boolean;
  simulationMode: boolean;
  setSimulationMode: (sim: boolean) => void;
}

export const ServerEnvBanner: React.FC<ServerEnvBannerProps> = ({
  config,
  loadingConfig,
  onRefreshConfig,
  onTestConnection,
  onDiscoverDatabases,
  discovering,
  simulationMode,
  setSimulationMode,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [showCheatsheet, setShowCheatsheet] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection();
      setTestResult(res);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                TrueNAS PostgreSQL Server Environment
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">·</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {config ? `${config.host}:${config.port}` : 'Checking...'}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span>User: <strong className="font-mono text-slate-700 dark:text-slate-300">{config?.user || 'postgres'}</strong></span>
              <span>·</span>
              <span>Default DB: <strong className="font-mono text-slate-700 dark:text-slate-300">{config?.defaultDb || 'postgres'}</strong></span>
              <span>·</span>
              <span>Password: <strong className="font-mono text-slate-700 dark:text-slate-300">{config?.hasPassword ? '•••••••• (Configured)' : 'None detected'}</strong></span>
              <span>·</span>
              <span>SSL: <strong className="font-mono text-slate-700 dark:text-slate-300">{config?.sslEnabled ? 'Enabled' : 'Disabled'}</strong></span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Simulation / Demo mode switch */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
            <label htmlFor="sim-toggle" className="text-slate-600 dark:text-slate-400 font-medium cursor-pointer">
              Demo / Sandbox Mode
            </label>
            <input
              id="sim-toggle"
              type="checkbox"
              checked={simulationMode}
              onChange={(e) => setSimulationMode(e.target.checked)}
              className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
            />
          </div>

          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            <span>{testing ? 'Testing...' : 'Test Connection'}</span>
          </button>

          <button
            onClick={onDiscoverDatabases}
            disabled={discovering}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
            title="Query server's pg_database catalog and populate queue"
          >
            <HardDrive className={`w-3.5 h-3.5 ${discovering ? 'animate-spin' : ''}`} />
            <span>{discovering ? 'Querying...' : 'Discover Server DBs'}</span>
          </button>

          <button
            onClick={() => setShowCheatsheet(!showCheatsheet)}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="View TrueNAS configuration instructions"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Connection Test Result Feedback */}
      {testResult && (
        <div
          className={`mt-4 p-3.5 rounded-lg border text-xs flex items-start gap-3 ${
            testResult.success
              ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <div className="font-semibold">{testResult.message}</div>
            {testResult.version && (
              <div className="font-mono text-xs opacity-90">{testResult.version}</div>
            )}
            {testResult.latencyMs !== undefined && (
              <div className="text-xs opacity-80 tabular-nums">
                Latency: {testResult.latencyMs} ms · Connected User: {testResult.currentUser || config?.user}
              </div>
            )}
            {testResult.hint && (
              <div className="mt-1 text-slate-600 dark:text-slate-400 text-xs italic">
                Tip: {testResult.hint}
              </div>
            )}
            {!testResult.success && (
              <div className="mt-2 text-xs font-sans text-slate-700 dark:text-slate-300">
                You can toggle <strong>Demo / Sandbox Mode</strong> above to test all batch backup and sequential download features immediately without a live network socket to TrueNAS.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TrueNAS Setup Cheatsheet */}
      {showCheatsheet && (
        <div className="mt-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <Terminal className="w-4 h-4 text-emerald-600" />
            <span>Configuring TrueNAS Environment Variables</span>
          </div>
          <p>
            When deploying this container in <strong>TrueNAS SCALE (Apps → Custom App or Docker Compose)</strong>, supply the following environment variables:
          </p>
          <div className="p-2.5 rounded bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto leading-relaxed">
            POSTGRES_HOST=192.168.1.100<br />
            POSTGRES_PORT=5432<br />
            POSTGRES_USER=postgres<br />
            POSTGRES_PASSWORD=your_secure_password<br />
            POSTGRES_DATABASE=postgres<br />
            POSTGRES_SSL=false
          </div>
          <p className="text-slate-500 dark:text-slate-400">
            Ensure your PostgreSQL server&apos;s <code className="font-mono">pg_hba.conf</code> permits connections from the TrueNAS applet subnet, or use <code className="font-mono">host all all 0.0.0.0/0 scram-sha-256</code>.
          </p>
        </div>
      )}
    </div>
  );
};
