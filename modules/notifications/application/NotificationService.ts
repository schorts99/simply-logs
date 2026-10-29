import type { NotificationItem, NotificationSettings, IncidentTracker, IncidentKind } from '../domain/NotificationTypes';
import { COOLDOWN_OPTIONS, MUTE_DURATION_MS, alertContext, formatDuration } from '../domain/NotificationTypes';
import { BrowserNotificationGateway } from '../infrastructure/BrowserNotificationGateway';
import type { LogEntry } from '../../monitoring/domain/LogEntry';
import { soundEffects } from '../../companion/infrastructure/AudioSynthesizer';

const RUNTIME_WINDOW_MS = 60_000;
const RUNTIME_SOURCES = new Set(['runtime', 'serverless', 'edge']);

type DispatchParams = Omit<NotificationItem, 'id' | 'timestamp' | 'read'>;

export class NotificationService {
  private settings: NotificationSettings;
  private notifications: NotificationItem[];
  private activeIncidents = new Map<string, IncidentTracker>();
  private runtimeErrors = new Map<string, number[]>();
  private listeners = new Set<(items: NotificationItem[]) => void>();
  private toastListeners = new Set<(item: NotificationItem) => void>();
  private settingsListeners = new Set<(settings: NotificationSettings) => void>();

  constructor(
    private gateway: Omit<typeof BrowserNotificationGateway, 'prototype'> = BrowserNotificationGateway,
    private audio: Pick<typeof soundEffects, 'playErrorAlert' | 'playPurr'> = soundEffects,
    private now = () => Date.now(),
  ) {
    this.settings = gateway.loadSettings();
    this.notifications = gateway.loadHistory();
  }

  subscribe(listener: (items: NotificationItem[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.notifications]);
    return () => { this.listeners.delete(listener); };
  }

  subscribeToActiveToasts(listener: (item: NotificationItem) => void): () => void {
    this.toastListeners.add(listener);
    return () => { this.toastListeners.delete(listener); };
  }

  subscribeSettings(listener: (settings: NotificationSettings) => void): () => void {
    this.settingsListeners.add(listener);
    listener({ ...this.settings });
    return () => { this.settingsListeners.delete(listener); };
  }

  /** Clicking a desktop banner resolves to the in-app notification it was raised for. */
  subscribeNativeClicks(listener: (item: NotificationItem) => void): () => void {
    return this.gateway.onNativeClick(id => {
      const item = this.notifications.find(candidate => candidate.id === id);
      if (item) listener(item);
    });
  }

  private notify(): void {
    this.listeners.forEach(listener => listener([...this.notifications]));
    this.gateway.saveHistory(this.notifications);
  }

  getSettings(): NotificationSettings { return { ...this.settings }; }
  updateSettings(partial: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...partial };
    if (!COOLDOWN_OPTIONS.includes(this.settings.cooldownSeconds)) this.settings.cooldownSeconds = 60;
    this.settings.failureThreshold = Math.min(5, Math.max(1, Math.round(this.settings.failureThreshold) || 2));
    this.settings.runtimeErrorsPerMinute = Math.min(100, Math.max(1, Math.round(this.settings.runtimeErrorsPerMinute) || 5));
    this.settingsListeners.forEach(listener => listener({ ...this.settings }));
    this.gateway.saveSettings(this.settings);
  }
  getBrowserPermission(): NotificationPermission { return this.gateway.getPermission(); }
  async requestBrowserPermission(): Promise<NotificationPermission> {
    const permission = await this.gateway.requestPermission();
    if (permission === 'granted') this.updateSettings({ browserPushEnabled: true });
    return permission;
  }

  isMuted(applicationId: string): boolean {
    const muted = this.settings.mutedApplications[applicationId];
    return Boolean(muted && muted.until > this.now());
  }

  muteApplication(applicationId: string, name: string, durationMs = MUTE_DURATION_MS): void {
    this.dropIncidents(id => id === applicationId);
    this.updateSettings({ mutedApplications: { ...this.activeMutes(), [applicationId]: { name, until: this.now() + durationMs } } });
  }

  unmuteApplication(applicationId: string): void {
    const { [applicationId]: _removed, ...rest } = this.activeMutes();
    this.updateSettings({ mutedApplications: rest });
  }

  private activeMutes(): NotificationSettings['mutedApplications'] {
    const now = this.now();
    return Object.fromEntries(Object.entries(this.settings.mutedApplications).filter(([, muted]) => muted.until > now));
  }

  syncApplications(ids: string[]): void {
    const allowed = new Set(ids);
    this.dropIncidents(id => !allowed.has(id));
  }

  private dropIncidents(match: (applicationId: string) => boolean): void {
    for (const [key, incident] of this.activeIncidents) {
      if (match(incident.appId)) this.activeIncidents.delete(key);
    }
    for (const key of this.runtimeErrors.keys()) {
      if (match(key)) this.runtimeErrors.delete(key);
    }
  }

  processLogEntry(log: LogEntry): void {
    if (!this.settings.enabled || !log.isRealTelemetry || log.payload?.historical || this.isMuted(log.applicationId)) return;
    if (log.monitorKind && log.observation && log.observation !== 'unknown') this.processObservation(log, log.monitorKind, log.observation);
    else if (RUNTIME_SOURCES.has(log.source) && !log.monitorKind) this.processRuntime(log);
  }

  private processObservation(log: LogEntry, kind: 'health' | 'deployment', observation: 'healthy' | 'unhealthy'): void {
    const key = `${log.applicationId}:${kind}`;
    const incident = this.activeIncidents.get(key);
    if (observation === 'healthy') {
      this.recover(key, incident, log, kind === 'health' ? 'A fresh health check succeeded.' : 'A ready deployment was observed.');
      return;
    }
    // A failed deployment is definitive; health checks wait for consecutive failures to filter out blips.
    const threshold = kind === 'health' ? this.settings.failureThreshold : 1;
    const label = kind === 'health' ? 'Health check failed' : 'Deployment failed';
    this.recordFailure(key, incident, log, kind, threshold, () => ({
      title: `${label}: ${log.applicationName}`,
      body: threshold > 1 ? `${threshold} consecutive checks failed. ${log.message}` : log.message,
    }));
  }

  private processRuntime(log: LogEntry): void {
    const key = `${log.applicationId}:runtime`;
    const incident = this.activeIncidents.get(key);
    const isError = log.level === 'error' || (log.statusCode !== undefined && log.statusCode >= 500);
    if (!isError) {
      // Only a completed request counts as a fresh healthy runtime observation, not connection notices.
      if (log.statusCode !== undefined) this.recover(key, incident, log, 'Runtime requests are succeeding again.');
      return;
    }
    if (!this.settings.runtimeErrorAlerts) return;
    const now = this.now();
    const recent = (this.runtimeErrors.get(log.applicationId) || []).filter(time => now - time < RUNTIME_WINDOW_MS);
    recent.push(now);
    this.runtimeErrors.set(log.applicationId, recent);
    // Isolated errors never open an incident; a spike does, and later errors extend it.
    if (!incident && recent.length < this.settings.runtimeErrorsPerMinute) return;
    const route = [log.method, log.path].filter(Boolean).join(' ');
    const status = log.statusCode ? `${log.statusCode} ` : '';
    this.recordFailure(key, incident, log, 'runtime', 1, () => ({
      title: `Error spike: ${log.applicationName}`,
      body: `${recent.length} runtime errors in the last minute. Latest: ${status}${route ? `${route} ` : ''}${log.message}`,
    }), recent[0]);
    if (!incident) this.activeIncidents.get(key)!.errorCount = recent.length;
  }

  private recordFailure(
    key: string, incident: IncidentTracker | undefined, log: LogEntry, kind: IncidentKind, threshold: number,
    message: () => { title: string; body: string }, firstSeen = this.now(),
  ): void {
    const now = this.now();
    const tracker: IncidentTracker = incident || {
      appId: log.applicationId, appName: log.applicationName, providerType: log.providerType, environment: log.environment,
      kind, status: 'pending', firstSeen, lastSeen: now, errorCount: 0, consecutiveFailures: 0, lastNotifiedAt: 0,
      lastErrorMessage: log.message,
    };
    tracker.errorCount++;
    tracker.consecutiveFailures++;
    tracker.lastSeen = now;
    tracker.lastErrorMessage = log.message;
    this.activeIncidents.set(key, tracker);
    if (tracker.status === 'active' || tracker.consecutiveFailures < threshold) return;
    tracker.status = 'active';
    tracker.lastNotifiedAt = now;
    const { title, body } = message();
    void this.dispatch({
      title, body: body.slice(0, 220), type: 'error', kind,
      applicationId: log.applicationId, applicationName: log.applicationName,
      providerType: log.providerType, environment: log.environment,
    });
  }

  private recover(key: string, incident: IncidentTracker | undefined, log: LogEntry, detail: string): void {
    if (!incident) return;
    if (incident.status === 'pending') {
      // The failures never reached the alert threshold, so the streak simply resets.
      this.activeIncidents.delete(key);
      return;
    }
    const now = this.now();
    if (now - incident.lastSeen < this.settings.cooldownSeconds * 1000) return;
    this.activeIncidents.delete(key);
    if (incident.kind === 'runtime') this.runtimeErrors.delete(incident.appId);
    if (!this.settings.notifyOnResolved) return;
    const downtimeMs = now - incident.firstSeen;
    const failures = incident.kind === 'runtime' ? 'runtime errors' : incident.kind === 'health' ? 'failed checks' : 'failed observations';
    void this.dispatch({
      title: `Recovered: ${log.applicationName}`,
      body: `${incident.kind === 'runtime' ? 'Errors lasted' : 'Down for'} ${formatDuration(downtimeMs)} · ${incident.errorCount} ${failures}. ${detail}`,
      type: 'resolved', kind: incident.kind, applicationId: log.applicationId, applicationName: log.applicationName,
      providerType: log.providerType, environment: log.environment,
      suppressedRepeats: Math.max(0, incident.errorCount - 1), downtimeMs,
    });
  }

  private async dispatch(params: DispatchParams): Promise<boolean> {
    const item: NotificationItem = { ...params, id: crypto.randomUUID(), timestamp: this.now(), read: false };
    this.notifications = [item, ...this.notifications].slice(0, 80);
    this.notify();
    this.toastListeners.forEach(listener => listener(item));
    if (this.settings.soundAlerts) {
      if (params.type === 'error') this.audio.playErrorAlert();
      else if (params.type === 'resolved') this.audio.playPurr();
    }
    if (this.settings.browserPushEnabled) {
      try {
        const context = alertContext(item);
        if (!await this.gateway.showNativeNotification(item.title, { body: context ? `${context} — ${item.body}` : item.body, id: item.id })) {
          throw new Error('The operating system did not accept the desktop notification.');
        }
        return true;
      } catch (error) {
        const failure: NotificationItem = {
          id: crypto.randomUUID(), timestamp: this.now(), read: false, type: 'warning',
          title: 'Desktop notification failed',
          body: error instanceof Error ? error.message : 'Desktop notification delivery failed.',
        };
        this.notifications = [failure, ...this.notifications].slice(0, 80);
        this.notify();
        this.toastListeners.forEach(listener => listener(failure));
      }
    }
    return false;
  }

  sendTestNotification(): Promise<boolean> {
    return this.dispatch({ title: 'Simply Logs', body: 'Your cat is on watch. This is a test notification.', type: 'info' });
  }
  markAsRead(id: string): void {
    if (!this.notifications.some(item => item.id === id && !item.read)) return;
    this.notifications = this.notifications.map(item => item.id === id ? { ...item, read: true } : item);
    this.notify();
  }
  markAllAsRead(): void {
    this.notifications = this.notifications.map(item => ({ ...item, read: true }));
    this.notify();
  }
  clearHistory(): void { this.notifications = []; this.notify(); }
  getUnreadCount(): number { return this.notifications.filter(item => !item.read).length; }
  getActiveIncidentCount(): number {
    return [...this.activeIncidents.values()].filter(incident => incident.status === 'active').length;
  }
}

export const notificationService = new NotificationService();
