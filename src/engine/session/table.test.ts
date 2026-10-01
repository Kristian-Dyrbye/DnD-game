import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ClientCommand, ServerEvent } from '../../shared/protocol';
import { parseCommand } from '../../shared/protocol';
import { activeFight } from '../adventure/fights';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { currentId } from '../combat/turns';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema, playerControlled } from '../party/companions';
import { LoreSchema } from '../world/lore';
import { GameSession, newGameState } from './GameSession';
import type { GameState } from './gameState';
import { addSeat, allows, charactersOf, ownerOf, removeSeat, soloTable, type Table } from './table';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('h'))), db);

/** A state with two companions; `control` as stored in extensions.party.control; optional fight turn. */
function stateWith(control: Record<string, string>, turn?: string): GameState {
  const s = newGameState(hero(), 'heroic', 'tbl');
  const mate = (id: string) => ({ ...hero(), id, name: id });
  s.companions = [mate('nettle'), mate('rook')];
  s.extensions.party = { control };
  if (turn) s.extensions.combat = { enc: { state: { turns: { order: [{ id: turn }], currentIndex: 0 } } } };
  return s;
}

function coopTable(policy: Table['policy'] = 'host_decides'): Table {
  const t = soloTable();
  t.policy = policy;
  addSeat(t, 'player', 'Kim');
  addSeat(t, 'spectator');
  return t;
}

const cmd = (type: ClientCommand['type']) => ({ type });

describe('table seats', () => {
  it('solo play is a table with only the host seat, and the host may do everything', () => {
    const t = soloTable();
    expect(t.seats).toEqual([{ id: 'host', role: 'host' }]);
    for (const type of ['new_game', 'load', 'save', 'say', 'choose', 'travel', 'shop_buy', 'journal_save', 'combat_act', 'companion_control', 'set_language'] as const)
      expect(allows(t, cmd(type), 'host', stateWith({}, 'hero'))).toEqual({ ok: true });
  });

  it('guests get the lowest free guest-<n> id; the host seat stays', () => {
    const t = coopTable();
    expect(t.seats.map((s) => s.id)).toEqual(['host', 'guest-1', 'guest-2']);
    expect(removeSeat(t, 'guest-1')).toBe(true);
    expect(removeSeat(t, 'host')).toBe(false);
    expect(addSeat(t, 'player').id).toBe('guest-1');
  });

  it('owners come from companion control: seat:<id> while seated, else the host', () => {
    const t = coopTable();
    const s = stateWith({ nettle: 'seat:guest-1', rook: 'player' });
    expect(ownerOf(t, s, 'hero')).toBe('host');
    expect(ownerOf(t, s, 'nettle')).toBe('guest-1');
    expect(ownerOf(t, s, 'rook')).toBe('host');
    expect(charactersOf(t, s, 'host')).toEqual(['hero', 'rook']);
    expect(charactersOf(t, s, 'guest-1')).toEqual(['nettle']);
    expect(charactersOf(t, s, 'guest-2')).toEqual([]);
    // A seat that left: its characters fall back to the host.
    removeSeat(t, 'guest-1');
    expect(ownerOf(t, s, 'nettle')).toBe('host');
  });

  it('playerControlled filters by seat; without a seat it lists every human-controlled companion', () => {
    const s = stateWith({ nettle: 'seat:guest-1', rook: 'player' });
    expect(playerControlled(s)).toEqual(['nettle', 'rook']);
    expect(playerControlled(s, 'host')).toEqual(['rook']);
    expect(playerControlled(s, 'guest-1')).toEqual(['nettle']);
  });
});

describe('who may do what (allows)', () => {
  it('unknown seats are refused everything, even a ping', () => {
    expect(allows(coopTable(), cmd('ping'), 'guest-9')).toEqual({ ok: false, key: 'table.noSeat' });
  });

  it('anyone seated may ping and ask for the state', () => {
    const t = coopTable();
    for (const seat of ['host', 'guest-1', 'guest-2']) {
      expect(allows(t, cmd('ping'), seat).ok).toBe(true);
      expect(allows(t, cmd('get_state'), seat).ok).toBe(true);
    }
  });

  it('new game, load, save, language, thumbnail and companion control are the host’s alone', () => {
    for (const policy of ['host_decides', 'anyone'] as const) {
      const t = coopTable(policy);
      for (const type of ['new_game', 'load', 'save', 'set_language', 'thumbnail', 'companion_control'] as const) {
        expect(allows(t, cmd(type), 'guest-1')).toEqual({ ok: false, key: 'table.hostOnly' });
        expect(allows(t, cmd(type), 'guest-2')).toEqual({ ok: false, key: 'table.hostOnly' });
      }
    }
  });

  it('host_decides: a guest’s say/choose is a proposal, other story commands are refused', () => {
    const t = coopTable();
    expect(allows(t, cmd('say'), 'guest-1')).toEqual({ ok: false, key: 'table.proposeOnly', propose: true });
    expect(allows(t, cmd('choose'), 'guest-1')).toEqual({ ok: false, key: 'table.proposeOnly', propose: true });
    for (const type of ['travel', 'shop_buy', 'equip', 'journal_save', 'repair'] as const) expect(allows(t, cmd(type), 'guest-1')).toEqual({ ok: false, key: 'table.hostOnly' });
  });

  it('level-up belongs to the seat that owns the character; any player seat may add a hero (C002)', () => {
    for (const policy of ['host_decides', 'anyone'] as const) {
      const t = coopTable(policy);
      const s = stateWith({ nettle: 'seat:guest-1' });
      expect(allows(t, cmd('level_up'), 'host', s)).toEqual({ ok: true });
      expect(allows(t, cmd('level_up'), 'guest-1', s)).toEqual({ ok: false, key: 'table.notYourCharacter' });
      expect(allows(t, { type: 'level_up', characterId: 'nettle' }, 'guest-1', s)).toEqual({ ok: true });
      expect(allows(t, { type: 'level_up', characterId: 'nettle' }, 'host', s)).toEqual({ ok: false, key: 'table.notYourCharacter' });
      expect(allows(t, cmd('add_hero'), 'guest-1', s)).toEqual({ ok: true });
      expect(allows(t, cmd('add_hero'), 'guest-2', s)).toEqual({ ok: false, key: 'table.spectator' });
    }
  });

  it('anyone: player seats act in the story; spectators still only watch and propose', () => {
    const t = coopTable('anyone');
    for (const type of ['say', 'choose', 'travel', 'shop_buy', 'journal_save'] as const) expect(allows(t, cmd(type), 'guest-1')).toEqual({ ok: true });
    for (const type of ['say', 'choose'] as const) expect(allows(t, cmd(type), 'guest-2')).toEqual({ ok: false, key: 'table.proposeOnly', propose: true });
    for (const type of ['travel', 'shop_buy', 'journal_save'] as const) expect(allows(t, cmd(type), 'guest-2')).toEqual({ ok: false, key: 'table.spectator' });
  });

  it('only the host sets the table policy (C006)', () => {
    for (const policy of ['host_decides', 'anyone'] as const) {
      const t = coopTable(policy);
      expect(allows(t, cmd('set_policy'), 'host')).toEqual({ ok: true });
      expect(allows(t, cmd('set_policy'), 'guest-1')).toEqual({ ok: false, key: 'table.hostOnly' });
      expect(allows(t, cmd('set_policy'), 'guest-2')).toEqual({ ok: false, key: 'table.hostOnly' });
    }
  });

  it('fight commands belong to the seat that owns the creature whose turn it is', () => {
    const t = coopTable('anyone');
    const guestTurn = stateWith({ nettle: 'seat:guest-1' }, 'nettle');
    expect(allows(t, cmd('combat_act'), 'guest-1', guestTurn)).toEqual({ ok: true });
    expect(allows(t, cmd('combat_act'), 'host', guestTurn)).toEqual({ ok: false, key: 'table.notYourTurn' });
    expect(allows(t, cmd('combat_flee'), 'host', guestTurn)).toEqual({ ok: false, key: 'table.notYourTurn' });
    const heroTurn = stateWith({ nettle: 'seat:guest-1' }, 'hero');
    expect(allows(t, cmd('combat_act'), 'host', heroTurn)).toEqual({ ok: true });
    expect(allows(t, cmd('combat_act'), 'guest-1', heroTurn)).toEqual({ ok: false, key: 'table.notYourTurn' });
    expect(allows(t, cmd('combat_act'), 'guest-2', heroTurn)).toEqual({ ok: false, key: 'table.spectator' });
    // No fight: the fight port answers itself.
    expect(allows(t, cmd('combat_act'), 'guest-1', stateWith({}))).toEqual({ ok: true });
  });
});

describe('GameSession with a table', () => {
  function session() {
    const raw = structuredClone(demo) as unknown as { chapters: { scenes: { actions: Record<string, unknown>[] }[] }[] };
    raw.chapters[0]!.scenes[0]!.actions.push({ id: 'hire', label: 'Hire', once: true, outcome: { recruit: 'nettle' } });
    const adventure = validateAdventure(raw, db).adventure!;
    const s = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, companions: roster }), newSeed: () => 'tbl' });
    const events: ServerEvent[] = [];
    s.on((e) => events.push(e));
    return { s, events };
  }

  it('solo play is unchanged: commands without a seat come from the host', async () => {
    const { s, events } = session();
    await s.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    await s.handle({ type: 'choose', actionId: 'hire' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(s.table.seats).toEqual([{ id: 'host', role: 'host' }]);
  });

  it('refusals become error events (in the session language) and change nothing', async () => {
    const { s, events } = session();
    await s.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    addSeat(s.table, 'player');
    const before = JSON.stringify(s.current);
    await s.handle({ type: 'choose', actionId: 'hire', reqId: 'g1' }, 'guest-1');
    // Under host_decides a guest's choice is a proposal for the host (C006), not an error.
    expect(events.at(-1)).toMatchObject({ type: 'proposal', seat: 'guest-1', command: 'choose', actionId: 'hire' });
    await s.handle({ type: 'save', slot: 'quicksave', reqId: 'g2' }, 'guest-1');
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Only the host can do that', reqId: 'g2' });
    s.language = 'da';
    await s.handle({ type: 'say', text: 'hej', reqId: 'g3' }, 'guest-7');
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Du har ikke en plads ved bordet', reqId: 'g3' });
    expect(JSON.stringify(s.current)).toBe(before);
    // Under `anyone` the same choice goes through.
    s.table.policy = 'anyone';
    s.language = 'en';
    await s.handle({ type: 'choose', actionId: 'hire' }, 'guest-1');
    expect(s.current.companions.map((c) => c.id)).toEqual(['nettle']);
  });

  it('the host lends a companion to a seated guest (seat:<id> control), never to an empty seat', async () => {
    const { s, events } = session();
    await s.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    await s.handle({ type: 'choose', actionId: 'hire' });
    await s.handle({ type: 'companion_control', companionId: 'nettle', control: 'seat:guest-1', reqId: 'x' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'You have no seat at this table', reqId: 'x' });
    addSeat(s.table, 'player');
    await s.handle({ type: 'companion_control', companionId: 'nettle', control: 'seat:guest-1' });
    expect(s.current.log.at(-1)?.text).toContain('is now played by guest-1');
    expect(charactersOf(s.table, s.current, 'guest-1')).toEqual(['nettle']);
    expect(playerControlled(s.current, 'guest-1')).toEqual(['nettle']);
  });

  it('in a fight only the owner of the acting creature may act', async () => {
    const { s, events } = session();
    await s.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    addSeat(s.table, 'player');
    await s.handle({ type: 'choose', actionId: 'hire' });
    await s.handle({ type: 'companion_control', companionId: 'nettle', control: 'seat:guest-1' });
    await s.handle({ type: 'choose', actionId: 'talk_mayor' });
    await s.handle({ type: 'choose', actionId: 'exit.to_mill' });
    await s.handle({ type: 'choose', actionId: 'exit.unlock' });
    const fight = activeFight(s.current);
    expect(fight?.enc.controlled).toEqual(['hero', 'nettle']);
    const up = currentId(fight!.enc.state.turns);
    const wrong = up === 'nettle' ? 'host' : 'guest-1';
    await s.handle({ type: 'combat_act', action: { kind: 'end_turn' }, reqId: 'w' }, wrong);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'It is not your character’s turn', reqId: 'w' });
    expect(currentId(activeFight(s.current)!.enc.state.turns)).toBe(up);
    const right = up === 'nettle' ? 'guest-1' : 'host';
    await s.handle({ type: 'combat_act', action: { kind: 'end_turn' }, reqId: 'r' }, right);
    expect(events.filter((e) => e.type === 'error' && e.reqId === 'r')).toEqual([]);
  });

  it('the protocol accepts seat:<id> control and rejects other values', () => {
    expect(parseCommand(JSON.stringify({ type: 'companion_control', companionId: 'nettle', control: 'seat:guest-2' })).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ type: 'companion_control', companionId: 'nettle', control: 'seat:nobody' })).ok).toBe(false);
  });
});
