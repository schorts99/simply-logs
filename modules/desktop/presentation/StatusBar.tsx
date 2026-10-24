import React from 'react';
import type { Application, Environment } from '../../projects/domain/Project';
import { Bell, BellOff, BellRing, Activity } from 'lucide-react';

interface Props {
  isStreaming: boolean;
  logCount: number;
  logsPerSec: number;
  activeApp: Application | null;
  soundEnabled: boolean;
  onToggleSound: () => void;
  errorCount: number;
  applicationCount: number;
  activeEnv: Environment | 'all';
  unreadNotificationCount: number;
  onOpenNotifications: () => void;
}

export const StatusBar: React.FC<Props> = props => (
  <footer className="h-7 shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3 flex justify-between items-center text-[10px] font-mono text-neutral-500 gap-3">
    <div className="flex items-center gap-3 min-w-0">
      <span className="flex items-center gap-1.5 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${!props.isStreaming ? 'bg-amber-500' : props.applicationCount ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
        {!props.isStreaming ? 'PAUSED · health unknown' : props.applicationCount ? 'MONITORING' : 'NO TARGETS'}
      </span>
      <span className="truncate">Scope: {props.activeApp?.name || 'Current project'} · {props.activeEnv}</span>
      <span className="hidden xl:inline">{props.logsPerSec.toFixed(1)} entries/s</span>
    </div>
    <div className="flex items-center gap-4 shrink-0">
      <span className="hidden lg:flex items-center gap-1"><Activity className="w-3 h-3" /> {props.logCount} entries{props.errorCount ? ` · ${props.errorCount} errors in history` : ''}</span>
      <button onClick={props.onOpenNotifications} title="Notification settings" className="flex items-center gap-1">
        <BellRing className="w-3 h-3" /> Alerts{props.unreadNotificationCount ? ` (${props.unreadNotificationCount})` : ''}
      </button>
      <button onClick={props.onToggleSound} aria-pressed={props.soundEnabled} title={props.soundEnabled ? 'Mute all sounds' : 'Enable sounds'} className="flex items-center gap-1">
        {props.soundEnabled ? <Bell className="w-3 h-3 text-indigo-500" /> : <BellOff className="w-3 h-3" />}
        {props.soundEnabled ? 'Sound on' : 'Muted'}
      </button>
      <span className="hidden xl:inline">Space: pause/resume</span>
    </div>
  </footer>
);
