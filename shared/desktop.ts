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
  environment?: 'production' | 'preview' | 'development';
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

export interface RuntimeEvent {
  id: string;
  timestamp: number;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: 'runtime' | 'edge' | 'serverless';
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  path?: string;
  host?: string;
  statusCode?: number;
  messageTruncated: boolean;
}

export interface RuntimeLogMessage {
  level: string;
  message: string;
  messageTruncated: boolean;
}

export interface RuntimeHistoryEvent extends RuntimeEvent {
  deploymentId: string;
  logs: RuntimeLogMessage[];
}

export interface RuntimeHistory {
  events: RuntimeHistoryEvent[];
  truncated: boolean;
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
  runtimeDeployment(input: ProviderTarget): Promise<string | null>;
  loadRuntimeHistory(
    input: ProviderTarget,
    onHistory: (history: RuntimeHistory) => void,
    onError: (message: string) => void,
  ): () => void;
  subscribeRuntimeLogs(
    input: ProviderTarget & { deploymentId: string },
    onLog: (event: RuntimeEvent) => void,
    onError: (message: string) => void,
  ): () => void;
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
