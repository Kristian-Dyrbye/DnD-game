/**
 * Arc chapter 3, "The Gilded Lie" (data/adventures/arc1/ch3_the_gilded_lie.json, DESIGN §8):
 * validates against the SRD and the flag registry, companions only change through recruit /
 * approval / companionLeaves, every chapter ending is reachable (solved in legs), and flags from
 * the starter arc and chapters 1–2 visibly change the chapter.
 */
import { describe, expect, it } from 'vitest';
import ch3Json from '../data/adventures/arc1/ch3_the_gilded_lie.json';
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
  const r = validateAdventure(structuredClone(ch3Json), db, registry());
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
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('ch3'))), db);
  hero.classes[0]!.level = 5;
  const state = newGameState(hero, 'heroic', 'ch3');
  state.time = (opts.hour ?? 10) * 60;
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
const begin = (flags: Flags = {}, scene?: string, lucky = true): RunContext => {
  const c = ctx(flags, { lucky, ...(scene && { adventure: startingAt(scene) }) });
  applyParty(c, startAdventure(c));
  return c;
};
const rep = (c: RunContext, faction: string) => ((c.state.extensions.reputation as Record<string, number> | undefined) ?? {})[faction] ?? 0;

describe('ch3_the_gilded_lie: data', () => {
  it('validates with no errors or warnings', () => {
    const r = validateAdventure(structuredClone(ch3Json), db, registry());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'ch3_the_gilded_lie', arcId: 'main', kind: 'arc', levelRange: [5, 7], regionId: 'aurelmark' });
    expect(ADV.endings.map((e) => e.id).sort()).toEqual(['court_hunted', 'court_secret', 'court_unmasked', 'court_vanished']);
  });

  it('uses the design scene ids at their lore locations', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'ch3_the_gilded_lie');
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
    for (const id of [
      'arc.main.money_trail_proven',
      'arc.main.tooth_vaelthorn_holder',
      'arc.main.dawnbreaker_holder',
      'arc.main.vosk_fate',
      'arc.main.cantor_identity_known',
      'arc.main.cantor_unmasked_publicly',
      'arc.main.cantor_warned',
      'arc.main.ch3_clues_2',
      'arc.main.ch3_clues_3',
      'arc.main.ch3_locket',
      'world.queen_alive',
      'world.player_outlawed',
      'world.aurek_status',
      'world.corwin_quest_done',
    ]) {
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
    expect(problems.filter((p) => p.file.includes('ch3_the_gilded_lie'))).toEqual([]);
    expect(adventures.has('ch3_the_gilded_lie')).toBe(true);
  });
});

describe('ch3_the_gilded_lie: companions and encounters', () => {
  const all = outcomes();

  it('Aurek joins only through recruit, and every companion reference is on the roster', () => {
    const known = new Set(roster.companions.map((d) => d.id));
    const recruits = all.filter((o) => o.recruit);
    expect(recruits.length).toBeGreaterThanOrEqual(3); // persuade, persuade as a pirate's friend, show a Tooth
    for (const o of recruits) expect(o.recruit).toBe('aurek');
    for (const o of all) {
      for (const a of o.approval) expect(known.has(a.companion), a.companion).toBe(true);
      if (o.companionLeaves) expect(known.has(o.companionLeaves.id), o.companionLeaves.id).toBe(true);
    }
    const leaves = all.flatMap((o) => (o.companionLeaves ? [`${o.companionLeaves.id}:${o.companionLeaves.status}`] : []));
    expect(leaves.sort()).toEqual(['aurek:betrayed', 'corwin:left']);
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

  it('approval deltas follow the ±5 / ±10 / ±20 scale (Corwin\'s completed personal quest is the design-mandated +15)', () => {
    const deltas = all.flatMap((o) => o.approval.map((a) => a.delta));
    expect(deltas.length).toBeGreaterThan(10);
    for (const d of deltas) expect([5, 10, 15, 20, -5, -10, -20], String(d)).toContain(d);
    const fifteens = all.filter((o) => o.approval.some((a) => a.delta === 15));
    for (const o of fifteens) expect(o.flags.some((f) => 'set' in f && f.set === 'world.corwin_quest_done')).toBe(true);
  });

  it('encounters keep the design groups and declare scaling pools of their own monsters', () => {
    const counts = (id: string) => Object.fromEntries(ADV.encounters.find((e) => e.id === id)!.monsters.map((m) => [m.id, m.count]));
    expect(counts('gate_arrest')).toEqual({ guard: 4, knight: 1 });
    expect(counts('deep_mine')).toEqual({ grick: 2, rust_monster: 1, grimlock: 4 });
    expect(counts('vault_constructs')).toEqual({ animated_armor: 3 });
    expect(counts('vault_constructs_guardian')).toEqual({ animated_armor: 3, shield_guardian: 1 });
    expect(counts('vosk_fight')).toEqual({ mage: 1, cultist_fanatic: 2 });
    expect(counts('vosk_at_vault')).toEqual({ mage: 1, cultist_fanatic: 2 });
    expect(counts('vigil_assassins')).toEqual({ spy: 2, cultist_fanatic: 2, shadow: 2 });
    expect(counts('vigil_assassins_surprise')).toEqual({ spy: 2, cultist_fanatic: 2, shadow: 2 });
    expect(counts('masque_guards')).toEqual({ guard: 6, knight: 2 });
    expect(counts('undercroft_rearguard')).toEqual({ ghast: 2, cultist_fanatic: 2, shadow: 2 });
    expect(counts('undercroft_ambush')).toEqual({ ghast: 3, cultist_fanatic: 2, shadow: 2 });
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

describe('ch3_the_gilded_lie: reachability', () => {
  /** Each leg starts where the last one ends; its goal is a synthetic ending that fires when the leg's milestone holds. */
  const leg = (scene: string, goal: Condition): Adventure => ({
    ...startingAt(scene),
    beats: [...ADV.beats, { id: 'leg_goal', text: 'Leg complete.', trigger: goal, scenes: [], outcome: OutcomeSchema.parse({ ending: 'leg_goal' }), required: false }],
    endings: [...ADV.endings, { id: 'leg_goal', name: 'Leg goal', text: '' }],
  });
  const solve = (adventure: Adventure, flags: Flags, ending: string) => solveAdventure({ state: ctx(flags).state, adventure, db, flags: registry() }, ending, { depth: 30, nodes: 60000 });

  it('leg 1: from Highcrown, the solver holds the audience and proves the money trail at Deepanvil', () => {
    const res = solve(leg('highcrown_audience', { flag: 'arc.main.money_trail_proven' }), {}, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each(['red_gull', 'saltwind'])('leg 1 (alliance %s): the money trail is still reachable', (alliance) => {
    const res = solve(leg('highcrown_audience', { flag: 'arc.main.money_trail_proven' }), { 'arc.main.isles_alliance': alliance }, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it('leg 1 (outlawed): the solver gets past the Queen\'s Gate to the audience', () => {
    const res = solve(leg('highcrown_audience', { flag: 'arc.main.ch3_audience_done' }), { 'world.player_outlawed': true }, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it('leg 2: at Vaelthorn, the solver wins the Sky Tooth and Dawnbreaker', () => {
    const goal = { all: [{ flag: 'arc.main.ch3_vaelthorn_done' }, { flag: 'arc.main.tooth_vaelthorn_holder', eq: 'player' }, { flag: 'arc.main.dawnbreaker_holder', eq: 'player' }] };
    const res = solve(leg('vaelthorn_sky_towers', goal), { 'arc.main.ch3_audience_done': true }, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  it.each(['player', 'choir'])('leg 3: at Dawnspire (Dawnbreaker: %s), the solver survives the vigil and rides for the masque', (lance) => {
    const flags = { 'arc.main.ch3_audience_done': true, 'arc.main.ch3_vaelthorn_done': true, 'arc.main.dawnbreaker_holder': lance, 'arc.main.vosk_fate': 'captured' };
    const res = solve(leg('dawnspire_vigil', { visited: 'almoners_masque' }), flags, 'leg_goal');
    expect(res.ok, res.reason).toBe(true);
  });

  const MASQUE = { 'arc.main.ch3_vigil_done': true, 'arc.main.ch3_vaelthorn_done': true, 'arc.main.dawnbreaker_holder': 'dawn_lance' };
  it.each([
    ['court_unmasked', { 'arc.main.almoner_seal_seen': true, 'arc.main.choir_ledger_found': true, 'arc.main.money_trail_proven': true }],
    ['court_secret', { 'arc.starter.dream_heard': true, 'arc.main.almoner_seal_seen': true }],
    ['court_hunted', {}],
    ['court_vanished', {}],
  ])('leg 4: from the masque, the solver reaches ending %s', (ending, clues) => {
    const res = solve(startingAt('almoners_masque'), { ...MASQUE, ...clues }, ending);
    expect(res.ok, res.reason).toBe(true);
  });

  it('a scripted playthrough (Saltwind friend, Corwin and Aurek, the cure known) unmasks the Cantor and saves the Queen', () => {
    const c = ctx(
      {
        'arc.main.isles_alliance': 'saltwind',
        'arc.starter.dream_heard': true,
        'arc.starter.pip_rescued': true,
        'arc.main.almoner_seal_seen': true,
        'arc.main.choir_ledger_found': true,
        'arc.main.cure_recipe': true,
        'arc.main.tooth_parrot_holder': 'player',
        'world.corwin_status': 'in_party',
        'world.corwin_loyalty': 50,
      },
      { lucky: true },
    );
    applyParty(c, startAdventure(c));
    play(c, [
      'attend_audience',
      'study_seraphine',
      'show_tooth_aurek',
      'exit.to_deepanvil',
      'saltwind_credit',
      'clear_mine',
      'take_armor',
      'study_ledgers_warrant',
      'exit.to_vaelthorn',
      'climb_first',
      'climb_second',
      'disable_wards',
      'enter_vault',
      'recite_oath_corwin',
      'face_vosk',
      'capture_vosk',
      'search_notes',
      'exit.to_dawnspire',
      'return_lance',
      'pip_wakes',
      'exit.to_masque',
      'blend_perform',
      'listen_voice_dream',
      'tell_aurek',
      'accuse_proven',
      'fight_rearguard',
      'save_queen_cure',
      'end_unmasked',
    ]);
    const f = c.state.flags;
    expect(getProgress(c.state)?.ending).toBe('court_unmasked');
    expect(c.state.companions.map((x) => x.id)).toEqual(['aurek']);
    expect(f).toMatchObject({
      'world.aurek_status': 'in_party',
      'world.aurek_loyalty': 50 + 5 + 10 + 5 + 5 + 10, // wards, Vosk spared, notes kept, told first, Queen saved
      'world.corwin_loyalty': 100, // oath, Vosk spared, lance returned, knighted, Queen saved (clamped)
      'world.corwin_quest_done': true,
      'arc.main.ch3_clues_3': true, // dream, seal, ledger, money trail, Aurek, Vosk's notes
      'arc.main.ch3_aurek_confided': true,
      'arc.main.ch3_vosk_notes': true,
      'arc.main.money_trail_proven': true,
      'arc.main.tooth_vaelthorn_holder': 'player',
      'arc.main.dawnbreaker_holder': 'dawn_lance',
      'arc.main.vosk_fate': 'captured',
      'arc.main.cantor_identity_known': true,
      'arc.main.cantor_unmasked_publicly': true,
    });
    expect(f['world.queen_alive']).not.toBe(false);
    expect(f['arc.main.cantor_warned']).toBeFalsy();
    expect(f['arc.main.ch3_locket']).toBeFalsy();
    expect(c.state.hero.inventory.some((i) => i.itemId === 'adamantine_armor')).toBe(true);
    expect(rep(c, 'order_of_the_dawn_lance')).toBeGreaterThanOrEqual(25);
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(7500 + 9000);
  });
});

describe('ch3_the_gilded_lie: the race, the chase and the leave points', () => {
  it('Vosk empties the Vault if the hero dawdles four days after the audience', () => {
    const c = begin();
    perform(c, 'attend_audience');
    c.state.time += 4 * 24 * 60;
    perform(c, 'study_seraphine');
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'choir', 'arc.main.dawnbreaker_holder': 'choir', 'arc.main.vosk_fate': 'escaped', 'arc.main.ch3_vaelthorn_done': true });
    expect(ids(c)).toContain('exit.to_dawnspire');
    perform(c, 'exit.to_vaelthorn');
    expect(describeScene(c).seed).toContain('too late');
    expect(ids(c)).not.toContain('climb_first');
  });

  it('a failed climb loses the race: Vosk must be beaten at the Vault, or he takes Tooth and lance', () => {
    const c = begin({ 'arc.main.ch3_audience_done': true }, 'vaelthorn_sky_towers', false);
    c.rng = new UnluckyRng();
    perform(c, 'climb_first');
    c.rng = new LuckyRng();
    perform(c, 'climb_second');
    expect(ids(c)).toContain('confront_vosk');
    expect(ids(c)).not.toContain('enter_vault_warded');
    const r = perform(c, 'confront_vosk');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'choir', 'arc.main.dawnbreaker_holder': 'choir', 'arc.main.vosk_fate': 'escaped', 'arc.main.ch3_vaelthorn_done': true });
  });

  it('losing to Vosk after lifting the lance costs the Tooth but not Dawnbreaker', () => {
    const c = begin({ 'arc.main.ch3_audience_done': true }, 'vaelthorn_sky_towers');
    play(c, ['climb_first', 'climb_second', 'enter_vault_warded', 'recite_oath']);
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'player', 'arc.main.dawnbreaker_holder': 'player' });
    const r = perform(c, 'face_vosk');
    resolveEncounter(c, r.encounter!, 'lose');
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'choir', 'arc.main.dawnbreaker_holder': 'player', 'arc.main.vosk_fate': 'escaped' });
  });

  it('a Tooth entrusted to the Almonry goes to the Choir; the chase takes it back and drops the locket', () => {
    const c = begin({ 'arc.main.tooth_parrot_holder': 'player', 'arc.main.tooth_reef_holder': 'player', 'arc.main.tooth_want_holder': 'choir' });
    play(c, ['attend_audience', 'entrust_tooth']);
    expect(c.state.flags).toMatchObject({ 'arc.main.tooth_parrot_holder': 'choir', 'arc.main.tooth_reef_holder': 'player', 'arc.main.ch3_entrusted_parrot': true });

    const u = begin({ ...c.state.flags, 'arc.main.tooth_vaelthorn_holder': 'player' }, 'palace_undercroft');
    play(u, ['fight_rearguard', 'pursue', 'chase_1_athletics', 'chase_2_acrobatics', 'chase_3_athletics']);
    expect(u.state.flags).toMatchObject({ 'arc.main.tooth_parrot_holder': 'player', 'arc.main.tooth_want_holder': 'choir', 'arc.main.ch3_locket': true, 'world.queen_alive': false });
    expect(ids(u)).toContain('end_vanished');
  });

  it('the chase retakes the most recently lost Tooth first', () => {
    const u = begin({ 'arc.main.tooth_vaelthorn_holder': 'choir', 'arc.main.tooth_reef_holder': 'choir' }, 'palace_undercroft');
    play(u, ['fight_rearguard', 'pursue', 'chase_1_athletics', 'chase_2_athletics', 'chase_3_athletics']);
    expect(u.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'player', 'arc.main.tooth_reef_holder': 'choir' });
  });

  it('a failed chase lets the Cantor go with nothing recovered', () => {
    const u = begin({ 'arc.main.tooth_vaelthorn_holder': 'choir' }, 'palace_undercroft');
    play(u, ['fight_rearguard', 'pursue']);
    u.rng = new UnluckyRng();
    play(u, ['chase_1_athletics', 'chase_2_athletics', 'chase_3_athletics']);
    expect(u.state.flags).toMatchObject({ 'arc.main.tooth_vaelthorn_holder': 'choir', 'arc.main.ch3_undercroft_done': true, 'world.queen_alive': false });
    expect(u.state.flags['arc.main.ch3_locket']).toBeFalsy();
  });

  it('a disloyal Aurek warns his aunt at the masque: no chase, only the ambush', () => {
    const c = begin({ 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 15, 'arc.main.ch3_vigil_done': true }, 'almoners_masque');
    expect(c.state.flags).toMatchObject({ 'world.aurek_status': 'betrayed', 'arc.main.cantor_warned': true });
    play(c, ['play_along']);
    expect(ids(c)).toEqual(['fight_ambush']);
    play(c, ['fight_ambush']);
    expect(ids(c)).not.toContain('pursue');
    expect(ids(c)).toContain('save_queen');
  });

  it('a loyal Aurek confides his aunt\'s absences (clue 6)', () => {
    const c = begin({ 'world.aurek_status': 'in_party', 'world.aurek_loyalty': 60, 'arc.main.almoner_seal_seen': true, 'arc.main.ch3_vigil_done': true }, 'almoners_masque');
    expect(c.state.flags['arc.main.ch3_aurek_confided']).toBe(true);
    expect(c.state.flags['arc.main.ch3_clues_2']).toBe(true);
    expect(c.state.flags['arc.main.ch3_clues_3']).toBeFalsy();
    expect(ids(c)).toContain('accuse_contested');
  });

  it('a disloyal Corwin leaves at Dawnspire and demands the lance back', () => {
    const c = begin({ 'world.corwin_status': 'in_party', 'world.corwin_loyalty': 15, 'arc.main.dawnbreaker_holder': 'player', 'arc.main.ch3_vaelthorn_done': true }, 'dawnspire_vigil');
    expect(c.state.flags['world.corwin_status']).toBe('left');
    expect(ids(c)).toContain('keep_lance_defy');
    expect(ids(c)).not.toContain('keep_lance');
    perform(c, 'keep_lance_defy');
    expect(rep(c, 'order_of_the_dawn_lance')).toBe(-35);
    expect(c.state.hero.inventory.some((i) => i.itemId === 'dragon_slayer')).toBe(true);
  });

  it('a failed accusation outlaws the hero and ends the chapter hunted', () => {
    const c = begin({ 'arc.main.ch3_vigil_done': true }, 'almoners_masque');
    expect(ids(c)).toContain('accuse_weak');
    const r = perform(c, 'accuse_weak');
    expect(c.state.flags['world.player_outlawed']).toBe(true);
    resolveEncounter(c, r.encounter!, 'lose');
    expect(ids(c)).toEqual(expect.arrayContaining(['masque_break_out', 'masque_wait']));
    expect(ids(c)).not.toContain('aurek_frees');
    play(c, ['masque_wait']);
    expect(getProgress(c.state)?.sceneId).toBe('palace_undercroft');
    expect(ids(c)).toEqual(['fight_ambush']); // three days late: no chase
    play(c, ['fight_ambush', 'save_queen', 'end_hunted']);
    expect(getProgress(c.state)?.ending).toBe('court_hunted');
  });
});

describe('ch3_the_gilded_lie: earlier chapters change the chapter', () => {
  it('an outlaw must get past the Queen\'s Gate first, and Corwin can vouch', () => {
    const plain = begin();
    expect(ids(plain)).toContain('attend_audience');
    expect(ids(plain)).not.toContain('gate_bluff');

    const outlaw = begin({ 'world.player_outlawed': true });
    expect(ids(outlaw)).toEqual(expect.arrayContaining(['gate_bluff', 'gate_sneak', 'gate_fight']));
    expect(ids(outlaw)).not.toContain('attend_audience');
    expect(ids(outlaw)).not.toContain('gate_corwin');
    expect(describeScene(outlaw).seed).toContain('Wanted posters');

    const vouched = begin({ 'world.player_outlawed': true, 'world.corwin_status': 'in_party', 'world.corwin_loyalty': 55 });
    perform(vouched, 'gate_corwin');
    expect(ids(vouched)).toEqual(expect.arrayContaining(['attend_audience']));
    play(vouched, ['attend_audience']);
    expect(ids(vouched)).toContain('plead_pardon');
    expect(ids(vouched)).not.toContain('request_warrant');
    play(vouched, ['plead_pardon']);
    expect(vouched.state.flags['world.player_outlawed']).toBe(false);
  });

  it('the isles alliance changes the warrant and the Deepanvil ledgers', () => {
    const saltwind = begin({ 'arc.main.isles_alliance': 'saltwind' });
    perform(saltwind, 'attend_audience');
    expect(saltwind.state.flags['arc.main.ch3_warrant']).toBe(true);
    perform(saltwind, 'exit.to_deepanvil');
    expect(ids(saltwind)).toEqual(expect.arrayContaining(['saltwind_credit', 'warrant_books', 'clear_mine']));

    const redGull = begin({ 'arc.main.isles_alliance': 'red_gull' });
    perform(redGull, 'attend_audience');
    expect(ids(redGull)).toContain('request_warrant_suspect');
    expect(ids(redGull)).not.toContain('request_warrant');
    perform(redGull, 'exit.to_deepanvil');
    redGull.state.hero.coins = 30000; // restitution costs 300 gp
    expect(ids(redGull)).toEqual(expect.arrayContaining(['pay_restitution', 'argue_restitution']));
    expect(ids(redGull)).not.toContain('clear_mine');
    perform(redGull, 'pay_restitution');
    expect(ids(redGull)).toContain('clear_mine');
  });

  it('Pell\'s exposure earns the Queen\'s commendation, and a Choir-held Tooth of Want chills the greeting', () => {
    const c = begin({ 'arc.main.pell_fate': 'exposed', 'arc.main.tooth_want_holder': 'choir' });
    const r = perform(c, 'attend_audience');
    expect(rep(c, 'crown_of_aurelmark')).toBe(10);
    expect(r.facts.join(' ')).toContain('We have met, in a sense');

    const plain = begin();
    expect(perform(plain, 'attend_audience').facts.join(' ')).not.toContain('We have met');
    expect(rep(plain, 'crown_of_aurelmark')).toBe(0);
  });

  it('earlier clues are counted, and the Millbrook dream lowers the masque Insight DC', () => {
    const none = begin({ 'arc.main.ch3_vigil_done': true }, 'almoners_masque');
    expect(none.state.flags['arc.main.ch3_clues_2']).toBeFalsy();
    expect(availableActions(none).find((a) => a.id === 'listen_voice')?.check).toBe('Insight DC 17');
    expect(ids(none)).toContain('accuse_weak');

    const clues = begin(
      { 'arc.starter.dream_heard': true, 'arc.main.almoner_seal_seen': true, 'arc.main.sallow_fate': 'captured', 'arc.main.ch1_sallow_confessed': true, 'arc.main.ch3_vigil_done': true },
      'almoners_masque',
    );
    expect(clues.state.flags).toMatchObject({ 'arc.main.ch3_clues_2': true, 'arc.main.ch3_clues_3': true });
    expect(availableActions(clues).find((a) => a.id === 'listen_voice_dream')?.check).toBe('Insight DC 12');
    expect(ids(clues)).toContain('accuse_proven');
    expect(describeScene(clues).seed).toContain('Millbrook barrow');
  });

  it('the Choir ledger gives advantage on the Ironvault ledgers', () => {
    const c = begin({ 'arc.main.choir_ledger_found': true, 'arc.main.isles_alliance': 'saltwind', 'arc.main.ch3_audience_done': true }, 'deepanvil_ledgers');
    perform(c, 'saltwind_credit');
    expect(perform(c, 'study_ledgers').rolls[0]!.advantage).toEqual(['Cross-referencing the Choir ledger']);
  });

  it('Pip warns the hero at Dawnspire, and Corwin lifts the lance at Vaelthorn', () => {
    const base = { 'arc.main.ch3_vaelthorn_done': true, 'arc.main.dawnbreaker_holder': 'player' };
    const pip = begin({ ...base, 'arc.starter.pip_rescued': true }, 'dawnspire_vigil');
    expect(npcsHere(pip)).toContain('pip_hallard');
    perform(pip, 'return_lance');
    expect(ids(pip)).toContain('pip_wakes');
    expect(ids(pip)).not.toContain('keep_watch');

    const nopip = begin(base, 'dawnspire_vigil');
    expect(npcsHere(nopip)).not.toContain('pip_hallard');
    perform(nopip, 'return_lance');
    expect(ids(nopip)).toContain('keep_watch');

    const corwin = begin({ 'arc.main.ch3_audience_done': true, 'world.corwin_status': 'in_party' }, 'vaelthorn_sky_towers');
    play(corwin, ['climb_first', 'climb_second', 'enter_vault_warded']);
    expect(ids(corwin)).toContain('recite_oath_corwin');
    expect(ids(corwin)).not.toContain('recite_oath');
  });

  it('the fen cure saves the Queen outright', () => {
    const cured = begin({ 'world.sickness_cure': 'briarkin_cure' }, 'palace_undercroft');
    play(cured, ['fight_rearguard']);
    expect(ids(cured)).toContain('save_queen_cure');
    expect(ids(cured)).not.toContain('save_queen');

    const plain = begin({}, 'palace_undercroft');
    play(plain, ['fight_rearguard']);
    expect(availableActions(plain).find((a) => a.id === 'save_queen')?.check).toBe('Medicine DC 18');
  });

  it('Hollowmere\'s fate shows in Highcrown', () => {
    const seed = (fate: string) => describeScene(begin({ 'arc.main.hollowmere_fate': fate })).seed;
    expect(seed('purged')).toContain('burned Hollowmere');
    expect(seed('cured')).toContain('cured, not burned');
  });
});
