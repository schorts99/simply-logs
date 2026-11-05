import test from 'node:test';
import assert from 'node:assert/strict';
import { deployments, discover, events, runtimeDeployment, runtimeHistory, streamRuntimeLogs } from '../electron/monitoring';
import { renderRuntimeEvent } from '../electron/render-runtime';
import { ProviderAdapter } from '../modules/monitoring/infrastructure/ProviderAdapter';
import { application, desktop } from './fixtures';
import type { ProviderTarget, RuntimeEvent, RuntimeHistory } from '../shared/desktop';
import type { Request } from '../electron/provider-request';

const target: ProviderTarget = {
  provider: 'render', targetId: 'srv-one', ownerId: 'owner-one', credentialId: 'credential-one',
  environment: 'production',
};
const now = Date.parse('2026-11-05T12:00:00Z');
const response = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const runtimeLog = {
  id: 'log-one', timestamp: '2026-11-05T11:59:00Z', message: 'GET /checkout',
  labels: [
    { name: 'type', value: 'request' }, { name: 'level', value: 'warning' },
    { name: 'method', value: 'GET' }, { name: 'path', value: '/checkout' },
    { name: 'host', value: 'shop.onrender.com' }, { name: 'statusCode', value: '503' },
  ],
};

test('Render discovery follows cursor pagination and preserves service/workspace IDs and URLs', async () => {
  const urls: URL[] = [];
  const result = await discover('render', 'placeholder', undefined, async input => {
    const url = new URL(input);
    urls.push(url);
    const services = url.searchParams.has('cursor')
      ? [{ cursor: 'last', service: { id: 'srv-last', ownerId: 'owner-two', name: 'Last service', type: 'web_service', serviceDetails: { url: 'last.onrender.com' } } }]
      : Array.from({ length: 100 }, (_, index) => ({
        cursor: index === 99 ? 'next-page' : `cursor-${index}`,
        service: {
          id: `srv-${index}`, ownerId: 'owner-one', name: `Service ${index}`, type: 'web_service',
          serviceDetails: { url: 'app.onrender.com' },
        },
      }));
    return response(services);
  });
  assert.equal(result.length, 101);
  assert.equal(result[0].renderServiceId, 'srv-0');
  assert.equal(result[0].renderOwnerId, 'owner-one');
  assert.equal(result[0].deploymentUrl, 'https://app.onrender.com');
  assert.equal(result.at(-1)?.renderServiceId, 'srv-last');
  assert.equal(urls[0].origin, 'https://api.render.com');
  assert.equal(urls[0].pathname, '/v1/services');
  assert.equal(urls[0].searchParams.get('includePreviews'), 'true');
  assert.equal(urls[1].searchParams.get('cursor'), 'next-page');
});

test('Render deploy status uses live deployments for runtime selection', async () => {
  const send: Request = async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/v1/services/srv-one/deploys');
    assert.equal(url.searchParams.get('limit'), '10');
    return response([
      { cursor: 'one', deploy: { id: 'deploy-live', status: 'live', createdAt: '2026-11-05T11:00:00Z', commit: { id: 'abc1234' } } },
      { cursor: 'two', deploy: { id: 'deploy-failed', status: 'build_failed', createdAt: '2026-11-05T10:00:00Z' } },
    ]);
  };
  const result = await deployments(target, 'placeholder', send);
  assert.equal(result[0].id, 'deploy-live');
  assert.equal(result[0].state, 'live');
  assert.equal(result[0].commit, 'abc1234');
  assert.equal(await runtimeDeployment(target, 'placeholder', async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('status'), 'live');
    assert.equal(url.searchParams.get('limit'), '1');
    return response([{ deploy: { id: 'deploy-live', status: 'live' } }]);
  }), 'deploy-live');
  await assert.rejects(runtimeDeployment(target, 'placeholder', async () => response([
    { deploy: { id: 'failed', status: 'update_failed' } },
  ])), /invalid live deployment/);
});

test('Render log normalization keeps request metadata and maps severity', () => {
  assert.deepEqual(renderRuntimeEvent(runtimeLog), {
    id: 'log-one', timestamp: Date.parse(runtimeLog.timestamp), message: 'GET /checkout',
    level: 'warn', source: 'runtime', method: 'GET', path: '/checkout',
    host: 'shop.onrender.com', statusCode: 503, messageTruncated: false,
  });
  assert.equal(renderRuntimeEvent({ ...runtimeLog, labels: [{ name: 'level', value: 'critical' }] })?.level, 'error');
  for (const invalid of [null, {}, { ...runtimeLog, id: '' }, { ...runtimeLog, timestamp: 'invalid' }, { ...runtimeLog, message: '' }]) {
    assert.equal(renderRuntimeEvent(invalid), null);
  }
});

test('Render history loads one hour of app/request logs, follows time cursors and caps results', async () => {
  const urls: URL[] = [];
  const history = await runtimeHistory(target, 'placeholder', new AbortController().signal, async input => {
    const url = new URL(input);
    urls.push(url);
    if (url.pathname.endsWith('/deploys')) {
      return response([{ deploy: { id: 'deploy-live', status: 'live' } }]);
    }
    assert.equal(url.searchParams.get('ownerId'), 'owner-one');
    assert.equal(url.searchParams.get('resource'), 'srv-one');
    assert.deepEqual(url.searchParams.getAll('type'), ['app', 'request']);
    if (url.searchParams.has('startTime') && urls.filter(item => item.pathname.endsWith('/logs')).length === 1) {
      return response({
        logs: [runtimeLog], hasMore: true,
        nextStartTime: '2026-11-05T11:59:00Z', nextEndTime: '2026-11-05T12:00:00Z',
      });
    }
    return response({
      logs: [{ ...runtimeLog, id: 'log-two', timestamp: '2026-11-05T11:59:30Z' }],
      hasMore: false, nextStartTime: '2026-11-05T11:59:30Z', nextEndTime: '2026-11-05T12:00:00Z',
    });
  }, now);
  assert.equal(history.events.length, 2);
  assert.deepEqual(history.events.map(event => event.id), ['log-one', 'log-two']);
  assert.ok(history.events.every(event => event.deploymentId === 'deploy-live'));
  assert.equal(history.events[0].logs[0].message, runtimeLog.message);
  assert.equal(history.truncated, false);
  const logUrl = urls.find(url => url.pathname.endsWith('/logs'))!;
  assert.equal(logUrl.searchParams.get('startTime'), new Date(now - 60 * 60 * 1000).toISOString());
});

test('Render build logs use the public logs API and surface build entries', async () => {
  const result = await events({
    ...target, deploymentId: 'deploy-live', createdAt: Date.parse('2026-11-05T11:00:00Z'),
  }, 'placeholder', async input => {
    const url = new URL(input);
    assert.equal(url.pathname, '/v1/logs');
    assert.equal(url.searchParams.get('ownerId'), 'owner-one');
    assert.equal(url.searchParams.get('resource'), 'srv-one');
    assert.deepEqual(url.searchParams.getAll('type'), ['build']);
    return response({
      logs: [{ ...runtimeLog, id: 'build-one', labels: [{ name: 'level', value: 'error' }, { name: 'type', value: 'build' }] }],
      hasMore: false, nextStartTime: '2026-11-05T11:59:00Z', nextEndTime: '2026-11-05T12:00:00Z',
    });
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].message, runtimeLog.message);
  assert.equal(result[0].level, 'error');
});

test('Render live subscription uses bearer auth on the secure WebSocket and emits normalized logs', async () => {
  let url = '';
  let headers: Record<string, string> | undefined;
  let receive!: (value: unknown) => void;
  const received: RuntimeEvent[] = [];
  const controller = new AbortController();
  await streamRuntimeLogs(
    { ...target, deploymentId: 'deploy-live' }, 'render-secret', event => received.push(event), controller.signal,
    undefined,
    async (input, _authentication, onValue, signal, _connect, socketHeaders) => {
      url = input;
      headers = socketHeaders;
      receive = onValue;
      assert.equal(signal, controller.signal);
    },
  );
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'wss:');
  assert.equal(parsed.pathname, '/v1/logs/subscribe');
  assert.equal(parsed.searchParams.get('ownerId'), 'owner-one');
  assert.equal(parsed.searchParams.get('resource'), 'srv-one');
  assert.deepEqual(parsed.searchParams.getAll('type'), ['app', 'request']);
  assert.deepEqual(headers, { Authorization: 'Bearer render-secret' });
  receive(runtimeLog);
  assert.equal(received[0].statusCode, 503);
});

test('Render adapter passes the saved workspace ID to history and live subscriptions', async () => {
  const targets: ProviderTarget[] = [];
  let historyCallback!: (history: RuntimeHistory) => void;
  const streams: { target: ProviderTarget; callback: (event: RuntimeEvent) => void }[] = [];
  const bridge = desktop({
    runtimeDeployment: async input => { targets.push(input); return 'deploy-live'; },
    loadRuntimeHistory: (input, callback) => {
      targets.push(input);
      historyCallback = callback;
      return () => {};
    },
    subscribeRuntimeLogs: (input, callback) => {
      targets.push(input);
      streams.push({ target: input, callback });
      return () => {};
    },
  });
  const adapter = new ProviderAdapter('render', () => bridge);
  const logs: import('../modules/monitoring/domain/LogEntry').LogEntry[] = [];
  const stop = adapter.subscribeLogs(application({
    providerType: 'render', deploymentUrl: undefined, environment: 'development',
    config: {
      connectionMode: 'account', credentialId: 'credential-one',
      renderServiceId: 'srv-one', renderOwnerId: 'owner-one',
    },
  }), log => logs.push(log));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(targets.length >= 3);
  assert.ok(targets.every(input => input.provider === 'render' && input.ownerId === 'owner-one'));
  historyCallback({
    events: [{
      ...renderRuntimeEvent(runtimeLog)!, deploymentId: 'deploy-live',
      logs: [{ level: 'warn', message: runtimeLog.message, messageTruncated: false }],
    }],
    truncated: false,
  });
  streams[0].callback(renderRuntimeEvent(runtimeLog)!);
  assert.equal(logs.filter(log => log.requestId === 'log-one').length, 2);
  stop();
});
