/**
 * Arc chapter 2, "Salt and Treason" (data/adventures/arc1/ch2_salt_and_treason.json, DESIGN §7):
 * validates against the SRD and the flag registry, companions only change through recruit /
 * approval / companionLeaves, the race for the two Teeth is winnable, and chapter-1 flags visibly
 * change the chapter.
 */
import { describe, expect, it } from 'vitest';
import ch2Json from '../data/adventures/arc1/ch2_salt_and_treason.json';
import flagsJson from '../data/adventures/flags.json';
import companionsJson from '../data/companions.json';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { availableActions, describeScene, getProgress, npcsHere, perform as runnerPerform, resolveEncounter as runnerResolve, startAdventure, type RunContext, type StepResult } from '../src/engine/adventure/runner';
import { OutcomeSchema, type Adventure, type Condition, type Outcome } from '../src/engine/adventure/schema';
import { changeApproval, CompanionRosterSchema, partWithCompanion, recruitCompanion } from '../src/engine/party/companions';
import { LuckyRng, solveAdventure } from '../src/engine/adventure/solver';
import { allScenes, flagRefs, validateAdventure } from '../src/engine/adventure/validate';
import { newGameState } from '../src/engine/session/GameSession';
import { FlagRegistry, type Flags } from '../src/engine/world/flags';

const db = loadSrd();
const registry = () => FlagRegistry.fromJson(flagsJson);
const chapter = (): Adventure => {
  const r = validateAdventure(structuredClone(ch2Json), db, registry());
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const roster = CompanionRosterSchema.parse(companionsJson);

/** Applies a step's companion effects the way the session port does (recruits, approvals, partings). */
function applyParty(c: RunContext, r: StepResult): StepResult {
  const def = (id: string) => roster.companions.find((d) => d.id === id)!;
  for (const id of r.recruits ?? []) recruitCompanion(c.state, def(id), db);
  for (const a of r.approvals ?? []) changeApproval(c.state, def(a.companion), a.delta);
  for (const p of r.partings ?? []) partWithCompanion(c.state, def(p.id), p.status);
  return r;
}
const perform = (c: RunContext, id: string): StepResult => applyParty(c, runnerPerform(c, id));
const resolveEncounter = (c: RunContext, id: string, how: 'win' | 'lose' | 'flee'): StepResult => applyParty(c, runnerResolve(c, id, how));

/** Every outcome in the chapter. */
function outcomes(x: unknown = ADV, out: Outcome[] = []): Outcome[] {
  if (Array.isArray(x)) for (const v of x) outcomes(v, out);
  else if (x && typeof x === 'object') {
    if (Array.isArray((x as Outcome).approval) && Array.isArray((x as Outcome).flags)) out.push(x as Outcome);
    for (const v of Object.values(x)) outcomes(v, out);
  }
  return out;
}

function ctx(flags: Flags = {}, opts: { hour?: number; adventure?: Adventure; lucky?: boolean } = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('ch2'))), db);
  hero.classes[0]!.level = 3;
  const state = newGameState(hero, 'heroic', 'ch2');
  if (opts.hour !== undefined) state.time = opts.hour * 60;
  Object.assign(state.flags, flags);
  return { state, adventure: opts.adventure ?? ADV, rng: opts.lucky ? new LuckyRng() : Rng.fromSeed(7), db, flags: registry() };
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
/** Performs a scripted path, winning every fight. */
function play(c: RunContext, path: string[]): void {
  for (const id of path) {
    let r = perform(c, id);
    for (let g = 0; r.encounter && g < 5; g++) r = resolveEncounter(c, r.encounter, 'win');
  }
}
/** Same chapter, starting at another scene (keeps solver searches small). */
const startingAt = (scene: string): Adventure => ({ ...ADV, start: { ...ADV.start, scene } });

describe('ch2_salt_and_treason: data', () => {
  it('validates with no errors or warnings', () => {
    const r = validateAdventure(structuredClone(ch2Json), db, registry());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'ch2_salt_and_treason', arcId: 'main', kind: 'arc', levelRange: [3, 5], regionId: 'brinescatter_isles' });
    expect(ADV.endings.length).toBeGreaterThanOrEqual(2);
  });

  it('uses the design scene ids at their lore locations', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'ch2_salt_and_treason');
    const scenes = allScenes(ADV);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(scenes).toHaveLength(design.length);
  });

  it('writes only registered or documented flags, with valid values', () => {
    const reg = registry();
    const docs = new Set(ADV.flags.map((f) => f.id));
    const { reads, writes } = flagRefs(ADV);
    for (const w of writes) {
      expect(reg.has(w.id) || docs.has(w.id), w.id).toBe(true);
      if (w.value !== undefined) expect(reg.checkValue(w.id, w.value), w.id).toBeUndefined();
      if (!reg.has(w.id) && w.value !== undefined) expect(typeof w.value, w.id).toBe('boolean');
    }
    for (const id of reads) expect(reg.has(id) || docs.has(id), id).toBe(true);
    const written = new Set(writes.map((w) => w.id));
    for (const id of ['arc.main.almoner_seal_seen', 'arc.main.choir_ledger_found', 'arc.main.isles_alliance', 'arc.main.gullhaven_fate', 'arc.main.pell_fate', 'arc.main.harrow_vey_fate', 'arc.main.hag_bargain', 'arc.main.parrot_treasure', 'arc.main.tooth_parrot_holder', 'arc.main.tooth_reef_holder', 'world.player_outlawed', 'world.red_gull_debt']) {
      expect(written.has(id), id).toBe(true);
    }
    expect(written.has('arc.main.teeth_secured')).toBe(false);
    expect(written.has('arc.main.teeth_choir')).toBe(false);
  });

  it('is loaded by the server adventure loader', async () => {
    const { loadAdventures, loadFlagRegistry } = await import('../src/server/adventures');
    const path = await import('node:path');
    const dir = path.resolve(__dirname, '..', 'data', 'adventures');
    const { adventures, problems } = loadAdventures(dir, db, loadFlagRegistry(dir));
    expect(problems.filter((p) => p.file.includes('ch2_salt_and_treason'))).toEqual([]);
    expect(adventures.has('ch2_salt_and_treason')).toBe(true);
  });
});

describe('ch2_salt_and_treason: companions and encounters', () => {
  const all = outcomes();

  it('Rook joins only through recruit, and every companion reference is on the roster', () => {
    const known = new Set(roster.companions.map((d) => d.id));
    const recruits = all.filter((o) => o.recruit);
    expect(recruits.length).toBeGreaterThanOrEqual(5); // bribe, lie, forgery, lock, gallows, jail break...
    for (const o of recruits) expect(o.recruit).toBe('rook');
    for (const o of all) {
      for (const a of o.approval) expect(known.has(a.companion), a.companion).toBe(true);
      if (o.companionLeaves) expect(known.has(o.companionLeaves.id), o.companionLeaves.id).toBe(true);
    }
    const leaves = all.flatMap((o) => (o.companionLeaves ? [o.companionLeaves.status] : []));
    expect(leaves).toEqual(expect.arrayContaining(['dead', 'left', 'betrayed']));
  });

  it('never writes companion status (except "met") or loyalty flags directly', () => {
    const status = new Set(roster.companions.map((d) => d.statusFlag));
    const loyalty = new Set(roster.companions.map((d) => d.loyaltyFlag));
    for (const o of all) {
      for (const f of o.flags) {
        const id = 'set' in f ? f.set : 'inc' in f ? f.inc : undefined;
        if (!id) continue;
        expect(loyalty.has(id), `direct loyalty write ${id}`).toBe(false);
        if (status.has(id)) expect('value' in f && f.value, `direct status write ${id}`).toBe('met');
      }
    }
  });

  it('approval deltas follow the ±5 / ±10 / ±20 scale (the gallows rescue is the design-mandated +15)', () => {
    const deltas = all.flatMap((o) => o.approval.map((a) => a.delta));
    expect(deltas.length).toBeGreaterThan(10);
    for (const d of deltas) expect([5, 10, 15, 20, -5, -10, -20], String(d)).toContain(d);
  });

  it('encounters keep the design groups and declare scaling pools of their own monsters', () => {
    const counts = (id: string) => Object.fromEntries(ADV.encounters.find((e) => e.id === id)!.monsters.map((m) => [m.id, m.count]));
    expect(counts('dock_cell')).toEqual({ tough: 2, cultist: 2 });
    expect(counts('kestrel_alarm')).toEqual({ guard: 4, guard_captain: 1 });
    expect(counts('grinning_coin_brawl')).toEqual({ pirate: 3 });
    expect(counts('gullhaven_raid')).toEqual({ pirate: 4, pirate_captain: 1 });
    expect(counts('gullhaven_defense')).toEqual({ guard: 4, warrior_veteran: 1, scout: 2 });
    expect(counts('cove_smugglers')).toEqual({ bandit: 3, bandit_captain: 1, mimic: 1 });
    expect(counts('reef_hag')).toEqual({ sea_hag: 1, merrow: 2 });
    expect(counts('reef_hag_sharks')).toEqual({ sea_hag: 1, merrow: 2, reef_shark: 2 });
    expect(counts('vault_guardians')).toEqual({ animated_armor: 2, animated_flying_sword: 3 });
    expect(counts('vault_vey')).toEqual({ bandit_captain: 1, cultist: 3 });
    expect(counts('harbor_strike')).toEqual({ cultist_fanatic: 2, cultist: 4, bandit_captain: 1 });
    expect(counts('harbor_strike_vey')).toEqual({ cultist_fanatic: 2, cultist: 4, pirate_captain: 1 });
    for (const e of ADV.encounters) {
      if (e.monsters.reduce((s, m) => s + m.count, 0) < 2) continue;
      expect(e.scaling, e.id).toBeDefined();
      for (const id of e.scaling!.pool) {
        expect(db.monsters.has(id), id).toBe(true);
        expect(e.monsters.some((m) => m.id === id), `${e.id} pool ${id}`).toBe(true);
      }
    }
  });
});

describe('ch2_salt_and_treason: reachability', () => {
  /**
   * The whole chapter is too wide for one breadth-first search (every optional clue multiplies the
   * states), so the main path is proven in legs: each leg starts where the last one ends and its
   * goal is a synthetic ending that fires when the leg's milestone holds.
   */
  const leg = (scene: string, goal: Condition): Adventure => ({
    ...startingAt(scene),
    beats: [...ADV.beats, { id: 'leg_goal', text: 'Leg complete.', trigger: goal, scenes: [], outcome: OutcomeSchema.parse({ ending: 'leg_goal' }), required: false }],
    endings: [...ADV.endings, { id: 'leg_goal', name: 'Leg goal', text: '' }],
  });
  const solve = (adventure: Adventure, flags: Flags, ending: string) => solveAdventure({ state: ctx(flags).state, adventure, db, flags: registry() }, ending, { depth: 30, nodes: 60000 });

  it('leg 1: from the docks, the solver chooses a side and reaches Gullhaven', () => {
    const res = solve(leg('port_sorrel_docks', { all: [{ flag: 'arc.main.ch2_alliance_chosen' }, { visited: 'gullhaven_truce' }] }), {}, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each(['red_gull', 'saltwind', 'neutral'])('leg 2: from Gullhaven (alliance %s), the solver resolves the Brass Parrot vault', (alliance) => {
    const flags = { 'arc.main.isles_alliance': alliance, 'arc.main.ch2_alliance_chosen': true };
    const res = solve(leg('gullhaven_truce', { not: { flag: 'arc.main.tooth_parrot_holder', eq: 'unclaimed' } }), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each([
    ['isles_free', 'red_gull'],
    ['isles_company', 'saltwind'],
    ['isles_own_course', 'neutral'],
  ])('leg 3: from the docks with the vault resolved, the solver reaches ending %s (alliance %s)', (ending, alliance) => {
    const flags = { 'arc.main.isles_alliance': alliance, 'arc.main.ch2_alliance_chosen': true, 'arc.main.ch2_gullhaven_done': true, 'arc.main.tooth_parrot_holder': 'player' };
    const res = solve(startingAt('port_sorrel_docks'), flags, ending);
    expect(res.ok, res.reason).toBe(true);
  });

  it('a scripted Red Gull playthrough sets the flags later chapters read', () => {
    const c = ctx({}, { lucky: true });
    startAdventure(c);
    play(c, [
      'crates.inspect',
      'exit.to_fort',
      'talk_rook',
      'noon_rescue',
      'exit.to_fennicks',
      'meet_quint',
      'ally_red_gull',
      'exit.to_cove',
      'spot_lights',
      'open_stash',
      'read_cipher',
      'share_loot',
      'climb_out',
      'exit.to_gullhaven',
      'talk_tull',
      'riddle_source',
      'sal_riddles',
      'defend_port',
      'exit.to_vault',
      'cross_jungle',
      'door_1',
      'door_2',
      'door_3',
      'enter_vault',
      'face_vey_alone',
      'capture_vey',
      'divide_red_gull',
      'exit.to_docks',
      'exit.to_reckoning',
      'confront_proof',
      'fight_strike',
      'chase_pell',
      'search_pell',
      'expose_pell',
      'end_free_isles',
    ]);
    const f = c.state.flags;
    expect(getProgress(c.state)?.ending).toBe('isles_free');
    expect(c.state.companions.map((x) => x.id)).toEqual(['rook']);
    expect(f).toMatchObject({
      'world.rook_status': 'in_party',
      'world.rook_loyalty': 50 + 15 + 10 + 5 + 5 + 5, // gallows rescue, Red Gull alliance, stash share, treasure share, Pell exposed
      'arc.main.almoner_seal_seen': true,
      'arc.main.choir_ledger_found': true,
      'arc.main.isles_alliance': 'red_gull',
      'arc.main.gullhaven_fate': 'free',
      'arc.main.tooth_parrot_holder': 'player',
      'arc.main.tooth_reef_holder': 'red_gull', // the long way round to the reef loses the race; Quint takes it
      'arc.main.parrot_treasure': 'red_gull',
      'arc.main.harrow_vey_fate': 'captured',
      'arc.main.pell_fate': 'exposed',
    });
    expect(f['world.player_outlawed']).toBeFalsy();
  });

  it('the Saltwind gunboat wins both Teeth in the race', () => {
    const base = { 'arc.main.isles_alliance': 'saltwind', 'arc.main.ch2_alliance_chosen': true, 'arc.main.ch2_map_a': true, 'arc.main.ch2_map_b': true, 'arc.main.ch2_reef_chart': true };
    const c = ctx(base, { lucky: true, adventure: startingAt('gullhaven_truce') });
    startAdventure(c);
    play(c, ['lead_raid', 'exit.to_reef', 'resist_song', 'bargain', 'exit.to_vault_fast', 'cross_jungle', 'door_1', 'door_2', 'door_3', 'enter_vault']);
    expect(c.state.flags).toMatchObject({ 'arc.main.gullhaven_fate': 'occupied', 'arc.main.tooth_reef_holder': 'player', 'arc.main.hag_bargain': true, 'arc.main.tooth_parrot_holder': 'player' });
  });

  it('without fast passage the second Tooth goes to the Choir', () => {
    const base = { 'arc.main.isles_alliance': 'neutral', 'arc.main.ch2_alliance_chosen': true, 'arc.main.ch2_map_a': true, 'arc.main.ch2_map_b': true };
    const c = ctx(base, { lucky: true, adventure: startingAt('gullhaven_truce') });
    startAdventure(c);
    play(c, ['talk_tull', 'cast_off', 'exit.to_vault', 'cross_jungle', 'door_1', 'door_2', 'door_3', 'enter_vault', 'face_vey', 'kill_vey', 'claim_all', 'exit.to_reef']);
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_parrot_holder': 'player', 'arc.main.tooth_reef_holder': 'choir', 'arc.main.harrow_vey_fate': 'killed', 'arc.main.parrot_treasure': 'player' });
    expect(ids(c)).not.toContain('bargain');
  });

  it('Rook hangs if nobody frees him in time, and his half-map can be lifted', () => {
    const c = ctx({}, { lucky: true });
    startAdventure(c);
    c.state.time += 24 * 60;
    perform(c, 'cages.talk');
    expect(c.state.flags).toMatchObject({ 'arc.main.ch2_rook_hanged': true, 'world.rook_status': 'dead' });
    perform(c, 'exit.to_fort');
    expect(ids(c)).toContain('effects.lift');
    expect(ids(c)).not.toContain('bribe_lusk');
  });

  it('a disloyal Rook sells the Brass Tooth at the reckoning', () => {
    const c = ctx({ 'world.rook_status': 'in_party', 'world.rook_loyalty': 15, 'arc.main.tooth_parrot_holder': 'player', 'arc.main.tooth_reef_holder': 'player' }, { adventure: startingAt('pells_reckoning') });
    const r = applyParty(c, startAdventure(c));
    expect(r.partings).toEqual([{ id: 'rook', status: 'betrayed' }]);
    perform(c, 'intimidate_pell'); // the sale beat fires on the next step
    expect(c.state.flags).toMatchObject({ 'world.rook_status': 'betrayed', 'arc.main.tooth_parrot_holder': 'choir', 'arc.main.tooth_reef_holder': 'player' });
  });
});

describe('ch2_salt_and_treason: chapter-1 flags change the chapter', () => {
  it('a captured Sallow (or her letters) matches the manifest to the crates outright', () => {
    const plain = ctx();
    startAdventure(plain);
    expect(ids(plain)).toContain('crates.inspect');
    expect(ids(plain)).not.toContain('crates.read_manifest');

    const variants: Flags[] = [{ 'arc.main.sallow_fate': 'captured' }, { 'arc.main.ch1_letters': true }];
    for (const flags of variants) {
      const c = ctx(flags);
      startAdventure(c);
      expect(ids(c)).toContain('crates.read_manifest');
      expect(describeScene(c).seed).toContain("Sallow's manifest");
      perform(c, 'crates.read_manifest');
      expect(c.state.flags['arc.main.almoner_seal_seen']).toBe(true);
    }
  });

  it('a known cure (and Nettle) give advantage on the crate check', () => {
    const plain = ctx();
    startAdventure(plain);
    expect(perform(plain, 'crates.inspect').rolls[0]!.advantage).toEqual([]);

    const cured = ctx({ 'world.sickness_cure': 'briarkin_cure', 'world.nettle_status': 'in_party' });
    startAdventure(cured);
    expect(describeScene(cured).seed).toContain('Nettle');
    expect(perform(cured, 'crates.inspect').rolls[0]!.advantage).toEqual(["You know the Sickness' spore signs", "Nettle's nose for Maw-rot"]);
  });

  it("Hollowmere's fate shows on the docks", () => {
    const seed = (fate: string) => {
      const c = ctx({ 'arc.main.hollowmere_fate': fate });
      startAdventure(c);
      return describeScene(c).seed;
    };
    expect(seed('purged')).toContain('pyres');
    expect(seed('cured')).toContain('cure-tea');
    expect(seed('unresolved')).not.toContain('Hollowmere');
  });

  it('outlaw status and Red Gull debt change the gallows', () => {
    const at = startingAt('fort_kestrel_gallows');
    const plain = ctx({}, { adventure: at });
    startAdventure(plain);
    expect(ids(plain)).toEqual(expect.arrayContaining(['bribe_lusk', 'forged_papers']));
    expect(ids(plain)).not.toContain('rota_tip');
    expect(npcsHere(plain)).toContain('rook');

    const outlaw = ctx({ 'world.player_outlawed': true, 'world.red_gull_debt': 100 }, { adventure: at });
    startAdventure(outlaw);
    expect(ids(outlaw)).not.toContain('bribe_lusk');
    expect(ids(outlaw)).toEqual(expect.arrayContaining(['forged_papers_outlaw', 'rota_tip']));
    perform(outlaw, 'rota_tip');
    outlaw.state.time = 22 * 60;
    expect(ids(outlaw)).toContain('night_sneak_outlaw');
    outlaw.rng = new LuckyRng();
    const r = perform(outlaw, 'night_sneak_outlaw');
    expect(r.rolls[0]!.advantage).toEqual(['The Red Gulls’ guard rota']);
    play(outlaw, ['pick_lock']);
    expect(outlaw.state.flags).toMatchObject({ 'world.rook_status': 'in_party', 'world.red_gull_debt': 0 });
  });
});
