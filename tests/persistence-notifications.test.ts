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

test('project updates replace metadata without duplicating projects or changing linked applications', async () => {
  const project = { id: 'project-one', name: 'Original', description: 'Before', color: '#6366f1', tags: ['Production'], createdAt: 0 };
  const other = { ...project, id: 'project-two', name: 'Other' };
  const app = application({ config: { connectionMode: 'account', credentialId: 'shared-token', vercelProjectId: 'provider-project' } });
  const values = storage({
    simply_logs_projects_v1: JSON.stringify([project, other]),
    simply_logs_apps_v1: JSON.stringify([app]),
  });
  const repository = new LocalStorageProjectRepository();
  const updated = { ...project, name: 'Renamed', description: '', color: '#10b981', tags: ['Customer-facing'] };
  await repository.saveProject(updated);
  assert.deepEqual(await repository.getProjects(), [updated, other]);
  assert.equal(values.get('simply_logs_apps_v1'), JSON.stringify([app]));
  assert.equal((await repository.getApplications())[0].config.credentialId, 'shared-token');
});

test('failed project edits leave saved metadata and application references unchanged', async () => {
  const project = { id: 'project-one', name: 'Original', description: 'Before', color: '#6366f1', tags: [], createdAt: 1000 };
  const app = application();
  const values = storage({
    simply_logs_projects_v1: JSON.stringify([project]),
    simply_logs_apps_v1: JSON.stringify([app]),
  });
  localStorage.setItem = () => { throw new Error('Storage full'); };
  const repository = new LocalStorageProjectRepository();
  await assert.rejects(repository.saveProject({ ...project, name: 'Unsaved' }), /could not be saved/);
  assert.deepEqual(await repository.getProjects(), [project]);
  assert.equal(values.get('simply_logs_apps_v1'), JSON.stringify([app]));
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

test('deleting applications keeps a shared token across projects until its last reference is removed', async () => {
  storage();
  const deleted: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    simplyLogs: desktop({ deleteCredential: async id => { deleted.push(id); } }),
  } });
  const repository = new LocalStorageProjectRepository();
  for (const [id, projectId, credentialId] of [
    ['first', 'project-one', 'shared-token'],
    ['second', 'project-two', 'shared-token'],
    ['third', 'project-one', 'separate-token'],
  ]) {
    await repository.saveApplication(application({ id, projectId, config: { connectionMode: 'account', credentialId } }));
  }
  await repository.deleteApplication('first');
  assert.deepEqual(deleted, []);
  assert.equal((await repository.getApplications('project-two'))[0].config.credentialId, 'shared-token');
  await repository.deleteApplication('third');
  assert.deepEqual(deleted, ['separate-token']);
  await repository.deleteApplication('second');
  assert.deepEqual(deleted, ['separate-token', 'shared-token']);
});

test('deleting a project preserves tokens used elsewhere and deletes each unused token only once', async () => {
  const project = { name: 'Project', description: '', color: '#6366f1', tags: [], createdAt: 1000 };
  storage({
    simply_logs_projects_v1: JSON.stringify([{ ...project, id: 'project-one' }, { ...project, id: 'project-two' }]),
    simply_logs_apps_v1: JSON.stringify([
      application({ id: 'first', config: { connectionMode: 'account', credentialId: 'shared-token' } }),
      application({ id: 'second', projectId: 'project-two', config: { connectionMode: 'account', credentialId: 'shared-token' } }),
      application({ id: 'third', config: { connectionMode: 'account', credentialId: 'project-only-token' } }),
      application({ id: 'fourth', config: { connectionMode: 'account', credentialId: 'project-only-token' } }),
    ]),
  });
  const deleted: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    simplyLogs: desktop({ deleteCredential: async id => { deleted.push(id); } }),
  } });
  const repository = new LocalStorageProjectRepository();
  await repository.deleteProject('project-one');
  assert.deepEqual(deleted, ['project-only-token']);
  assert.deepEqual((await repository.getApplications()).map(app => app.id), ['second']);
  assert.deepEqual((await repository.getProjects()).map(item => item.id), ['project-two']);
  await repository.deleteProject('project-two');
  assert.deepEqual(deleted, ['project-only-token', 'shared-token']);
});

test('failed application storage never deletes a credential still referenced by saved data', async () => {
  storage({ simply_logs_apps_v1: JSON.stringify([
    application({ config: { connectionMode: 'account', credentialId: 'saved-token' } }),
  ]) });
  const deleted: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    simplyLogs: desktop({ deleteCredential: async id => { deleted.push(id); } }),
  } });
  localStorage.setItem = () => { throw new Error('Storage full'); };
  const repository = new LocalStorageProjectRepository();
  await assert.rejects(repository.deleteApplication('app-one'), /could not be saved/);
  await assert.rejects(repository.deleteProject('project-one'), /could not be saved/);
  assert.deepEqual(deleted, []);
  assert.equal((await repository.getApplications())[0].config.credentialId, 'saved-token');
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
    isSupported: () => true, onNativeClick: () => () => {},
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
    showNativeNotification: async () => true, isSupported: () => true, onNativeClick: () => () => {},
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
