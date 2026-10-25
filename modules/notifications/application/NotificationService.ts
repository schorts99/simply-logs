import type { NotificationItem, NotificationSettings, IncidentTracker, NotificationType } from '../domain/NotificationTypes';
import { BrowserNotificationGateway } from '../infrastructure/BrowserNotificationGateway';
import type { LogEntry } from '../../monitoring/domain/LogEntry';
import { soundEffects } from '../../companion/infrastructure/AudioSynthesizer';

export class NotificationService {
  private settings: NotificationSettings;
  private notifications: NotificationItem[];
  private activeIncidents = new Map<string, IncidentTracker>();
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

  private notify(): void {
    this.listeners.forEach(listener => listener([...this.notifications]));
    this.gateway.saveHistory(this.notifications);
  }

  getSettings(): NotificationSettings { return { ...this.settings }; }
  updateSettings(partial: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.settings.cooldownSeconds = Math.min(300, Math.max(30, this.settings.cooldownSeconds || 60));
    this.settingsListeners.forEach(listener => listener({ ...this.settings }));
    this.gateway.saveSettings(this.settings);
  }
  getBrowserPermission(): NotificationPermission { return this.gateway.getPermission(); }
  async requestBrowserPermission(): Promise<NotificationPermission> {
    const permission = await this.gateway.requestPermission();
    if (permission === 'granted') this.updateSettings({ browserPushEnabled: true });
    return permission;
  }

  syncApplications(ids: string[]): void {
    const allowed = new Set(ids);
    for (const [key, incident] of this.activeIncidents) {
      if (!allowed.has(incident.appId)) this.activeIncidents.delete(key);
    }
  }

  processLogEntry(log: LogEntry): void {
    if (!this.settings.enabled || !log.isRealTelemetry || !log.monitorKind || !log.observation || log.observation === 'unknown') return;
    const key = `${log.applicationId}:${log.monitorKind}`;
    const now = this.now();
    const incident = this.activeIncidents.get(key);
    if (log.observation === 'healthy') {
      if (!incident || now - incident.lastSeen < this.settings.cooldownSeconds * 1000) return;
      this.activeIncidents.delete(key);
      if (this.settings.notifyOnResolved) {
        void this.dispatch({
          title: `Recovered: ${log.applicationName}`,
          body: `${log.monitorKind === 'health' ? 'A fresh health check succeeded' : 'A ready deployment was observed'} after the recovery window.`,
          type: 'resolved', applicationId: log.applicationId, applicationName: log.applicationName,
          providerType: log.providerType, suppressedRepeats: Math.max(0, incident.errorCount - 1),
        });
      }
      return;
    }
    if (incident) {
      incident.errorCount++;
      incident.lastSeen = now;
      incident.lastErrorMessage = log.message;
      return;
    }
    this.activeIncidents.set(key, {
      appId: log.applicationId, appName: log.applicationName, providerType: log.providerType,
      status: 'active', firstSeen: now, lastSeen: now, errorCount: 1, lastNotifiedAt: now,
      lastErrorMessage: log.message,
    });
    void this.dispatch({
      title: `${log.monitorKind === 'health' ? 'Health check failed' : 'Deployment failed'}: ${log.applicationName}`,
      body: log.message.slice(0, 180), type: 'error',
      applicationId: log.applicationId, applicationName: log.applicationName, providerType: log.providerType,
    });
  }

  private async dispatch(params: {
    title: string; body: string; type: NotificationType; applicationId?: string;
    applicationName?: string; providerType?: 'vercel' | 'netlify'; suppressedRepeats?: number;
  }): Promise<boolean> {
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
        if (!await this.gateway.showNativeNotification(item.title, { body: item.body })) {
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
  markAllAsRead(): void {
    this.notifications = this.notifications.map(item => ({ ...item, read: true }));
    this.notify();
  }
  clearHistory(): void { this.notifications = []; this.notify(); }
  getUnreadCount(): number { return this.notifications.filter(item => !item.read).length; }
  getActiveIncidentCount(): number { return this.activeIncidents.size; }
}

export const notificationService = new NotificationService();
