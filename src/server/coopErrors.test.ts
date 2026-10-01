/** C008b: an `error` event caused by a command reaches only the socket that sent it; game events still reach everyone. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { MockLlm } from '../llm/mock';
import { buildCharacter } from '../engine/character/builder';
import { toBuildInput } from '../engine/character/creator';
import { quickBuild } from '../engine/character/quickBuild';
import { Rng } from '../engine/core/rng';
import { loadSrd } from '../engine/data/srdBundle';
import type { GameSession } from '../engine/session/GameSession';
import { addSeat } from '../engine/session/table';

type Ev = { type: string; [k: string]: unknown };

let app: FastifyInstance | undefined;
let savesDir: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (savesDir) fs.rmSync(savesDir, { recursive: true, force: true });
  savesDir = undefined;
});

const db = loadSrd();

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(pred()).toBe(true);
}

describe('refusals go to the sender only (C008b)', () => {
  it("a guest's refused command errors on the guest's socket only, and the host's own error on the host's", async () => {
    savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-coop-err-'));
    app = await buildApp({
      savesDir,
      services: { llm: new MockLlm() },
      sessionPorts: { newSeed: () => 'coop-err' },
      seatFor: (req) => ((req.query as { seat?: string }).seat === 'guest-1' ? 'guest-1' : 'host'),
    });
    await app.ready();
    const session = (app as unknown as { session: GameSession }).session;

    const host = await app.injectWS('/ws');
    const hostEvents: Ev[] = [];
    host.on('message', (d: Buffer) => hostEvents.push(JSON.parse(d.toString())));
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('host'))), db);
    host.send(JSON.stringify({ type: 'new_game', hero, mode: 'heroic', campaign: 'millbrook_demo' }));
    await until(() => hostEvents.some((e) => e.type === 'saved'));

    addSeat(session.table, 'player', 'Kim');
    const guest = await app.injectWS('/ws?seat=guest-1');
    const guestEvents: Ev[] = [];
    guest.on('message', (d: Buffer) => guestEvents.push(JSON.parse(d.toString())));

    // Saving is the host's: the guest is told, the host's page shows nothing.
    guest.send(JSON.stringify({ type: 'save', slot: 'guest-try', reqId: 'g1' }));
    await until(() => guestEvents.some((e) => e.type === 'error' && e.reqId === 'g1'));
    // The host's own failing command (a missing save) stays on the host's socket.
    host.send(JSON.stringify({ type: 'load', slot: 'no-such-slot', reqId: 'h1' }));
    await until(() => hostEvents.some((e) => e.type === 'error' && e.reqId === 'h1'));
    // A shared event after both: everyone still gets the game's events.
    const snaps = (events: Ev[]) => events.filter((e) => e.type === 'snapshot').length;
    const before = { host: snaps(hostEvents), guest: snaps(guestEvents) };
    host.send(JSON.stringify({ type: 'get_state' }));
    await until(() => snaps(hostEvents) > before.host && snaps(guestEvents) > before.guest);

    expect(hostEvents.filter((e) => e.type === 'error').map((e) => e.reqId)).toEqual(['h1']);
    expect(guestEvents.filter((e) => e.type === 'error').map((e) => e.reqId)).toEqual(['g1']);
    host.terminate();
    guest.terminate();
  });
});
