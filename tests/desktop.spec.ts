import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { application, entry } from './fixtures';
import type { Project } from '../modules/projects/domain/Project';

test('desktop onboarding, real-data boundaries, filtering, pause and shared mute', async ({}, info) => {
  const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-desktop-'));
  const app = await electron.launch({
    args: [
      '.', `--user-data-dir=${profile}`, '--disable-gpu',
      ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
  });

  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('monitor:probe');
      ipcMain.handle('monitor:probe', (_event, url: string) => ({
        success: !url.includes('preview'), statusCode: url.includes('preview') ? 503 : 200,
        latencyMs: 27, region: 'iad1', server: 'Vercel', cacheStatus: 'MISS',
        headers: { 'x-vercel-id': 'iad1::fixture', 'x-vercel-cache': 'MISS' }, timestamp: Date.now(),
      }));
      ipcMain.removeHandler('desktop:notify');
      ipcMain.handle('desktop:notify', () => true);
      ipcMain.removeHandler('credentials:save');
      ipcMain.handle('credentials:save', () => ({ persistent: false }));
      ipcMain.removeHandler('credentials:delete');
      ipcMain.handle('credentials:delete', () => {});
      ipcMain.removeHandler('providers:discover');
      ipcMain.handle('providers:discover', () => [{
        name: 'Account app', slug: 'account-app', projectId: 'project-fixture', deploymentUrl: 'https://account.example.com',
      }]);
      ipcMain.removeHandler('providers:deployments');
      ipcMain.handle('providers:deployments', () => [{
        id: 'deploy-fixture', state: 'ready', createdAt: Date.now(),
      }]);
      ipcMain.removeHandler('providers:events');
      ipcMain.handle('providers:events', () => [{
        id: 'event-fixture', timestamp: Date.now(), level: 'info', message: 'Actual provider build event fixture',
      }]);
      ipcMain.removeHandler('providers:runtime-deployment');
      ipcMain.handle('providers:runtime-deployment', () => 'deploy-fixture');
      ipcMain.removeHandler('providers:runtime-start');
      const runtimeState = { started: [] as string[], stopped: [] as string[], historyStarted: [] as string[] };
      (globalThis as any).__runtimeTest = runtimeState;
      ipcMain.removeHandler('providers:runtime-history');
      ipcMain.handle('providers:runtime-history', (_event, input) => {
        runtimeState.historyStarted.push(input.subscriptionId);
        return { events: [{
          id: 'past-runtime-fixture', deploymentId: 'previous-deployment', timestamp: Date.now() - 30 * 60 * 1000,
          level: 'warn', source: 'serverless', message: 'Runtime output from thirty minutes ago',
          method: 'POST', path: '/api/history', statusCode: 429, messageTruncated: false,
          logs: [{ level: 'warning', message: 'Runtime output from thirty minutes ago', messageTruncated: false }],
        }, {
          id: 'runtime-fixture', deploymentId: 'deploy-fixture', timestamp: Date.now() - 1000,
          level: 'error', source: 'serverless', message: 'Actual provider runtime output fixture',
          method: 'POST', path: '/api/test', statusCode: 500, messageTruncated: false,
          logs: [{ level: 'error', message: 'Actual provider runtime output fixture', messageTruncated: false }],
        }], truncated: false };
      });
      ipcMain.handle('providers:runtime-start', (event, input) => {
        runtimeState.started.push(input.subscriptionId);
        event.sender.send('providers:runtime-update', {
          subscriptionId: input.subscriptionId,
          event: {
            id: 'runtime-fixture', timestamp: Date.now(), level: 'error', source: 'serverless',
            message: 'Actual provider runtime output fixture', method: 'POST', path: '/api/test',
            statusCode: 500, host: 'account.example.com', messageTruncated: false,
          },
        });
      });
      ipcMain.removeHandler('providers:runtime-stop');
      ipcMain.handle('providers:runtime-stop', (_event, subscriptionId: string) => {
        runtimeState.stopped.push(subscriptionId);
      });
    });
    const page = await app.firstWindow();
    const workspace = page.getByRole('main');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page).toHaveTitle('Simply Logs');
    if (process.platform !== 'darwin') {
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()))
        .toBe(false);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarAutoHide())).toBe(false);
      await page.keyboard.press('Alt');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
    }
    await expect(page.getByRole('heading', { name: 'Simply Logs', exact: true })).toBeVisible();
    await expect(page.getByTitle('Toggle window style (macOS / Windows)')).toHaveCount(0);
    expect(await page.evaluate(() => ({ require: typeof (window as any).require, process: typeof (window as any).process }))).toEqual({ require: 'undefined', process: 'undefined' });
    expect(await page.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } })).toBe(true);

    await page.getByTitle('Mute all sounds').click();
    await page.getByRole('button', { name: 'Create your first project' }).click();
    await page.getByLabel('Project Name').fill('Primary project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('button', { name: 'Add your first application' }).click();
    await page.getByLabel('Application name').fill('Production app');
    await page.getByLabel('Public HTTPS URL').fill('https://production.example.com');
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await expect(workspace.getByText(/^GET https:\/\/production\.example\.com/)).toBeVisible();
    await expect(page.getByText('27ms', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync deployments', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check health', exact: true })).toBeDisabled();
    await expect(page.getByText('PAUSED · health unknown', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByRole('button', { name: 'Add App', exact: true }).click();
    await page.getByLabel('Application name').fill('Preview app');
    await page.getByLabel('Environment', { exact: true }).selectOption('preview');
    await page.getByLabel('Public HTTPS URL').fill('https://preview.example.com');
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await expect(workspace.getByText(/^GET https:\/\/preview\.example\.com/)).toBeVisible();
    await page.getByRole('button', { name: 'prod', exact: true }).click();
    await expect(workspace.getByText(/^GET https:\/\/preview\.example\.com/)).toHaveCount(0);
    await expect(workspace.getByText(/^GET https:\/\/production\.example\.com/).first()).toBeVisible();

    await page.getByTitle('Notifications and alert settings').click();
    const notifications = page.getByRole('dialog', { name: 'Notification settings' });
    await expect(notifications.getByLabel('Sound chimes')).not.toBeChecked();
    await notifications.getByRole('button', { name: 'Send Test Notification', exact: true }).click();
    await expect(notifications.getByRole('button', { name: 'Accepted by system', exact: true })).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop:notify');
      ipcMain.handle('desktop:notify', () => { throw new Error('macOS notification permission denied'); });
    });
    await notifications.getByRole('button', { name: 'Accepted by system', exact: true }).click();
    await expect(notifications.getByRole('alert')).toContainText('Desktop notification failed');
    await expect(notifications.getByText('Desktop notification failed', { exact: true })).toBeVisible();
    await expect(notifications.getByText(/macOS notification permission denied/)).toBeVisible();
    await notifications.getByRole('button', { name: 'Enabled', exact: true }).click();
    await notifications.getByRole('button', { name: 'Send Test Notification', exact: true }).click();
    await expect(notifications.getByRole('status')).toContainText('In-app test sent');
    await notifications.getByRole('button', { name: 'Disabled', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop:notify');
      ipcMain.handle('desktop:notify', () => true);
    });
    await notifications.getByLabel('Sound chimes').check();
    await page.keyboard.press('Escape');
    await expect(page.getByTitle('Mute all sounds')).toBeVisible();
    await page.getByTitle('Mute all sounds').click();

    await page.getByRole('button', { name: 'Add App', exact: true }).click();
    await page.getByLabel('Connection', { exact: true }).selectOption('account');
    await page.getByLabel('Personal access token').fill('placeholder-desktop-test-token');
    await page.getByRole('button', { name: 'Discover applications' }).click();
    await page.getByRole('button', { name: 'Account app', exact: true }).click();
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await expect(page.getByText('Actual provider build event fixture')).toBeVisible();
    await expect(page.getByText('Actual provider runtime output fixture')).toBeVisible();
    await expect(page.getByText('Runtime output from thirty minutes ago', { exact: true })).toBeVisible();
    await expect(page.getByText('Actual provider runtime output fixture', { exact: true })).toHaveCount(1);
    expect(await app.evaluate(() => (globalThis as any).__runtimeTest.historyStarted.length)).toBe(1);
    await page.getByRole('button', { name: 'serverless', exact: true }).click();
    await expect(page.getByText('Actual provider runtime output fixture')).toBeVisible();
    await expect(page.getByText('Actual provider build event fixture')).toHaveCount(0);
    await page.getByRole('button', { name: 'build', exact: true }).click();
    await expect(page.getByText('Actual provider build event fixture')).toBeVisible();
    await expect(page.getByText('Actual provider runtime output fixture')).toHaveCount(0);
    await expect(page.getByText('Runtime output from thirty minutes ago', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'serverless', exact: true }).click();
    const firstRuntimeSubscription = await app.evaluate(() => (globalThis as any).__runtimeTest.started[0] as string);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => app.evaluate((_electron, id) => (globalThis as any).__runtimeTest.stopped.includes(id), firstRuntimeSubscription)).toBe(true);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByText('Actual provider runtime output fixture')).toHaveCount(1);
    await app.evaluate(({ BrowserWindow }, subscriptionId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('providers:runtime-update', {
        subscriptionId, event: {
          id: 'late-fixture', timestamp: Date.now(), source: 'serverless', level: 'info',
          message: 'Late output from cancelled stream', messageTruncated: false,
        },
      });
    }, firstRuntimeSubscription);
    await expect(page.getByText('Late output from cancelled stream')).toHaveCount(0);
    expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('placeholder-desktop-test-token');
    await page.screenshot({ path: info.outputPath('workspace.png') });

    await page.getByRole('button', { name: 'Primary project', exact: true }).click();
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByLabel('Project Name').fill('Empty project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add your first application' })).toBeVisible();
    await expect(page.getByText('Actual provider build event fixture')).toHaveCount(0);
    await expect(page.getByText('Actual provider runtime output fixture')).toHaveCount(0);
    await expect.poll(() => app.evaluate(() => {
      const state = (globalThis as any).__runtimeTest;
      return state.started.every((id: string) => state.stopped.includes(id));
    })).toBe(true);
    await expect(workspace.getByText(/^GET https:\/\//)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('desktop.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('received runtime and build history survives quitting, reopening and clearing', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-history-'));
  const launch = () => electron.launch({
    args: [
      '.', `--user-data-dir=${profile}`, '--disable-gpu',
      ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
  });
  let app = await launch();
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('providers:runtime-history');
      ipcMain.handle('providers:runtime-history', () => ({ events: [], truncated: false }));
      ipcMain.removeHandler('providers:deployments');
      ipcMain.handle('providers:deployments', () => [{ id: 'history-deployment', state: 'ready', createdAt: Date.now() }]);
      ipcMain.removeHandler('providers:events');
      ipcMain.handle('providers:events', () => [{
        id: 'history-build', timestamp: Date.now(), level: 'info', message: 'Build output retained after quitting',
      }]);
      ipcMain.removeHandler('providers:runtime-deployment');
      ipcMain.handle('providers:runtime-deployment', () => 'history-deployment');
      ipcMain.removeHandler('providers:runtime-start');
      ipcMain.handle('providers:runtime-start', (event, input) => {
        event.sender.send('providers:runtime-update', {
          subscriptionId: input.subscriptionId,
          event: {
            id: 'history-runtime', timestamp: Date.now(), level: 'info', source: 'serverless',
            message: 'Runtime output retained after quitting', method: 'POST', path: '/api/history',
            statusCode: 200, messageTruncated: false,
          },
        });
      });
    });
    let page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Create your first project' })).toBeVisible();
    await page.evaluate(savedApp => {
      localStorage.setItem('simply_logs_projects_v1', JSON.stringify([{
        id: savedApp.projectId, name: 'History project', description: '', color: '#6366f1', tags: [], createdAt: 1000,
      }]));
      localStorage.setItem('simply_logs_apps_v1', JSON.stringify([savedApp]));
    }, application({
      deploymentUrl: undefined,
      config: { connectionMode: 'account', credentialId: 'missing-test-credential', vercelProjectId: 'history-project' },
    }));
    await page.reload();
    await expect(page.getByText('Runtime output retained after quitting', { exact: true })).toBeVisible();
    await expect(page.getByText('Build output retained after quitting', { exact: true })).toBeVisible();
    await app.close();

    // A new process has no mocked provider history or runtime stream to replay.
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByText('Runtime output retained after quitting', { exact: true })).toBeVisible();
    await expect(page.getByText('Build output retained after quitting', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'serverless', exact: true }).click();
    await expect(page.getByText('Runtime output retained after quitting', { exact: true })).toBeVisible();
    await expect(page.getByText('Build output retained after quitting', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await app.close();

    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Add App', exact: true })).toBeVisible();
    await expect(page.getByText('Runtime output retained after quitting', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Build output retained after quitting', { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

for (const provider of ['vercel', 'netlify'] as const) {
  test(`${provider} tokens can be reused across projects, rediscovered, replaced and safely unlinked`, async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-token-reuse-'));
    const app = await electron.launch({
      args: [
        '.', `--user-data-dir=${profile}`, '--disable-gpu',
        ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      ],
      env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
    });
    try {
      const page = await app.firstWindow();
      const invalidDiscovery = await page.evaluate(async provider => {
        const errors: string[] = [];
        for (const input of [
          { provider, apiToken: 'placeholder', credentialId: 'missing' },
          { provider, credentialId: 'missing' },
        ]) {
          try { await window.simplyLogs!.discover(input as any); }
          catch (error) { errors.push(String(error)); }
        }
        return errors;
      }, provider);
      expect(invalidDiscovery[0]).toContain('Choose either a saved token or a new token');
      expect(invalidDiscovery[1]).toMatch(/No saved token|keychain is unavailable/);
      await app.evaluate(({ ipcMain }) => {
        const state = {
          saved: [] as string[], deleted: [] as string[],
          discoveries: [] as { provider: string; credentialId?: string; apiToken?: string; teamId?: string }[],
        };
        (globalThis as any).__tokenReuseTest = state;
        ipcMain.removeHandler('credentials:save');
        ipcMain.handle('credentials:save', (_event, id: string) => { state.saved.push(id); return { persistent: false }; });
        ipcMain.removeHandler('credentials:delete');
        ipcMain.handle('credentials:delete', (_event, id: string) => { state.deleted.push(id); });
        ipcMain.removeHandler('providers:discover');
        ipcMain.handle('providers:discover', (_event, input) => {
          if (input.credentialId && (!state.saved.includes(input.credentialId) || state.deleted.includes(input.credentialId))) {
            throw new Error('No saved token. Reconnect this application.');
          }
          state.discoveries.push(input);
          return [
            { name: 'First provider app', slug: 'first-app', projectId: 'project-first', siteId: 'site-first' },
            { name: 'Second provider app', slug: 'second-app', projectId: 'project-second', siteId: 'site-second' },
          ];
        });
        ipcMain.removeHandler('providers:deployments');
        ipcMain.handle('providers:deployments', () => []);
        ipcMain.removeHandler('providers:runtime-deployment');
        ipcMain.handle('providers:runtime-deployment', () => null);
        ipcMain.removeHandler('providers:runtime-history');
        ipcMain.handle('providers:runtime-history', () => ({ events: [], truncated: false }));
      });
      await page.getByTitle('Mute all sounds').click();
      await page.getByRole('button', { name: 'Create your first project' }).click();
      await page.getByLabel('Project Name').fill('First project');
      await page.getByRole('button', { name: 'Create project', exact: true }).click();
      await page.getByRole('button', { name: 'Add your first application' }).click();
      await page.getByLabel('Platform', { exact: true }).selectOption(provider);
      await page.getByLabel('Connection', { exact: true }).selectOption('account');
      await page.getByLabel('Personal access token', { exact: true }).fill('placeholder-reusable-token');
      await page.getByRole('button', { name: 'Discover applications' }).click();
      await page.getByRole('button', { name: 'First provider app', exact: true }).click();
      await page.getByLabel('Application name').fill('First app');
      await page.getByRole('button', { name: 'Add application', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Select First app', exact: true })).toBeVisible();
      const credentialId = await app.evaluate(() => (globalThis as any).__tokenReuseTest.saved[0] as string);

      await page.getByTitle('Create new project', { exact: true }).click();
      await page.getByLabel('Project Name').fill('Second project');
      await page.getByRole('button', { name: 'Create project', exact: true }).click();
      await page.getByRole('button', { name: 'Add your first application' }).click();
      await page.getByLabel('Platform', { exact: true }).selectOption(provider === 'vercel' ? 'netlify' : 'vercel');
      await page.getByLabel('Connection', { exact: true }).selectOption('account');
      const tokens = page.getByLabel('Access token', { exact: true });
      await expect(tokens).toBeEnabled();
      await expect(tokens.locator('option')).toHaveCount(1);
      await page.getByLabel('Personal access token', { exact: true }).fill('placeholder-discarded-token');
      await page.getByLabel('Platform', { exact: true }).selectOption(provider);
      await expect(page.getByLabel('Personal access token', { exact: true })).toHaveValue('');
      await expect(tokens.locator('option')).toHaveText(['Enter a new token', 'Token from First app']);
      await tokens.selectOption(credentialId);
      await expect(page.getByLabel('Personal access token', { exact: true })).toHaveCount(0);
      if (provider === 'vercel') await page.getByLabel('Team ID', { exact: true }).fill('second-team');
      await page.getByRole('button', { name: 'Discover applications' }).click();
      await page.getByRole('button', { name: 'Second provider app', exact: true }).click();
      await page.getByLabel('Application name').fill('Second app');
      await page.getByRole('button', { name: 'Add application', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Select Second app', exact: true })).toBeVisible();
      expect(await app.evaluate(() => (globalThis as any).__tokenReuseTest.saved.length)).toBe(1);
      const discovery = await app.evaluate(() => (globalThis as any).__tokenReuseTest.discoveries[1]);
      expect(discovery.credentialId).toBe(credentialId);
      expect(discovery).not.toHaveProperty('apiToken');
      if (provider === 'vercel') expect(discovery.teamId).toBe('second-team');
      const savedApps = () => page.evaluate(() => JSON.parse(localStorage.getItem('simply_logs_apps_v1')!) as {
        id: string; projectId: string; name: string; config: { credentialId: string };
      }[]);
      const linkedApps = await savedApps();
      expect(linkedApps.map(item => item.config.credentialId)).toEqual([credentialId, credentialId]);
      expect(linkedApps[0].projectId).not.toBe(linkedApps[1].projectId);
      expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('placeholder-reusable-token');

      await page.getByTitle('Edit Second app').click();
      await expect(tokens).toBeEnabled();
      await expect(tokens).toHaveValue(credentialId);
      await expect(tokens.locator('option')).toHaveCount(2);
      await page.getByRole('button', { name: 'Discover applications' }).click();
      await expect(page.getByRole('button', { name: 'Second provider app', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();

      await page.getByRole('button', { name: 'Second project', exact: true }).click();
      await page.getByRole('button', { name: 'First project', exact: true }).click();
      await page.getByTitle('Edit First app').click();
      await expect(tokens).toBeEnabled();
      await tokens.selectOption('');
      await page.getByLabel('Personal access token', { exact: true }).fill('placeholder-replacement-token');
      await page.getByLabel(provider === 'vercel' ? 'Project ID' : 'Site ID', { exact: true }).fill('replacement-target');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const replacementId = await app.evaluate(() => (globalThis as any).__tokenReuseTest.saved[1] as string);
      expect(replacementId).not.toBe(credentialId);
      expect(await app.evaluate(() => (globalThis as any).__tokenReuseTest.deleted)).toEqual([]);
      expect((await savedApps()).find(item => item.name === 'Second app')!.config.credentialId).toBe(credentialId);

      await page.getByTitle('Edit First app').click();
      await expect(tokens).toBeEnabled();
      await expect(tokens).toHaveValue(replacementId);
      await expect(tokens.locator('option')).toHaveCount(3);
      await tokens.selectOption(credentialId);
      await page.getByLabel(provider === 'vercel' ? 'Project ID' : 'Site ID', { exact: true }).fill('original-target');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await app.evaluate(() => (globalThis as any).__tokenReuseTest.deleted)).toEqual([replacementId]);
      expect(await app.evaluate(() => (globalThis as any).__tokenReuseTest.saved.length)).toBe(2);
      await page.getByTitle('Delete application', { exact: true }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add your first application' })).toBeVisible();
      expect(await app.evaluate(() => (globalThis as any).__tokenReuseTest.deleted)).toEqual([replacementId]);

      await page.getByRole('button', { name: 'First project', exact: true }).click();
      await page.getByRole('button', { name: 'Second project', exact: true }).click();
      await page.getByRole('button', { name: 'Add App', exact: true }).click();
      await page.getByLabel('Platform', { exact: true }).selectOption(provider);
      await page.getByLabel('Connection', { exact: true }).selectOption('account');
      await expect(tokens).toBeEnabled();
      await expect(tokens.locator('option')).toHaveText(['Enter a new token', 'Token from Second app']);
      await tokens.selectOption(credentialId);
      await page.getByRole('button', { name: 'Discover applications' }).click();
      await expect(page.getByRole('button', { name: 'Second provider app', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Second project', exact: true }).click();
      page.once('dialog', dialog => void dialog.accept());
      await page.getByRole('button', { name: 'Delete current project', exact: true }).click();
      await expect(page.getByRole('button', { name: 'First project', exact: true })).toBeVisible();
      await expect.poll(() => app.evaluate(() => (globalThis as any).__tokenReuseTest.deleted)).toEqual([replacementId, credentialId]);
      expect(await savedApps()).toEqual([]);
    } finally {
      await app.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}

test('project editing saves metadata without changing applications, logs, filters or monitoring state', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-project-edit-'));
  const app = await electron.launch({
    args: [
      '.', `--user-data-dir=${profile}`, '--disable-gpu',
      ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Create your first project' })).toBeVisible();
    const original: Project = {
      id: 'project-one', name: 'Original project', description: 'Original description',
      color: '#6366f1', tags: ['Production', 'Vercel'], createdAt: 0,
    };
    const other: Project = { ...original, id: 'project-two', name: 'Other project', description: 'Other description', tags: [] };
    const applications = [
      application({ name: 'Preview app', environment: 'preview', deploymentUrl: undefined }),
      application({ id: 'production-app', name: 'Production app', deploymentUrl: undefined }),
    ];
    const logs = [
      entry({ id: 'preview-log', applicationName: 'Preview app', environment: 'preview', message: 'Preview log retained' }),
      entry({ id: 'production-log', applicationId: 'production-app', applicationName: 'Production app', message: 'Production log retained' }),
    ];
    await page.evaluate(({ projects, applications, logs }) => {
      localStorage.setItem('simply_logs_projects_v1', JSON.stringify(projects));
      localStorage.setItem('simply_logs_apps_v1', JSON.stringify(applications));
      localStorage.setItem('simply_logs_history_v1', JSON.stringify(logs));
    }, { projects: [original, other], applications, logs });
    await page.reload();
    await page.getByRole('button', { name: 'prev', exact: true }).click();
    await page.getByRole('button', { name: 'Select Preview app', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const linkedData = () => page.evaluate(() => ({
      applications: localStorage.getItem('simply_logs_apps_v1'),
      logs: localStorage.getItem('simply_logs_history_v1'),
    }));
    const before = await linkedData();
    const savedProjects = () => page.evaluate(() => JSON.parse(localStorage.getItem('simply_logs_projects_v1')!) as Project[]);
    await page.getByRole('button', { name: 'Original project', exact: true }).click();
    await page.getByRole('button', { name: 'Edit current project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true });
    await expect(dialog.getByLabel('Project Name')).toHaveValue(original.name);
    await expect(dialog.getByLabel('Project Name')).toBeFocused();
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(original.description);
    await expect(dialog.getByLabel('Tags (comma separated)', { exact: true })).toHaveValue('Production, Vercel');
    await expect(dialog.getByRole('button', { name: `Project color ${original.color}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByLabel('Project Name').fill('   ');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a project name.');
    expect(await savedProjects()).toEqual([original, other]);
    await dialog.getByLabel('Project Name').fill('  Renamed project  ');
    await dialog.getByLabel('Description', { exact: true }).fill('  Updated description  ');
    await dialog.getByLabel('Tags (comma separated)', { exact: true }).fill('Customer-facing, Production, , ');
    await dialog.getByRole('button', { name: 'Project color #10b981', exact: true }).click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as any).__restoreProjectStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function(key, value) {
        if (key === 'simply_logs_projects_v1') throw new Error('Storage full');
        original.call(this, key, value);
      };
    });
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Changes could not be saved');
    await expect(dialog.getByLabel('Project Name')).toHaveValue('  Renamed project  ');
    expect(await savedProjects()).toEqual([original, other]);
    await page.evaluate(() => (window as any).__restoreProjectStorage());
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const updated = { ...original, name: 'Renamed project', description: 'Updated description', color: '#10b981', tags: ['Customer-facing', 'Production'] };
    expect(await savedProjects()).toEqual([updated, other]);
    await expect(page.getByRole('heading', { name: updated.name, exact: true })).toBeVisible();
    await expect(page.getByText(updated.description, { exact: true })).toBeVisible();
    await expect(page.getByText('Customer-facing', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: updated.name, exact: true }).locator('span').first()).toHaveCSS('background-color', 'rgb(16, 185, 129)');
    await expect(page.getByRole('button', { name: 'Select Preview app', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Select Production app', exact: true })).toHaveCount(0);
    await expect(page.getByText('Preview log retained', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    expect(await linkedData()).toEqual(before);

    await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    await expect(dialog.getByLabel('Project Name')).toHaveValue(updated.name);
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(updated.description);
    await expect(dialog.getByLabel('Tags (comma separated)', { exact: true })).toHaveValue('Customer-facing, Production');
    await expect(dialog.getByRole('button', { name: 'Project color #10b981', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByLabel('Project Name').fill('Discard this draft');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await savedProjects()).toEqual([updated, other]);
    await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    await expect(dialog.getByLabel('Project Name')).toHaveValue(updated.name);
    await dialog.getByLabel('Description', { exact: true }).fill('');
    await dialog.getByLabel('Tags (comma separated)', { exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const cleared = { ...updated, description: '', tags: [] };
    expect(await savedProjects()).toEqual([cleared, other]);
    await page.getByTitle('Create new project', { exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Create project', exact: true });
    await expect(create.getByLabel('Project Name')).toHaveValue('');
    await expect(create.getByLabel('Description', { exact: true })).toHaveValue('');
    await expect(create.getByLabel('Tags (comma separated)', { exact: true })).toHaveValue('');
    await expect(create.getByRole('button', { name: 'Project color #6366f1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: cleared.name, exact: true })).toBeVisible();
    await expect(page.getByText('Preview log retained', { exact: true })).toBeVisible();
    await expect(page.getByText('Production log retained', { exact: true })).toBeVisible();
    expect(await linkedData()).toEqual(before);
    expect(await savedProjects()).toEqual([cleared, other]);
    await page.getByRole('button', { name: cleared.name, exact: true }).click();
    await page.getByRole('button', { name: other.name, exact: true }).click();
    await page.getByRole('button', { name: 'Edit project', exact: true }).click();
    await expect(dialog.getByLabel('Project Name')).toHaveValue(other.name);
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(other.description);
    await dialog.getByLabel('Project Name').fill('Other renamed');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await savedProjects()).toEqual([cleared, { ...other, name: 'Other renamed' }]);
    await expect(page.getByRole('button', { name: 'Other renamed', exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('request routes and HTTP methods remain available in rows, details, search, copies and exports', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-http-methods-'));
  const app = await electron.launch({
    args: [
      '.', `--user-data-dir=${profile}`, '--disable-gpu',
      ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
  });
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop:copy');
      ipcMain.handle('desktop:copy', (_event, text: string) => { (globalThis as any).__methodCopy = text; });
      ipcMain.removeHandler('desktop:export');
      ipcMain.handle('desktop:export', (_event, json: string) => { (globalThis as any).__methodExport = json; return true; });
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Create your first project' })).toBeVisible();
    const savedApp = application({ name: 'Request demo', deploymentUrl: undefined });
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] as const;
    const savedLogs = [
      ...methods.map(method => entry({
        id: `request-${method}`, applicationName: savedApp.name, source: 'serverless', method, path: '/api/orders',
        statusCode: method === 'POST' ? 201 : 204, latencyMs: 24, region: 'iad1', message: 'Same request output',
        host: 'requests.example.com', requestId: `provider-${method}`,
        payload: { deploymentId: 'deployment-orders', functionName: 'orders' },
        observation: undefined, monitorKind: undefined,
      })),
      entry({
        id: 'no-method', applicationName: savedApp.name, source: 'build', message: 'Deployment ready',
        observation: undefined, monitorKind: undefined,
      }),
      entry({
        id: 'no-route', applicationName: savedApp.name, source: 'serverless', message: 'Console output without request metadata',
        statusCode: undefined, latencyMs: undefined,
        observation: undefined, monitorKind: undefined,
      }),
    ];
    await page.evaluate(({ savedApp, savedLogs }) => {
      localStorage.setItem('simply_logs_projects_v1', JSON.stringify([{
        id: savedApp.projectId, name: 'Requests project', description: '', color: '#6366f1', tags: [], createdAt: 1000,
      }]));
      localStorage.setItem('simply_logs_apps_v1', JSON.stringify([savedApp]));
      localStorage.setItem('simply_logs_history_v1', JSON.stringify(savedLogs));
    }, { savedApp, savedLogs });
    await page.reload();
    const workspace = page.getByRole('main');
    const requestRows = workspace.getByText('Same request output', { exact: true }).locator('../..');
    await expect(requestRows).toHaveCount(methods.length);
    for (const size of [{ width: 1280, height: 820 }, { width: 920, height: 620 }]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size);
      for (const method of methods) {
        const row = requestRows.filter({ has: page.getByTitle(`HTTP method: ${method}`, { exact: true }) });
        await expect(row).toHaveCount(1);
        await row.scrollIntoViewIfNeeded();
        await expect(row.getByTitle(`HTTP method: ${method}`, { exact: true })).toHaveText(method);
        await expect(row.getByTitle(`HTTP method: ${method}`, { exact: true })).toBeInViewport({ ratio: 1 });
        await expect(row.getByTitle('Request route: /api/orders', { exact: true })).toBeInViewport({ ratio: 1 });
        await expect(row.getByTitle('Inspect log details')).toBeInViewport({ ratio: 1 });
      }
    }
    const noMethod = workspace.getByText('Deployment ready', { exact: true }).locator('../..');
    await expect(noMethod.locator('[title^="HTTP method:"]')).toHaveCount(0);
    await expect(noMethod.locator('[title^="Request route:"]')).toHaveCount(0);
    const noRoute = workspace.getByText('Console output without request metadata', { exact: true }).locator('../..');
    await expect(noRoute.getByText('Route not provided', { exact: true })).toBeVisible();
    await noRoute.getByTitle('Inspect log details').click();
    const missingContext = page.getByRole('region', { name: 'Request context' });
    await expect(missingContext.getByRole('definition').first()).toHaveText('Not provided');
    await expect(missingContext.getByRole('definition').nth(1)).toHaveText('Not provided');
    await expect(missingContext.getByRole('definition').nth(2)).toHaveText('Not provided');
    await expect(page.getByRole('dialog').getByText('Global Edge', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const search = page.getByPlaceholder('Search logs', { exact: false });
    await search.fill('oPtIoNs');
    await expect(requestRows).toHaveCount(1);
    await expect(workspace.getByTitle('HTTP method: OPTIONS', { exact: true })).toBeVisible();
    await expect(noMethod).toHaveCount(0);
    await page.getByTitle('Copy filtered logs to clipboard', { exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).__methodCopy)).toContain('[OPTIONS] [/api/orders] Same request output');
    await page.getByTitle('Export logs as JSON file', { exact: true }).click();
    const exported = JSON.parse(await app.evaluate(() => (globalThis as any).__methodExport as string));
    expect(exported).toHaveLength(1);
    expect(exported[0].method).toBe('OPTIONS');
    expect(exported[0].path).toBe('/api/orders');
    await search.fill('post');
    await expect(requestRows).toHaveCount(1);
    await workspace.getByTitle('Inspect log details').click();
    const details = page.getByRole('dialog', { name: 'Log details' });
    await expect(details).toContainText('POST (201)');
    const context = details.getByRole('region', { name: 'Request context' });
    for (const [label, value] of [
      ['Route', '/api/orders'], ['Host', 'requests.example.com'], ['Request ID', 'provider-POST'],
      ['Environment', 'production'], ['Deployment ID', 'deployment-orders'], ['Function', 'orders'],
    ]) {
      await expect(context.locator('div').filter({ has: page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }) }).getByRole('definition')).toHaveText(value);
    }
    await page.keyboard.press('Escape');
    await search.fill('/api/orders');
    await expect(requestRows).toHaveCount(methods.length);
    await search.fill('REQUESTS.EXAMPLE.COM');
    await expect(requestRows).toHaveCount(methods.length);
    await search.fill('');
    await expect(requestRows).toHaveCount(methods.length);
    await page.getByTitle('Copy filtered logs to clipboard', { exact: true }).click();
    const copied = await app.evaluate(() => (globalThis as any).__methodCopy as string);
    for (const method of methods) expect(copied).toContain(`[${method}] [/api/orders] Same request output`);
    expect(copied.split('\n').find(line => line.includes('Deployment ready'))).toMatch(/\[Request demo\] Deployment ready$/);
    await page.getByTitle('Export logs as JSON file', { exact: true }).click();
    const allExported = JSON.parse(await app.evaluate(() => (globalThis as any).__methodExport as string));
    expect(allExported.map((log: { method?: string }) => log.method).filter(Boolean)).toEqual(methods);
    expect(allExported.find((log: { id: string }) => log.id === 'no-method')).not.toHaveProperty('method');
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('large log details keep header controls visible, copy full JSON and dismiss only from the backdrop or close controls', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-log-details-'));
  const app = await electron.launch({
    args: [
      '.', `--user-data-dir=${profile}`, '--disable-gpu',
      ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
  });
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('desktop:copy');
      ipcMain.handle('desktop:copy', (_event, json: string) => { (globalThis as any).__copiedLogJson = json; });
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Create your first project' })).toBeVisible();
    const savedApp = application({ name: `Application-${'a'.repeat(300)}`, deploymentUrl: undefined });
    const largeLog = entry({
      id: `request-${'b'.repeat(400)}`, applicationName: savedApp.name, level: 'error', source: 'serverless',
      path: `/api/${'long-route-segment/'.repeat(80)}?page=2`, host: `${'hostname'.repeat(40)}.example.com`,
      requestId: `provider-${'c'.repeat(400)}`,
      message: ['Large log fixture', ...Array.from({ length: 150 }, (_, i) => `Message line ${i}: ${'details '.repeat(20)}`)].join('\n'),
      stackTrace: ['Error: large log fixture', ...Array.from({ length: 80 }, (_, i) => `  at handler (/functions/${'path'.repeat(40)}:${i})`)].join('\n'),
      payload: { requestId: 'full-request-id', data: 'x'.repeat(3000), lines: Array.from({ length: 50 }, (_, i) => `Payload line ${i}`) },
      observation: undefined, monitorKind: undefined,
    });
    await page.evaluate(({ savedApp, largeLog }) => {
      localStorage.setItem('simply_logs_projects_v1', JSON.stringify([{
        id: savedApp.projectId, name: 'Log details project', description: '', color: '#6366f1', tags: [], createdAt: 1000,
      }]));
      localStorage.setItem('simply_logs_apps_v1', JSON.stringify([savedApp]));
      localStorage.setItem('simply_logs_history_v1', JSON.stringify([largeLog]));
    }, { savedApp, largeLog });
    await page.reload();
    const logRow = page.getByText(/^Large log fixture/);
    const dialog = page.getByRole('dialog', { name: 'Log details' });
    const panel = dialog.locator(':scope > div');
    const header = panel.locator(':scope > div').first();
    const body = panel.locator(':scope > div').nth(1);

    for (const size of [{ width: 1280, height: 820 }, { width: 920, height: 620 }]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size);
      await logRow.click();
      await expect(dialog.getByRole('region', { name: 'Request context' }).getByRole('definition').nth(1)).toHaveText(largeLog.host!);
      const copy = dialog.getByRole('button', { name: 'Copy Log JSON', exact: true });
      const close = dialog.getByRole('button', { name: 'Close log details', exact: true });
      await expect(copy).toBeFocused();
      const bounds = await panel.boundingBox();
      const copyBounds = await copy.boundingBox();
      const closeBounds = await close.boundingBox();
      expect(copyBounds!.height).toBeLessThanOrEqual(36);
      expect(copyBounds!.width).toBeGreaterThan(100);
      expect(copyBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(copyBounds!.x + copyBounds!.width).toBeLessThanOrEqual(closeBounds!.x);
      expect(closeBounds!.x + closeBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      expect(copyBounds!.y).toBeGreaterThanOrEqual(bounds!.y);
      expect(copyBounds!.y + copyBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
      expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await expect(dialog.getByRole('region', { name: 'Request context' }).getByRole('definition').first()).toHaveText(largeLog.path!);
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(copy).toBeFocused();
      await copy.click();
      await expect(dialog.getByRole('button', { name: 'Copied JSON', exact: true })).toBeVisible();
      expect(JSON.parse(await app.evaluate(() => (globalThis as any).__copiedLogJson as string))).toEqual(JSON.parse(JSON.stringify(largeLog)));
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(close).toBeInViewport();
      expect((await close.boundingBox())!.y).toBe(closeBounds!.y);
      await dialog.getByText('Log Message', { exact: true }).click();
      await expect(dialog).toBeVisible();
      const contentBounds = await body.boundingBox();
      await page.mouse.move(contentBounds!.x + 20, contentBounds!.y + 20);
      await page.mouse.down();
      await page.mouse.move(8, 8);
      await page.mouse.up();
      await expect(dialog).toBeVisible();
      await dialog.click({ position: { x: 8, y: 8 } });
      await expect(dialog).toHaveCount(0);
    }
    await logRow.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await logRow.click();
    await dialog.getByRole('button', { name: 'Close log details', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('Netlify onboarding loads Function/Edge history, streams live logs and restores them after restart', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'simply-logs-netlify-'));
  const launch = () => electron.launch({
    args: [
      '.', `--user-data-dir=${profile}`, '--disable-gpu',
      ...(process.env.SIMPLY_LOGS_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, SIMPLY_LOGS_DEV_URL: '' },
  });
  let app = await launch();
  try {
    await app.evaluate(({ ipcMain }) => {
      const state = { started: [] as string[], stopped: [] as string[], historyRequests: 0, buildRequests: 0 };
      (globalThis as any).__netlifyTest = state;
      ipcMain.removeHandler('credentials:save');
      ipcMain.handle('credentials:save', () => ({ persistent: false }));
      ipcMain.removeHandler('providers:discover');
      ipcMain.handle('providers:discover', (_event, input) => {
        if (input.provider !== 'netlify') throw new Error('Expected Netlify discovery.');
        return [{ name: 'Netlify app', slug: 'netlify-app', siteId: 'netlify-site' }];
      });
      ipcMain.removeHandler('providers:deployments');
      ipcMain.handle('providers:deployments', () => [{ id: 'netlify-published', state: 'ready', createdAt: Date.now() }]);
      ipcMain.removeHandler('providers:events');
      ipcMain.handle('providers:events', () => { state.buildRequests++; return []; });
      ipcMain.removeHandler('providers:runtime-deployment');
      ipcMain.handle('providers:runtime-deployment', (_event, input) => {
        if (input.provider !== 'netlify' || input.environment !== 'production') throw new Error('Expected Netlify production.');
        return 'netlify-published';
      });
      ipcMain.removeHandler('providers:runtime-history');
      ipcMain.handle('providers:runtime-history', (_event, input) => {
        if (input.provider !== 'netlify') throw new Error('Expected Netlify history.');
        state.historyRequests++;
        return { events: [{
          id: 'netlify-function-history', deploymentId: 'netlify-published', timestamp: Date.now() - 30 * 60 * 1000,
          source: 'serverless', level: 'warn', message: 'Past Netlify Function output', functionName: 'checkout',
          requestId: 'netlify-request-one', messageTruncated: false, logs: [],
        }, {
          id: 'netlify-edge-history', deploymentId: 'netlify-published', timestamp: Date.now() - 20 * 60 * 1000,
          source: 'edge', level: 'info', message: 'Past Netlify Edge output', functionName: 'middleware',
          path: '/checkout', messageTruncated: false, logs: [],
        }], truncated: false, warnings: [], retry: false };
      });
      ipcMain.removeHandler('providers:runtime-start');
      ipcMain.handle('providers:runtime-start', (event, input) => {
        if (input.provider !== 'netlify') throw new Error('Expected Netlify runtime stream.');
        state.started.push(input.subscriptionId);
        for (const value of [
          { id: 'netlify-function-history', source: 'serverless', message: 'Past Netlify Function output', functionName: 'checkout', requestId: 'netlify-request-one' },
          { id: 'netlify-function-live', source: 'serverless', message: 'Live Netlify Function output', functionName: 'checkout' },
          { id: 'netlify-edge-live', source: 'edge', message: 'Live Netlify Edge output', functionName: 'middleware' },
        ]) {
          event.sender.send('providers:runtime-update', {
            subscriptionId: input.subscriptionId,
            event: { ...value, timestamp: Date.now(), level: 'info', messageTruncated: false },
          });
        }
      });

      ipcMain.removeHandler('providers:runtime-stop');
      ipcMain.handle('providers:runtime-stop', (_event, id: string) => { state.stopped.push(id); });
    });
    let page = await app.firstWindow();
    await page.getByTitle('Mute all sounds').click();
    await page.getByRole('button', { name: 'Create your first project' }).click();
    await page.getByLabel('Project Name').fill('Netlify project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('button', { name: 'Add your first application' }).click();
    await page.getByLabel('Platform', { exact: true }).selectOption('netlify');
    await page.getByLabel('Connection', { exact: true }).selectOption('account');
    await expect(page.getByRole('dialog')).toContainText('past-hour Function/Edge Function history');
    await page.getByLabel('Personal access token', { exact: true }).fill('placeholder-netlify-test-token');
    await page.getByRole('button', { name: 'Discover applications' }).click();
    await page.getByRole('button', { name: 'Netlify app', exact: true }).click();
    await page.getByRole('button', { name: 'Add application', exact: true }).click();
    await expect(page.getByText('Past Netlify Function output', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Past Netlify Edge output', { exact: true })).toBeVisible();
    await expect(page.getByText('Live Netlify Function output', { exact: true })).toBeVisible();
    await expect(page.getByText('Live Netlify Edge output', { exact: true })).toBeVisible();
    await page.getByText('Past Netlify Function output', { exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Log details' })).toContainText('checkout');
    await expect(page.getByRole('dialog', { name: 'Log details' })).toContainText('netlify-request-one');
    await page.getByLabel('Close log details', { exact: true }).click();
    await page.getByRole('button', { name: 'serverless', exact: true }).click();
    await expect(page.getByText('Live Netlify Function output', { exact: true })).toBeVisible();
    await expect(page.getByText('Live Netlify Edge output', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'edge', exact: true }).click();
    await expect(page.getByText('Live Netlify Edge output', { exact: true })).toBeVisible();
    await expect(page.getByText('Live Netlify Function output', { exact: true })).toHaveCount(0);
    const subscriptionId = await app.evaluate(() => (globalThis as any).__netlifyTest.started[0] as string);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect.poll(() => app.evaluate((_electron, id) => (globalThis as any).__netlifyTest.stopped.includes(id), subscriptionId)).toBe(true);
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0].webContents.send('providers:runtime-update', {
        subscriptionId: id,
        event: { id: 'late-netlify', timestamp: Date.now(), level: 'info', source: 'edge', message: 'Late cancelled Netlify output', messageTruncated: false },
      });
    }, subscriptionId);
    await expect(page.getByText('Late cancelled Netlify output', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__netlifyTest.historyRequests)).toBe(2);
    await page.getByRole('button', { name: 'serverless', exact: true }).click();
    await expect(page.getByText('Past Netlify Function output', { exact: true })).toHaveCount(1);
    expect(await app.evaluate(() => (globalThis as any).__netlifyTest.buildRequests)).toBe(0);
    expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('placeholder-netlify-test-token');
    await app.close();

    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByText('Past Netlify Function output', { exact: true })).toBeVisible();
    await expect(page.getByText('Past Netlify Edge output', { exact: true })).toBeVisible();
    await expect(page.getByText('Live Netlify Function output', { exact: true })).toBeVisible();
    await expect(page.getByText('Live Netlify Edge output', { exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
