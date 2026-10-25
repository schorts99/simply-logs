import React, { useEffect, useRef, useState } from 'react';
import type { Project, Application } from '../../projects/domain/Project';
import { ThemeSwitcher } from './ThemeSwitcher';
import { PixelCat } from '../../companion/presentation/PixelCat';
import type { CatMood, CatBreed } from '../../companion/domain/CatTypes';
import { ChevronDown, FolderPlus, Sparkles, BellRing, Trash2, Pencil } from 'lucide-react';

interface WindowChromeProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onOpenCreateProject: () => void;
  onOpenEditProject: () => void;
  onDeleteProject: () => void;
  applications: Application[];
  activeLogMood: CatMood;
  catBreed: CatBreed;
  onPetCat: () => void;
  onOpenCatCustomizer: () => void;
  unreadNotificationCount: number;
  onOpenNotifications: () => void;
}

export const WindowChrome: React.FC<WindowChromeProps> = props => {
  const [open, setOpen] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!dropdown.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const healthy = props.applications.filter(app => app.status === 'healthy').length;
  const failed = props.applications.filter(app => app.status === 'error' || app.status === 'warning').length;
  return (
    <header className="h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 flex items-center justify-between gap-4 select-none z-40">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <img src="./icon.svg" alt="" className="w-8 h-8" />
          <h1 className="text-sm font-bold tracking-tight">Simply Logs</h1>
        </div>
        <div className="relative min-w-0" ref={dropdown}>
          <button
            onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="project-picker"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-neutral-200/70 dark:bg-neutral-800 max-w-56"
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: props.selectedProject?.color || '#6366f1' }} />
            <span className="truncate">{props.selectedProject?.name || 'Your projects'}</span>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </button>
          {open && (
            <div id="project-picker" className="absolute top-10 left-0 w-64 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl p-1.5">
              {props.projects.map(project => (
                <button key={project.id} onClick={() => { props.onSelectProject(project); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-xs rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 ${project.id === props.selectedProject?.id ? 'text-indigo-500 font-semibold' : ''}`}
                >{project.name}</button>
              ))}
              <button onClick={() => { setOpen(false); props.onOpenCreateProject(); }}
                className="w-full px-3 py-2 text-left text-xs text-indigo-500 flex items-center gap-2 rounded-lg hover:bg-indigo-500/10">
                <FolderPlus className="w-3.5 h-3.5" /> Create project
              </button>
              {props.selectedProject && (
                <button onClick={() => { setOpen(false); props.onOpenEditProject(); }}
                  className="w-full px-3 py-2 text-left text-xs text-neutral-700 dark:text-neutral-300 flex items-center gap-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  <Pencil className="w-3.5 h-3.5" /> Edit current project
                </button>
              )}
              {props.selectedProject && (
                <button onClick={() => { setOpen(false); props.onDeleteProject(); }}
                  className="w-full px-3 py-2 text-left text-xs text-rose-500 flex items-center gap-2 rounded-lg hover:bg-rose-500/10">
                  <Trash2 className="w-3.5 h-3.5" /> Delete current project
                </button>
              )}
            </div>
          )}
        </div>
        {props.applications.length > 0 && (
          <span className="hidden xl:block text-[11px] text-neutral-500">
            {healthy} healthy{failed > 0 ? ` · ${failed} need attention` : ''} · {props.applications.length} apps
          </span>
        )}
      </div>
      <div className="hidden lg:flex items-center gap-2">
        <button onClick={props.onPetCat} title="Pet your log companion" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800">
          <PixelCat mood={props.activeLogMood} breed={props.catBreed} size="sm" />
          <span className="text-[11px] text-neutral-500">{props.activeLogMood === 'alert' ? 'Something needs a look' : 'A little peace of mind'}</span>
        </button>
        <button onClick={props.onOpenCatCustomizer} title="Customize your cat" className="p-1.5 rounded-lg text-neutral-500 hover:text-indigo-500">
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={props.onOpenNotifications} title="Notifications and alert settings" className="relative p-2 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800">
          <BellRing className="w-4 h-4" />
          {props.unreadNotificationCount > 0 && <span className="absolute -top-0.5 -right-0.5 text-[9px] rounded-full px-1 bg-rose-500 text-white">{props.unreadNotificationCount}</span>}
        </button>
        <ThemeSwitcher compact />
      </div>
    </header>
  );
};
