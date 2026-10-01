/**
 * C009b — web co-op over PeerJS: the room helpers (room id, link, Table panel info), the Allow-join
 * switch, and the PeerJS adapter end to end against a fake broker: a host page's in-page game opens a
 * room, a guest page dials it with PeerTransport, joins with the code and plays; a missing room or a
 * broker that is down make the guest retry, a second tab of the host gets "taken".
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { startWebEdition } from '../src/client/webEdition';
import { updateSettings } from '../src/client/ui/settingsState';
import { FakeBroker } from './helpers/fakeBroker';
import { PeerTransport } from '../src/client/net/peer';
import { dialRoom, openRoom, type RoomStatus } from '../src/client/net/peerjs';
import { openHostRoom } from '../src/client/net/roomHost';
import { hostRoomIds, newRoomId, roomLink, roomSwitch, roomTableInfo, webRoom } from '../src/client/net/webRoom';
import { doorState } from '../src/client/net/tableInfo';
import { joinCodeFrom, openCommands, roomFrom } from '../src/client/net/guest';
import { qrMatrix } from '../src/client/qr';
import { InPageTransport } from '../src/client/net/transport';
import { createInPageHost } from '../src/host/inPage';
import type { ClientCommand, ServerEvent } from '../src/shared/protocol';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';

type Of<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>;
const db = loadSrd();
const now = { setTimeout: (fn: () => void) => setTimeout(fn, 0) };

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  webRoom.value = { status: 'off' };
});

describe('room helpers (C009b)', () => {
  it('room ids, the room link and the guest page query agree', () => {
    const id = newRoomId();
    expect(id).toMatch(/^solo-dnd-[a-z0-9]{10}$/);
    const link = roomLink('https://kristian-dyrbye.github.io/DnD-game/?x=1#play-fighter', id, 'AB3K9X');
    expect(link).toBe(`https://kristian-dyrbye.github.io/DnD-game/?room=${id}&join=AB3K9X`);
    const search = new URL(link).search;
    expect(roomFrom(search)).toBe(id);
    expect(joinCodeFrom(search)).toBe('AB3K9X');
    // A room without a join code, or a malformed id, is a normal page.
    expect(roomFrom(`?room=${id}`)).toBeNull();
    expect(roomFrom('?room=evil&join=AB3K9X')).toBeNull();
    expect(roomFrom('')).toBeNull();
    // The link fits the panel's QR encoder.
    expect(qrMatrix(link).length).toBeGreaterThan(20);
  });

  it('the host keeps its room id and join code across reloads', () => {
    const store = memoryStorage();
    const a = hostRoomIds(store);
    expect(a.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(hostRoomIds(store)).toEqual(a);
    store.setItem('solo-dnd.room', '{broken');
    expect(hostRoomIds(store).roomId).not.toBe(a.roomId);
  });

  it('the Table panel info follows the room', () => {
    const href = 'https://example.org/game/';
    const room = { roomId: 'solo-dnd-abcdefghij', code: 'QRS234' };
    const info = (status: RoomStatus | 'off', allow = true) => roomTableInfo({ status, ...room }, allow, href, [], 'host_decides');
    expect(doorState(info('open', false))).toBe('closed');
    expect(doorState(info('opening'))).toBe('connecting');
    expect(doorState(info('open'))).toBe('open');
    expect(info('open').urls).toEqual(['https://example.org/game/?room=solo-dnd-abcdefghij&join=QRS234']);
    expect(info('open').code).toBe('QRS234');
    expect(info('opening').urls).toEqual([]);
    expect(doorState(info('down'))).toBe('brokerDown');
    expect(doorState(info('unsupported'))).toBe('brokerDown');
    expect(doorState(info('taken'))).toBe('roomTaken');
    // The local edition (no broker field) is unchanged.
    expect(doorState({ allowJoin: true, lan: false, urls: [] })).toBe('restart');
  });

  it('the Allow-join switch opens and closes one room and hands out the code only while open', async () => {
    const opened: string[] = [];
    let closed = 0;
    const sw = roomSwitch({
      store: memoryStorage(),
      open: async (roomId, onStatus) => {
        opened.push(roomId);
        setTimeout(() => onStatus('open'), 0);
        return { close: () => void closed++ };
      },
    });
    expect(sw.joinCode()).toBeUndefined();
    await sw.set(true);
    await until(() => webRoom.value.status === 'open', 'room open');
    expect(sw.joinCode()).toBe(webRoom.value.code);
    // Quick off/on/on: serialised, one room at a time.
    await Promise.all([sw.set(false), sw.set(true), sw.set(true)]);
    expect(opened).toHaveLength(2);
    expect(opened[0]).toBe(opened[1]); // same link after reopening
    expect(closed).toBe(1);
    await sw.set(false);
    expect(webRoom.value.status).toBe('off');
    expect(sw.joinCode()).toBeUndefined();
  });

  it('the web edition opens the room while Allow join is on', async () => {
    const opened: string[] = [];
    let closed = 0;
    const { room } = await startWebEdition({
      indexedDB: new IDBFactory(),
      storage: memoryStorage(),
      openRoom: async (id, onStatus) => {
        opened.push(id);
        onStatus('open');
        return { close: () => void closed++ };
      },
    });
    await updateSettings({ table: { allowJoin: true } });
    await until(() => webRoom.value.status === 'open', 'room open');
    expect(room.joinCode()).toMatch(/^[A-Z0-9]{6}$/);
    expect(opened).toEqual([webRoom.value.roomId]);
    await updateSettings({ table: { allowJoin: false } });
    await until(() => webRoom.value.status === 'off', 'room closed');
    expect(closed).toBe(1);
    expect(room.joinCode()).toBeUndefined();
  });

  it('a room that fails to open reports the broker down', async () => {
    const sw = roomSwitch({ store: memoryStorage(), open: () => Promise.reject(new Error('no broker')) });
    await sw.set(true);
    expect(webRoom.value.status).toBe('down');
    expect(sw.joinCode()).toBeUndefined();
  });
});

describe('PeerJS adapter against a fake broker (C009b)', () => {
  /** The host page: its in-page game with the room's join code, and the room opened through roomHost. */
  async function hostPage(broker: FakeBroker, roomId = 'solo-dnd-room000001', code = 'ABC234') {
    const transport = new InPageTransport(async () => createInPageHost({ joinCode: () => code, sessionPorts: { newSeed: () => 'pj-1' } }));
    const events: ServerEvent[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
    const status: RoomStatus[] = [];
    const room = await openHostRoom({ roomId, ready: () => transport.ready(), onStatus: (s) => status.push(s), factory: broker.factory });
    const send = async (cmd: ClientCommand) => {
      transport.send(cmd);
      await transport.idle();
    };
    return { transport, events, status, room, send, of: <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t) };
  }

  function guestPage(broker: FakeBroker, roomId: string, code: string) {
    const events: ServerEvent[] = [];
    const status: string[] = [];
    const transport = new PeerTransport(dialRoom(roomId, { factory: broker.factory, timeoutMs: 2000 }), now);
    transport.connect({
      onEvent: (e) => events.push(e),
      onStatus: (s) => status.push(s),
      onOpen: () => openCommands({ code, name: 'Kim', role: 'player', language: 'en', hasState: false }),
    });
    return { transport, events, status, of: <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t) };
  }

  it('a guest page dials the host page\'s room, joins with the code and gets the game', async () => {
    const broker = new FakeBroker();
    const page = await hostPage(broker);
    await until(() => page.status.includes('open'), 'room open');
    await page.send({ type: 'new_game', hero: { ...buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('pj-host'))), db), name: 'Mira' }, mode: 'heroic', campaign: 'millbrook_demo' });

    const kim = guestPage(broker, 'solo-dnd-room000001', 'ABC234');
    await until(() => kim.of('joined').length > 0 && kim.of('snapshot').length > 0, 'joined + snapshot');
    expect(kim.of('joined')[0]).toMatchObject({ seat: 'guest-1', role: 'player' });
    expect(page.of('table').at(-1)!.seats.map((s) => s.id)).toEqual(['host', 'guest-1']);

    // Story commands from the guest arrive as proposals at the host page.
    kim.transport.send({ type: 'choose', actionId: page.of('suggestions').at(-1)!.actions.find((a) => !a.say)!.id });
    await until(() => page.of('proposal').length > 0, 'proposal');

    // The host turns joining off: the room closes, the guest is marked away and keeps redialing.
    page.room.close();
    await until(() => page.of('table').at(-1)!.seats.find((s) => s.id === 'guest-1')?.away === true, 'guest away');
    expect(kim.transport.hungUp).toBe(false);
    kim.transport.disconnect();
  });

  it('a wrong code five times gets a hang-up the guest obeys (flushed before the close)', async () => {
    const broker = new FakeBroker();
    const page = await hostPage(broker, 'solo-dnd-room000002', 'ABC234');
    await until(() => page.status.includes('open'), 'room open');
    const guest = new PeerTransport(dialRoom('solo-dnd-room000002', { factory: broker.factory }), now);
    const errors: ServerEvent[] = [];
    guest.connect({ onEvent: (e) => e.type === 'error' && errors.push(e), onStatus: () => undefined, onOpen: () => [] });
    for (let i = 0; i < 5; i++) guest.send({ type: 'join', code: 'WRONG1', name: 'Eve' });
    await until(() => guest.hungUp, 'hang-up');
    expect(errors).toHaveLength(5);
    page.room.close();
  });

  it('a missing room or a broker that is down makes the guest page retry until the room opens', async () => {
    const broker = new FakeBroker();
    broker.down = true;
    const kim = guestPage(broker, 'solo-dnd-room000003', 'ABC234');
    await until(() => kim.status.filter((s) => s === 'closed').length >= 2, 'failed dials while the broker is down');
    broker.down = false;
    await until(() => kim.status.filter((s) => s === 'closed').length >= 4, 'failed dials while the room is missing');
    expect(kim.of('joined')).toHaveLength(0);
    // The host page opens the room: the next redial gets in.
    const page = await hostPage(broker, 'solo-dnd-room000003', 'ABC234');
    await page.send({ type: 'new_game', hero: { ...buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('pj-late'))), db), name: 'Ash' }, mode: 'heroic', campaign: 'millbrook_demo' });
    await until(() => kim.of('joined').length > 0, 'joined after the room opened');
    kim.transport.disconnect();
    page.room.close();
  });

  it('a second host tab with the same room id is told the room is taken; a broker failure reads as down', async () => {
    const broker = new FakeBroker();
    const statuses = (roomId: string) => {
      const s: RoomStatus[] = [];
      const handle = openRoom({ roomId, factory: broker.factory, onStatus: (x) => s.push(x), onChannel: () => undefined });
      return { s, handle };
    };
    const first = statuses('solo-dnd-room000004');
    await until(() => first.s.includes('open'), 'first tab open');
    const second = statuses('solo-dnd-room000004');
    await until(() => second.s.includes('taken'), 'second tab taken');
    broker.down = true;
    const third = statuses('solo-dnd-room000005');
    await until(() => third.s.includes('down'), 'broker down');
    expect(openRoom({ roomId: 'x', factory: () => { throw new Error('no RTCPeerConnection'); }, onStatus: (x) => third.s.push(x), onChannel: () => undefined })).toBeDefined();
    expect(third.s.at(-1)).toBe('unsupported');
    for (const t of [first, second, third]) t.handle.close();
  });
});
