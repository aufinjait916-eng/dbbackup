import React from 'react';
import { Database, ShieldCheck, Sun, Moon } from 'lucide-react';

interface HeaderProps {
  activeTab: 'backups' | 'server' | 'deployment';
  setActiveTab: (tab: 'backups' | 'server' | 'deployment') => void;
  isDark: boolean;
  toggleDark: () => void;
  onPrimaryAction: () => void;
  isBackingUp: boolean;
  selectedCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isDark,
  toggleDark,
  onPrimaryAction,
  isBackingUp,
  selectedCount,
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors">
      {/* Zone 1: Brand Wordmark (Single text element) */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white shadow-xs">
          <Database className="w-4 h-4" />
        </div>
        <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
          TrueNAS Postgres Backup
        </span>
      </div>

      {/* Zone 2: Single-line Navigation Links */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
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
          onClick={() => setActiveTab('server')}
          className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'server'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : ''
          }`}
        >
          TrueNAS Environment
        </button>
        <button
          onClick={() => setActiveTab('deployment')}
          className={`hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'deployment'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : ''
          }`}
        >
          Deployment &amp; Workflows
        </button>
      </nav>

      {/* Zone 3: 1 Primary Action + Theme Toggle */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={toggleDark}
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Toggle dark mode"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
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
