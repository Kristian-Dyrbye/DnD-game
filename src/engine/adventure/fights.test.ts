import { describe, expect, it } from 'vitest';
import defeatsJson from '../../../data/tables/defeat-outcomes.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import flagsJson from '../../../data/adventures/flags.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { attackProfiles } from '../combat/attack';
import { isAdjacent } from '../combat/grid';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { FlagRegistry } from '../world/flags';
import { LoreSchema } from '../world/lore';
import { applyDefeat, DefeatTableSchema, pickDefeatOutcome } from './defeat';
import { activeFight } from './fights';
import { getProgress } from './runner';
import { adventureActionPort } from './sessionActions';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const defeats = DefeatTableSchema.parse(defeatsJson);
const flags = FlagRegistry.fromJson(flagsJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);

async function toTheCellar(mode: 'heroic' | 'hardcore' = 'heroic') {
  const saves: string[] = [];
  const session = new GameSession({
    actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, flags, defeats }),
    systems: createDefaultRegistry({ lore }),
    newSeed: () => 'fight',
    saves: {
      save: () => {
        throw new Error('no manual saves');
      },
      autosave: (m) => {
        saves.push(m.location);
        return { ...m, slotId: 'auto-1', kind: 'auto', savedAt: 'now' };
      },
      load: () => {
        throw new Error('no load');
      },
    },
  });
  const events: ServerEvent[] = [];
  session.on((e) => events.push(e));
  await session.handle({ type: 'new_game', hero: hero(), mode });
  await session.handle({ type: 'choose', actionId: 'talk_mayor' });
  await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
  await session.handle({ type: 'choose', actionId: 'exit.unlock' });
  return { session, events, saves };
}

describe('combat from the story', () => {
  it('an encounter starts a tactical fight with a pre-combat autosave; story actions wait', async () => {
    const { session, events, saves } = await toTheCellar();
    const f = activeFight(session.current);
    expect(f?.encounterId).toBe('cellar_rats');
    expect(Object.keys(f!.enc.state.creatures).sort()).toEqual(['giant_rat_1', 'giant_rat_2', 'hero']);
    expect(events.some((e) => e.type === 'combat' && e.encounter !== null)).toBe(true);
    expect(events.some((e) => e.type === 'mood' && e.mood === 'battle')).toBe(true);
    expect(saves.at(-1)).toBe('Mill Cellar'); // saved on arrival, before the first blow
    await session.handle({ type: 'choose', actionId: 'exit.up', reqId: 'x' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'You are in the middle of a fight!', reqId: 'x' });
  });

  it('winning grants XP, applies the win outcome and returns to the story', async () => {
    const { session, events } = await toTheCellar();
    const f = activeFight(session.current)!;
    for (const c of Object.values(f.enc.state.creatures)) if (c.id !== 'hero') c.hp = 1;
    const xp0 = session.current.hero.xp;
    for (let i = 0; i < 40 && activeFight(session.current); i++) {
      const enc = activeFight(session.current)!.enc;
      const me = enc.state.grid.tokens.hero!;
      const foe = Object.values(enc.state.grid.tokens).find((t) => t.id !== 'hero' && enc.state.creatures[t.id]!.hp > 0);
      const melee = attackProfiles(enc.state.creatures.hero!, db).find((p) => p.melee)!;
      if (foe && isAdjacent(me, foe)) await session.handle({ type: 'combat_act', action: { kind: 'attack', targetId: foe.id, profileId: melee.id } });
      await session.handle({ type: 'combat_act', action: { kind: 'end_turn' } });
    }
    expect(activeFight(session.current)).toBeUndefined();
    expect(events.some((e) => e.type === 'combat' && e.encounter === null)).toBe(true);
    const outcome = session.current.flags['adv.millbrook_demo.rats_cleared'];
    const log = events.filter((e) => e.type === 'log').map((e) => (e.type === 'log' ? e.entry.text : ''));
    if (outcome) {
      expect(session.current.hero.xp).toBeGreaterThan(xp0);
      expect(log.some((t) => t.startsWith('Victory! +'))).toBe(true);
    } else {
      // The rats won: Heroic authored defeat (back in the square at ≥ 1 HP).
      expect(session.current.hero.hp).toBeGreaterThanOrEqual(1);
      expect(session.current.location.sceneId).toBe('millbrook_square');
    }
  });

  it('fleeing applies the flee outcome', async () => {
    const { session } = await toTheCellar();
    await session.handle({ type: 'combat_flee' });
    expect(activeFight(session.current)).toBeUndefined();
    expect(session.current.location.sceneId).toBe('old_mill');
  });

  it('Heroic: losing is a setback (authored lose outcome, hero at 1 HP, not dead)', async () => {
    const { session, events } = await toTheCellar('heroic');
    const f = activeFight(session.current)!;
    Object.assign(f.enc.state.creatures.hero!, { hp: 0, dead: true, deathSaves: { successes: 0, failures: 3, stable: false } });
    await session.handle({ type: 'combat_act', action: { kind: 'end_turn' } });
    expect(activeFight(session.current)).toBeUndefined();
    expect(session.current.hero.dead).toBe(false);
    expect(session.current.hero.hp).toBe(1);
    expect(session.current.location.sceneId).toBe('millbrook_square');
    expect(events.some((e) => e.type === 'hero_fallen')).toBe(false);
  });

  it('Hardcore: death is final; a new hero continues the same world', async () => {
    const { session, events } = await toTheCellar('hardcore');
    const f = activeFight(session.current)!;
    Object.assign(f.enc.state.creatures.hero!, { hp: 0, dead: true, deathSaves: { successes: 0, failures: 3, stable: false } });
    await session.handle({ type: 'combat_act', action: { kind: 'end_turn' } });
    expect(events.some((e) => e.type === 'hero_fallen')).toBe(true);
    expect(session.current.hero.dead).toBe(true);
    expect((session.current.extensions.fallen as unknown[]).length).toBe(1);
    const flagsBefore = { ...session.current.flags };
    const t = session.current.time;
    const heir = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed('heir'))), db);
    await session.handle({ type: 'new_game', hero: heir, mode: 'hardcore', continueWorld: true });
    expect(session.current.hero.name).toBe(heir.name);
    expect(session.current.flags).toMatchObject(flagsBefore);
    expect(session.current.time).toBeGreaterThanOrEqual(t);
    expect(getProgress(session.current)?.adventureId).toBe('millbrook_demo');
    expect((session.current.extensions.fallen as unknown[]).length).toBe(1);
  });
});

describe('defeat outcomes table', () => {
  const s = () => {
    const st = newGameState(hero(), 'heroic', 1);
    createDefaultRegistry({ lore }).init(st);
    return st;
  };
  it('picks by place, enemy type and reputation, in order', () => {
    expect(pickDefeatOutcome(defeats, { locationId: 'the_maw', enemies: ['zombie'] }, db, s()).id).toBe('maws_spit');
    expect(pickDefeatOutcome(defeats, { enemies: ['cultist'] }, db, s()).id).toBe('captured_by_choir');
    expect(pickDefeatOutcome(defeats, { regionId: 'gloamfen', enemies: ['wolf'] }, db, s()).id).toBe('rescued_by_wardens');
    expect(pickDefeatOutcome(defeats, { regionId: 'aurelmark', enemies: ['zombie'] }, db, s()).id).toBe('temple_revival');
    expect(pickDefeatOutcome(defeats, { regionId: 'aurelmark', enemies: ['bandit'] }, db, s()).id).toBe('robbed_and_left');
    expect(pickDefeatOutcome(defeats, { regionId: 'aurelmark', enemies: ['wolf'] }, db, s()).id).toBe('left_for_dead');
  });

  it('applies heal, clock, money, item, relocation and times_defeated', () => {
    const st = s();
    st.hero.hp = 0;
    st.hero.coins = 1000;
    const r = applyDefeat(st, defeats.outcomes.find((o) => o.id === 'robbed_and_left')!, { rng: Rng.fromSeed(1), lore, flags });
    expect(st.hero.hp).toBe(1);
    expect(st.hero.coins).toBe(500);
    expect(r.itemLost).toBeDefined();
    expect(st.flags['world.times_defeated']).toBe(1);
    const t = s();
    const moved = applyDefeat(t, defeats.outcomes.find((o) => o.id === 'temple_revival')!, { rng: Rng.fromSeed(1), lore, flags, regionId: 'aurelmark' });
    expect(['highcrown', 'dawnspire_keep']).toContain(moved.movedTo);
  });
});
