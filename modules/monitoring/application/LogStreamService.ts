import type { Application } from '../../projects/domain/Project';
import type { LogEntry } from '../domain/LogEntry';
import { providerRegistry } from '../infrastructure/ProviderRegistry';
import type { ProviderRegistry } from '../infrastructure/ProviderRegistry';

export class LogStreamService {
  private logs: LogEntry[] = [];
  private listeners = new Set<(logs: LogEntry[]) => void>();
  private entryListeners = new Set<(entry: LogEntry) => void>();
  private unsubs = new Map<string, () => void>();
  private applications: Application[] = [];
  private isStreaming = true;
  private recentLogTimestamps: number[] = [];
  private seenIds = new Set<string>();
  private generation = 0;

  constructor(private registry: Pick<ProviderRegistry, 'getAdapter'> = providerRegistry) {}

  subscribe(listener: (logs: LogEntry[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.logs);
    return () => { this.listeners.delete(listener); };
  }

  subscribeEntries(listener: (entry: LogEntry) => void): () => void {
    this.entryListeners.add(listener);
    return () => { this.entryListeners.delete(listener); };
  }

  getLogs(): LogEntry[] { return [...this.logs]; }
  getStreaming(): boolean { return this.isStreaming; }

  clearLogs(): void {
    this.logs = [];
    this.recentLogTimestamps = [];
    // Keep the bounded deduplication cache so clearing does not replay old build logs.
    this.notify();
  }

  private stop(): void {
    this.generation++;
    this.unsubs.forEach(unsub => unsub());
    this.unsubs.clear();
  }

  setStreaming(streaming: boolean): void {
    if (this.isStreaming === streaming) return;
    this.isStreaming = streaming;
    this.stop();
    this.recentLogTimestamps = [];
    if (streaming) this.start();
  }

  syncApplications(apps: Application[]): void {
    this.stop();
    this.applications = [...apps];
    const ids = new Set(apps.map(app => app.id));
    this.logs = this.logs.filter(log => ids.has(log.applicationId));
    this.seenIds = new Set(this.logs.map(log => log.id));
    this.recentLogTimestamps = [];
    this.notify();
    if (this.isStreaming) this.start();
  }

  private start(): void {
    const generation = this.generation;
    for (const app of this.applications) {
      const unsubscribe = this.registry.getAdapter(app.providerType).subscribeLogs(app, entry => {
        if (generation === this.generation && this.isStreaming) this.addLog(entry);
      });
      this.unsubs.set(app.id, unsubscribe);
    }
  }

  private async run(action: 'triggerHealthProbe' | 'checkDeploymentStatus', apps: Application[], targetAppId?: string): Promise<void> {
    if (!this.isStreaming) throw new Error('Resume monitoring before running a check.');
    const generation = this.generation;
    const allowed = new Set(this.applications.map(app => app.id));
    const targets = apps.filter(app => allowed.has(app.id) && (!targetAppId || app.id === targetAppId));
    await Promise.all(targets.map(async app => {
      const adapter = this.registry.getAdapter(app.providerType);
      await adapter[action]?.(app, entry => {
        if (generation === this.generation && this.isStreaming) this.addLog(entry);
      });
    }));
  }

  runHealthProbe(apps: Application[], targetAppId?: string): Promise<void> {
    return this.run('triggerHealthProbe', apps, targetAppId);
  }

  syncDeployments(apps: Application[], targetAppId?: string): Promise<void> {
    return this.run('checkDeploymentStatus', apps, targetAppId);
  }

  addLog(entry: LogEntry): void {
    if (this.seenIds.has(entry.id)) {
      // A repeated healthy deployment is still a fresh observation for incident recovery.
      if (entry.observation) this.entryListeners.forEach(listener => listener(entry));
      return;
    }
    this.seenIds.add(entry.id);
    if (this.seenIds.size > 5000) this.seenIds.delete(this.seenIds.values().next().value!);
    this.logs = [...this.logs.slice(-999), entry];
    this.recentLogTimestamps.push(Date.now());
    this.cleanRecentTimestamps();
    this.entryListeners.forEach(listener => listener(entry));
    this.notify();
  }

  getLogsPerSecond(): number {
    this.cleanRecentTimestamps();
    return this.recentLogTimestamps.length / 3;
  }

  private cleanRecentTimestamps(): void {
    const now = Date.now();
    this.recentLogTimestamps = this.recentLogTimestamps.filter(time => now - time <= 3000);
  }

  private notify(): void { this.listeners.forEach(listener => listener([...this.logs])); }
  dispose(): void { this.stop(); this.applications = []; }
}

export const logStreamService = new LogStreamService();
