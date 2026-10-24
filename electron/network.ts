import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function validatePublicUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Use a public HTTPS URL without credentials or a custom port.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('Local and private network addresses cannot be monitored.');
  }
  return url;
}

export interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function readJsonLines(
  chunks: AsyncIterable<Uint8Array>,
  onValue: (value: unknown) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  const consume = (line: string) => {
    if (Buffer.byteLength(line, 'utf8') > 2 * 1024 * 1024) throw new Error('Runtime log line exceeded the 2 MB limit.');
    if (line.trim()) onValue(JSON.parse(line));
  };
  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = pending.indexOf('\n')) !== -1) {
      consume(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
    if (Buffer.byteLength(pending, 'utf8') > 2 * 1024 * 1024) throw new Error('Runtime log line exceeded the 2 MB limit.');
  }
  consume(pending + decoder.decode());
}

export async function resolvePublicHost(
  hostname: string,
  signal: AbortSignal,
  resolve = (host: string) => lookup(host, { all: true }),
): Promise<{ address: string; family: number }> {
  signal.throwIfAborted();
  const addresses = await new Promise<{ address: string; family: number }[]>((done, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    resolve(hostname).then(
      value => { signal.removeEventListener('abort', abort); done(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('Local and private network addresses cannot be monitored.');
  }
  signal.throwIfAborted();
  return addresses[0];
}

export async function publicRequest(
  input: string,
  options: {
    headers?: Record<string, string>; headersOnly?: boolean; signal?: AbortSignal; redirects?: number;
    onJsonLine?: (value: unknown) => void;
  } = {},
): Promise<NetworkResponse> {
  const url = validatePublicUrl(input);
  const signal = options.signal ?? AbortSignal.timeout(8000);
  const address = await resolvePublicHost(
    url.hostname.replace(/^\[|\]$/g, ''),
    AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  );

  const result = await new Promise<NetworkResponse>((resolve, reject) => {
    const req = request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Simply-Logs/1.0', ...options.headers },
      signal,
      // Pin the validated address so DNS cannot change between validation and connection.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      family: address.family,
      agent: false,
    }, res => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      const response: NetworkResponse = { status: res.statusCode ?? 502, headers, body: '' };
      if (options.headersOnly || (response.status >= 300 && response.status < 400)) {
        resolve(response);
        res.destroy();
        return;
      }
      if (options.onJsonLine && response.status >= 200 && response.status < 300) {
        // Runtime streams can be idle indefinitely; their owner cancels them on unsubscribe.
        req.setTimeout(0);
        void readJsonLines(res, options.onJsonLine).then(() => resolve(response), reject);
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) {
          res.destroy(new Error('Provider response exceeded the 2 MB limit.'));
          return;
        }
        chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => resolve({ ...response, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Request timed out after 8 seconds.')));
    req.end();
  });

  if (result.status >= 300 && result.status < 400 && result.headers.location) {
    const remaining = options.redirects ?? 3;
    if (!remaining) throw new Error('Too many redirects.');
    const destination = new URL(result.headers.location, url);
    if (options.headers?.Authorization && destination.origin !== url.origin) {
      throw new Error('Refusing to forward a provider token to another origin.');
    }
    return publicRequest(destination.href, { ...options, signal, redirects: remaining - 1 });
  }
  return result;
}
