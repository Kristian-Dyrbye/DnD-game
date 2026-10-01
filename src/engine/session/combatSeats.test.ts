import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { activeFight } from '../adventure/fights';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { setSeats, setupEncounter, waitingOn, playerAct } from '../combat/encounter';
import { currentId } from '../combat/turns';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema } from '../party/companions';
import { LoreSchema } from '../world/lore';
import { GameSession, newGameState } from './GameSession';
import { addSeat, fightSeats, setAway, soloTable } from './table';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const build = (cls: 'fighter' | 'cleric', seed: string) => buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(seed))), db);

describe('fightSeats (C003)', () => {
  it('maps every human-played creature to its seat; away, missing and AI seats fight with the AI', () => {
    const t = soloTable();
    addSeat(t, 'player');
    addSeat(t, 'player');
    addSeat(t, 'spectator');
    const s = newGameState(build('fighter', 'h'), 'heroic', 'seats');
    const mate = (id: string) => ({ ...build('fighter', id), id, name: id });
    s.companions = ['a', 'b', 'c', 'd', 'e', 'f'].map(mate);
    s.extensions.party = { control: { a: 'player', b: 'seat:guest-1', c: 'seat:guest-2', d: 'seat:guest-9', e: 'ai', f: 'seat:guest-3', ghost: 'player' } };
    expect(fightSeats(t, s)).toEqual({ hero: 'host', a: 'host', b: 'guest-1', c: 'guest-2' });
    expect(setAway(t, 'guest-2', true)).toBe(true);
    expect(setAway(t, 'guest-2', true)).toBe(false);
    expect(setAway(t, 'host', true)).toBe(false);
    expect(fightSeats(t, s)).toEqual({ hero: 'host', a: 'host', b: 'guest-1' });
    expect(setAway(t, 'guest-2', false)).toBe(true);
    expect(t.seats.find((x) => x.id === 'guest-2')).toEqual({ id: 'guest-2', role: 'player' });
    expect(fightSeats(t, s)).toMatchObject({ c: 'guest-2' });
  });
});

describe('encounter seats (C003)', () => {
  function fight(seed: string) {
    const ctx = { rng: Rng.fromSeed(seed), db };
    const hero = build('fighter', 'hero');
    const mate = { ...build('cleric', 'mate'), id: 'mate', name: 'Wren' };
    const enc = setupEncounter({ hero, companions: [mate], seats: { hero: 'host', mate: 'guest-1' }, monsters: [{ id: 'goblin_warrior', count: 2 }], db }, ctx);
    return { enc, ctx };
  }

  it('records the seat of each controlled creature and waits for a guest only on its turn', () => {
    const { enc, ctx } = fight('s1');
    expect(enc.controlled).toEqual(['hero', 'mate']);
    expect(enc.seats).toEqual({ hero: 'host', mate: 'guest-1' });
    let sawGuest = false;
    for (let i = 0; i < 20 && enc.status === 'ongoing'; i++) {
      const up = currentId(enc.state.turns)!;
      const w = waitingOn(enc);
      if (up === 'mate') {
        sawGuest = true;
        expect(w).toEqual({ creatureId: 'mate', name: 'Wren', seat: 'guest-1' });
      } else expect(w).toBeUndefined();
      playerAct(enc, ctx, { kind: 'end_turn' });
    }
    expect(sawGuest).toBe(true);
  });

  it('a released creature is played by the AI at once, and taken back from its next turn', () => {
    const { enc, ctx } = fight('s2');
    for (let i = 0; i < 20 && enc.status === 'ongoing' && currentId(enc.state.turns) !== 'mate'; i++) playerAct(enc, ctx, { kind: 'end_turn' });
    expect(currentId(enc.state.turns)).toBe('mate');
    const lines = enc.logSeq ?? 0;
    setSeats(enc, ctx, { hero: 'host' });
    expect(enc.controlled).toEqual(['hero']);
    expect(enc.seats).toEqual({ hero: 'host' });
    // The AI finished Wren's turn and the fight ran on to the hero.
    expect(enc.logSeq ?? 0).toBeGreaterThan(lines);
    expect(enc.status).toBe('ongoing');
    expect(currentId(enc.state.turns)).toBe('hero');
    expect(waitingOn(enc)).toBeUndefined();
    setSeats(enc, ctx, { hero: 'host', mate: 'guest-1', goblin_warrior_1: 'guest-1' });
    // Foes and allies can't be handed to a seat.
    expect(enc.controlled).toEqual(['hero', 'mate']);
  });

  it('solo fights carry no seats and never wait on anyone', () => {
    const ctx = { rng: Rng.fromSeed('solo'), db };
    const enc = setupEncounter({ hero: build('fighter', 'hero'), monsters: [{ id: 'goblin_warrior', count: 1 }], db }, ctx);
    expect(enc.seats).toBeUndefined();
    expect(waitingOn(enc)).toBeUndefined();
  });
});

describe('GameSession fights per seat (C003)', () => {
  function session() {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const s = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, companions: roster }), newSeed: () => 'coop' });
    const events: ServerEvent[] = [];
    s.on((e) => events.push(e));
    return { s, events };
  }

  async function toFight(s: GameSession) {
    await s.handle({ type: 'new_game', hero: build('fighter', 'host'), mode: 'heroic' });
    addSeat(s.table, 'player');
    await s.handle({ type: 'add_hero', hero: { ...build('cleric', 'guest'), name: 'Wren' } }, 'guest-1');
    await s.handle({ type: 'choose', actionId: 'talk_mayor' });
    await s.handle({ type: 'choose', actionId: 'exit.to_mill' });
    await s.handle({ type: 'choose', actionId: 'exit.unlock' });
    const f = activeFight(s.current);
    expect(f).toBeDefined();
    return f!;
  }

  /** Ends turns as whoever is up until the guest's hero is up (or the fight is over). */
  async function untilGuestTurn(s: GameSession) {
    for (let i = 0; i < 30; i++) {
      const f = activeFight(s.current);
      if (!f || currentId(f.enc.state.turns) === 'hero-2') return f;
      await s.handle({ type: 'combat_act', action: { kind: 'end_turn' } }, 'host');
    }
    return activeFight(s.current);
  }

  it('the fight knows each seat, and the table hears whose player it waits for (en + da)', async () => {
    const { s, events } = session();
    const f = await toFight(s);
    expect(f.enc.seats).toEqual({ hero: 'host', 'hero-2': 'guest-1' });
    const g = await untilGuestTurn(s);
    expect(g && currentId(g.enc.state.turns)).toBe('hero-2');
    const last = events.findLast((e) => e.type === 'combat' || e.type === 'waiting');
    expect(last).toEqual({ type: 'waiting', creatureId: 'hero-2', name: 'Wren', seat: 'guest-1', text: 'Waiting for Wren’s player…' });
    // The host can't play the guest's turn; the guest can.
    await s.handle({ type: 'combat_act', action: { kind: 'end_turn' }, reqId: 'h' }, 'host');
    expect(events.at(-1)).toEqual({ type: 'error', message: 'It is not your character’s turn', reqId: 'h' });
    s.language = 'da';
    await s.handle({ type: 'combat_act', action: { kind: 'dodge' } }, 'guest-1');
    const da = events.findLast((e) => e.type === 'waiting');
    expect(da).toMatchObject({ text: 'Venter på spilleren bag Wren…' });
  });

  it('a guest who goes away is played by the AI (at once on their turn) and gets the hero back on return', async () => {
    const { s, events } = session();
    await toFight(s);
    const g = await untilGuestTurn(s);
    expect(g && currentId(g.enc.state.turns)).toBe('hero-2');
    const before = events.length;
    await s.setSeatAway('guest-1', true);
    const f = activeFight(s.current)!;
    expect(f.enc.controlled).toEqual(['hero']);
    expect(currentId(f.enc.state.turns)).toBe('hero');
    expect(events.slice(before).some((e) => e.type === 'combat')).toBe(true);
    expect(events.slice(before).some((e) => e.type === 'waiting')).toBe(false);
    expect(events.slice(before).some((e) => e.type === 'error')).toBe(false);
    await s.setSeatAway('guest-1', false);
    expect(activeFight(s.current)?.enc.controlled).toEqual(['hero', 'hero-2']);
    expect(activeFight(s.current)?.enc.seats).toEqual({ hero: 'host', 'hero-2': 'guest-1' });
  });

  it('marking a seat away outside a fight changes nothing else', async () => {
    const { s, events } = session();
    await s.handle({ type: 'new_game', hero: build('fighter', 'host'), mode: 'heroic' });
    addSeat(s.table, 'player');
    const before = events.length;
    await s.setSeatAway('guest-1', true);
    expect(events.length).toBe(before);
    expect(s.table.seats[1]).toMatchObject({ away: true });
  });
});
