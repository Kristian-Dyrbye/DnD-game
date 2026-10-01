/**
 * Co-op two-browser check (C008): starts the game server (mock AI, temp saves/settings, table open with
 * code ABC234, 127.0.0.1 only so no firewall prompt) and drives two isolated headless Edge pages over the
 * DevTools protocol: the host plays `#play-fighter` and opens the Table panel; a guest opens the join link,
 * joins as a player, quick-builds a rogue, adds it to the party and suggests an action; the host takes the
 * suggestion. Screenshots go to userdata/shots/coop-*.png; page exceptions/console errors fail the run.
 * Usage: `npm run build` first, then `npx tsx scripts/coop-screens.ts [--verbose]`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../src/server/app';
import { MockLlm } from '../src/llm/mock';
import { MockTts } from '../src/tts/mock';

const verbose = process.argv.includes('--verbose');
const root = process.cwd();
const out = resolve('userdata', 'shots');
mkdirSync(out, { recursive: true });
const GAME_PORT = 4211;
const CDP_PORT = 9334;
const CODE = 'ABC234';
const base = `http://127.0.0.1:${GAME_PORT}/`;

const EDGE = [
  join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
].find((p) => existsSync(p));
if (!EDGE) {
  console.error('Microsoft Edge not found.');
  process.exit(2);
}
if (!existsSync(join(root, 'dist', 'client', 'index.html'))) {
  console.error('No dist/client build: run `npm run build` first.');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Msg = { id?: number; method?: string; params?: any; result?: any };

/** Minimal CDP client over one websocket (a page target, or the browser). */
async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiting = new Map<number, (m: Msg) => void>();
  const listeners: ((m: Msg) => void)[] = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as Msg;
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)!(msg);
      waiting.delete(msg.id);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  return {
    send: (method: string, params: object = {}) =>
      new Promise<Msg>((res) => {
        const n = ++id;
        waiting.set(n, res);
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    on: (fn: (m: Msg) => void) => listeners.push(fn),
    close: () => ws.close(),
  };
}
type Cdp = Awaited<ReturnType<typeof cdp>>;

/** A page in its own browser context (own localStorage, like a second browser). */
async function openPage(browser: Cdp, name: string, width: number, height: number, mobile = false) {
  const ctx = await browser.send('Target.createBrowserContext');
  const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.result.browserContextId });
  const targetId = target.result.targetId as string;
  const list = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json())) as { id: string; webSocketDebuggerUrl: string }[];
  const page = list.find((t) => t.id === targetId);
  if (!page) throw new Error(`No target for ${name}`);
  const c = await cdp(page.webSocketDebuggerUrl);
  const problems: string[] = [];
  const consoleLines: string[] = [];
  c.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description ?? d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`${msg.params.type}: ${text}`);
      if (msg.params.type === 'error') problems.push(`console.error: ${text}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    }
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const evaluate = async (expression: string) => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return {
    name,
    problems,
    consoleLines,
    go: (url: string) => c.send('Page.navigate', { url }),
    evaluate,
    /** Clicks the first visible enabled button whose text starts with `text` (or contains it with `anywhere`). */
    click: async (text: string, anywhere = false): Promise<boolean> =>
      !!(await evaluate(`(() => {
        const want = ${JSON.stringify(text)};
        const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && x.offsetParent !== null &&
          (${anywhere} ? x.textContent.includes(want) : x.textContent.trim().startsWith(want)));
        if (b) b.click();
        return !!b;
      })()`)),
    /** Types into the first text input (Preact listens to `input`). */
    type: (value: string) =>
      evaluate(`(() => {
        const i = document.querySelector('input[type=text]');
        if (!i) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)});
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`),
    text: () => evaluate("document.getElementById('app')?.innerText ?? ''") as Promise<string>,
    shot: async (file: string) => {
      const s = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, `coop-${file}.png`), Buffer.from(s.result.data, 'base64'));
      console.log(`shot coop-${file}.png (${name})`);
    },
    close: () => c.close(),
  };
}

const tmp = mkdtempSync(join(os.tmpdir(), 'coop-screens-'));
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir);
writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ table: { allowJoin: true } }));
const app = await buildApp({
  clientDir: join(root, 'dist', 'client'),
  userDataDir,
  savesDir: join(tmp, 'saves'),
  rootDir: root,
  services: { llm: new MockLlm(), tts: new MockTts() },
  joinCode: CODE,
  lan: true,
});
await app.listen({ port: GAME_PORT, host: '127.0.0.1' });

const profile = join(out, 'edge-profile-coop');
rmSync(profile, { recursive: true, force: true });
const edge = spawn(EDGE, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });

const steps: string[] = [];
const check = (ok: unknown, what: string) => {
  steps.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
let failed = false;
try {
  let version: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json(), () => undefined);
  }
  if (!version) throw new Error('Edge did not start.');
  const browser = await cdp(version.webSocketDebuggerUrl);
  const host = await openPage(browser, 'host', 1400, 900);
  const guest = await openPage(browser, 'guest', 1400, 900);

  // 1. Host starts a game and opens the Table panel (code, links, QR).
  await host.go(`${base}#play-fighter`);
  await sleep(7000);
  await host.shot('01-host-game');
  check(await host.click('Table'), 'host: Table button in the game menu');
  await sleep(1500);
  check((await host.text()).includes(CODE), 'host: Table panel shows the join code');
  check(await host.evaluate("!!document.querySelector('.table-panel svg, svg.qr, [class*=qr] svg, svg[class*=qr]')"), 'host: Table panel draws a QR code');
  await host.shot('02-host-table');
  await host.click('Close');
  await host.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

  // 2. Guest opens the join link, joins as a player and builds a hero.
  await guest.go(`${base}?join=${CODE}`);
  await sleep(4000);
  check((await guest.text()).includes('Join the table'), 'guest: join screen on ?join=');
  await guest.shot('03-guest-join');
  await guest.type('Kim');
  check(await guest.click('Join the table'), 'guest: join as player');
  await sleep(5000);
  await guest.shot('04-guest-creator');
  check(await guest.click('Rogue'), 'guest: pick Rogue in the creator');
  await sleep(500);
  check(await guest.click('Quick Build a'), 'guest: Quick Build');
  await sleep(800);
  check((await guest.text()).includes('Add to the party'), 'guest: Quick Build lands on Review (Add to the party)');
  await guest.shot('05-guest-review');
  check(await guest.click('Add to the party'), 'guest: Add to the party');
  await sleep(5000);
  check((await guest.text()).includes('Suggest'), 'guest: game screen with Suggest buttons');
  await guest.shot('06-guest-game');
  // Nothing a guest page sends by itself may be refused (C008 found the hero thumbnail doing that).
  check(!(await guest.evaluate("!!document.querySelector('.game-error')")), 'guest: no error banner after joining');
  check(!(await host.evaluate("!!document.querySelector('.game-error')")), 'host: no error banner after the guest joined');

  // 3. Host sees the guest's hero; guest suggests, host takes the suggestion.
  await host.shot('07-host-party');
  check(await guest.click('Suggest: '), 'guest: suggest an action');
  await sleep(2000);
  check((await host.text()).includes('suggests'), 'host: sees the proposal');
  await host.shot('08-host-proposal');
  check(await host.click('suggests', true), 'host: takes the proposal');
  await sleep(5000);
  await host.shot('09-host-after');
  await guest.shot('10-guest-after');
  check(await host.click('Table'), 'host: Table panel again');
  await sleep(1500);
  check((await host.text()).includes('Kim'), 'host: Table panel lists the guest seat');
  await host.shot('11-host-table-seats');

  // 4. The guest page on a phone-sized screen.
  const phone = await openPage(browser, 'phone', 390, 844, true);
  await phone.go(`${base}?join=${CODE}`);
  await sleep(4000);
  await phone.shot('12-phone-join');

  for (const p of [host, guest, phone]) {
    console.log(`${p.name}: ${p.problems.length} problems`);
    for (const pr of p.problems) console.log(`  ${pr.slice(0, 600)}`);
    if (verbose) for (const l of p.consoleLines) console.log(`  ${l.slice(0, 300)}`);
    if (p.problems.length) failed = true;
    p.close();
  }
  browser.close();
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  edge.kill();
  await app.close();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
if (steps.some((s) => s.startsWith('FAIL'))) failed = true;
console.log(failed ? 'coop-screens: FAILED' : 'coop-screens: all steps ok');
process.exit(failed ? 1 : 0);
