import { describe, expect, it } from 'vitest';
import path from 'node:path';
import companionsJson from '../data/companions.json';
import flagsJson from '../data/adventures/flags.json';
import loreJson from '../data/world/lore.json';
import starter from '../data/adventures/starter/millbrook_disappearances.json';
import defeatsJson from '../data/tables/defeat-outcomes.json';
import { loadAdventures } from '../src/server/adventures';
import { validateAdventure } from '../src/engine/adventure/validate';
import { availableActions, getProgress, perform, resolveEncounter, startAdventure, type RunContext, type StepResult } from '../src/engine/adventure/runner';
import { solveAdventure } from '../src/engine/adventure/solver';
import { adventureActionPort } from '../src/engine/adventure/sessionActions';
import { DefeatTableSchema } from '../src/engine/adventure/defeat';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { CompanionRosterSchema } from '../src/engine/party/companions';
import { GameSession, newGameState } from '../src/engine/session/GameSession';
import { createDefaultRegistry } from '../src/engine/systems';
import { FlagRegistry } from '../src/engine/world/flags';
import { LoreSchema } from '../src/engine/world/lore';
import type { Adventure } from '../src/engine/adventure/schema';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const registry = () => FlagRegistry.fromJson(flagsJson);
const ADV = validateAdventure(structuredClone(starter), db, registry(), roster).adventure!;

/** Always rolls 20 (every check succeeds). */
class LuckyRng extends Rng {
  constructor() {
    super([1, 2, 3, 4]);
  }
  override int(min: number, max: number): number {
    return max === 20 ? 20 : super.int(min, max);
  }
}

function ctx(opts: { lucky?: boolean } = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('starter'))), db);
  const state = newGameState(hero, 'heroic', 'starter');
  return { state, adventure: ADV, rng: opts.lucky ? new LuckyRng() : Rng.fromSeed(3), db, flags: registry(), companions: roster };
}

/** Do the steps, winning every fight; a trailing `*` picks the first offered id with that prefix. */
function play(c: RunContext, steps: string[]): StepResult[] {
  const out: StepResult[] = [];
  for (const step of steps) {
    const ids = availableActions(c).map((a) => a.id);
    const id = step.endsWith('*') ? (ids.find((x) => x.startsWith(step.slice(0, -1))) ?? step) : step;
    if (!ids.includes(id)) throw new Error(`"${id}" not offered in ${getProgress(c.state)?.sceneId}: ${ids.join(', ')}`);
    let r = perform(c, id);
    out.push(r);
    for (let g = 0; r.encounter && g < 5; g++) {
      r = resolveEncounter(c, r.encounter, 'win');
      out.push(r);
    }
  }
  return out;
}

describe('starter arc: The Millbrook Disappearances', () => {
  it('validates with no errors or warnings and the server loads it', () => {
    const v = validateAdventure(structuredClone(starter), db, registry(), roster);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    const loaded = loadAdventures(path.join(process.cwd(), 'data', 'adventures'), db, registry(), roster);
    expect(loaded.adventures.has('millbrook_disappearances')).toBe(true);
    expect(loaded.problems).toEqual([]);
  });

  it('covers the seven designed scenes and teaches with tips', () => {
    const ids = ADV.chapters.flatMap((c) => c.scenes.map((s) => s.id));
    for (const s of ['millbrook_arrival', 'plough_tavern_talk', 'gallows_hill_trail', 'barrow_of_the_first_sheaf', 'barrow_shrine_rest', 'marrows_goods_and_oath', 'road_south']) expect(ids).toContain(s);
    expect(JSON.stringify(ADV).match(/"tip":/g)!.length).toBeGreaterThanOrEqual(8);
    expect(ADV.endings.every((e) => e.next === 'ch1_whispering_fen')).toBe(true);
  });

  /** Solve one leg: start at `scene` with `flags` preset, stop at a stand-in ending when `goal` holds (or a real ending). */
  function leg(scene: string, flags: Record<string, string | number | boolean>, goal: object | undefined, ending: string) {
    const raw = structuredClone(starter) as unknown as { start: { chapter: string; scene: string }; beats: unknown[]; endings: unknown[] };
    raw.start = { chapter: 'starter', scene };
    if (goal) {
      raw.beats.push({ id: 'leg_done', text: 'leg done', trigger: goal, outcome: { ending: 'leg' } });
      raw.endings.push({ id: 'leg', name: 'Leg', text: 'Leg done.' });
    }
    const adv = validateAdventure(raw, db, registry(), roster).adventure!;
    const c = { ...ctx(), adventure: adv };
    Object.assign(c.state.flags, flags);
    const { rng: _r, ...base } = c;
    return solveAdventure(base, ending, { depth: 40, nodes: 20000 });
  }

  it('the solver can finish every leg of the arc (in legs: optional actions explode the search)', () => {
    const a = 'arc.starter.';
    const legs = [
      leg('millbrook_arrival', {}, { flag: `${a}altar_won` }, 'leg'),
      leg('barrow_tithe_altar', { [`${a}altar_won`]: true, [`${a}crypt_cleared`]: true, [`${a}has_ring`]: true, 'world.corwin_status': 'met', 'arc.main.tooth_want_holder': 'player' }, { flag: `${a}slept` }, 'leg'),
      leg('millbrook_arrival', { [`${a}altar_won`]: true, [`${a}captives_freed`]: true, [`${a}slept`]: true, [`${a}has_ring`]: true, 'world.corwin_status': 'met' }, { flag: `${a}oath_done` }, 'leg'),
      leg('road_south', { [`${a}oath_done`]: true, 'arc.main.tooth_want_holder': 'player' }, undefined, 'starter_ravensgate'),
      leg('road_south', { [`${a}oath_done`]: true, 'arc.main.tooth_want_holder': 'player' }, undefined, 'starter_brightwater'),
    ];
    for (const [i, r] of legs.entries()) expect(r.ok, `leg ${i}: ${!r.ok ? r.reason : ''}`).toBe(true);
  });

  it('scripted playthrough: key, hill, barrow, rescue, rest, Corwin joins, road to Ravensgate', () => {
    const c = ctx({ lucky: true });
    startAdventure(c);
    play(c, ['well.examine', 'exit.tavern', 'persuade_reeve', 'exit.out', 'exit.hill', 'track', 'ford_athletics', 'sneak', 'exit.barrow']);
    expect(c.state.flags['arc.starter.reeve_attitude']).toBe('friendly');
    expect(c.state.flags['arc.starter.ambush_avoided']).toBe(true);
    expect(getProgress(c.state)!.sceneId).toBe('barrow_of_the_first_sheaf');
    expect(c.state.extensions.dungeon).toEqual({ barrow: { revealed: ['root_hall'] } });
    play(c, ['exit.crypt', 'free_corwin', 'exit.altar']);
    expect(c.state.flags['world.corwin_status']).toBe('met');
    expect(c.state.flags['arc.main.tooth_want_holder']).toBe('player');
    expect(c.state.hero.coins).toBeGreaterThanOrEqual(2500);
    play(c, ['free_fast', 'chase', 'exit.shrine', 'rekindle', 'rest_safe', 'exit.home', 'exit.tavern', 'sleep_free', 'exit.out']);
    expect(c.state.flags['arc.starter.captives_saved']).toBe(4);
    expect(c.state.flags['arc.starter.ashby_fate']).toBe('captured');
    expect(c.state.flags['arc.starter.dream_heard']).toBe(true);
    expect(c.state.hero.hp).toBe(c.state.hero.maxHp);
    play(c, ['exit.shop', 'return_ring', 'recruit']);
    expect(c.state.companions.map((x) => x.id)).toEqual(['corwin']);
    expect(c.state.flags['world.corwin_loyalty']).toBe(60); // 50 + 10 for all four saved
    play(c, ['exit.green', 'exit.road', 'to_ravensgate']);
    const end = play(c, ['arrive']).at(-1)!;
    expect(end.ending).toBe('starter_ravensgate');
    expect(c.state.flags['arc.starter.first_destination']).toBe('ravensgate');
  });

  it('failure paths still move the story on: chained in the crypt, Tobin lost, Brightwater hands the Tooth to the Almonry', () => {
    const c = ctx({ lucky: true });
    startAdventure(c);
    play(c, ['exit.tavern', 'persuade_reeve', 'exit.out', 'exit.hill', 'track', 'ford_athletics', 'sneak', 'exit.barrow', 'exit.crypt']);
    // Lose the crypt fight this time.
    const lost = resolveEncounter(c, 'crypt_cultists', 'lose');
    expect(lost.facts.join(' ')).toContain('chained');
    expect(availableActions(c).map((a) => a.id)).toContain('slip_chains');
    play(c, ['slip_chains', 'free_corwin', 'exit.altar', 'free_fast', 'let_go', 'exit.shrine', 'rest_cold', 'exit.home', 'exit.tavern', 'sleep_free', 'exit.out', 'exit.shop', 'recruit', 'exit.green', 'exit.road', 'to_brightwater', 'pay']);
    expect(c.state.flags['arc.starter.captives_saved']).toBe(3); // one taken
    const end = play(c, ['hand_over']).at(-1)!;
    expect(end.ending).toBe('starter_brightwater');
    expect(c.state.flags['arc.main.tooth_want_holder']).toBe('choir');
  });

  it('the session starts chapter 1 right after the starter ending', async () => {
    const all = loadAdventures(path.join(process.cwd(), 'data', 'adventures'), db, registry(), roster).adventures as Map<string, Adventure>;
    const lore = LoreSchema.parse(loreJson);
    const session = new GameSession({
      actions: adventureActionPort(all, 'millbrook_disappearances', db, { lore, flags: registry(), companions: roster, defeats: DefeatTableSchema.parse(defeatsJson) }),
      systems: createDefaultRegistry({ lore }),
      newSeed: () => 'chain',
      saves: { save: () => { throw new Error('no'); }, autosave: (m) => ({ ...m, slotId: 'auto-1', kind: 'auto', savedAt: 'now' }), load: () => { throw new Error('no'); } },
    });
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('chain'))), db);
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    expect(getProgress(session.current)!.adventureId).toBe('millbrook_disappearances');
    // Jump to the road and finish the starter arc.
    const p = getProgress(session.current)!;
    p.sceneId = 'road_ravensgate';
    session.current.flags['arc.starter.wolves_done'] = true;
    await session.handle({ type: 'choose', actionId: 'arrive' });
    expect(getProgress(session.current)!.adventureId).toBe('ch1_whispering_fen');
    expect(session.current.log.some((l) => l.text === '— The Whispering Fen —')).toBe(true);
    expect(session.current.extensions.completedAdventures).toEqual([{ id: 'millbrook_disappearances', ending: 'starter_ravensgate' }]);
  });
});
