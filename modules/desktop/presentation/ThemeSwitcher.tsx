import React from 'react';
import { Sun, Moon, Laptop } from 'lucide-react';
import { useTheme } from '../application/ThemeContext';
import { ThemeMode } from '../domain/ThemeTypes';

export const ThemeSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { themeMode, resolvedTheme, setThemeMode } = useTheme();

  const options: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
    { mode: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
    { mode: 'system', label: 'System', icon: <Laptop className="w-3.5 h-3.5" /> }
  ];

  return (
    <div className="inline-flex items-center p-0.5 rounded-lg bg-neutral-200/80 dark:bg-neutral-800/80 border border-neutral-300 dark:border-neutral-700/60 shadow-inner">
      {options.map(opt => {
        const isActive = themeMode === opt.mode;
        return (
          <button
            key={opt.mode}
            onClick={() => setThemeMode(opt.mode)}
            title={`Switch to ${opt.label} theme ${opt.mode === 'system' ? '(follows OS default)' : ''}`}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
              isActive
                ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
            }`}
          >
            {opt.icon}
            {!compact && <span>{opt.label}</span>}
            {opt.mode === 'system' && !compact && (
              <span className="text-[10px] opacity-60 font-mono">({resolvedTheme})</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
