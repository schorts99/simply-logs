import { Environment, ProviderType } from '@/modules/projects/domain/Project';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogSource = 'runtime' | 'edge' | 'build' | 'serverless' | 'probe';

export interface LogEntry {
  id: string;
  applicationId: string;
  applicationName: string;
  providerType: ProviderType;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  statusCode?: number;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  path?: string;
  latencyMs?: number;
  region?: string;
  host?: string;
  requestId?: string;
  environment: Environment;
  payload?: Record<string, any>;
  stackTrace?: string;
  isRealTelemetry?: boolean;
  observation?: 'healthy' | 'unhealthy' | 'unknown';
  monitorKind?: 'health' | 'deployment';
}

export interface LogFilter {
  query?: string;
  levels?: LogLevel[];
  sources?: LogSource[];
  environment?: Environment | 'all';
  startTime?: number;
  endTime?: number;
  statusCodePrefix?: string;
}
