import type { Application } from '../modules/projects/domain/Project';
import type { LogEntry } from '../modules/monitoring/domain/LogEntry';
import type { DesktopBridge } from '../shared/desktop';

export function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-one', projectId: 'project-one', name: 'My app', slug: 'my-app', providerType: 'vercel',
    environment: 'production', deploymentUrl: 'https://example.com', status: 'idle', createdAt: 1000,
    config: { connectionMode: 'url' },
    stats: { probeCount: 0, errorRatePercent: 0, p95LatencyMs: null, lastUpdated: 0 },
    ...overrides,
  };
}

export function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: crypto.randomUUID(), applicationId: 'app-one', applicationName: 'My app', providerType: 'vercel',
    timestamp: Date.now(), environment: 'production', source: 'probe', level: 'info', message: 'Healthy',
    monitorKind: 'health', observation: 'healthy', isRealTelemetry: true, statusCode: 200, latencyMs: 20,
    ...overrides,
  };
}

export function desktop(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    platform: 'linux',
    discover: async () => [],
    deployments: async () => [],
    events: async () => [],
    runtimeDeployment: async () => null,
    loadRuntimeHistory: (_input, onHistory) => { queueMicrotask(() => onHistory({ events: [], truncated: false })); return () => {}; },
    subscribeRuntimeLogs: () => () => {},
    probe: async () => ({
      success: true, statusCode: 200, latencyMs: 20, region: 'iad1', server: 'Vercel',
      cacheStatus: 'MISS', headers: {}, timestamp: Date.now(),
    }),
    saveCredential: async () => ({ persistent: true }),
    deleteCredential: async () => {},
    notify: async () => true,
    copyText: async () => {},
    exportLogs: async () => true,
    ...overrides,
  };
}
