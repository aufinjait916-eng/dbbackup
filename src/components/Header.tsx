import React from 'react';
import { Database, ShieldCheck, Sun, Moon, LogOut, UserCheck } from 'lucide-react';
import { AuthUser } from '../types';

export type AppTab = 'backups' | 'schedule' | 'server' | 'deployment' | 'users' | 'audit';

interface HeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  isDark: boolean;
  toggleDark: () => void;
  onPrimaryAction: () => void;
  isBackingUp: boolean;
  selectedCount: number;
  currentUser: AuthUser;
  onOpenSecurityModal: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isDark,
  toggleDark,
  onPrimaryAction,
  isBackingUp,
  selectedCount,
  currentUser,
  onOpenSecurityModal,
  onLogout,
}) => {
  const isIT = currentUser.role === 'IT';

  return (
    <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors">
      {/* Zone 1: Brand Wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white shadow-xs">
          <Database className="w-4 h-4" />
        </div>
        <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
          TrueNAS Postgres Backup
        </span>
      </div>

      {/* Zone 2: Single-line Navigation Links */}
      <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
        <button
          onClick={() => setActiveTab('backups')}
          className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'backups'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : ''
          }`}
        >
          Database Queue
        </button>

        <button
          onClick={() => setActiveTab('schedule')}
          className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'schedule'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : ''
          }`}
        >
          Auto Schedule
        </button>

        {isIT && (
          <>
            <button
              onClick={() => setActiveTab('users')}
              className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'users'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : ''
              }`}
            >
              User Management
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'audit'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : ''
              }`}
            >
              Audit Log
            </button>
            <button
              onClick={() => setActiveTab('deployment')}
              className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'deployment'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : ''
              }`}
            >
              Deployment
            </button>
          </>
        )}
      </nav>

      {/* Zone 3: Account Controls + Primary Action */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={onOpenSecurityModal}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          title="Account & Session Security"
        >
          <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-mono">{currentUser.username}</span>
          <span aria-hidden="true">·</span>
          <span>{currentUser.role}</span>
        </button>

        <button
          onClick={toggleDark}
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          aria-label="Toggle dark mode"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          onClick={onLogout}
          title="Sign Out"
          className="p-2 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>

        <button
          onClick={onPrimaryAction}
          disabled={isBackingUp || selectedCount === 0}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 ${
            isBackingUp
              ? 'bg-amber-600 text-white cursor-not-allowed'
              : selectedCount === 0
              ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>
            {isBackingUp
              ? 'Backing Up...'
              : `Backup & Download (${selectedCount})`}
          </span>
        </button>
      </div>
    </header>
  );
};
