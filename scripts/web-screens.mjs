/**
 * Headless Edge screenshots of a running build (A126): title, creator, game, combat and load screens.
 * Usage: node scripts/web-screens.mjs [baseUrl] [--verbose]  (default http://localhost:4199/, e.g. after
 * `npm run build:web` + `npm run preview:web -- --port 4199`).
 * Drives Edge over the DevTools protocol (Node's built-in WebSocket): waits for the page to settle,
 * writes userdata/shots/<name>.png and reports page exceptions and console errors; exits 1 if any.
 * (Edge's one-shot `--screenshot` fires before lazily imported chunks render and hides page errors.)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const verbose = process.argv.includes('--verbose');
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:4199/';
const out = resolve('userdata', 'shots');
mkdirSync(out, { recursive: true });
const PORT = 9333;
const SETTLE_MS = 6000;

const EDGE = [
  join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
].find((p) => existsSync(p));
if (!EDGE) {
  console.error('Microsoft Edge not found.');
  process.exit(2);
}

const SCREENS = [
  ['title', ''],
  ['creator', '#creator'],
  ['game', '#play-fighter'],
  ['combat', '#combat-fighter'],
  ['load', '#load'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over one page target. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  return {
    send: (method, params = {}) =>
      new Promise((res) => {
        const n = ++id;
        waiting.set(n, res);
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const profile = join(out, 'edge-profile');
rmSync(profile, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });

let failed = false;
try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json(), () => undefined);
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) throw new Error('No Edge page target.');
  const c = await cdp(page.webSocketDebuggerUrl);
  const problems = [];
  const consoleLines = [];
  c.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description ?? d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`${msg.params.type}: ${text}`);
      if (msg.params.type === 'error') problems.push(`console.error: ${text}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    }
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [name, hash] of SCREENS) {
    problems.length = 0;
    consoleLines.length = 0;
    // Fresh storage per screen: no saves/settings left over from the previous one.
    await c.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
    await c.send('Page.navigate', { url: 'about:blank' });
    await c.send('Page.navigate', { url: base + hash });
    await sleep(SETTLE_MS);
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    const text = await c.send('Runtime.evaluate', { expression: "document.getElementById('app')?.innerText.length ?? 0", returnByValue: true });
    const chars = text.result.result.value;
    if (!chars) problems.push('empty page (#app has no text)');
    console.log(`${name}: ${chars} chars of text, ${problems.length} problems`);
    for (const p of problems) console.log(`  ${p.slice(0, 600)}`);
    if (verbose) for (const l of consoleLines) console.log(`  ${l.slice(0, 300)}`);
    if (problems.length) failed = true;
  }
  c.close();
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  edge.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(failed ? 1 : 0);
