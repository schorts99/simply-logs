import React, { useState } from 'react';
import { Project, Application, Environment } from '../domain/Project';
import { PixelCat } from '@/modules/companion/presentation/PixelCat';
import { CatMood, CatBreed } from '@/modules/companion/domain/CatTypes';
import { 
  Plus, 
  Server, 
  ExternalLink, 
  Trash2, 
  Sparkles,
  Radio,
  Pencil
} from 'lucide-react';

interface ProjectSidebarProps {
  currentProject: Project | null;
  applications: Application[];
  selectedAppId: string | null;
  onSelectApp: (appId: string | null) => void;
  onOpenAddAppModal: () => void;
  onOpenCreateProjectModal: () => void;
  onDeleteApp: (appId: string) => void;
  onEditApp: (app: Application) => void;
  catMood: CatMood;
  catBreed?: CatBreed;
  onPetCat: () => void;
  onOpenCatCustomizer: () => void;
  activeEnv: Environment | 'all';
  onSelectEnv: (env: Environment | 'all') => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  currentProject,
  applications,
  selectedAppId,
  onSelectApp,
  onOpenAddAppModal,
  onOpenCreateProjectModal,
  onDeleteApp,
  onEditApp,
  catMood,
  catBreed,
  onPetCat,
  onOpenCatCustomizer,
  activeEnv,
  onSelectEnv
}) => {
  const [deletingAppId, setDeletingAppId] = useState<string | null>(null);

  const envFilteredApps = applications.filter(app => {
    if (activeEnv === 'all') return true;
    return app.environment === activeEnv;
  });

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'vercel':
        return <span className="text-[11px] font-bold">▲</span>;
      case 'netlify':
        return <span className="text-[11px]">🌐</span>;
      default:
        return <Server className="w-3.5 h-3.5" />;
    }
  };

  return (
    <aside className="w-64 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/60 backdrop-blur-md flex flex-col justify-between select-none h-full transition-colors">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Project Header Card */}
        <div className="p-3 rounded-xl bg-white dark:bg-neutral-800/70 border border-neutral-200 dark:border-neutral-700/60 shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
              Project Context
            </span>
            <button
              onClick={onOpenCreateProjectModal}
              title="Create new project"
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          <div className="flex items-start gap-2.5">
            <div
              className="w-3.5 h-3.5 rounded-md mt-0.5 shrink-0 shadow-sm"
              style={{ backgroundColor: currentProject?.color || '#6366f1' }}
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {currentProject?.name || 'Your project'}
              </h2>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-1 mt-0.5">
                {currentProject?.description || 'Infrastructure monitor'}
              </p>
            </div>
          </div>

          {currentProject?.tags && currentProject.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-700/40">
              {currentProject.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700/50 text-neutral-600 dark:text-neutral-300 font-mono"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Environment Filter tabs */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold mb-1.5 px-1">
            Environment
          </div>
          <div className="grid grid-cols-4 gap-1 p-0.5 bg-neutral-200/60 dark:bg-neutral-800/60 rounded-lg text-center font-mono text-[10px]">
            {(['all', 'production', 'preview', 'development'] as const).map(env => (
              <button
                key={env}
                onClick={() => onSelectEnv(env)}
                className={`py-1 rounded-md transition-all ${
                  activeEnv === env
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                {env === 'all' ? 'All' : env.slice(0, 4)}
              </button>
            ))}
          </div>
        </div>

        {/* Applications List */}
        <div>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold flex items-center gap-1">
              <Server className="w-3 h-3" /> Applications ({envFilteredApps.length})
            </span>
            <button
              onClick={onOpenAddAppModal}
              className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add App
            </button>
          </div>

          <button
            onClick={() => onSelectApp(null)}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-all mb-1 ${
              selectedAppId === null
                ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium border border-indigo-500/30'
                : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Radio className={`w-3.5 h-3.5 ${selectedAppId === null ? 'text-indigo-500 animate-pulse' : 'text-neutral-400'}`} />
              <span className="truncate">All Applications Stream</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-200/80 dark:bg-neutral-800 text-neutral-500">
              Unified
            </span>
          </button>

          <div className="space-y-1 mt-1">
            {envFilteredApps.length === 0 ? (
              <div className="p-3 text-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-800 text-[11px] text-neutral-500">
                No apps in this view.
                <button
                  onClick={onOpenAddAppModal}
                  className="block mx-auto mt-1 text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                >
                  + Add Vercel or Netlify app
                </button>
              </div>
            ) : (
              envFilteredApps.map(app => {
                const isSelected = selectedAppId === app.id;
                const isHealthy = app.status === 'healthy';
                const isError = app.status === 'error';

                return (
                  <div
                    key={app.id}
                    className={`group relative p-2 rounded-lg text-xs cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border-indigo-500/50 shadow-xs'
                        : 'bg-white/40 dark:bg-neutral-800/30 hover:bg-white dark:hover:bg-neutral-800/70 border-transparent text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <button onClick={() => onSelectApp(app.id)} aria-label={`Select ${app.name}`} aria-pressed={isSelected}
                      title={app.stats.probeCount ? `${app.stats.probeCount} observed checks · ${app.stats.errorRatePercent.toFixed(1)}% failed · p95 ${app.stats.p95LatencyMs ?? 'unknown'}ms` : 'Awaiting a fresh health observation'}
                      className="w-full text-left rounded">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isError
                              ? 'bg-rose-500 animate-ping'
                              : isHealthy
                              ? 'bg-emerald-500'
                              : 'bg-neutral-400'
                          }`}
                        />
                        <span className="font-semibold truncate">{app.name}</span>
                        <span className="sr-only">{app.status === 'idle' ? 'Health unknown' : app.status}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="w-4 h-4 rounded flex items-center justify-center bg-neutral-200/70 dark:bg-neutral-700/60 text-neutral-700 dark:text-neutral-200">
                          {getProviderIcon(app.providerType)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
                      <span className="truncate">{app.status === 'idle' ? 'Awaiting a fresh check' : app.config.framework || 'Health checked'}</span>
                      <span className="capitalize text-[9px] px-1 rounded bg-neutral-200/60 dark:bg-neutral-700/40">
                        {app.environment}
                      </span>
                    </div>

                    </button>
                    <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 absolute right-2 top-2 flex items-center gap-1 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xs px-1 py-0.5 rounded shadow-xs transition-opacity">
                      <button onClick={event => { event.stopPropagation(); onEditApp(app); }} title={`Edit ${app.name}`} className="text-neutral-400 hover:text-indigo-500 p-0.5">
                        <Pencil className="w-3 h-3" />
                      </button>
                      {app.deploymentUrl && (
                        <a
                          href={app.deploymentUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-neutral-400 hover:text-indigo-500 p-0.5"
                          title="Open live app deployment"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {deletingAppId === app.id ? (
                        <div className="flex items-center gap-1 bg-white dark:bg-neutral-800 px-1 py-0.5 rounded shadow-sm">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onDeleteApp(app.id);
                              setDeletingAppId(null);
                            }}
                            className="text-[9px] font-mono text-rose-600 dark:text-rose-400 font-bold hover:underline px-1 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60"
                          >
                            Delete
                          </button>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setDeletingAppId(null);
                            }}
                            className="text-[9px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setDeletingAppId(app.id);
                          }}
                          className="text-neutral-400 hover:text-rose-500 p-0.5"
                          title="Delete application"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100/40 dark:bg-neutral-900/40">
        <div
          className="p-2.5 rounded-xl bg-white dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700/60 shadow-xs flex items-center gap-3 cursor-pointer group hover:border-indigo-400/40 transition-colors"
        >
          <div className="relative">
            <PixelCat mood={catMood} breed={catBreed} size="md" onPet={onPetCat} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">
                Byte (Log Cat)
              </span>
              <button
                onClick={e => {
                  e.stopPropagation();
                  onOpenCatCustomizer();
                }}
                className="text-neutral-400 hover:text-indigo-400 text-[10px]"
                title="Change cat breed"
              >
                <Sparkles className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
              {catMood === 'alert'
                ? '⚠️ Alerted by errors!'
                : catMood === 'typing'
                ? '⚡ Tapping on keyboard'
                : catMood === 'idle' ? 'Taking a little break' : '😺 Keeping an eye on logs'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};
