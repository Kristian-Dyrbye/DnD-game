/**
 * Server entry point: builds the app and listens on localhost only — or, when Settings → Table →
 * "Allow a friend to join" is on at start (co-op, C005), on the LAN too, printing the join links.
 * Env: PORT (default 3210), OPEN_BROWSER=1 opens the game in the default browser once listening.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildApp } from './app';
import { DEFAULT_PORT } from './port';
import { SettingsStore } from './settingsStore';
import { joinUrls } from './lan';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const root = process.cwd();
const userDataDir = path.join(root, 'userdata');
const lan = new SettingsStore(userDataDir).get().table.allowJoin;

const app = await buildApp({
  clientDir: path.join(root, 'dist', 'client'),
  userDataDir,
  savesDir: path.join(root, 'saves'),
  rootDir: root,
  logger: true,
  lan,
});
await app.listen({ port, host: lan ? '0.0.0.0' : '127.0.0.1' });

if (lan) {
  const urls = joinUrls(port, app.joinCode);
  console.log('');
  console.log(`  A friend on your network can join with code ${app.joinCode}:`);
  for (const url of urls) console.log(`    ${url}`);
  if (urls.length === 0) console.log('    (no network found: connect this PC to Wi-Fi or a cable)');
  console.log('  If Windows Firewall asks, allow Node.js on private networks.');
  console.log('');
}

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
