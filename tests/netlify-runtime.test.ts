import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeDeployment, runtimeHistory, streamRuntimeLogs } from '../electron/monitoring';
import { netlifyRuntimeEvent } from '../electron/netlify-runtime';
import type { publicWebSocket } from '../electron/network';
import { ProviderAdapter } from '../modules/monitoring/infrastructure/ProviderAdapter';
import { LogStreamService } from '../modules/monitoring/application/LogStreamService';
import type { ProviderTarget, RuntimeEvent, RuntimeHistory } from '../shared/desktop';
import type { Request } from '../electron/provider-request';
import { application, desktop } from './fixtures';

const now = 1_800_000_000_000;
const deployId = 'deploy/selected';
const target: ProviderTarget = {
  provider: 'netlify', targetId: 'site/one', credentialId: 'credential', environment: 'production',
};
const fn = { n: 'checkout', oid: 'function-one', a: 'account-one', branch: null };
const line = { ts: now - 30 * 60 * 1000, type: 'line', message: 'Checkout failed', level: 'ERROR', request_id: 'request-one' };
const response = (value: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(value) });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function api(
  history: (url: URL) => ReturnType<typeof response> = () => response({ logs: [] }),
  functions: unknown[] = [fn], environment = 'production',
): Request {
  return async (input, options) => {
    const url = new URL(input);
    assert.ok(options?.headers?.Authorization);
    if (url.hostname === 'analytics.services.netlify.com') return history(url);
    assert.equal(url.origin, 'https://api.netlify.com');
    if (url.pathname === '/api/v1/sites/site%2Fone') return response({ published_deploy: { id: deployId, context: 'production' } });
    if (url.pathname === '/api/v1/sites/site%2Fone/deploys') return response([
      { id: 'production', state: 'ready', context: 'production' },
      { id: deployId, state: 'ready', context: 'deploy-preview' },
    ]);
    if (url.pathname.endsWith('/deploys/deploy%2Fselected')) return response({
      id: deployId, state: 'ready', context: environment, available_functions: functions,
    });
    assert.fail(`Unexpected Netlify request: ${url.href}`);
  };
}

test('Netlify production runtime follows the published deployment, including rollbacks, not the newest build', async () => {
  let published = 'older-published';
  const send: Request = async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/api/v1/sites/site%2Fone');
    return response({ published_deploy: { id: published, context: 'production' }, deploys: [{ id: 'new-build' }] });
  };
  assert.equal(await runtimeDeployment(target, 'fixture-token', send), 'older-published');
  published = 'rollback';
  assert.equal(await runtimeDeployment(target, 'fixture-token', send), 'rollback');
  assert.equal(await runtimeDeployment(target, 'fixture-token', async () => response({ published_deploy: null })), null);
  await assert.rejects(runtimeDeployment(target, 'fixture-token', async () => response({ published_deploy: { id: 'preview', context: 'deploy-preview' } })), /published deployment/);
});

test('Netlify preview selection paginates ready deploys and excludes production and unfinished previews', async () => {
  const pages: string[] = [];
  const selected = await runtimeDeployment({ ...target, environment: 'preview' }, 'fixture-token', async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('state'), 'ready');
    assert.equal(url.searchParams.get('per_page'), '100');
    pages.push(url.searchParams.get('page')!);
    return response(pages.length === 1
      ? Array.from({ length: 100 }, () => ({ id: 'prod', state: 'ready', context: 'production' }))
      : [
        { id: 'building', state: 'building', context: 'deploy-preview' },
        { id: 'branch-preview', state: 'ready', context: 'branch-deploy' },
      ]);
  });
  assert.equal(selected, 'branch-preview');
  assert.deepEqual(pages, ['1', '2']);
});

test('Netlify normalization preserves source, function, timestamp, severity and request metadata with stable cross-transport IDs', () => {
  const historical = netlifyRuntimeEvent(line, 'serverless', 'checkout')!;
  const live = netlifyRuntimeEvent({ ...line, type: undefined, request_id: undefined }, 'serverless', 'checkout', now)!;
  assert.equal(historical.id, live.id);
  assert.equal(historical.functionName, 'checkout');
  assert.equal(historical.requestId, 'request-one');
  assert.equal(historical.timestamp, line.ts);
  assert.equal(historical.level, 'error');
  assert.equal(historical.source, 'serverless');
  const edge = netlifyRuntimeEvent({
    ...line, function: 'middleware', request_path: '/checkout', netlify_request_id: 'netlify-id', request_id: undefined,
    level: 'WARN', message_truncated: true,
  }, 'edge')!;
  assert.equal(edge.functionName, 'middleware');
  assert.equal(edge.path, '/checkout');
  assert.equal(edge.requestId, 'netlify-id');
  assert.equal(edge.level, 'warn');
  assert.equal(edge.messageTruncated, true);
  assert.notEqual(edge.id, historical.id);
  for (const [level, expected] of [['INFO', 'info'], ['WARNING', 'warn'], ['FATAL', 'error'], ['DEBUG', 'debug'], ['TRACE', 'debug']]) {
    assert.equal(netlifyRuntimeEvent({ ...line, level }, 'serverless', 'checkout')!.level, expected);
  }
  assert.equal(netlifyRuntimeEvent({ message: 'No timestamp', level: 'INFO' }, 'serverless', 'checkout', now)!.timestamp, now);
  for (const value of [null, {}, { ...line, ts: NaN }, { ...line, message: '' }]) {
    assert.equal(netlifyRuntimeEvent(value, 'serverless', 'checkout'), null);
  }
  assert.throws(() => netlifyRuntimeEvent({ type: 'error', message: 'Permission denied' }, 'edge'), /Permission denied/);
});

test('Netlify history queries exactly one hour, follows cursors and scopes both sources to the selected deploy and branch', async () => {
  const urls: URL[] = [];
  const history = await runtimeHistory({ ...target, environment: 'preview' }, 'fixture-token', new AbortController().signal, api(url => {
    urls.push(url);
    assert.equal(url.searchParams.get('from'), String(now - 60 * 60 * 1000));
    assert.equal(url.searchParams.get('to'), String(now));
    assert.equal(url.searchParams.get('deploy_id'), deployId);
    if (url.pathname.endsWith('edge_function_logs')) return response({
      logs: [{ ...line, ts: now - 5000, message: 'Edge output', function: 'middleware', request_path: '/checkout' }],
    });
    assert.equal(url.pathname, '/v2/sites/site%2Fone/branch/feature%2Fcart/function_logs/checkout');
    return url.searchParams.has('cursor')
      ? response({ logs: [line], pagination: {} })
      : response({ logs: [line], pagination: { next: 'next/page' } });
  }, [{ ...fn, branch: 'feature/cart' }], 'deploy-preview'), now);
  assert.equal(urls.length, 3);
  assert.ok(urls.some(url => url.searchParams.get('cursor') === 'next/page'));
  assert.deepEqual(history.events.map(event => event.source), ['serverless', 'edge']);
  assert.ok(history.events.every(event => event.deploymentId === deployId));
  assert.equal(history.events[0].logs[0].message, line.message);
  assert.equal(history.truncated, false);
  assert.deepEqual(history.warnings, []);
  assert.equal(history.retry, false);
});

test('Netlify history excludes wrong deploys and times outside the requested hour', async () => {
  const history = await runtimeHistory(target, 'fixture-token', new AbortController().signal, api(url => response({
    logs: url.pathname.includes('edge_function_logs') ? [] : [
      { ...line, ts: now - 60 * 60 * 1000, message: 'Start boundary' },
      { ...line, ts: now, message: 'End boundary' },
      { ...line, ts: now - 60 * 60 * 1000 - 1, message: 'Too old' },
      { ...line, ts: now + 1, message: 'Future' },
      { ...line, deploy_id: 'other-deploy', message: 'Other deployment' },
    ],
  })), now);
  assert.deepEqual(history.events.map(event => event.message), ['Start boundary', 'End boundary']);
});

test('partial Netlify permission failures retain other Functions and Edge Function logs and remain retryable', async () => {
  const history = await runtimeHistory(target, 'fixture-token', new AbortController().signal, api(url =>
    url.pathname.includes('/function_logs/checkout') ? { status: 403, headers: {}, body: '{}' }
      : response({ logs: [{ ...line, message: url.pathname.includes('edge_function_logs') ? 'Edge survives' : 'Other Function survives' }] }),
  [fn, { ...fn, n: 'other', oid: 'function-two' }]), now);
  assert.equal(history.events.length, 2);
  assert.match(history.warnings!.join(' '), /checkout.*403/);
  assert.equal(history.retry, true);
});

test('Netlify history keeps only the newest 1,000 lines across sources and warns about the 10-Function monitoring cap', async () => {
  let functionQueries = 0;
  const functions = Array.from({ length: 11 }, (_, index) => ({ ...fn, n: `function-${index}`, oid: `id-${index}` }));
  const history = await runtimeHistory(target, 'fixture-token', new AbortController().signal, api(url => {
    if (url.pathname.includes('edge_function_logs')) return response({ logs: [] });
    functionQueries++;
    return response({ logs: Array.from({ length: 120 }, (_, index) => ({ ...line, ts: now - index, message: `${url.pathname}:${index}` })) });
  }, functions), now);
  assert.equal(functionQueries, 10);
  assert.equal(history.events.length, 1000);
  assert.equal(history.events[0].timestamp, now - 99);
  assert.equal(history.events.at(-1)!.timestamp, now);
  assert.equal(history.truncated, true);
  assert.match(history.warnings!.join(' '), /10 Functions.*1 additional/);
  assert.equal(history.retry, false, 'a permanent Function cap must not cause endless history requests');
});

test('Netlify history rejects malformed pages, repeated cursors and environment mismatches explicitly', async () => {
  for (const value of [null, {}, { logs: {} }, { logs: [], pagination: { next: 123 } }]) {
    const result = await runtimeHistory(target, 'fixture-token', new AbortController().signal, api(() => response(value)), now);
    assert.match(result.warnings!.join(' '), /unexpected runtime history/);
    assert.equal(result.retry, true);
  }
  const repeated = await runtimeHistory(target, 'fixture-token', new AbortController().signal, api(() => response({
    logs: [line], pagination: { next: 'same-cursor' },
  })), now);
  assert.equal(repeated.truncated, true);
  assert.match(repeated.warnings!.join(' '), /repeated.*cursor/);
  await assert.rejects(runtimeHistory(target, 'fixture-token', new AbortController().signal, api(undefined, [fn], 'deploy-preview'), now), /selected environment/);
});

test('Netlify authentication, cancellation and unsupported local development fail without creating live connections', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runtimeHistory(target, 'fixture-token', controller.signal, async () => {
    assert.fail('cancelled history must not access the network');
  }), /abort/i);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(runtimeDeployment(target, 'fixture-token', async () => ({ status, headers: {}, body: '{}' })), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(runtimeHistory(target, '', new AbortController().signal), /token is required/);
  await assert.rejects(runtimeHistory({ ...target, environment: 'development' }, 'fixture-token', new AbortController().signal), /local development/);
  await assert.rejects(streamRuntimeLogs(
    { ...target, deploymentId: deployId }, 'fixture-token', () => {}, new AbortController().signal,
    api(undefined, [fn], 'deploy-preview'), async () => { assert.fail('mismatched deploys must not create sockets'); },
  ), /selected environment/);
});

test('Netlify live sockets authenticate per Function/deploy, preserve metadata and all close on cancellation', async () => {
  const controller = new AbortController();
  const sockets: { url: string; authentication: Record<string, unknown>; onValue: (value: unknown) => void; signal: AbortSignal }[] = [];
  const events: RuntimeEvent[] = [];
  const openSocket: typeof publicWebSocket = async (url, authentication, onValue, signal) => {
    sockets.push({ url, authentication, onValue, signal });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const pending = streamRuntimeLogs({ ...target, deploymentId: deployId }, 'fixture-token', event => events.push(event), controller.signal, api(), openSocket);
  const rejected = assert.rejects(pending, /abort/i);
  await tick();
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].url, 'wss://socketeer.services.netlify.com/function/logs');
  assert.deepEqual(sockets[0].authentication, {
    function_id: fn.oid, site_id: target.targetId, access_token: 'fixture-token', account_id: fn.a,
  });
  assert.equal(sockets[1].url, 'wss://socketeer.services.netlify.com/edge-function/logs');
  assert.equal(sockets[1].authentication.deploy_id, deployId);
  sockets[0].onValue(line);
  sockets[1].onValue({ ...line, function: 'middleware', request_path: '/checkout' });
  sockets[1].onValue({ ...line, deploy_id: 'other-deploy', message: 'Do not leak other environments' });
  assert.deepEqual(events.map(event => event.source), ['serverless', 'edge']);
  assert.equal(events[0].id, netlifyRuntimeEvent(line, 'serverless', 'checkout')!.id);
  assert.equal(events[1].functionName, 'middleware');
  controller.abort();
  await rejected;
  assert.ok(sockets.every(socket => socket.signal.aborted));
});

test('one failed Netlify socket retries without interrupting another Function or Edge stream', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const counts = { functions: 0, edge: 0 };
  let edgeLog!: (value: unknown) => void;
  const events: RuntimeEvent[] = [];
  const openSocket: typeof publicWebSocket = async (url, _authentication, onValue, signal) => {
    if (url.endsWith('/function/logs')) {
      if (++counts.functions === 1) throw new Error('Unexpected server response: 403');
    } else { counts.edge++; edgeLog = onValue; }
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const pending = streamRuntimeLogs({ ...target, deploymentId: deployId }, 'fixture-token', event => events.push(event), controller.signal, api(), openSocket);
  const rejected = assert.rejects(pending, /abort/i);
  context.after(async () => { controller.abort(); await rejected; });
  await tick();
  assert.match(events[0].message, /403.*Retrying/);
  edgeLog({ ...line, function: 'middleware', message: 'Still receiving Edge output' });
  assert.equal(events.at(-1)!.source, 'edge');
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(counts.functions, 2);
  assert.equal(counts.edge, 1);
  controller.abort();
  await rejected;
});

test('Netlify adapters merge history/live output, retain function metadata and cancel late callbacks across environment edits', async () => {
  const histories: { input: ProviderTarget; receive: (history: RuntimeHistory) => void; stopped: boolean }[] = [];
  const streams: { receive: (event: RuntimeEvent) => void; stopped: boolean }[] = [];
  const adapter = new ProviderAdapter('netlify', () => desktop({
    runtimeDeployment: async () => deployId,
    loadRuntimeHistory: (input, receive) => {
      const request = { input, receive, stopped: false }; histories.push(request);
      return () => { request.stopped = true; };
    },
    subscribeRuntimeLogs: (_input, receive) => {
      const stream = { receive, stopped: false }; streams.push(stream);
      return () => { stream.stopped = true; };
    },
  }));
  const service = new LogStreamService({ getAdapter: () => adapter });
  const app = application({
    providerType: 'netlify', deploymentUrl: undefined,
    config: { connectionMode: 'account', credentialId: 'credential', netlifySiteId: target.targetId },
  });
  service.syncApplications([app]);
  await tick();
  assert.equal(histories[0].input.provider, 'netlify');
  const event = netlifyRuntimeEvent({ ...line, request_path: '/checkout' }, 'serverless', 'checkout')!;
  histories[0].receive({ events: [
    { ...event, deploymentId: deployId, logs: [] },
    { ...event, id: 'without-request', source: 'edge', requestId: undefined, deploymentId: deployId, logs: [] },
  ], truncated: false });
  streams[0].receive(event);
  const logs = service.getLogs().filter(log => log.source === 'serverless');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].providerType, 'netlify');
  assert.equal(logs[0].requestId, 'request-one');
  assert.equal(logs[0].payload!.functionName, 'checkout');
  assert.equal(logs[0].payload!.requestId, 'request-one');
  assert.equal(logs[0].payload!.requestPath, '/checkout');
  assert.equal(service.getLogs().find(log => log.source === 'edge')!.requestId, undefined);
  assert.equal(logs[0].observation, undefined);
  service.syncApplications([{ ...app, environment: 'preview' }]);
  await tick();
  assert.equal(histories[0].stopped, true);
  assert.equal(streams[0].stopped, true);
  const count = service.getLogs().length;
  histories[0].receive({ events: [{ ...event, id: 'late-history', deploymentId: deployId, logs: [] }], truncated: false });
  streams[0].receive({ ...event, id: 'late-live' });
  assert.equal(service.getLogs().length, count);
  assert.equal(histories[1].input.environment, 'preview');
  service.dispose();
  assert.equal(histories[1].stopped, true);
  assert.equal(streams[1].stopped, true);
});

test('partial Netlify history retries, but permanent monitoring-limit warnings do not keep refetching', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const adapter = new ProviderAdapter('netlify', () => desktop({
    runtimeDeployment: async () => deployId,
    loadRuntimeHistory: (_input, receive) => {
      const attempt = ++requests;
      queueMicrotask(() => receive({
        events: [], truncated: false, retry: attempt === 1,
        warnings: [attempt === 1 ? 'Function history unavailable: HTTP 403' : 'Only 10 Functions can be monitored'],
      }));
      return () => {};
    },
  }));
  const stop = adapter.subscribeLogs(application({
    providerType: 'netlify', deploymentUrl: undefined,
    config: { connectionMode: 'account', credentialId: 'credential', netlifySiteId: target.targetId },
  }), () => {});
  await tick();
  assert.equal(requests, 1);
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(requests, 2);
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(requests, 2);
  stop();
});
