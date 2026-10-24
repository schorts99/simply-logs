import type { Application } from '../../projects/domain/Project';
import type { LogEntry } from '../domain/LogEntry';
import { providerRegistry } from '../infrastructure/ProviderRegistry';
import type { ProviderRegistry } from '../infrastructure/ProviderRegistry';
import { LocalStorageLogHistory, LOG_HISTORY_LIMIT } from '../infrastructure/LocalStorageLogHistory';
import type { LogHistory } from '../infrastructure/LocalStorageLogHistory';

export class LogStreamService {
  private logs: LogEntry[] = [];
  private history: LogEntry[] = [];
  private historyClearedAt = new Map<string, number>();
  private storageError: string | null = null;
  private storageReadable = true;
  private storageListeners = new Set<(error: string | null) => void>();
  private listeners = new Set<(logs: LogEntry[]) => void>();
  private entryListeners = new Set<(entry: LogEntry) => void>();
  private unsubs = new Map<string, () => void>();
  private applications: Application[] = [];
  private isStreaming = true;
  private recentLogTimestamps: number[] = [];
  private seenIds = new Set<string>();
  private generation = 0;

  constructor(
    private registry: Pick<ProviderRegistry, 'getAdapter'> = providerRegistry,
    private storage?: LogHistory,
  ) {
    try {
      this.history = storage?.load() ?? [];
      this.seenIds = new Set(this.history.map(log => log.id));
    } catch (error) {
      this.storageReadable = false;
      this.storageError = error instanceof Error ? error.message : 'Saved log history could not be read.';
    }
  }

  subscribeStorageErrors(listener: (error: string | null) => void): () => void {
    this.storageListeners.add(listener);
    listener(this.storageError);
    return () => { this.storageListeners.delete(listener); };
  }

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
    const ids = new Set([...this.applications.map(app => app.id), ...this.logs.map(log => log.applicationId)]);
    const clearedAt = Date.now();
    ids.forEach(id => this.historyClearedAt.set(id, clearedAt));
    this.history = this.history.filter(log => !ids.has(log.applicationId));
    this.logs = [];
    this.recentLogTimestamps = [];
    this.saveHistory();
    // Keep the bounded deduplication cache so clearing does not replay old build logs.
    this.notify();
  }

  retainApplications(applicationIds: string[]): void {
    const ids = new Set(applicationIds);
    const previousLength = this.history.length;
    this.history = this.history.filter(log => ids.has(log.applicationId));
    this.logs = this.logs.filter(log => ids.has(log.applicationId));
    if (this.history.length !== previousLength) this.saveHistory();
    this.notify();
  }

  private saveHistory(): void {
    if (!this.storage || !this.storageReadable) return;
    let nextError: string | null = null;
    try { this.storage.save(this.history); }
    catch (error) { nextError = error instanceof Error ? error.message : 'Log history could not be saved.'; }
    if (nextError === this.storageError) return;
    this.storageError = nextError;
    this.storageListeners.forEach(listener => listener(nextError));
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
    this.logs = this.history.filter(log => ids.has(log.applicationId));
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
    const historical = entry.payload?.historical === true;
    if (historical && entry.timestamp <= (this.historyClearedAt.get(entry.applicationId) ?? -Infinity)) return;
    if (this.seenIds.has(entry.id)) {
      if (historical) {
        // History groups all console output for a request, enriching a saved live entry with the same provider ID.
        this.logs = this.logs.map(log => log.id === entry.id ? entry : log).sort((a, b) => a.timestamp - b.timestamp);
        this.history = this.history.map(log => log.id === entry.id ? entry : log).sort((a, b) => a.timestamp - b.timestamp);
        this.saveHistory();
        this.notify();
        return;
      }
      // A repeated healthy deployment is still a fresh observation for incident recovery.
      if (entry.observation) this.entryListeners.forEach(listener => listener(entry));
      return;
    }
    this.seenIds.add(entry.id);
    if (this.seenIds.size > 5000) this.seenIds.delete(this.seenIds.values().next().value!);
    this.logs = [...this.logs, entry].sort((a, b) => a.timestamp - b.timestamp).slice(-LOG_HISTORY_LIMIT);
    this.history = [...this.history, entry].sort((a, b) => a.timestamp - b.timestamp).slice(-LOG_HISTORY_LIMIT);
    this.saveHistory();
    if (!historical) this.recentLogTimestamps.push(Date.now());
    this.cleanRecentTimestamps();
    if (!historical) this.entryListeners.forEach(listener => listener(entry));
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

export const logStreamService = new LogStreamService(
  providerRegistry, typeof window === 'undefined' ? undefined : new LocalStorageLogHistory(),
);
