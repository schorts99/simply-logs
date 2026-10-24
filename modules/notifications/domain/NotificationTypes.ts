export type NotificationType = 'error' | 'resolved' | 'warning' | 'info';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  type: NotificationType;
  applicationId?: string;
  applicationName?: string;
  providerType?: 'vercel' | 'netlify';
  read: boolean;
  suppressedRepeats?: number;
}

export interface NotificationSettings {
  enabled: boolean;
  browserPushEnabled: boolean;
  soundAlerts: boolean;
  cooldownSeconds: number; // Duration of quiet time required before re-alerting
  notifyOnResolved: boolean;
}

export interface IncidentTracker {
  appId: string;
  appName: string;
  providerType?: 'vercel' | 'netlify';
  status: 'active' | 'resolved';
  firstSeen: number;
  lastSeen: number;
  errorCount: number;
  lastNotifiedAt: number;
  lastErrorMessage: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  browserPushEnabled: true,
  soundAlerts: true,
  cooldownSeconds: 60, // 1 minute quiet time before new error alerts
  notifyOnResolved: true
};
