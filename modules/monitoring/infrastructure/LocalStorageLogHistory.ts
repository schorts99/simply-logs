import type { LogEntry } from '../domain/LogEntry';

const KEY = 'simply_logs_history_v1';
export const LOG_HISTORY_LIMIT = 1000;

export interface LogHistory {
  load(): LogEntry[];
  save(logs: LogEntry[]): void;
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const log = value as Record<string, unknown>;
  return ['id', 'applicationId', 'applicationName', 'message'].every(key => typeof log[key] === 'string') &&
    typeof log.timestamp === 'number' && Number.isFinite(log.timestamp) &&
    ['vercel', 'netlify'].includes(log.providerType as string) &&
    ['production', 'preview', 'development'].includes(log.environment as string) &&
    ['info', 'warn', 'error', 'debug'].includes(log.level as string) &&
    ['runtime', 'edge', 'build', 'serverless', 'probe'].includes(log.source as string) &&
    ['path', 'region', 'host', 'requestId', 'stackTrace'].every(key => log[key] === undefined || typeof log[key] === 'string') &&
    ['statusCode', 'latencyMs'].every(key => log[key] === undefined || (typeof log[key] === 'number' && Number.isFinite(log[key]))) &&
    (log.method === undefined || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(log.method as string)) &&
    (log.observation === undefined || ['healthy', 'unhealthy', 'unknown'].includes(log.observation as string)) &&
    (log.monitorKind === undefined || ['health', 'deployment'].includes(log.monitorKind as string)) &&
    (log.isRealTelemetry === undefined || typeof log.isRealTelemetry === 'boolean') &&
    (log.payload === undefined || (log.payload !== null && typeof log.payload === 'object' && !Array.isArray(log.payload)));
}

export class LocalStorageLogHistory implements LogHistory {
  load(): LogEntry[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const logs: unknown = JSON.parse(raw);
      if (!Array.isArray(logs) || !logs.every(isLogEntry)) throw new Error('Invalid log history.');
      return logs.slice(-LOG_HISTORY_LIMIT);
    } catch {
      throw new Error('Saved log history could not be read and has not been overwritten. New logs will remain session-only. Check storage access or restore a backup.');
    }
  }

  save(logs: LogEntry[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(logs.slice(-LOG_HISTORY_LIMIT)));
    } catch {
      throw new Error('Log history could not be saved. New logs may be lost after restarting. Storage may be full or unavailable; export logs to keep a record.');
    }
  }
}
