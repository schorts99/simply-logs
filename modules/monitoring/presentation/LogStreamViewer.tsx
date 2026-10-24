import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LogEntry, LogLevel, LogSource } from '../domain/LogEntry';
import { Application } from '@/modules/projects/domain/Project';
import { getDesktop } from '../../desktop/infrastructure/DesktopBridge';
import { percentile95 } from '../application/metrics';
import { 
  Play, 
  Pause, 
  Trash2, 
  Search, 
  ArrowDown, 
  Download, 
  Copy, 
  Check, 
  Activity, 
  Terminal,
  Maximize2,
  RefreshCw
} from 'lucide-react';

interface LogStreamViewerProps {
  logs: LogEntry[];
  isStreaming: boolean;
  onToggleStreaming: () => void;
  onClearLogs: () => void;
  activeApp: Application | null;
  onRunHealthProbe?: () => void;
  onSyncDeployments?: () => void;
  onSelectLog: (log: LogEntry) => void;
  canProbe: boolean;
  canSync: boolean;
  busyAction: 'probe' | 'deployments' | null;
  onError: (error: unknown) => void;
}

export const LogStreamViewer: React.FC<LogStreamViewerProps> = ({
  logs,
  isStreaming,
  onToggleStreaming,
  onClearLogs,
  activeApp,
  onRunHealthProbe,
  onSyncDeployments,
  onSelectLog,
  canProbe,
  canSync,
  busyAction,
  onError
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | 'all'>('all');
  const [selectedSource, setSelectedSource] = useState<LogSource | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedAll, setCopiedAll] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [logs, autoScroll]);

  // Handle user scroll detection: if user scrolls up, disable autoScroll; if scrolled to bottom, re-enable
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (isAtBottom !== autoScroll) {
      setAutoScroll(isAtBottom);
    }
  };

  // Filter logs
  const filteredLogs = useMemo(() => {
    let result = logs;

    // Filter by app if active
    if (activeApp) {
      result = result.filter(l => l.applicationId === activeApp.id);
    }

    // Filter by level
    if (selectedLevel !== 'all') {
      result = result.filter(l => l.level === selectedLevel);
    }

    // Filter by source
    if (selectedSource !== 'all') {
      result = result.filter(l => l.source === selectedSource);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        l.message.toLowerCase().includes(q) ||
        (l.path && l.path.toLowerCase().includes(q)) ||
        (l.statusCode && l.statusCode.toString().includes(q)) ||
        (l.region && l.region.toLowerCase().includes(q)) ||
        (l.requestId && l.requestId.toLowerCase().includes(q))
      );
    }

    return result;
  }, [logs, activeApp, selectedLevel, selectedSource, searchQuery]);

  // Live Stats calculations
  const errorCount = useMemo(() => logs.filter(l => l.level === 'error').length, [logs]);
  const warnCount = useMemo(() => logs.filter(l => l.level === 'warn').length, [logs]);
  const infoCount = useMemo(() => logs.filter(l => l.level === 'info').length, [logs]);
  const debugCount = useMemo(() => logs.filter(l => l.level === 'debug').length, [logs]);

  const p95Latency = useMemo(() => {
    return percentile95(logs.filter(log => log.source === 'probe' && log.observation !== 'unknown').flatMap(log => log.latencyMs === undefined ? [] : [log.latencyMs]));
  }, [logs]);
  const probes = logs.filter(log => log.source === 'probe' && log.observation !== 'unknown');
  const failedChecks = probes.filter(log => log.observation === 'unhealthy').length;

  // Export logs
  const handleExportJSON = async () => {
    try { await getDesktop().exportLogs(JSON.stringify(filteredLogs, null, 2)); }
    catch (error) { onError(error); }
  };

  const handleCopyAll = async () => {
    const text = filteredLogs
      .map(l => `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] [${l.applicationName}] ${l.message}`)
      .join('\n');
    try {
      await getDesktop().copyText(text);
      setCopiedAll(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedAll(false), 2000);
    } catch (error) { onError(error); }
  };

  const getLevelBadge = (level: LogLevel) => {
    switch (level) {
      case 'error':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-500 dark:text-rose-400 border border-rose-500/30">ERR</span>;
      case 'warn':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">WRN</span>;
      case 'debug':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-500/15 text-neutral-500 dark:text-neutral-400 border border-neutral-500/30">DBG</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">INF</span>;
    }
  };

  const getStatusBadge = (code?: number) => {
    if (!code) return null;
    let color = 'bg-neutral-500/15 text-neutral-400';
    if (code >= 200 && code < 300) color = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    else if (code >= 300 && code < 400) color = 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
    else if (code >= 400 && code < 500) color = 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    else if (code >= 500) color = 'bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold';

    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${color}`}>
        {code}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden font-sans select-text">
      {/* 1. Real-Time HUD Metrics Bar */}
      <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/40 flex items-center justify-between text-xs font-mono select-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isStreaming ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'
              }`}
            />
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {isStreaming ? 'MONITORING' : 'MONITORING PAUSED'}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <span>Latency p95:</span>
            <span className="text-neutral-800 dark:text-neutral-200 font-semibold">{p95Latency === null ? '—' : `${p95Latency}ms`}</span>
          </div>

          <div className="hidden md:flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <span>Failed checks:</span>
            <span className={failedChecks > 0 ? 'text-rose-500 font-bold' : 'text-neutral-600 dark:text-neutral-400'}>
              {probes.length ? `${((failedChecks / probes.length) * 100).toFixed(1)}%` : '—'}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <span>Observed telemetry only</span>
          </div>
        </div>

        {/* Real Live Actions: Health Probe & Deployment Sync */}
        <div className="flex items-center gap-2">
          {onRunHealthProbe && (
            <button
              disabled={!isStreaming || !canProbe || Boolean(busyAction)}
              onClick={onRunHealthProbe}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 transition-colors"
              title="Execute live HTTP health probe to measure current latency and response headers"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-500" />
              <span>{busyAction === 'probe' ? 'Checking…' : 'Check health'}</span>
            </button>
          )}

          {onSyncDeployments && (
            <button
              disabled={!isStreaming || !canSync || Boolean(busyAction)}
              onClick={onSyncDeployments}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700/60 transition-colors"
              title="Sync latest live deployments from provider"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
              <span>{busyAction === 'deployments' ? 'Syncing…' : 'Sync deployments'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Minimalist Log Toolbar */}
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800/80 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 select-none">
        {/* Stream Play/Pause & AutoScroll */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleStreaming}
            title={isStreaming ? 'Pause live stream (Space)' : 'Resume live stream (Space)'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              isStreaming
                ? 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isStreaming ? 'Pause' : 'Resume'}</span>
          </button>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
              autoScroll
                ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-500 border-transparent hover:text-neutral-800'
            }`}
          >
            <ArrowDown className={`w-3.5 h-3.5 ${autoScroll ? 'text-indigo-500' : ''}`} />
            <span>Auto-scroll</span>
          </button>

          <button
            onClick={onClearLogs}
            title="Clear current log buffer"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:text-rose-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>

        {/* Search input */}
        <div className="flex-1 max-w-sm min-w-[200px] relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-400" />
          <input
            type="text"
            placeholder="Search logs (e.g. /checkout, 500, iad1, error)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-xs font-mono rounded-lg border border-neutral-300 dark:border-neutral-700/80 bg-neutral-50/50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-neutral-400 hover:text-neutral-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Export / Copy tools */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyAll}
            disabled={filteredLogs.length === 0}
            title="Copy filtered logs to clipboard"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {copiedAll ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>

          <button
            onClick={handleExportJSON}
            disabled={filteredLogs.length === 0}
            title="Export logs as JSON file"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3. Filter Pills Bar (Levels & Sources) */}
      <div className="px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800/80 bg-neutral-100/40 dark:bg-neutral-900/20 flex flex-wrap items-center justify-between gap-2 select-none text-[11px] font-mono">
        {/* Levels */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-neutral-400 font-semibold mr-1">Level:</span>
          {(['all', 'error', 'warn', 'info', 'debug'] as const).map(lvl => {
            const count = lvl === 'all' ? logs.length : lvl === 'error' ? errorCount : lvl === 'warn' ? warnCount : lvl === 'info' ? infoCount : debugCount;
            const isSelected = selectedLevel === lvl;

            return (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-2 py-0.5 rounded-md transition-all flex items-center gap-1 ${
                  isSelected
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-bold shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
                }`}
              >
                <span className="capitalize">{lvl}</span>
                <span className={`text-[9px] px-1 rounded-full ${isSelected ? 'bg-white/20 dark:bg-black/20' : 'bg-neutral-200 dark:bg-neutral-800'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sources */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-neutral-400 font-semibold mr-1">Source:</span>
          {(['all', 'probe', 'build', 'runtime', 'serverless', 'edge'] as const).map(src => (
            <button
              key={src}
              onClick={() => setSelectedSource(src)}
              className={`px-2 py-0.5 rounded-md transition-all capitalize ${
                selectedSource === src
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
              }`}
            >
              {src}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Stream List Body */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed divide-y divide-neutral-100 dark:divide-neutral-900/60"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-400">
            <Terminal className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
              {logs.length ? 'No logs match these filters' : 'No observations yet'}
            </p>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm">
              {searchQuery ? `No logs containing "${searchQuery}". Clear the query or filters.` : isStreaming ? 'Checks run every 15 seconds. Deployment accounts sync every 30 seconds. Only applications in this project and environment are shown.' : 'Resume monitoring to collect fresh observations. Health is unknown while paused.'}
            </p>
          </div>
        ) : (
          filteredLogs.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + (log.timestamp % 1000).toString().padStart(3, '0');
            const isError = log.level === 'error';
            const isWarn = log.level === 'warn';

            return (
              <div
                key={log.id}
                onClick={() => onSelectLog(log)}
                className={`group px-3 py-1.5 flex items-start gap-2 hover:bg-neutral-100/80 dark:hover:bg-neutral-900/80 cursor-pointer transition-colors ${
                  isError ? 'bg-rose-500/5 hover:bg-rose-500/10' : isWarn ? 'bg-amber-500/5 hover:bg-amber-500/10' : ''
                }`}
              >
                {/* Timestamp */}
                <span className="text-neutral-400 dark:text-neutral-500 shrink-0 font-mono text-[10px] select-none pt-0.5">
                  {timeStr}
                </span>

                {/* Level Pill */}
                <div className="shrink-0 pt-0.5">{getLevelBadge(log.level)}</div>

                {/* App Name & Provider Icon */}
                <div className="shrink-0 flex items-center gap-1 text-[10px] text-neutral-600 dark:text-neutral-400 pt-0.5">
                  <span className="font-bold text-neutral-800 dark:text-neutral-200">
                    {log.providerType === 'netlify' ? '🌐' : '▲'}
                  </span>
                  <span className="truncate max-w-[110px] font-medium">{log.applicationName}</span>
                </div>

                {/* Source Pill */}
                <span className="shrink-0 text-[9px] uppercase px-1 py-0.2 rounded bg-neutral-200/70 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 pt-0.5 font-mono">
                  {log.source}
                </span>

                {/* Real Telemetry Indicator */}
                {log.isRealTelemetry && (
                  <span className="shrink-0 text-[8px] font-mono px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30">
                    LIVE
                  </span>
                )}

                {/* HTTP Status & Latency */}
                {log.statusCode && (
                  <div className="shrink-0 pt-0.5">{getStatusBadge(log.statusCode)}</div>
                )}

                {log.latencyMs !== undefined && (
                  <span className={`shrink-0 text-[10px] font-mono pt-0.5 ${
                    log.latencyMs > 500 ? 'text-rose-500 font-bold' : log.latencyMs > 150 ? 'text-amber-500' : 'text-neutral-400'
                  }`}>
                    {log.latencyMs}ms
                  </span>
                )}

                {log.region && (
                  <span className="shrink-0 text-[9px] text-neutral-400 font-mono px-1 rounded bg-neutral-200/40 dark:bg-neutral-800/40 pt-0.5">
                    {log.region}
                  </span>
                )}

                {/* Message Body */}
                <span className={`flex-1 break-all pt-0.5 ${
                  isError
                    ? 'text-rose-600 dark:text-rose-300 font-medium'
                    : isWarn
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-neutral-800 dark:text-neutral-200'
                }`}>
                  {log.message}
                </span>

                {/* Hover inspect button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLog(log);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-neutral-400 hover:text-indigo-500 p-1 rounded transition-opacity shrink-0"
                  title="Inspect log details"
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};
