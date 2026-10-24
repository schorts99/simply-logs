import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/desktop';

const bridge: DesktopBridge = {
  platform: process.platform,
  discover: input => ipcRenderer.invoke('providers:discover', input),
  deployments: input => ipcRenderer.invoke('providers:deployments', input),
  events: input => ipcRenderer.invoke('providers:events', input),
  probe: url => ipcRenderer.invoke('monitor:probe', url),
  saveCredential: (id, token) => ipcRenderer.invoke('credentials:save', id, token),
  deleteCredential: id => ipcRenderer.invoke('credentials:delete', id),
  notify: (title, body) => ipcRenderer.invoke('desktop:notify', title, body),
  copyText: text => ipcRenderer.invoke('desktop:copy', text),
  exportLogs: json => ipcRenderer.invoke('desktop:export', json),
};
contextBridge.exposeInMainWorld('simplyLogs', bridge);
