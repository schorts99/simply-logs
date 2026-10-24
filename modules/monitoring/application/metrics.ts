import type { Application, Environment } from '../../projects/domain/Project';
import type { LogEntry } from '../domain/LogEntry';

export function percentile95(values: number[]): number | null {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] : null;
}

export function scopeLogs(logs: LogEntry[], apps: Application[], environment: Environment | 'all', appId: string | null): LogEntry[] {
  const allowed = new Set(apps.filter(app => (environment === 'all' || app.environment === environment) && (!appId || app.id === appId)).map(app => app.id));
  return logs.filter(log => allowed.has(log.applicationId));
}
