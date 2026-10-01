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
import type { Encounter } from '../engine/combat/encounter';
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
const build = (cls: 'fighter' | 'cleric', seed: string) => buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(seed))), db);

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(pred()).toBe(true);
}

describe('co-op fight over the server (C003)', () => {
  it('host and guest take turns in one fight from two sockets; the AI steps in when the guest drops out', async () => {
    savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-coop-'));
    app = await buildApp({
      savesDir,
      services: { llm: new MockLlm() },
      sessionPorts: { newSeed: () => 'coop-ws' },
      seatFor: (req) => ((req.query as { seat?: string }).seat === 'guest-1' ? 'guest-1' : 'host'),
    });
    await app.ready();
    const session = (app as unknown as { session: GameSession }).session;

    const host = await app.injectWS('/ws');
    const hostEvents: Ev[] = [];
    host.on('message', (d: Buffer) => hostEvents.push(JSON.parse(d.toString())));
    host.send(JSON.stringify({ type: 'new_game', hero: build('fighter', 'host'), mode: 'heroic', campaign: 'millbrook_demo' }));
    await until(() => hostEvents.some((e) => e.type === 'saved'));

    addSeat(session.table, 'player', 'Kim');
    const guest = await app.injectWS('/ws?seat=guest-1');
    const guestEvents: Ev[] = [];
    guest.on('message', (d: Buffer) => guestEvents.push(JSON.parse(d.toString())));
    guest.send(JSON.stringify({ type: 'add_hero', hero: { ...build('cleric', 'guest'), name: 'Wren' }, reqId: 'join' }));
    await until(() => guestEvents.some((e) => e.type === 'ack' && e.reqId === 'join'));

    for (const actionId of ['talk_mayor', 'exit.to_mill', 'exit.unlock']) {
      const n = hostEvents.filter((e) => e.type === 'ack').length;
      host.send(JSON.stringify({ type: 'choose', actionId }));
      await until(() => hostEvents.filter((e) => e.type === 'ack').length > n);
    }
    const lastFight = (events: Ev[]) => events.findLast((e) => e.type === 'combat') as { encounter: Encounter | null } | undefined;
    expect(lastFight(hostEvents)?.encounter?.seats).toEqual({ hero: 'host', 'hero-2': 'guest-1' });

    const acted = { host: 0, guest: 0 };
    let refused = 0;
    let seq = 0;
    /** Sends a command and waits for its snapshot (or its error). */
    const act = async (ws: typeof host, events: Ev[], cmd: object): Promise<Ev | undefined> => {
      const reqId = `r${++seq}`;
      const snaps = events.filter((e) => e.type === 'snapshot').length;
      ws.send(JSON.stringify({ ...cmd, reqId }));
      await until(() => events.some((e) => e.type === 'error' && e.reqId === reqId) || events.filter((e) => e.type === 'snapshot').length > snaps);
      return events.find((e) => e.type === 'error' && e.reqId === reqId);
    };
    const turnOf = () => {
      const enc = lastFight(hostEvents)?.encounter;
      return enc && enc.status === 'ongoing' ? enc.state.turns.order[enc.state.turns.currentIndex]?.id : undefined;
    };

    // Play until each seat has acted twice: the wrong socket is refused, the right one acts.
    for (let i = 0; i < 40 && turnOf() && (acted.host < 2 || acted.guest < 2); i++) {
      const guestUp = turnOf() === 'hero-2';
      if (guestUp) expect(hostEvents.findLast((e) => e.type === 'combat' || e.type === 'waiting')).toMatchObject({ type: 'waiting', creatureId: 'hero-2', seat: 'guest-1', text: 'Waiting for Wren’s player…' });
      const err = await act(guestUp ? host : guest, guestUp ? hostEvents : guestEvents, { type: 'combat_act', action: { kind: 'end_turn' } });
      expect(err).toMatchObject({ message: 'It is not your character’s turn' });
      refused++;
      expect(await act(guestUp ? guest : host, guestUp ? guestEvents : hostEvents, { type: 'combat_act', action: { kind: 'dodge' } })).toBeUndefined();
      expect(await act(guestUp ? guest : host, guestUp ? guestEvents : hostEvents, { type: 'combat_act', action: { kind: 'end_turn' } })).toBeUndefined();
      acted[guestUp ? 'guest' : 'host']++;
    }
    expect(acted.host).toBeGreaterThanOrEqual(1);
    expect(acted.guest).toBeGreaterThanOrEqual(1);
    expect(refused).toBe(acted.host + acted.guest);

    // The guest drops out: their hero fights on with the AI, the host is never left waiting.
    // (Seed 'coop-ws': the fight is still on here; play the host's turns until the guest is up again.)
    for (let i = 0; i < 20 && turnOf() && turnOf() !== 'hero-2'; i++) await act(host, hostEvents, { type: 'combat_act', action: { kind: 'end_turn' } });
    expect(turnOf()).toBe('hero-2');
    const n = hostEvents.filter((e) => e.type === 'combat').length;
    guest.terminate();
    await until(() => session.table.seats.some((s) => s.id === 'guest-1' && s.away));
    await until(() => hostEvents.filter((e) => e.type === 'combat').length > n);
    expect(lastFight(hostEvents)?.encounter?.controlled ?? []).not.toContain('hero-2');
    expect(turnOf()).not.toBe('hero-2');
    host.terminate();
  });
});
