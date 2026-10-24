import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, publicRequest, resolvePublicHost, validatePublicUrl } from '../electron/network';
import { deployments, discover, events, probe, probeMetadata } from '../electron/monitoring';

test('only public HTTPS targets and addresses are accepted', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1', '100.64.0.1', '192.0.2.1', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true);
  for (const url of ['http://example.com', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com:444', 'https://localhost', 'https://test.localhost']) {
    assert.throws(() => validatePublicUrl(url), Error, url);
  }
  assert.equal(validatePublicUrl('https://example.com').hostname, 'example.com');
  await assert.rejects(publicRequest('https://127.0.0.1'), /private network/);
  await assert.rejects(publicRequest('https://[::1]'), /private network/);
});

test('DNS validation rejects mixed private/public results and obeys timeout cancellation', async () => {
  await assert.rejects(resolvePublicHost('example.com', new AbortController().signal, async () => [
    { address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 },
  ]), /private network/);
  const controller = new AbortController();
  const pending = resolvePublicHost('example.com', controller.signal, () => new Promise(() => {}));
  controller.abort(new Error('DNS timed out'));
  await assert.rejects(pending, /DNS timed out/);
});

test('Vercel region and cache states are not collapsed by truthiness', () => {
  assert.deepEqual(probeMetadata({ 'x-vercel-id': 'iad1::test', 'x-vercel-cache': 'MISS' }), { region: 'iad1', cacheStatus: 'MISS', server: 'Vercel' });
  assert.equal(probeMetadata({ 'x-vercel-cache': 'HIT' }).cacheStatus, 'HIT');
  assert.equal(probeMetadata({ 'x-vercel-cache': 'STALE' }).cacheStatus, 'STALE');
  assert.equal(probeMetadata({ age: '0' }).cacheStatus, 'Unknown');
  assert.equal(probeMetadata({ age: '10' }).cacheStatus, 'HIT');
  assert.equal(probeMetadata({ 'x-nf-request-id': 'test' }).region, 'Netlify-Edge');
  assert.equal(probeMetadata({}).region, 'Unknown');
});

test('HTTP failures and connectivity failures retain truthful probe status', async () => {
  const result = await probe('https://example.com', async () => ({ status: 503, headers: {}, body: '' }));
  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
  const failure = await probe('https://example.com', async () => { throw new Error('timed out'); });
  assert.equal(failure.success, false);
  assert.equal(failure.statusCode, 0);
  assert.equal(failure.error, 'timed out');
});

test('provider errors never become fabricated discovery or deployment success', async () => {
  for (const provider of ['vercel', 'netlify'] as const) {
    for (const status of [401, 403, 429, 500]) {
      const send = async () => ({ status, body: '{}', headers: {} });
      await assert.rejects(discover(provider, 'placeholder', undefined, send), new RegExp(`HTTP ${status}`));
      await assert.rejects(deployments({ provider, targetId: 'project', credentialId: 'app' }, 'placeholder', send), new RegExp(`HTTP ${status}`));
    }
    await assert.rejects(discover(provider, '', undefined, async () => { throw new Error('should not request'); }), /token is required/);
  }
});

test('Vercel discovery follows pagination and preserves project IDs', async () => {
  const urls: URL[] = [];
  const result = await discover('vercel', 'placeholder', 'team-one', async input => {
    const url = new URL(input);
    urls.push(url);
    return { status: 200, headers: {}, body: JSON.stringify({
      projects: [{ id: url.searchParams.has('until') ? 'two' : 'one', name: 'My app', framework: 'nextjs' }],
      pagination: url.searchParams.has('until') ? {} : { next: 1234 },
    }) };
  });
  assert.deepEqual(result.map(app => app.projectId), ['one', 'two']);
  assert.equal(result[0].deploymentUrl, undefined);
  assert.equal(urls[1].searchParams.get('until'), '1234');
  assert.equal(urls[0].searchParams.get('teamId'), 'team-one');
});

test('Netlify discovery follows full pages rather than truncating at 25', async () => {
  const pages: string[] = [];
  const result = await discover('netlify', 'placeholder', undefined, async input => {
    const page = new URL(input).searchParams.get('page')!;
    pages.push(page);
    return { status: 200, headers: {}, body: JSON.stringify(page === '1'
      ? Array.from({ length: 100 }, (_, id) => ({ id: String(id), name: `app-${id}` }))
      : [{ id: 'last', name: 'Last app' }]) };
  });
  assert.equal(result.length, 101);
  assert.deepEqual(pages, ['1', '2']);
});

test('build events use actual payloads and stable identifiers', async () => {
  const target = { provider: 'vercel' as const, targetId: 'project', credentialId: 'app', deploymentId: 'deploy' };
  const result = await events(target, 'placeholder', async () => ({
    status: 200, headers: {}, body: JSON.stringify([{ created: 1234, type: 'stderr', payload: { id: 'event-one', text: 'Build failed' } }]),
  }));
  assert.equal(result[0].message, 'Build failed');
  assert.equal(result[0].level, 'error');
  assert.equal(result[0].timestamp, 1234);
  assert.equal(result[0].id, 'event-one');
});

test('build logs preserve warning/fatal levels, ignore null events and keep stable IDs as the window shifts', async () => {
  const target = { provider: 'vercel' as const, targetId: 'project', credentialId: 'app', deploymentId: 'deploy' };
  const first = { created: '2000', level: 'warning', text: 'Warning' };
  const second = { created: 3000, type: 'fatal', text: 'Fatal' };
  const send = async (body: unknown[]) => events(target, 'placeholder', async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get('direction'), 'backward');
    assert.equal(url.searchParams.get('follow'), '0');
    return { status: 200, headers: {}, body: JSON.stringify(body) };
  });
  const result = await send([second, null, first]);
  assert.equal(result[0].level, 'warn');
  assert.equal(result[1].level, 'error');
  assert.equal(result[0].id, (await send([first]))[0].id);
});

test('Netlify build logs are not fetched from an undocumented endpoint', async () => {
  await assert.rejects(events(
    { provider: 'netlify', targetId: 'site', credentialId: 'app', deploymentId: 'deploy' },
    'placeholder',
    async () => { throw new Error('Unexpected network request'); },
  ), /not through the public REST API/);
});
