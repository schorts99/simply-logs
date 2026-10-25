import { Application, ProviderType } from '@/modules/projects/domain/Project';
import { LogEntry } from './LogEntry';
import type { DiscoveredApplication } from '../../../shared/desktop';

export interface ProviderMetadata {
  id: ProviderType;
  name: string;
  description: string;
  icon: string;
  status: 'active';
  supportedSources: string[];
  docUrl: string;
  tokenGuideUrl: string;
}

export interface ConnectionValidationResult {
  valid: boolean;
  message?: string;
  detectedApps?: DiscoveredApplication[];
}

export interface IProviderAdapter {
  getProviderType(): ProviderType;
  getMetadata(): ProviderMetadata;
  validateCredentials(credentials: { apiToken?: string; credentialId?: string; vercelTeamId?: string }): Promise<ConnectionValidationResult>;
  subscribeLogs(
    app: Application,
    onLog: (entry: LogEntry) => void
  ): () => void;
  triggerHealthProbe?(
    app: Application,
    onLog: (entry: LogEntry) => void
  ): Promise<void>;
  checkDeploymentStatus?(
    app: Application,
    onLog: (entry: LogEntry) => void
  ): Promise<void>;
}
