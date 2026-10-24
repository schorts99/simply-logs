import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHistory, runtimeHistoryEvent } from '../electron/monitoring';
import { ProviderAdapter } from '../modules/monitoring/infrastructure/ProviderAdapter';
import { LogStreamService } from '../modules/monitoring/application/LogStreamService';
import type { RuntimeHistory } from '../shared/desktop';
import type { LogEntry } from '../modules/monitoring/domain/LogEntry';
import { application, desktop, entry } from './fixtures';

const now = 1_800_000_000_000;
const target = {
  provider: 'vercel' as const, targetId: 'project/name', credentialId: 'credential',
  teamId: 'team-one', environment: 'production' as const,
};
const row = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'request-one', deploymentId: 'deployment-old', timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
  requestMethod: 'POST', requestPath: '/api/example', statusCode: 503,
  environment: 'production', domain: 'example.com', events: [{ source: 'serverless' }],
  logs: [
    { level: 'info', message: 'Starting request' },
    { level: 'error', message: 'Request failed', messageTruncated: true },
  ],
  ...overrides,
});
const response = (value: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(value) });
const accountApp = () => application({
  deploymentUrl: undefined,
  config: { connectionMode: 'account', credentialId: 'credential', vercelProjectId: target.targetId },
});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('historical requests preserve all console messages, severity, truncation and request metadata', () => {
  const event = runtimeHistoryEvent(row())!;
  assert.equal(event.id, 'request-one');
  assert.equal(event.deploymentId, 'deployment-old');
  assert.equal(event.timestamp, now - 30 * 60 * 1000);
  assert.equal(event.message, 'Starting request\nRequest failed');
  assert.equal(event.level, 'error');
  assert.equal(event.source, 'serverless');
  assert.equal(event.method, 'POST');
  assert.equal(event.path, '/api/example');
  assert.equal(event.host, 'example.com');
  assert.equal(event.statusCode, 503);
  assert.equal(event.messageTruncated, true);
  assert.deepEqual(event.logs, [
    { level: 'info', message: 'Starting request', messageTruncated: false },
    { level: 'error', message: 'Request failed', messageTruncated: true },
  ]);
  for (const source of ['edge-function', 'edge-middleware']) {
    assert.equal(runtimeHistoryEvent(row({ events: [{ source }] }))!.source, 'edge');
  }
  const request = runtimeHistoryEvent(row({ logs: [], events: [] }))!;
  assert.equal(request.message, 'POST /api/example');
  assert.equal(request.source, 'runtime');
  for (const input of [null, {}, row({ requestId: '' }), row({ deploymentId: null }), row({ timestamp: 'invalid' })]) {
    assert.equal(runtimeHistoryEvent(input), null);
  }
});

test('history queries exactly one fixed hour, scopes by owner/project/environment and paginates across deployments', async () => {
  const urls: URL[] = [];
  let signal: AbortSignal | undefined;
  const controller = new AbortController();
  const history = await runtimeHistory(target, 'fixture-token', controller.signal, async (input, options) => {
    const url = new URL(input);
    urls.push(url);
    assert.ok(options?.headers?.Authorization);
    assert.equal(options?.headers?.Accept, 'application/json');
    signal ??= options?.signal;
    assert.equal(options?.signal, signal, 'all pages share one cancellation deadline');
    if (url.hostname === 'api.vercel.com') {
      assert.equal(url.pathname, '/v9/projects/project%2Fname');
      assert.equal(url.searchParams.get('teamId'), target.teamId);
      return response({ id: 'prj-resolved', accountId: 'team-resolved' });
    }
    assert.equal(url.origin, 'https://vercel.com');
    assert.equal(url.pathname, '/api/logs/request-logs');
    assert.equal(url.searchParams.get('ownerId'), 'team-resolved');
    assert.equal(url.searchParams.get('teamId'), target.teamId);
    assert.equal(url.searchParams.get('projectId'), 'prj-resolved');
    assert.equal(url.searchParams.get('environment'), 'production');
    assert.equal(url.searchParams.get('startDate'), String(now - 60 * 60 * 1000));
    assert.equal(url.searchParams.get('endDate'), String(now));
    assert.equal(url.searchParams.has('deploymentId'), false, 'history includes previous deployments in the same environment');
    return url.searchParams.get('page') === '0'
      ? response({ rows: [row({ requestId: 'newer', deploymentId: 'deployment-new', timestamp: now - 1000 })], hasMoreRows: true })
      : response({ rows: [row(), row()], hasMoreRows: false });
  }, now);
  assert.equal(urls.length, 3);
  assert.deepEqual(history.events.map(event => event.id), ['request-one', 'newer']);
  assert.equal(history.truncated, false);
});

test('personal accounts and preview queries use the correct owner and reject out-of-window or wrong-environment rows', async () => {
  const history = await runtimeHistory({ ...target, teamId: undefined, environment: 'preview' }, 'fixture-token', new AbortController().signal, async input => {
    const url = new URL(input);
    if (url.hostname === 'api.vercel.com') return response({ id: 'project-one', accountId: 'user-one' });
    assert.equal(url.searchParams.get('ownerId'), 'user-one');
    assert.equal(url.searchParams.has('teamId'), false);
    assert.equal(url.searchParams.get('environment'), 'preview');
    return response({ rows: [
      row({ requestId: 'start-boundary', environment: 'preview', timestamp: now - 60 * 60 * 1000 }),
      row({ requestId: 'end-boundary', environment: 'preview', timestamp: now }),
      row({ requestId: 'too-old', environment: 'preview', timestamp: now - 60 * 60 * 1000 - 1 }),
      row({ requestId: 'future', environment: 'preview', timestamp: now + 1 }),
      row({ requestId: 'wrong-environment' }),
      null,
    ], hasMoreRows: false });
  }, now);
  assert.deepEqual(history.events.map(event => event.id), ['start-boundary', 'end-boundary']);
});

test('history is bounded to the newest 1,000 requests and reports truncation instead of silently dropping pages', async () => {
  let pages = 0;
  const history = await runtimeHistory(target, 'fixture-token', new AbortController().signal, async input => {
    const url = new URL(input);
    if (url.hostname === 'api.vercel.com') return response({ id: 'project-one', accountId: 'team-one' });
    const page = Number(url.searchParams.get('page'));
    pages++;
    return response({
      rows: Array.from({ length: 600 }, (_, offset) => row({
        requestId: `request-${page * 600 + offset}`, timestamp: now - (page * 600 + offset),
      })),
      hasMoreRows: true,
    });
  }, now);
  assert.equal(pages, 2);
  assert.equal(history.events.length, 1000);
  assert.equal(history.events[0].id, 'request-999');
  assert.equal(history.events.at(-1)!.id, 'request-0');
  assert.equal(history.truncated, true);
});

test('history reports provider errors, missing permissions and malformed responses explicitly', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(runtimeHistory(target, 'fixture-token', new AbortController().signal, async input =>
      new URL(input).hostname === 'api.vercel.com' ? response({ id: 'project', accountId: 'team' }) : { status, headers: {}, body: '{}' },
    ), new RegExp(`HTTP ${status}`));
  }
  for (const data of [null, {}, { rows: {} }, { rows: [], hasMoreRows: 'yes' }, { rows: [], hasMoreRows: true }]) {
    await assert.rejects(runtimeHistory(target, 'fixture-token', new AbortController().signal, async input =>
      new URL(input).hostname === 'api.vercel.com' ? response({ id: 'project', accountId: 'team' }) : response(data),
    ), /runtime history/);
  }
  await assert.rejects(runtimeHistory({ ...target, teamId: undefined }, 'fixture-token', new AbortController().signal, async () => response({ id: 'project' })), /project owner/);
  await assert.rejects(runtimeHistory(target, '', new AbortController().signal), /token is required/);
  await assert.rejects(runtimeHistory({ ...target, provider: 'netlify' }, 'fixture-token', new AbortController().signal), /only for Vercel/);
  await assert.rejects(runtimeHistory({ ...target, environment: 'development' }, 'fixture-token', new AbortController().signal), /local development/);
});

test('cancelling history aborts its request and prevents subsequent pages', async () => {
  const controller = new AbortController();
  let pages = 0;
  await assert.rejects(runtimeHistory(target, 'fixture-token', controller.signal, async input => {
    if (new URL(input).hostname === 'api.vercel.com') return response({ id: 'project', accountId: 'team' });
    pages++;
    controller.abort();
    return response({ rows: [row()], hasMoreRows: true });
  }, now), /abort/i);
  assert.equal(pages, 1);
  await assert.rejects(runtimeHistory(target, 'fixture-token', controller.signal, async () => {
    assert.fail('an already cancelled history request must not access the network');
  }), /abort/i);
});

test('the entire history lookup has one fifteen-second deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 15000);
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(new Error('History query timed out')), milliseconds);
    return deadline.signal;
  });
  let ready!: () => void;
  const requested = new Promise<void>(resolve => { ready = resolve; });
  const pending = runtimeHistory(target, 'fixture-token', new AbortController().signal, async (_input, options) => {
    ready();
    return new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    });
  });
  const rejected = assert.rejects(pending, /timed out|timeout/i);
  await requested;
  context.mock.timers.tick(15000);
  await rejected;
});

test('history loads once alongside live logs, keeps old deployment metadata and ignores callbacks after unsubscribe', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let receive!: (history: RuntimeHistory) => void;
  let historyRequests = 0;
  let historyStops = 0;
  let streams = 0;
  const adapter = new ProviderAdapter('vercel', () => desktop({
    loadRuntimeHistory: (input, onHistory) => {
      assert.equal(input.environment, 'production');
      historyRequests++;
      receive = onHistory;
      return () => { historyStops++; };
    },
    runtimeDeployment: async () => 'deployment-current',
    subscribeRuntimeLogs: () => { streams++; return () => {}; },
  }));
  const logs: LogEntry[] = [];
  const stop = adapter.subscribeLogs(accountApp(), log => logs.push(log));
  await tick();
  assert.equal(streams, 1, 'a slow history lookup cannot hold up the live stream');
  const historical = runtimeHistoryEvent(row())!;
  receive({ events: [historical], truncated: false });
  const result = logs.find(log => log.requestId === historical.id)!;
  assert.equal(result.id, 'app-one:runtime:deployment-old:request-one');
  assert.equal(result.environment, 'production');
  assert.equal(result.observation, undefined);
  assert.equal(result.monitorKind, undefined);
  assert.deepEqual(result.payload, {
    deploymentId: 'deployment-old', historical: true, messageTruncated: true, logs: historical.logs,
  });
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(historyRequests, 1);
  stop();
  assert.equal(historyStops, 1);
  const count = logs.length;
  receive({ events: [historical], truncated: true });
  assert.equal(logs.length, count);
});

test('history failures retry without stopping live logs, and partial histories show a warning', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  let streams = 0;
  const adapter = new ProviderAdapter('vercel', () => desktop({
    loadRuntimeHistory: (_input, onHistory, onError) => {
      queueMicrotask(() => {
        if (++requests === 1) onError('Provider returned HTTP 403');
        else onHistory({ events: [], truncated: true });
      });
      return () => {};
    },
    runtimeDeployment: async () => 'deployment',
    subscribeRuntimeLogs: () => { streams++; return () => {}; },
  }));
  const logs: LogEntry[] = [];
  const stop = adapter.subscribeLogs(accountApp(), log => logs.push(log));
  await tick();
  assert.equal(streams, 1);
  assert.match(logs.find(log => log.message.includes('history unavailable'))!.message, /403/);
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(requests, 2);
  assert.equal(streams, 1);
  assert.match(logs.at(-1)!.message, /history was limited/);
  stop();
});

test('late history merges chronologically with live logs, enriching matching IDs without alerts or inflated throughput', () => {
  const service = new LogStreamService();
  let observations = 0;
  service.subscribeEntries(() => { observations++; });
  const live = entry({ id: 'live', timestamp: now, source: 'serverless', monitorKind: undefined, observation: undefined });
  service.addLog(live);
  const historical = entry({
    id: 'old', timestamp: now - 1000, source: 'serverless', payload: { historical: true },
    monitorKind: undefined, observation: undefined,
  });
  service.addLog(historical);
  service.addLog({ ...live, message: 'All request output', payload: { historical: true } });
  assert.deepEqual(service.getLogs().map(log => log.id), ['old', 'live']);
  assert.equal(service.getLogs()[1].message, 'All request output');
  assert.equal(observations, 1);
  assert.equal(service.getLogsPerSecond(), 1 / 3);
  service.addLog(live);
  assert.equal(service.getLogs().length, 2);
});

test('old backfill cannot evict newer logs from a full viewer', () => {
  const service = new LogStreamService();
  for (let i = 0; i < 1000; i++) service.addLog(entry({ id: String(i), timestamp: now + i }));
  service.addLog(entry({ id: 'old-history', timestamp: now - 1000, payload: { historical: true } }));
  assert.equal(service.getLogs().length, 1000);
  assert.equal(service.getLogs()[0].id, '0');
  assert.equal(service.getLogs().at(-1)!.id, '999');
});

test('clearing while history is pending prevents old history from repopulating the viewer', () => {
  const adapter = new ProviderAdapter('vercel');
  adapter.subscribeLogs = () => () => {};
  const service = new LogStreamService({ getAdapter: () => adapter });
  service.syncApplications([application()]);
  service.clearLogs();
  service.addLog(entry({ timestamp: Date.now() - 1000, payload: { historical: true } }));
  assert.deepEqual(service.getLogs(), []);
  service.addLog(entry({ message: 'New live output' }));
  assert.equal(service.getLogs()[0].message, 'New live output');
  service.dispose();
});
