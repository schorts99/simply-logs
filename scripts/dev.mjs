import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

await import('./build-desktop.mjs');
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, SIMPLY_LOGS_DEV_URL: 'http://127.0.0.1:5173' },
});
const stop = async () => {
  child.kill();
  await server.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', async error => {
  console.error(error);
  await server.close();
  process.exitCode = 1;
});
child.once('exit', async code => {
  await server.close();
  process.exitCode = code ?? 0;
});
