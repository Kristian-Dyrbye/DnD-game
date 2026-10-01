/**
 * Web co-op two-page check (C009c) against the REAL PeerJS broker (0.peerjs.com): drives two isolated
 * headless Edge pages over a running web build. The host plays `#play-fighter`, opens Table and turns on
 * "allow a friend to join" (opens the room on the broker); the guest opens the room link, joins as a
 * player, quick-builds a rogue, adds it and suggests an action; the host takes it; the guest reloads and
 * must get its seat back. Screenshots: userdata/shots/webcoop-*.png. Page errors/failed steps → exit 1;
 * broker unreachable → exit 3 (nothing tested; an owner row in COOP_PLAN §9).
 * Usage: `npm run build:web`, `npx vite preview --mode web --port 4199 --strictPort` (background), then
 * `npx tsx scripts/web-coop-screens.ts [baseUrl] [--verbose]` (default http://localhost:4199/).
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openPage, reportPages, sleep, startEdge } from './cdp-pages';

const verbose = process.argv.includes('--verbose');
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:4199/';
const out = resolve('userdata', 'shots');
mkdirSync(out, { recursive: true });
const CDP_PORT = 9335;
const ROOM_WAIT_MS = 30_000;

const steps: string[] = [];
const check = (ok: unknown, what: string) => {
  steps.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
/** Polls `fn` until it returns a truthy value or `ms` pass. */
async function waitFor<T>(fn: () => Promise<T>, ms: number): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const v = await fn();
    if (v) return v;
  }
  return undefined;
}

let exitCode = 0;
let edge: Awaited<ReturnType<typeof startEdge>> | undefined;
try {
  edge = await startEdge(CDP_PORT, join(out, 'edge-profile-webcoop'));
  const page = (name: string, width: number, height: number, mobile = false) => openPage(edge!.browser, CDP_PORT, { name, width, height, mobile, outDir: out, prefix: 'webcoop-' });
  const host = await page('host', 1400, 900);
  const guest = await page('guest', 1400, 900);

  // 1. Host starts a game, opens Table and the room on the broker.
  await host.go(`${base}#play-fighter`);
  await sleep(8000);
  await host.shot('01-host-game');
  check(await host.click('Table'), 'host: Table button in the web game menu');
  await sleep(1000);
  check(await host.evaluate("(() => { const i = document.querySelector('.table-toggle input'); if (i) i.click(); return !!i; })()"), 'host: tick "allow a friend to join over the internet"');
  const door = await waitFor(
    () => host.evaluate("document.querySelector('.join-url')?.textContent || (document.querySelector('.table-panel .game-error') ? 'error:' + document.querySelector('.table-panel .game-error').textContent : '')") as Promise<string>,
    ROOM_WAIT_MS,
  );
  await host.shot('02-host-table');
  if (!door || door.startsWith('error:')) {
    console.log(`broker: room did not open (${door ?? 'timed out'}) — the real-broker run needs internet access to 0.peerjs.com`);
    for (const p of [host, guest]) p.close();
    exitCode = 3;
  } else {
    const link = door;
    console.log(`room link: ${link}`);
    check(/\?room=solo-dnd-[a-z0-9]{10}&join=[A-Z0-9]+$/.test(link), 'host: room link carries room id + join code');
    check(await host.evaluate("!!document.querySelector('.table-panel svg.join-qr')"), 'host: Table panel draws the QR code');
    check((await host.text()).includes('0.peerjs.com'), 'host: privacy note names the broker');
    await host.click('Close');

    // 2. Guest opens the room link, joins as a player and builds a hero.
    await guest.go(link);
    const joinScreen = await waitFor(async () => (await guest.text()).includes('Join the table'), 15_000);
    check(joinScreen, 'guest: join screen on ?room=&join=');
    await guest.shot('03-guest-join');
    await guest.type('Kim');
    check(await guest.click('Join the table'), 'guest: join as player');
    check(await waitFor(() => guest.click('Rogue'), 20_000), 'guest: creator opens (seat taken over WebRTC), pick Rogue');
    await guest.shot('04-guest-creator');
    await sleep(500);
    check(await guest.click('Quick Build a'), 'guest: Quick Build');
    await sleep(800);
    check(await guest.click('Add to the party'), 'guest: Add to the party');
    check(await waitFor(async () => (await guest.text()).includes('Suggest'), 15_000), 'guest: game screen with Suggest buttons');
    await guest.shot('05-guest-game');
    check(!(await guest.evaluate("!!document.querySelector('.game-error')")), 'guest: no error banner after joining');
    check(!(await host.evaluate("!!document.querySelector('.game-error')")), 'host: no error banner after the guest joined');

    // 3. Guest suggests, host takes the suggestion; both pages see the result.
    await host.shot('06-host-party');
    check(await guest.click('Suggest: '), 'guest: suggest an action');
    check(await waitFor(async () => (await host.text()).includes('suggests'), 10_000), 'host: sees the proposal');
    await host.shot('07-host-proposal');
    check(await host.click('suggests', true), 'host: takes the proposal');
    await sleep(5000);
    await host.shot('08-host-after');
    await guest.shot('09-guest-after');
    check(await host.click('Table'), 'host: Table panel again');
    await sleep(1000);
    check((await host.text()).includes('Kim'), 'host: Table panel lists the guest seat');
    await host.shot('10-host-table-seats');
    await host.click('Close');

    // 4. Guest reloads: the stored seat token takes the same seat again (no join screen, no creator).
    await guest.go('about:blank');
    await guest.go(link);
    check(await waitFor(async () => (await guest.text()).includes('Suggest'), 30_000), 'guest: reload reclaims the seat (game screen again)');
    await guest.shot('11-guest-reloaded');

    // 5. The room link on a phone-sized screen.
    const phone = await page('phone', 390, 844, true);
    await phone.go(link);
    await waitFor(async () => (await phone.text()).includes('Join the table'), 15_000);
    await phone.shot('12-phone-join');

    if (reportPages([host, guest, phone], verbose)) exitCode = 1;
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await edge?.stop();
}
if (steps.some((s) => s.startsWith('FAIL'))) exitCode = 1;
console.log(exitCode === 0 ? 'web-coop-screens: all steps ok' : exitCode === 3 ? 'web-coop-screens: broker unreachable' : 'web-coop-screens: FAILED');
process.exit(exitCode);
