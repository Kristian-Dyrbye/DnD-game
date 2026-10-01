/**
 * Headless Edge over the DevTools protocol for the co-op screenshot scripts (coop-screens.ts, C008;
 * web-coop-screens.ts, C009c): start Edge, open pages in separate browser contexts (own localStorage,
 * like two browsers), click/type/read text, take screenshots, and collect page exceptions/console errors.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Msg = { id?: number; method?: string; params?: any; result?: any };

/** Minimal CDP client over one websocket (a page target, or the browser). */
export async function cdp(wsUrl: string) {
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
export type Cdp = Awaited<ReturnType<typeof cdp>>;

/** Starts headless Edge with a throwaway profile; exits the process (2) if Edge is not installed. */
export async function startEdge(cdpPort: number, profile: string): Promise<{ edge: ChildProcess; browser: Cdp; stop(): Promise<void> }> {
  const exe = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
  ].find((p) => existsSync(p));
  if (!exe) {
    console.error('Microsoft Edge not found.');
    process.exit(2);
  }
  rmSync(profile, { recursive: true, force: true });
  const edge = spawn(exe, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let version: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json(), () => undefined);
  }
  if (!version) {
    edge.kill();
    throw new Error('Edge did not start.');
  }
  const browser = await cdp(version.webSocketDebuggerUrl);
  return {
    edge,
    browser,
    stop: async () => {
      browser.close();
      edge.kill();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

/** A page in its own browser context (own localStorage, like a second browser). Shots: `<outDir>/<prefix><file>.png`. */
export async function openPage(browser: Cdp, cdpPort: number, opts: { name: string; width: number; height: number; mobile?: boolean; outDir: string; prefix: string }) {
  const { name, width, height, mobile = false, outDir, prefix } = opts;
  const ctx = await browser.send('Target.createBrowserContext');
  const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.result.browserContextId });
  const targetId = target.result.targetId as string;
  const list = (await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json())) as { id: string; webSocketDebuggerUrl: string }[];
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
      writeFileSync(join(outDir, `${prefix}${file}.png`), Buffer.from(s.result.data, 'base64'));
      console.log(`shot ${prefix}${file}.png (${name})`);
    },
    close: () => c.close(),
  };
}
export type CdpPage = Awaited<ReturnType<typeof openPage>>;

/** Prints each page's problems; true if any page had one. */
export function reportPages(pages: CdpPage[], verbose: boolean): boolean {
  let any = false;
  for (const p of pages) {
    console.log(`${p.name}: ${p.problems.length} problems`);
    for (const pr of p.problems) console.log(`  ${pr.slice(0, 600)}`);
    if (verbose) for (const l of p.consoleLines) console.log(`  ${l.slice(0, 300)}`);
    if (p.problems.length) any = true;
    p.close();
  }
  return any;
}
