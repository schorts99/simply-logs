import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import type { BuildEvent, Deployment, DiscoveredApplication, ProbeResult, Provider, ProviderTarget } from '../shared/desktop';
import { publicRequest, validatePublicUrl, type NetworkResponse } from './network';

type Request = typeof publicRequest;

export function probeMetadata(headers: Record<string, string>) {
  const cache = headers['x-vercel-cache'];
  return {
    region: headers['x-vercel-id']?.split('::')[0] || (headers['x-nf-request-id'] ? 'Netlify-Edge' : 'Unknown'),
    cacheStatus: cache ? cache.toUpperCase() : (Number(headers.age) > 0 ? 'HIT' : 'Unknown'),
    server: headers.server || (headers['x-vercel-id'] ? 'Vercel' : headers['x-nf-request-id'] ? 'Netlify' : 'Unknown'),
  };
}

export async function probe(url: string, send: Request = publicRequest): Promise<ProbeResult> {
  validatePublicUrl(url);
  const started = performance.now();
  try {
    const response = await send(url, { headersOnly: true, signal: AbortSignal.timeout(8000) });
    return {
      success: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - started),
      ...probeMetadata(response.headers),
      headers: response.headers,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      statusCode: 0,
      latencyMs: Math.round(performance.now() - started),
      region: 'Unknown',
      server: 'Unknown',
      cacheStatus: 'Unknown',
      headers: {},
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : 'Connection failed.',
    };
  }
}

function providerUrl(provider: Provider, path: string, teamId?: string): URL {
  const url = new URL(path, provider === 'vercel' ? 'https://api.vercel.com' : 'https://api.netlify.com');
  if (provider === 'vercel' && teamId) url.searchParams.set('teamId', teamId);
  return url;
}

async function providerRequest(url: URL, token: string, send: Request): Promise<NetworkResponse> {
  if (!token.trim()) throw new Error('A provider token is required. Connect this application again.');
  const response = await send(url.href, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Provider returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check your token and account permissions.' : 'Try again later.'}`);
  }
  return response;
}

export async function discover(
  provider: Provider, token: string, teamId?: string, send: Request = publicRequest,
): Promise<DiscoveredApplication[]> {
  const items: DiscoveredApplication[] = [];
  let cursor: string | undefined;
  let page = 1;
  do {
    const url = providerUrl(provider, provider === 'vercel' ? '/v9/projects' : '/api/v1/sites', teamId);
    url.searchParams.set(provider === 'vercel' ? 'limit' : 'per_page', '100');
    if (cursor) url.searchParams.set('until', cursor);
    if (provider === 'netlify') url.searchParams.set('page', String(page));
    const data = JSON.parse((await providerRequest(url, token, send)).body);
    const projects = provider === 'vercel' ? data.projects : data;
    if (!Array.isArray(projects)) throw new Error('The provider returned an unexpected project list.');
    for (const item of projects) {
      if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      const deployment = item.latestDeployments?.[0]?.url;
      items.push(provider === 'vercel' ? {
        name: item.name, slug: item.name, framework: item.framework ?? undefined,
        projectId: item.id,
        deploymentUrl: deployment ? `https://${deployment}` : undefined,
      } : {
        name: item.name, slug: item.name, siteId: item.site_id || item.id,
        deploymentUrl: item.ssl_url || item.url, framework: 'Netlify',
      });
    }
    cursor = provider === 'vercel' && data.pagination?.next ? String(data.pagination.next) : undefined;
    if (provider === 'netlify' && projects.length < 100) break;
    page++;
    if (page > 100) throw new Error('Too many projects to discover at once. Narrow the account or team.');
  } while (provider === 'netlify' || cursor);
  return items;
}

export async function deployments(target: ProviderTarget, token: string, send: Request = publicRequest): Promise<Deployment[]> {
  const url = providerUrl(target.provider,
    target.provider === 'vercel' ? '/v6/deployments' : `/api/v1/sites/${encodeURIComponent(target.targetId)}/deploys`,
    target.teamId);
  if (target.provider === 'vercel') {
    url.searchParams.set('projectId', target.targetId);
    url.searchParams.set('limit', '10');
  } else url.searchParams.set('per_page', '10');
  const data = JSON.parse((await providerRequest(url, token, send)).body);
  const list = target.provider === 'vercel' ? data.deployments : data;
  if (!Array.isArray(list)) throw new Error('The provider returned an unexpected deployment list.');
  return list.map((item: Record<string, any>) => ({
    id: item.uid || item.id,
    state: String(item.readyState || item.state || 'unknown').toLowerCase(),
    url: item.ssl_url || (item.url ? (item.url.startsWith('https://') ? item.url : `https://${item.url}`) : undefined),
    commit: item.meta?.githubCommitSha || item.commit_ref,
    createdAt: typeof item.created === 'number' ? item.created : Date.parse(item.created_at) || Date.now(),
  }));
}

export async function events(
  target: ProviderTarget & { deploymentId: string }, token: string, send: Request = publicRequest,
): Promise<BuildEvent[]> {
  if (target.provider !== 'vercel') {
    throw new Error('Netlify build logs are available in its dashboard, not through the public REST API.');
  }
  const id = encodeURIComponent(target.deploymentId);
  const url = providerUrl(target.provider, `/v3/deployments/${id}/events`, target.teamId);
  url.searchParams.set('follow', '0');
  url.searchParams.set('limit', '1000');
  url.searchParams.set('direction', 'backward');
  const response = await providerRequest(url, token, send);
  const data: unknown = JSON.parse(response.body);
  if (data === null) return [];
  const list = Array.isArray(data) ? data : (data as { logs?: unknown[] })?.logs;
  if (!Array.isArray(list)) throw new Error('Build logs are not available for this deployment.');
  return list.flatMap((item): BuildEvent[] => {
    if (!item || (typeof item !== 'object' && typeof item !== 'string')) return [];
    const entry = typeof item === 'string' ? { text: item } : item;
    const message = entry.text ?? entry.message ?? entry.payload?.text;
    if (typeof message !== 'string' || !message.trim()) return [];
    const created = entry.created ?? entry.payload?.created ?? entry.date ?? entry.payload?.date ?? entry.timestamp;
    const parsed = typeof created === 'number' || /^\d+$/.test(created) ? Number(created) : Date.parse(created);
    const timestamp = Number.isFinite(parsed) ? parsed : 0;
    const fallbackId = createHash('sha256').update(`${id}:${timestamp}:${entry.serial ?? entry.payload?.serial ?? ''}:${message}`).digest('hex').slice(0, 24);
    return [{
      id: String(entry.id || entry.payload?.id || fallbackId),
      timestamp,
      message,
      level: entry.type === 'stderr' || entry.type === 'fatal' || entry.level === 'error' ? 'error' : ['warn', 'warning'].includes(entry.level) ? 'warn' : 'info',
    }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}
