import type { DesktopBridge } from '../../../shared/desktop';

export function getDesktop(): DesktopBridge {
  if (!window.simplyLogs) {
    throw new Error('Monitoring is available in the Simply Logs desktop app. Run npm run dev or install a desktop release.');
  }
  return window.simplyLogs;
}
