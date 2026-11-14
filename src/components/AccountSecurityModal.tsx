import React, { useState } from 'react';
import { X, KeyRound, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { AuthUser } from '../types';
import { apiFetch } from '../utils/apiClient';

interface AccountSecurityModalProps {
  user: AuthUser;
  inactivityTimeoutMinutes: number;
  onClose: () => void;
}

export const AccountSecurityModal: React.FC<AccountSecurityModalProps> = ({
  user,
  inactivityTimeoutMinutes,
  onClose,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword !== confirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to update password.');
        return;
      }
      setSuccessMsg('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error updating password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Account &amp; Session Security
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {/* Account Info */}
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
              {user.displayName}
            </div>
            <div className="text-slate-500 dark:text-slate-400 font-mono">
              {user.username} · {user.email}
            </div>
            <div className="pt-1 flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
              <span>Role: <strong>{user.role === 'IT' ? 'IT (Full Admin)' : 'Manager (View/Backup)'}</strong></span>
              <span>·</span>
              <span>MFA: <strong className="text-emerald-600 dark:text-emerald-400">Active</strong></span>
              <span>·</span>
              <span className="tabular-nums">Backup Codes Left: <strong>{user.backupCodesRemaining}</strong></span>
            </div>
            <div className="text-slate-500 dark:text-slate-400 tabular-nums">
              Inactivity Session Timeout: {inactivityTimeoutMinutes} minutes
            </div>
          </div>

          {/* Change Password Form */}
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
              <KeyRound className="w-3.5 h-3.5 text-slate-500" />
              <span>Change Password</span>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-400">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-400">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 10 chars, upper, lower, number/symbol"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-400">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
