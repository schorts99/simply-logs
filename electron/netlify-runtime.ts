import { createHash } from 'node:crypto';
import type { ProviderTarget, RuntimeEvent, RuntimeHistory, RuntimeHistoryEvent } from '../shared/desktop';
import { publicRequest, publicWebSocket } from './network';
import { providerRequest, providerUrl, type Request } from './provider-request';

const FUNCTION_LIMIT = 10;
const HISTORY_LIMIT = 1000;
const ANALYTICS = 'https://analytics.services.netlify.com';
const SOCKETEER = 'wss://socketeer.services.netlify.com';

interface NetlifyFunction {
  n: string;
  oid: string;
  a: string;
  branch?: string | null;
}

function matchesEnvironment(context: unknown, environment: ProviderTarget['environment']): boolean {
  return environment === 'preview' ? context === 'deploy-preview' || context === 'branch-deploy' : context === 'production';
}

function rejectDevelopment(target: ProviderTarget): void {
  if (target.environment === 'development') throw new Error('Netlify runtime logs require a production or preview deployment, not local development.');
}

export async function netlifyRuntimeDeployment(
  target: ProviderTarget, token: string, send: Request = publicRequest, signal = AbortSignal.timeout(15000),
): Promise<string | null> {
  rejectDevelopment(target);
  signal.throwIfAborted();
  if (target.environment !== 'preview') {
    const site = JSON.parse((await providerRequest(
      providerUrl('netlify', `/api/v1/sites/${encodeURIComponent(target.targetId)}`), token, send, { signal },
    )).body);
    signal.throwIfAborted();
    const deploy = site?.published_deploy;
    if (deploy === undefined || deploy === null) return null;
    if (typeof deploy.id !== 'string' || !deploy.id ||
        (deploy.context !== undefined && !matchesEnvironment(deploy.context, target.environment))) {
      throw new Error('Netlify returned an unexpected published deployment.');
    }
    return deploy.id;
  }
  for (let page = 1; page <= 100; page++) {
    signal.throwIfAborted();
    const url = providerUrl('netlify', `/api/v1/sites/${encodeURIComponent(target.targetId)}/deploys`);
    url.searchParams.set('state', 'ready');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const deploys = JSON.parse((await providerRequest(url, token, send, { signal })).body);
    signal.throwIfAborted();
    if (!Array.isArray(deploys)) throw new Error('Netlify returned an unexpected deployment list.');
    const deploy = deploys.find(item => item?.state === 'ready' && matchesEnvironment(item.context, 'preview'));
    if (deploy) {
      if (typeof deploy.id !== 'string' || !deploy.id) throw new Error('Netlify returned an unexpected preview deployment.');
      return deploy.id;
    }
    if (deploys.length < 100) return null;
  }
  throw new Error('Too many Netlify deployments to select a ready preview. Try again later.');
}

async function deploymentFunctions(
  target: ProviderTarget, deploymentId: string, token: string, signal: AbortSignal, send: Request,
): Promise<{ functions: NetlifyFunction[]; warnings: string[] }> {
  rejectDevelopment(target);
  signal.throwIfAborted();
  const url = providerUrl('netlify', `/api/v1/sites/${encodeURIComponent(target.targetId)}/deploys/${encodeURIComponent(deploymentId)}`);
  const deploy = JSON.parse((await providerRequest(url, token, send, { signal })).body);
  signal.throwIfAborted();
  if (deploy?.id !== deploymentId || deploy.state !== 'ready' || !matchesEnvironment(deploy.context, target.environment)) {
    throw new Error('The Netlify deployment does not match the selected environment or is not ready.');
  }
  const functions: NetlifyFunction[] = deploy.available_functions ?? [];
  if (!Array.isArray(functions) || functions.some(fn => !fn ||
      ['n', 'oid', 'a'].some(key => typeof fn[key as keyof NetlifyFunction] !== 'string' || !fn[key as keyof NetlifyFunction]) ||
      (fn.branch !== undefined && fn.branch !== null && typeof fn.branch !== 'string'))) {
    throw new Error('Netlify returned an unexpected function list.');
  }
  const warnings = functions.length > FUNCTION_LIMIT
    ? [`Netlify runtime monitoring is limited to ${FUNCTION_LIMIT} Functions per application; ${functions.length - FUNCTION_LIMIT} additional Functions are not monitored.`]
    : [];
  return { functions: [...functions].sort((a, b) => a.n.localeCompare(b.n)).slice(0, FUNCTION_LIMIT), warnings };
}

export function netlifyRuntimeEvent(
  value: unknown, source: 'serverless' | 'edge', functionName?: string, receivedAt?: number,
): RuntimeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if ((row.type === 'error' && typeof row.level !== 'string') || typeof row.error === 'string') {
    throw new Error(typeof row.message === 'string' ? row.message : typeof row.error === 'string' ? row.error : 'Netlify rejected the runtime log stream.');
  }
  const timestamp = typeof row.ts === 'number' ? row.ts : receivedAt;
  if (timestamp === undefined || !Number.isFinite(timestamp) || typeof row.message !== 'string' || !row.message.trim()) return null;
  const name = functionName || (typeof row.function === 'string' ? row.function : typeof row.name === 'string' ? row.name : 'edge-function');
  const rawLevel = typeof row.level === 'string' ? row.level.toLowerCase() : 'info';
  const level = ['error', 'fatal'].includes(rawLevel) ? 'error' : ['warn', 'warning'].includes(rawLevel) ? 'warn'
    : ['trace', 'debug'].includes(rawLevel) ? 'debug' : 'info';
  // Netlify does not supply a stable line ID in both history and WebSocket messages.
  const id = createHash('sha256').update(JSON.stringify([source, name, timestamp, level, row.message])).digest('hex').slice(0, 24);
  return {
    id, timestamp, level, source, message: row.message, functionName: name,
    path: typeof row.request_path === 'string' ? row.request_path : undefined,
    requestId: typeof row.request_id === 'string' ? row.request_id : typeof row.netlify_request_id === 'string' ? row.netlify_request_id : undefined,
    messageTruncated: row.messageTruncated === true || row.message_truncated === true,
  };
}

async function queryHistory(
  baseUrl: URL, source: 'serverless' | 'edge', functionName: string | undefined, deploymentId: string,
  token: string, signal: AbortSignal, send: Request, from: number, to: number,
): Promise<RuntimeHistory> {
  let events = new Map<string, RuntimeHistoryEvent>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let truncated = false;
  try {
    for (let page = 0; page < 100; page++) {
      signal.throwIfAborted();
      const url = new URL(baseUrl);
      url.searchParams.set('from', String(from));
      url.searchParams.set('to', String(to));
      url.searchParams.set('deploy_id', deploymentId);
      if (cursor) url.searchParams.set('cursor', cursor);
      const data = JSON.parse((await providerRequest(url, token, send, { signal })).body);
      signal.throwIfAborted();
      if (!Array.isArray(data?.logs) || (data.pagination?.next !== undefined && data.pagination.next !== null && typeof data.pagination.next !== 'string')) {
        throw new Error('Netlify returned an unexpected runtime history response.');
      }
      for (const row of data.logs) {
        if (row?.deploy_id !== undefined && row.deploy_id !== deploymentId) continue;
        const event = netlifyRuntimeEvent(row, source, functionName);
        if (!event || event.timestamp < from || event.timestamp > to) continue;
        events.set(event.id, { ...event, deploymentId, logs: [{
          level: typeof row.level === 'string' ? row.level : 'INFO', message: event.message, messageTruncated: event.messageTruncated,
        }] });
      }
      if (events.size > HISTORY_LIMIT) {
        truncated = true;
        events = new Map([...events.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, HISTORY_LIMIT).map(event => [event.id, event]));
      }
      cursor = data.pagination?.next || undefined;
      if (!cursor) return { events: [...events.values()], truncated };
      if (cursors.has(cursor)) return { events: [...events.values()], truncated: true, retry: true, warnings: ['Netlify repeated a runtime history cursor; some logs may be missing.'] };
      cursors.add(cursor);
    }
    return { events: [...events.values()], truncated: true };
  } catch (error) {
    signal.throwIfAborted();
    return {
      events: [...events.values()], truncated, retry: true,
      warnings: [`Netlify ${functionName ? `Function ${functionName}` : 'Edge Functions'} history unavailable: ${error instanceof Error ? error.message : 'Unexpected error.'}`],
    };
  }
}

export async function netlifyRuntimeHistory(
  target: ProviderTarget, token: string, signal: AbortSignal, send: Request = publicRequest, now = Date.now(),
): Promise<RuntimeHistory> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const deploymentId = await netlifyRuntimeDeployment(target, token, send, deadline);
  if (!deploymentId) return { events: [], truncated: false };
  const { functions, warnings } = await deploymentFunctions(target, deploymentId, token, deadline, send);
  const site = encodeURIComponent(target.targetId);
  const queries = functions.map(fn => ({
    url: new URL(`${ANALYTICS}/v2/sites/${site}/${fn.branch ? `branch/${encodeURIComponent(fn.branch)}/` : ''}function_logs/${encodeURIComponent(fn.n)}`),
    source: 'serverless' as const, name: fn.n,
  }));
  const results = await Promise.all([
    ...queries.map(query => queryHistory(query.url, query.source, query.name, deploymentId, token, deadline, send, now - 60 * 60 * 1000, now)),
    queryHistory(new URL(`${ANALYTICS}/v2/sites/${site}/edge_function_logs`), 'edge', undefined, deploymentId, token, deadline, send, now - 60 * 60 * 1000, now),
  ]);
  deadline.throwIfAborted();
  const events = results.flatMap(result => result.events).sort((a, b) => b.timestamp - a.timestamp);
  return {
    events: events.slice(0, HISTORY_LIMIT).reverse(),
    truncated: events.length > HISTORY_LIMIT || results.some(result => result.truncated),
    warnings: [...warnings, ...results.flatMap(result => result.warnings ?? [])],
    retry: results.some(result => result.retry),
  };
}

function warning(message: string): RuntimeEvent {
  return {
    id: `netlify-warning:${createHash('sha256').update(message).digest('hex').slice(0, 24)}`,
    timestamp: Date.now(), level: 'warn', source: 'runtime', message, messageTruncated: false,
  };
}

export async function streamNetlifyRuntimeLogs(
  target: ProviderTarget & { deploymentId: string }, token: string, onLog: (event: RuntimeEvent) => void,
  signal: AbortSignal, send: Request = publicRequest, openSocket = publicWebSocket,
): Promise<void> {
  const { functions, warnings } = await deploymentFunctions(
    target, target.deploymentId, token, AbortSignal.any([signal, AbortSignal.timeout(15000)]), send,
  );
  signal.throwIfAborted();
  warnings.forEach(message => onLog(warning(message)));
  const streams = functions.map(fn => ({
    url: `${SOCKETEER}/function/logs`, source: 'serverless' as 'serverless' | 'edge', name: fn.n,
    authentication: { function_id: fn.oid, site_id: target.targetId, access_token: token, account_id: fn.a } as Record<string, unknown>,
  }));
  streams.push({
    url: `${SOCKETEER}/edge-function/logs`, source: 'edge', name: '',
    authentication: {
      deploy_id: target.deploymentId, site_id: target.targetId, access_token: token,
      since: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
  });
  await Promise.all(streams.map(async stream => {
    while (!signal.aborted) {
      try {
        await openSocket(stream.url, stream.authentication, value => {
          signal.throwIfAborted();
          if (value && typeof value === 'object' && 'deploy_id' in value && value.deploy_id !== target.deploymentId) return;
          const event = netlifyRuntimeEvent(value, stream.source, stream.name || undefined, Date.now());
          if (event) onLog(event);
        }, signal);
        signal.throwIfAborted();
        onLog(warning(`Netlify ${stream.name || 'Edge Functions'} runtime stream ended. Retrying automatically.`));
      } catch (error) {
        signal.throwIfAborted();
        onLog(warning(`Netlify ${stream.name || 'Edge Functions'} runtime stream unavailable: ${error instanceof Error ? error.message : 'Unexpected error.'} Retrying automatically.`));
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 30000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
  }));
}
