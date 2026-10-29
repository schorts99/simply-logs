import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { showNotification } from '../electron/notifications';
import { NotificationService } from '../modules/notifications/application/NotificationService';
import { BrowserNotificationGateway } from '../modules/notifications/infrastructure/BrowserNotificationGateway';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../modules/notifications/domain/NotificationTypes';
import type { NotificationItem, NotificationSettings } from '../modules/notifications/domain/NotificationTypes';
import { desktop, entry } from './fixtures';

class NativeNotification extends EventEmitter {
  constructor(private action: () => void = () => {}) { super(); }
  show(): void { this.action(); }
}

test('native notification waits for OS acceptance rather than returning after show()', async () => {
  const notification = new NativeNotification();
  let settled = false;
  const result = showNotification(notification).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  notification.emit('show');
  assert.equal(await result, true);
  assert.equal(notification.listenerCount('failed'), 0);
});

test('native notification reports asynchronous macOS failure and releases listeners', async () => {
  const notification = new NativeNotification();
  const result = showNotification(notification);
  notification.emit('failed', {}, 'Notifications are not allowed for this application');
  await assert.rejects(result, /not allowed/);
  assert.equal(notification.listenerCount('show'), 0);
  assert.equal(notification.listenerCount('failed'), 0);
});

test('native notification handles synchronous show failures and timeouts', async () => {
  const throwing = new NativeNotification(() => { throw new Error('Unsigned application'); });
  await assert.rejects(showNotification(throwing), /Unsigned application/);
  assert.equal(throwing.listenerCount('failed'), 0);
  const silent = new NativeNotification();
  await assert.rejects(showNotification(silent, 5), /did not confirm/);
  assert.equal(silent.listenerCount('show'), 0);
});

function service(
  notify: (title: string, options?: { body?: string; id?: string }) => Promise<boolean>, enabled = true,
  clock?: () => number, settings: Partial<NotificationSettings> = {},
  onNativeClick: (listener: (id: string) => void) => () => void = () => () => {},
) {
  return new NotificationService({
    loadSettings: () => ({ ...DEFAULT_NOTIFICATION_SETTINGS, soundAlerts: false, browserPushEnabled: enabled, ...settings }),
    loadHistory: () => [], saveHistory() {}, saveSettings() {},
    getPermission: () => 'granted', requestPermission: async () => 'granted',
    isSupported: () => true, showNativeNotification: notify, onNativeClick,
  }, undefined, clock);
}

test('test notification returns OS acceptance and preserves in-app history', async () => {
  const notifications = service(async () => true);
  let history: NotificationItem[] = [];
  notifications.subscribe(items => { history = items; });
  assert.equal(await notifications.sendTestNotification(), true);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, 'Simply Logs');
});

test('rejected or unsupported delivery produces an in-app warning without recursively notifying', async () => {
  for (const reject of [false, true]) {
    let attempts = 0;
    const notifications = service(async () => {
      attempts++;
      if (reject) throw new Error('macOS denied notification delivery');
      return false;
    });
    let history: NotificationItem[] = [];
    const toasts: NotificationItem[] = [];
    notifications.subscribe(items => { history = items; });
    notifications.subscribeToActiveToasts(item => { toasts.push(item); });
    assert.equal(await notifications.sendTestNotification(), false);
    assert.equal(attempts, 1);
    assert.equal(history.length, 2);
    assert.equal(history[0].title, 'Desktop notification failed');
    assert.equal(history[0].type, 'warning');
    assert.match(history[0].body, reject ? /macOS denied/ : /did not accept/);
    assert.equal(toasts.length, 2);
  }
});

test('disabled desktop notifications keep test alerts in-app only', async () => {
  let attempts = 0;
  const notifications = service(async () => { attempts++; return true; }, false);
  assert.equal(await notifications.sendTestNotification(), false);
  assert.equal(attempts, 0);
  assert.equal(notifications.getUnreadCount(), 1);
});

test('incident delivery failures are visible without replaying or losing the incident', async () => {
  const notifications = service(async () => { throw new Error('OS rejected incident'); }, true, undefined, { failureThreshold: 1 });
  let history: NotificationItem[] = [];
  notifications.subscribe(items => { history = items; });
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(notifications.getActiveIncidentCount(), 1);
  assert.equal(history[0].title, 'Desktop notification failed');
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  assert.equal(history.length, 2);
});

test('desktop gateway rejects preview and false responses, and forwards native errors', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  await assert.rejects(BrowserNotificationGateway.showNativeNotification('Test'), /UI preview/);
  window.simplyLogs = desktop({ notify: async () => false });
  await assert.rejects(BrowserNotificationGateway.showNativeNotification('Test'), /did not accept/);
  window.simplyLogs = desktop({ notify: async () => { throw new Error('Unsigned app'); } });
  await assert.rejects(BrowserNotificationGateway.showNativeNotification('Test'), /Unsigned app/);
  window.simplyLogs = desktop({ notify: async (title, body) => {
    assert.equal(title, 'Test');
    assert.equal(body, 'Body');
    return true;
  } });
  assert.equal(await BrowserNotificationGateway.showNativeNotification('Test', { body: 'Body' }), true);
});

function capture(notifications: NotificationService) {
  let history: NotificationItem[] = [];
  notifications.subscribe(items => { history = items; });
  return () => history;
}

test('a single failed health check is a blip; consecutive failures reach the alert threshold', () => {
  let now = 0;
  const notifications = service(async () => true, false, () => now);
  const history = capture(notifications);
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  assert.equal(history().length, 0);
  notifications.processLogEntry(entry());
  assert.equal(notifications.getActiveIncidentCount(), 0);
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  notifications.processLogEntry(entry({ observation: 'unhealthy', message: 'HTTP 503' }));
  assert.equal(history().length, 1);
  assert.match(history()[0].title, /^Health check failed: My app/);
  assert.match(history()[0].body, /2 consecutive checks failed\. HTTP 503/);
  assert.equal(history()[0].environment, 'production');
  assert.equal(history()[0].kind, 'health');
});

test('failed deployments alert immediately regardless of the health threshold', () => {
  const notifications = service(async () => true, false, undefined, { failureThreshold: 5 });
  const history = capture(notifications);
  notifications.processLogEntry(entry({ monitorKind: 'deployment', observation: 'unhealthy', message: 'Build failed' }));
  assert.equal(history().length, 1);
  assert.equal(history()[0].title, 'Deployment failed: My app');
});

test('recovery alerts report downtime and failure count', () => {
  let now = 0;
  const notifications = service(async () => true, false, () => now, { failureThreshold: 1 });
  const history = capture(notifications);
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  now += 15_000;
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  now += 120_000;
  notifications.processLogEntry(entry());
  assert.equal(history()[0].type, 'resolved');
  assert.match(history()[0].body, /^Down for 2m 15s · 2 failed checks\./);
  assert.equal(history()[0].downtimeMs, 135_000);
});

test('muted applications stay silent until the mute expires or is lifted', () => {
  let now = 0;
  const notifications = service(async () => true, false, () => now, { failureThreshold: 1 });
  const history = capture(notifications);
  notifications.muteApplication('app-one', 'My app', 60_000);
  assert.equal(notifications.isMuted('app-one'), true);
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  assert.equal(history().length, 0);
  now += 61_000;
  assert.equal(notifications.isMuted('app-one'), false);
  notifications.processLogEntry(entry({ observation: 'unhealthy' }));
  assert.equal(history().length, 1);
  notifications.muteApplication('app-one', 'My app');
  assert.equal(notifications.getActiveIncidentCount(), 0);
  notifications.unmuteApplication('app-one');
  assert.deepEqual(notifications.getSettings().mutedApplications, {});
});

test('runtime error spikes alert once above the per-minute rate and recover on a successful request', () => {
  let now = 0;
  const notifications = service(async () => true, false, () => now, { runtimeErrorsPerMinute: 3 });
  const history = capture(notifications);
  const runtime = (overrides: Parameters<typeof entry>[0] = {}) => entry({
    source: 'serverless', monitorKind: undefined, observation: undefined, level: 'error', statusCode: 500,
    method: 'POST', path: '/api/checkout', message: 'TypeError: x is undefined', ...overrides,
  });
  notifications.processLogEntry(runtime());
  now += 30_000;
  notifications.processLogEntry(runtime());
  now += 40_000; // the first error has left the one-minute window
  notifications.processLogEntry(runtime());
  assert.equal(history().length, 0);
  notifications.processLogEntry(runtime({ payload: { historical: true } }));
  assert.equal(history().length, 0);
  notifications.processLogEntry(runtime());
  assert.equal(history().length, 1);
  assert.equal(history()[0].title, 'Error spike: My app');
  assert.match(history()[0].body, /3 runtime errors in the last minute\. Latest: 500 POST \/api\/checkout TypeError/);
  notifications.processLogEntry(runtime());
  assert.equal(history().length, 1);
  notifications.processLogEntry(runtime({ level: 'warn', statusCode: undefined, source: 'runtime', message: 'Reconnecting' }));
  now += 61_000;
  notifications.processLogEntry(runtime({ level: 'info', statusCode: 200 }));
  assert.equal(history()[0].type, 'resolved');
  assert.match(history()[0].body, /^Errors lasted .* · 4 runtime errors\./);
});

test('runtime spike alerts can be disabled', () => {
  const notifications = service(async () => true, false, undefined, { runtimeErrorAlerts: false, runtimeErrorsPerMinute: 1 });
  const history = capture(notifications);
  notifications.processLogEntry(entry({ source: 'runtime', monitorKind: undefined, observation: undefined, level: 'error' }));
  assert.equal(history().length, 0);
});

test('desktop notifications carry context and an id that resolves clicks back to the alert', async () => {
  const sent: { title: string; body?: string; id?: string }[] = [];
  let click: (id: string) => void = () => {};
  const notifications = service(async (title, options) => { sent.push({ title, ...options }); return true; }, true, undefined,
    { failureThreshold: 1 }, listener => { click = listener; return () => {}; });
  const history = capture(notifications);
  const opened: NotificationItem[] = [];
  notifications.subscribeNativeClicks(item => opened.push(item));
  notifications.processLogEntry(entry({ observation: 'unhealthy', message: 'HTTP 502' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[0].body, 'production · Vercel — HTTP 502');
  assert.equal(sent[0].id, history()[0].id);
  click('unknown-id');
  click(sent[0].id!);
  assert.deepEqual(opened.map(item => item.applicationId), ['app-one']);
});
