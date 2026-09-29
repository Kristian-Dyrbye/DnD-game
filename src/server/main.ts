/**
 * Server entry point: builds the app and listens on localhost only (never exposed to the network).
 * Env: PORT (default 3210), OPEN_BROWSER=1 opens the game in the default browser once listening.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildApp } from './app';
import { DEFAULT_PORT } from './port';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const root = process.cwd();

const app = await buildApp({
  clientDir: path.join(root, 'dist', 'client'),
  userDataDir: path.join(root, 'userdata'),
  savesDir: path.join(root, 'saves'),
  rootDir: root,
  logger: true,
});
await app.listen({ port, host: '127.0.0.1' });

if (process.env.OPEN_BROWSER === '1') openBrowser(`http://127.0.0.1:${port}`);

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
