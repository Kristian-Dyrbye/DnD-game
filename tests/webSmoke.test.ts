/**
 * A128 — web edition smoke test: the starter arc played end to end through the in-page host the
 * browser uses (InPage transport, IndexedDB saves via fake-indexeddb, no LLM or TTS at all), with
 * real seeded dice and grid fights. Same story + combat policy as the server smoke test (A106). The
 * run must chain into chapter 1 without a single error event, and a save made there must load in a
 * fresh page (new host, same browser database).
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { combatStep } from './helpers/combatPolicy';
import { nextStarterChoice } from './helpers/starterPolicy';
import { InPageTransport } from '../src/client/net/transport';
import { PeerTransport, admitPeer, type PeerChannel } from '../src/client/net/peer';
import { openCommands, rememberSeat, type SeatStore } from '../src/client/net/guest';
import { tableDoor } from '../src/host/tableDoor';
import { peerPair } from './helpers/fakePeer';
import { createInPageHost } from '../src/host/inPage';
import { openBrowserSaves } from '../src/host/indexedDbSaves';
import type { GameHost } from '../src/host/gameHost';
import { CAMPAIGNS } from '../src/host/campaigns';
import type { ClientCommand, ServerEvent } from '../src/shared/protocol';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { activeFight } from '../src/engine/adventure/fights';
import { getProgress } from '../src/engine/adventure/runner';

type Of<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>;
const db = loadSrd();

/** A browser tab: the in-page transport over a host with IndexedDB saves. */
async function openPage(idb: IDBFactory) {
  const { saves, persistent } = await openBrowserSaves(idb);
  let host: GameHost | undefined;
  const transport = new InPageTransport(async () => (host = createInPageHost({ saves, sessionPorts: { newSeed: () => 'web-smoke-1' } })));
  const events: ServerEvent[] = [];
  transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
  const send = async (cmd: ClientCommand) => {
    transport.send(cmd);
    while (!host) await new Promise((r) => setTimeout(r, 5));
    await transport.idle();
  };
  const of = <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t);
  return { saves, persistent, events, send, of, host: () => host! };
}

/** Per language (A151): the ch1 name in the chapter separator line, and a line head that must not show. */
const LANGS = [
  { language: 'en', ch1: 'The Whispering Fen', foreign: /\bSG \d/ },
  { language: 'da', ch1: 'Den Hviskende Sump', foreign: /\bDC \d|\b(Success|Failure)\b/ },
] as const;

describe('web edition campaign picker (B008)', () => {
  it.each(CAMPAIGNS.filter((c) => c.playable))('the page offers $id and a new game starts it, saves it and loads it back', async (c) => {
    const idb = new IDBFactory();
    const page = await openPage(idb);
    const hero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('picker'))), db);
    // The card the player clicks sends its first chapter as `new_game.campaign` (ui/CampaignPicker.tsx).
    await page.send({ type: 'new_game', hero, mode: 'heroic', campaign: c.adventure });
    expect(page.host().campaigns.map((x) => x.id)).toEqual(CAMPAIGNS.filter((x) => x.playable).map((x) => x.id));
    expect(page.of('error')).toEqual([]);
    const snap = page.of('snapshot').at(-1)!.state;
    expect(getProgress(snap)!.adventureId).toBe(c.adventure);
    expect(page.of('suggestions').at(-1)!.actions.length).toBeGreaterThan(0);
    await page.send({ type: 'save', slot: 'picker', name: c.id });
    expect(page.of('saved').at(-1)!.meta.campaign).toBe(c.adventure);
    await page.saves.flush();
    const reloaded = await openPage(idb);
    await reloaded.send({ type: 'load', slot: 'picker' });
    expect(reloaded.of('error')).toEqual([]);
    expect(reloaded.of('snapshot').at(-1)!.state.campaign).toBe(c.adventure);
  });
});

describe('web edition smoke test (A128)', () => {
  it.each(LANGS)('plays the starter arc into chapter 1 in the page ($language), saves to IndexedDB and loads in a new page', async ({ language, ch1, foreign }) => {
    const idb = new IDBFactory();
    const page = await openPage(idb);
    expect(page.persistent).toBe(true);
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('smoke'))), db);
    await page.send({ type: 'set_language', language });
    await page.send({ type: 'new_game', hero, mode: 'heroic' });
    const session = page.host().session;

    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.adventureId !== 'millbrook_disappearances') break;
      if (activeFight(session.current)) {
        fights++;
        await page.send(combatStep(session, db));
        continue;
      }
      // The buttons the player sees are the last `suggestions` event (JSON copies, like the UI gets).
      const offered = (page.of('suggestions').at(-1)?.actions ?? []).map((a) => a.id);
      const choice = nextStarterChoice(p.sceneId, session.current.flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      await page.send({ type: 'choose', actionId: choice });
    }

    const errors = page.of('error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0);
    expect(page.of('combat').length).toBeGreaterThan(0); // the battle map got the fights
    expect(session.current.flags['arc.main.tooth_want_holder']).toBe('player');
    expect(session.current.companions.map((c) => c.id)).toEqual(['corwin']);
    expect(getProgress(session.current)!.adventureId).toBe('ch1_whispering_fen');
    // Without an AI every narration is the template and every button is authored data.
    expect(page.of('log').some((e) => e.entry.kind === 'narration')).toBe(true);
    expect(page.of('suggestions').at(-1)!.actions.every((a) => !a.say)).toBe(true);
    // The whole run spoke the page's language: the chapter separator + no other language's roll words.
    const lines = page.of('log').map((e) => e.entry.text);
    expect(lines).toContain(`— ${ch1} —`);
    expect(lines.filter((l) => foreign.test(l)).slice(0, 3)).toEqual([]);

    // Save in chapter 1, then reload the "page": a new host reads the same IndexedDB.
    await page.send({ type: 'save', slot: 'web-smoke', name: 'Fen' });
    expect(page.of('saved').at(-1)!.meta.slotId).toBe('web-smoke');
    await page.saves.flush();
    const time = session.current.time;

    const reloaded = await openPage(idb);
    const slots = reloaded.saves.list().map((e) => (e.ok ? e.meta.slotId : e.slotId));
    expect(slots).toContain('web-smoke');
    expect(slots.some((s) => s.startsWith('auto-'))).toBe(true);
    await reloaded.send({ type: 'load', slot: 'web-smoke' });
    expect(reloaded.of('error')).toEqual([]);
    const snap = reloaded.of('snapshot').at(-1)!.state;
    expect(snap.time).toBe(time);
    expect(getProgress(snap)!.adventureId).toBe('ch1_whispering_fen');
    expect(reloaded.of('suggestions').at(-1)!.actions.length).toBeGreaterThan(0);
  }, 120_000);
});

/** A memory stand-in for localStorage (the guest page's seat token). */
function memoryStore(): SeatStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

async function until(pred: () => boolean, what = 'condition'): Promise<void> {
  for (let i = 0; i < 1000 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!pred()) throw new Error(`timed out waiting for ${what}`);
}

describe('web edition co-op over a peer channel (C009)', () => {
  /** The host's page (in-page host with a join code) and a "room" guests dial: each dial = a new fake data channel let in through the door. */
  async function hostPage(code = 'ABC234') {
    const transport = new InPageTransport(async () => createInPageHost({ joinCode: () => code, sessionPorts: { newSeed: () => 'peer-1' } }));
    const events: ServerEvent[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
    const host = await transport.ready();
    const door = tableDoor(host);
    let dials = 0;
    const dial = () => {
      dials++;
      const { guest, host: end } = peerPair();
      admitPeer(door, end);
      return guest;
    };
    const send = async (cmd: ClientCommand) => {
      transport.send(cmd);
      await transport.idle();
    };
    return { host, events, send, dial, dials: () => dials, of: <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t) };
  }

  /** A guest's page: the peer transport with the same onOpen rule as gameSocket (join with code + stored token). */
  function guestPage(dial: () => PeerChannel, code: string, store = memoryStore(), name = 'Kim') {
    const events: ServerEvent[] = [];
    const status: string[] = [];
    // Redial at once (the backoff's timer is the page's business).
    const transport = new PeerTransport(dial, { setTimeout: (fn: () => void) => setTimeout(fn, 0) });
    transport.connect({
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'joined') rememberSeat(store, code, e.token, name);
      },
      onStatus: (s) => status.push(s),
      onOpen: () => openCommands({ code, store, name, role: 'player', language: 'en', hasState: false }),
    });
    const of = <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t);
    return { transport, events, status, store, of, send: (cmd: ClientCommand) => transport.send(cmd) };
  }

  it('a guest page joins the host page, adds a hero, proposes, reconnects into its seat and is refused host-only commands', async () => {
    const page = await hostPage();
    await page.send({ type: 'new_game', hero: { ...buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('peer-host'))), db), name: 'Mira' }, mode: 'heroic', campaign: 'millbrook_demo' });

    const kim = guestPage(page.dial, 'ABC234');
    await until(() => kim.of('joined').length > 0 && kim.of('snapshot').length > 0, 'joined + snapshot');
    expect(kim.of('joined')[0]).toMatchObject({ seat: 'guest-1', role: 'player' });
    expect(kim.of('table').at(-1)!.seats.map((s) => s.id)).toEqual(['host', 'guest-1']);
    expect(page.of('log').some((e) => e.entry.text === 'Kim sits down at the table.')).toBe(true);

    // The guest builds a hero in their own page and brings it to the table.
    kim.send({ type: 'add_hero', hero: { ...buildCharacter(toBuildInput(quickBuild('cleric', db, Rng.fromSeed('peer-guest'))), db), name: 'Wren' }, reqId: 'hero' });
    await until(() => kim.of('ack').some((e) => e.reqId === 'hero'), 'add_hero ack');
    await page.host.idle();
    const wren = page.host.session.current.companions.find((c) => c.name === 'Wren')!;
    expect(page.host.session.current.extensions.party).toMatchObject({ control: { [wren.id]: 'seat:guest-1' } });

    // Under host_decides the guest's choice reaches the host as a proposal.
    const action = kim.of('suggestions').at(-1)!.actions.find((a) => !a.say)!;
    kim.send({ type: 'choose', actionId: action.id });
    await until(() => page.of('proposal').length > 0, 'proposal');
    expect(page.of('proposal')[0]).toMatchObject({ seat: 'guest-1', name: 'Kim', command: 'choose', actionId: action.id });

    // A host-only command is refused, and only the guest's page hears about it (C008b).
    kim.send({ type: 'save', slot: 'nope', reqId: 'save' });
    await until(() => kim.of('error').some((e) => e.reqId === 'save'), 'save refusal');
    expect(page.of('error')).toEqual([]);

    // The channel drops (Wi-Fi blip): the seat goes away, the transport redials and reclaims it with its token.
    const dialsBefore = page.dials();
    (kim.transport as unknown as { channel: PeerChannel }).channel.close();
    await until(() => page.dials() > dialsBefore && kim.of('joined').length === 2, 'rejoin');
    expect(kim.of('joined')[1]).toMatchObject({ seat: 'guest-1' });
    expect(page.of('table').some((e) => e.seats.some((s) => s.id === 'guest-1' && s.away))).toBe(true);
    await page.host.idle();
    expect(page.host.session.table.seats.find((s) => s.id === 'guest-1')?.away).toBeFalsy();
    expect(page.host.session.table.seats.filter((s) => s.role !== 'host')).toHaveLength(1);
    expect(kim.status.filter((s) => s === 'open')).toHaveLength(2);

    // A second page with the same token (another tab) takes the seat over; the first stops redialing.
    const tab = guestPage(page.dial, 'ABC234', kim.store);
    await until(() => tab.of('joined').length > 0 && kim.transport.hungUp, 'takeover');
    expect(tab.of('joined')[0]).toMatchObject({ seat: 'guest-1' });
    const dialsAfter = page.dials();
    await new Promise((r) => setTimeout(r, 50));
    expect(page.dials()).toBe(dialsAfter);
  }, 60_000);

  it('a page guessing codes is hung up and stops dialing', async () => {
    const page = await hostPage();
    await page.send({ type: 'new_game', hero: buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('peer-code'))), db), mode: 'heroic', campaign: 'millbrook_demo' });
    const guess = guestPage(page.dial, 'WRONG1');
    for (let i = 1; i < 5; i++) guess.send({ type: 'join', code: `WRONG${i + 1}` });
    await until(() => guess.transport.hungUp, 'hang-up');
    expect(guess.of('error').map((e) => e.message)).toEqual(Array(5).fill('That join code is wrong'));
    expect(guess.of('snapshot')).toEqual([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(page.dials()).toBe(1);
  });
});
