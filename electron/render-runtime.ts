import { createHash } from 'node:crypto';
import type { ProviderTarget, RuntimeEvent, RuntimeHistory, RuntimeHistoryEvent } from '../shared/desktop';
import { publicRequest, publicWebSocket } from './network';
import { providerRequest, providerUrl, type Request } from './provider-request';

const HISTORY_LIMIT = 1000;

function requiredOwnerId(target: ProviderTarget): string {
  if (!target.ownerId) throw new Error('Render workspace ID is missing. Discover the service again or enter its workspace ID.');
  return target.ownerId;
}

function labels(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.flatMap(item =>
    item && typeof item.name === 'string' && typeof item.value === 'string' ? [[item.name, item.value]] : [],
  ));
}

export function renderRuntimeEvent(value: unknown): RuntimeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id || typeof row.message !== 'string' || !row.message.trim() ||
      typeof row.timestamp !== 'string') return null;
  const timestamp = Date.parse(row.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  const fields = labels(row.labels);
  const method = fields.method && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(fields.method)
    ? fields.method as RuntimeEvent['method'] : undefined;
  const parsedStatus = Number(fields.statusCode);
  const statusCode = Number.isInteger(parsedStatus) && parsedStatus >= 100 && parsedStatus <= 599 ? parsedStatus : undefined;
  const rawLevel = (fields.level || 'info').toLowerCase();
  return {
    id: row.id,
    timestamp,
    message: row.message,
    level: ['error', 'critical', 'alert', 'emergency'].includes(rawLevel) ? 'error'
      : rawLevel === 'warning' || rawLevel === 'warn' ? 'warn'
      : rawLevel === 'debug' ? 'debug' : 'info',
    source: 'runtime',
    method,
    path: fields.path,
    host: fields.host,
    statusCode,
    messageTruncated: false,
  };
}

function historyEvent(value: unknown, deploymentId: string): RuntimeHistoryEvent | null {
  const event = renderRuntimeEvent(value);
  if (!event) return null;
  return {
    ...event,
    deploymentId,
    logs: [{ level: event.level, message: event.message, messageTruncated: false }],
  };
}

function logsUrl(target: ProviderTarget, startTime: string, endTime: string): URL {
  const url = providerUrl('render', '/v1/logs');
  url.searchParams.set('ownerId', requiredOwnerId(target));
  url.searchParams.set('resource', target.targetId);
  url.searchParams.set('startTime', startTime);
  url.searchParams.set('endTime', endTime);
  url.searchParams.set('direction', 'forward');
  url.searchParams.set('limit', '100');
  url.searchParams.append('type', 'app');
  url.searchParams.append('type', 'request');
  return url;
}

export async function renderRuntimeHistory(
  target: ProviderTarget, deploymentId: string, token: string, signal: AbortSignal,
  send: Request = publicRequest, now = Date.now(),
): Promise<RuntimeHistory> {
  requiredOwnerId(target);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const start = now - 60 * 60 * 1000;
  let startTime = new Date(start).toISOString();
  let endTime = new Date(now).toISOString();
  const events = new Map<string, RuntimeHistoryEvent>();
  const cursors = new Set<string>();
  let truncated = false;
  for (let page = 0; page < 100; page++) {
    deadline.throwIfAborted();
    const url = logsUrl(target, startTime, endTime);
    const data = JSON.parse((await providerRequest(url, token, send, { signal: deadline })).body);
    if (!Array.isArray(data?.logs) || typeof data.hasMore !== 'boolean' ||
        typeof data.nextStartTime !== 'string' || typeof data.nextEndTime !== 'string') {
      throw new Error('Render returned an unexpected runtime history response.');
    }
    for (const row of data.logs) {
      const event = historyEvent(row, deploymentId);
      if (event && event.timestamp >= start && event.timestamp <= now) events.set(event.id, event);
    }
    if (!data.hasMore) break;
    if (events.size >= HISTORY_LIMIT) { truncated = true; break; }
    const cursor = `${data.nextStartTime}:${data.nextEndTime}`;
    if (cursors.has(cursor)) {
      truncated = true;
      break;
    }
    if (page === 99) {
      truncated = true;
      break;
    }
    cursors.add(cursor);
    startTime = data.nextStartTime;
    endTime = data.nextEndTime;
  }
  deadline.throwIfAborted();
  const ordered = [...events.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (ordered.length > HISTORY_LIMIT) truncated = true;
  return { events: ordered.slice(-HISTORY_LIMIT), truncated };
}

export async function streamRenderRuntimeLogs(
  target: ProviderTarget, token: string, onLog: (event: RuntimeEvent) => void,
  signal: AbortSignal, openSocket: typeof publicWebSocket = publicWebSocket,
): Promise<void> {
  const url = providerUrl('render', '/v1/logs/subscribe');
  url.protocol = 'wss:';
  url.searchParams.set('ownerId', requiredOwnerId(target));
  url.searchParams.set('resource', target.targetId);
  url.searchParams.set('startTime', new Date().toISOString());
  url.searchParams.append('type', 'app');
  url.searchParams.append('type', 'request');
  await openSocket(url.href, {}, value => {
    signal.throwIfAborted();
    const event = renderRuntimeEvent(value);
    if (event) onLog(event);
  }, signal, undefined, { Authorization: `Bearer ${token}` });
}

export async function renderBuildEvents(
  target: ProviderTarget, token: string, createdAt: number, signal: AbortSignal,
  send: Request = publicRequest,
): Promise<{ id: string; timestamp: number; message: string; level: 'info' | 'warn' | 'error' }[]> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let startTime = new Date(createdAt).toISOString();
  let endTime = new Date().toISOString();
  const events = new Map<string, { id: string; timestamp: number; message: string; level: 'info' | 'warn' | 'error' }>();
  const cursors = new Set<string>();
  for (let page = 0; page < 20; page++) {
    deadline.throwIfAborted();
    const url = providerUrl('render', '/v1/logs');
    url.searchParams.set('ownerId', requiredOwnerId(target));
    url.searchParams.set('resource', target.targetId);
    url.searchParams.set('startTime', startTime);
    url.searchParams.set('endTime', endTime);
    url.searchParams.set('direction', 'forward');
    url.searchParams.set('limit', '100');
    url.searchParams.append('type', 'build');
    const data = JSON.parse((await providerRequest(url, token, send, { signal: deadline })).body);
    if (!Array.isArray(data?.logs) || typeof data.hasMore !== 'boolean' ||
        typeof data.nextStartTime !== 'string' || typeof data.nextEndTime !== 'string') {
      throw new Error('Render returned an unexpected build log response.');
    }
    for (const row of data.logs) {
      const event = renderRuntimeEvent(row);
      if (!event) continue;
      const id = createHash('sha256').update(`${target.targetId}:${event.id}`).digest('hex').slice(0, 24);
      events.set(id, {
        id, timestamp: event.timestamp, message: event.message,
        level: event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'info',
      });
    }
    if (!data.hasMore) break;
    if (events.size >= 1000) {
      throw new Error('Render build log history exceeded 1,000 entries. Some build logs may be missing.');
    }
    const cursor = `${data.nextStartTime}:${data.nextEndTime}`;
    if (cursors.has(cursor)) throw new Error('Render repeated a build log pagination cursor.');
    cursors.add(cursor);
    startTime = data.nextStartTime;
    endTime = data.nextEndTime;
    if (page === 19) throw new Error('Render build log history exceeded the pagination limit.');
  }
  deadline.throwIfAborted();
  return [...events.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-1000);
}
