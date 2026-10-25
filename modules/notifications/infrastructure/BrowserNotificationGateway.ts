import { DEFAULT_NOTIFICATION_SETTINGS } from '../domain/NotificationTypes';
import type { NotificationItem, NotificationSettings } from '../domain/NotificationTypes';

const SETTINGS = 'simply_logs_notification_settings';
const HISTORY = 'simply_logs_notification_history';

export class BrowserNotificationGateway {
  static isSupported(): boolean { return typeof window !== 'undefined' && Boolean(window.simplyLogs); }
  static getPermission(): NotificationPermission { return this.isSupported() ? 'granted' : 'denied'; }
  static async requestPermission(): Promise<NotificationPermission> { return this.getPermission(); }
  static async showNativeNotification(title: string, options?: { body?: string }): Promise<boolean> {
    if (!this.isSupported()) throw new Error('Native notifications are unavailable in UI preview. Open the Simply Logs desktop app.');
    const accepted = await window.simplyLogs!.notify(title, options?.body || title);
    if (!accepted) throw new Error('The operating system did not accept the desktop notification.');
    return true;
  }
  static loadSettings(): NotificationSettings {
    try {
      const saved = localStorage.getItem(SETTINGS) || localStorage.getItem('purrpulse_notification_settings_v1');
      const data = saved ? JSON.parse(saved) : {};
      return {
        enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
        browserPushEnabled: typeof data.browserPushEnabled === 'boolean' ? data.browserPushEnabled : DEFAULT_NOTIFICATION_SETTINGS.browserPushEnabled,
        soundAlerts: typeof data.soundAlerts === 'boolean' ? data.soundAlerts : DEFAULT_NOTIFICATION_SETTINGS.soundAlerts,
        notifyOnResolved: typeof data.notifyOnResolved === 'boolean' ? data.notifyOnResolved : DEFAULT_NOTIFICATION_SETTINGS.notifyOnResolved,
        cooldownSeconds: [30, 60, 120, 300].includes(data.cooldownSeconds) ? data.cooldownSeconds : 60,
      };
    } catch { return { ...DEFAULT_NOTIFICATION_SETTINGS }; }
  }
  static saveSettings(settings: NotificationSettings): void {
    try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch {}
  }
  static loadHistory(): NotificationItem[] {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string' && typeof item.timestamp === 'number').slice(0, 80);
    } catch { return []; }
  }
  static saveHistory(items: NotificationItem[]): void {
    try { localStorage.setItem(HISTORY, JSON.stringify(items.slice(0, 80))); } catch {}
  }
}
