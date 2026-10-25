import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { showNotification } from '../electron/notifications';
import { NotificationService } from '../modules/notifications/application/NotificationService';
import { BrowserNotificationGateway } from '../modules/notifications/infrastructure/BrowserNotificationGateway';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../modules/notifications/domain/NotificationTypes';
import type { NotificationItem } from '../modules/notifications/domain/NotificationTypes';
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

function service(notify: () => Promise<boolean>, enabled = true) {
  return new NotificationService({
    loadSettings: () => ({ ...DEFAULT_NOTIFICATION_SETTINGS, soundAlerts: false, browserPushEnabled: enabled }),
    loadHistory: () => [], saveHistory() {}, saveSettings() {},
    getPermission: () => 'granted', requestPermission: async () => 'granted',
    isSupported: () => true, showNativeNotification: notify,
  });
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
  const notifications = service(async () => { throw new Error('OS rejected incident'); });
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
