import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { publicRequest, readJsonLines } from '../electron/network';
import { deployments, runtimeDeployment, runtimeEvent, streamRuntimeLogs } from '../electron/monitoring';
import { ProviderAdapter } from '../modules/monitoring/infrastructure/ProviderAdapter';
import type { LogEntry } from '../modules/monitoring/domain/LogEntry';
import type { DesktopBridge, RuntimeEvent } from '../shared/desktop';
import { application, desktop } from './fixtures';

const target = {
  provider: 'vercel' as const, targetId: 'project/one', credentialId: 'app-one',
  teamId: 'team-one', environment: 'production' as const,
};
const wireEvent = {
  rowId: 'row-one', timestampInMs: 1792870000123, level: 'warning', source: 'serverless',
  message: 'Function output', domain: 'app.example.com', requestMethod: 'POST',
  requestPath: '/api/test', responseStatusCode: 503, messageTruncated: true,
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const accountApp = () => application({
  deploymentUrl: undefined,
  config: { connectionMode: 'account', credentialId: 'app-one', vercelProjectId: target.targetId },
});

async function* chunks(...values: (string | Uint8Array)[]) {
  for (const value of values) yield typeof value === 'string' ? Buffer.from(value) : value;
}

test('runtime JSON lines survive split UTF-8, CRLF, blank lines, multiple records and an unterminated final line', async () => {
  const encoded = Buffer.from(JSON.stringify({ message: '\u{1f63a}' }));
  const split = encoded.indexOf(Buffer.from('\u{1f63a}')) + 1;
  const values: unknown[] = [];
  await readJsonLines(chunks(encoded.subarray(0, split), encoded.subarray(split), '\r\n\n{"id":2}\n{"id":3}'), value => values.push(value));
  assert.deepEqual(values, [{ message: '\u{1f63a}' }, { id: 2 }, { id: 3 }]);
});

test('runtime streams tolerate over eight seconds of inactivity before headers and between logs, and remain cancellable', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  const timeouts: number[] = [];
  const controller = new AbortController();
  const values: unknown[] = [];
  let requested!: () => void;
  let deliverHeaders!: () => void;
  let destroyed = false;
  const requestReady = new Promise<void>(resolve => { requested = resolve; });
  const fakeRequest = (_url: URL, options: https.RequestOptions, onResponse: (response: unknown) => void) => {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.agent, false);
    const req = Object.assign(new EventEmitter(), {
      setTimeout: (milliseconds: number) => { timeouts.push(milliseconds); },
      destroy: (error: Error) => {
        destroyed = true;
        response.destroy(error);
        req.emit('error', error);
        req.emit('close');
      },
      end: () => {
        const socket = new EventEmitter();
        req.emit('socket', socket);
        socket.emit('secureConnect');
        deliverHeaders = () => onResponse(response);
        requested();
      },
    });
    controller.signal.addEventListener('abort', () => {
      response.destroy(controller.signal.reason);
      req.emit('error', controller.signal.reason);
    }, { once: true });
    return req;
  };
  context.mock.method(https, 'request', fakeRequest as unknown as typeof https.request);
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  const pending = publicRequest('https://1.1.1.1', {
    signal: controller.signal, onJsonLine: value => values.push(value),
  });
  const rejected = assert.rejects(pending, /abort/i);
  await requestReady;
  context.mock.timers.tick(9000);
  assert.equal(destroyed, false, 'a connected stream must not time out before its first headers');
  assert.deepEqual(timeouts, [], 'no idle timeout is installed while waiting for streaming headers');
  deliverHeaders();
  response.write('{"message":"live output"}\n');
  await tick();
  assert.deepEqual(values, [{ message: 'live output' }]);
  assert.deepEqual(timeouts, [0], 'successful runtime streams have no socket idle timeout');
  context.mock.timers.tick(60000);
  assert.equal(destroyed, false, 'a quiet stream must stay open between logs');
  response.write('{"message":"later output"}\n');
  await tick();
  assert.equal(values.length, 2);
  assert.equal(response.readableEnded, false);
  controller.abort();
  await rejected;
  assert.equal(response.destroyed, true);
});

test('runtime TLS connections time out at eight seconds while ordinary requests retain their idle timeout', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: { req: EventEmitter; timeouts: number[]; getError: () => Error | undefined }[] = [];
  let requested!: () => void;
  let requestReady = new Promise<void>(resolve => { requested = resolve; });
  const fakeRequest = () => {
    let error: Error | undefined;
    const timeouts: number[] = [];
    const req = Object.assign(new EventEmitter(), {
      setTimeout: (milliseconds: number, onTimeout: () => void) => {
        timeouts.push(milliseconds);
        req.once('timeout', onTimeout);
      },
      end: () => { req.emit('socket', new EventEmitter()); requested(); },
      destroy: (cause: Error) => {
        error = cause;
        req.emit('error', cause);
        req.emit('close');
      },
    });
    requests.push({ req, timeouts, getError: () => error });
    return req;
  };
  context.mock.method(https, 'request', fakeRequest as unknown as typeof https.request);
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  const signal = new AbortController().signal;
  const connecting = publicRequest('https://1.1.1.1', { signal, onJsonLine: () => {} });
  const rejected = assert.rejects(connecting, /Connection timed out after 8 seconds/);
  await requestReady;
  context.mock.timers.tick(7999);
  assert.equal(requests[0].getError(), undefined);
  context.mock.timers.tick(1);
  await rejected;
  assert.deepEqual(requests[0].timeouts, []);
  requestReady = new Promise<void>(resolve => { requested = resolve; });
  const ordinary = publicRequest('https://1.1.1.1', { signal });
  const ordinaryRejected = assert.rejects(ordinary, /Request timed out after 8 seconds/);
  await requestReady;
  assert.deepEqual(requests[1].timeouts, [8000]);
  requests[1].req.emit('timeout');
  await ordinaryRejected;
});

test('runtime streaming bounds each line, not total stream size, and rejects corrupt JSON', async () => {
  let count = 0;
  const line = `${JSON.stringify({ message: 'x'.repeat(1024 * 1024) })}\n`;
  await readJsonLines(chunks(line, line, line), () => count++);
  assert.equal(count, 3);
  const exact = JSON.stringify('x'.repeat(2 * 1024 * 1024 - 2));
  await readJsonLines(chunks(`${exact}\n`), () => {});
  await assert.rejects(readJsonLines(chunks(`${exact} \n`), () => {}), /2 MB/);
  await assert.rejects(readJsonLines(chunks('x'.repeat(2 * 1024 * 1024 + 1)), () => {}), /2 MB/);
  await assert.rejects(readJsonLines(chunks('not JSON\n'), () => {}), SyntaxError);
});

test('runtime normalization preserves provider data, severity and source without inventing observations', () => {
  const event = runtimeEvent(wireEvent)!;
  assert.deepEqual(event, {
    id: 'row-one', timestamp: wireEvent.timestampInMs, level: 'warn', source: 'serverless',
    message: 'Function output', host: 'app.example.com', method: 'POST',
    path: '/api/test', statusCode: 503, messageTruncated: true,
  });
  for (const [level, expected] of [['fatal', 'error'], ['error', 'error'], ['trace', 'debug'], ['debug', 'debug'], ['info', 'info']]) {
    assert.equal(runtimeEvent({ ...wireEvent, level })!.level, expected);
  }
  for (const source of ['edge-function', 'edge-middleware']) {
    assert.equal(runtimeEvent({ ...wireEvent, source })!.source, 'edge');
  }
  assert.equal(runtimeEvent({ ...wireEvent, source: 'request', message: '' })!.message, 'POST /api/test');
  assert.equal(runtimeEvent({ ...wireEvent, source: 'request' })!.source, 'runtime');
  for (const value of [null, {}, { ...wireEvent, rowId: '' }, { ...wireEvent, timestampInMs: 'bad' }, { ...wireEvent, message: '' }]) {
    assert.equal(runtimeEvent(value), null);
  }
  assert.equal(runtimeEvent({ source: 'delimiter', level: 'info' }), null);
  assert.throws(() => runtimeEvent({ source: 'delimiter', level: 'error', message: 'Log limit reached' }), /Log limit reached/);
});

test('runtime streaming uses the documented endpoint, team scope, stored token and caller cancellation', async () => {
  const controller = new AbortController();
  const values: RuntimeEvent[] = [];
  await streamRuntimeLogs({ ...target, deploymentId: 'deploy/one' }, 'placeholder', value => values.push(value), controller.signal, async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.vercel.com');
    assert.equal(url.pathname, '/v1/projects/project%2Fone/deployments/deploy%2Fone/runtime-logs');
    assert.equal(url.searchParams.get('teamId'), 'team-one');
    assert.equal(url.searchParams.get('format'), 'lines');
    assert.equal(options?.headers?.Authorization, 'Bearer placeholder');
    assert.equal(options?.signal, controller.signal);
    options!.onJsonLine!(wireEvent);
    controller.abort();
    assert.throws(() => options!.onJsonLine!(wireEvent), /abort/i);
    return { status: 200, headers: {}, body: '' };
  });
  assert.equal(values.length, 1);
  await assert.rejects(streamRuntimeLogs({ ...target, deploymentId: 'deploy' }, 'placeholder', () => {}, controller.signal), /abort/i);
});

test('runtime provider errors, missing tokens and unsupported providers are explicit', async () => {
  for (const status of [401, 403, 404, 410, 429, 500]) {
    await assert.rejects(streamRuntimeLogs(
      { ...target, deploymentId: 'deploy' }, 'placeholder', () => {}, new AbortController().signal,
      async () => ({ status, headers: {}, body: '{}' }),
    ), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(streamRuntimeLogs({ ...target, deploymentId: 'deploy' }, '', () => {}, new AbortController().signal), /token is required/);
  await assert.rejects(streamRuntimeLogs({ ...target, provider: 'netlify', deploymentId: 'deploy' }, 'placeholder', () => {}, new AbortController().signal), /only for Vercel/);
});

test('production runtime selection follows the active deployment rather than the newest build', async () => {
  let activeId: string | undefined = 'promoted-older-deployment';
  const send = async (input: string) => {
    const url = new URL(input);
    assert.equal(url.pathname, '/v9/projects/project%2Fone');
    assert.equal(url.searchParams.get('teamId'), 'team-one');
    return { status: 200, headers: {}, body: JSON.stringify({
      latestDeployments: [{ id: 'newer-build' }], targets: { production: activeId ? { id: activeId } : undefined },
    }) };
  };
  assert.equal(await runtimeDeployment(target, 'placeholder', send), activeId);
  activeId = 'rollback-deployment';
  assert.equal(await runtimeDeployment(target, 'placeholder', send), activeId);
  activeId = undefined;
  assert.equal(await runtimeDeployment(target, 'placeholder', send), null);
});

test('preview runtime selection filters ready preview deployments and build sync respects environment', async () => {
  const preview = { ...target, environment: 'preview' as const };
  assert.equal(await runtimeDeployment(preview, 'placeholder', async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('projectId'), target.targetId);
    assert.equal(url.searchParams.get('teamId'), target.teamId);
    assert.equal(url.searchParams.get('target'), 'preview');
    assert.equal(url.searchParams.get('state'), 'READY');
    assert.equal(url.searchParams.get('limit'), '1');
    return { status: 200, headers: {}, body: '{"deployments":[{"uid":"preview-ready"}]}' };
  }), 'preview-ready');
  await deployments(preview, 'placeholder', async input => {
    assert.equal(new URL(input).searchParams.get('target'), 'preview');
    return { status: 200, headers: {}, body: '{"deployments":[]}' };
  });
  await assert.rejects(runtimeDeployment({ ...target, environment: 'development' }, 'placeholder'), /local development/);
});

test('runtime subscriptions reconnect, switch deployments and discard stale callbacks on pause', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let selected: string | null = 'deployment-one';
  const streams: { input: Parameters<DesktopBridge['subscribeRuntimeLogs']>[0]; log: (event: RuntimeEvent) => void; error: (message: string) => void; stopped: boolean }[] = [];
  const bridge = desktop({
    runtimeDeployment: async input => {
      assert.equal(input.environment, 'production');
      return selected;
    },
    subscribeRuntimeLogs: (input, log, error) => {
      const stream = { input, log, error, stopped: false };
      streams.push(stream);
      return () => { stream.stopped = true; };
    },
  });
  const adapter = new ProviderAdapter('vercel', () => bridge);
  const logs: LogEntry[] = [];
  const stop = adapter.subscribeLogs(accountApp(), log => logs.push(log));
  await tick();
  assert.equal(streams.length, 1);
  streams[0].log(runtimeEvent(wireEvent)!);
  const event = logs.find(log => log.source === 'serverless')!;
  assert.equal(event.id, 'app-one:runtime:deployment-one:row-one');
  assert.equal(event.environment, 'production');
  assert.equal(event.observation, undefined);
  assert.deepEqual(event.payload, { deploymentId: 'deployment-one', messageTruncated: true });
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(streams.length, 1, 'unchanged selection keeps the existing stream');
  streams[0].error('Provider returned HTTP 403');
  assert.equal(streams[0].stopped, true);
  assert.match(logs.at(-1)!.message, /403.*Retrying/);
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(streams.length, 2);
  selected = 'deployment-two';
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(streams[1].stopped, true);
  assert.equal(streams[2].input.deploymentId, selected);
  let count = logs.length;
  streams[1].log(runtimeEvent(wireEvent)!);
  streams[1].error('late error');
  assert.equal(logs.length, count);
  selected = null;
  context.mock.timers.tick(30000);
  await tick();
  assert.equal(streams[2].stopped, true);
  assert.match(logs.at(-1)!.message, /No production deployment/);
  selected = 'deployment-three';
  context.mock.timers.tick(30000);
  await tick();
  stop();
  assert.equal(streams[3].stopped, true);
  count = logs.length;
  streams[3].log(runtimeEvent(wireEvent)!);
  streams[3].error('late error');
  context.mock.timers.tick(60000);
  await tick();
  assert.equal(logs.length, count);
  assert.equal(streams.length, 4);
});

test('a pending runtime selection cannot create a stream after unsubscribe', async () => {
  let resolve!: (value: string) => void;
  let started = 0;
  const adapter = new ProviderAdapter('vercel', () => desktop({
    runtimeDeployment: () => new Promise(done => { resolve = done; }),
    subscribeRuntimeLogs: () => { started++; return () => {}; },
  }));
  const logs: LogEntry[] = [];
  const stop = adapter.subscribeLogs(accountApp(), log => logs.push(log));
  stop();
  const count = logs.length;
  resolve('deployment');
  await tick();
  assert.equal(started, 0);
  assert.equal(logs.length, count);
});

test('URL-only, Netlify and local development never open runtime streams', async () => {
  for (const app of [
    application(),
    { ...accountApp(), providerType: 'netlify' as const },
    { ...accountApp(), environment: 'development' as const },
  ]) {
    let requests = 0;
    const adapter = new ProviderAdapter(app.providerType, () => desktop({
      runtimeDeployment: async () => { requests++; return 'deployment'; },
      loadRuntimeHistory: () => { requests++; return () => {}; },
    }));
    const logs: LogEntry[] = [];
    const stop = adapter.subscribeLogs(app, log => logs.push(log));
    await tick();
    stop();
    assert.equal(requests, 0);
    if (app.environment === 'development') {
      assert.match(logs.find(log => log.source === 'runtime')!.message, /local development/);
    }
  }
});
