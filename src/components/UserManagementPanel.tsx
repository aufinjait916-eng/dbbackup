import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  Edit3,
  Trash2,
  RotateCcw,
  Unlock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Shield,
  KeyRound,
} from 'lucide-react';
import { AuthUser, UserRole } from '../types';
import { apiFetch } from '../utils/apiClient';

interface UserManagementPanelProps {
  currentUser: AuthUser;
}

export const UserManagementPanel: React.FC<UserManagementPanelProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create / Edit Modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('Manager');
  const [formPassword, setFormPassword] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Confirm Dialog state (for Delete or Reset MFA)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'reset-mfa';
    user: AuthUser;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/users');
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to load users.');
        return;
      }
      setUsers(data.users || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fetch user directory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const generateStrongPassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const nums = '23456789';
    const syms = '!@#$%&*-_';
    const all = upper + lower + nums + syms;
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    let pw =
      upper[arr[0] % upper.length] +
      lower[arr[1] % lower.length] +
      nums[arr[2] % nums.length] +
      syms[arr[3] % syms.length];
    for (let i = 4; i < 14; i++) {
      pw += all[arr[i] % all.length];
    }
    setFormPassword(pw);
  };

  const openCreateModal = () => {
    setModalMode('create');
    setEditingUser(null);
    setFormUsername('');
    setFormDisplayName('');
    setFormEmail('');
    setFormRole('Manager');
    setFormPassword('');
    setFormActive(true);
    setModalError(null);
  };

  const openEditModal = (u: AuthUser) => {
    setModalMode('edit');
    setEditingUser(u);
    setFormUsername(u.username);
    setFormDisplayName(u.displayName);
    setFormEmail(u.email);
    setFormRole(u.role);
    setFormPassword('');
    setFormActive(u.isActive);
    setModalError(null);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setModalError(null);

    try {
      if (modalMode === 'create') {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: formUsername,
            displayName: formDisplayName,
            email: formEmail,
            role: formRole,
            password: formPassword,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setModalError(data.error || 'Failed to create user.');
          return;
        }
        setModalMode(null);
        showToast(`Account '${data.user.username}' (${data.user.role}) created. MFA enrollment enforced on first login.`);
        await loadUsers();
      } else if (modalMode === 'edit' && editingUser) {
        const payload: Record<string, unknown> = {
          displayName: formDisplayName,
          email: formEmail,
          role: formRole,
          isActive: formActive,
        };
        if (formPassword.trim()) {
          payload.password = formPassword;
        }
        const res = await apiFetch(`/api/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setModalError(data.error || 'Failed to update user.');
          return;
        }
        setModalMode(null);
        showToast(`Updated user '${data.user.username}'.`);
        await loadUsers();
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Network error saving user.');
    } finally {
      setSaving(false);
    }
  };

  const handleUnlockUser = async (u: AuthUser) => {
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlock: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to unlock user.');
        return;
      }
      showToast(`Cleared lockout for '${u.username}'.`);
      await loadUsers();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error unlocking user.');
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    setErrorMsg(null);
    try {
      if (confirmAction.type === 'delete') {
        const res = await apiFetch(`/api/users/${confirmAction.user.id}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.error || 'Failed to delete user.');
          setConfirmAction(null);
          return;
        }
        showToast(`Deleted user '${confirmAction.user.username}'.`);
      } else if (confirmAction.type === 'reset-mfa') {
        const res = await apiFetch(`/api/users/${confirmAction.user.id}/reset-mfa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.error || 'Failed to reset MFA.');
          setConfirmAction(null);
          return;
        }
        showToast(
          `MFA reset for '${confirmAction.user.username}'. Active sessions revoked; QR re-enrollment required on next login.`
        );
      }
      setConfirmAction(null);
      await loadUsers();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed.');
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const itCount = users.filter((u) => u.role === 'IT').length;
  const managerCount = users.filter((u) => u.role === 'Manager').length;
  const mfaActiveCount = users.filter((u) => u.mfaEnabled && !u.mustSetupMfa).length;
  const lockedCount = users.filter((u) => u.isLocked).length;

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              User Management &amp; Access Control
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Public registration is disabled. Create and manage IT (Full Admin) and Manager (View/Backup) accounts, and reset TOTP MFA credentials.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadUsers}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>
        </div>

        {/* Clean Summary Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">IT Administrators</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {itCount}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Managers (View/Backup)</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {managerCount}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">MFA Enrolled</div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
              {mfaActiveCount}/{users.length}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Locked Accounts</div>
            <div
              className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                lockedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {lockedCount}
            </div>
          </div>
        </div>
      </div>

      {/* Feedback banners */}
      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-900 dark:text-rose-200 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-900/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4 w-32">Role</th>
                <th className="py-3 px-4 w-40">MFA Status</th>
                <th className="py-3 px-4 w-32">Account</th>
                <th className="py-3 px-4 w-44">Last Login</th>
                <th className="py-3 px-4 w-44 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {u.displayName}{' '}
                        {isSelf && (
                          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            (You)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                        {u.username} · {u.email}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-medium ${
                          u.role === 'IT'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {u.role === 'IT' ? 'IT (Full Admin)' : 'Manager'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {u.mfaEnabled && !u.mustSetupMfa ? (
                        <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Active
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums font-normal">
                            {u.backupCodesRemaining} backup codes
                          </div>
                        </div>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Setup on Next Login
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {u.isLocked ? (
                        <span className="text-rose-600 dark:text-rose-400 font-medium">Locked</span>
                      ) : u.isActive ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Active</span>
                      ) : (
                        <span className="text-slate-400 font-medium">Disabled</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 text-[11px]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {u.isLocked && (
                          <button
                            onClick={() => handleUnlockUser(u)}
                            title="Unlock account"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(u)}
                          title="Edit account"
                          className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmAction({ type: 'reset-mfa', user: u })}
                          title="Reset TOTP MFA"
                          className="p-1.5 text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmAction({ type: 'delete', user: u })}
                          disabled={isSelf}
                          title={isSelf ? 'Cannot delete your own account' : 'Delete account'}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit User Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {modalMode === 'create' ? 'Create User Account' : `Edit Account: ${editingUser?.username}`}
                </h3>
              </div>
              <button
                onClick={() => setModalMode(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200">
                  {modalError}
                </div>
              )}

              {modalMode === 'create' && (
                <div className="space-y-1">
                  <label className="block font-medium text-slate-700 dark:text-slate-300">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value.toLowerCase())}
                    placeholder="e.g. jdoe_mgr"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="jane.doe@company.local"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Assigned Role
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  <option value="Manager">Manager — View &amp; Backup Access</option>
                  <option value="IT">IT — Full Admin (Users, Audit Logs, Backups, Config)</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block font-medium text-slate-700 dark:text-slate-300">
                    {modalMode === 'create' ? 'Initial Password' : 'Reset Password (optional)'}
                  </label>
                  <button
                    type="button"
                    onClick={generateStrongPassword}
                    className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" />
                    <span>Generate</span>
                  </button>
                </div>
                <input
                  type="text"
                  required={modalMode === 'create'}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={modalMode === 'create' ? 'Min 10 chars, upper, lower, number/symbol' : 'Leave blank to keep unchanged'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono"
                />
              </div>

              {modalMode === 'edit' && (
                <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    disabled={editingUser?.id === currentUser.id}
                    className="w-4 h-4 accent-emerald-600 rounded"
                  />
                  <span>Account Active</span>
                </label>
              )}

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                >
                  {saving ? 'Saving...' : modalMode === 'create' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Delete or Reset MFA */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {confirmAction.type === 'delete'
                ? `Delete account '${confirmAction.user.username}'?`
                : `Reset TOTP MFA for '${confirmAction.user.username}'?`}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {confirmAction.type === 'delete'
                ? 'This will permanently remove the account and revoke any active sessions. Audit logs will retain historical records.'
                : 'This clears their authenticator secret and backup recovery codes, revokes active sessions, and forces them to enroll a new QR code on next login.'}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={confirmBusy}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeConfirmedAction}
                disabled={confirmBusy}
                className={`px-4 py-2 text-xs font-semibold rounded-lg text-white ${
                  confirmAction.type === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {confirmBusy
                  ? 'Processing...'
                  : confirmAction.type === 'delete'
                  ? 'Delete User'
                  : 'Reset MFA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
