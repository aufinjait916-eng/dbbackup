export type BackupStatus =
  | 'idle'
  | 'queued'
  | 'connecting'
  | 'dumping'
  | 'downloading'
  | 'completed'
  | 'failed';

export interface DatabaseItem {
  id: string;
  name: string;
  selected: boolean;
  status: BackupStatus;
  progress: number;
  sizeBytes?: number;
  sizePretty?: string;
  durationMs?: number;
  error?: string;
  sqlContent?: string;
  lastBackupAt?: string;
}

export interface ServerConfig {
  configured: boolean;
  host: string;
  port: number;
  user: string;
  defaultDb: string;
  sslEnabled: boolean;
  hasPassword: boolean;
  detectedEnvKeys: string[];
  truenasPlatform: boolean;
  nodeVersion?: string;
  serverTime?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  version?: string;
  currentDatabase?: string;
  currentUser?: string;
  latencyMs?: number;
  hint?: string;
  code?: string;
}

export interface BackupBatchOptions {
  delayBetweenDownloadsMs: number;
  simulationMode: boolean;
  includeSchema: boolean;
  includeData: boolean;
  cleanIfExists: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  database?: string;
}
