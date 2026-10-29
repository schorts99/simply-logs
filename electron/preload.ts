import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DesktopBridge, RuntimeEvent } from '../shared/desktop';

const bridge: DesktopBridge = {
  platform: process.platform,
  discover: input => ipcRenderer.invoke('providers:discover', input),
  deployments: input => ipcRenderer.invoke('providers:deployments', input),
  events: input => ipcRenderer.invoke('providers:events', input),
  runtimeDeployment: input => ipcRenderer.invoke('providers:runtime-deployment', input),
  loadRuntimeHistory: (input, onHistory, onError) => {
    const subscriptionId = crypto.randomUUID();
    let active = true;
    void ipcRenderer.invoke('providers:runtime-history', { ...input, subscriptionId }).then(
      history => { if (active) onHistory(history); },
      error => { if (active) onError(error instanceof Error ? error.message : 'Runtime history could not be loaded.'); },
    );
    return () => {
      active = false;
      void ipcRenderer.invoke('providers:runtime-stop', subscriptionId).catch(() => {});
    };
  },
  subscribeRuntimeLogs: (input, onLog, onError) => {
    const subscriptionId = crypto.randomUUID();
    let active = true;
    const listener = (_event: IpcRendererEvent, update: { subscriptionId: string; event?: RuntimeEvent; error?: string }) => {
      if (!active || update.subscriptionId !== subscriptionId) return;
      if (update.error) onError(update.error);
      else if (update.event) onLog(update.event);
    };
    ipcRenderer.on('providers:runtime-update', listener);
    void ipcRenderer.invoke('providers:runtime-start', { ...input, subscriptionId }).catch(error => {
      if (active) onError(error instanceof Error ? error.message : 'Runtime log connection failed.');
    });
    return () => {
      active = false;
      ipcRenderer.removeListener('providers:runtime-update', listener);
      void ipcRenderer.invoke('providers:runtime-stop', subscriptionId).catch(() => {});
    };
  },
  probe: url => ipcRenderer.invoke('monitor:probe', url),
  saveCredential: (id, token) => ipcRenderer.invoke('credentials:save', id, token),
  deleteCredential: id => ipcRenderer.invoke('credentials:delete', id),
  notify: (title, body, id) => ipcRenderer.invoke('desktop:notify', title, body, id),
  onNotificationClick: listener => {
    const handler = (_event: IpcRendererEvent, id: unknown) => { if (typeof id === 'string') listener(id); };
    ipcRenderer.on('desktop:notification-click', handler);
    return () => { ipcRenderer.removeListener('desktop:notification-click', handler); };
  },
  copyText: text => ipcRenderer.invoke('desktop:copy', text),
  exportLogs: json => ipcRenderer.invoke('desktop:export', json),
};
contextBridge.exposeInMainWorld('simplyLogs', bridge);
