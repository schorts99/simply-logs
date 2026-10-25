import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '../modules/desktop/application/ThemeContext';
import type { Project, Application, Environment } from '../modules/projects/domain/Project';
import type { LogEntry } from '../modules/monitoring/domain/LogEntry';
import { projectRepository } from '../modules/projects/infrastructure/LocalStorageProjectRepository';
import { logStreamService } from '../modules/monitoring/application/LogStreamService';
import { CatBreedStorage } from '../modules/companion/infrastructure/CatBreedStorage';
import { companionService } from '../modules/companion/application/CompanionService';
import { notificationService } from '../modules/notifications/application/NotificationService';
import type { CatBreed } from '../modules/companion/domain/CatTypes';
import { getDesktop } from '../modules/desktop/infrastructure/DesktopBridge';
import { WindowChrome } from '../modules/desktop/presentation/WindowChrome';
import { StatusBar } from '../modules/desktop/presentation/StatusBar';
import { ProjectSidebar } from '../modules/projects/presentation/ProjectSidebar';
import { LogStreamViewer } from '../modules/monitoring/presentation/LogStreamViewer';
import { AddApplicationModal } from '../modules/projects/presentation/AddApplicationModal';
import { CreateProjectModal } from '../modules/projects/presentation/CreateProjectModal';
import { CatCustomizerModal } from '../modules/companion/presentation/CatCustomizerModal';
import { LogDetailModal } from '../modules/monitoring/presentation/LogDetailModal';
import { NotificationCenterModal } from '../modules/notifications/presentation/NotificationCenterModal';
import { NotificationToast } from '../modules/notifications/presentation/NotificationToast';
import { FolderPlus, Plus, X } from 'lucide-react';
import { percentile95, scopeLogs } from '../modules/monitoring/application/metrics';

function message(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Please try again.';
}

function MainApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const selectedProject = projects.find(project => project.id === projectId) || null;
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [activeEnv, setActiveEnv] = useState<Environment | 'all'>('all');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [loadingApps, setLoadingApps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'probe' | 'deployments' | null>(null);
  const [appModal, setAppModal] = useState<Application | 'new' | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [unread, setUnread] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(notificationService.getSettings().soundAlerts);
  const [catBreed, setCatBreed] = useState<CatBreed>(() => CatBreedStorage.getBreed());
  const [catHappyUntil, setCatHappyUntil] = useState(0);

  useEffect(() => {
    let canceled = false;
    Promise.all([projectRepository.getProjects(), projectRepository.getApplications()]).then(([items, apps]) => {
      if (canceled) return;
      logStreamService.retainApplications(apps.map(app => app.id));
      setProjects(items);
      setProjectId(items[0]?.id || null);
    }).catch(cause => { if (!canceled) setError(message(cause)); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    const unsub = logStreamService.subscribe(setLogs);
    const entries = logStreamService.subscribeEntries(entry => {
      notificationService.processLogEntry(entry);
      if (!entry.monitorKind) return;
      setApplications(items => items.map(app => {
        if (app.id !== entry.applicationId) return app;
        if (entry.monitorKind === 'deployment' && app.deploymentUrl) return app;
        const probes = logStreamService.getLogs().filter(log => log.applicationId === app.id && log.source === 'probe' && log.observation !== 'unknown').slice(-50);
        const latency = probes.flatMap(log => log.latencyMs === undefined ? [] : [log.latencyMs]);
        return {
          ...app,
          status: entry.observation === 'healthy' ? 'healthy' : entry.observation === 'unhealthy' ? 'error' : 'idle',
          stats: {
            probeCount: probes.length,
            errorRatePercent: probes.length ? probes.filter(log => log.observation === 'unhealthy').length / probes.length * 100 : 0,
            p95LatencyMs: percentile95(latency),
            lastUpdated: Date.now(),
          },
        };
      }));
    });
    const notifications = notificationService.subscribe(items => setUnread(items.filter(item => !item.read).length));
    const settings = notificationService.subscribeSettings(value => setSoundEnabled(value.soundAlerts));
    const historyErrors = logStreamService.subscribeStorageErrors(setHistoryError);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub(); entries(); notifications(); settings(); historyErrors(); clearInterval(timer); logStreamService.dispose();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    setApplications([]);
    setSelectedAppId(null);
    setSelectedLog(null);
    logStreamService.syncApplications([]);
    notificationService.syncApplications([]);
    if (!projectId) return;
    setLoadingApps(true);
    projectRepository.getApplications(projectId).then(items => {
      if (canceled) return;
      setApplications(items);
      notificationService.syncApplications(items.map(app => app.id));
      logStreamService.syncApplications(items);
    }).catch(cause => { if (!canceled) setError(message(cause)); })
      .finally(() => { if (!canceled) setLoadingApps(false); });
    return () => { canceled = true; };
  }, [projectId]);

  const currentApplications = applications.filter(app => app.projectId === projectId);
  const activeApp = currentApplications.find(app => app.id === selectedAppId) || null;
  const visibleApps = currentApplications.filter(app => activeEnv === 'all' || app.environment === activeEnv);
  const scopedLogs = useMemo(() => scopeLogs(logs, applications.filter(app => app.projectId === projectId), activeEnv, selectedAppId), [logs, applications, projectId, activeEnv, selectedAppId]);
  const logsPerSec = scopedLogs.filter(log => !log.payload?.historical && now - log.timestamp < 3000).length / 3;
  const recentError = scopedLogs.some(log => log.observation === 'unhealthy' && now - log.timestamp < 6000);
  const catMood = companionService.calculateMood(isStreaming && visibleApps.length > 0, logsPerSec, recentError, catHappyUntil);
  const handlePet = useCallback(() => setCatHappyUntil(companionService.pet(notificationService.getSettings().soundAlerts)), []);
  const toggleStreaming = useCallback(() => {
    const next = !logStreamService.getStreaming();
    logStreamService.setStreaming(next);
    setIsStreaming(next);
    setApplications(items => items.map(app => ({ ...app, status: 'idle' })));
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="dialog"]')) return;
      if (event.code === 'Space') { event.preventDefault(); toggleStreaming(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleStreaming]);

  const refreshApps = async () => {
    if (!projectId) return;
    const allApps = await projectRepository.getApplications();
    logStreamService.retainApplications(allApps.map(app => app.id));
    const items = allApps.filter(app => app.projectId === projectId);
    setApplications(items);
    notificationService.syncApplications(items.map(app => app.id));
    logStreamService.syncApplications(items);
  };

  const saveApplication = async (app: Application, token?: string) => {
    const previousCredential = applications.find(item => item.id === app.id)?.config.credentialId;
    let newCredential: string | undefined;
    if (token) {
      newCredential = crypto.randomUUID();
      const saved = await getDesktop().saveCredential(newCredential, token);
      app.config.credentialId = newCredential;
      if (!saved.persistent) setNotice('Your OS keychain is unavailable. The token is kept only for this session; reconnect after restarting. Enable your system keychain to save it securely.');
    }
    try {
      await projectRepository.saveApplication(app);
    } catch (cause) {
      if (newCredential) {
        try { await getDesktop().deleteCredential(newCredential); } catch { setNotice('A credential was saved but application storage failed. Check available disk space before retrying.'); }
      }
      throw cause;
    }
    if (previousCredential && previousCredential !== app.config.credentialId) {
      try {
        const allApps = await projectRepository.getApplications();
        if (!allApps.some(item => item.config.credentialId === previousCredential)) {
          await getDesktop().deleteCredential(previousCredential);
        }
      }
      catch { setNotice('Application saved, but its previous credential could not be removed from the local vault. Check storage access.'); }
    }
    await refreshApps();
    setActiveEnv('all');
    setSelectedAppId(app.id);
    setNotice(previous => previous || `${app.name} is ready. Only observed telemetry will appear.`);
  };

  const deleteApp = async (id: string) => {
    try { await projectRepository.deleteApplication(id); }
    catch (cause) { setError(message(cause)); }
    finally {
      try { await refreshApps(); } catch (cause) { setError(message(cause)); }
      setSelectedAppId(previous => previous === id ? null : previous);
    }
  };

  const createProject = async (project: Project) => {
    await projectRepository.saveProject(project);
    setProjects(await projectRepository.getProjects());
    setProjectId(project.id);
    setActiveEnv('all');
  };

  const deleteProject = async () => {
    if (!selectedProject || !window.confirm(`Delete "${selectedProject.name}" and all its applications? This cannot be undone.`)) return;
    try { await projectRepository.deleteProject(selectedProject.id); }
    catch (cause) { setError(message(cause)); }
    finally {
      try {
        const [items, apps] = await Promise.all([projectRepository.getProjects(), projectRepository.getApplications()]);
        logStreamService.retainApplications(apps.map(app => app.id));
        setProjects(items); setProjectId(items[0]?.id || null);
      } catch (cause) { setError(message(cause)); }
    }
  };

  const runAction = async (action: 'probe' | 'deployments') => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      if (action === 'probe') await logStreamService.runHealthProbe(visibleApps, selectedAppId || undefined);
      else await logStreamService.syncDeployments(visibleApps, selectedAppId || undefined);
    } catch (cause) { setError(message(cause)); }
    finally { setBusyAction(null); }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 font-sans overflow-hidden">
      <WindowChrome projects={projects} selectedProject={selectedProject}
        onSelectProject={project => { setProjectId(project.id); setActiveEnv('all'); }}
        onOpenCreateProject={() => setCreateProjectOpen(true)} onDeleteProject={() => void deleteProject()}
        applications={currentApplications} activeLogMood={catMood} catBreed={catBreed} onPetCat={handlePet}
        onOpenCatCustomizer={() => setCustomizerOpen(true)} unreadNotificationCount={unread} onOpenNotifications={() => setNotificationsOpen(true)} />
      {(error || historyError || notice || !window.simplyLogs) && (
        <div role={error || historyError ? 'alert' : 'status'} className={`px-4 py-2 text-xs flex justify-between gap-3 ${error || historyError ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300' : 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'}`}>
          <span>{error || historyError || notice || 'UI preview only. Run npm run dev or install Simply Logs to connect applications.'}</span>
          {(error || notice) && <button aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}><X className="w-3.5 h-3.5" /></button>}
        </div>
      )}
      {loading ? (
        <main role="status" className="flex-1 grid place-items-center text-sm text-neutral-500">Opening your workspace…</main>
      ) : !selectedProject ? (
        <main className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
          <img src="./icon.svg" alt="Cat with terminal log lines" className="w-24 h-24" />
          <div><h2 className="text-2xl font-semibold">Less noise. More peace of mind.</h2>
            <p className="text-sm text-neutral-500 mt-3 max-w-md">Group your applications, follow deployment logs, and check live health. No demo traffic, no invented incidents. Just your services and a cat on watch.</p></div>
          <button onClick={() => setCreateProjectOpen(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium"><FolderPlus className="w-4 h-4" /> Create your first project</button>
          <p className="text-xs text-neutral-500">Tokens stay on your device. Monitoring runs while Simply Logs is open.</p>
        </main>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <ProjectSidebar currentProject={selectedProject} applications={currentApplications} selectedAppId={selectedAppId}
            onSelectApp={setSelectedAppId} onOpenAddAppModal={() => setAppModal('new')} onEditApp={setAppModal}
            onOpenCreateProjectModal={() => setCreateProjectOpen(true)} onDeleteApp={id => void deleteApp(id)}
            catMood={catMood} catBreed={catBreed} onPetCat={handlePet} onOpenCatCustomizer={() => setCustomizerOpen(true)}
            activeEnv={activeEnv} onSelectEnv={environment => { setActiveEnv(environment); setSelectedAppId(null); setSelectedLog(null); }} />
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            {loadingApps ? <div role="status" className="flex-1 grid place-items-center text-neutral-500 text-sm">Loading applications…</div> : currentApplications.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
                <img src="./icon.svg" alt="" className="w-16 h-16 opacity-80" />
                <h2 className="text-lg font-semibold">Give your cat something to watch</h2>
                <p className="text-sm text-neutral-500 max-w-sm">Connect Vercel or Netlify for deployments, or monitor a public HTTPS URL. Real checks start as soon as you add an application.</p>
                <button onClick={() => setAppModal('new')} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" /> Add your first application</button>
              </div>
            ) : <LogStreamViewer logs={scopedLogs} isStreaming={isStreaming} onToggleStreaming={toggleStreaming}
              onClearLogs={() => logStreamService.clearLogs()} activeApp={activeApp}
              onRunHealthProbe={() => void runAction('probe')} onSyncDeployments={() => void runAction('deployments')}
              canProbe={(activeApp ? [activeApp] : visibleApps).some(app => Boolean(app.deploymentUrl))}
              canSync={(activeApp ? [activeApp] : visibleApps).some(app => app.config.connectionMode === 'account')}
              busyAction={busyAction} onSelectLog={setSelectedLog} onError={cause => setError(message(cause))} />}
          </main>
        </div>
      )}
      <StatusBar isStreaming={isStreaming} logCount={scopedLogs.length} logsPerSec={logsPerSec} activeApp={activeApp}
        soundEnabled={soundEnabled} onToggleSound={() => notificationService.updateSettings({ soundAlerts: !soundEnabled })}
        errorCount={scopedLogs.filter(log => log.level === 'error').length} applicationCount={visibleApps.length}
        activeEnv={activeEnv} unreadNotificationCount={unread} onOpenNotifications={() => setNotificationsOpen(true)} />
      <NotificationToast />
      {selectedProject && appModal && <AddApplicationModal key={appModal === 'new' ? 'new' : appModal.id}
        projectId={selectedProject.id} application={appModal === 'new' ? undefined : appModal}
        onClose={() => setAppModal(null)} onAddApplication={saveApplication} />}
      {createProjectOpen && <CreateProjectModal isOpen onClose={() => setCreateProjectOpen(false)} onCreateProject={createProject} />}
      <CatCustomizerModal isOpen={customizerOpen} currentBreed={catBreed} onSelectBreed={breed => { setCatBreed(breed); CatBreedStorage.setBreed(breed); }}
        onClose={() => setCustomizerOpen(false)} onPet={handlePet} />
      <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
      <NotificationCenterModal isOpen={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}

export default function App() { return <ThemeProvider><MainApp /></ThemeProvider>; }
