import test from 'node:test';
import assert from 'node:assert/strict';
import { LogStreamService } from '../modules/monitoring/application/LogStreamService';
import { LocalStorageLogHistory } from '../modules/monitoring/infrastructure/LocalStorageLogHistory';
import { ProviderAdapter } from '../modules/monitoring/infrastructure/ProviderAdapter';
import { application, entry } from './fixtures';

const KEY = 'simply_logs_history_v1';

function storage(initial: string | null = null) {
  const values = new Map<string, string>(initial === null ? [] : [[KEY, initial]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  return values;
}

function service() {
  const adapter = new ProviderAdapter('vercel');
  adapter.subscribeLogs = () => () => {};
  return new LogStreamService({ getAdapter: () => adapter }, new LocalStorageLogHistory());
}

test('received runtime, edge and build logs survive restart with metadata, without replaying alerts or throughput', () => {
  storage();
  const first = service();
  first.syncApplications([application()]);
  const logs = ['runtime', 'serverless', 'edge', 'build'].map(source => entry({
    source: source as 'runtime' | 'serverless' | 'edge' | 'build',
    timestamp: 1234, level: 'error', message: `Saved ${source} output`,
    method: 'POST', path: '/api/example', requestId: 'request-one', host: 'example.com',
    region: 'iad1', stackTrace: 'Error: example', payload: { deploymentId: 'deploy-one', messageTruncated: true },
  }));
  logs.forEach(log => first.addLog(log));
  first.dispose();

  const reopened = service();
  let alerts = 0;
  reopened.subscribeEntries(() => { alerts++; });
  reopened.syncApplications([application()]);
  assert.deepEqual(reopened.getLogs(), logs);
  assert.equal(reopened.getLogsPerSecond(), 0);
  assert.equal(alerts, 0);
  reopened.addLog({ ...logs[1], observation: undefined, monitorKind: undefined });
  assert.equal(reopened.getLogs().length, logs.length, 'reconnected streams do not duplicate saved runtime events');
  assert.equal(alerts, 0);
  reopened.dispose();
});

test('switching projects hides but retains history, including through the empty transition', () => {
  storage();
  const stream = service();
  const a = application();
  const b = application({ id: 'app-two', projectId: 'project-two', environment: 'preview' });
  const one = entry({ source: 'serverless' });
  const two = entry({ applicationId: b.id, environment: 'preview', source: 'edge' });
  stream.syncApplications([a]);
  stream.addLog(one);
  stream.syncApplications([]);
  assert.deepEqual(stream.getLogs(), []);
  stream.syncApplications([b]);
  assert.deepEqual(stream.getLogs(), []);
  stream.addLog(two);
  stream.syncApplications([]);
  stream.syncApplications([a]);
  assert.deepEqual(stream.getLogs(), [one]);
  stream.dispose();
  const reopened = service();
  reopened.syncApplications([b]);
  assert.deepEqual(reopened.getLogs(), [two]);
  reopened.dispose();
});

test('clearing a project removes its saved history without clearing other projects', () => {
  storage();
  const stream = service();
  stream.syncApplications([application()]);
  stream.addLog(entry());
  const b = application({ id: 'app-two', projectId: 'project-two' });
  const other = entry({ applicationId: b.id });
  stream.syncApplications([b]);
  stream.addLog(other);
  stream.syncApplications([application()]);
  stream.clearLogs();
  stream.dispose();
  const reopened = service();
  reopened.syncApplications([application()]);
  assert.deepEqual(reopened.getLogs(), []);
  reopened.syncApplications([b]);
  assert.deepEqual(reopened.getLogs(), [other]);
  reopened.dispose();
});

test('deleting applications prunes saved history, including applications outside the active project', () => {
  storage();
  const stream = service();
  const a = entry();
  const b = entry({ applicationId: 'app-two' });
  stream.addLog(a);
  stream.addLog(b);
  stream.retainApplications(['app-two']);
  assert.deepEqual(new LocalStorageLogHistory().load(), [b]);
  assert.deepEqual(stream.getLogs(), [b]);
  stream.retainApplications([]);
  assert.deepEqual(new LocalStorageLogHistory().load(), []);
});

test('saved history retains exactly the newest 1,000 entries', () => {
  storage();
  const stream = service();
  for (let i = 0; i < 1100; i++) stream.addLog(entry({ id: `event-${i}` }));
  const saved = new LocalStorageLogHistory().load();
  assert.equal(saved.length, 1000);
  assert.equal(saved[0].id, 'event-100');
  assert.equal(saved.at(-1)!.id, 'event-1099');
  const reopened = service();
  reopened.syncApplications([application()]);
  assert.deepEqual(reopened.getLogs(), saved);
  reopened.dispose();
});

test('corrupt or malformed history is reported, not replayed or overwritten', () => {
  for (const raw of ['{broken', '{}', '[null]', JSON.stringify([{ ...entry(), path: {} }])]) {
    const values = storage(raw);
    const stream = service();
    let error: string | null = null;
    stream.subscribeStorageErrors(value => { error = value; });
    assert.match(error!, /could not be read.*not been overwritten/);
    stream.syncApplications([application()]);
    stream.addLog(entry());
    stream.clearLogs();
    stream.retainApplications([]);
    assert.equal(values.get(KEY), raw);
    stream.dispose();
  }
});

test('unavailable or full storage is reported while monitoring continues, and saving can recover', () => {
  storage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw new Error('denied'); },
  } });
  const unreadable = service();
  let error: string | null = null;
  unreadable.subscribeStorageErrors(value => { error = value; });
  assert.match(error!, /session-only/);
  unreadable.addLog(entry());
  assert.equal(unreadable.getLogs().length, 1);

  storage();
  const stream = service();
  stream.subscribeStorageErrors(value => { error = value; });
  localStorage.setItem = () => { throw new Error('quota exceeded'); };
  let observations = 0;
  stream.subscribeEntries(() => { observations++; });
  stream.addLog(entry());
  assert.equal(stream.getLogs().length, 1);
  assert.equal(observations, 1);
  assert.match(error!, /could not be saved/);
  storage();
  stream.addLog(entry());
  assert.equal(error, null);
  assert.equal(new LocalStorageLogHistory().load().length, 2);
});
