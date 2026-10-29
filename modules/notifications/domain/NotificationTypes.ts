import type { Environment } from '../../projects/domain/Project';

export type NotificationType = 'error' | 'resolved' | 'warning' | 'info';
export type IncidentKind = 'health' | 'deployment' | 'runtime';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  type: NotificationType;
  applicationId?: string;
  applicationName?: string;
  providerType?: 'vercel' | 'netlify';
  environment?: Environment;
  kind?: IncidentKind;
  read: boolean;
  suppressedRepeats?: number;
  downtimeMs?: number;
}

export interface MutedApplication {
  name: string;
  until: number;
}

export interface NotificationSettings {
  enabled: boolean;
  browserPushEnabled: boolean;
  soundAlerts: boolean;
  cooldownSeconds: number; // Duration of quiet time required before re-alerting
  notifyOnResolved: boolean;
  failureThreshold: number; // Consecutive failed health checks before alerting
  runtimeErrorAlerts: boolean;
  runtimeErrorsPerMinute: number;
  mutedApplications: Record<string, MutedApplication>;
}

export interface IncidentTracker {
  appId: string;
  appName: string;
  providerType?: 'vercel' | 'netlify';
  environment?: Environment;
  kind: IncidentKind;
  status: 'pending' | 'active';
  firstSeen: number;
  lastSeen: number;
  errorCount: number;
  consecutiveFailures: number;
  lastNotifiedAt: number;
  lastErrorMessage: string;
}

export const FAILURE_THRESHOLD_OPTIONS = [1, 2, 3, 5];
export const RUNTIME_ERROR_RATE_OPTIONS = [3, 5, 10, 25];
export const COOLDOWN_OPTIONS = [30, 60, 120, 300];
export const MUTE_DURATION_MS = 60 * 60 * 1000;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  browserPushEnabled: true,
  soundAlerts: true,
  cooldownSeconds: 60, // 1 minute quiet time before new error alerts
  notifyOnResolved: true,
  failureThreshold: 2,
  runtimeErrorAlerts: true,
  runtimeErrorsPerMinute: 5,
  mutedApplications: {},
};

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  if (elapsed < 10_000) return 'Just now';
  return `${formatDuration(elapsed).split(' ')[0]} ago`;
}

export function alertContext(item: Pick<NotificationItem, 'environment' | 'providerType'>): string {
  const provider = item.providerType === 'netlify' ? 'Netlify' : item.providerType === 'vercel' ? 'Vercel' : undefined;
  return [item.environment, provider].filter(Boolean).join(' · ');
}
