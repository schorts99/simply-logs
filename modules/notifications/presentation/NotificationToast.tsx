import React, { useState, useEffect, useRef } from 'react';
import { NotificationItem, alertContext, formatRelativeTime } from '../domain/NotificationTypes';
import { notificationService } from '../application/NotificationService';
import { AlertTriangle, CheckCircle2, X, Bell, BellOff } from 'lucide-react';

const MAX_TOASTS = 3;

interface NotificationToastProps {
  onOpenApplication: (item: NotificationItem) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ onOpenApplication }) => {
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts(items => items.filter(item => item.id !== id));
  };

  useEffect(() => {
    const unsub = notificationService.subscribeToActiveToasts((toast) => {
      setNow(Date.now());
      setToasts(items => {
        const next = [toast, ...items];
        next.slice(MAX_TOASTS).forEach(item => { clearTimeout(timers.current.get(item.id)); timers.current.delete(item.id); });
        return next.slice(0, MAX_TOASTS);
      });
      // Failures stay on screen longer than recoveries and info messages.
      timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), toast.type === 'error' ? 12000 : 5500));
    });
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      unsub(); clearInterval(tick);
      timers.current.forEach(clearTimeout); timers.current.clear();
    };
  }, []);

  if (!toasts.length) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-9 right-4 z-50 max-w-sm w-full flex flex-col gap-2 select-none">
      {toasts.map(toast => {
        const isError = toast.type === 'error';
        const isResolved = toast.type === 'resolved';
        const context = alertContext(toast);
        const openable = Boolean(toast.applicationId);
        const open = () => {
          if (!openable) return;
          notificationService.markAsRead(toast.id);
          onOpenApplication(toast);
          dismiss(toast.id);
        };
        return (
          <div
            key={toast.id}
            className={`p-3.5 rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-3 animate-in slide-in-from-bottom-5 duration-200 ${
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

            <button
              type="button"
              onClick={open}
              disabled={!openable}
              aria-label={openable ? `${toast.title}. Open ${toast.applicationName} logs` : undefined}
              className={`flex-1 min-w-0 font-sans text-left ${openable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold truncate">
                  {toast.title}
                </h4>
                <span className="text-[10px] opacity-60 font-mono shrink-0">{formatRelativeTime(toast.timestamp, now)}</span>
              </div>
              {context && <p className="text-[10px] opacity-60 font-mono mt-0.5">{context}</p>}
              <p className="text-[11px] opacity-90 mt-0.5 leading-snug line-clamp-2 font-mono">
                {toast.body}
              </p>
              {openable && <span className="inline-block mt-1 text-[10px] opacity-70 underline underline-offset-2">View logs</span>}
            </button>

            <div className="shrink-0 flex flex-col items-center gap-1">
              <button
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="text-white/50 hover:text-white p-0.5 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {isError && toast.applicationId && (
                <button
                  aria-label={`Mute ${toast.applicationName} alerts for 1 hour`}
                  title="Mute this application for 1 hour"
                  onClick={() => { notificationService.muteApplication(toast.applicationId!, toast.applicationName || 'Application'); dismiss(toast.id); }}
                  className="text-white/50 hover:text-white p-0.5 rounded transition-colors"
                >
                  <BellOff className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
