import React from 'react';
import { LogEntry } from '../domain/LogEntry';
import { X, Copy, Check, ShieldAlert } from 'lucide-react';
import { useDialog } from '../../desktop/application/useDialog';
import { getDesktop } from '../../desktop/infrastructure/DesktopBridge';

interface LogDetailModalProps {
  log: LogEntry | null;
  onClose: () => void;
}

export const LogDetailModal: React.FC<LogDetailModalProps> = ({ log, onClose }) => {
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  useDialog(Boolean(log), onClose);
  React.useEffect(() => { setCopied(false); setError(null); }, [log?.id]);

  if (!log) return null;

  const handleCopyJson = async () => {
    try {
      await getDesktop().copyText(JSON.stringify(log, null, 2));
      setCopied(true);
    } catch { setError('Could not copy this log. Try exporting from the log viewer.'); }
  };

  const getRegionName = (reg?: string) => {
    switch (reg) {
      case 'iad1':
        return 'Washington, D.C. (US East)';
      case 'sfo1':
        return 'San Francisco, CA (US West)';
      case 'fra1':
        return 'Frankfurt (Europe Central)';
      case 'cdg1':
        return 'Paris (Europe West)';
      case 'hnd1':
        return 'Tokyo (Asia Northeast)';
      case 'lhr1':
        return 'London (Europe)';
      default:
        return reg || 'Global Edge';
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Log details" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                log.level === 'error'
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                  : log.level === 'warn'
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {log.level}
            </span>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 font-mono">
              Log Details ({log.id})
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyJson}
              className="text-xs px-2.5 py-1 rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 flex items-center gap-1 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied JSON' : 'Copy Log JSON'}</span>
            </button>
            <button
              aria-label="Close log details"
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 font-mono text-xs">
          {error && <p role="alert" className="text-rose-500">{error}</p>}
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60">
            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">Timestamp</span>
              <span className="text-neutral-800 dark:text-neutral-200 text-[11px]">
                {new Date(log.timestamp).toLocaleTimeString()} ({log.timestamp})
              </span>
            </div>

            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">Application</span>
              <span className="text-neutral-800 dark:text-neutral-200 text-[11px] font-semibold">
                {log.applicationName}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">Provider & Source</span>
              <span className="text-neutral-800 dark:text-neutral-200 text-[11px]">
                {log.providerType} • {log.source}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">Status & Method</span>
              <span className="text-neutral-800 dark:text-neutral-200 text-[11px]">
                {log.method || '—'} {log.statusCode ? `(${log.statusCode})` : ''}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">Latency</span>
              <span className="text-neutral-800 dark:text-neutral-200 text-[11px]">
                {log.latencyMs !== undefined ? `${log.latencyMs}ms` : '—'}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">Region</span>
              <span className="text-neutral-800 dark:text-neutral-200 text-[11px]">
                {getRegionName(log.region)}
              </span>
            </div>
          </div>

          {/* Full Message */}
          <div>
            <span className="text-[10px] uppercase text-neutral-400 block mb-1 font-semibold">
              Log Message
            </span>
            <div className="p-3 rounded-lg bg-neutral-900 text-neutral-100 border border-neutral-800 whitespace-pre-wrap break-all leading-relaxed font-mono selection:bg-indigo-500">
              {log.message}
            </div>
          </div>

          {/* Stack Trace (if exists) */}
          {log.stackTrace && (
            <div>
              <span className="text-[10px] uppercase text-rose-500 font-bold block mb-1 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" /> Stack Trace
              </span>
              <pre className="p-3 rounded-lg bg-rose-950/20 text-rose-300 border border-rose-900/40 text-[11px] overflow-x-auto whitespace-pre font-mono">
                {log.stackTrace}
              </pre>
            </div>
          )}

          {/* Metadata JSON payload */}
          {log.payload && (
            <div>
              <span className="text-[10px] uppercase text-neutral-400 block mb-1 font-semibold">
                Telemetry Payload Context
              </span>
              <pre className="p-3 rounded-lg bg-neutral-900 text-neutral-300 border border-neutral-800 text-[11px] overflow-x-auto whitespace-pre font-mono">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
