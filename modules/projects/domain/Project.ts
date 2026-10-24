/**
 * Domain Models for Projects & Applications (Vertical Slice: Projects)
 */

export type ProviderType = 'vercel' | 'netlify';
export type Environment = 'production' | 'preview' | 'development';
export type ServiceHealth = 'healthy' | 'warning' | 'error' | 'deploying' | 'idle';

export interface ApplicationStats {
  probeCount: number;
  errorRatePercent: number;
  p95LatencyMs: number | null;
  lastUpdated: number;
}

export interface Application {
  id: string;
  projectId: string;
  providerType: ProviderType;
  name: string;
  slug: string;
  environment: Environment;
  deploymentUrl?: string;
  branch?: string;
  status: ServiceHealth;
  stats: ApplicationStats;
  createdAt: number;
  config: {
    vercelProjectId?: string;
    vercelTeamId?: string;
    netlifySiteId?: string;
    credentialId?: string;
    connectionMode: 'account' | 'url';
    framework?: string;
    region?: string;
  };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  tags: string[];
  createdAt: number;
}

export interface IProjectRepository {
  getProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<void>;
  deleteProject(projectId: string): Promise<void>;

  getApplications(projectId?: string): Promise<Application[]>;
  saveApplication(application: Application): Promise<void>;
  deleteApplication(applicationId: string): Promise<void>;
}
