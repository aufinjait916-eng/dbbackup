import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  authStore,
  SESSION_COOKIE_NAME,
  PRE_CSRF_COOKIE_NAME,
  UserRole,
  StoredUser,
  SessionRecord,
  sanitizeUser,
  setSessionCookie,
  clearSessionCookie,
  setPreAuthCsrfCookie,
  createPreAuthCsrfToken,
  verifyPreAuthCsrfToken,
  timingSafeEqualStr,
  getClientIp,
  getInactivityTimeoutMinutes,
} from './server/authStore.ts';

dotenv.config();

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// In AI Studio / Cloud Run, process.env.PORT=8080 is reserved for Nginx ingress.
// The Node app dev server must always bind to port 3000 (DEFAULT_APP_PORT).
const portArgIndex = process.argv.indexOf('--port');
const cliPort = portArgIndex !== -1 ? parseInt(process.argv[portArgIndex + 1], 10) : NaN;
const rawPort =
  process.env.APP_PORT ||
  process.env.DEFAULT_APP_PORT ||
  (process.env.PORT && process.env.PORT !== '8080' ? process.env.PORT : '3000');
const PORT = !isNaN(cliPort) ? cliPort : parseInt(rawPort, 10);
const isProd = process.env.NODE_ENV === 'production';

// Extend Express Request with authenticated context
interface AuthenticatedRequest extends Request {
  authSession?: SessionRecord;
  authUser?: StoredUser;
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security headers on all responses
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// Container health check (no sensitive data)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Attach session & user if cookie is present
function resolveAuthContext(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const resolved = authStore.getSessionAndUser(sessionId, req);

  if (resolved && 'expired' in resolved) {
    clearSessionCookie(res, req);
    return next();
  }

  if (resolved) {
    req.authSession = resolved.session;
    req.authUser = resolved.user;
  }
  next();
}

app.use(resolveAuthContext);

// Middleware: Validate CSRF token on all state-changing API requests
function verifyCsrf(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const headerToken = req.headers['x-csrf-token'];
  const token = typeof headerToken === 'string' ? headerToken : '';

  if (req.authSession) {
    if (!token || !timingSafeEqualStr(token, req.authSession.csrfToken)) {
      console.warn(
        `[AUTH TRACE] ${new Date().toISOString()} CSRF_SESSION_REJECTED ${JSON.stringify({
          path: req.path,
          hasHeaderToken: Boolean(token),
          hasSessionCookie: true,
          userId: req.authUser?.id || null,
          ip: getClientIp(req),
        })}`
      );
      authStore.appendAudit({
        action: 'CSRF_REJECTED',
        outcome: 'DENIED',
        actorId: req.authUser?.id || null,
        actorUsername: req.authUser?.username || 'unknown',
        actorRole: req.authUser?.role || 'ANONYMOUS',
        target: req.path,
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || 'unknown'),
        details: `CSRF validation failed on ${req.method} ${req.path}.`,
      });
      return res.status(403).json({ error: 'Invalid or missing CSRF token. Refresh the page and try again.' });
    }
    return next();
  }

  // Pre-auth CSRF validation (used for /api/auth/login)
  const cookieToken = req.cookies?.[PRE_CSRF_COOKIE_NAME] as string | undefined;
  const tokensMatch = Boolean(token && cookieToken && timingSafeEqualStr(token, cookieToken));
  const signatureValid = tokensMatch && verifyPreAuthCsrfToken(token);
  if (!token || !cookieToken || !tokensMatch || !signatureValid) {
    console.warn(
      `[AUTH TRACE] ${new Date().toISOString()} CSRF_PREAUTH_REJECTED ${JSON.stringify({
        path: req.path,
        hasHeaderToken: Boolean(token),
        hasPreCsrfCookie: Boolean(cookieToken),
        tokensMatch,
        signatureValid,
        origin: req.headers['origin'] || null,
        xForwardedProto: req.headers['x-forwarded-proto'] || null,
        ip: getClientIp(req),
      })}`
    );
    authStore.appendAudit({
      action: 'CSRF_REJECTED',
      outcome: 'DENIED',
      actorId: null,
      actorUsername: 'anonymous',
      actorRole: 'ANONYMOUS',
      target: req.path,
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || 'unknown'),
      details: `Pre-auth CSRF validation failed on ${req.method} ${req.path}.`,
    });
    return res.status(403).json({ error: 'Invalid or expired security token. Please refresh and try again.' });
  }

  next();
}

// Middleware: Require fully authenticated + MFA-verified session
function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.authSession || !req.authUser) {
    return res.status(401).json({
      error: 'Authentication required. Your session may have expired due to inactivity.',
      code: 'UNAUTHENTICATED',
    });
  }

  if (!req.authSession.mfaVerified) {
    return res.status(403).json({
      error: 'Multi-Factor Authentication (TOTP) verification is required before accessing this resource.',
      code: req.authUser.mustSetupMfa || !req.authUser.mfaEnabled ? 'MFA_SETUP_REQUIRED' : 'MFA_REQUIRED',
    });
  }

  next();
}

// Middleware: Require pending MFA session (authenticated via password, awaiting MFA setup/verify)
function requirePendingMfa(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.authSession || !req.authUser) {
    return res.status(401).json({
      error: 'Login session expired. Please sign in with your username and password again.',
      code: 'UNAUTHENTICATED',
    });
  }
  next();
}

// Middleware: Strict RBAC role guard
function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser || !allowedRoles.includes(req.authUser.role)) {
      authStore.appendAudit({
        action: 'RBAC_DENIED',
        outcome: 'DENIED',
        actorId: req.authUser?.id || null,
        actorUsername: req.authUser?.username || 'unknown',
        actorRole: req.authUser?.role || 'ANONYMOUS',
        target: req.path,
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || 'unknown'),
        details: `Role '${req.authUser?.role || 'NONE'}' denied access to ${req.method} ${req.path}. Required: ${allowedRoles.join(', ')}.`,
      });
      return res.status(403).json({
        error: `Access denied. This action requires ${allowedRoles.join(' or ')} privileges.`,
        code: 'FORBIDDEN',
      });
    }
    next();
  };
}

// ==============================================================================
// Authentication & MFA Routes
// ==============================================================================

// Issue CSRF token (bound to active session if authenticated, or signed pre-auth cookie)
app.get('/api/auth/csrf', (req: AuthenticatedRequest, res: Response) => {
  if (req.authSession) {
    return res.json({ csrfToken: req.authSession.csrfToken });
  }
  const token = createPreAuthCsrfToken();
  setPreAuthCsrfCookie(res, req, token);
  return res.json({ csrfToken: token });
});

// Check current authentication & MFA status
app.get('/api/auth/me', (req: AuthenticatedRequest, res: Response) => {
  const timeoutMinutes = getInactivityTimeoutMinutes();

  if (!req.authSession || !req.authUser) {
    const preCsrf = createPreAuthCsrfToken();
    setPreAuthCsrfCookie(res, req, preCsrf);
    return res.json({
      authenticated: false,
      status: 'UNAUTHENTICATED',
      csrfToken: preCsrf,
      inactivityTimeoutMinutes: timeoutMinutes,
    });
  }

  const mfaStatus = req.authSession.mfaVerified
    ? 'AUTHENTICATED'
    : req.authUser.mustSetupMfa || !req.authUser.mfaEnabled
    ? 'MFA_SETUP_REQUIRED'
    : 'MFA_REQUIRED';

  return res.json({
    authenticated: req.authSession.mfaVerified,
    status: mfaStatus,
    user: sanitizeUser(req.authUser),
    csrfToken: req.authSession.csrfToken,
    inactivityTimeoutMinutes: timeoutMinutes,
    lastActivityAt: new Date(req.authSession.lastActivityAt).toISOString(),
  });
});

// Step 1: Login with username/email + password (public signup is intentionally disabled)
app.post('/api/auth/login', verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const requestId = crypto.randomBytes(6).toString('hex');
  const { username, password } = req.body || {};
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  console.log(
    `[AUTH TRACE] ${new Date().toISOString()} HTTP_POST_LOGIN ${JSON.stringify({
      requestId,
      ip,
      hasUsername: typeof username === 'string' && username.trim().length > 0,
      hasPassword: typeof password === 'string' && password.length > 0,
      hasPreCsrfCookie: Boolean(req.cookies?.[PRE_CSRF_COOKIE_NAME]),
      hasExistingSessionCookie: Boolean(req.cookies?.[SESSION_COOKIE_NAME]),
      origin: req.headers['origin'] || null,
    })}`
  );

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ error: 'Username/email and password are required.' });
  }

  const result = authStore.authenticatePassword(username, password, ip, ua, requestId);

  if (!result.ok) {
    if (result.retryAfterSec) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
    }
    console.warn(
      `[AUTH TRACE] ${new Date().toISOString()} HTTP_POST_LOGIN_RESULT ${JSON.stringify({
        requestId,
        statusCode: result.statusCode,
        ok: false,
        retryAfterSec: result.retryAfterSec || null,
      })}`
    );
    return res.status(result.statusCode).json({
      error: result.error,
      retryAfterSec: result.retryAfterSec,
    });
  }

  // Set pending-MFA HttpOnly session cookie
  setSessionCookie(res, req, result.session.id, false);
  console.log(
    `[AUTH TRACE] ${new Date().toISOString()} HTTP_POST_LOGIN_RESULT ${JSON.stringify({
      requestId,
      statusCode: 200,
      ok: true,
      nextStep: result.status,
      userId: result.user.id,
    })}`
  );

  return res.json({
    status: result.status,
    user: sanitizeUser(result.user),
    csrfToken: result.session.csrfToken,
    inactivityTimeoutMinutes: getInactivityTimeoutMinutes(),
  });
});

// Step 2A: Initialize mandatory first-login TOTP MFA setup (returns QR code + manual secret)
app.post('/api/auth/mfa/setup/init', requirePendingMfa, verifyCsrf, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.authUser!;
  const session = req.authSession!;

  if (user.mfaEnabled && !user.mustSetupMfa) {
    return res.status(400).json({ error: 'MFA is already active on this account.' });
  }

  try {
    const setupData = await authStore.initMfaSetup(
      session,
      user,
      getClientIp(req),
      String(req.headers['user-agent'] || 'unknown')
    );
    return res.json({
      qrDataUrl: setupData.qrDataUrl,
      manualSecret: setupData.manualSecret,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to initialize TOTP setup.',
    });
  }
});

// Step 2B: Verify first-login TOTP OTP and receive 8 single-use backup recovery codes
app.post('/api/auth/mfa/setup/verify', requirePendingMfa, verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const user = req.authUser!;
  const session = req.authSession!;
  const { code } = req.body || {};

  if (typeof code !== 'string') {
    return res.status(400).json({ error: '6-digit OTP code is required.' });
  }

  const requestId = crypto.randomBytes(6).toString('hex');
  const result = authStore.completeMfaSetup(
    session,
    user,
    code,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown'),
    requestId
  );

  if (!result.ok) {
    if (result.statusCode === 429) {
      clearSessionCookie(res, req);
    }
    return res.status(result.statusCode).json({ error: result.error });
  }

  // Upgrade cookie to elevated verified session
  setSessionCookie(res, req, result.session.id, true);

  return res.json({
    authenticated: true,
    status: 'AUTHENTICATED',
    user: sanitizeUser(user),
    backupCodes: result.backupCodes,
    csrfToken: result.session.csrfToken,
    inactivityTimeoutMinutes: getInactivityTimeoutMinutes(),
  });
});

// Step 2C: Verify returning user's 6-digit TOTP or single-use backup code
app.post('/api/auth/mfa/verify', requirePendingMfa, verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const user = req.authUser!;
  const session = req.authSession!;
  const { code, isBackupCode } = req.body || {};

  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'Verification code is required.' });
  }

  const requestId = crypto.randomBytes(6).toString('hex');
  const result = authStore.verifyMfaLogin(
    session,
    user,
    code,
    Boolean(isBackupCode),
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown'),
    requestId
  );

  if (!result.ok) {
    if (result.statusCode === 429) {
      clearSessionCookie(res, req);
    }
    return res.status(result.statusCode).json({ error: result.error });
  }

  setSessionCookie(res, req, result.session.id, true);

  return res.json({
    authenticated: true,
    status: 'AUTHENTICATED',
    user: sanitizeUser(user),
    usedBackupCode: result.usedBackupCode,
    csrfToken: result.session.csrfToken,
    inactivityTimeoutMinutes: getInactivityTimeoutMinutes(),
  });
});

// Logout
app.post('/api/auth/logout', verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  if (req.authSession && req.authUser) {
    authStore.destroySession(req.authSession.id);
    authStore.appendAudit({
      action: 'LOGOUT',
      outcome: 'SUCCESS',
      actorId: req.authUser.id,
      actorUsername: req.authUser.username,
      actorRole: req.authUser.role,
      target: req.authUser.username,
      ip: getClientIp(req),
      userAgent: String(req.headers['user-agent'] || 'unknown'),
      details: 'User signed out and terminated session.',
    });
  }
  clearSessionCookie(res, req);

  const preCsrf = createPreAuthCsrfToken();
  setPreAuthCsrfCookie(res, req, preCsrf);

  return res.json({ ok: true, csrfToken: preCsrf });
});

// Self-service password change (requires active MFA-verified session)
app.post('/api/auth/change-password', requireAuth, verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  const result = authStore.changeOwnPassword(
    req.authUser!,
    currentPassword,
    newPassword,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown')
  );

  if (!result.ok) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.json({ ok: true, message: 'Password updated successfully.' });
});

// ==============================================================================
// IT-Only User Management & Audit Log Routes
// ==============================================================================

app.get('/api/users', requireAuth, requireRole('IT'), (_req: AuthenticatedRequest, res: Response) => {
  return res.json({ users: authStore.listUsers() });
});

app.post('/api/users', requireAuth, requireRole('IT'), verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const { username, displayName, email, role, password } = req.body || {};
  const result = authStore.createUser(
    { username, displayName, email, role, password },
    req.authUser!,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown')
  );

  if (!result.ok) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.status(201).json({ user: result.user });
});

app.patch('/api/users/:id', requireAuth, requireRole('IT'), verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const result = authStore.updateUser(
    req.params.id,
    req.body || {},
    req.authUser!,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown')
  );

  if (!result.ok) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.json({ user: result.user });
});

app.delete('/api/users/:id', requireAuth, requireRole('IT'), verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const result = authStore.deleteUser(
    req.params.id,
    req.authUser!,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown')
  );

  if (!result.ok) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.json({ ok: true });
});

app.post(
  '/api/users/:id/reset-mfa',
  requireAuth,
  requireRole('IT'),
  verifyCsrf,
  (req: AuthenticatedRequest, res: Response) => {
    const result = authStore.resetUserMfa(
      req.params.id,
      req.authUser!,
      getClientIp(req),
      String(req.headers['user-agent'] || 'unknown')
    );

    if (!result.ok) {
      return res.status(result.statusCode).json({ error: result.error });
    }

    return res.json({ user: result.user });
  }
);

app.get('/api/audit-logs', requireAuth, requireRole('IT'), (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit || '300'), 10) || 300, 1000);
  return res.json({ logs: authStore.getAuditLogs(limit) });
});

// ==============================================================================
// Automatic Backup Schedule Routes (Authenticated IT & Manager)
// ==============================================================================

app.get('/api/schedule', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  return res.json({ schedule: authStore.getBackupSchedule() });
});

app.put('/api/schedule', requireAuth, verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const result = authStore.updateBackupSchedule(
    req.body || {},
    req.authUser!,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown')
  );

  if (!result.ok) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.json({ schedule: result.schedule });
});

app.post('/api/schedule/run-record', requireAuth, verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const { runKey, status, summary } = req.body || {};
  const validStatuses = ['success', 'partial', 'failed'];
  const normalizedStatus = validStatuses.includes(status) ? status : 'success';
  const cleanSummary =
    typeof summary === 'string' && summary.trim().length > 0
      ? summary.trim().slice(0, 500)
      : 'Scheduled backup completed.';

  const schedule = authStore.recordScheduledRun(
    {
      runKey: typeof runKey === 'string' ? runKey : undefined,
      status: normalizedStatus,
      summary: cleanSummary,
    },
    req.authUser!,
    getClientIp(req),
    String(req.headers['user-agent'] || 'unknown')
  );

  return res.json({ schedule });
});

// ==============================================================================
// Protected PostgreSQL Backup & TrueNAS Configuration Routes
// ==============================================================================

function getEffectivePostgresConfig(overrides?: {
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | string;
}) {
  const host =
    overrides?.host ||
    process.env.TRUENAS_POSTGRES_HOST ||
    process.env.POSTGRES_HOST ||
    process.env.PGHOST ||
    process.env.DB_HOST ||
    'localhost';

  const port = parseInt(
    String(
      overrides?.port ||
        process.env.TRUENAS_POSTGRES_PORT ||
        process.env.POSTGRES_PORT ||
        process.env.PGPORT ||
        process.env.DB_PORT ||
        '5432'
    ),
    10
  );

  const user =
    overrides?.user ||
    process.env.TRUENAS_POSTGRES_USER ||
    process.env.POSTGRES_USER ||
    process.env.PGUSER ||
    process.env.DB_USER ||
    'postgres';

  const password =
    overrides?.password !== undefined
      ? overrides.password
      : process.env.TRUENAS_POSTGRES_PASSWORD ||
        process.env.POSTGRES_PASSWORD ||
        process.env.PGPASSWORD ||
        process.env.DB_PASSWORD ||
        '';

  const defaultDb =
    overrides?.database ||
    process.env.TRUENAS_POSTGRES_DB ||
    process.env.POSTGRES_DATABASE ||
    process.env.PGDATABASE ||
    process.env.DB_NAME ||
    'postgres';

  const rawSsl =
    overrides?.ssl !== undefined
      ? overrides.ssl
      : process.env.TRUENAS_POSTGRES_SSL ||
        process.env.POSTGRES_SSL ||
        process.env.PGSSLMODE ||
        'false';

  const ssl =
    rawSsl === true ||
    rawSsl === 'true' ||
    rawSsl === 'require' ||
    rawSsl === 'prefer'
      ? { rejectUnauthorized: false }
      : false;

  return { host, port, user, password, defaultDb, ssl };
}

// 1. Get current server configuration status (Locked behind requireAuth)
app.get('/api/config', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const config = getEffectivePostgresConfig();
  const envKeysFound: string[] = [];

  [
    'TRUENAS_POSTGRES_HOST',
    'POSTGRES_HOST',
    'PGHOST',
    'TRUENAS_POSTGRES_USER',
    'POSTGRES_USER',
    'PGUSER',
    'TRUENAS_POSTGRES_PASSWORD',
    'POSTGRES_PASSWORD',
    'PGPASSWORD',
    'TRUENAS_POSTGRES_PORT',
    'POSTGRES_PORT',
    'PGPORT',
    'TRUENAS_POSTGRES_DB',
    'POSTGRES_DATABASE',
  ].forEach((key) => {
    if (process.env[key]) {
      envKeysFound.push(key);
    }
  });

  // Only IT admins see full env var key list
  const isIt = req.authUser?.role === 'IT';

  res.json({
    configured: envKeysFound.length > 0 || !!process.env.POSTGRES_HOST,
    host: config.host,
    port: config.port,
    user: config.user,
    defaultDb: config.defaultDb,
    sslEnabled: !!config.ssl,
    hasPassword: Boolean(config.password && config.password.length > 0),
    detectedEnvKeys: isIt ? envKeysFound : [],
    truenasPlatform:
      process.env.TRUENAS_SCALE === 'true' ||
      !!process.env.TRUENAS_POSTGRES_HOST ||
      process.env.CONTAINER_NAME?.includes('truenas') ||
      false,
    nodeVersion: isIt ? process.version : undefined,
    serverTime: new Date().toISOString(),
  });
});

// 2. Test PostgreSQL Connection (Locked behind requireAuth + CSRF)
app.post('/api/test-connection', requireAuth, verifyCsrf, async (req: AuthenticatedRequest, res: Response) => {
  const overrides = req.body || {};
  const config = getEffectivePostgresConfig(overrides);
  const startTime = Date.now();
  const actor = req.authUser!;
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: overrides.database || config.defaultDb,
    ssl: config.ssl,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const result = await client.query(
      'SELECT version() as version, current_database() as current_db, current_user as current_user;'
    );
    await client.end();

    const latency = Date.now() - startTime;
    authStore.appendAudit({
      action: 'CONNECTION_TESTED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: `${config.host}:${config.port}`,
      ip,
      userAgent: ua,
      details: `PostgreSQL connection verified in ${latency}ms.`,
    });

    return res.json({
      success: true,
      message: `Successfully connected to PostgreSQL at ${config.host}:${config.port}`,
      version: result.rows[0]?.version || 'PostgreSQL (unknown version)',
      currentDatabase: result.rows[0]?.current_db || config.defaultDb,
      currentUser: result.rows[0]?.current_user || config.user,
      latencyMs: latency,
    });
  } catch (err: unknown) {
    try {
      await client.end();
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    let hint = 'Check that your PostgreSQL server is running and accessible.';
    if (code === 'ECONNREFUSED') {
      hint = `Connection refused at ${config.host}:${config.port}. Verify host name, port, and firewall rules in TrueNAS.`;
    } else if (code === '28P01') {
      hint = 'Password authentication failed for user. Check POSTGRES_PASSWORD.';
    } else if (code === '28000') {
      hint = 'Authentication failed. Check your pg_hba.conf configuration.';
    } else if (code === 'ENOTFOUND') {
      hint = `DNS resolution failed for hostname '${config.host}'. Ensure the TrueNAS container or host has network access.`;
    }

    authStore.appendAudit({
      action: 'CONNECTION_TESTED',
      outcome: 'FAILURE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: `${config.host}:${config.port}`,
      ip,
      userAgent: ua,
      details: `PostgreSQL connection failed: ${message}`,
    });

    return res.status(500).json({
      success: false,
      message,
      code,
      hint,
      host: config.host,
      port: config.port,
      user: config.user,
    });
  }
});

// 3. Auto-discover databases on PostgreSQL server (Locked behind requireAuth)
app.get('/api/databases', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const config = getEffectivePostgresConfig();
  const actor = req.authUser!;
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.defaultDb,
    ssl: config.ssl,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const query = `
      SELECT 
        d.datname AS name,
        pg_size_pretty(pg_database_size(d.datname)) AS size_pretty,
        pg_database_size(d.datname) AS size_bytes,
        pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
        d.datcollate AS collation
      FROM pg_database d
      WHERE d.datistemplate = false
      ORDER BY d.datname ASC;
    `;
    const result = await client.query(query);
    await client.end();

    authStore.appendAudit({
      action: 'DATABASES_DISCOVERED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: `${config.host}:${config.port}`,
      ip,
      userAgent: ua,
      details: `Discovered ${result.rows.length} databases on server.`,
    });

    return res.json({
      success: true,
      databases: result.rows,
      server: `${config.host}:${config.port}`,
    });
  } catch (err: unknown) {
    try {
      await client.end();
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    authStore.appendAudit({
      action: 'DATABASES_DISCOVERED',
      outcome: 'FAILURE',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: `${config.host}:${config.port}`,
      ip,
      userAgent: ua,
      details: `Database discovery failed: ${message}`,
    });
    return res.status(500).json({
      success: false,
      message,
      hint: 'Unable to query pg_database. Verify permissions and TrueNAS environment variables.',
    });
  }
});

// Pure TypeScript fallback dumper when pg_dump binary is absent or unreachable
async function generatePureSqlDump(
  config: ReturnType<typeof getEffectivePostgresConfig>,
  targetDb: string
): Promise<string> {
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: targetDb,
    ssl: config.ssl,
    connectionTimeoutMillis: 10000,
  });

  await client.connect();

  const timestamp = new Date().toISOString();
  let sql = `-- =====================================================================\n`;
  sql += `-- TrueNAS PostgreSQL Automated Backup\n`;
  sql += `-- Database: ${targetDb}\n`;
  sql += `-- Host: ${config.host}:${config.port}\n`;
  sql += `-- Timestamp: ${timestamp}\n`;
  sql += `-- Generated by: TrueNAS PostgreSQL Backup Manager\n`;
  sql += `-- =====================================================================\n\n`;

  sql += `SET statement_timeout = 0;\n`;
  sql += `SET lock_timeout = 0;\n`;
  sql += `SET client_encoding = 'UTF8';\n`;
  sql += `SET standard_conforming_strings = on;\n`;
  sql += `SET check_function_bodies = false;\n`;
  sql += `SET client_min_messages = warning;\n`;
  sql += `SET row_security = off;\n\n`;

  sql += `BEGIN;\n\n`;

  try {
    const schemasRes = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name;
    `);

    for (const row of schemasRes.rows) {
      if (row.schema_name !== 'public') {
        sql += `CREATE SCHEMA IF NOT EXISTS "${row.schema_name}";\n`;
      }
    }
    sql += `\n`;

    const tablesRes = await client.query(`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `);

    for (const table of tablesRes.rows) {
      const s = table.table_schema;
      const t = table.table_name;
      const fullTableName = `"${s}"."${t}"`;

      if (table.table_type === 'BASE TABLE') {
        sql += `-- Table: ${fullTableName}\n`;
        sql += `DROP TABLE IF EXISTS ${fullTableName} CASCADE;\n`;

        const colsRes = await client.query(
          `
          SELECT 
            column_name, 
            data_type, 
            character_maximum_length, 
            is_nullable, 
            column_default
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position;
        `,
          [s, t]
        );

        const colDefs = colsRes.rows.map((c) => {
          let typeStr = c.data_type;
          if (c.character_maximum_length) {
            typeStr += `(${c.character_maximum_length})`;
          }
          let def = `  "${c.column_name}" ${typeStr}`;
          if (c.column_default) {
            def += ` DEFAULT ${c.column_default}`;
          }
          if (c.is_nullable === 'NO') {
            def += ` NOT NULL`;
          }
          return def;
        });

        const pkRes = await client.query(
          `
          SELECT c.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage c ON c.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2;
        `,
          [s, t]
        );

        if (pkRes.rows.length > 0) {
          const pkCols = pkRes.rows.map((r) => `"${r.column_name}"`).join(', ');
          colDefs.push(`  PRIMARY KEY (${pkCols})`);
        }

        sql += `CREATE TABLE ${fullTableName} (\n${colDefs.join(',\n')}\n);\n\n`;

        const dataRes = await client.query(`SELECT * FROM ${fullTableName};`);
        if (dataRes.rows.length > 0) {
          sql += `-- Data for ${fullTableName} (${dataRes.rows.length} rows)\n`;
          for (const row of dataRes.rows) {
            const cols = Object.keys(row)
              .map((k) => `"${k}"`)
              .join(', ');
            const vals = Object.values(row)
              .map((val) => {
                if (val === null || val === undefined) return 'NULL';
                if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                if (val instanceof Date) return `'${val.toISOString()}'`;
                if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
                return `'${String(val).replace(/'/g, "''")}'`;
              })
              .join(', ');
            sql += `INSERT INTO ${fullTableName} (${cols}) VALUES (${vals});\n`;
          }
          sql += `\n`;
        }
      }
    }

    sql += `COMMIT;\n`;
    sql += `-- End of backup for database: ${targetDb}\n`;
  } finally {
    await client.end();
  }

  return sql;
}

// 4. Backup Endpoint (Locked behind requireAuth + CSRF, audited)
app.post('/api/backup/:database', requireAuth, verifyCsrf, async (req: AuthenticatedRequest, res: Response) => {
  const targetDb = req.params.database;
  const overrides = req.body?.overrides || {};
  const isSimulation = req.body?.simulation === true;
  const config = getEffectivePostgresConfig(overrides);
  const actor = req.authUser!;
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  if (!targetDb || !/^[a-zA-Z0-9_\-]+$/.test(targetDb)) {
    return res.status(400).json({ error: 'Invalid database name' });
  }

  authStore.appendAudit({
    action: 'BACKUP_STARTED',
    outcome: 'SUCCESS',
    actorId: actor.id,
    actorUsername: actor.username,
    actorRole: actor.role,
    target: targetDb,
    ip,
    userAgent: ua,
    details: isSimulation
      ? `Started simulated backup for '${targetDb}'.`
      : `Started PostgreSQL backup for '${targetDb}' on ${config.host}:${config.port}.`,
  });

  // Simulation mode support for previews/testing
  if (isSimulation) {
    const timestamp = new Date().toISOString();
    const simulatedSql = `-- =====================================================================
-- TrueNAS PostgreSQL Simulated / Demo Backup
-- Database: ${targetDb}
-- Host: ${config.host}:${config.port}
-- Timestamp: ${timestamp}
-- Initiated by: ${actor.username} (${actor.role})
-- =====================================================================

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."backup_metadata" (
  "id" serial PRIMARY KEY,
  "database_name" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "status" varchar(32) DEFAULT 'VERIFIED',
  "exported_by" varchar(64) DEFAULT '${actor.username}'
);

INSERT INTO "public"."backup_metadata" ("database_name", "status") 
VALUES ('${targetDb}', 'SUCCESS');

CREATE TABLE IF NOT EXISTS "public"."sample_records" (
  "uuid" varchar(64) PRIMARY KEY,
  "service" varchar(64) NOT NULL,
  "data_payload" jsonb,
  "updated_at" timestamp with time zone DEFAULT now()
);

INSERT INTO "public"."sample_records" ("uuid", "service", "data_payload") 
VALUES 
  ('rec_${Date.now()}_01', '${targetDb}_core', '{"metric": "sync", "status": 200, "truenas_pool": "tank"}'::jsonb),
  ('rec_${Date.now()}_02', '${targetDb}_auth', '{"tokens_valid": true, "session_store": "pg"}'::jsonb);

COMMIT;
-- Completed backup for database: ${targetDb}
`;
    const sizeBytes = Buffer.byteLength(simulatedSql);
    const filename = `${targetDb}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Size', sizeBytes);

    authStore.appendAudit({
      action: 'BACKUP_COMPLETED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: targetDb,
      ip,
      userAgent: ua,
      details: `Completed simulated backup '${filename}' (${sizeBytes} bytes).`,
    });

    return res.send(simulatedSql);
  }

  // Attempt pg_dump safely via execFile (no shell interpolation)
  try {
    const { stdout } = await execFileAsync(
      'pg_dump',
      [
        '-h',
        config.host,
        '-p',
        String(config.port),
        '-U',
        config.user,
        '-d',
        targetDb,
        '--clean',
        '--if-exists',
      ],
      {
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, PGPASSWORD: config.password },
      }
    );

    const filename = `${targetDb}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Method', 'pg_dump');

    authStore.appendAudit({
      action: 'BACKUP_COMPLETED',
      outcome: 'SUCCESS',
      actorId: actor.id,
      actorUsername: actor.username,
      actorRole: actor.role,
      target: targetDb,
      ip,
      userAgent: ua,
      details: `Completed pg_dump backup '${filename}' (${Buffer.byteLength(stdout)} bytes).`,
    });

    return res.send(stdout);
  } catch (pgDumpError) {
    // Fall back to pure TypeScript query-based dumper if pg_dump CLI is unavailable
    try {
      const sql = await generatePureSqlDump(config, targetDb);
      const filename = `${targetDb}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
      res.setHeader('Content-Type', 'application/sql');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Backup-Method', 'native-postgres-client');

      authStore.appendAudit({
        action: 'BACKUP_COMPLETED',
        outcome: 'SUCCESS',
        actorId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        target: targetDb,
        ip,
        userAgent: ua,
        details: `Completed client-side SQL dump '${filename}' (${Buffer.byteLength(sql)} bytes).`,
      });

      return res.send(sql);
    } catch (fallbackError: unknown) {
      const errMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      authStore.appendAudit({
        action: 'BACKUP_FAILED',
        outcome: 'FAILURE',
        actorId: actor.id,
        actorUsername: actor.username,
        actorRole: actor.role,
        target: targetDb,
        ip,
        userAgent: ua,
        details: `Backup failed for '${targetDb}': ${errMsg}`,
      });
      return res.status(500).json({
        error: `Failed to backup database '${targetDb}': ${errMsg}`,
        pgDumpDetail: pgDumpError instanceof Error ? pgDumpError.message : undefined,
        hint: 'Check TrueNAS environment variables (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD) and ensure the PostgreSQL service is reachable.',
      });
    }
  }
});

// Record ZIP bundle download in audit log
app.post('/api/audit/zip-download', requireAuth, verifyCsrf, (req: AuthenticatedRequest, res: Response) => {
  const { databases } = req.body || {};
  const list = Array.isArray(databases) ? databases.filter((d) => typeof d === 'string') : [];
  authStore.appendAudit({
    action: 'ZIP_BUNDLE_DOWNLOADED',
    outcome: 'SUCCESS',
    actorId: req.authUser!.id,
    actorUsername: req.authUser!.username,
    actorRole: req.authUser!.role,
    target: list.join(', ') || 'bundle',
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || 'unknown'),
    details: `Downloaded combined ZIP archive containing ${list.length} database backup(s).`,
  });
  return res.json({ ok: true });
});

// Catch-all for unknown /api/* routes so they don't fall through to SPA HTML
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Vite middleware in dev or static serve in prod
async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req: Request, res: Response, next: NextFunction) => {
      const url = req.originalUrl;
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let template = await fs.promises.readFile(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (err) {
        next(err);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`TrueNAS PostgreSQL Backup Server ready on http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err) => {
    console.error(`Server error on port ${PORT}:`, err);
  });
}

startServer();
