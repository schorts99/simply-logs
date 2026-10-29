import React, { useState, useEffect } from 'react';
import { 
  NotificationItem, 
  NotificationSettings,
  FAILURE_THRESHOLD_OPTIONS,
  RUNTIME_ERROR_RATE_OPTIONS,
  alertContext,
  formatDuration,
} from '../domain/NotificationTypes';
import { notificationService } from '../application/NotificationService';
import { useDialog } from '../../desktop/application/useDialog';
import { 
  X, 
  BellRing, 
  ShieldCheck, 
  Trash2, 
  Send,
  Check,
  BellOff,
  Activity
} from 'lucide-react';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenApplication: (item: NotificationItem) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  onOpenApplication
}) => {
  const [settings, setSettings] = useState<NotificationSettings>(() => notificationService.getSettings());
  const [history, setHistory] = useState<NotificationItem[]>([]);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default');
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'in-app'>('idle');
  useDialog(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;

    setBrowserPermission(notificationService.getBrowserPermission());

    const unsubSettings = notificationService.subscribeSettings((s) => {
      setSettings(s);
    });

    const unsubHistory = notificationService.subscribe((list) => {
      setHistory(list);
    });

    // Mark items as read when opening modal
    notificationService.markAllAsRead();

    return () => {
      unsubSettings();
      unsubHistory();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleEnabled = () => {
    notificationService.updateSettings({ enabled: !settings.enabled });
  };

  const handleToggleBrowserPush = async () => {
    if (browserPermission !== 'granted') {
      const perm = await notificationService.requestBrowserPermission();
      setBrowserPermission(perm);
    } else {
      notificationService.updateSettings({ browserPushEnabled: !settings.browserPushEnabled });
    }
  };

  const handleToggleSound = () => {
    notificationService.updateSettings({ soundAlerts: !settings.soundAlerts });
  };

  const handleToggleResolved = () => {
    notificationService.updateSettings({ notifyOnResolved: !settings.notifyOnResolved });
  };

  const handleSelectCooldown = (sec: number) => {
    notificationService.updateSettings({ cooldownSeconds: sec });
  };

  const handleOpen = (item: NotificationItem) => {
    if (!item.applicationId) return;
    onOpenApplication(item);
    onClose();
  };

  const optionClass = (selected: boolean) => `px-2.5 py-1 rounded-md text-xs transition-colors ${
    selected
      ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-bold shadow-xs'
      : 'bg-neutral-200/60 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
  }`;

  const now = Date.now();
  const mutedApps = Object.entries(settings.mutedApplications).filter(([, muted]) => muted.until > now);

  const handleSendTest = async () => {
    setTestState('sending');
    const accepted = await notificationService.sendTestNotification();
    setTestState(accepted ? 'sent' : settings.browserPushEnabled ? 'failed' : 'in-app');
  };

  const handleClearHistory = () => {
    notificationService.clearHistory();
  };

  const cooldownOptions = [
    { label: '30s', value: 30 },
    { label: '1 min', value: 60 },
    { label: '2 min', value: 120 },
    { label: '5 min', value: 300 }
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="Notification settings" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-xl bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <BellRing className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                Notifications & incident alerts
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Configure when and how often to be alerted about infrastructure events
              </p>
            </div>
          </div>

          <button
            aria-label="Close notification settings"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1.5 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs font-sans">
          {/* Master Enable Card */}
          <div className="p-3.5 rounded-xl bg-neutral-100/70 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/60 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-semibold text-neutral-900 dark:text-neutral-100 block">
                Enable incident alerts
              </span>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Receive alerts when infrastructure errors or outages occur
              </p>
            </div>

            <button
              aria-label="Enable incident alerts"
              aria-pressed={settings.enabled}
              onClick={handleToggleEnabled}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out ${
                settings.enabled ? 'bg-indigo-600' : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                  settings.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Browser Permission & Controls */}
          {settings.enabled && (
            <div className="space-y-4">
              {/* Native Browser Push */}
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100 block">
                      Desktop notifications
                    </span>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Show native system banners while Simply Logs is open
                    </p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Allow notifications in system settings. On macOS, use a signed app and check Focus settings.
                    </p>
                  </div>

                  {browserPermission === 'granted' ? (
                    <button
                      onClick={handleToggleBrowserPush}
                      className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                        settings.browserPushEnabled
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      {settings.browserPushEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleBrowserPush}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-xs transition-colors"
                    >
                      Enable desktop notifications
                    </button>
                  )}
                </div>

                {browserPermission === 'denied' && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-mono bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                    Native notifications are unavailable in UI preview. In-app alerts still work. In the desktop app, also check your system notification settings.
                  </p>
                )}
              </div>

              {/* Anti-Spam Hysteresis / Cooldown Policy */}
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      Anti-Spam Incident Deduplication
                    </span>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                      Repeated failures generate <strong>one alert</strong> per incident. Recovery requires a fresh successful observation after the window below. Pausing or losing telemetry never counts as recovery.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 font-mono">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Recovery window:
                  </span>
                  <div className="flex items-center gap-1.5">
                    {cooldownOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleSelectCooldown(opt.value)}
                        aria-pressed={settings.cooldownSeconds === opt.value}
                        className={optionClass(settings.cooldownSeconds === opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono" role="group" aria-label="Failed health checks before alerting">
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Alert after:
                  </span>
                  <div className="flex items-center gap-1.5">
                    {FAILURE_THRESHOLD_OPTIONS.map((value) => (
                      <button
                        key={value}
                        onClick={() => notificationService.updateSettings({ failureThreshold: value })}
                        aria-pressed={settings.failureThreshold === value}
                        className={optionClass(settings.failureThreshold === value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    failed health {settings.failureThreshold === 1 ? 'check' : 'checks'} in a row
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  Failed deployments always alert immediately.
                </p>
              </div>

              {/* Runtime error spikes */}
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 space-y-2.5">
                <label className="flex items-start justify-between gap-3 cursor-pointer">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-rose-500" />
                      Runtime error spikes
                    </span>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                      Alert when live runtime logs show 5xx responses or error-level output above a rate. Loaded history never alerts. Requires a provider account connection.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Runtime error spike alerts"
                    checked={settings.runtimeErrorAlerts}
                    onChange={() => notificationService.updateSettings({ runtimeErrorAlerts: !settings.runtimeErrorAlerts })}
                    className="rounded text-indigo-600 focus:ring-0 cursor-pointer mt-1"
                  />
                </label>
                {settings.runtimeErrorAlerts && (
                  <div className="flex items-center gap-2 font-mono" role="group" aria-label="Runtime errors per minute">
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Threshold:
                    </span>
                    <div className="flex items-center gap-1.5">
                      {RUNTIME_ERROR_RATE_OPTIONS.map((value) => (
                        <button
                          key={value}
                          onClick={() => notificationService.updateSettings({ runtimeErrorsPerMinute: value })}
                          aria-pressed={settings.runtimeErrorsPerMinute === value}
                          className={optionClass(settings.runtimeErrorsPerMinute === value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      errors / minute
                    </span>
                  </div>
                )}
              </div>

              {/* Muted applications */}
              {mutedApps.length > 0 && (
                <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                    <BellOff className="w-4 h-4 text-amber-500" />
                    Muted applications
                  </span>
                  <ul className="space-y-1.5">
                    {mutedApps.map(([id, muted]) => (
                      <li key={id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate">
                          <strong>{muted.name}</strong>
                          <span className="text-neutral-500 dark:text-neutral-400"> · {formatDuration(muted.until - now)} left</span>
                        </span>
                        <button
                          onClick={() => notificationService.unmuteApplication(id)}
                          className="px-2 py-0.5 rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          Unmute
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Additional Notification Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Notify on Recovery */}
                <label
                  className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 flex items-center justify-between cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors"
                >
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 block">
                      Recovery Alerts
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 block">
                      Notify when service recovers
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Recovery alerts"
                    checked={settings.notifyOnResolved}
                    onChange={handleToggleResolved}
                    className="rounded text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                </label>

                {/* Sound Alerts */}
                <label
                  className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 flex items-center justify-between cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors"
                >
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 block">
                      Sound Chimes
                    </span>
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 block">
                      Retro sound synthesis
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Sound chimes"
                    checked={settings.soundAlerts}
                    onChange={handleToggleSound}
                    className="rounded text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                </label>
              </div>

              {/* Action: Send Test Notification */}
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleSendTest}
                  disabled={testState === 'sending'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-medium transition-colors"
                >
                  {testState === 'sent' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{testState === 'sending' ? 'Sending...' : testState === 'sent' ? 'Accepted by system' : 'Send Test Notification'}</span>
                </button>

                {history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-neutral-400 hover:text-rose-500 flex items-center gap-1 text-[11px] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear History</span>
                  </button>
                )}
              </div>
              {testState === 'failed' && <p role="alert" className="text-amber-600 dark:text-amber-400">Desktop notification failed. See Recent Notifications for details.</p>}
              {testState === 'in-app' && <p role="status">In-app test sent. Enable desktop notifications to test a system banner.</p>}
              {testState === 'sent' && <p role="status">The system accepted the request. Notification permissions and Focus settings still control whether a banner appears.</p>}
            </div>
          )}

          {/* History Feed */}
          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-bold text-neutral-400">
                Recent Notifications ({history.length})
              </span>
            </div>

            {history.length === 0 ? (
              <div className="py-6 text-center text-neutral-400 font-mono text-xs">
                No recent notifications recorded
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1 font-mono text-[11px]">
                {history.map((item) => {
                  const isErr = item.type === 'error';
                  const isRes = item.type === 'resolved';
                  const context = alertContext(item);
                  const Row = item.applicationId ? 'button' : 'div';

                  return (
                    <Row
                      key={item.id}
                      {...(item.applicationId ? { type: 'button' as const, onClick: () => handleOpen(item), title: `Open ${item.applicationName} logs` } : {})}
                      className={`w-full text-left p-2.5 rounded-lg border flex items-start justify-between gap-2.5 ${item.applicationId ? 'cursor-pointer hover:brightness-95 dark:hover:brightness-125' : ''} ${
                        isErr
                          ? 'bg-rose-500/5 border-rose-500/20 text-neutral-800 dark:text-neutral-200'
                          : isRes
                          ? 'bg-emerald-500/5 border-emerald-500/20 text-neutral-800 dark:text-neutral-200'
                          : 'bg-neutral-100/60 dark:bg-neutral-800/40 border-neutral-200 dark:border-neutral-700/60 text-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[9px] px-1 rounded uppercase font-bold ${
                              isErr
                                ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                                : isRes
                                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                            }`}
                          >
                            {item.type}
                          </span>
                          <span className="font-semibold truncate text-[11px]">
                            {item.title}
                          </span>
                        </div>
                        {context && (
                          <p className="text-[9px] text-neutral-400 uppercase tracking-wide">{context}</p>
                        )}
                        <p className="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-2">
                          {item.body}
                        </p>
                        {item.suppressedRepeats !== undefined && item.suppressedRepeats > 0 && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400">
                            🛡️ {item.suppressedRepeats} repeat {item.suppressedRepeats === 1 ? 'alert' : 'alerts'} suppressed during this incident
                          </span>
                        )}
                      </div>

                      <span className="text-[10px] text-neutral-400 shrink-0">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </Row>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
