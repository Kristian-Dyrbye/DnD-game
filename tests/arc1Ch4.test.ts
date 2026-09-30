/**
 * Arc chapter 4, "Wyrmfire" (data/adventures/arc1/ch4_wyrmfire.json, DESIGN §9): validates against
 * the SRD and the flag registry, companions only change through approval / companionLeaves, every
 * chapter ending and every Pyrraxis solution is reachable (solved in legs), the Emberpeak and palace
 * maps drive exploration and fights, and flags from the starter arc and chapters 1–3 visibly change
 * the chapter (Millbrook's branches, the war council, Vosk and Vey, the Queen).
 */
import { describe, expect, it } from 'vitest';
import ch4Json from '../data/adventures/arc1/ch4_wyrmfire.json';
import flagsJson from '../data/adventures/flags.json';
import companionsJson from '../data/companions.json';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { fightMap } from '../src/engine/adventure/fights';
import { availableActions, describeScene, getProgress, npcsHere, perform, resolveEncounter, startAdventure, type RunContext } from '../src/engine/adventure/runner';
import { OutcomeSchema, type Adventure, type Condition, type Outcome } from '../src/engine/adventure/schema';
import { CompanionRosterSchema } from '../src/engine/party/companions';
import { LuckyRng, solveAdventure } from '../src/engine/adventure/solver';
import { allScenes, flagRefs, validateAdventure } from '../src/engine/adventure/validate';
import { dungeonProgress } from '../src/engine/world/dungeon';
import { newGameState } from '../src/engine/session/GameSession';
import { FlagRegistry, type Flags } from '../src/engine/world/flags';

const db = loadSrd();
const registry = () => FlagRegistry.fromJson(flagsJson);
const chapter = (): Adventure => {
  const r = validateAdventure(structuredClone(ch4Json), db, registry());
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const roster = CompanionRosterSchema.parse(companionsJson);

/** An Rng that always rolls a 1: every check fails. */
class UnluckyRng extends Rng {
  constructor() {
    super([1, 2, 3, 4]);
  }
  override next(): number {
    return 0;
  }
}

/** Every outcome in the chapter. */
function outcomes(x: unknown = ADV, out: Outcome[] = []): Outcome[] {
  if (Array.isArray(x)) for (const v of x) outcomes(v, out);
  else if (x && typeof x === 'object') {
    if (Array.isArray((x as Outcome).approval) && Array.isArray((x as Outcome).flags)) out.push(x as Outcome);
    for (const v of Object.values(x)) outcomes(v, out);
  }
  return out;
}

type Opts = { hour?: number; adventure?: Adventure; lucky?: boolean; rep?: Record<string, number>; coins?: number };
function ctx(flags: Flags = {}, opts: Opts = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('ch4'))), db);
  hero.classes[0]!.level = 7;
  if (opts.coins !== undefined) hero.coins = opts.coins;
  hero.maxHp = hero.hp = 100; // room for story damage (falls, claws, dragonfire)
  const state = newGameState(hero, 'heroic', 'ch4');
  state.time = (opts.hour ?? 10) * 60;
  Object.assign(state.flags, flags);
  if (opts.rep) state.extensions.reputation = { ...opts.rep };
  // The roster makes approval / companionLeaves apply inside the runner step.
  return { state, adventure: opts.adventure ?? ADV, rng: opts.lucky ? new LuckyRng() : Rng.fromSeed(7), db, flags: registry(), companions: roster };
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
/** Performs a scripted path, winning every fight. */
function play(c: RunContext, path: string[]): void {
  for (const id of path) {
    expect(ids(c), `"${id}" is offered`).toContain(id);
    let r = perform(c, id);
    for (let g = 0; r.encounter && g < 5; g++) r = resolveEncounter(c, r.encounter, 'win');
  }
}
/** Same chapter, starting at another scene (keeps solver searches small). */
const startingAt = (scene: string): Adventure => ({ ...ADV, start: { ...ADV.start, scene } });
const begin = (flags: Flags = {}, scene?: string, opts: Opts = {}): RunContext => {
  const c = ctx(flags, { lucky: true, ...opts, ...(scene && { adventure: startingAt(scene) }) });
  startAdventure(c);
  return c;
};
const rep = (c: RunContext, faction: string) => ((c.state.extensions.reputation as Record<string, number> | undefined) ?? {})[faction] ?? 0;
const has = (c: RunContext, item: string) => c.state.hero.inventory.some((i) => i.itemId === item);
const encounter = (id: string) => ADV.encounters.find((e) => e.id === id)!;
const L = (name: string) => `arc.main.ch4_${name}`;
/** Starts a fight the way the session does (on the scene's map), then wins it. */
function fight(c: RunContext, actionId: string) {
  const r = perform(c, actionId);
  const place = fightMap(c, encounter(r.encounter!))!;
  resolveEncounter(c, r.encounter!, 'win');
  return place;
}

describe('ch4_wyrmfire: data', () => {
  it('validates with no errors or warnings', () => {
    const r = validateAdventure(structuredClone(ch4Json), db, registry());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'ch4_wyrmfire', arcId: 'main', kind: 'arc', levelRange: [7, 9], regionId: 'aurelmark' });
    expect(ADV.endings.map((e) => e.id).sort()).toEqual(['crown_endures', 'crown_in_ashes', 'highcrown_fallen', 'regency_council']);
  });

  it('uses the design scene ids at their lore locations', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'ch4_wyrmfire');
    const scenes = allScenes(ADV);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(scenes).toHaveLength(design.length);
  });

  it('writes only registered or documented flags, with valid values', () => {
    const reg = registry();
    const docs = new Map(ADV.flags.map((f) => [f.id, f]));
    const { reads, writes } = flagRefs(ADV);
    for (const w of writes) {
      expect(reg.has(w.id) || docs.has(w.id), w.id).toBe(true);
      if (w.value !== undefined) expect(reg.checkValue(w.id, w.value), w.id).toBeUndefined();
      // Chapter-local flags are boolean unless their doc declares a number counter.
      if (!reg.has(w.id) && w.value !== undefined) expect(typeof w.value, w.id).toBe((docs.get(w.id) as { type?: string }).type ?? 'boolean');
    }
    for (const id of reads) expect(reg.has(id) || docs.has(id), id).toBe(true);
    const written = new Set(writes.map((w) => w.id));
    for (const id of [
      'arc.main.millbrook_militia',
      'arc.main.war_council_allies',
      'arc.main.vosk_fate',
      'arc.main.pyrraxis_fate',
      'arc.main.tooth_ember_holder',
      'arc.main.harrow_vey_fate',
      'arc.main.tooth_want_holder',
      'arc.main.tooth_vaelthorn_holder',
      'world.queen_alive',
      'world.player_outlawed',
      L('isolde_letter'),
    ]) {
      expect(written.has(id), id).toBe(true);
    }
    expect(written.has('arc.main.teeth_secured')).toBe(false);
    expect(written.has('arc.main.teeth_choir')).toBe(false);
    const numbers = ADV.flags.filter((f) => (f as { type?: string }).type === 'number').map((f) => f.id);
    expect(numbers.sort()).toEqual([L('free_failures'), L('free_successes'), L('groups_freed'), L('hold_tries')]);
  });

  it('is loaded by the server adventure loader', async () => {
    const { loadAdventures, loadFlagRegistry } = await import('../src/server/adventures');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '..', 'data', 'adventures');
    const { adventures, problems } = loadAdventures(dir, db, loadFlagRegistry(dir));
    expect(problems.filter((p) => p.file.includes('ch4_wyrmfire'))).toEqual([]);
    expect(adventures.has('ch4_wyrmfire')).toBe(true);
  });

  it('puts Emberpeak and the palace on dungeon maps used by scenes and fights', () => {
    expect(ADV.maps.map((m) => m.id)).toEqual(['emberpeak_lair', 'highcrown_palace']);
    const mapped = allScenes(ADV).filter((s) => s.map).map((s) => `${s.id}@${s.map!.id}/${s.map!.room}`);
    expect(mapped).toEqual(['emberpeak_ascent@emberpeak_lair/scorched_slope', 'pyrraxis_hoard@emberpeak_lair/hoard_cavern', 'highcrown_burning@highcrown_palace/queens_gate']);
    const rooms = ADV.encounters.filter((e) => e.map).map((e) => `${e.id}@${e.room}`);
    expect(rooms).toEqual(
      expect.arrayContaining(['lava_tubes@lava_tubes', 'singers_camp@singers_camp', 'brood_guardian@brood_ledge', 'pyrraxis_slay@hoard_cavern', 'vey_at_court@palace_court', 'vosk_on_stair@grand_stair', 'throne_coup@throne_hall']),
    );
  });
});

describe('ch4_wyrmfire: companions and encounters', () => {
  const all = outcomes();

  it('changes companions only through approval and the authored Corwin leave point', () => {
    const known = new Set(roster.companions.map((d) => d.id));
    expect(all.filter((o) => o.recruit)).toEqual([]);
    for (const o of all) {
      for (const a of o.approval) expect(known.has(a.companion), a.companion).toBe(true);
    }
    const leaves = all.flatMap((o) => (o.companionLeaves ? [`${o.companionLeaves.id}:${o.companionLeaves.status}`] : []));
    expect(leaves).toEqual(['corwin:left']);
  });

  it('never writes companion status or loyalty flags directly', () => {
    const status = new Set(roster.companions.map((d) => d.statusFlag));
    const loyalty = new Set(roster.companions.map((d) => d.loyaltyFlag));
    for (const o of all) {
      for (const f of o.flags) {
        const id = 'set' in f ? f.set : 'inc' in f ? f.inc : f.clear;
        expect(loyalty.has(id), `direct loyalty write ${id}`).toBe(false);
        expect(status.has(id), `direct status write ${id}`).toBe(false);
      }
    }
  });

  it('approval deltas follow the ±5 / ±10 / ±20 scale', () => {
    const deltas = all.flatMap((o) => o.approval.map((a) => a.delta));
    expect(deltas.length).toBeGreaterThan(15);
    for (const d of deltas) expect([5, 10, 20, -5, -10, -20], String(d)).toContain(d);
  });

  it('encounters keep the design groups and declare scaling pools of their own monsters', () => {
    const counts = (id: string) => Object.fromEntries(encounter(id).monsters.map((m) => [m.id, m.count]));
    expect(counts('ember_singers')).toEqual({ cultist_fanatic: 2, magma_mephit: 4, hell_hound: 1 });
    expect(counts('millbrook_raid')).toEqual({ hell_hound: 2 });
    expect(counts('millbrook_converted')).toEqual({ commoner: 6, cultist_fanatic: 1, hell_hound: 2 });
    expect(counts('millbrook_converted_half')).toEqual({ commoner: 3, cultist_fanatic: 1, hell_hound: 2 });
    expect(counts('millbrook_converted_freed')).toEqual({ cultist_fanatic: 1, hell_hound: 2 });
    expect(counts('lava_tubes')).toEqual({ salamander: 2, fire_elemental: 1 });
    expect(counts('singers_camp')).toEqual({ mage: 1, cultist_fanatic: 3 });
    expect(counts('singers_camp_shelled')).toEqual({ mage: 1, cultist_fanatic: 2 }); // Ironvault ballistae remove one
    expect(counts('brood_guardian')).toEqual({ young_red_dragon: 1 });
    expect(counts('pyrraxis_slay')).toEqual({ adult_red_dragon: 1 });
    expect(counts('vey_at_court')).toEqual({ pirate_captain: 1, pirate: 4 });
    expect(counts('vosk_on_stair')).toEqual({ mage: 1, cultist_fanatic: 2 });
    for (const id of ['throne_coup', 'throne_coup_knights', 'throne_coup_guard', 'throne_coup_mercs']) expect(counts(id)).toEqual({ wight: 1, ghast: 3, cultist_fanatic: 2 });
    for (const e of ADV.encounters) {
      if (e.monsters.reduce((s, m) => s + m.count, 0) < 2) continue;
      expect(e.scaling, e.id).toBeDefined();
      for (const id of e.scaling!.pool) {
        expect(db.monsters.has(id), id).toBe(true);
        expect(e.monsters.some((m) => m.id === id), `${e.id} pool ${id}`).toBe(true);
      }
    }
  });

  it('marks the dragons and lieutenants as bosses and puts war-council allies on the party side', () => {
    expect(encounter('pyrraxis_slay').bosses).toEqual(['adult_red_dragon']);
    expect(encounter('brood_guardian').bosses).toEqual(['young_red_dragon']);
    expect(encounter('singers_camp').bosses).toEqual(['mage']);
    expect(encounter('throne_coup').bosses).toEqual(['wight']);
    expect(encounter('vey_at_court').bosses).toEqual(['pirate_captain']);
    const allies = (id: string) => Object.fromEntries(encounter(id).allies.map((a) => [a.id, a.count]));
    expect(allies('ember_singers')).toEqual({});
    expect(allies('ember_singers_patrol')).toEqual({ guard: 3 });
    expect(allies('millbrook_raid_militia')).toEqual({ guard: 2 });
    expect(allies('pyrraxis_slay_lance')).toEqual({ knight: 2 });
    expect(allies('throne_coup')).toEqual({});
    expect(allies('throne_coup_knights')).toEqual({ knight: 3 });
    expect(allies('throne_coup_guard')).toEqual({ guard: 4 });
    expect(allies('throne_coup_mercs')).toEqual({ warrior_veteran: 4 });
  });
});

describe('ch4_wyrmfire: the maps', () => {
  it('scenes reveal their rooms, and a fight on Emberpeak happens in its own room on the same map', () => {
    const c = begin({}, 'emberpeak_ascent');
    expect(dungeonProgress(c.state.extensions, 'emberpeak_lair').revealed).toEqual(['scorched_slope']);
    play(c, ['climb', 'cross_lava']);
    const r = perform(c, 'clear_tubes');
    expect(r.encounter).toBe('lava_tubes');
    const place = fightMap(c, encounter('lava_tubes'))!;
    expect(place).toBeDefined();
    expect(place.spawns.party.length).toBeGreaterThan(0);
    expect(place.spawns.foes.length).toBeGreaterThan(0);
    // Every foe spawn is inside the lava tubes (x 8–13, y 0–4); the unexplored hoard stays under fog.
    for (const p of place.spawns.foes) expect(p.x >= 8 && p.x <= 13 && p.y <= 4, `${p.x},${p.y}`).toBe(true);
    expect(dungeonProgress(c.state.extensions, 'emberpeak_lair').revealed).toEqual(['scorched_slope', 'lava_tubes']);
    expect(place.fog).toContain('5,10');
    resolveEncounter(c, 'lava_tubes', 'win');
    fight(c, 'storm_camp');
    play(c, ['exit.to_hoard']);
    expect(dungeonProgress(c.state.extensions, 'emberpeak_lair').revealed).toEqual(['scorched_slope', 'lava_tubes', 'singers_camp', 'hoard_cavern']);
  });

  it('the palace fights reveal the court, the stair and the throne hall', () => {
    const c = begin({ 'arc.main.harrow_vey_fate': 'escaped', 'arc.main.vosk_fate': 'escaped', [L('camp_done')]: true }, 'highcrown_burning');
    expect(dungeonProgress(c.state.extensions, 'highcrown_palace').revealed).toEqual(['queens_gate']);
    play(c, ['clear_street_1', 'clear_street_2']);
    expect(ids(c)).not.toContain('storm_throne');
    fight(c, 'storm_court');
    play(c, ['kill_vey']);
    fight(c, 'storm_stair');
    play(c, ['capture_vosk_stair']);
    expect(fight(c, 'storm_throne').fog).not.toContain('12,2');
    expect(dungeonProgress(c.state.extensions, 'highcrown_palace').revealed).toEqual(['queens_gate', 'palace_court', 'grand_stair', 'throne_hall']);
  });
});

describe('ch4_wyrmfire: reachability', () => {
  /** Each leg starts where the last one ends; its goal is a synthetic ending that fires when the leg's milestone holds. */
  const leg = (scene: string, goal: Condition): Adventure => ({
    ...startingAt(scene),
    beats: [...ADV.beats, { id: 'leg_goal', text: 'Leg complete.', trigger: goal, scenes: [], outcome: OutcomeSchema.parse({ ending: 'leg_goal' }), required: false }],
    endings: [...ADV.endings, { id: 'leg_goal', name: 'Leg goal', text: '' }],
  });
  const solve = (adventure: Adventure, flags: Flags, ending: string) => solveAdventure({ state: ctx(flags).state, adventure, db, flags: registry() }, ending, { depth: 30, nodes: 60000 });

  it('leg 1: on the Ashfall road, the solver beats the ember-singers and saves the refugees', () => {
    const res = solve(leg('ashfall_road', { all: [{ flag: L('singers_beaten') }, { flag: L('road_done') }, { visited: 'millbrook_remembers' }] }), {}, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['faithful', { 'arc.starter.captives_saved': 4, 'arc.starter.reeve_attitude': 'friendly' }],
    ['wavering', { 'arc.starter.captives_saved': 2 }],
    ['converted', { 'arc.starter.captives_saved': 0, 'arc.starter.reeve_attitude': 'hostile' }],
  ])('leg 2 (%s Millbrook): the solver raises the militia and defends the village', (_name, flags) => {
    const res = solve(leg('millbrook_remembers', { all: [{ flag: 'arc.main.millbrook_militia' }, { flag: L('village_defended') }] }), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it('leg 3: at Dawnspire, the solver seats all six allies and rides for Emberpeak', () => {
    const flags = {
      'arc.main.dawnbreaker_holder': 'dawn_lance',
      'arc.main.cantor_unmasked_publicly': true,
      'arc.main.money_trail_proven': true,
      'arc.main.isles_alliance': 'red_gull',
      'arc.main.millbrook_militia': true,
      'arc.main.parrot_treasure': 'player',
    };
    const res = solve(leg('dawnspire_muster', { all: [{ flag: 'arc.main.war_council_allies', gte: 6 }, { visited: 'emberpeak_ascent' }] }), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  }, 180_000); // the heaviest search in the suite: ~12 s alone, 60 s+ under full parallel load (see A117)

  it.each(['escaped', 'captured'])('leg 4 (Vosk %s): the solver climbs Emberpeak and reaches the lair', (vosk) => {
    const res = solve(leg('emberpeak_ascent', { visited: 'pyrraxis_hoard' }), { 'arc.main.vosk_fate': vosk, [L('muster_done')]: true }, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['slain', {}],
    ['slain', { 'arc.main.dawnbreaker_holder': 'dawn_lance' }],
    ['freed', {}],
    ['bargained', { 'arc.main.tooth_reef_holder': 'player' }],
    ['raging', {}],
  ])('leg 5: in the lair, the solver settles Pyrraxis as %s', (fate, flags) => {
    const goal = { all: [{ flag: 'arc.main.pyrraxis_fate', eq: fate }, { visited: 'highcrown_burning' }] };
    const res = solve(leg('pyrraxis_hoard', goal), { [L('camp_done')]: true, ...flags }, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['crown_endures', { 'world.queen_alive': false, 'arc.main.harrow_vey_fate': 'escaped', 'arc.main.vosk_fate': 'escaped', [L('camp_done')]: true, 'arc.main.pyrraxis_fate': 'slain' }],
    ['crown_endures', { 'arc.main.pyrraxis_fate': 'freed', 'world.player_outlawed': true }],
    ['regency_council', { 'world.queen_alive': false, [L('queen_dead')]: true, 'arc.main.pyrraxis_fate': 'bargained' }],
    ['crown_in_ashes', { 'arc.main.pyrraxis_fate': 'raging' }],
  ])('leg 6: in Highcrown, the solver reaches ending %s', (ending, flags) => {
    const res = solve(startingAt('highcrown_burning'), flags, ending);
    expect(res.ok, res.reason).toBe(true);
  });

  it('a scripted playthrough (faithful Millbrook, six allies, Corwin along) frees Pyrraxis and saves the Queen', () => {
    const c = ctx(
      {
        'arc.starter.captives_saved': 4,
        'arc.starter.reeve_attitude': 'friendly',
        'arc.starter.marrow_ring_returned': true,
        'arc.starter.pip_rescued': true,
        'arc.starter.shrine_rekindled': true,
        'arc.main.dawnbreaker_holder': 'dawn_lance',
        'arc.main.cantor_unmasked_publicly': true,
        'arc.main.cantor_identity_known': true,
        'arc.main.money_trail_proven': true,
        'arc.main.isles_alliance': 'saltwind',
        'arc.main.pell_fate': 'allied',
        'arc.main.parrot_treasure': 'player',
        'arc.main.vosk_fate': 'escaped',
        'arc.main.harrow_vey_fate': 'escaped',
        'world.queen_alive': false,
        'world.corwin_status': 'in_party',
        'world.corwin_loyalty': 50,
      },
      { lucky: true, coins: 0 },
    );
    startAdventure(c);
    play(c, [
      'face_dragon',
      'calm_crowd',
      'call_patrol',
      'fight_singers_patrol',
      'lead_refugees',
      'exit.to_millbrook',
      'light_wards_shrine',
      'marrow_gift',
      'pip_message',
      'rally_militia',
      'defend_village_militia',
      'exit.to_dawnspire',
      'pledge_lance',
      'pledge_crown',
      'pledge_ironvault',
      'pledge_saltwind_pell',
      'pledge_millbrook',
      'hire_mercs',
      'end_council',
      'exit.to_emberpeak',
      'climb',
      'cross_lava',
      'clear_tubes',
      'sneak_camp',
      'unsing_stone',
      'storm_camp_shelled',
      'capture_vosk',
      'exit.to_hoard',
      'barrage_guardian',
      'free_medicine',
      'free_religion',
      'free_athletics',
      'claim_hoard',
      'exit.to_highcrown',
      'clear_street_1',
      'storm_court',
      'capture_vey',
      'storm_throne_knights',
      'tend_queen',
      'ask_letter',
      'end_endures',
    ]);
    const f = c.state.flags;
    expect(getProgress(c.state)?.ending).toBe('crown_endures');
    expect(f).toMatchObject({
      'arc.main.millbrook_militia': true,
      'arc.main.war_council_allies': 6,
      [L('isles_double')]: true,
      [L('mb_in_time')]: true,
      [L('stone_silenced')]: true,
      'arc.main.pyrraxis_fate': 'freed',
      'arc.main.tooth_ember_holder': 'player',
      'arc.main.vosk_fate': 'captured',
      'arc.main.harrow_vey_fate': 'captured',
      'world.queen_alive': true,
      [L('isolde_letter')]: true,
      'world.corwin_status': 'in_party',
      'world.corwin_loyalty': 50 + 5 + 5 + 5 + 5 + 10 + 5 + 10, // crowd, militia, Lance, Vosk spared, freed, Vey spared, Queen
    });
    expect(f[L('queen_dead')]).toBeFalsy();
    for (const item of ['potion_of_heroism', 'potion_of_resistance', 'flame_tongue', 'ring_of_resistance']) expect(has(c, item), item).toBe(true);
    expect(has(c, 'dragon_scale_mail')).toBe(false); // slay path only
    expect(c.state.hero.coins).toBe(15000 + 250000); // barge-masters' purse + the hoard
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(11000 + 14000);
    expect(rep(c, 'crown_of_aurelmark')).toBeGreaterThanOrEqual(50);
  });
});

describe('ch4_wyrmfire: races, fights and consequences', () => {
  it('Millbrook burns if the hero reaches it more than a day after sighting the dragon', () => {
    const late = begin();
    play(late, ['exit.to_dawnspire', 'exit.to_millbrook']);
    expect(late.state.flags[L('mb_burned')]).toBe(true);
    expect(describeScene(late).seed).toContain('too late');
    expect(ids(late)).toEqual(expect.arrayContaining(['search_ashes', 'exit.to_dawnspire']));
    expect(ids(late)).not.toContain('defend_village');

    const onTime = begin({ 'arc.starter.captives_saved': 4, 'arc.starter.reeve_attitude': 'friendly' });
    play(onTime, ['exit.to_millbrook']);
    expect(onTime.state.flags[L('mb_in_time')]).toBe(true);
    expect(ids(onTime)).toContain('rally_militia');
    onTime.state.time += 48 * 60; // lingering does not burn a village the hero is already defending
    expect(ids(onTime)).toContain('rally_militia');
  });

  it('the Queen dies if the hero dawdles two days between the lair and her bedside', () => {
    const c = begin({ 'world.queen_alive': false, [L('camp_done')]: true }, 'pyrraxis_hoard');
    play(c, ['withdraw']);
    c.state.time += 1500;
    perform(c, 'exit.to_highcrown');
    expect(c.state.flags[L('queen_dead')]).toBe(true);
    play(c, ['clear_street_1', 'clear_street_2', 'storm_throne']);
    expect(ids(c)).not.toContain('tend_queen');
    expect(ids(c)).toEqual(['end_ashes']);
  });

  it('three failures ruin the freeing, and every attempt draws a claw', () => {
    const c = begin({ [L('camp_done')]: true, [L('guardian_down')]: true, 'arc.main.tooth_want_holder': 'player' }, 'pyrraxis_hoard', { lucky: false });
    c.rng = new UnluckyRng();
    const hp = c.state.hero.hp;
    perform(c, 'free_medicine');
    expect(c.state.hero.hp).toBeLessThan(hp);
    perform(c, 'free_religion');
    perform(c, 'free_athletics');
    expect(c.state.flags).toMatchObject({ [L('free_failures')]: 3, [L('free_failed')]: true });
    expect(ids(c)).not.toContain('free_medicine');
    expect(ids(c)).toEqual(expect.arrayContaining(['slay_pyrraxis', 'bargain', 'withdraw']));
  });

  it('the bargain costs a Tooth of the hero\'s choosing, which goes to the Choir', () => {
    const c = begin({ [L('camp_done')]: true, [L('guardian_down')]: true, 'arc.main.tooth_want_holder': 'player', 'arc.main.tooth_vaelthorn_holder': 'player', 'arc.main.teeth_secured': 3 }, 'pyrraxis_hoard');
    const r = perform(c, 'bargain');
    expect(r.rolls[0]!.advantage).toEqual(['She hungers for the Teeth you carry']);
    expect(ids(c)).toEqual(expect.arrayContaining(['pay_want', 'pay_vaelthorn']));
    expect(ids(c)).not.toContain('pay_reef');
    perform(c, 'pay_vaelthorn');
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'choir', 'arc.main.tooth_want_holder': 'player', 'arc.main.tooth_ember_holder': 'player', 'arc.main.pyrraxis_fate': 'bargained' });
    const none = begin({ [L('camp_done')]: true, [L('guardian_down')]: true }, 'pyrraxis_hoard');
    expect(ids(none)).not.toContain('bargain');
  });

  it('losing to the brood-guardian leaves Pyrraxis raging and the Ember Tooth to the Choir', () => {
    const c = begin({ [L('camp_done')]: true }, 'pyrraxis_hoard');
    expect(ids(c)).not.toContain('barrage_guardian');
    const r = perform(c, 'face_guardian');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(c.state.flags).toMatchObject({ 'arc.main.pyrraxis_fate': 'raging', 'arc.main.tooth_ember_holder': 'choir' });
    expect(ids(c)).toEqual(['exit.to_highcrown']);
  });

  it('slaying Pyrraxis yields the Ember Tooth and dragon scale mail', () => {
    const c = begin({ [L('camp_done')]: true, [L('guardian_down')]: true }, 'pyrraxis_hoard');
    play(c, ['slay_pyrraxis', 'claim_hoard']);
    expect(c.state.flags).toMatchObject({ 'arc.main.pyrraxis_fate': 'slain', 'arc.main.tooth_ember_holder': 'player' });
    expect(has(c, 'dragon_scale_mail')).toBe(true);
    expect(has(c, 'flame_tongue')).toBe(true);
  });

  it('a raging Pyrraxis strafes Highcrown, and Millbrook\'s firebreak halves the fire', () => {
    const plain = begin({ 'arc.main.pyrraxis_fate': 'raging' }, 'highcrown_burning');
    const broke = begin({ 'arc.main.pyrraxis_fate': 'raging', [L('ally_millbrook')]: true }, 'highcrown_burning');
    // LuckyRng rolls maximum damage and makes every save: 4d10 = 40 → 20, and 2d10 = 20 → 10.
    expect(plain.state.hero.hp).toBe(80);
    expect(broke.state.hero.hp).toBe(90);
    expect(describeScene(plain).seed).toContain('she circles the tiers');
    play(broke, ['clear_street_1']);
    expect(broke.state.flags[L('streets_clear')]).toBe(true);
    play(plain, ['clear_street_1']);
    expect(plain.state.flags[L('streets_clear')]).toBeFalsy();
  });

  it('losing the throne hall lets the coup hold; a sick Queen dies', () => {
    const c = begin({ 'world.queen_alive': false }, 'highcrown_burning');
    play(c, ['clear_street_1', 'clear_street_2']);
    const r = perform(c, 'storm_throne');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(c.state.flags).toMatchObject({ [L('coup_lost')]: true, [L('queen_dead')]: true });
    expect(ids(c)).toEqual(['end_fallen']);
    play(c, ['end_fallen']);
    expect(getProgress(c.state)?.ending).toBe('highcrown_fallen');
  });

  it('a disloyal Corwin stays with the Dawn Lance at the muster and reappears at Highcrown', () => {
    const c = begin({ 'world.corwin_status': 'in_party', 'world.corwin_loyalty': 15 }, 'dawnspire_muster');
    expect(c.state.flags).toMatchObject({ 'world.corwin_status': 'left', [L('corwin_stayed')]: true });
    expect(npcsHere(c)).toContain('ser_corwin');
    const h = begin({ 'world.corwin_status': 'left' }, 'highcrown_burning');
    expect(npcsHere(h)).toContain('ser_corwin');
    expect(describeScene(h).seed).toContain('Ser Corwin rides with the Dawn Lance');
  });

  it('bribes and purchases use coin: barges, mercenaries and the fire tonic', () => {
    const poor = begin({}, undefined, { coins: 100 });
    expect(ids(poor)).not.toContain('hire_barges');
    const rich = begin({}, undefined, { coins: 6000 });
    play(rich, ['hire_barges']);
    expect(rich.state.hero.coins).toBe(1000);
    expect(rich.state.flags[L('refugees_led')]).toBe(true);

    const muster = begin({}, 'dawnspire_muster', { coins: 200000 });
    play(muster, ['hire_mercs_coin', 'buy_fire_tonic']);
    expect(muster.state.hero.coins).toBe(200000 - 150000 - 30000);
    expect(muster.state.flags).toMatchObject({ [L('ally_mercs')]: true, 'arc.main.war_council_allies': 1 });
    play(muster, ['end_council', 'exit.to_emberpeak', 'climb']);
    expect(ids(muster)).toContain('drink_tonic');
    expect(ids(muster)).not.toContain('cross_lava_warded');
    play(muster, ['drink_tonic']);
    expect(has(muster, 'potion_of_resistance')).toBe(false);
    expect(ids(muster)).toContain('cross_lava_warded');
    expect(ids(muster)).not.toContain('cross_lava');
  });
});

describe('ch4_wyrmfire: earlier chapters change the chapter', () => {
  it('Millbrook remembers the starter arc: faithful, wavering or converted', () => {
    const faithful = begin({ 'arc.starter.captives_saved': 3, 'arc.starter.reeve_attitude': 'friendly' }, 'millbrook_remembers');
    expect(ids(faithful)).toContain('rally_militia');
    expect(describeScene(faithful).seed).toContain('hay wagons');

    const wavering = begin({ 'arc.starter.captives_saved': 2 }, 'millbrook_remembers');
    expect(ids(wavering)).toEqual(expect.arrayContaining(['rally_village', 'defend_village']));
    expect(ids(wavering)).not.toContain('rally_militia');

    const converted = begin({ 'arc.starter.captives_saved': 1 }, 'millbrook_remembers');
    expect(ids(converted)).toEqual(expect.arrayContaining(['break_hold', 'fight_converted']));
    expect(ids(converted)).not.toContain('defend_village');
    expect(describeScene(converted).seed).toContain('seven-tooth sigils');
    play(converted, ['break_hold']);
    expect(ids(converted)).toContain('fight_converted_half');
    play(converted, ['break_hold']);
    expect(ids(converted)).toEqual(expect.arrayContaining(['fight_fanatic']));
    expect(ids(converted)).not.toContain('break_hold');
    play(converted, ['fight_fanatic']);
    expect(converted.state.flags['arc.main.millbrook_militia']).toBe(true);

    const hostileReeve = begin({ 'arc.starter.captives_saved': 4, 'arc.starter.reeve_attitude': 'hostile' }, 'millbrook_remembers');
    expect(ids(hostileReeve)).toContain('break_hold');
  });

  it('Widow Marrow, Pip and the rekindled shrine all pay off', () => {
    const c = begin({ 'arc.starter.marrow_ring_returned': true, 'arc.starter.pip_rescued': true, 'arc.starter.shrine_rekindled': true, 'arc.starter.captives_saved': 2 }, 'millbrook_remembers');
    expect(npcsHere(c)).toContain('pip_hallard');
    expect(ids(c)).toEqual(expect.arrayContaining(['marrow_gift', 'pip_message', 'light_wards_shrine']));
    expect(ids(c)).not.toContain('light_wards');
    play(c, ['marrow_gift', 'light_wards_shrine']);
    expect(c.state.hero.inventory.filter((i) => i.itemId === 'potion_of_heroism').reduce((n, i) => n + i.quantity, 0)).toBe(2);
    expect(ids(c)).toContain('defend_village_warded');
    expect(ids(c)).not.toContain('defend_village');

    const plain = begin({ 'arc.starter.captives_saved': 2 }, 'millbrook_remembers');
    expect(npcsHere(plain)).not.toContain('pip_hallard');
    expect(ids(plain)).toContain('light_wards');
    expect(ids(plain)).not.toEqual(expect.arrayContaining(['marrow_gift']));
    const hp = plain.state.hero.hp;
    perform(plain, 'defend_village'); // no wards: the thatch burns around the hero
    expect(plain.state.hero.hp).toBeLessThan(hp);
  });

  it('an outlaw gets no help from the Crown patrol or the royal guard', () => {
    const outlaw = begin({ 'world.player_outlawed': true });
    expect(ids(outlaw)).not.toContain('call_patrol');
    expect(describeScene(outlaw).seed).toContain('wanted poster');
    const muster = begin({ 'world.player_outlawed': true, 'arc.main.cantor_identity_known': true }, 'dawnspire_muster');
    expect(ids(muster)).not.toContain('pledge_crown');
    expect(ids(muster)).not.toContain('persuade_crown');

    const citizen = begin();
    expect(ids(citizen)).toContain('call_patrol');
    expect(ids(begin({}, 'dawnspire_muster'))).toContain('pledge_crown'); // the Queen lives
  });

  it('each war-council ally depends on an earlier choice, and near misses can be argued (Pip helps)', () => {
    const none = begin({ 'world.queen_alive': false }, 'dawnspire_muster');
    expect(ids(none).filter((id) => id.startsWith('pledge_') || id.startsWith('persuade_') || id.startsWith('hire_mercs'))).toEqual(['persuade_lance', 'persuade_tidewrights']); // rep 0 is one step short; Gullhaven is free by default

    const near = begin({ 'world.queen_alive': false, 'arc.main.cantor_identity_known': true, 'arc.main.money_trail_proven': true, 'arc.main.gullhaven_fate': 'free', 'arc.starter.pip_rescued': true }, 'dawnspire_muster', {
      rep: { order_of_the_dawn_lance: 5, ironvault_consortium: -10 },
    });
    expect(ids(near)).toEqual(expect.arrayContaining(['persuade_lance', 'persuade_crown', 'persuade_ironvault', 'persuade_tidewrights']));
    expect(npcsHere(near)).toEqual(expect.arrayContaining(['pip_hallard', 'brunhild_ashgrove', 'oswin_tull']));
    const r = perform(near, 'persuade_ironvault');
    expect(r.rolls[0]!.advantage).toEqual(['Pip carries your messages between the delegations']);
    expect(near.state.flags['arc.main.war_council_allies']).toBe(1);

    const hostile = begin({ 'arc.main.money_trail_proven': true }, 'dawnspire_muster', { rep: { ironvault_consortium: -30 } });
    expect(ids(hostile)).not.toContain('persuade_ironvault');

    const sw = begin({ 'arc.main.isles_alliance': 'saltwind' }, 'dawnspire_muster');
    expect(ids(sw)).toContain('pledge_saltwind');
    const pell = begin({ 'arc.main.isles_alliance': 'saltwind', 'arc.main.pell_fate': 'allied' }, 'dawnspire_muster');
    expect(ids(pell)).toContain('pledge_saltwind_pell');
    expect(ids(pell)).not.toContain('pledge_saltwind');
    const gulls = begin({ 'arc.main.isles_alliance': 'red_gull', 'world.rook_status': 'in_party' }, 'dawnspire_muster');
    expect(npcsHere(gulls)).toContain('marisol_quint');
    play(gulls, ['pledge_red_gull']);
    expect(gulls.state.flags['world.rook_loyalty']).toBe(60);
    const mb = begin({ 'arc.main.millbrook_militia': true, 'arc.main.parrot_treasure': 'player' }, 'dawnspire_muster');
    expect(ids(mb)).toEqual(expect.arrayContaining(['pledge_millbrook', 'hire_mercs']));
  });

  it('the Ironvault ballistae shell the singers\' camp and drive off the brood-guardian', () => {
    const iron = begin({ [L('ally_ironvault')]: true, [L('tubes_cleared')]: true, [L('lava_crossed')]: true, [L('climbed')]: true }, 'emberpeak_ascent');
    expect(ids(iron)).toContain('storm_camp_shelled');
    expect(ids(iron)).not.toContain('storm_camp');
    const lair = begin({ [L('ally_ironvault')]: true, [L('camp_done')]: true }, 'pyrraxis_hoard');
    play(lair, ['barrage_guardian']);
    expect(ids(lair)).toEqual(expect.arrayContaining(['slay_pyrraxis', 'free_medicine']));
  });

  it('Vosk leads the dragon-callers only if he escaped at Vaelthorn, and holds the palace stair if he escapes again', () => {
    const escaped = begin({ 'arc.main.vosk_fate': 'escaped' }, 'emberpeak_ascent');
    expect(npcsHere(escaped)).toContain('vosk');
    expect(describeScene(escaped).seed).toContain('Vosk the Hollow, leading the hymn');
    play(escaped, ['climb', 'cross_lava', 'clear_tubes', 'storm_camp']);
    expect(ids(escaped)).toEqual(expect.arrayContaining(['capture_vosk', 'kill_vosk']));

    const caught = begin({ 'arc.main.vosk_fate': 'captured' }, 'emberpeak_ascent');
    expect(npcsHere(caught)).not.toContain('vosk');
    play(caught, ['climb', 'cross_lava', 'clear_tubes', 'storm_camp']);
    expect(ids(caught)).not.toContain('capture_vosk');

    const lost = begin({ 'arc.main.vosk_fate': 'escaped' }, 'emberpeak_ascent');
    play(lost, ['climb', 'cross_lava', 'clear_tubes']);
    const r = perform(lost, 'storm_camp');
    resolveEncounter(lost, r.encounter!, 'lose');
    expect(lost.state.flags).toMatchObject({ [L('camp_lost')]: true, 'arc.main.vosk_fate': 'escaped' });
    const palace = begin({ ...lost.state.flags }, 'highcrown_burning');
    expect(npcsHere(palace)).toContain('vosk');
    play(palace, ['clear_street_1', 'clear_street_2']);
    expect(ids(palace)).toContain('storm_stair');
    expect(ids(palace)).not.toContain('storm_throne');
  });

  it('Dawnbreaker changes the dragon fight: the Lance\'s knights carry it, or the hero does', () => {
    const lance = begin({ [L('camp_done')]: true, [L('guardian_down')]: true, 'arc.main.dawnbreaker_holder': 'dawn_lance' }, 'pyrraxis_hoard');
    expect(ids(lance)).toContain('slay_pyrraxis_lance');
    expect(ids(lance)).not.toContain('slay_pyrraxis');
    expect(npcsHere(lance)).toContain('aldric_thane');

    const hero = begin({ [L('camp_done')]: true, 'arc.main.dawnbreaker_holder': 'player' }, 'pyrraxis_hoard');
    expect(describeScene(hero).seed).not.toContain('Dawnbreaker hums');
    hero.state.hero.inventory.push({ uid: 'db1', itemId: 'dragon_slayer', quantity: 1 });
    expect(describeScene(hero).seed).toContain('Dawnbreaker hums in your hands');
  });

  it('the Queen: the fen cure saves her outright, a Queen saved in chapter 3 writes to her godmother, and an outlaw is pardoned', () => {
    const cure = begin({ 'world.queen_alive': false, 'world.sickness_cure': 'briarkin_cure', [L('palace_taken')]: true }, 'highcrown_burning');
    expect(ids(cure)).toContain('tend_queen_cure');
    expect(ids(cure)).not.toContain('tend_queen');
    const sick = begin({ 'world.queen_alive': false, [L('palace_taken')]: true }, 'highcrown_burning');
    expect(availableActions(sick).find((a) => a.id === 'tend_queen')?.check).toBe('Medicine DC 20');
    expect(ids(sick)).not.toContain('ask_letter');

    const well = begin({ 'arc.main.ch3_queen_saved': true, 'arc.main.cantor_identity_known': true, 'world.player_outlawed': true, [L('palace_taken')]: true }, 'highcrown_burning');
    expect(ids(well)).not.toContain('tend_queen');
    expect(ids(well)).toEqual(expect.arrayContaining(['ask_letter', 'receive_pardon', 'end_endures']));
    play(well, ['receive_pardon']);
    expect(well.state.flags['world.player_outlawed']).toBe(false);

    const unknown = begin({ [L('palace_taken')]: true }, 'highcrown_burning');
    expect(ids(unknown)).not.toContain('ask_letter'); // Isolde does not know who the Cantor is
  });

  it('the Ember Tooth and the queen\'s sickness show in the burning capital', () => {
    const tooth = begin({ 'arc.main.tooth_ember_holder': 'player', 'world.queen_alive': false }, 'highcrown_burning');
    const seed = describeScene(tooth).seed;
    expect(seed).toContain('The Ember Tooth burns in your pack');
    expect(seed).toContain('sick and humming');
    expect(describeScene(begin({}, 'highcrown_burning')).seed).toContain('prisoner in her own throne hall');
  });
});
