import type { IProjectRepository, Project, Application } from '../domain/Project';
import { getDesktop } from '../../desktop/infrastructure/DesktopBridge';

const PROJECTS = 'simply_logs_projects_v1';
const APPS = 'simply_logs_apps_v1';
const demoApps = new Set(['app_vercel_storefront', 'app_netlify_portal', 'app_vercel_edge_auth']);
const demoProjects = new Set(['proj_ecommerce', 'proj_saas_platform']);

function read<T>(key: string, legacyKey: string): T[] {
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) {
      throw new Error('Invalid data format.');
    }
    return value;
  } catch {
    throw new Error('Saved project data could not be read. It has not been overwritten. Check storage access or restore a backup.');
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Changes could not be saved. Storage may be full or unavailable.');
  }
}

export class LocalStorageProjectRepository implements IProjectRepository {
  async getProjects(): Promise<Project[]> {
    const projects = read<Project>(PROJECTS, 'purrpulse_infra_projects_v2');
    if (projects.some(project => typeof project.name !== 'string' || !project.name.trim() ||
      typeof project.description !== 'string' || !/^#[0-9a-f]{6}$/i.test(project.color) ||
      !Array.isArray(project.tags) || project.tags.some(tag => typeof tag !== 'string') ||
      !Number.isFinite(project.createdAt))) {
      throw new Error('A saved project has an invalid format. Your data has not been overwritten.');
    }
    const apps = read<Application>(APPS, 'purrpulse_infra_apps_v2').filter(app => !demoApps.has(app.id));
    return projects.filter(project => !demoProjects.has(project.id) || apps.some(app => app.projectId === project.id));
  }

  async saveProject(project: Project): Promise<void> {
    const list = await this.getProjects();
    const index = list.findIndex(item => item.id === project.id);
    if (index >= 0) list[index] = project;
    else list.push(project);
    write(PROJECTS, list);
  }

  async deleteProject(projectId: string): Promise<void> {
    const apps = await this.getApplications();
    const projects = await this.getProjects();
    const removed = apps.filter(app => app.projectId === projectId);
    const remaining = apps.filter(app => app.projectId !== projectId);
    // Save applications first: an interrupted deletion leaves a recoverable empty project.
    write(APPS, remaining);
    write(PROJECTS, projects.filter(project => project.id !== projectId));
    for (const credentialId of new Set(removed.map(app => app.config.credentialId))) {
      if (credentialId && !remaining.some(app => app.config.credentialId === credentialId)) {
        await getDesktop().deleteCredential(credentialId);
      }
    }
  }

  async getApplications(projectId?: string): Promise<Application[]> {
    const raw = read<Application & { config: Application['config'] & { apiToken?: string; useRealApi?: boolean } }>(APPS, 'purrpulse_infra_apps_v2');
    const apps = raw.filter(app => !demoApps.has(app.id));
    let migrated = false;
    for (const app of apps) {
      if (!app.config || typeof app.config !== 'object' || Array.isArray(app.config) ||
        typeof app.projectId !== 'string' || typeof app.name !== 'string' || !app.name.trim() ||
        typeof app.slug !== 'string' || !['vercel', 'netlify'].includes(app.providerType) ||
        !['production', 'preview', 'development'].includes(app.environment) ||
        (app.deploymentUrl !== undefined && typeof app.deploymentUrl !== 'string') ||
        (app.config.connectionMode !== undefined && !['account', 'url'].includes(app.config.connectionMode)) ||
        (app.config.framework !== undefined && typeof app.config.framework !== 'string') ||
        (app.config.credentialId !== undefined && typeof app.config.credentialId !== 'string')) {
        throw new Error('A saved application has an invalid format. Your data has not been overwritten.');
      }
      if (app.config.apiToken) {
        await getDesktop().saveCredential(app.id, app.config.apiToken);
        app.config.credentialId = app.id;
        delete app.config.apiToken;
        migrated = true;
      }
      if (!app.config.connectionMode) {
        app.config.connectionMode = app.config.credentialId ? 'account' : 'url';
        delete app.config.useRealApi;
        migrated = true;
      }
      app.status = 'idle';
      app.stats = { probeCount: 0, errorRatePercent: 0, p95LatencyMs: null, lastUpdated: 0 };
    }
    if (migrated) {
      write(APPS, apps);
      try { localStorage.removeItem('purrpulse_infra_apps_v2'); } catch {}
    }
    return apps.filter(app => !projectId || app.projectId === projectId);
  }

  async saveApplication(application: Application): Promise<void> {
    const apps = await this.getApplications();
    const index = apps.findIndex(app => app.id === application.id);
    if (index >= 0) apps[index] = application;
    else apps.push(application);
    write(APPS, apps);
  }

  async deleteApplication(applicationId: string): Promise<void> {
    const apps = await this.getApplications();
    const removed = apps.find(app => app.id === applicationId);
    const remaining = apps.filter(app => app.id !== applicationId);
    write(APPS, remaining);
    const credentialId = removed?.config.credentialId;
    if (credentialId && !remaining.some(app => app.config.credentialId === credentialId)) {
      await getDesktop().deleteCredential(credentialId);
    }
  }

}

export const projectRepository = new LocalStorageProjectRepository();
