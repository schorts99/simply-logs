import React, { useEffect, useRef, useState } from 'react';
import type { Application, Environment, ProviderType } from '../domain/Project';
import type { DiscoveredApplication } from '../../../shared/desktop';
import { providerRegistry } from '../../monitoring/infrastructure/ProviderRegistry';
import { getDesktop } from '../../desktop/infrastructure/DesktopBridge';
import { useDialog } from '../../desktop/application/useDialog';
import { X, CheckCircle, AlertCircle, Loader2, ExternalLink, RefreshCw } from 'lucide-react';

interface Props {
  projectId: string;
  application?: Application;
  onClose: () => void;
  onAddApplication: (app: Application, token?: string) => Promise<void>;
}

const inputClass = 'w-full px-3 py-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100';

export const AddApplicationModal: React.FC<Props> = ({ projectId, application, onClose, onAddApplication }) => {
  const [provider, setProvider] = useState<ProviderType>(application?.providerType || 'vercel');
  const [mode, setMode] = useState<'account' | 'url'>(application?.config.connectionMode || 'url');
  const [name, setName] = useState(application?.name || '');
  const [url, setUrl] = useState(application?.deploymentUrl || '');
  const [environment, setEnvironment] = useState<Environment>(application?.environment || 'production');
  const [token, setToken] = useState('');
  const [teamId, setTeamId] = useState(application?.config.vercelTeamId || '');
  const [targetId, setTargetId] = useState(application?.config.vercelProjectId || application?.config.netlifySiteId || '');
  const [framework, setFramework] = useState(application?.config.framework || '');
  const [discovered, setDiscovered] = useState<DiscoveredApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<'discover' | 'probe' | 'save' | null>(null);
  const generation = useRef(0);
  useDialog(true, () => { if (busy !== 'save') onClose(); });
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { setProbeResult(null); }, [url]);

  const run = async (kind: 'discover' | 'probe') => {
    const version = generation.current;
    setBusy(kind); setError(null);
    try {
      if (kind === 'discover') {
        const result = await providerRegistry.getAdapter(provider).validateCredentials({ apiToken: token, vercelTeamId: teamId });
        if (version !== generation.current) return;
        if (!result.valid) throw new Error(result.message || 'Could not connect.');
        setDiscovered(result.detectedApps || []);
      } else {
        const result = await getDesktop().probe(url.trim());
        if (version !== generation.current) return;
        if (!result.success) throw new Error(result.error || `The URL returned HTTP ${result.statusCode}.`);
        setProbeResult(`HTTP ${result.statusCode} · ${result.latencyMs}ms · ${result.region}`);
      }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : 'Could not complete the request.');
    } finally { if (version === generation.current) setBusy(null); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null);
    const savedCredential = application?.providerType === provider ? application.config.credentialId : undefined;
    try {
      if (!name.trim()) throw new Error('Enter an application name.');
      if (mode === 'url' && !url.trim()) throw new Error('Enter the public URL to monitor.');
      if (url.trim()) {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
          throw new Error('Use a public HTTPS URL without credentials or a custom port.');
        }
      }
      if (mode === 'account' && (!targetId.trim() || (!token.trim() && !savedCredential))) {
        throw new Error('Enter your token and select an application, or provide its project/site ID.');
      }
      setBusy('save');
      const app: Application = {
        id: application?.id || crypto.randomUUID(), projectId, providerType: provider, name: name.trim(),
        slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), environment,
        deploymentUrl: url.trim() || undefined, status: 'idle', createdAt: application?.createdAt || Date.now(),
        stats: { probeCount: 0, errorRatePercent: 0, p95LatencyMs: null, lastUpdated: 0 },
        config: {
          connectionMode: mode, framework: framework || undefined,
          credentialId: mode === 'account' ? savedCredential : undefined,
          vercelProjectId: mode === 'account' && provider === 'vercel' ? targetId.trim() : undefined,
          netlifySiteId: mode === 'account' && provider === 'netlify' ? targetId.trim() : undefined,
          vercelTeamId: provider === 'vercel' && mode === 'account' ? teamId.trim() || undefined : undefined,
        },
      };
      await onAddApplication(app, mode === 'account' ? token.trim() || undefined : undefined);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this application.');
      setBusy(null);
    }
  };

  const select = (item: DiscoveredApplication) => {
    setName(item.name); setUrl(item.deploymentUrl || ''); setFramework(item.framework || '');
    setTargetId(item.projectId || item.siteId || '');
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="application-title" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl max-h-[92vh] flex flex-col">
        <div className="p-5 border-b border-neutral-200 dark:border-neutral-800 flex justify-between items-start">
          <div><h2 id="application-title" className="font-semibold">{application ? 'Edit application' : 'Add application'}</h2>
            <p className="text-xs text-neutral-500 mt-1">Real health checks and deployment activity. No synthetic traffic.</p></div>
          <button aria-label="Close application dialog" disabled={busy === 'save'} onClick={onClose} className="p-1 text-neutral-500"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 overflow-y-auto space-y-4">
          <fieldset disabled={Boolean(busy)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1 block">Platform
                <select aria-label="Platform" value={provider} onChange={event => { setProvider(event.target.value as ProviderType); setToken(''); setTeamId(''); setTargetId(''); setDiscovered(null); setError(null); }} className={`${inputClass} mt-1`}>
                  <option value="vercel">Vercel</option><option value="netlify">Netlify</option>
                </select>
              </label>
              <label className="text-xs space-y-1 block">Connection
                <select aria-label="Connection" value={mode} onChange={event => { setMode(event.target.value as 'account' | 'url'); setError(null); }} className={`${inputClass} mt-1`}>
                  <option value="url">Public URL health checks</option><option value="account">Provider account + health</option>
                </select>
              </label>
            </div>
            {mode === 'account' && (
              <div className="rounded-xl p-3 space-y-3 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800">
                <div className="flex justify-between gap-2 text-xs">
                  <label htmlFor="api-token">Personal access token{application?.config.credentialId && application.providerType === provider ? ' (leave blank to keep saved token)' : ''}</label>
                  <a href={providerRegistry.getAdapter(provider).getMetadata().tokenGuideUrl} target="_blank" rel="noreferrer" className="text-indigo-500 flex gap-1 items-center shrink-0">Create token <ExternalLink className="w-3 h-3" /></a>
                </div>
                <input id="api-token" type="password" value={token} onChange={event => { setToken(event.target.value); setDiscovered(null); }} autoComplete="off" className={inputClass} />
                {provider === 'vercel' && <label className="text-xs block">Team ID (optional)
                  <input aria-label="Team ID" value={teamId} onChange={event => { setTeamId(event.target.value); setTargetId(''); setDiscovered(null); }} className={`${inputClass} mt-1`} />
                </label>}
                <button type="button" disabled={!token.trim()} onClick={() => void run('discover')} className="flex items-center gap-2 text-xs text-indigo-500 font-medium">
                  <RefreshCw className="w-3.5 h-3.5" /> Discover applications
                </button>
                {discovered && <div className="max-h-36 overflow-y-auto space-y-1">
                  {discovered.length === 0 ? <p className="text-xs text-neutral-500">No applications found. Check the selected account and team.</p> : discovered.map(item => (
                    <button key={item.projectId || item.siteId} type="button" onClick={() => select(item)} className="w-full text-left text-xs p-2 rounded-lg bg-white dark:bg-neutral-900 hover:ring-1 ring-indigo-500 flex justify-between">
                      {item.name}{targetId === (item.projectId || item.siteId) && <CheckCircle className="w-3.5 h-3.5 text-indigo-500" />}
                    </button>
                  ))}
                </div>}
                <label className="text-xs block">{provider === 'vercel' ? 'Project ID' : 'Site ID'}
                  <input aria-label={provider === 'vercel' ? 'Project ID' : 'Site ID'} value={targetId} onChange={event => setTargetId(event.target.value)} className={`${inputClass} mt-1`} placeholder="Select above or enter the provider ID" />
                </label>
                <p className="text-[11px] text-neutral-500">Tokens are never saved in browser storage. They use your OS keychain, or stay in memory when secure storage is unavailable.</p>
                <p className="text-[11px] text-neutral-500">{provider === 'vercel' ? 'Includes deployment status and recent build logs.' : 'Includes deployment status. Netlify build logs must be viewed in its dashboard.'}</p>
              </div>
            )}
            <label className="text-xs block" htmlFor="app-name">Application name
              <input data-autofocus id="app-name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} className={`${inputClass} mt-1`} placeholder="e.g. My storefront" />
            </label>
            <div className="text-xs">
              <label htmlFor="app-env">Environment</label>
              <select id="app-env" value={environment} onChange={event => setEnvironment(event.target.value as Environment)} className={`${inputClass} mt-1`}>
                <option value="production">Production</option><option value="preview">Preview</option><option value="development">Development</option>
              </select>
            </div>
            <label className="text-xs block" htmlFor="app-url">Public HTTPS URL {mode === 'account' ? '(optional)' : ''}
              <input id="app-url" type="url" required={mode === 'url'} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://your-app.example.com" className={`${inputClass} mt-1 font-mono`} />
            </label>
            <div className="flex justify-between items-center gap-2 text-[11px] text-neutral-500">
              <span>Checked every 15 seconds while monitoring is running.</span>
              <button type="button" disabled={!url.trim()} onClick={() => void run('probe')} className="text-indigo-500 shrink-0">Test URL</button>
            </div>
          </fieldset>
          {probeResult && <p role="status" className="text-xs text-emerald-600">{probeResult}</p>}
          {error && <p role="alert" className="text-xs text-rose-500 flex items-start gap-2 break-words"><AlertCircle className="w-4 h-4 shrink-0" />{error}</p>}
          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4 flex justify-end items-center gap-3">
            {busy && <span role="status" className="text-xs text-neutral-500 mr-auto flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{busy === 'save' ? 'Saving…' : 'Connecting…'}</span>}
            <button type="button" disabled={busy === 'save'} onClick={onClose} className="text-xs px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">Cancel</button>
            <button type="submit" disabled={Boolean(busy)} className="text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">{application ? 'Save changes' : 'Add application'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
