import type { Provider } from '../shared/desktop';
import { publicRequest, type NetworkResponse } from './network';

export type Request = typeof publicRequest;

export function providerUrl(provider: Provider, path: string, teamId?: string): URL {
  const url = new URL(path, provider === 'vercel' ? 'https://api.vercel.com' : 'https://api.netlify.com');
  if (provider === 'vercel' && teamId) url.searchParams.set('teamId', teamId);
  return url;
}

export async function providerRequest(
  url: URL, token: string, send: Request,
  options: { signal?: AbortSignal; onJsonLine?: (value: unknown) => void } = {},
): Promise<NetworkResponse> {
  if (!token.trim()) throw new Error('A provider token is required. Connect this application again.');
  const response = await send(url.href, {
    headers: { Authorization: `Bearer ${token}`, Accept: options.onJsonLine ? 'application/stream+json' : 'application/json' },
    signal: options.signal ?? AbortSignal.timeout(15000),
    onJsonLine: options.onJsonLine,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Provider returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check your token and account permissions.' : 'Try again later.'}`);
  }
  return response;
}
