export type Provider = 'vercel' | 'netlify';

export interface DiscoveredApplication {
  name: string;
  slug: string;
  framework?: string;
  deploymentUrl?: string;
  projectId?: string;
  siteId?: string;
}

export interface ProviderTarget {
  provider: Provider;
  targetId: string;
  credentialId: string;
  teamId?: string;
}

export interface Deployment {
  id: string;
  state: string;
  url?: string;
  commit?: string;
  createdAt: number;
}

export interface BuildEvent {
  id: string;
  timestamp: number;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface ProbeResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  region: string;
  server: string;
  cacheStatus: string;
  headers: Record<string, string>;
  timestamp: number;
  error?: string;
}

export interface DesktopBridge {
  platform: string;
  discover(input: { provider: Provider; apiToken: string; teamId?: string }): Promise<DiscoveredApplication[]>;
  deployments(input: ProviderTarget): Promise<Deployment[]>;
  events(input: ProviderTarget & { deploymentId: string }): Promise<BuildEvent[]>;
  probe(url: string): Promise<ProbeResult>;
  saveCredential(id: string, token: string): Promise<{ persistent: boolean }>;
  deleteCredential(id: string): Promise<void>;
  notify(title: string, body: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  exportLogs(json: string): Promise<boolean>;
}

declare global {
  interface Window {
    simplyLogs?: DesktopBridge;
  }
}
