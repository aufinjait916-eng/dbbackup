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

export type UserRole = 'IT' | 'Manager';

export type AuthFlowStatus =
  | 'LOADING'
  | 'UNAUTHENTICATED'
  | 'MFA_SETUP_REQUIRED'
  | 'MFA_REQUIRED'
  | 'AUTHENTICATED';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mfaEnabled: boolean;
  mustSetupMfa: boolean;
  backupCodesRemaining: number;
  failedAttempts: number;
  isLocked: boolean;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  createdBy: string;
}

export interface AuthSessionState {
  authenticated: boolean;
  status: AuthFlowStatus;
  user: AuthUser | null;
  csrfToken: string;
  inactivityTimeoutMinutes: number;
  lastActivityAt?: string;
}

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  actorId: string | null;
  actorUsername: string;
  actorRole: UserRole | 'SYSTEM' | 'ANONYMOUS';
  target: string | null;
  ip: string;
  userAgent: string;
  details: string;
}

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ScheduleDownloadMode = 'sequential' | 'zip';

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: ScheduleFrequency;
  timeOfDay: string; // HH:MM (24-hour local time)
  dayOfWeek: number; // 0 (Sun) - 6 (Sat) for weekly
  dayOfMonth: number; // 1 - 28 for monthly
  downloadMode: ScheduleDownloadMode;
  targetDatabases: string[]; // empty = all currently selected databases in queue
  lastRunAt: string | null;
  lastRunKey: string | null;
  lastRunStatus: 'success' | 'partial' | 'failed' | null;
  lastRunSummary: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
