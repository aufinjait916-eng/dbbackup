import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { CookieOptions, Request, Response } from 'express';

export type UserRole = 'IT' | 'Manager';

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  isActive: boolean;
  mfaEnabled: boolean;
  mustSetupMfa: boolean;
  totpSecretEnc: string | null;
  pendingTotpSecretEnc: string | null;
  backupCodeHashes: string[];
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  createdBy: string;
}

export interface SanitizedUser {
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

export interface SessionRecord {
  id: string;
  userId: string;
  mfaVerified: boolean;
  csrfToken: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastActivityAt: number;
  mfaAttempts: number;
}

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export type AuditAction =
  | 'SYSTEM_BOOTSTRAP'
  | 'LOGIN_PASSWORD_OK'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMIT_BLOCKED'
  | 'MFA_SETUP_INIT'
  | 'MFA_SETUP_COMPLETED'
  | 'MFA_VERIFY_SUCCESS'
  | 'MFA_VERIFY_FAILED'
  | 'MFA_BACKUP_CODE_USED'
  | 'MFA_RESET'
  | 'LOGOUT'
  | 'SESSION_EXPIRED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'USER_UNLOCKED'
  | 'PASSWORD_CHANGED'
  | 'CONNECTION_TESTED'
  | 'DATABASES_DISCOVERED'
  | 'BACKUP_STARTED'
  | 'BACKUP_COMPLETED'
  | 'BACKUP_FAILED'
  | 'ZIP_BUNDLE_DOWNLOADED'
  | 'SCHEDULE_UPDATED'
  | 'SCHEDULED_BACKUP_RUN'
  | 'CSRF_REJECTED'
  | 'RBAC_DENIED';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ScheduleDownloadMode = 'sequential' | 'zip';

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: ScheduleFrequency;
  timeOfDay: string;
  dayOfWeek: number;
  dayOfMonth: number;
  downloadMode: ScheduleDownloadMode;
  targetDatabases: string[];
  lastRunAt: string | null;
  lastRunKey: string | null;
  lastRunStatus: 'success' | 'partial' | 'failed' | null;
  lastRunSummary: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function createDefaultBackupSchedule(): BackupScheduleConfig {
  return {
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
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  outcome: AuditOutcome;
  actorId: string | null;
  actorUsername: string;
  actorRole: UserRole | 'SYSTEM' | 'ANONYMOUS';
  target: string | null;
  ip: string;
  userAgent: string;
  details: string;
}

interface AuthStoreData {
  users: StoredUser[];
  sessions: SessionRecord[];
  auditLogs: AuditLogEntry[];
  backupSchedule?: BackupScheduleConfig;
}

export const SESSION_COOKIE_NAME = 'tn_pg_session';
export const PRE_CSRF_COOKIE_NAME = 'tn_pg_pre_csrf';

const DATA_DIR = path.resolve(process.cwd(), process.env.AUTH_DATA_DIR || './data');
const STORE_FILE = path.join(DATA_DIR, 'auth-store.json');
const KEY_FILE = path.join(DATA_DIR, '.master.key');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 15;
const MAX_MFA_ATTEMPTS = 5;
const ABSOLUTE_SESSION_MAX_MS = 12 * 60 * 60 * 1000; // 12 hours
const PENDING_MFA_MAX_MS = 10 * 60 * 1000; // 10 minutes
const ISSUER_NAME = 'TrueNAS Postgres Backup';

export function getInactivityTimeoutMs(): number {
  const mins = parseInt(process.env.SESSION_INACTIVITY_MINUTES || '15', 10);
  const clamped = Number.isFinite(mins) && mins >= 1 && mins <= 1440 ? mins : 15;
  return clamped * 60 * 1000;
}

export function getInactivityTimeoutMinutes(): number {
  return Math.round(getInactivityTimeoutMs() / 60000);
}

// Resolve or persist a 32-byte master key for AES-256-GCM + HMAC
function resolveMasterKey(): Buffer {
  const envSecret = process.env.SESSION_SECRET;
  if (envSecret && envSecret.trim().length >= 16) {
    return crypto.createHash('sha256').update(envSecret.trim()).digest();
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    const existing = fs.readFileSync(KEY_FILE, 'utf-8').trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) {
      return Buffer.from(existing, 'hex');
    }
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

const MASTER_KEY = resolveMasterKey();

function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Corrupt encrypted secret');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  const origin = req.headers['origin'];
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  const referer = req.headers['referer'];
  if (typeof referer === 'string' && referer.startsWith('https://')) {
    return true;
  }
  return false;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Pre-login signed CSRF token
export function createPreAuthCsrfToken(): string {
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = crypto.createHmac('sha256', MASTER_KEY).update(nonce).digest('hex');
  return `${nonce}.${sig}`;
}

export function verifyPreAuthCsrfToken(token: string | undefined): boolean {
  if (!token || !token.includes('.')) return false;
  const [nonce, sig] = token.split('.');
  if (!nonce || !sig) return false;
  const expected = crypto.createHmac('sha256', MASTER_KEY).update(nonce).digest('hex');
  return timingSafeEqualStr(sig, expected);
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return 'Password must include at least one number or special character.';
  }
  return null;
}

export function isValidBcryptHash(hash: string | undefined | null): boolean {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
}

function authTrace(stage: string, meta: Record<string, unknown>) {
  console.log(`[AUTH TRACE] ${new Date().toISOString()} ${stage} ${JSON.stringify(meta)}`);
}

function generateBackupCodes(count = 8): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) {
      raw += alphabet[bytes[j] % alphabet.length];
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function sanitizeUser(user: StoredUser): SanitizedUser {
  const now = Date.now();
  const isLocked = Boolean(user.lockedUntil && user.lockedUntil > now);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    mustSetupMfa: user.mustSetupMfa,
    backupCodesRemaining: user.backupCodeHashes.length,
    failedAttempts: user.failedAttempts,
    isLocked,
    lockedUntil: isLocked && user.lockedUntil ? new Date(user.lockedUntil).toISOString() : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    createdBy: user.createdBy,
  };
}

class AuthStore {
  private data: AuthStoreData = {
    users: [],
    sessions: [],
    auditLogs: [],
    backupSchedule: createDefaultBackupSchedule(),
  };
  private ipFailures: Map<string, { count: number; firstAt: number; lockedUntil: number | null }> = new Map();

  constructor() {
    this.load();
    this.bootstrapAdminIfEmpty();
  }

  private load() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      try {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AuthStoreData>;
        this.data = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
          backupSchedule: parsed.backupSchedule
            ? { ...createDefaultBackupSchedule(), ...parsed.backupSchedule }
            : createDefaultBackupSchedule(),
        };
      } catch (err) {
        console.error('Failed to parse auth-store.json, initializing fresh store:', err);
        this.data = {
          users: [],
          sessions: [],
          auditLogs: [],
          backupSchedule: createDefaultBackupSchedule(),
        };
      }
    }
    this.pruneExpiredSessions();
    authTrace('STORE_LOADED', {
      userCount: this.data.users.length,
      activeSessions: this.data.sessions.length,
      hasSessionSecretEnv: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16),
      hasItAdminPasswordEnv: Boolean(process.env.IT_ADMIN_PASSWORD),
      hashAlgorithm: 'bcryptjs (bcrypt $2b$12$)',
      totpAlgorithm: 'HMAC-SHA1 / 6 digits / 30s period / window +-2',
    });
  }

  private persist() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmpFile, STORE_FILE);
  }

  private bootstrapAdminIfEmpty() {
    if (this.data.users.length > 0) return;

    const username = (process.env.IT_ADMIN_USERNAME || 'it-admin').trim().toLowerCase();
    const email = (process.env.IT_ADMIN_EMAIL || 'it-admin@truenas.local').trim().toLowerCase();
    const password = process.env.IT_ADMIN_PASSWORD || 'TrueNAS-Admin-2026!';
    const now = new Date().toISOString();

    const adminUser: StoredUser = {
      id: `usr_${crypto.randomUUID()}`,
      username,
      displayName: 'Primary IT Administrator',
      email,
      role: 'IT',
      passwordHash: bcrypt.hashSync(password, 12),
      isActive: true,
      mfaEnabled: false,
      mustSetupMfa: true,
      totpSecretEnc: null,
      pendingTotpSecretEnc: null,
      backupCodeHashes: [],
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdBy: 'env-bootstrap',
    };

    this.data.users.push(adminUser);
    this.appendAudit({
      action: 'SYSTEM_BOOTSTRAP',
      outcome: 'SUCCESS',
      actorId: adminUser.id,
      actorUsername: adminUser.username,
      actorRole: 'SYSTEM',
      target: adminUser.username,
      ip: '127.0.0.1',
      userAgent: 'server-init',
      details: `Bootstrapped initial IT admin account '${adminUser.username}' from environment configuration (mandatory MFA setup pending).`,
    });
    this.persist();

    console.log(
      `[AUTH] Bootstrapped initial IT admin account '${username}' (mandatory TOTP MFA enrollment required on first login).`
    );
  }

  private pruneExpiredSessions() {
    const now = Date.now();
    const inactivityMs = getInactivityTimeoutMs();
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => {
      if (now - s.createdAt > ABSOLUTE_SESSION_MAX_MS) return false;
      if (!s.mfaVerified && now - s.createdAt > PENDING_MFA_MAX_MS) return false;
      if (s.mfaVerified && now - s.lastActivityAt > inactivityMs) return false;
      return true;
    });
    if (this.data.sessions.length !== before) {
      this.persist();
    }
  }

  public appendAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
    const record: AuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.data.auditLogs.unshift(record);
    if (this.data.auditLogs.length > 2000) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 2000);
    }
    this.persist();
    return record;
  }

  public getAuditLogs(limit = 300): AuditLogEntry[] {
    return this.data.auditLogs.slice(0, limit);
  }

  public getBootstrapInfo() {
    const singleUser = this.data.users.length === 1 ? this.data.users[0] : null;
    const bootstrapPending = Boolean(
      singleUser &&
        singleUser.createdBy === 'env-bootstrap' &&
        singleUser.mustSetupMfa &&
        !singleUser.lastLoginAt
    );
    return {
      hasEnvUsername: Boolean(process.env.IT_ADMIN_USERNAME),
      hasEnvPassword: Boolean(process.env.IT_ADMIN_PASSWORD),
      totalUsers: this.data.users.length,
      bootstrapPending,
      bootstrapUsernameHint: bootstrapPending ? singleUser!.username : null,
    };
  }

  // IP Rate Limiting helpers
  public checkIpRateLimit(ip: string): { blocked: boolean; retryAfterSec: number } {
    const entry = this.ipFailures.get(ip);
    if (!entry) return { blocked: false, retryAfterSec: 0 };

    const now = Date.now();
    if (entry.lockedUntil && entry.lockedUntil > now) {
      return {
        blocked: true,
        retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }

    if (now - entry.firstAt > IP_WINDOW_MS) {
      this.ipFailures.delete(ip);
      return { blocked: false, retryAfterSec: 0 };
    }

    return { blocked: false, retryAfterSec: 0 };
  }

  private recordIpFailure(ip: string) {
    const now = Date.now();
    const existing = this.ipFailures.get(ip);
    if (!existing || now - existing.firstAt > IP_WINDOW_MS) {
      this.ipFailures.set(ip, { count: 1, firstAt: now, lockedUntil: null });
      return;
    }
    existing.count += 1;
    if (existing.count >= IP_MAX_FAILURES) {
      existing.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
  }

  private clearIpFailure(ip: string) {
    this.ipFailures.delete(ip);
  }

  public findUserByIdentifier(identifier: string): StoredUser | undefined {
    const norm = identifier.trim().toLowerCase();
    return this.data.users.find(
      (u) => u.username.toLowerCase() === norm || u.email.toLowerCase() === norm
    );
  }

  public findUserById(id: string): StoredUser | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  public listUsers(): SanitizedUser[] {
    return this.data.users.map(sanitizeUser);
  }

  // Authenticate step 1: password check
  public authenticatePassword(
    identifier: string,
    password: string,
    ip: string,
    userAgent: string,
    requestId = 'unknown'
  ):
    | { ok: true; user: StoredUser; session: SessionRecord; status: 'MFA_SETUP_REQUIRED' | 'MFA_REQUIRED' }
    | { ok: false; statusCode: number; error: string; retryAfterSec?: number } {
    const trimmedIdentifier = identifier.trim();
    const normalizedIdentifier = trimmedIdentifier.toLowerCase();
    const ipCheck = this.checkIpRateLimit(ip);

    authTrace('LOGIN_PASSWORD_BEGIN', {
      requestId,
      ip,
      identifierLength: trimmedIdentifier.length,
      identifierHasInternalSpace: /\s/.test(trimmedIdentifier),
      passwordLength: password.length,
      passwordHasLeadingOrTrailingSpace: password !== password.trim(),
      ipRateLimited: ipCheck.blocked,
    });

    if (ipCheck.blocked) {
      authTrace('LOGIN_REJECTED_IP_RATE_LIMIT', {
        requestId,
        ip,
        retryAfterSec: ipCheck.retryAfterSec,
      });
      this.appendAudit({
        action: 'RATE_LIMIT_BLOCKED',
        outcome: 'DENIED',
        actorId: null,
        actorUsername: identifier || 'unknown',
        actorRole: 'ANONYMOUS',
        target: null,
        ip,
        userAgent,
        details: `Login blocked by IP rate limiter for ${ipCheck.retryAfterSec}s.`,
      });
      return {
        ok: false,
        statusCode: 429,
        error: `Too many failed attempts from your network. Try again in ${Math.ceil(ipCheck.retryAfterSec / 60)} minute(s).`,
        retryAfterSec: ipCheck.retryAfterSec,
      };
    }

    const user = this.findUserByIdentifier(normalizedIdentifier);
    const now = Date.now();

    if (!user) {
      this.recordIpFailure(ip);
      // Mitigate timing side-channel
      bcrypt.compareSync(password, '$2b$12$CwTycUXWue0Thq9StjUM0uJ8uX9iL2wE0R6JYq5gL5V8N6pT5K2mW');
      authTrace('LOGIN_REJECTED_USER_NOT_FOUND', {
        requestId,
        ip,
        normalizedLength: normalizedIdentifier.length,
        hasSpace: /\s/.test(normalizedIdentifier),
        registeredUsersCount: this.data.users.length,
      });
      this.appendAudit({
        action: 'LOGIN_FAILED',
        outcome: 'FAILURE',
        actorId: null,
        actorUsername: identifier || 'unknown',
        actorRole: 'ANONYMOUS',
        target: null,
        ip,
        userAgent,
        details: 'Unknown username or email attempted login.',
      });
      return { ok: false, statusCode: 401, error: 'Invalid credentials.' };
    }

    if (!user.isActive) {
      authTrace('LOGIN_REJECTED_DISABLED', {
        requestId,
        userId: user.id,
        username: user.username,
      });
      this.appendAudit({
        action: 'LOGIN_FAILED',
        outcome: 'DENIED',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip,
        userAgent,
        details: 'Disabled account attempted login.',
      });
      return { ok: false, statusCode: 403, error: 'Account is disabled. Contact an IT administrator.' };
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      const retryAfterSec = Math.ceil((user.lockedUntil - now) / 1000);
      authTrace('LOGIN_REJECTED_LOCKED', {
        requestId,
        userId: user.id,
        username: user.username,
        retryAfterSec,
      });
      this.appendAudit({
        action: 'LOGIN_FAILED',
        outcome: 'DENIED',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip,
        userAgent,
        details: `Locked account login rejected (${retryAfterSec}s remaining).`,
      });
      return {
        ok: false,
        statusCode: 429,
        error: `Account is temporarily locked due to multiple failed login attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
        retryAfterSec,
      };
    }

    // Clear expired lock
    if (user.lockedUntil && user.lockedUntil <= now) {
      user.lockedUntil = null;
      user.failedAttempts = 0;
    }

    const hashValidFormat = isValidBcryptHash(user.passwordHash);
    const compareStartMs = Date.now();
    const passwordValid = hashValidFormat && bcrypt.compareSync(password, user.passwordHash);
    const compareDurationMs = Date.now() - compareStartMs;

    authTrace('LOGIN_PASSWORD_VERIFY', {
      requestId,
      userId: user.id,
      username: user.username,
      role: user.role,
      hashValidFormat,
      hashPrefix: typeof user.passwordHash === 'string' ? user.passwordHash.slice(0, 7) : 'none',
      hashLength: typeof user.passwordHash === 'string' ? user.passwordHash.length : 0,
      passwordLastUpdatedAt: user.updatedAt,
      compareDurationMs,
      passwordValid,
      priorFailedAttempts: user.failedAttempts,
    });

    if (!passwordValid) {
      user.failedAttempts += 1;
      this.recordIpFailure(ip);

      if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = now + LOCKOUT_DURATION_MS;
        this.persist();
        authTrace('LOGIN_ACCOUNT_LOCKED', {
          requestId,
          userId: user.id,
          username: user.username,
          failedAttempts: user.failedAttempts,
        });
        this.appendAudit({
          action: 'ACCOUNT_LOCKED',
          outcome: 'DENIED',
          actorId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          target: user.username,
          ip,
          userAgent,
          details: `Account locked for 15 minutes after ${user.failedAttempts} consecutive failed password attempts.`,
        });
        return {
          ok: false,
          statusCode: 429,
          error: 'Account locked for 15 minutes due to 5 consecutive failed login attempts.',
          retryAfterSec: Math.ceil(LOCKOUT_DURATION_MS / 1000),
        };
      }

      this.persist();
      this.appendAudit({
        action: 'LOGIN_FAILED',
        outcome: 'FAILURE',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip,
        userAgent,
        details: `Invalid password (${user.failedAttempts}/${MAX_FAILED_ATTEMPTS} attempts).`,
      });
      return { ok: false, statusCode: 401, error: 'Invalid credentials.' };
    }

    // Password valid — reset failure counters & create pending-MFA session
    user.failedAttempts = 0;
    user.lockedUntil = null;
    this.clearIpFailure(ip);

    const session: SessionRecord = {
      id: crypto.randomBytes(32).toString('hex'),
      userId: user.id,
      mfaVerified: false,
      csrfToken: crypto.randomBytes(32).toString('hex'),
      ip,
      userAgent,
      createdAt: now,
      lastActivityAt: now,
      mfaAttempts: 0,
    };

    this.data.sessions.push(session);
    this.persist();

    const status = !user.mfaEnabled || user.mustSetupMfa ? 'MFA_SETUP_REQUIRED' : 'MFA_REQUIRED';

    authTrace('LOGIN_PASSWORD_OK', {
      requestId,
      userId: user.id,
      username: user.username,
      nextStep: status,
      mfaEnabled: user.mfaEnabled,
      mustSetupMfa: user.mustSetupMfa,
    });

    this.appendAudit({
      action: 'LOGIN_PASSWORD_OK',
      outcome: 'SUCCESS',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      target: user.username,
      ip,
      userAgent,
      details: `Password verified (${status}).`,
    });

    return { ok: true, user, session, status };
  }

  // Generate QR code & pending secret for mandatory first-login MFA setup
  public async initMfaSetup(
    session: SessionRecord,
    user: StoredUser,
    ip: string,
    userAgent: string
  ): Promise<{ qrDataUrl: string; manualSecret: string; otpauthUri: string }> {
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER_NAME,
      label: `${user.username} (${user.role})`,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    user.pendingTotpSecretEnc = encryptSecret(secret.base32);
    user.updatedAt = new Date().toISOString();
    this.persist();

    const otpauthUri = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, {
      width: 220,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    this.appendAudit({
      action: 'MFA_SETUP_INIT',
      outcome: 'SUCCESS',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      target: user.username,
      ip,
      userAgent,
      details: 'Generated new TOTP enrollment secret and QR code.',
    });

    return {
      qrDataUrl,
      manualSecret: secret.base32,
      otpauthUri,
    };
  }

  // Verify first-time MFA setup OTP and issue 8 single-use backup codes
  public completeMfaSetup(
    session: SessionRecord,
    user: StoredUser,
    otpCode: string,
    ip: string,
    userAgent: string,
    requestId = 'unknown'
  ): { ok: true; backupCodes: string[]; session: SessionRecord } | { ok: false; statusCode: number; error: string } {
    if (!user.pendingTotpSecretEnc) {
      authTrace('MFA_SETUP_NO_PENDING_SECRET', { requestId, userId: user.id, username: user.username });
      return { ok: false, statusCode: 400, error: 'MFA setup has not been initialized. Refresh QR code and try again.' };
    }

    const cleanCode = otpCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      return { ok: false, statusCode: 400, error: 'Enter a valid 6-digit authenticator code.' };
    }

    let base32Secret = '';
    try {
      base32Secret = decryptSecret(user.pendingTotpSecretEnc);
    } catch (err) {
      authTrace('MFA_SETUP_DECRYPT_ERROR', {
        requestId,
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        statusCode: 500,
        error: 'Unable to decrypt pending TOTP secret. Please re-initialize MFA setup.',
      };
    }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER_NAME,
      label: `${user.username} (${user.role})`,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });

    const delta = totp.validate({ token: cleanCode, window: 2 });
    authTrace('MFA_SETUP_VERIFY', {
      requestId,
      userId: user.id,
      username: user.username,
      serverUtc: new Date().toISOString(),
      totpPeriodStep: Math.floor(Date.now() / 30000),
      delta,
      matched: delta !== null,
    });

    if (delta === null) {
      session.mfaAttempts += 1;
      this.appendAudit({
        action: 'MFA_VERIFY_FAILED',
        outcome: 'FAILURE',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip,
        userAgent,
        details: `Initial MFA verification code invalid (${session.mfaAttempts}/${MAX_MFA_ATTEMPTS}).`,
      });
      if (session.mfaAttempts >= MAX_MFA_ATTEMPTS) {
        this.destroySession(session.id);
        return {
          ok: false,
          statusCode: 429,
          error: 'Too many invalid OTP attempts. Please sign in again.',
        };
      }
      this.persist();
      return { ok: false, statusCode: 401, error: 'Invalid 6-digit OTP code. Ensure your device clock is synchronized.' };
    }

    // Generate 8 single-use backup codes
    const plaintextBackupCodes = generateBackupCodes(8);
    const backupCodeHashes = plaintextBackupCodes.map((c) => bcrypt.hashSync(c.replace(/-/g, ''), 10));

    user.totpSecretEnc = user.pendingTotpSecretEnc;
    user.pendingTotpSecretEnc = null;
    user.mfaEnabled = true;
    user.mustSetupMfa = false;
    user.backupCodeHashes = backupCodeHashes;
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();

    // Rotate session ID and CSRF token on privilege elevation
    this.data.sessions = this.data.sessions.filter((s) => s.id !== session.id);
    const elevatedSession: SessionRecord = {
      id: crypto.randomBytes(32).toString('hex'),
      userId: user.id,
      mfaVerified: true,
      csrfToken: crypto.randomBytes(32).toString('hex'),
      ip,
      userAgent,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      mfaAttempts: 0,
    };
    this.data.sessions.push(elevatedSession);
    this.persist();

    this.appendAudit({
      action: 'MFA_SETUP_COMPLETED',
      outcome: 'SUCCESS',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      target: user.username,
      ip,
      userAgent,
      details: 'Completed mandatory TOTP MFA enrollment and generated 8 recovery backup codes.',
    });

    return { ok: true, backupCodes: plaintextBackupCodes, session: elevatedSession };
  }

  // Verify returning user's 6-digit TOTP or backup code
  public verifyMfaLogin(
    session: SessionRecord,
    user: StoredUser,
    codeInput: string,
    isBackupCode: boolean,
    ip: string,
    userAgent: string,
    requestId = 'unknown'
  ): { ok: true; session: SessionRecord; usedBackupCode: boolean } | { ok: false; statusCode: number; error: string } {
    if (!user.mfaEnabled || !user.totpSecretEnc) {
      authTrace('MFA_VERIFY_NOT_CONFIGURED', { requestId, userId: user.id, username: user.username });
      return { ok: false, statusCode: 400, error: 'MFA is not configured for this account.' };
    }

    const trimmed = codeInput.trim();
    let verified = false;
    let usedBackupCode = false;

    if (isBackupCode) {
      const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (normalized.length === 8) {
        for (let i = 0; i < user.backupCodeHashes.length; i++) {
          if (bcrypt.compareSync(normalized, user.backupCodeHashes[i])) {
            user.backupCodeHashes.splice(i, 1);
            verified = true;
            usedBackupCode = true;
            break;
          }
        }
      }
      authTrace('MFA_BACKUP_CODE_CHECK', {
        requestId,
        userId: user.id,
        username: user.username,
        normalizedLength: normalized.length,
        verified,
        backupCodesRemaining: user.backupCodeHashes.length,
      });
    } else {
      const cleanCode = trimmed.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(cleanCode)) {
        return { ok: false, statusCode: 400, error: 'Enter a valid 6-digit OTP code.' };
      }

      let base32Secret = '';
      try {
        base32Secret = decryptSecret(user.totpSecretEnc);
      } catch (err) {
        authTrace('MFA_VERIFY_DECRYPT_ERROR', {
          requestId,
          userId: user.id,
          username: user.username,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          statusCode: 500,
          error: 'Unable to decrypt stored TOTP secret (check SESSION_SECRET consistency or ask an IT admin to reset MFA).',
        };
      }

      const totp = new OTPAuth.TOTP({
        issuer: ISSUER_NAME,
        label: `${user.username} (${user.role})`,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(base32Secret),
      });
      const delta = totp.validate({ token: cleanCode, window: 2 });
      verified = delta !== null;

      authTrace('MFA_TOTP_CHECK', {
        requestId,
        userId: user.id,
        username: user.username,
        serverUtc: new Date().toISOString(),
        totpPeriodStep: Math.floor(Date.now() / 30000),
        delta,
        verified,
      });
    }

    if (!verified) {
      session.mfaAttempts += 1;
      user.failedAttempts += 1;

      this.appendAudit({
        action: 'MFA_VERIFY_FAILED',
        outcome: 'FAILURE',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip,
        userAgent,
        details: `Invalid ${isBackupCode ? 'backup recovery code' : 'TOTP OTP'} (${session.mfaAttempts}/${MAX_MFA_ATTEMPTS}).`,
      });

      if (session.mfaAttempts >= MAX_MFA_ATTEMPTS) {
        user.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        this.destroySession(session.id);
        this.appendAudit({
          action: 'ACCOUNT_LOCKED',
          outcome: 'DENIED',
          actorId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          target: user.username,
          ip,
          userAgent,
          details: 'Account locked for 15 minutes after 5 consecutive failed MFA verification attempts.',
        });
        return {
          ok: false,
          statusCode: 429,
          error: 'Too many invalid MFA attempts. Account locked for 15 minutes.',
        };
      }

      this.persist();
      return {
        ok: false,
        statusCode: 401,
        error: isBackupCode ? 'Invalid or already used recovery backup code.' : 'Invalid 6-digit OTP code.',
      };
    }

    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();

    // Rotate session ID & CSRF token on full MFA authentication
    this.data.sessions = this.data.sessions.filter((s) => s.id !== session.id);
    const elevatedSession: SessionRecord = {
      id: crypto.randomBytes(32).toString('hex'),
      userId: user.id,
      mfaVerified: true,
      csrfToken: crypto.randomBytes(32).toString('hex'),
      ip,
      userAgent,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      mfaAttempts: 0,
    };
    this.data.sessions.push(elevatedSession);
    this.persist();

    this.appendAudit({
      action: usedBackupCode ? 'MFA_BACKUP_CODE_USED' : 'MFA_VERIFY_SUCCESS',
      outcome: 'SUCCESS',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      target: user.username,
      ip,
      userAgent,
      details: usedBackupCode
        ? `Authenticated using single-use recovery backup code (${user.backupCodeHashes.length} remaining).`
        : 'Authenticated via 6-digit TOTP MFA.',
    });

    return { ok: true, session: elevatedSession, usedBackupCode };
  }

  public getSessionAndUser(
    sessionId: string | undefined,
    req: Request
  ): { session: SessionRecord; user: StoredUser } | { expired: true } | null {
    if (!sessionId) return null;
    const session = this.data.sessions.find((s) => s.id === sessionId);
    if (!session) return null;

    const user = this.findUserById(session.userId);
    if (!user || !user.isActive) {
      this.destroySession(sessionId);
      return null;
    }

    const now = Date.now();
    const inactivityMs = getInactivityTimeoutMs();

    if (now - session.createdAt > ABSOLUTE_SESSION_MAX_MS) {
      this.destroySession(sessionId);
      this.appendAudit({
        action: 'SESSION_EXPIRED',
        outcome: 'DENIED',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || 'unknown'),
        details: 'Session exceeded maximum 12-hour lifetime.',
      });
      return { expired: true };
    }

    if (!session.mfaVerified && now - session.createdAt > PENDING_MFA_MAX_MS) {
      this.destroySession(sessionId);
      return { expired: true };
    }

    if (session.mfaVerified && now - session.lastActivityAt > inactivityMs) {
      this.destroySession(sessionId);
      this.appendAudit({
        action: 'SESSION_EXPIRED',
        outcome: 'DENIED',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || 'unknown'),
        details: `Session expired after ${getInactivityTimeoutMinutes()} minutes of inactivity.`,
      });
      return { expired: true };
    }

    // Slide inactivity timestamp
    session.lastActivityAt = now;
    this.persist();
    return { session, user };
  }

  public destroySession(sessionId: string) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.id !== sessionId);
    if (this.data.sessions.length !== before) {
      this.persist();
    }
  }

  public destroyUserSessions(userId: string) {
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.userId !== userId);
    if (this.data.sessions.length !== before) {
      this.persist();
    }
  }

  // IT-only User Management operations
  public createUser(
    input: {
      username: string;
      displayName: string;
      email: string;
      role: string;
      password: string;
    },
    actor: StoredUser,
    ip: string,
    userAgent: string
  ): { ok: true; user: SanitizedUser } | { ok: false; statusCode: number; error: string } {
    const username = input.username?.trim().toLowerCase();
    const email = input.email?.trim().toLowerCase();
    const displayName = input.displayName?.trim() || username;

    if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Username must be 3-32 characters (lowercase letters, numbers, dots, underscores, hyphens).',
      };
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, statusCode: 400, error: 'Provide a valid email address.' };
    }

    if (input.role !== 'IT' && input.role !== 'Manager') {
      return { ok: false, statusCode: 400, error: 'Role must be strictly IT or Manager.' };
    }

    const pwError = validatePasswordStrength(input.password);
    if (pwError) {
      return { ok: false, statusCode: 400, error: pwError };
    }

    if (this.data.users.some((u) => u.username.toLowerCase() === username)) {
      return { ok: false, statusCode: 409, error: `Username '${username}' already exists.` };
    }

    if (this.data.users.some((u) => u.email.toLowerCase() === email)) {
      return { ok: false, statusCode: 409, error: `Email '${email}' is already assigned to another account.` };
    }

    const now = new Date().toISOString();
    const newUser: StoredUser = {
      id: `usr_${crypto.randomUUID()}`,
      username,
      displayName,
      email,
      role: input.role,
      passwordHash: bcrypt.hashSync(input.password, 12),
      isActive: true,
      mfaEnabled: false,
      mustSetupMfa: true,
      totpSecretEnc: null,
      pendingTotpSecretEnc: null,
      backupCodeHashes: [],
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdBy: actor.username,
    };

    this.data.users.push(newUser);
    this.persist();

    this.appendAudit({
      action: 'USER_CREATED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: newUser.username,
      ip,
      userAgent,
      details: `Created ${newUser.role} account '${newUser.username}' (${newUser.email}). Mandatory MFA setup required on first login.`,
    });

    return { ok: true, user: sanitizeUser(newUser) };
  }

  public updateUser(
    targetId: string,
    updates: {
      displayName?: string;
      email?: string;
      role?: string;
      isActive?: boolean;
      password?: string;
      unlock?: boolean;
    },
    actor: StoredUser,
    ip: string,
    userAgent: string
  ): { ok: true; user: SanitizedUser } | { ok: false; statusCode: number; error: string } {
    const target = this.findUserById(targetId);
    if (!target) {
      return { ok: false, statusCode: 404, error: 'User not found.' };
    }

    if (updates.role !== undefined && updates.role !== 'IT' && updates.role !== 'Manager') {
      return { ok: false, statusCode: 400, error: 'Role must be strictly IT or Manager.' };
    }

    const activeItAdmins = this.data.users.filter((u) => u.role === 'IT' && u.isActive && u.id !== target.id);

    // Prevent locking out or demoting the final active IT admin
    if (target.role === 'IT' && activeItAdmins.length === 0) {
      if (updates.role === 'Manager') {
        return { ok: false, statusCode: 400, error: 'Cannot demote the last active IT administrator.' };
      }
      if (updates.isActive === false) {
        return { ok: false, statusCode: 400, error: 'Cannot disable the last active IT administrator.' };
      }
    }

    if (target.id === actor.id && updates.isActive === false) {
      return { ok: false, statusCode: 400, error: 'You cannot disable your own active account.' };
    }

    const changes: string[] = [];

    if (updates.displayName !== undefined && updates.displayName.trim()) {
      target.displayName = updates.displayName.trim();
      changes.push('displayName');
    }

    if (updates.email !== undefined) {
      const email = updates.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, statusCode: 400, error: 'Provide a valid email address.' };
      }
      if (this.data.users.some((u) => u.id !== target.id && u.email.toLowerCase() === email)) {
        return { ok: false, statusCode: 409, error: `Email '${email}' is already in use.` };
      }
      if (target.email !== email) {
        target.email = email;
        changes.push('email');
      }
    }

    if (updates.role !== undefined && updates.role !== target.role) {
      target.role = updates.role as UserRole;
      changes.push(`role->${updates.role}`);
    }

    if (updates.isActive !== undefined && updates.isActive !== target.isActive) {
      target.isActive = updates.isActive;
      if (!target.isActive) {
        this.destroyUserSessions(target.id);
      }
      changes.push(`active->${updates.isActive}`);
    }

    if (updates.password && updates.password.trim().length > 0) {
      const pwError = validatePasswordStrength(updates.password);
      if (pwError) {
        return { ok: false, statusCode: 400, error: pwError };
      }
      target.passwordHash = bcrypt.hashSync(updates.password, 12);
      this.destroyUserSessions(target.id);
      changes.push('passwordReset');
    }

    if (updates.unlock) {
      target.failedAttempts = 0;
      target.lockedUntil = null;
      changes.push('unlocked');
    }

    target.updatedAt = new Date().toISOString();
    this.persist();

    this.appendAudit({
      action: updates.unlock && changes.length === 1 ? 'USER_UNLOCKED' : 'USER_UPDATED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: target.username,
      ip,
      userAgent,
      details: `Updated user '${target.username}' (${changes.join(', ') || 'no-op'}).`,
    });

    return { ok: true, user: sanitizeUser(target) };
  }

  public deleteUser(
    targetId: string,
    actor: StoredUser,
    ip: string,
    userAgent: string
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    const target = this.findUserById(targetId);
    if (!target) {
      return { ok: false, statusCode: 404, error: 'User not found.' };
    }

    if (target.id === actor.id) {
      return { ok: false, statusCode: 400, error: 'You cannot delete your own active account.' };
    }

    if (target.role === 'IT') {
      const remainingIt = this.data.users.filter((u) => u.role === 'IT' && u.isActive && u.id !== target.id);
      if (remainingIt.length === 0) {
        return { ok: false, statusCode: 400, error: 'Cannot delete the last active IT administrator.' };
      }
    }

    this.destroyUserSessions(target.id);
    this.data.users = this.data.users.filter((u) => u.id !== target.id);
    this.persist();

    this.appendAudit({
      action: 'USER_DELETED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: target.username,
      ip,
      userAgent,
      details: `Deleted ${target.role} user account '${target.username}'.`,
    });

    return { ok: true };
  }

  public resetUserMfa(
    targetId: string,
    actor: StoredUser,
    ip: string,
    userAgent: string
  ): { ok: true; user: SanitizedUser } | { ok: false; statusCode: number; error: string } {
    const target = this.findUserById(targetId);
    if (!target) {
      return { ok: false, statusCode: 404, error: 'User not found.' };
    }

    target.mfaEnabled = false;
    target.mustSetupMfa = true;
    target.totpSecretEnc = null;
    target.pendingTotpSecretEnc = null;
    target.backupCodeHashes = [];
    target.updatedAt = new Date().toISOString();

    // Revoke existing sessions so user must re-enroll MFA immediately on next login
    this.destroyUserSessions(target.id);
    this.persist();

    this.appendAudit({
      action: 'MFA_RESET',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: target.username,
      ip,
      userAgent,
      details: `IT administrator '${actor.username}' reset TOTP MFA and backup codes for '${target.username}'.`,
    });

    return { ok: true, user: sanitizeUser(target) };
  }

  public changeOwnPassword(
    user: StoredUser,
    currentPassword: string,
    newPassword: string,
    ip: string,
    userAgent: string
  ): { ok: true } | { ok: false; statusCode: number; error: string } {
    if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
      this.appendAudit({
        action: 'PASSWORD_CHANGED',
        outcome: 'FAILURE',
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        target: user.username,
        ip,
        userAgent,
        details: 'Current password mismatch during self-service password change.',
      });
      return { ok: false, statusCode: 401, error: 'Current password is incorrect.' };
    }

    const pwError = validatePasswordStrength(newPassword);
    if (pwError) {
      return { ok: false, statusCode: 400, error: pwError };
    }

    user.passwordHash = bcrypt.hashSync(newPassword, 12);
    user.updatedAt = new Date().toISOString();
    this.persist();

    this.appendAudit({
      action: 'PASSWORD_CHANGED',
      outcome: 'SUCCESS',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      target: user.username,
      ip,
      userAgent,
      details: 'User changed their account password.',
    });

    return { ok: true };
  }

  public getBackupSchedule(): BackupScheduleConfig {
    if (!this.data.backupSchedule) {
      this.data.backupSchedule = createDefaultBackupSchedule();
    }
    return { ...this.data.backupSchedule };
  }

  public updateBackupSchedule(
    input: Partial<BackupScheduleConfig>,
    actor: StoredUser,
    ip: string,
    userAgent: string
  ): { ok: true; schedule: BackupScheduleConfig } | { ok: false; statusCode: number; error: string } {
    const current = this.getBackupSchedule();
    const validFrequencies: ScheduleFrequency[] = ['hourly', 'daily', 'weekly', 'monthly'];
    const validModes: ScheduleDownloadMode[] = ['sequential', 'zip'];

    const frequency = input.frequency ?? current.frequency;
    if (!validFrequencies.includes(frequency)) {
      return { ok: false, statusCode: 400, error: 'Invalid schedule frequency.' };
    }

    const timeOfDay = typeof input.timeOfDay === 'string' ? input.timeOfDay.trim() : current.timeOfDay;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
      return { ok: false, statusCode: 400, error: 'Time of day must be in HH:MM (24-hour) format.' };
    }

    const dayOfWeek = input.dayOfWeek !== undefined ? Number(input.dayOfWeek) : current.dayOfWeek;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { ok: false, statusCode: 400, error: 'Day of week must be between 0 (Sunday) and 6 (Saturday).' };
    }

    const dayOfMonth = input.dayOfMonth !== undefined ? Number(input.dayOfMonth) : current.dayOfMonth;
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      return { ok: false, statusCode: 400, error: 'Day of month must be between 1 and 28.' };
    }

    const downloadMode = input.downloadMode ?? current.downloadMode;
    if (!validModes.includes(downloadMode)) {
      return { ok: false, statusCode: 400, error: 'Invalid download mode.' };
    }

    const targetDatabases = Array.isArray(input.targetDatabases)
      ? input.targetDatabases.filter((d): d is string => typeof d === 'string' && /^[a-zA-Z0-9_\-.]+$/.test(d))
      : current.targetDatabases;

    const updated: BackupScheduleConfig = {
      ...current,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      frequency,
      timeOfDay,
      dayOfWeek,
      dayOfMonth,
      downloadMode,
      targetDatabases,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.username,
    };

    this.data.backupSchedule = updated;
    this.persist();

    this.appendAudit({
      action: 'SCHEDULE_UPDATED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: updated.frequency,
      ip,
      userAgent,
      details: `${updated.enabled ? 'Enabled' : 'Disabled'} automatic ${updated.frequency} backup at ${updated.timeOfDay} (${updated.downloadMode} download, ${updated.targetDatabases.length > 0 ? updated.targetDatabases.length + ' DB(s)' : 'selected queue DBs'}).`,
    });

    return { ok: true, schedule: updated };
  }

  public recordScheduledRun(
    payload: {
      runKey?: string;
      status: 'success' | 'partial' | 'failed';
      summary: string;
    },
    actor: StoredUser,
    ip: string,
    userAgent: string
  ): BackupScheduleConfig {
    const current = this.getBackupSchedule();
    const updated: BackupScheduleConfig = {
      ...current,
      lastRunAt: new Date().toISOString(),
      lastRunKey: typeof payload.runKey === 'string' ? payload.runKey : current.lastRunKey,
      lastRunStatus: payload.status,
      lastRunSummary: payload.summary,
    };
    this.data.backupSchedule = updated;
    this.persist();

    this.appendAudit({
      action: 'SCHEDULED_BACKUP_RUN',
      outcome: payload.status === 'failed' ? 'FAILURE' : 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: current.frequency,
      ip,
      userAgent,
      details: payload.summary,
    });

    return updated;
  }
}

export const authStore = new AuthStore();

export function getCookieOptions(req: Request, maxAge?: number): CookieOptions {
  const secure = isSecureRequest(req);
  const opts: CookieOptions & { partitioned?: boolean } = {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    path: '/',
  };
  if (maxAge !== undefined) {
    opts.maxAge = maxAge;
  }
  if (secure) {
    opts.partitioned = true;
  }
  return opts;
}

export function setPreAuthCsrfCookie(res: Response, req: Request, token: string) {
  res.cookie(PRE_CSRF_COOKIE_NAME, token, getCookieOptions(req, 60 * 60 * 1000));
}

export function setSessionCookie(res: Response, req: Request, sessionId: string, isVerified: boolean) {
  const maxAge = isVerified ? ABSOLUTE_SESSION_MAX_MS : PENDING_MFA_MAX_MS;
  res.cookie(SESSION_COOKIE_NAME, sessionId, getCookieOptions(req, maxAge));
}

export function clearSessionCookie(res: Response, req: Request) {
  res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions(req));
}
