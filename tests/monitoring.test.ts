import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderAdapter } from '../modules/monitoring/infrastructure/ProviderAdapter';
import { LogStreamService } from '../modules/monitoring/application/LogStreamService';
import { percentile95, scopeLogs } from '../modules/monitoring/application/metrics';
import type { LogEntry } from '../modules/monitoring/domain/LogEntry';
import { application, desktop, entry } from './fixtures';

test('no synthetic logs are emitted and pending callbacks stop on unsubscribe', async () => {
  let resolve!: (value: Awaited<ReturnType<ReturnType<typeof desktop>['probe']>>) => void;
  const adapter = new ProviderAdapter('vercel', () => desktop({ probe: () => new Promise(done => { resolve = done; }) }));
  const logs: LogEntry[] = [];
  const unsubscribe = adapter.subscribeLogs(application(), log => logs.push(log));
  assert.equal(logs.length, 0);
  unsubscribe();
  resolve(await desktop().probe('https://example.com'));
  await new Promise(done => setImmediate(done));
  assert.equal(logs.length, 0);
});

test('failed provider requests produce unknown state, never a healthy deployment', async () => {
  for (const provider of ['vercel', 'netlify'] as const) {
    const adapter = new ProviderAdapter(provider, () => desktop({ deployments: async () => { throw new Error('Provider returned HTTP 401'); } }));
    const logs: LogEntry[] = [];
    await adapter.checkDeploymentStatus(application({
      providerType: provider, config: { connectionMode: 'account', credentialId: 'app-one', vercelProjectId: 'one', netlifySiteId: 'one' },
    }), log => logs.push(log));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].observation, 'unknown');
    assert.equal(logs[0].statusCode, undefined);
    assert.match(logs[0].message, /401/);
    assert.equal((await adapter.validateCredentials({})).valid, false);
  }
});

test('stream scope switches discard old logs and late asynchronous observations', () => {
  const callbacks = new Map<string, (log: LogEntry) => void>();
  const adapter = new ProviderAdapter('vercel');
  adapter.subscribeLogs = (app, callback) => { callbacks.set(app.id, callback); return () => {}; };
  const service = new LogStreamService({ getAdapter: () => adapter });
  const a = application();
  const b = application({ id: 'app-two', projectId: 'project-two' });
  service.syncApplications([a]);
  const old = callbacks.get(a.id)!;
  old(entry());
  service.syncApplications([b]);
  old(entry({ message: 'late old-project result' }));
  callbacks.get(b.id)!(entry({ applicationId: b.id }));
  assert.deepEqual(service.getLogs().map(log => log.applicationId), [b.id]);
  service.syncApplications([]);
  assert.deepEqual(service.getLogs(), []);
  service.dispose();
});

test('pause stops monitoring and manual actions; resuming resubscribes', async () => {
  let subscribed = 0;
  let stopped = 0;
  const adapter = new ProviderAdapter('vercel');
  adapter.subscribeLogs = () => { subscribed++; return () => { stopped++; }; };
  const service = new LogStreamService({ getAdapter: () => adapter });
  service.syncApplications([application()]);
  service.setStreaming(false);
  assert.equal(stopped, 1);
  await assert.rejects(service.runHealthProbe([application()]), /Resume monitoring/);
  service.setStreaming(true);
  assert.equal(subscribed, 2);
  service.dispose();
});

test('buffer is bounded, deduplicated, and clear resets throughput', () => {
  const service = new LogStreamService();
  for (let i = 0; i < 1100; i++) service.addLog(entry({ id: String(i) }));
  service.addLog(entry({ id: '1099' }));
  assert.equal(service.getLogs().length, 1000);
  service.clearLogs();
  assert.equal(service.getLogsPerSecond(), 0);
  assert.equal(service.getLogs().length, 0);
});

test('percentiles have no fabricated defaults and filters include project, environment and application', () => {
  assert.equal(percentile95([]), null);
  assert.equal(percentile95([0]), 0);
  assert.equal(percentile95(Array.from({ length: 20 }, (_, i) => i + 1)), 19);
  const apps = [application(), application({ id: 'preview', environment: 'preview' })];
  const logs = [entry(), entry({ applicationId: 'preview', environment: 'preview' }), entry({ applicationId: 'unrelated' })];
  assert.equal(scopeLogs(logs, apps, 'production', null).length, 1);
  assert.equal(scopeLogs(logs, apps, 'all', null).length, 2);
  assert.equal(scopeLogs(logs, apps, 'production', 'preview').length, 0);
});
