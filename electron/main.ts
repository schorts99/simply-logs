import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, safeStorage, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import type { Provider, ProviderTarget } from '../shared/desktop';
import { CredentialStore } from './credentials';
import { showNotification } from './notifications';
import { discover, deployments, events, probe, runtimeDeployment, runtimeHistory, streamRuntimeLogs } from './monitoring';

const directory = path.dirname(fileURLToPath(import.meta.url));
const developmentUrl = !app.isPackaged ? process.env.SIMPLY_LOGS_DEV_URL : undefined;
if (developmentUrl && developmentUrl !== 'http://127.0.0.1:5173') throw new Error('Invalid development URL.');
app.setName('Simply Logs');
const dataPath = !app.isPackaged ? app.commandLine.getSwitchValue('user-data-dir') : '';
if (dataPath && path.isAbsolute(dataPath)) app.setPath('userData', dataPath);
app.setAppUserModelId('app.simplylogs.desktop');
let window: BrowserWindow | null = null;
const notifications = new Set<Notification>();
const runtimeStreams = new Map<string, AbortController>();
const runtimeHistoryRequests = new Map<string, AbortController>();

function stopRuntimeStreams(): void {
  runtimeStreams.forEach(controller => controller.abort());
  runtimeStreams.clear();
  runtimeHistoryRequests.forEach(controller => controller.abort());
  runtimeHistoryRequests.clear();
}

function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid input.');
  return value.trim();
}

function provider(value: unknown): Provider {
  if (value !== 'vercel' && value !== 'netlify') throw new Error('Unsupported provider.');
  return value;
}

function target(value: unknown): ProviderTarget {
  if (!value || typeof value !== 'object') throw new Error('Invalid provider target.');
  const input = value as Record<string, unknown>;
  if (input.environment !== undefined && !['production', 'preview', 'development'].includes(String(input.environment))) {
    throw new Error('Invalid deployment environment.');
  }
  return {
    provider: provider(input.provider),
    targetId: text(input.targetId, 256),
    credentialId: text(input.credentialId, 256),
    teamId: input.teamId ? text(input.teamId, 256) : undefined,
    environment: input.environment as ProviderTarget['environment'],
  };
}

function trusted(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Untrusted IPC sender.');
  }
  const expected = developmentUrl || new URL('../dist/index.html', import.meta.url).href;
  if (event.senderFrame.url.split('#')[0] !== expected && event.senderFrame.url !== `${expected}/`) {
    throw new Error('Untrusted renderer origin.');
  }
}

function handle(channel: string, action: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    return action(...args);
  });
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    title: 'Simply Logs',
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#171717',
    icon: path.join(directory, '../dist/icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (process.platform === 'win32' || process.platform === 'linux') window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { stopRuntimeStreams(); window = null; });
  window.webContents.on('did-start-loading', stopRuntimeStreams);
  window.webContents.on('render-process-gone', stopRuntimeStreams);
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const destination = new URL(url);
      if (destination.protocol === 'https:' && !destination.username && !destination.password) {
        void shell.openExternal(destination.href);
      }
    } catch {}
    return { action: 'deny' };
  });
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(path.join(directory, '../dist/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const credentials = new CredentialStore(app.getPath('userData'), {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      getSelectedStorageBackend: process.platform === 'linux' ? () => safeStorage.getSelectedStorageBackend() : undefined,
      encryptString: value => safeStorage.encryptString(value),
      decryptString: value => safeStorage.decryptString(value),
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self'; script-src 'self'${developmentUrl ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${developmentUrl ? "'self' ws://127.0.0.1:5173" : "'none'"}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`,
          ],
        },
      });
    });
    handle('providers:discover', async input => {
      if (!input || typeof input !== 'object') throw new Error('Invalid discovery input.');
      const selectedProvider = provider(input.provider);
      if ((input.apiToken !== undefined) === (input.credentialId !== undefined)) {
        throw new Error('Choose either a saved token or a new token.');
      }
      const token = input.credentialId !== undefined
        ? await credentials.get(text(input.credentialId, 256))
        : text(input.apiToken, 4096);
      return discover(selectedProvider, token, input.teamId ? text(input.teamId, 256) : undefined);
    });
    handle('providers:deployments', async input => {
      const selected = target(input);
      return deployments(selected, await credentials.get(selected.credentialId));
    });
    handle('providers:events', async input => {
      const selected = target(input);
      return events({ ...selected, deploymentId: text(input.deploymentId, 256) }, await credentials.get(selected.credentialId));
    });
    handle('providers:runtime-deployment', async input => {
      const selected = target(input);
      return runtimeDeployment(selected, await credentials.get(selected.credentialId));
    });
    handle('providers:runtime-history', async input => {
      const selected = target(input);
      const subscriptionId = text(input.subscriptionId, 256);
      if (runtimeHistoryRequests.has(subscriptionId)) throw new Error('Runtime history request already exists.');
      if (runtimeHistoryRequests.size >= 100) throw new Error('Too many runtime history requests.');
      const controller = new AbortController();
      runtimeHistoryRequests.set(subscriptionId, controller);
      try {
        const token = await credentials.get(selected.credentialId);
        return await runtimeHistory(selected, token, controller.signal);
      } finally {
        controller.abort();
        if (runtimeHistoryRequests.get(subscriptionId) === controller) runtimeHistoryRequests.delete(subscriptionId);
      }
    });
    handle('providers:runtime-start', input => {
      const selected = target(input);
      const deploymentId = text(input.deploymentId, 256);
      const subscriptionId = text(input.subscriptionId, 256);
      if (runtimeStreams.has(subscriptionId)) throw new Error('Runtime subscription already exists.');
      if (runtimeStreams.size >= 100) throw new Error('Too many runtime log subscriptions.');
      const controller = new AbortController();
      runtimeStreams.set(subscriptionId, controller);
      const sender = window!.webContents;
      const send = (update: object) => {
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sender.send('providers:runtime-update', { subscriptionId, ...update });
        }
      };
      void (async () => {
        const token = await credentials.get(selected.credentialId);
        await streamRuntimeLogs({ ...selected, deploymentId }, token, event => send({ event }), controller.signal);
        send({ error: 'Runtime log stream ended.' });
      })().catch(error => {
        send({ error: error instanceof Error ? error.message : 'Runtime log connection failed.' });
      }).finally(() => {
        controller.abort();
        if (runtimeStreams.get(subscriptionId) === controller) runtimeStreams.delete(subscriptionId);
      });
    });
    handle('providers:runtime-stop', id => {
      const subscriptionId = text(id, 256);
      runtimeStreams.get(subscriptionId)?.abort();
      runtimeStreams.delete(subscriptionId);
      runtimeHistoryRequests.get(subscriptionId)?.abort();
      runtimeHistoryRequests.delete(subscriptionId);
    });
    handle('monitor:probe', url => probe(text(url, 2048)));
    handle('credentials:save', (id, token) => credentials.save(text(id, 256), text(token, 4096)));
    handle('credentials:delete', id => credentials.delete(text(id, 256)));
    handle('desktop:copy', value => {
      if (typeof value !== 'string' || value.length > 5_000_000) throw new Error('Clipboard content is too large.');
      clipboard.writeText(value);
    });
    handle('desktop:export', async value => {
      if (typeof value !== 'string' || value.length > 5_000_000) throw new Error('Export is too large.');
      JSON.parse(value);
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: `simply-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        filters: [{ name: 'JSON logs', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, value, { mode: 0o600 });
      return true;
    });
    handle('desktop:notify', async (title, body, id) => {
      if (!Notification.isSupported()) throw new Error('Native desktop notifications are not supported on this system.');
      const notification = new Notification({
        title: text(title, 256), body: text(body, 1024), silent: true,
      });
      notifications.add(notification);
      notification.once('close', () => notifications.delete(notification));
      notification.once('click', () => {
        if (window?.isMinimized()) window.restore();
        window?.show();
        window?.focus();
        if (typeof id === 'string' && /^[\w-]{1,64}$/.test(id)) window?.webContents.send('desktop:notification-click', id);
      });
      try {
        return await showNotification(notification);
      } catch (error) {
        notifications.delete(notification);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(process.platform === 'darwin'
          ? `${message} Use a signed Simply Logs.app and allow notifications in System Settings > Notifications. Check Focus settings if banners are hidden.`
          : message);
      }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Simply Logs', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
      { label: 'File', submenu: [{ role: 'close' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : [])] },
    ]));
    await createWindow();
    app.on('activate', () => { if (!window) void createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('Simply Logs could not start', error instanceof Error ? error.message : String(error));
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
