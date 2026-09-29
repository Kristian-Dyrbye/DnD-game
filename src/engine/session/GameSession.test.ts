import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/protocol';
import type { SaveMeta } from '../../shared/save';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState, type SavePort, type SessionPorts, type SessionSaveMeta } from './GameSession';
import { GameStateSchema, LOG_LIMIT, type GameState } from './gameState';

const db = loadSrd();
const hero = buildCharacter(toBuildInput(quickBuild('wizard', db, Rng.fromSeed('w'))), db);

function memorySaves() {
  const files = new Map<string, { meta: SaveMeta; state: GameState }>();
  const toMeta = (slotId: string, m: SessionSaveMeta, kind: SaveMeta['kind']): SaveMeta => ({ ...m, slotId, kind, savedAt: '2026-01-01T00:00:00Z' });
  const port: SavePort = {
    save: (slot, m, state) => {
      const meta = toMeta(slot, m, 'manual');
      files.set(slot, { meta, state: structuredClone(state) });
      return meta;
    },
    autosave: (m, state) => port.save('auto-1', m, state),
    load: (slot) => {
      const f = files.get(slot);
      if (!f) throw new Error(`No save in slot ${slot}`);
      return structuredClone(f.state);
    },
  };
  return { port, files };
}

function setup(ports: SessionPorts = {}) {
  const session = new GameSession({ newSeed: () => 'seed', ...ports });
  const events: ServerEvent[] = [];
  session.on((e) => events.push(e));
  return { session, events };
}

describe('GameSession', () => {
  it('answers ping and refuses game commands before a game starts', async () => {
    const { session, events } = setup();
    await session.handle({ type: 'ping', reqId: 'a' });
    await session.handle({ type: 'say', text: 'hello', reqId: 'b' });
    await session.handle({ type: 'get_state' });
    expect(events).toEqual([
      { type: 'pong', reqId: 'a' },
      { type: 'error', message: 'No game is running', reqId: 'b' },
      { type: 'error', message: 'No game is running' },
    ]);
  });

  it('new_game emits a snapshot with a valid, deterministic state and autosaves', async () => {
    const saves = memorySaves();
    const { session, events } = setup({ saves: saves.port });
    await session.handle({ type: 'new_game', hero, mode: 'hardcore' });
    const snap = events.find((e) => e.type === 'snapshot');
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    expect(GameStateSchema.safeParse(snap.state).success).toBe(true);
    expect(snap.state.mode).toBe('hardcore');
    expect(snap.state.rng).toEqual(newGameState(hero, 'hardcore', 'seed').rng);
    expect(saves.files.has('auto-1')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'saved', meta: { characterName: hero.name, level: 1, location: 'Millbrook', mode: 'hardcore' } });
    expect(session.running).toBe(true);
  });

  it('snapshots are copies: mutating one does not change the session', async () => {
    const { session, events } = setup();
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    const snap = events.find((e) => e.type === 'snapshot');
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    snap.state.hero.name = 'Changed';
    expect(session.current.hero.name).toBe(hero.name);
  });

  it('save then load round-trips the state, including the rng position', async () => {
    const saves = memorySaves();
    const { session, events } = setup({ saves: saves.port });
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    session.rng.int(1, 20);
    session.current.flags.met_mayor = true;
    await session.handle({ type: 'save', slot: 'slot-1', name: 'Before the bridge' });
    expect(events.at(-1)).toMatchObject({ type: 'saved', meta: { slotId: 'slot-1', name: 'Before the bridge' } });
    const next = session.rng.int(1, 1000);

    const other = setup({ saves: saves.port });
    await other.session.handle({ type: 'load', slot: 'slot-1' });
    expect(other.events[0]?.type).toBe('snapshot');
    expect(other.session.current.flags.met_mayor).toBe(true);
    expect(other.session.rng.int(1, 1000)).toBe(next);
  });

  it('load of a missing slot reports an error instead of throwing', async () => {
    const { session, events } = setup({ saves: memorySaves().port });
    await session.handle({ type: 'load', slot: 'nope', reqId: 'r' });
    expect(events).toEqual([{ type: 'error', message: 'No save in slot nope', reqId: 'r' }]);
  });

  it('rejects a corrupt loaded state without replacing the running game', async () => {
    const saves = memorySaves();
    const { session, events } = setup({ saves: { ...saves.port, load: () => ({ hero: 'bad' }) } });
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    await session.handle({ type: 'load', slot: 'x' });
    expect(events.at(-1)?.type).toBe('error');
    expect(session.current.hero.name).toBe(hero.name);
  });

  it('routes say/choose to the actions port and acks them', async () => {
    const seen: string[] = [];
    const { session, events } = setup({
      actions: {
        say: async (s, text) => {
          seen.push(`say:${text}`);
          s.addLog('player', text);
        },
        choose: async (_s, id) => {
          seen.push(`choose:${id}`);
        },
      },
    });
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    await session.handle({ type: 'say', text: 'I look around', reqId: 'q' });
    await session.handle({ type: 'choose', actionId: 'open_door' });
    expect(seen).toEqual(['say:I look around', 'choose:open_door']);
    expect(events).toContainEqual({ type: 'log', entry: { id: 1, kind: 'player', text: 'I look around' } });
    expect(events).toContainEqual({ type: 'ack', command: 'say', reqId: 'q' });
  });

  it('caps the story log', async () => {
    const { session } = setup();
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    for (let i = 0; i < LOG_LIMIT + 10; i++) session.addLog('system', `line ${i}`);
    expect(session.current.log).toHaveLength(LOG_LIMIT);
    expect(session.current.log.at(-1)?.text).toBe(`line ${LOG_LIMIT + 9}`);
  });

  it('records rolls with ids and emits them', async () => {
    const { session, events } = setup();
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    const r = session.addRoll({ label: 'Persuasion', dice: [14], modifier: 5, total: 19, math: 'd20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success', success: true });
    expect(r.id).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ type: 'roll', roll: r });
  });
});
