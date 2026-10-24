import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
    });
    const page = await app.firstWindow();
    const workspace = page.getByRole('main');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page).toHaveTitle('Simply Logs');
    if (process.platform !== 'darwin') {
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()))
        .toBe(process.platform !== 'win32');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarAutoHide())).toBe(false);
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
    expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('placeholder-desktop-test-token');
    await page.screenshot({ path: info.outputPath('workspace.png') });

    await page.getByRole('button', { name: 'Primary project', exact: true }).click();
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByLabel('Project Name').fill('Empty project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add your first application' })).toBeVisible();
    await expect(page.getByText('Actual provider build event fixture')).toHaveCount(0);
    await expect(workspace.getByText(/^GET https:\/\//)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('desktop.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
