/**
 * Co-op two-browser check (C008): starts the game server (mock AI, temp saves/settings, table open with
 * code ABC234, 127.0.0.1 only so no firewall prompt) and drives two isolated headless Edge pages over the
 * DevTools protocol: the host plays `#play-fighter` and opens the Table panel; a guest opens the join link,
 * joins as a player, quick-builds a rogue, adds it to the party and suggests an action; the host takes the
 * suggestion. Screenshots go to userdata/shots/coop-*.png; page exceptions/console errors fail the run.
 * Usage: `npm run build` first, then `npx tsx scripts/coop-screens.ts [--verbose]`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../src/server/app';
import { MockLlm } from '../src/llm/mock';
import { MockTts } from '../src/tts/mock';
import { openPage, reportPages, sleep, startEdge } from './cdp-pages';

const verbose = process.argv.includes('--verbose');
const root = process.cwd();
const out = resolve('userdata', 'shots');
mkdirSync(out, { recursive: true });
const GAME_PORT = 4211;
const CDP_PORT = 9334;
const CODE = 'ABC234';
const base = `http://127.0.0.1:${GAME_PORT}/`;

if (!existsSync(join(root, 'dist', 'client', 'index.html'))) {
  console.error('No dist/client build: run `npm run build` first.');
  process.exit(2);
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

const steps: string[] = [];
const check = (ok: unknown, what: string) => {
  steps.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
let failed = false;
let edge: Awaited<ReturnType<typeof startEdge>> | undefined;
try {
  edge = await startEdge(CDP_PORT, join(out, 'edge-profile-coop'));
  const page = (name: string, width: number, height: number, mobile = false) => openPage(edge!.browser, CDP_PORT, { name, width, height, mobile, outDir: out, prefix: 'coop-' });
  const host = await page('host', 1400, 900);
  const guest = await page('guest', 1400, 900);

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
  const phone = await page('phone', 390, 844, true);
  await phone.go(`${base}?join=${CODE}`);
  await sleep(4000);
  await phone.shot('12-phone-join');

  if (reportPages([host, guest, phone], verbose)) failed = true;
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  await edge?.stop();
  await app.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
if (steps.some((s) => s.startsWith('FAIL'))) failed = true;
console.log(failed ? 'coop-screens: FAILED' : 'coop-screens: all steps ok');
process.exit(failed ? 1 : 0);
