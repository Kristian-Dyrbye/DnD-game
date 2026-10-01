/** C005: LAN guests join with the code over the server: seats, tokens + reconnect, release, REST guard, origins. */
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

type Ev = { type: string; [k: string]: unknown };
type Ws = Awaited<ReturnType<FastifyInstance['injectWS']>>;

let app: FastifyInstance | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const db = loadSrd();
const build = (cls: 'fighter' | 'cleric', name: string) => ({ ...buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(name))), db), name });
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-join-'));
  dirs.push(d);
  return d;
};

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(pred()).toBe(true);
}

/** A browser on another PC of the network, on a page this server served. */
const LAN = { socket: { remoteAddress: '192.168.1.30' }, headers: { host: '192.168.1.5:3210', origin: 'http://192.168.1.5:3210' } };

async function start() {
  app = await buildApp({ savesDir: tmp(), userDataDir: tmp(), services: { llm: new MockLlm() }, sessionPorts: { newSeed: () => 'join' }, joinCode: 'ABC234', lan: true });
  await app.ready();
  return app;
}

async function open(a: FastifyInstance, ctx?: object, url = '/ws') {
  const ws: Ws = await a.injectWS(url, ctx as never);
  const events: Ev[] = [];
  let closed: number | undefined;
  ws.on('message', (d: Buffer) => events.push(JSON.parse(d.toString())));
  ws.on('close', (code: number) => (closed = code));
  const last = (type: string) => events.findLast((e) => e.type === type);
  return { ws, events, last, closed: () => closed, send: (cmd: object) => ws.send(JSON.stringify(cmd)) };
}

describe('LAN join (C005)', () => {
  it('a guest joins with the code, reconnects with the token and leaves again', async () => {
    const a = await start();
    const host = await open(a);
    host.send({ type: 'new_game', hero: build('fighter', 'Mira'), mode: 'heroic', campaign: 'millbrook_demo' });
    await until(() => !!host.last('saved'));

    // Without a seat a LAN connection sees nothing of the game and may only join.
    const guest = await open(a, LAN);
    guest.send({ type: 'get_state', reqId: 'peek' });
    await until(() => !!guest.last('error'));
    expect(guest.last('error')).toMatchObject({ reqId: 'peek', message: 'You have no seat at this table' });
    guest.send({ type: 'join', code: 'ABC234', reqId: 'j0' });
    await until(() => guest.events.filter((e) => e.type === 'error').length === 2);
    expect(guest.last('error')).toMatchObject({ reqId: 'j0', message: 'This game is not open to guests' });

    // The host opens the door (Settings → Table); a wrong code is refused.
    expect((await a.inject({ method: 'PUT', url: '/api/settings', payload: { table: { allowJoin: true } } })).statusCode).toBe(200);
    guest.send({ type: 'join', code: 'ABC999', reqId: 'j1' });
    await until(() => guest.last('error')?.reqId === 'j1');
    expect(guest.last('error')).toMatchObject({ message: 'That join code is wrong' });
    expect(guest.events.some((e) => e.type === 'snapshot' || e.type === 'log')).toBe(false);

    guest.send({ type: 'join', code: ' abc234', name: 'Kim' });
    await until(() => !!guest.last('joined') && !!guest.last('snapshot'));
    const token = guest.last('joined')?.token as string;
    expect(guest.last('joined')).toMatchObject({ seat: 'guest-1', role: 'player' });
    expect(guest.last('table')).toMatchObject({ seats: [{ id: 'host' }, { id: 'guest-1', name: 'Kim' }] });
    await until(() => !!host.last('table'));
    expect(host.events.some((e) => e.type === 'log' && (e.entry as { text: string }).text === 'Kim sits down at the table.')).toBe(true);
    guest.send({ type: 'join', code: 'ABC234', reqId: 'again' });
    await until(() => guest.last('error')?.reqId === 'again');
    expect(guest.last('error')).toMatchObject({ message: 'You already have a seat at this table' });

    guest.send({ type: 'add_hero', hero: build('cleric', 'Wren'), reqId: 'hero' });
    await until(() => guest.last('ack')?.reqId === 'hero');

    // A reload: the old connection drops (away), the new one reclaims the seat with the token.
    guest.ws.terminate();
    await until(() => a.session.table.seats.some((s) => s.id === 'guest-1' && s.away));
    const back = await open(a, LAN);
    back.send({ type: 'join', code: 'ABC234', token });
    await until(() => !!back.last('joined'));
    expect(back.last('joined')).toMatchObject({ seat: 'guest-1', token });
    expect(a.session.table.seats).toEqual([{ id: 'host', role: 'host' }, { id: 'guest-1', role: 'player', name: 'Kim' }]);

    // A second tab with the same token takes the seat over; the older connection is closed.
    const tab = await open(a, LAN);
    tab.send({ type: 'join', code: 'ABC234', token });
    await until(() => !!tab.last('joined') && back.closed() !== undefined);
    expect(back.closed()).toBe(4001);
    expect(a.session.table.seats.find((s) => s.id === 'guest-1')?.away).toBeUndefined();

    // Leaving: the seat goes, Wren plays on with the AI, the connection has no seat any more.
    tab.send({ type: 'release_seat', reqId: 'bye' });
    // The table event (sent before the seat goes) is the leaver's last event.
    await until(() => (tab.last('table')?.seats as unknown[] | undefined)?.length === 1);
    expect(a.session.table.seats).toHaveLength(1);
    expect((a.session.current.extensions.party as { control: Record<string, string> }).control['hero-2']).toBe('ai');
    tab.send({ type: 'get_state', reqId: 'after' });
    await until(() => tab.last('error')?.reqId === 'after');
    expect(tab.last('error')).toMatchObject({ message: 'You have no seat at this table' });
    host.ws.terminate();
    tab.ws.terminate();
  });

  it('hangs up on code guessing, refuses foreign pages, and keeps the REST API to the host', async () => {
    const a = await start();
    await a.inject({ method: 'PUT', url: '/api/settings', payload: { table: { allowJoin: true } } });
    const guesser = await open(a, LAN);
    for (let i = 0; i < 5; i++) guesser.send({ type: 'join', code: `WRONG${i}` });
    await until(() => guesser.closed() !== undefined);
    expect(guesser.closed()).toBe(1008);

    const foreign = await open(a, { socket: { remoteAddress: '192.168.1.30' }, headers: { host: '192.168.1.5:3210', origin: 'http://evil.example' } });
    await until(() => foreign.closed() !== undefined);
    expect(foreign.closed()).toBe(1008);

    // A second tab on the host's own PC can sit as a guest with `?guest`.
    const tab = await open(a, undefined, '/ws?guest');
    tab.send({ type: 'join', code: 'ABC234', role: 'spectator' });
    await until(() => !!tab.last('joined'));
    expect(tab.last('joined')).toMatchObject({ seat: 'guest-1', role: 'spectator' });
    tab.ws.terminate();

    const lan = { remoteAddress: '192.168.1.30', headers: { host: '192.168.1.5:3210' } };
    expect((await a.inject({ method: 'GET', url: '/api/health', ...lan })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/settings', ...lan })).statusCode).toBe(200);
    for (const [method, url] of [['GET', '/api/saves'], ['PUT', '/api/settings'], ['GET', '/api/table']] as const) {
      expect((await a.inject({ method, url, ...lan, ...(method === 'PUT' && { payload: { table: { allowJoin: false } } }) })).statusCode).toBe(403);
    }
    // A DNS-rebinding page reaches 127.0.0.1 but names its own host: not the host's API either.
    expect((await a.inject({ method: 'GET', url: '/api/saves', headers: { host: 'evil.example:3210' } })).statusCode).toBe(403);
    const table = (await a.inject({ method: 'GET', url: '/api/table' })).json();
    expect(table).toMatchObject({ allowJoin: true, lan: true, code: 'ABC234' });
    expect(Array.isArray(table.urls)).toBe(true);
  });
});
