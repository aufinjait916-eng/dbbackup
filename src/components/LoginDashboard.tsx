import React, { useState, useEffect } from 'react';
import {
  Database,
  Lock,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  Download,
  ArrowLeft,
  Sun,
  Moon,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { AuthFlowStatus, AuthUser } from '../types';
import { apiFetch, getCsrfToken, setCsrfToken } from '../utils/apiClient';
import { triggerBrowserDownload } from '../utils/backupEngine';

interface LoginDashboardProps {
  status: AuthFlowStatus;
  pendingUser: AuthUser | null;
  sessionExpiredNotice: boolean;
  inactivityTimeoutMinutes: number;
  isDark: boolean;
  toggleDark: () => void;
  onAuthSuccess: (user: AuthUser, csrfToken: string) => void;
  onStepChange: (nextStatus: AuthFlowStatus, user: AuthUser | null, csrfToken: string) => void;
}

export const LoginDashboard: React.FC<LoginDashboardProps> = ({
  status,
  pendingUser,
  sessionExpiredNotice,
  inactivityTimeoutMinutes,
  isDark,
  toggleDark,
  onAuthSuccess,
  onStepChange,
}) => {
  // Login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cookieBlockedHint, setCookieBlockedHint] = useState<boolean>(false);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  // MFA Setup state
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [manualSecret, setManualSecret] = useState<string>('');
  const [setupLoading, setSetupLoading] = useState<boolean>(false);
  const [secretCopied, setSecretCopied] = useState<boolean>(false);
  const [setupOtp, setSetupOtp] = useState<string>('');
  const [setupVerifying, setSetupVerifying] = useState<boolean>(false);

  // Post-setup backup codes acknowledgment screen
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [verifiedUserCache, setVerifiedUserCache] = useState<{ user: AuthUser; csrf: string } | null>(null);
  const [codesConfirmed, setCodesConfirmed] = useState<boolean>(false);
  const [codesCopied, setCodesCopied] = useState<boolean>(false);

  // MFA Verify (returning user) state
  const [verifyOtp, setVerifyOtp] = useState<string>('');
  const [useBackupCode, setUseBackupCode] = useState<boolean>(false);
  const [verifyLoading, setVerifyLoading] = useState<boolean>(false);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // Automatically initialize TOTP QR setup when entering MFA_SETUP_REQUIRED
  const initMfaSetup = async () => {
    setSetupLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/auth/mfa/setup/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to initialize TOTP setup.');
        return;
      }
      setQrDataUrl(data.qrDataUrl);
      setManualSecret(data.manualSecret);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error initializing MFA setup.');
    } finally {
      setSetupLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'MFA_SETUP_REQUIRED' && !backupCodes && !qrDataUrl) {
      initMfaSetup();
    }
  }, [status, backupCodes, qrDataUrl]);

  const refreshPreAuthCsrf = async (): Promise<string> => {
    const csrfRes = await fetch('/api/auth/csrf', { credentials: 'include' });
    if (csrfRes.ok) {
      const csrfData = await csrfRes.json();
      if (csrfData.csrfToken) {
        setCsrfToken(csrfData.csrfToken);
        return csrfData.csrfToken;
      }
    }
    return '';
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || lockoutSeconds > 0) return;

    setLoginLoading(true);
    setErrorMsg(null);
    setCookieBlockedHint(false);

    try {
      if (!getCsrfToken()) {
        await refreshPreAuthCsrf();
      }

      const attemptLogin = () =>
        apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password }),
        });

      let res = await attemptLogin();
      // If CSRF token was missing or stale (e.g., server restart or fresh cookie needed), refresh and retry once
      if (res.status === 403) {
        await refreshPreAuthCsrf();
        res = await attemptLogin();
      }

      const data = await res.json();

      if (!res.ok) {
        if (data.retryAfterSec) {
          setLockoutSeconds(data.retryAfterSec);
        }
        if (res.status === 403 && window.self !== window.top) {
          setCookieBlockedHint(true);
        }
        setErrorMsg(data.error || 'Authentication failed.');
        return;
      }

      setCsrfToken(data.csrfToken);
      setPassword('');
      setQrDataUrl('');
      setManualSecret('');
      setSetupOtp('');
      setVerifyOtp('');
      setBackupCodes(null);
      onStepChange(data.status, data.user, data.csrfToken);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to reach authentication server.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleMfaSetupVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupOtp.trim()) return;

    setSetupVerifying(true);
    setErrorMsg(null);

    try {
      const res = await apiFetch('/api/auth/mfa/setup/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: setupOtp.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'OTP verification failed.');
        if (res.status === 429 || res.status === 401) {
          if (data.error?.includes('sign in again')) {
            setTimeout(() => {
              onStepChange('UNAUTHENTICATED', null, '');
            }, 1500);
          }
        }
        return;
      }

      setCsrfToken(data.csrfToken);
      setBackupCodes(data.backupCodes || []);
      setVerifiedUserCache({ user: data.user, csrf: data.csrfToken });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error verifying OTP.');
    } finally {
      setSetupVerifying(false);
    }
  };

  const handleMfaLoginVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyOtp.trim()) return;

    setVerifyLoading(true);
    setErrorMsg(null);

    try {
      const res = await apiFetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: verifyOtp.trim(),
          isBackupCode: useBackupCode,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || 'MFA verification failed.');
        if (res.status === 429) {
          setTimeout(() => {
            onStepChange('UNAUTHENTICATED', null, '');
          }, 1500);
        }
        return;
      }

      setCsrfToken(data.csrfToken);
      onAuthSuccess(data.user, data.csrfToken);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error verifying MFA.');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleCancelPending = async () => {
    setErrorMsg(null);
    setQrDataUrl('');
    setManualSecret('');
    setBackupCodes(null);
    try {
      const res = await apiFetch('/api/auth/logout', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setCsrfToken(data.csrfToken || '');
      onStepChange('UNAUTHENTICATED', null, data.csrfToken || '');
    } catch {
      onStepChange('UNAUTHENTICATED', null, '');
    }
  };

  const handleCopySecret = () => {
    if (!manualSecret) return;
    navigator.clipboard.writeText(manualSecret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  const handleCopyBackupCodes = () => {
    if (!backupCodes) return;
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCodesCopied(true);
    setTimeout(() => setCodesCopied(false), 2000);
  };

  const handleDownloadBackupCodes = () => {
    if (!backupCodes || !pendingUser) return;
    const text = [
      'TrueNAS PostgreSQL Backup Manager — MFA Recovery Backup Codes',
      `Account: ${pendingUser.username} (${pendingUser.role})`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'Store these single-use recovery codes in a secure password manager.',
      'Each code can be used once if you lose access to your authenticator app:',
      '',
      ...backupCodes.map((c, idx) => `${String(idx + 1).padStart(2, '0')}. ${c}`),
      '',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    triggerBrowserDownload(blob, `truenas-pg-backup-recovery-codes-${pendingUser.username}.txt`);
  };

  const handleCompleteOnboarding = () => {
    if (verifiedUserCache) {
      onAuthSuccess(verifiedUserCache.user, verifiedUserCache.csrf);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors">
      {/* Minimal Top Bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white shadow-xs">
            <Database className="w-4 h-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            TrueNAS Postgres Backup
          </span>
        </div>

        <button
          onClick={toggleDark}
          className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Toggle dark mode"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Main Auth Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs p-6 sm:p-8 space-y-6">
          {/* Step 1: Username + Password Login */}
          {status === 'UNAUTHENTICATED' && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>Protected Infrastructure Console</span>
                  <span aria-hidden="true">·</span>
                  <span>MFA Required</span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Sign in to Backup Console
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Authenticate with your assigned IT or Manager account to access PostgreSQL backups.
                </p>
              </div>

              {sessionExpiredNotice && !errorMsg && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Your session expired after {inactivityTimeoutMinutes} minutes of inactivity. Please sign in again.
                  </span>
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p>{errorMsg}</p>
                    {lockoutSeconds > 0 && (
                      <p className="font-mono tabular-nums text-[11px]">
                        Lockout resets in {Math.floor(lockoutSeconds / 60)}:
                        {String(lockoutSeconds % 60).padStart(2, '0')}
                      </p>
                    )}
                    {cookieBlockedHint && (
                      <div className="pt-1">
                        <p className="text-[11px] opacity-90 mb-1.5">
                          Your browser blocked secure session cookies inside the embedded preview frame.
                        </p>
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors"
                        >
                          <span>Open Console in New Tab</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-username"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Username or Email
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loginLoading || lockoutSeconds > 0}
                    placeholder="Enter username or email"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loginLoading || lockoutSeconds > 0}
                      placeholder="Enter your password"
                      className="w-full pl-3 pr-10 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loginLoading || lockoutSeconds > 0 || !username.trim() || !password}
                  className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                >
                  <Lock className="w-4 h-4" />
                  <span>{loginLoading ? 'Verifying Credentials...' : 'Continue to Verification'}</span>
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Public registration is disabled. Only IT administrators can provision or reset user accounts.
              </div>
            </>
          )}

          {/* Step 2A: Mandatory First-Login TOTP MFA Setup */}
          {status === 'MFA_SETUP_REQUIRED' && !backupCodes && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>Step 2 of 2</span>
                  <span aria-hidden="true">·</span>
                  <span>{pendingUser?.username}</span>
                  <span aria-hidden="true">·</span>
                  <span>{pendingUser?.role}</span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Enroll Multi-Factor Authentication
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  TOTP MFA is mandatory before accessing TrueNAS database backups. Scan this QR code with Google Authenticator, 1Password, or Bitwarden.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
                {setupLoading ? (
                  <div className="w-44 h-44 flex items-center justify-center text-xs text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                    Generating QR...
                  </div>
                ) : qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="TOTP Authenticator QR Code"
                    className="w-44 h-44 rounded-lg bg-white p-2 border border-slate-200"
                  />
                ) : null}

                {manualSecret && (
                  <div className="w-full space-y-1">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                      Or enter setup key manually:
                    </div>
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <code className="font-mono text-xs text-slate-800 dark:text-slate-200 tracking-wider truncate">
                        {manualSecret}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 shrink-0"
                        title="Copy manual key"
                      >
                        {secretCopied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={handleMfaSetupVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="setup-otp"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    6-Digit Verification Code
                  </label>
                  <input
                    id="setup-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={setupOtp}
                    onChange={(e) => setSetupOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={setupVerifying || setupOtp.length !== 6}
                  className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{setupVerifying ? 'Activating MFA...' : 'Verify & Generate Recovery Codes'}</span>
                </button>
              </form>

              <button
                type="button"
                onClick={handleCancelPending}
                className="w-full py-2 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Cancel and return to login</span>
              </button>
            </>
          )}

          {/* Step 2A-Complete: Display Single-Use Recovery Backup Codes */}
          {backupCodes && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>MFA Activated</span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Save Your Recovery Backup Codes
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Each recovery code can be used once if you lose access to your authenticator device. They will not be shown again.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs tabular-nums">
                {backupCodes.map((code) => (
                  <div
                    key={code}
                    className="px-2.5 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-slate-800 dark:text-slate-200 select-all"
                  >
                    {code}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyBackupCodes}
                  className="flex-1 py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  {codesCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{codesCopied ? 'Copied' : 'Copy All'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadBackupCodes}
                  className="flex-1 py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .txt</span>
                </button>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={codesConfirmed}
                  onChange={(e) => setCodesConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 rounded"
                />
                <span>I have securely stored these 8 recovery backup codes.</span>
              </label>

              <button
                type="button"
                disabled={!codesConfirmed}
                onClick={handleCompleteOnboarding}
                className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enter Backup Dashboard
              </button>
            </>
          )}

          {/* Step 2B: Returning User TOTP / Backup Code Verification */}
          {status === 'MFA_REQUIRED' && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>Step 2 of 2</span>
                  <span aria-hidden="true">·</span>
                  <span>{pendingUser?.username}</span>
                  <span aria-hidden="true">·</span>
                  <span>{pendingUser?.role}</span>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Two-Factor Verification
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {useBackupCode
                    ? 'Enter one of your unused 8-character recovery backup codes.'
                    : 'Enter the 6-digit code from your authenticator app.'}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleMfaLoginVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="verify-otp"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    {useBackupCode ? 'Recovery Backup Code' : '6-Digit OTP Code'}
                  </label>
                  <input
                    id="verify-otp"
                    type="text"
                    inputMode={useBackupCode ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    maxLength={useBackupCode ? 12 : 6}
                    required
                    value={verifyOtp}
                    onChange={(e) => {
                      const val = e.target.value;
                      setVerifyOtp(
                        useBackupCode ? val.toUpperCase() : val.replace(/\D/g, '').slice(0, 6)
                      );
                    }}
                    placeholder={useBackupCode ? 'XXXX-XXXX' : '000000'}
                    className={`w-full px-3 py-2.5 text-center font-mono text-lg tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${
                      useBackupCode ? 'tracking-widest' : 'tracking-[0.4em]'
                    }`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    verifyLoading ||
                    (useBackupCode ? verifyOtp.trim().length < 8 : verifyOtp.length !== 6)
                  }
                  className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{verifyLoading ? 'Verifying...' : 'Verify & Unlock Console'}</span>
                </button>
              </form>

              <div className="pt-2 flex flex-col gap-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setUseBackupCode(!useBackupCode);
                    setVerifyOtp('');
                    setErrorMsg(null);
                  }}
                  className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {useBackupCode ? 'Use 6-digit authenticator code instead' : 'Use a recovery backup code'}
                </button>

                <button
                  type="button"
                  onClick={handleCancelPending}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 flex items-center justify-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Sign in with a different account</span>
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
