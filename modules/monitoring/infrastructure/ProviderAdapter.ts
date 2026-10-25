import type { Application, ProviderType } from '../../projects/domain/Project';
import type { IProviderAdapter, ProviderMetadata, ConnectionValidationResult } from '../domain/IProviderAdapter';
import type { LogEntry } from '../domain/LogEntry';
import type { DesktopBridge, ProviderTarget } from '../../../shared/desktop';
import { getDesktop } from '../../desktop/infrastructure/DesktopBridge';

const metadata: Record<ProviderType, ProviderMetadata> = {
  vercel: {
    id: 'vercel', name: 'Vercel', icon: '▲', status: 'active',
    description: 'Deployment status, build logs, live runtime logs and public URL health checks.',
    supportedSources: ['build', 'runtime', 'edge', 'serverless', 'probe'],
    docUrl: 'https://vercel.com/docs/deployments/logs',
    tokenGuideUrl: 'https://vercel.com/account/tokens',
  },
  netlify: {
    id: 'netlify', name: 'Netlify', icon: '◆', status: 'active',
    description: 'Deployment status, recent and live Function/Edge Function logs, and public URL health checks. Build logs stay in the Netlify dashboard.',
    supportedSources: ['build', 'runtime', 'edge', 'serverless', 'probe'],
    docUrl: 'https://docs.netlify.com/deploy/deploy-overview/',
    tokenGuideUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
  },
};

export class ProviderAdapter implements IProviderAdapter {
  constructor(private provider: ProviderType, private desktop: () => DesktopBridge = getDesktop) {}

  getProviderType(): ProviderType { return this.provider; }
  getMetadata(): ProviderMetadata { return metadata[this.provider]; }

  async validateCredentials(credentials: { apiToken?: string; credentialId?: string; vercelTeamId?: string }): Promise<ConnectionValidationResult> {
    const apiToken = credentials.apiToken?.trim();
    const credentialId = credentials.credentialId?.trim();
    if (!apiToken && !credentialId) return { valid: false, message: 'Enter a provider token or choose a saved token to discover applications.' };
    try {
      const detectedApps = await this.desktop().discover({
        provider: this.provider, teamId: credentials.vercelTeamId?.trim(),
        ...(credentialId ? { credentialId } : { apiToken: apiToken! }),
      });
      return { valid: true, detectedApps, message: `Found ${detectedApps.length} applications.` };
    } catch (error) {
      return { valid: false, message: error instanceof Error ? error.message : 'Could not connect to the provider.' };
    }
  }

  private entry(app: Application, fields: Partial<LogEntry> & Pick<LogEntry, 'source' | 'message' | 'level'>): LogEntry {
    return {
      id: crypto.randomUUID(),
      applicationId: app.id, applicationName: app.name, providerType: this.provider,
      timestamp: Date.now(), environment: app.environment, isRealTelemetry: true,
      ...fields,
    };
  }

  async triggerHealthProbe(app: Application, onLog: (entry: LogEntry) => void): Promise<void> {
    if (!app.deploymentUrl) return;
    try {
      const result = await this.desktop().probe(app.deploymentUrl);
      onLog(this.entry(app, {
        source: 'probe', monitorKind: 'health',
        level: result.success ? 'info' : result.statusCode >= 400 && result.statusCode < 500 ? 'warn' : 'error',
        observation: result.success ? 'healthy' : 'unhealthy',
        message: `GET ${app.deploymentUrl} → ${result.statusCode || 'connection failed'} in ${result.latencyMs}ms${result.error ? `: ${result.error}` : ''}`,
        statusCode: result.statusCode || undefined,
        latencyMs: result.latencyMs, region: result.region, timestamp: result.timestamp,
        method: 'GET', path: new URL(app.deploymentUrl).pathname, host: new URL(app.deploymentUrl).host,
        payload: { cacheStatus: result.cacheStatus, server: result.server, headers: result.headers },
      }));
    } catch (error) {
      onLog(this.entry(app, {
        source: 'probe', monitorKind: 'health', level: 'warn', observation: 'unknown',
        message: `Health check unavailable: ${error instanceof Error ? error.message : 'Unexpected error.'}`,
      }));
    }
  }

  private target(app: Application): ProviderTarget {
    const targetId = this.provider === 'vercel' ? app.config.vercelProjectId : app.config.netlifySiteId;
    if (!targetId || !app.config.credentialId) throw new Error('Connect a provider account to sync deployments.');
    return {
      provider: this.provider, targetId, credentialId: app.config.credentialId,
      teamId: app.config.vercelTeamId, environment: app.environment,
    };
  }

  async checkDeploymentStatus(app: Application, onLog: (entry: LogEntry) => void): Promise<void> {
    if (app.config.connectionMode !== 'account') return;
    try {
      const target = this.target(app);
      const latest = (await this.desktop().deployments(target))[0];
      if (!latest) {
        onLog(this.entry(app, { source: 'build', level: 'info', observation: 'unknown', message: 'No deployments found for this application.' }));
        return;
      }
      const failed = ['error', 'failed'].includes(latest.state);
      const ready = ['ready', 'current'].includes(latest.state);
      onLog(this.entry(app, {
        id: `${app.id}:deployment:${latest.id}:${latest.state}`,
        source: 'build', monitorKind: 'deployment', level: failed ? 'error' : 'info',
        observation: failed ? 'unhealthy' : ready ? 'healthy' : 'unknown',
        message: `Deployment ${latest.id}: ${latest.state.toUpperCase()}${latest.commit ? ` · ${latest.commit.slice(0, 7)}` : ''}`,
        payload: { deploymentId: latest.id, state: latest.state, url: latest.url },
      }));
      if (this.provider === 'netlify') return;
      try {
        const buildEvents = await this.desktop().events({ ...target, deploymentId: latest.id });
        for (const event of buildEvents) {
          onLog(this.entry(app, {
            id: `${app.id}:build:${event.id}`, source: 'build', level: event.level,
            timestamp: event.timestamp || latest.createdAt,
            message: event.message,
          }));
        }
      } catch (error) {
        onLog(this.entry(app, {
          id: `${app.id}:build-unavailable:${latest.id}`, source: 'build', level: 'warn',
          message: `Build log access unavailable: ${error instanceof Error ? error.message : 'Not supported by this provider.'}`,
        }));
      }
    } catch (error) {
      onLog(this.entry(app, {
        source: 'build', monitorKind: 'deployment', level: 'warn', observation: 'unknown',
        message: `Deployment sync failed: ${error instanceof Error ? error.message : 'Unexpected error.'}`,
      }));
    }
  }

  subscribeLogs(app: Application, onLog: (entry: LogEntry) => void): () => void {
    let active = true;
    let runtimeStop: (() => void) | undefined;
    let runtimeDeploymentId: string | null = null;
    let runtimeGeneration = 0;
    let historyStop: (() => void) | undefined;
    let historyLoading = false;
    let historyLoaded = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const emit = (entry: LogEntry) => { if (active) onLog(entry); };
    const stopRuntime = () => {
      runtimeGeneration++;
      runtimeStop?.();
      runtimeStop = undefined;
    };
    const runtimeWarning = (message: string) => emit(this.entry(app, {
      id: `${app.id}:runtime-unavailable:${message}`,
      source: 'runtime', level: 'warn', message,
    }));
    const loadHistory = () => {
      if (historyLoaded || historyLoading) return;
      try {
        historyLoading = true;
        historyStop = this.desktop().loadRuntimeHistory(this.target(app), history => {
          if (!active) return;
          historyLoaded = !history.retry;
          historyLoading = false;
          for (const event of history.events) {
            const { id, deploymentId, messageTruncated, logs, functionName, requestId, ...fields } = event;
            emit(this.entry(app, {
              ...fields, id: `${app.id}:runtime:${deploymentId}:${id}`, requestId: requestId || (this.provider === 'vercel' ? id : undefined),
              payload: {
                deploymentId, messageTruncated, historical: true, logs,
                ...(functionName ? { functionName, requestId, requestPath: fields.path } : {}),
              },
            }));
          }
          history.warnings?.forEach(runtimeWarning);
          if (history.truncated) runtimeWarning('Runtime history was limited to the latest 1,000 entries or the provider query limit. Some logs from the past hour may be missing.');
        }, message => {
          if (!active) return;
          historyLoading = false;
          runtimeWarning(`Runtime history unavailable: ${message} Retrying automatically. Live runtime logs connect independently.`);
        });
      } catch (error) {
        historyLoading = false;
        runtimeWarning(`Runtime history unavailable: ${error instanceof Error ? error.message : 'Unexpected error.'} Retrying automatically.`);
      }
    };
    const syncRuntime = async () => {
      loadHistory();
      try {
        const target = this.target(app);
        const deploymentId = await this.desktop().runtimeDeployment(target);
        if (!active) return;
        if (!deploymentId) {
          stopRuntime();
          runtimeDeploymentId = null;
          runtimeWarning(`No ${app.environment} deployment available for live runtime logs.`);
          return;
        }
        if (runtimeStop && runtimeDeploymentId === deploymentId) return;
        stopRuntime();
        runtimeDeploymentId = deploymentId;
        const version = runtimeGeneration;
        runtimeStop = this.desktop().subscribeRuntimeLogs({ ...target, deploymentId }, event => {
          if (!active || version !== runtimeGeneration) return;
          const { id, messageTruncated, functionName, ...fields } = event;
          emit(this.entry(app, {
            ...fields, id: `${app.id}:runtime:${deploymentId}:${id}`,
            payload: {
              deploymentId, messageTruncated,
              ...(functionName ? { functionName, requestId: fields.requestId, requestPath: fields.path } : {}),
            },
          }));
        }, message => {
          if (!active || version !== runtimeGeneration) return;
          stopRuntime();
          runtimeWarning(`Runtime log access unavailable: ${message} Retrying automatically.`);
        });
        emit(this.entry(app, {
          id: `${app.id}:runtime-following:${deploymentId}`,
          source: 'runtime', level: 'info',
          message: `Connecting to live runtime logs for deployment ${deploymentId}. Waiting for new requests or console output.`,
          payload: { deploymentId },
        }));
      } catch (error) {
        runtimeWarning(`Runtime deployment selection failed: ${error instanceof Error ? error.message : 'Unexpected error.'} Retrying automatically.`);
      }
    };
    const schedule = (action: () => Promise<void>, delay: number) => {
      const run = async () => {
        if (!active) return;
        await action();
        if (active) {
          const timer = setTimeout(() => { timers.delete(timer); void run(); }, delay);
          timers.add(timer);
        }
      };
      void run();
    };
    if (app.deploymentUrl) schedule(() => this.triggerHealthProbe(app, emit), 15000);
    if (app.config.connectionMode === 'account') schedule(() => this.checkDeploymentStatus(app, emit), 30000);
    if (app.config.connectionMode === 'account') {
      if (app.environment === 'development') {
        runtimeWarning(`${metadata[this.provider].name} runtime logs require a production or preview deployment, not local development.`);
      } else schedule(syncRuntime, 30000);
    }
    return () => {
      active = false;
      historyStop?.();
      stopRuntime();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }
}
