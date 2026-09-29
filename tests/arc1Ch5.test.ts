/**
 * Arc chapter 5, "The Hungering Dark" (data/adventures/arc1/ch5_the_hungering_dark.json, DESIGN §10 and
 * §12): validates against the SRD and the flag registry, companions only change through approval and
 * the authored Nettle betrayal, the siege / Blightwood / Abbey / descent legs are solvable, the Maw map
 * drives the descent and the finale fights, and earlier flags (Teeth holders, Hollowmere, Sallow, Vosk,
 * the war council, the locket and Isolde's letter, the Queen, companion loyalty, starter flags) change
 * both the chapter and which of the five campaign endings can be reached.
 */
import { describe, expect, it } from 'vitest';
import ch5Json from '../data/adventures/arc1/ch5_the_hungering_dark.json';
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
  const r = validateAdventure(structuredClone(ch5Json), db, registry());
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const roster = CompanionRosterSchema.parse(companionsJson);

/** An Rng that always rolls a 1: every check and save fails. */
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

const TEETH = ['want', 'abbey', 'wick', 'parrot', 'reef', 'vaelthorn', 'ember'] as const;
const H = (t: string) => `arc.main.tooth_${t}_holder`;
/** Holder flags: the first `n` Teeth (table order) held by `holder`, the rest by `rest`. */
const teeth = (n: number, holder = 'player', rest = 'choir'): Flags => Object.fromEntries(TEETH.map((t, i) => [H(t), i < n ? holder : rest]));
const L = (name: string) => `arc.main.ch5_${name}`;

type Opts = { hour?: number; adventure?: Adventure; lucky?: boolean; unlucky?: boolean };
function ctx(flags: Flags = {}, opts: Opts = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('ch5'))), db);
  hero.classes[0]!.level = 9;
  hero.maxHp = hero.hp = 150; // room for story damage (breaches, the Maw's breath, the Jaw-Stone's bite)
  const state = newGameState(hero, 'heroic', 'ch5');
  state.time = (opts.hour ?? 10) * 60;
  Object.assign(state.flags, flags);
  const rng = opts.unlucky ? new UnluckyRng() : opts.lucky ? new LuckyRng() : Rng.fromSeed(7);
  // The roster makes approval / companionLeaves apply inside the runner step.
  return { state, adventure: opts.adventure ?? ADV, rng, db, flags: registry(), companions: roster };
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
const startingAt = (scene: string): Adventure => ({ ...ADV, start: { ...ADV.start, scene } });
const begin = (flags: Flags = {}, scene?: string, opts: Opts = {}): RunContext => {
  const c = ctx(flags, { lucky: true, ...opts, ...(scene && { adventure: startingAt(scene) }) });
  startAdventure(c);
  return c;
};
const has = (c: RunContext, item: string) => c.state.hero.inventory.some((i) => i.itemId === item);
const encounter = (id: string) => ADV.encounters.find((e) => e.id === id)!;
const counts = (id: string) => Object.fromEntries(encounter(id).monsters.map((m) => [m.id, m.count]));
const allies = (id: string) => Object.fromEntries(encounter(id).allies.map((a) => [a.id, a.count]));
const holders = (c: RunContext) => TEETH.map((t) => c.state.flags[H(t)]);
/** The finale, ready to fight: the Cantor known, the Hunger Pull and Rook settled by the caller. */
const FINALE = { 'arc.main.cantor_identity_known': true, [L('reached_jaw')]: true };

describe('ch5_the_hungering_dark: data', () => {
  it('validates with no errors or warnings', () => {
    const r = validateAdventure(structuredClone(ch5Json), db, registry());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'ch5_the_hungering_dark', arcId: 'main', kind: 'arc', levelRange: [9, 10], regionId: 'gloamfen' });
    expect(ADV.endings.map((e) => e.id).sort()).toEqual(['ending_dawn_over_orrimar', 'ending_hollow_throne', 'ending_hungering_dawn', 'ending_pale_mothers_mercy', 'ending_quiet_hunger']);
    // The last chapter: nothing chains after it, and every chapter 4 ending chains into it.
    expect(ADV.endings.every((e) => e.next === undefined)).toBe(true);
    expect((ch4Json as { endings: { next?: string }[] }).endings.every((e) => e.next === 'ch5_the_hungering_dark')).toBe(true);
  });

  it('uses the design scene ids at their lore locations', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'ch5_the_hungering_dark');
    const scenes = allScenes(ADV);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(scenes).toHaveLength(design.length);
  });

  it('writes only registered or documented flags, with valid values, and never the derived Teeth counts', () => {
    const reg = registry();
    const docs = new Map(ADV.flags.map((f) => [f.id, f]));
    const { reads, writes } = flagRefs(ADV);
    for (const w of writes) {
      expect(reg.has(w.id) || docs.has(w.id), w.id).toBe(true);
      if (w.value !== undefined) expect(reg.checkValue(w.id, w.value), w.id).toBeUndefined();
      if (!reg.has(w.id) && w.value !== undefined) expect(typeof w.value, w.id).toBe((docs.get(w.id) as { type?: string }).type ?? 'boolean');
    }
    for (const id of reads) expect(reg.has(id) || docs.has(id), id).toBe(true);
    const written = new Set(writes.map((w) => w.id));
    for (const id of [
      'arc.main.lantern_hold_held',
      'arc.main.sallow_fate',
      'arc.main.vosk_fate',
      'arc.main.abbey_bells_rung',
      'arc.main.hag_bargain',
      'arc.main.cantor_parley',
      'arc.main.cantor_fate',
      'world.maw_state',
      'world.sickness_cure',
      'world.nettle_quest_done',
      ...TEETH.map(H),
    ]) {
      expect(written.has(id), id).toBe(true);
    }
    expect(written.has('arc.main.teeth_secured')).toBe(false);
    expect(written.has('arc.main.teeth_choir')).toBe(false);
    // Earlier chapters' redemption keys are read (and documented here).
    for (const id of ['arc.main.ch3_locket', 'arc.main.ch4_isolde_letter']) {
      expect(reads.has(id), id).toBe(true);
      expect(docs.has(id), id).toBe(true);
    }
    const numbers = ADV.flags.filter((f) => (f as { type?: string }).type === 'number').map((f) => f.id);
    expect(numbers.sort()).toEqual([L('bells_dived'), L('choir_defeats'), L('pry_tries'), L('seal')]);
  });

  it('is loaded by the server adventure loader', async () => {
    const { loadAdventures, loadFlagRegistry } = await import('../src/server/adventures');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '..', 'data', 'adventures');
    const { adventures, problems } = loadAdventures(dir, db, loadFlagRegistry(dir));
    expect(problems.filter((p) => p.file.includes('ch5_the_hungering_dark') || p.file.includes('ch4_wyrmfire'))).toEqual([]);
    expect(adventures.has('ch5_the_hungering_dark')).toBe(true);
  });

  it('puts the descent, the finale and the seal on the Maw map, each fight in its own room', () => {
    expect(ADV.maps.map((m) => m.id)).toEqual(['the_maw']);
    const mapped = allScenes(ADV).filter((s) => s.map).map((s) => `${s.id}@${s.map!.id}/${s.map!.room}`);
    expect(mapped).toEqual(['maw_descent@the_maw/maw_rim', 'choir_of_teeth@the_maw/jaw_stone', 'maw_final_seal@the_maw/jaw_stone']);
    const rooms = ADV.encounters.filter((e) => e.map).map((e) => `${e.id}@${e.room}`);
    expect(rooms).toEqual(
      expect.arrayContaining(['bile_chuul@bile_pools', 'sentries@sentry_gallery', 'sentries_vosk@sentry_gallery', 'vosk_final@sanctum_gate', 'cantor@jaw_stone', 'cantor_aurek_wraith@jaw_stone']),
    );
  });
});

describe('ch5_the_hungering_dark: companions and encounters', () => {
  const all = outcomes();

  it('changes companions only through approval and the authored Nettle betrayal', () => {
    const known = new Set(roster.companions.map((d) => d.id));
    expect(all.filter((o) => o.recruit)).toEqual([]);
    for (const o of all) for (const a of o.approval) expect(known.has(a.companion), a.companion).toBe(true);
    const leaves = all.flatMap((o) => (o.companionLeaves ? [`${o.companionLeaves.id}:${o.companionLeaves.status}`] : []));
    expect(leaves).toEqual(['nettle:betrayed']);
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

  it('approval deltas follow the ±5 / ±10 / ±20 scale (+15 for a finished personal quest)', () => {
    const deltas = all.flatMap((o) => o.approval.map((a) => a.delta));
    expect(deltas.length).toBeGreaterThan(15);
    for (const d of deltas) expect([5, 10, 15, 20, -5, -10, -20], String(d)).toContain(d);
    expect(all.filter((o) => o.approval.some((a) => a.delta === 15)).every((o) => o.flags.some((f) => 'set' in f && f.set === 'world.nettle_quest_done'))).toBe(true);
  });

  it('encounters keep the design groups and declare scaling pools of their own monsters', () => {
    expect(counts('siege')).toEqual({ ghoul: 4, ghast: 2, wight: 1 });
    expect(counts('siege_converts')).toEqual({ ghoul: 6, ghast: 2, wight: 1 }); // abandoned Hollowmere adds two ghouls
    expect(counts('siege_sallow')).toEqual({ ghoul: 4, ghast: 2, wight: 1, cultist_fanatic: 1 });
    expect(counts('siege_converts_sallow_knights')).toEqual({ ghoul: 6, ghast: 2, wight: 1, cultist_fanatic: 1 });
    expect(ADV.encounters.filter((e) => e.id.startsWith('siege'))).toHaveLength(12);
    expect(ADV.encounters.some((e) => e.id.includes('converts') && e.id.includes('briarkin'))).toBe(false);
    expect(counts('heart_guard')).toEqual({ worg: 4, shambling_mound: 1 });
    expect(counts('heart_guard_hunters')).toEqual({ worg: 4, shambling_mound: 1, scout: 3 });
    expect(counts('heart_worgs')).toEqual({ worg: 4 });
    expect(counts('night_hag')).toEqual({ night_hag: 1 });
    expect(counts('drowned_bells')).toEqual({ specter: 3, wraith: 1 });
    expect(counts('bile_chuul')).toEqual({ chuul: 2 });
    expect(counts('sentries')).toEqual({ cultist_fanatic: 4, ghast: 2 });
    expect(counts('sentries_vosk')).toEqual({ cultist_fanatic: 4, ghast: 2, mage: 1 });
    expect(counts('vosk_final')).toEqual({ mage: 1 });
    expect(counts('cantor')).toEqual({ archmage: 1, gibbering_mouther: 2, cultist_fanatic: 2 });
    expect(counts('cantor_wraith')).toEqual({ archmage: 1, gibbering_mouther: 2, cultist_fanatic: 2, wraith: 1 });
    expect(counts('cantor_aurek')).toEqual({ archmage: 1, gibbering_mouther: 2, cultist_fanatic: 2, mage: 1 });
    for (const e of ADV.encounters) {
      if (e.monsters.reduce((s, m) => s + m.count, 0) < 2) continue;
      expect(e.scaling, e.id).toBeDefined();
      for (const id of e.scaling!.pool) {
        expect(db.monsters.has(id), id).toBe(true);
        expect(e.monsters.some((m) => m.id === id), `${e.id} pool ${id}`).toBe(true);
      }
    }
  });

  it('marks the Cantor, Aurek, Sallow and the siege wight as bosses and puts allies on the party side', () => {
    expect(encounter('cantor').bosses).toEqual(['archmage']);
    expect(encounter('cantor_aurek').bosses).toEqual(['archmage', 'mage']);
    expect(encounter('cantor').canFlee).toBe(false);
    expect(encounter('siege').bosses).toEqual(['wight']);
    expect(encounter('siege_sallow').bosses).toEqual(['wight', 'cultist_fanatic']);
    expect(encounter('sentries_vosk').bosses).toEqual(['mage']);
    expect(encounter('drowned_bells').bosses).toEqual(['wraith']);
    expect(allies('siege')).toEqual({});
    expect(allies('siege_briarkin')).toEqual({ scout: 2 });
    expect(allies('siege_knights')).toEqual({ knight: 2 });
    expect(allies('siege_sallow_briarkin_knights')).toEqual({ scout: 2, knight: 2 });
  });
});

describe('ch5_the_hungering_dark: the Maw map', () => {
  it('the descent reveals its rooms, and the sentry fight happens in the gallery under fog', () => {
    const c = begin({ [L('maw_map')]: true }, 'maw_descent');
    expect(dungeonProgress(c.state.extensions, 'the_maw').revealed).toEqual(['maw_rim']);
    play(c, ['follow_map']);
    const r = perform(c, 'attack_sentries');
    expect(r.encounter).toBe('sentries');
    const place = fightMap(c, encounter('sentries'))!;
    expect(place.spawns.party.length).toBeGreaterThan(0);
    // Every foe stands in the sentry gallery (x 8–15, y 8–11); the Jaw-Stone is still under fog.
    for (const p of place.spawns.foes) expect(p.x >= 8 && p.x <= 15 && p.y >= 8 && p.y <= 11, `${p.x},${p.y}`).toBe(true);
    expect(place.fog).toContain('10,15');
    resolveEncounter(c, 'sentries', 'win');
    play(c, ['reach_sanctum', 'exit.down']);
    expect(dungeonProgress(c.state.extensions, 'the_maw').revealed).toEqual(['maw_rim', 'sentry_gallery', 'jaw_stone']);
  });

  it('a failed navigation without the Wardens\' map drops the party into the bile-pools', () => {
    const c = begin({}, 'maw_descent', { lucky: false, unlucky: true });
    expect(ids(c)).not.toContain('follow_map');
    const r = perform(c, 'navigate');
    expect(r.encounter).toBe('bile_chuul');
    expect(fightMap(c, encounter('bile_chuul'))!.spawns.foes.every((p) => p.x >= 12 && p.y <= 5)).toBe(true);
    resolveEncounter(c, 'bile_chuul', 'win');
    expect(ids(c)).toEqual(expect.arrayContaining(['sneak_sentries', 'attack_sentries']));
  });
});

describe('ch5_the_hungering_dark: reachability', () => {
  /** Each leg starts at a scene; its goal is a synthetic ending that fires when the leg's milestone holds. */
  const leg = (scene: string, goal: Condition): Adventure => ({
    ...startingAt(scene),
    beats: [...ADV.beats, { id: 'leg_goal', text: 'Leg complete.', trigger: goal, scenes: [], outcome: OutcomeSchema.parse({ ending: 'leg_goal' }), required: false }],
    endings: [...ADV.endings, { id: 'leg_goal', name: 'Leg goal', text: '' }],
  });
  const solve = (adventure: Adventure, flags: Flags, ending: string, hour = 10) =>
    solveAdventure({ state: ctx(flags, { hour }).state, adventure, db, flags: registry() }, ending, { depth: 30, nodes: 60000 });

  it.each([
    ['cured, knights riding', { 'arc.main.hollowmere_fate': 'cured', 'arc.main.war_council_allies': 5 }],
    ['abandoned, Sallow leading', { 'arc.main.hollowmere_fate': 'abandoned', 'arc.main.sallow_fate': 'escaped' }],
    ['purged', { 'arc.main.hollowmere_fate': 'purged' }],
  ])('leg 1 (%s): the solver holds Lantern Hold and marches on', (_name, flags) => {
    const goal = { all: [{ flag: 'arc.main.lantern_hold_held', eq: true }, { flag: L('maw_map') }, { visited: 'blightwood_crossing' }] };
    const res = solve(leg('lantern_hold_siege', goal), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['alone by day', {}, 10],
    ['alone by night, the hag hunting', {}, 22],
    ['with the hag\'s bargain', { 'arc.main.hag_bargain': true, [H('reef')]: 'player' }, 22],
    ['owing Wick, with the curse-hunters', { 'world.briarkin_favor_owed': true, 'arc.main.wick_fate': 'burned' }, 10],
    ['guided by Nettle', { 'world.nettle_status': 'in_party' }, 10],
  ])('leg 2 (%s): the solver crosses the Blightwood to the Maw', (_name, flags, hour) => {
    const res = solve(leg('blightwood_crossing', { visited: 'maw_descent' }), flags, 'leg_goal', hour);
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['with Cendric', { 'arc.main.abbot_cendric_alive': true }],
    ['without Cendric', { 'arc.main.abbot_cendric_alive': false }],
  ])('leg 3 (%s): the solver rings the drowned bells', (_name, flags) => {
    const res = solve(leg('abbey_bells_toll', { all: [{ flag: 'arc.main.abbey_bells_rung', eq: true }, { visited: 'blightwood_crossing' }] }), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['with the map', { [L('maw_map')]: true }],
    ['without the map, Vosk waiting', { 'arc.main.vosk_fate': 'escaped' }],
  ])('leg 4 (%s): the solver descends to the Jaw-Stone', (_name, flags) => {
    const res = solve(leg('maw_descent', { visited: 'choir_of_teeth' }), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['ending_dawn_over_orrimar', { ...teeth(5), ...FINALE }],
    ['ending_dawn_over_orrimar', { ...teeth(3), ...FINALE, 'arc.main.lantern_hold_held': true, 'arc.main.abbey_bells_rung': true, 'world.rook_status': 'betrayed' }],
    ['ending_pale_mothers_mercy', { ...teeth(3), ...FINALE, 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 80 }],
    ['ending_pale_mothers_mercy', { ...teeth(3), ...FINALE, 'arc.main.ch4_isolde_letter': true }],
    ['ending_pale_mothers_mercy', { ...teeth(3), ...FINALE, 'arc.main.ch3_locket': true, 'world.queen_alive': false }],
    ['ending_hollow_throne', { ...teeth(5), ...FINALE, 'world.queen_alive': false }],
    ['ending_quiet_hunger', { ...teeth(2), ...FINALE }],
    ['ending_hungering_dawn', { ...teeth(0), ...FINALE }],
    ['ending_hungering_dawn', { ...teeth(0), ...FINALE, 'world.aurek_status': 'betrayed' }],
  ])('leg 5: at the Jaw-Stone, the solver reaches %s', (ending, flags) => {
    const res = solve(startingAt('choir_of_teeth'), flags, ending);
    expect(res.ok, res.reason).toBe(true);
  });

  it('earlier flags decide which endings are possible', () => {
    const can = (flags: Flags, ending: string) => solve(startingAt('choir_of_teeth'), flags, ending).ok;
    // Redemption needs the Cantor's identity and a key (Aurek's loyalty, the locket or Isolde's letter).
    expect(can({ ...teeth(5), [L('reached_jaw')]: true, 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 80 }, 'ending_pale_mothers_mercy')).toBe(false);
    expect(can({ ...teeth(5), ...FINALE }, 'ending_pale_mothers_mercy')).toBe(false);
    expect(can({ ...teeth(5), ...FINALE, 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 60 }, 'ending_pale_mothers_mercy')).toBe(false);
    expect(can({ ...teeth(5), ...FINALE, 'world.queen_alive': false, 'arc.main.ch4_isolde_letter': true }, 'ending_pale_mothers_mercy')).toBe(false);
    // The Queen's fate decides between the triumph and the regency.
    expect(can({ ...teeth(5), ...FINALE, 'world.queen_alive': false }, 'ending_dawn_over_orrimar')).toBe(false);
    expect(can({ ...teeth(5), ...FINALE }, 'ending_hollow_throne')).toBe(false);
    // Two secured Teeth cannot seal the Maw… unless the rest of the campaign adds strength (two pries help too).
    expect(can({ ...teeth(1, 'player', 'unclaimed'), ...FINALE }, 'ending_dawn_over_orrimar')).toBe(false);
    expect(can({ ...teeth(1, 'player', 'unclaimed'), ...FINALE }, 'ending_quiet_hunger')).toBe(true);
    const campaign = { 'arc.main.abbey_bells_rung': true, 'arc.main.dawnbreaker_holder': 'dawn_lance', 'arc.main.wick_fate': 'ally', 'arc.main.lantern_hold_held': true };
    expect(can({ ...teeth(1, 'player', 'unclaimed'), ...FINALE, ...campaign }, 'ending_dawn_over_orrimar')).toBe(true);
    // Unclaimed Teeth are neither sealed nor in the Choir's jaw: the Maw can only open with all seven.
    expect(can({ ...teeth(0, 'player', 'unclaimed'), ...FINALE }, 'ending_hungering_dawn')).toBe(false);
    expect(can({ ...teeth(5, 'wardens'), ...FINALE }, 'ending_hungering_dawn')).toBe(false);
  });

  it('a scripted playthrough (cured fen, war council, bells, Nettle\'s name, Vosk taken) seals the Maw at dawn', () => {
    const c = ctx(
      {
        'arc.main.hollowmere_fate': 'cured',
        'world.sickness_cure': 'briarkin_cure',
        'arc.main.sallow_fate': 'escaped',
        'arc.main.war_council_allies': 5,
        [H('want')]: 'wardens',
        [H('abbey')]: 'player',
        [H('wick')]: 'briarkin',
        [H('parrot')]: 'red_gull',
        [H('reef')]: 'player',
        [H('vaelthorn')]: 'player',
        [H('ember')]: 'player',
        'arc.main.wick_fate': 'ally',
        'arc.main.abbot_cendric_alive': true,
        'arc.main.vosk_fate': 'escaped',
        'arc.main.dawnbreaker_holder': 'dawn_lance',
        'arc.main.cantor_identity_known': true,
        'arc.starter.shrine_rekindled': true,
        'arc.starter.dream_heard': true,
        'arc.starter.pip_rescued': true,
        'world.corwin_status': 'in_party',
        'world.corwin_loyalty': 60,
        'world.nettle_status': 'in_party',
        'world.nettle_loyalty': 65,
      },
      { lucky: true },
    );
    startAdventure(c);
    play(c, ['carry_oil', 'rally_wardens', 'hold_walls']);
    expect(c.state.flags[L('siege_done')]).toBe(true);
    expect(getProgress(c.state)!.beats).toContain('siege_siege_sallow_briarkin_knights');
    expect(c.state.flags[H('want')]).toBe('player'); // the Wardens hand over the Tooth of Want
    play(c, ['capture_sallow', 'rest_hold', 'exit.to_abbey', 'keep_vigil', 'cendric_rite', 'dive_bell', 'dive_bell', 'dive_bell', 'ring_bells', 'exit.to_blightwood', 'follow_guide', 'whispering_grove']);
    if (ids(c).includes('fight_hag')) play(c, ['fight_hag']); // arriving after dark, the hag's sister hunts the party
    play(c, ['fight_heart', 'heal_heart_tree', 'exit.to_maw']);
    expect(c.state.flags[L('nettle_confessed')]).toBe(true); // loyalty 65 + 5 (bells) + 15 (her name) ≥ 70
    play(c, ['follow_map', 'sneak_sentries', 'face_vosk', 'capture_vosk', 'reach_sanctum', 'exit.down']);
    const brace = availableActions(c).find((a) => a.id === 'brace_mind');
    expect(brace?.check).toBe('Wis save DC 17');
    const r = perform(c, 'brace_mind');
    expect(r.rolls[0]!.advantage).toEqual(['The drowned bells still ring in the Maw', 'You have known this voice since the barrow at Millbrook', 'Nettle taught you what her whisper sounds like']);
    play(c, ['face_cantor', 'brace_body_2', 'capture_cantor', 'exit.to_seal']);
    expect(c.state.flags[L('seal')]).toBe(7 + 1 + 1 + 1 + 1); // seven Teeth, the bells, Dawnbreaker, Wick's chant, the Wardens
    play(c, ['close_seal', 'end_dawn_over_orrimar']);
    const f = c.state.flags;
    expect(getProgress(c.state)?.ending).toBe('ending_dawn_over_orrimar');
    expect(f['arc.main.cantor_parley']).toBeUndefined(); // reads as "not_offered"
    expect(getProgress(c.state)!.beats.filter((b) => b.startsWith('siege_'))).toEqual(['siege_siege_sallow_briarkin_knights']); // capturing Sallow does not restart the siege
    expect(f).toMatchObject({
      'world.maw_state': 'sealed',
      'arc.main.cantor_fate': 'captured',
      'arc.main.sallow_fate': 'captured',
      'arc.main.vosk_fate': 'captured',
      'arc.main.lantern_hold_held': true,
      'arc.main.abbey_bells_rung': true,
      'world.nettle_quest_done': true,
      'world.sickness_cure': 'briarkin_cure', // already cured: the seal does not overwrite it
      'world.corwin_loyalty': 60 + 5 + 5 + 5 + 10, // the siege, Sallow taken, the bells, the Cantor taken
      'world.nettle_loyalty': 65 + 5 + 15,
    });
    expect(holders(c)).toEqual(['player', 'player', 'briarkin', 'red_gull', 'player', 'player', 'player']);
    expect(has(c, 'potion_of_healing_greater')).toBe(true);
    expect(has(c, 'potion_of_healing_superior')).toBe(true);
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(16000);
    const facts = getProgress(c.state)!.beats;
    expect(facts).toEqual(expect.arrayContaining(['epilogue_crown_reform', 'epilogue_lance_reborn', 'epilogue_pip_knighted', 'epilogue_wardens_healers', 'epilogue_briarkin_charter', 'epilogue_trial', 'epilogue_nettle_name']));
    expect(facts).not.toContain('epilogue_funeral');
  });
});

describe('ch5_the_hungering_dark: the Choir of Teeth', () => {
  it('a failed Hunger Pull tears the lowest-numbered carried Tooth into the Jaw-Stone and leaves a bite scar', () => {
    const c = begin({ ...FINALE, [H('want')]: 'wardens', [H('abbey')]: 'player', [H('reef')]: 'player' }, 'choir_of_teeth', { lucky: false, unlucky: true });
    expect(ids(c)).toEqual(expect.arrayContaining(['brace_body', 'brace_mind']));
    expect(ids(c).some((id) => id.startsWith('face_'))).toBe(false); // brace first
    const scars = c.state.hero.scars.length;
    perform(c, 'brace_body');
    expect(c.state.flags).toMatchObject({ [H('want')]: 'wardens', [H('abbey')]: 'choir', [H('reef')]: 'player' });
    expect(c.state.hero.scars.length).toBe(scars + 1);
    expect(ids(c)).toContain('face_cantor');
    // Nobody carrying a Tooth: no pull at all.
    expect(ids(begin({ ...FINALE, ...teeth(3, 'wardens') }, 'choir_of_teeth'))).toContain('face_cantor');
  });

  it('the wraith joins once five Teeth are in the jaw, and a betrayed Aurek stands with his aunt', () => {
    const five = begin({ ...FINALE, ...teeth(2, 'wardens') }, 'choir_of_teeth');
    expect(ids(five)).toContain('face_cantor_wraith');
    expect(describeScene(five).seed).toContain('something cold and hungry');
    const four = begin({ ...FINALE, ...teeth(3, 'wardens') }, 'choir_of_teeth');
    expect(ids(four)).toContain('face_cantor');
    const aurek = begin({ ...FINALE, ...teeth(3, 'wardens'), 'world.aurek_status': 'betrayed' }, 'choir_of_teeth');
    expect(ids(aurek)).toContain('face_cantor_aurek');
    expect(npcsHere(aurek)).toEqual(expect.arrayContaining(['seraphine_vell', 'aurek']));
  });

  it('at bay: two pry attempts at most, then parley, kill or capture', () => {
    const c = begin({ ...FINALE, ...teeth(3, 'wardens'), [L('at_bay')]: true }, 'choir_of_teeth', { lucky: false, unlucky: true });
    expect(ids(c)).toEqual(expect.arrayContaining(['pry_parrot', 'pry_reef', 'pry_vaelthorn', 'pry_ember', 'kill_cantor', 'capture_cantor']));
    expect(ids(c)).not.toContain('pry_want');
    expect(availableActions(c).find((a) => a.id === 'pry_ember')?.check).toBe('Athletics DC 18');
    const hp = c.state.hero.hp;
    perform(c, 'pry_ember');
    expect(c.state.hero.hp).toBeLessThan(hp); // the Jaw-Stone bites
    c.rng = new LuckyRng();
    perform(c, 'pry_reef');
    expect(c.state.flags[H('reef')]).toBe('player');
    expect(ids(c).some((id) => id.startsWith('pry_'))).toBe(false);
    // Taking a Tooth back means the Maw pulls again before the end.
    expect(ids(c)).toEqual(expect.arrayContaining(['brace_body_2', 'brace_mind_2']));
    expect(ids(c)).not.toContain('kill_cantor');
  });

  it('the parley keys: Aurek at loyalty 70+, Liesel\'s locket (Persuasion DC 20), Isolde\'s letter while she lives', () => {
    const base = { ...FINALE, ...teeth(3, 'wardens'), [L('at_bay')]: true };
    const parleys = (flags: Flags) => ids(begin({ ...base, ...flags }, 'choir_of_teeth')).filter((id) => id.startsWith('parley_') || id === 'refuse_parley');
    expect(parleys({})).toEqual([]);
    expect(parleys({ 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 69 })).toEqual([]);
    expect(parleys({ 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 70 })).toEqual(['parley_aurek', 'refuse_parley']);
    expect(parleys({ 'arc.main.ch3_locket': true })).toEqual(['parley_locket', 'refuse_parley']);
    expect(parleys({ 'arc.main.ch4_isolde_letter': true })).toEqual(['parley_letter', 'refuse_parley']);
    expect(parleys({ 'arc.main.ch4_isolde_letter': true, 'world.queen_alive': false })).toEqual([]);
    expect(parleys({ 'arc.main.ch3_locket': true, 'arc.main.cantor_identity_known': false })).toEqual([]);

    const locket = begin({ ...base, 'arc.main.ch3_locket': true, 'world.aurek_quest_done': true }, 'choir_of_teeth', { lucky: false, unlucky: true });
    const r = perform(locket, 'parley_locket');
    expect(r.rolls[0]!.advantage).toEqual(['Aurek told you Liesel’s whole story']);
    expect(locket.state.flags['arc.main.cantor_parley']).toBe('refused');
    expect(ids(locket)).toEqual(expect.arrayContaining(['kill_cantor', 'capture_cantor']));

    const aurek = begin({ ...base, 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 70 }, 'choir_of_teeth');
    play(aurek, ['parley_aurek']);
    expect(aurek.state.flags).toMatchObject({ 'arc.main.cantor_parley': 'accepted', 'arc.main.cantor_fate': 'redeemed', 'world.aurek_loyalty': 90 });
    expect(ids(aurek)).toEqual(['exit.to_seal']);
  });

  it('a betrayed Rook: talked round he pries a Tooth back, otherwise he steals one', () => {
    const base = { ...FINALE, [H('want')]: 'player', [H('abbey')]: 'player', [H('wick')]: 'choir', [H('parrot')]: 'choir', 'world.rook_status': 'betrayed' };
    const won = begin(base, 'choir_of_teeth');
    expect(npcsHere(won)).toContain('rook');
    expect(ids(won).some((id) => id.startsWith('face_'))).toBe(false);
    play(won, ['persuade_rook']);
    expect(won.state.flags).toMatchObject({ [H('wick')]: 'player', [H('parrot')]: 'choir', [H('want')]: 'player' });
    expect(won.state.flags['world.rook_status']).toBe('betrayed'); // he helps, but cannot rejoin

    const lost = begin(base, 'choir_of_teeth', { lucky: false, unlucky: true });
    perform(lost, 'persuade_rook');
    expect(lost.state.flags).toMatchObject({ [H('want')]: 'choir', [H('abbey')]: 'player', [H('wick')]: 'choir' });
  });

  it('the Maw\'s spit: one retry, then the Cantor escapes and the Maw only stirs, however strong the seal', () => {
    const c = begin({ ...FINALE, ...teeth(6, 'wardens', 'player'), 'arc.main.lantern_hold_held': true }, 'choir_of_teeth');
    play(c, ['brace_body']);
    let r = perform(c, 'face_cantor');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(getProgress(c.state)!.sceneId).toBe('maw_descent');
    expect(c.state.flags[H('ember')]).toBe('choir'); // the Maw kept the only carried Tooth
    expect(c.state.hero.scars.some((s) => s.description.includes('Maw’s kiss'))).toBe(true);
    play(c, ['exit.down']);
    r = perform(c, 'face_cantor');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(c.state.flags).toMatchObject({ 'arc.main.cantor_fate': 'escaped', [L('choir_resolved')]: true });
    play(c, ['exit.down']);
    expect(ids(c)).toEqual(['exit.to_seal']);
    play(c, ['exit.to_seal']);
    expect(c.state.flags[L('seal')]).toBe(7); // six Teeth and the Wardens on the rim
    expect(ids(c)).toEqual(['seal_falters']);
    play(c, ['seal_falters', 'end_quiet_hunger']);
    expect(c.state.flags).toMatchObject({ 'world.maw_state': 'stirring', 'arc.main.cantor_fate': 'escaped' });
    expect(getProgress(c.state)!.beats).toContain('epilogue_choir_waits');
  });

  it('a redeemed Cantor seals the jaw with her own voice, and lives when the seal is strong enough', () => {
    const strong = begin({ ...teeth(5), 'arc.main.cantor_fate': 'redeemed', 'arc.main.cantor_parley': 'accepted' }, 'maw_final_seal');
    expect(strong.state.flags[L('seal')]).toBe(7);
    play(strong, ['close_seal']);
    expect(getProgress(strong.state)!.beats).toContain('seraphine_lives');
    expect(strong.state.flags['world.sickness_cure']).toBe('maw_sealed'); // the spores die with the Maw
    expect(ids(strong)).toEqual(['end_pale_mothers_mercy']);

    const weak = begin({ ...teeth(3), 'arc.main.cantor_fate': 'redeemed' }, 'maw_final_seal');
    play(weak, ['close_seal']);
    expect(getProgress(weak.state)!.beats).toContain('seraphine_dies');

    const faint = begin({ ...teeth(2), 'arc.main.cantor_fate': 'redeemed' }, 'maw_final_seal');
    expect(faint.state.flags[L('seal')]).toBe(4);
    play(faint, ['seal_falters']);
    expect(faint.state.flags['arc.main.cantor_fate']).toBe('escaped');
  });

  it('seven Teeth in the jaw open the Maw', () => {
    const c = begin({ ...teeth(0), 'arc.main.cantor_fate': 'killed' }, 'maw_final_seal');
    expect(describeScene(c).seed).toContain('already opening');
    expect(ids(c)).toEqual(['maw_opens']);
    play(c, ['maw_opens', 'end_hungering_dawn']);
    expect(c.state.flags['world.maw_state']).toBe('opened');
    expect(getProgress(c.state)!.beats).toContain('breach_held');
    expect(getProgress(c.state)!.beats.some((b) => b.startsWith('epilogue_'))).toBe(false);
    // The last carried Tooth lost to the Hunger Pull fills the jaw.
    const pulled = begin({ ...FINALE, ...teeth(1) }, 'choir_of_teeth', { lucky: false, unlucky: true });
    perform(pulled, 'brace_mind');
    expect(holders(pulled).every((h) => h === 'choir')).toBe(true);
    expect(describeScene(pulled).seed).toContain('The Jaw is opening');
  });
});

describe('ch5_the_hungering_dark: earlier chapters change the chapter', () => {
  const siegeFight = (flags: Flags) => {
    const c = begin(flags);
    const r = perform(c, 'hold_walls');
    return r.encounter;
  };

  it('Hollowmere, Sallow and the war council decide who fights at Lantern Hold', () => {
    expect(siegeFight({})).toBe('siege');
    expect(siegeFight({ 'arc.main.hollowmere_fate': 'cured' })).toBe('siege_briarkin');
    expect(siegeFight({ 'arc.main.hollowmere_fate': 'abandoned', 'arc.main.sallow_fate': 'escaped' })).toBe('siege_converts_sallow');
    expect(siegeFight({ 'arc.main.war_council_allies': 4 })).toBe('siege_knights');
    expect(siegeFight({ 'arc.main.war_council_allies': 3, 'arc.main.sallow_fate': 'captured' })).toBe('siege');
    const cured = begin({ 'arc.main.hollowmere_fate': 'cured', 'arc.main.wick_fate': 'ally' });
    expect(describeScene(cured).seed).toContain('Briarkin archers and cured Hollowmere folk');
    expect(npcsHere(cured)).toContain('grandmother_wick');
    const sallow = begin({ 'arc.main.sallow_fate': 'escaped' });
    expect(npcsHere(sallow)).toContain('mother_sallow');
    expect(npcsHere(begin())).not.toContain('mother_sallow');
  });

  it('oil and a rallied garrison spare the party the breaches; the Tooth of Want earns the Wardens\' trust', () => {
    const bare = begin();
    const hp = bare.state.hero.hp;
    perform(bare, 'hold_walls');
    expect(bare.state.hero.hp).toBeLessThan(hp);
    const ready = begin();
    play(ready, ['carry_oil', 'rally_wardens']);
    const hp2 = ready.state.hero.hp;
    perform(ready, 'hold_walls');
    expect(ready.state.hero.hp).toBe(hp2);
    const trusted = begin({ [H('want')]: 'wardens' });
    expect(perform(trusted, 'rally_wardens').rolls[0]!.advantage).toEqual(['The Wardens trust the one who gave them the Tooth of Want']);
  });

  it('losing the siege loses the Hold, the map and a point of seal strength', () => {
    const c = begin();
    const r = perform(c, 'hold_walls');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(c.state.flags).toMatchObject({ 'arc.main.lantern_hold_held': false, [L('hold_fallen')]: true });
    expect(c.state.flags[L('maw_map')]).toBeUndefined();
    expect(ids(c)).not.toContain('rest_hold');
    expect(ids(c)).toEqual(expect.arrayContaining(['exit.to_blightwood', 'exit.to_abbey']));
    const seal = begin({ ...teeth(5, 'wardens'), 'arc.main.lantern_hold_held': false, 'arc.main.cantor_fate': 'killed' }, 'maw_final_seal');
    expect(seal.state.flags[L('seal')]).toBe(5);
    play(seal, ['close_seal']);
    expect(getProgress(seal.state)!.beats).toContain('epilogue_wardens_scattered');
  });

  it('the Blightwood remembers Wick, the Briarkin favor, the shrine and the sea hag', () => {
    const favor = begin({ 'world.briarkin_favor_owed': true, 'arc.main.wick_fate': 'burned', [L('wood_path')]: true, [L('whispers_done')]: true }, 'blightwood_crossing');
    expect(ids(favor)).toContain('spare_mound_hunters');
    expect(ids(favor)).not.toContain('fight_heart');
    expect(describeScene(favor).seed).toContain('curse-marks');
    const r = perform(favor, 'spare_mound_hunters');
    expect(r.encounter).toBe('heart_worgs_hunters');

    const guide = begin({ 'arc.main.wick_fate': 'ally' }, 'blightwood_crossing');
    expect(ids(guide)).toContain('follow_guide');
    expect(ids(begin({}, 'blightwood_crossing'))).not.toContain('follow_guide');
    expect(ids(begin({}, 'blightwood_crossing'))).toContain('navigate_day');
    expect(ids(begin({}, 'blightwood_crossing', { hour: 22 }))).toContain('navigate_night');

    const shrine = begin({ 'arc.starter.shrine_rekindled': true, [L('wood_path')]: true }, 'blightwood_crossing');
    expect(perform(shrine, 'whispering_grove').rolls[0]!.advantage).toEqual(['Thaloren’s blessing from the Millbrook shrine']);

    const hag = begin({ 'arc.main.hag_bargain': true, [H('reef')]: 'player', [H('ember')]: 'player', [L('heart_reached')]: true }, 'blightwood_crossing', { hour: 23 });
    expect(npcsHere(hag)).toContain('hag_sister');
    expect(ids(hag)).toEqual(expect.arrayContaining(['hag_trade_reef', 'hag_trade_ember', 'fight_hag']));
    expect(ids(hag)).not.toContain('exit.to_maw');
    play(hag, ['hag_trade_reef']);
    expect(hag.state.flags).toMatchObject({ [H('reef')]: 'choir', [H('ember')]: 'player', 'arc.main.hag_bargain': false, [L('memory_restored')]: true });
    expect(ids(hag)).toContain('exit.to_maw');
    const plain = begin({ [L('heart_reached')]: true }, 'blightwood_crossing', { hour: 23 });
    expect(ids(plain).filter((id) => id.startsWith('hag_trade_'))).toEqual([]);
    expect(ids(plain)).toContain('fight_hag');
  });

  it('Nettle\'s quest needs her loyalty; a disloyal Nettle betrays the party at the Maw\'s rim', () => {
    const low = begin({ 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 55, [L('heart_reached')]: true }, 'blightwood_crossing');
    expect(ids(low)).not.toContain('heal_heart_tree');
    const high = begin({ 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 60, [L('heart_reached')]: true }, 'blightwood_crossing');
    play(high, ['heal_heart_tree']);
    expect(high.state.flags).toMatchObject({ 'world.nettle_quest_done': true, 'world.nettle_loyalty': 75 });

    const traitor = begin({ 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 20, [H('want')]: 'wardens', [H('wick')]: 'player', [H('reef')]: 'player' }, 'maw_descent');
    expect(traitor.state.flags).toMatchObject({ 'world.nettle_status': 'betrayed', [H('wick')]: 'choir', [H('reef')]: 'player', [H('want')]: 'wardens' });
    expect(describeScene(traitor).seed).toContain('Nettle is gone');
    const loyal = begin({ 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 70 }, 'maw_descent');
    expect(loyal.state.flags[L('nettle_confessed')]).toBe(true);
    expect(loyal.state.flags['world.nettle_status']).toBe('in_party');
  });

  it('Nettle can sing the Name-Chant for a burned Wick; the Abbey remembers Cendric and the Drowned Tooth', () => {
    const chant = begin({ ...teeth(3, 'player', 'unclaimed'), 'arc.main.wick_fate': 'burned', 'world.nettle_quest_done': true, 'world.nettle_status': 'in_party' }, 'maw_final_seal');
    expect(getProgress(chant.state)!.beats).toContain('seal_nettle_chant');
    expect(chant.state.flags[L('seal')]).toBe(4);

    const cendric = begin({ [L('midnight')]: true }, 'abbey_bells_toll');
    expect(npcsHere(cendric)).toContain('abbot_cendric');
    expect(ids(cendric)).toContain('cendric_rite');
    const alone = begin({ [L('midnight')]: true, 'arc.main.abbot_cendric_alive': false, [H('abbey')]: 'player' }, 'abbey_bells_toll');
    expect(npcsHere(alone)).not.toContain('abbot_cendric');
    expect(perform(alone, 'lead_rite').rolls[0]!.advantage).toEqual(['The Drowned Tooth makes the bells resonate']);
  });

  it('Vosk makes his final stand only if he escaped before', () => {
    const escaped = begin({ 'arc.main.vosk_fate': 'escaped', [L('maw_map')]: true }, 'maw_descent');
    expect(npcsHere(escaped)).toContain('vosk');
    play(escaped, ['follow_map', 'sneak_sentries']);
    expect(ids(escaped)).toEqual(['face_vosk']);
    play(escaped, ['face_vosk', 'kill_vosk']);
    expect(escaped.state.flags['arc.main.vosk_fate']).toBe('killed');
    expect(ids(escaped)).toContain('reach_sanctum');
    const caught = begin({ 'arc.main.vosk_fate': 'captured', [L('maw_map')]: true }, 'maw_descent');
    expect(npcsHere(caught)).not.toContain('vosk');
    play(caught, ['follow_map', 'sneak_sentries']);
    expect(ids(caught)).toEqual(['reach_sanctum']);
  });

  it('dawdling past four days makes the Hunger Pull harder', () => {
    const c = begin({}, 'lantern_hold_siege');
    c.state.time += 5760;
    perform(c, 'carry_oil');
    expect(c.state.flags[L('song_late')]).toBe(true);
    const late = begin({ ...FINALE, [L('song_late')]: true, [H('want')]: 'player' }, 'choir_of_teeth');
    expect(perform(late, 'brace_body').rolls[0]!.disadvantage).toEqual(['The Choir’s song is nearly finished']);
  });

  it('the Cantor knows the hero: identity, the Millbrook dream and a present Aurek change the finale', () => {
    const known = describeScene(begin({ ...FINALE, 'arc.starter.dream_heard': true, 'world.aurek_status': 'in_party' }, 'choir_of_teeth')).seed;
    expect(known).toContain('Lady Seraphine Vell');
    expect(known).toContain('the voice from the barrow at Millbrook');
    expect(known).toContain('“Oh, my dear,” she says. “Not you.”');
    const unknown = describeScene(begin({ [L('reached_jaw')]: true }, 'choir_of_teeth')).seed;
    expect(unknown).toContain('you still do not know who I am');
  });

  it('the epilogue reads the whole campaign', () => {
    const c = begin(
      {
        ...teeth(5),
        'arc.main.cantor_fate': 'killed',
        'world.queen_alive': false,
        'arc.main.dawnbreaker_holder': 'lost',
        'arc.main.hollowmere_fate': 'purged',
        'arc.main.pell_fate': 'allied',
        'arc.main.gullhaven_fate': 'burned',
        'arc.main.isles_alliance': 'red_gull',
        'arc.starter.captives_saved': 4,
        'arc.starter.ashby_fate': 'escaped',
        'world.times_defeated': 6,
        'world.rook_status': 'betrayed',
      },
      'maw_final_seal',
    );
    play(c, ['close_seal']);
    expect(ids(c)).toEqual(['end_hollow_throne']);
    const beats = getProgress(c.state)!.beats;
    expect(beats).toEqual(
      expect.arrayContaining([
        'epilogue_regency_hale',
        'epilogue_lance_dwindles',
        'epilogue_wardens_feted',
        'epilogue_saltwind_pell',
        'epilogue_tull_rebuilds',
        'epilogue_red_gull_pardon',
        'epilogue_millbrook_statue',
        'epilogue_lieutenants',
        'epilogue_unkillable',
        'epilogue_rook_turncoat',
        'epilogue_choir_collapses',
      ]),
    );
    expect(beats).not.toContain('epilogue_crown_reform');
    play(c, ['end_hollow_throne']);
    expect(getProgress(c.state)?.ending).toBe('ending_hollow_throne');
  });
});
