import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageProjectRepository } from '../modules/projects/infrastructure/LocalStorageProjectRepository';
import { NotificationService } from '../modules/notifications/application/NotificationService';
import { BrowserNotificationGateway } from '../modules/notifications/infrastructure/BrowserNotificationGateway';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../modules/notifications/domain/NotificationTypes';
import type { NotificationItem } from '../modules/notifications/domain/NotificationTypes';
import { application, desktop, entry } from './fixtures';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  return values;
}

test('new workspaces are empty and saved applications are filtered by project', async () => {
  storage();
  const repository = new LocalStorageProjectRepository();
  assert.deepEqual(await repository.getProjects(), []);
  assert.deepEqual(await repository.getApplications(), []);
  await repository.saveApplication(application());
  assert.equal((await repository.getApplications('project-one')).length, 1);
  assert.equal((await repository.getApplications('project-two')).length, 0);
});

test('unavailable or corrupt storage reports an error without injecting demo applications', async () => {
  storage({ simply_logs_apps_v1: '{broken' });
  const repository = new LocalStorageProjectRepository();
  await assert.rejects(repository.getApplications('empty'), /not been overwritten/);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('denied'); } } });
  await assert.rejects(repository.getApplications('empty'), /could not be read/);
});

test('legacy tokens are moved out of browser storage before they are saved in the new format', async () => {
  const legacy = { ...application(), config: { apiToken: 'placeholder-legacy-token', useRealApi: true, vercelProjectId: 'project' } };
  const values = storage({ purrpulse_infra_apps_v2: JSON.stringify([legacy]) });
  const saved: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { simplyLogs: desktop({ saveCredential: async (_id, token) => { saved.push(token); return { persistent: true }; } }) } });
  const apps = await new LocalStorageProjectRepository().getApplications();
  assert.equal(apps[0].config.credentialId, 'app-one');
  assert.deepEqual(saved, ['placeholder-legacy-token']);
  assert.ok(!values.get('simply_logs_apps_v1')!.includes('placeholder-legacy-token'));
  assert.equal(values.has('purrpulse_infra_apps_v2'), false);
});

test('historical sample apps are removed rather than monitored', async () => {
  storage({ purrpulse_infra_apps_v2: JSON.stringify([application({ id: 'app_vercel_storefront' })]) });
  assert.deepEqual(await new LocalStorageProjectRepository().getApplications(), []);
});

test('malformed project and application shapes are rejected without crashing the renderer', async () => {
  storage({ simply_logs_projects_v1: JSON.stringify([{ id: 'broken', name: 'Broken', tags: 'not an array' }]) });
  const repository = new LocalStorageProjectRepository();
  await assert.rejects(repository.getProjects(), /invalid format/);
  storage({ simply_logs_apps_v1: JSON.stringify([{ ...application(), name: { invalid: true } }]) });
  await assert.rejects(repository.getApplications(), /invalid format/);
});

test('incident recovery requires fresh success, not silence or unknown telemetry', () => {
  let now = 1000;
  let sounds = 0;
  const gateway = {
    ...BrowserNotificationGateway,
    loadSettings: () => ({ ...DEFAULT_NOTIFICATION_SETTINGS }),
    loadHistory: () => [],
    saveHistory() {}, saveSettings() {},
    getPermission: () => 'granted' as const,
    requestPermission: async () => 'granted' as const,
    showNativeNotification: async () => true,
    isSupported: () => true,
  };
  const service = new NotificationService(gateway, { playErrorAlert: () => { sounds++; }, playPurr: () => { sounds++; } }, () => now);
  let items: NotificationItem[] = [];
  service.subscribe(value => { items = value; });
  service.processLogEntry(entry({ observation: 'unhealthy', level: 'error', statusCode: 500, isRealTelemetry: false }));
  assert.equal(items.length, 0);
  const failed = () => entry({ observation: 'unhealthy', level: 'error', statusCode: 500 });
  service.processLogEntry(failed());
  service.processLogEntry(failed());
  assert.equal(items.length, 1);
  now += 61000;
  assert.equal(service.getActiveIncidentCount(), 1);
  service.processLogEntry(entry({ observation: 'unknown' }));
  assert.equal(items.length, 1);
  service.updateSettings({ soundAlerts: false });
  service.processLogEntry(entry());
  assert.equal(items[0].type, 'resolved');
  assert.equal(sounds, 1);
  assert.equal(service.getActiveIncidentCount(), 0);
});

test('health success cannot resolve a deployment incident', () => {
  const gateway = {
    ...BrowserNotificationGateway, loadSettings: () => ({ ...DEFAULT_NOTIFICATION_SETTINGS, soundAlerts: false, browserPushEnabled: false }),
    loadHistory: () => [], saveHistory() {}, saveSettings() {},
    getPermission: () => 'granted' as const, requestPermission: async () => 'granted' as const,
    showNativeNotification: async () => true, isSupported: () => true,
  };
  let now = 0;
  const service = new NotificationService(gateway, undefined, () => now);
  service.processLogEntry(entry({ monitorKind: 'deployment', observation: 'unhealthy' }));
  now += 61000;
  service.processLogEntry(entry({ monitorKind: 'health' }));
  assert.equal(service.getActiveIncidentCount(), 1);
  service.processLogEntry(entry({ monitorKind: 'deployment' }));
  assert.equal(service.getActiveIncidentCount(), 0);
});
