import React, { useState, useEffect, useRef } from 'react';
import { NotificationItem } from '../domain/NotificationTypes';
import { notificationService } from '../application/NotificationService';
import { AlertTriangle, CheckCircle2, X, Bell } from 'lucide-react';

export const NotificationToast: React.FC = () => {
  const [currentToast, setCurrentToast] = useState<NotificationItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const unsub = notificationService.subscribeToActiveToasts((toast) => {
      setCurrentToast(toast);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCurrentToast((prev) => (prev?.id === toast.id ? null : prev));
      }, 5500);
    });

    return () => { unsub(); clearTimeout(timer.current); };
  }, []);

  if (!currentToast) return null;

  const isError = currentToast.type === 'error';
  const isResolved = currentToast.type === 'resolved';

  return (
    <div role="status" aria-live="polite" className="fixed bottom-9 right-4 z-50 max-w-sm w-full animate-in slide-in-from-bottom-5 duration-200 select-none">
      <div
        className={`p-3.5 rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-3 ${
          isError
            ? 'bg-rose-950/90 text-rose-100 border-rose-700/60 shadow-rose-950/40'
            : isResolved
            ? 'bg-emerald-950/90 text-emerald-100 border-emerald-700/60 shadow-emerald-950/40'
            : 'bg-neutral-900/90 text-neutral-100 border-neutral-700/60 shadow-black/40'
        }`}
      >
        <div className="shrink-0 mt-0.5">
          {isError ? (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          ) : isResolved ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <Bell className="w-5 h-5 text-indigo-400" />
          )}
        </div>

        <div className="flex-1 min-w-0 font-sans">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold truncate">
              {currentToast.title}
            </h4>
            <span className="text-[10px] opacity-60 font-mono">Just now</span>
          </div>
          <p className="text-[11px] opacity-90 mt-0.5 leading-snug line-clamp-2 font-mono">
            {currentToast.body}
          </p>
          {currentToast.suppressedRepeats !== undefined && currentToast.suppressedRepeats > 0 && (
            <span className="inline-block mt-1 text-[9px] font-mono px-1.5 py-0.2 rounded bg-black/30 border border-white/10 text-emerald-300">
              🛡️ {currentToast.suppressedRepeats} repeated alerts suppressed
            </span>
          )}
        </div>

        <button
          aria-label="Dismiss notification"
          onClick={() => setCurrentToast(null)}
          className="shrink-0 text-white/50 hover:text-white p-0.5 rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
