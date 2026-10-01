/**
 * B007 — Hollow Crown chapter 3, "The Blightwood Mint" (data/adventures/arc2/ch3_blightwood_mint.json,
 * DESIGN_ARC2 §7 + §10): validates against the SRD, the flag registry and the companion roster; uses the
 * bible's scene ids; the solver reaches the endings that need no lost roll; the Dawn Lance lends a knight
 * by commission, standing or speech; the Blightwood path is kept by Survival, by a won fight or never by
 * standing still; two of three foundry stations cool the moulds (else the guardians fight); the
 * coronation branches on clues (name Vexx), the borrowed face, the knight and Gilt/Tallow from earlier
 * chapters; Vexx is unmasked, killed, bargained with (scar + story condition) or escapes; the crown is
 * destroyed, handed over or kept; level 5; the five endings (first match wins, exclusive) and the
 * epilogue lines, incl. an imported-world variant.
 */
import { describe, expect, it } from 'vitest';
import ch3Json from '../data/adventures/arc2/ch3_blightwood_mint.json';
import ch2Json from '../data/adventures/arc2/ch2_gamblers_tide.json';
import flagsJson from '../data/adventures/flags.json';
import companionsJson from '../data/companions.json';
import { combatStep } from './helpers/combatPolicy';
import { ch3Choice } from './helpers/arc2Policy';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { availableActions, getProgress, npcsHere, perform as runnerPerform, resolveEncounter as runnerResolve, startAdventure, type RunContext, type StepResult } from '../src/engine/adventure/runner';
import type { Adventure } from '../src/engine/adventure/schema';
import { scaleMonsters } from '../src/engine/adventure/encounters';
import { activeFight, startFight } from '../src/engine/adventure/fights';
import { changeApproval, CompanionRosterSchema, partWithCompanion, recruitCompanion } from '../src/engine/party/companions';
import { LuckyRng, solveAdventure } from '../src/engine/adventure/solver';
import { allScenes, flagRefs, validateAdventure } from '../src/engine/adventure/validate';
import { newGameState } from '../src/engine/session/GameSession';
import { FlagRegistry, type Flags } from '../src/engine/world/flags';
import { bundledFlagRegistry, loadBundledAdventures } from '../src/host/bundled';
import { createGameHost, worldTables } from '../src/host/gameHost';
import { MemorySaves } from '../src/host/memorySaves';
import type { ServerEvent } from '../src/shared/protocol';

const db = loadSrd();
const registry = () => FlagRegistry.fromJson(flagsJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const chapter = (): Adventure => {
  const r = validateAdventure(structuredClone(ch3Json), db, registry(), roster);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const C = 'arc.crown.';
const L = 'arc.crown.ch3_';
const ENDINGS = ['ending_false_coin', 'ending_true_weight', 'ending_hollow_king', 'ending_stranger', 'ending_thousand_faces'];
const END_ACTIONS = ['end_false_coin', 'end_true_weight', 'end_hollow_keeper', 'end_stranger', 'end_thousand_faces'];
const CLUES = (n: number): Flags => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${C}clue_${i + 1}`, true]));

/** Applies a step's companion effects the way the session port does (see tests/arc1Ch1.test.ts). */
function applyParty(c: RunContext, r: StepResult): StepResult {
  const def = (id: string) => roster.companions.find((d) => d.id === id)!;
  for (const id of r.recruits ?? []) recruitCompanion(c.state, def(id), db);
  for (const a of r.approvals ?? []) changeApproval(c.state, def(a.companion), a.delta);
  for (const p of r.partings ?? []) partWithCompanion(c.state, def(p.id), p.status);
  return r;
}
const perform = (c: RunContext, id: string): StepResult => applyParty(c, runnerPerform(c, id));
const resolveEncounter = (c: RunContext, id: string, how: 'win' | 'lose' | 'flee'): StepResult => applyParty(c, runnerResolve(c, id, how));

/** Always rolls 1 (every check fails). */
class UnluckyRng extends Rng {
  constructor() {
    super([1, 2, 3, 4]);
  }
  override int(min: number, max: number): number {
    return max === 20 ? 1 : super.int(min, max);
  }
}

const level4 = () => {
  const hero = buildCharacter({ ...toBuildInput(quickBuild('fighter', db, Rng.fromSeed('arc2ch3'))), level: 4, subclassId: 'champion' }, db);
  hero.xp = 2700;
  return hero;
};

function ctx(flags: Flags = {}, opts: { scene?: string; lucky?: boolean; unlucky?: boolean; rep?: Record<string, number>; party?: string[] } = {}): RunContext {
  const state = newGameState(level4(), 'heroic', 'arc2ch3', 'arc2_ch0_hollow_coin');
  if (opts.rep) state.extensions.reputation = { ...opts.rep };
  Object.assign(state.flags, flags);
  for (const id of opts.party ?? []) recruitCompanion(state, roster.companions.find((d) => d.id === id)!, db);
  const adventure = opts.scene ? { ...ADV, start: { ...ADV.start, scene: opts.scene } } : ADV;
  const c: RunContext = { state, adventure, rng: opts.lucky ? new LuckyRng() : opts.unlucky ? new UnluckyRng() : Rng.fromSeed(7), db, flags: registry() };
  startAdventure(c);
  return c;
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
/** Performs a scripted path, resolving every fight the given way; returns every fact told. */
function play(c: RunContext, path: string[], how: 'win' | 'lose' | 'flee' = 'win'): string[] {
  const facts: string[] = [];
  for (const id of path) {
    const step = id === 'TRAIL' ? (ids(c).find((x) => x === 'exit.day_trail' || x === 'exit.night_trail') ?? 'exit.day_trail') : id;
    let r = perform(c, step);
    facts.push(...r.facts);
    for (let g = 0; r.encounter && g < 5; g++) {
      r = resolveEncounter(c, r.encounter, how);
      facts.push(...r.facts);
    }
  }
  return facts;
}
const endsOffered = (c: RunContext) => ids(c).filter((x) => END_ACTIONS.includes(x));
const foes = (c: RunContext, enc: string) => {
  const f = startFight(c, enc, Rng.fromSeed(3), db);
  const all = Object.entries(f.enc.state.creatures);
  return { foes: all.filter(([id]) => !id.startsWith('ally_') && id !== c.state.hero.id && !c.state.companions.some((p) => p.id === id)).map(([, x]) => x), allies: all.filter(([id]) => id.startsWith('ally_')).map(([, x]) => x) };
};

describe('arc2_ch3_blightwood_mint: data', () => {
  it('validates with no errors or warnings, follows chapter 2 and ends the campaign with the five bible endings', () => {
    const r = validateAdventure(structuredClone(ch3Json), db, registry(), roster);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'arc2_ch3_blightwood_mint', arcId: 'crown', kind: 'arc', levelRange: [4, 5] });
    expect(ch2Json.endings[0]!.next).toBe(ADV.id);
    expect(ADV.endings.map((e) => e.id)).toEqual(ENDINGS);
    for (const e of ADV.endings) expect(e.next, e.id).toBeUndefined();
  });

  it('uses the bible scene ids at their lore locations, with the rotating-path forest and the foundry maps', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'arc2_ch3_blightwood_mint');
    const scenes = allScenes(ADV);
    expect(scenes).toHaveLength(6);
    expect(scenes).toHaveLength(design.length);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(ADV.maps.map((m) => m.id)).toEqual(['blightwood_map', 'vaelthorn_foundry']);
    expect(ADV.encounters.find((e) => e.id === 'coronation_fight')).toMatchObject({ map: 'vaelthorn_foundry', room: 'throne_hall' });
  });

  it('writes only registered or documented flags; local flags are boolean; the bible flags are all written', () => {
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
    for (const id of [`${C}clue_6`, `${C}crowned`, `${C}vexx_fate`, `${C}borrowed_face`, 'world.hollow_crown', 'world.player_outlawed']) expect(written.has(id), id).toBe(true);
    const read = new Set(reads);
    for (const id of ['arc.crown.ch1_commission', 'arc.crown.ch2_market_burned', `${C}gilt_exposed`, `${C}memory_restored`, 'world.hag_bargain', 'world.maw_state', 'world.queen_alive', 'world.corwin_status']) expect(read.has(id), id).toBe(true);
  });

  it('encounters follow the bible; Vexx is a spy with half again her HP and the scaling always keeps her', () => {
    const counts = (id: string) => ADV.encounters.find((e) => e.id === id)!.monsters.reduce<Record<string, number>>((o, m) => ({ ...o, [m.id]: (o[m.id] ?? 0) + m.count }), {});
    expect(counts('blightwood_pack')).toEqual({ worg: 2, goblin_warrior: 3, ghoul: 2 });
    expect(counts('foundry_guardians')).toEqual({ animated_armor: 3, gargoyle: 1 });
    expect(counts('coronation_fight')).toEqual({ spy: 1, cultist_fanatic: 2, doppelganger: 1, night_hag: 1 });
    const fight = ADV.encounters.find((e) => e.id === 'coronation_fight')!;
    expect(fight.statOverrides.spy).toEqual({ name: 'Ondra Vexx', hpPercent: 150 });
    expect(fight.allies.map((a) => a.id)).toEqual(['knight', 'guard']);
    for (const e of ADV.encounters) {
      expect(e.scaling, e.id).toBeDefined();
      const solo = scaleMonsters(e.monsters, [4], db, db.tables!, { pool: e.scaling?.pool ?? [], bossIds: e.bosses });
      expect(solo.length, e.id).toBeGreaterThan(0);
      for (const b of e.bosses) expect(solo.find((m) => m.id === b)?.count, `${e.id} ${b}`).toBe(1);
    }
  });

  it('nobody is recruited here; approvals use the ±5/±10/±20 scale', () => {
    const text = JSON.stringify(ch3Json);
    expect(text).not.toContain('"recruit"');
    for (const m of text.matchAll(/"companion": "(\w+)", "delta": (-?\d+)/g)) {
      expect(['brannoc', 'ilse', 'wren']).toContain(m[1]);
      expect([5, 10, 20, -5, -10, -20]).toContain(Number(m[2]));
    }
  });
});

describe('arc2_ch3_blightwood_mint: reachability', () => {
  it.each(['ending_true_weight', 'ending_hollow_king', 'ending_stranger'])('the solver reaches %s from the start', (ending) => {
    const c = ctx();
    const res = solveAdventure({ state: newGameState(c.state.hero, 'heroic', 'solve', ADV.id), adventure: ADV, db, flags: registry() }, ending, { depth: 60, nodes: 30000 });
    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it('a scripted path: knight by commission, the path kept, the moulds cooled, Vexx named, the crown broken: True Weight at level 5', () => {
    const c = ctx({ ...CLUES(5), 'arc.crown.ch1_commission': true, 'world.player_outlawed': true }, { lucky: true });
    const facts = play(c, [
      'talk.captain_ashe.lance',
      'dlg.greet.commission',
      'dlg.lent.thanks',
      'chapel.pilgrim',
      'exit.to_blightwood',
      'weeping_trees.read_sap',
      'keep_path',
      'TRAIL',
      'stations.arcane',
      'stations.ledger',
      'seal.compare',
      'exit.to_coronation',
      'name_vexx',
    ]);
    expect(c.state.flags).toMatchObject({ [`${L}knight`]: true, [`${L}moulds_cooled`]: true, [`${C}clue_6`]: true, [`${L}named`]: true, [`${L}vexx_beaten`]: true });
    expect(c.state.flags[`${L}guardians_done`]).toBeUndefined();
    expect(getProgress(c.state)!.sceneId).toBe('hollow_crown_choice');
    // Named before the court: Vexx is held for the Ironvault, nobody has to catch her.
    expect(c.state.flags[`${C}vexx_fate`]).toBe('unmasked');
    expect(ids(c)).not.toContain('catch_vexx');
    expect(ids(c)).not.toContain('camp');
    play(c, ['crown_destroy', 'camp', 'exit.to_deepanvil']);
    expect(c.state.flags['world.hollow_crown']).toBe('destroyed');
    // 2700 from chapters 0–2 + the chapter + the 3800 milestone: level 5 (6500), short of level 6 (14000).
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(6500);
    expect(c.state.hero.xp).toBeLessThan(14000);
    expect(endsOffered(c)).toEqual(['end_true_weight']);
    const epilogue = play(c, ['end_true_weight']).join(' ');
    expect(getProgress(c.state)?.ending).toBe('ending_true_weight');
    expect(c.state.flags['world.player_outlawed']).toBe(false);
    expect(facts.join(' ') + epilogue).toBeTruthy();
  });

  it('the minimum path (no checks, every fight won) still reaches level 5 XP', () => {
    const c = ctx({}, { unlucky: true });
    play(c, ['exit.to_blightwood', 'push_on', 'TRAIL', 'storm_floor', 'exit.to_coronation', 'storm']);
    expect(getProgress(c.state)!.sceneId).toBe('hollow_crown_choice');
    play(c, ['catch_vexx']);
    expect(c.state.flags[`${C}vexx_fate`]).toBe('escaped');
    play(c, ['crown_hand', 'camp', 'exit.to_deepanvil']);
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(6500);
    expect(endsOffered(c)).toEqual(['end_thousand_faces']);
    play(c, ['end_thousand_faces']);
    expect(getProgress(c.state)?.ending).toBe('ending_thousand_faces');
  });
});

describe('arc2_ch3_blightwood_mint: approaches and consequences', () => {
  it('the Dawn Lance: commission, standing or a speech lends the knight; a failed speech does not; the knight joins the finale', () => {
    const standing = ctx({}, { rep: { order_of_the_dawn_lance: 20 } });
    play(standing, ['talk.captain_ashe.lance']);
    expect(ids(standing)).not.toContain('dlg.greet.commission');
    play(standing, ['dlg.greet.standing']);
    expect(standing.state.flags[`${L}knight`]).toBe(true);

    const refused = ctx({ 'world.player_outlawed': true }, { unlucky: true });
    play(refused, ['talk.captain_ashe.lance']);
    const roll = perform(refused, 'dlg.greet.persuade').rolls[0]!;
    expect(roll.disadvantage).toContain('Your face is on the Ironvault broadsheets');
    expect(refused.state.flags).toMatchObject({ [`${L}lance_refused`]: true });
    expect(refused.state.flags[`${L}knight`]).toBeUndefined();

    const speech = ctx(CLUES(3), { lucky: true });
    play(speech, ['talk.captain_ashe.lance']);
    expect(perform(speech, 'dlg.greet.persuade').rolls[0]!.advantage).toContain('You lay out the evidence of the Thousand Faces');
    expect(speech.state.flags[`${L}knight`]).toBe(true);

    const fight = ctx({ [`${L}knight`]: true }, { scene: 'coronation' });
    expect(foes(fight, 'coronation_fight').allies.map((a) => a.statBlockId)).toEqual(['knight']);
  });

  it('the Blightwood: Survival keeps the path (warned and sap-read advantage, dark disadvantage); a failure, a push or a wait meets the pack, whose trail is the way', () => {
    const c = ctx({ [`${L}paths_warned`]: true }, { scene: 'blightwood_paths', unlucky: true });
    expect(ids(c).filter((x) => x.startsWith('exit.'))).toEqual([]);
    c.state.time = 22 * 60;
    const r = perform(c, 'keep_path');
    expect(r.rolls[0]!.advantage).toContain("The Dawn Lance's warning about the paths");
    expect(r.rolls[0]!.disadvantage).toContain('The paths move after dark');
    expect(r.encounter).toBe('blightwood_pack');
    resolveEncounter(c, 'blightwood_pack', 'lose');
    expect(ids(c)).toContain('push_on');
    play(c, ['push_on']);
    expect(c.state.flags).toMatchObject({ [`${L}path_kept`]: true, [`${L}pack_done`]: true });
    expect(ids(c).filter((x) => x.startsWith('exit.'))).toHaveLength(1);

    // The forest moves after dark: a different trail by day and by night.
    const t = ctx({ [`${L}path_kept`]: true }, { scene: 'blightwood_paths' });
    t.state.time = 10 * 60;
    expect(ids(t)).toContain('exit.day_trail');
    t.state.time = 20 * 60;
    expect(ids(t)).toContain('exit.night_trail');
    expect(ids(t)).not.toContain('exit.day_trail');

    const wait = ctx({}, { scene: 'blightwood_paths' });
    expect(perform(wait, 'wait_light').encounter).toBe('blightwood_pack');
  });

  it('a stirring Maw (imported world) adds two ghouls to the pack', () => {
    const plain = ctx({}, { scene: 'blightwood_paths', party: ['brannoc', 'ilse', 'wren'] });
    expect(foes(plain, 'blightwood_pack').foes.some((x) => x.statBlockId === 'ghoul')).toBe(false);
    const stirring = ctx({ 'world.maw_state': 'stirring' }, { scene: 'blightwood_paths', party: ['brannoc', 'ilse', 'wren'] });
    expect(foes(stirring, 'blightwood_pack').foes.filter((x) => x.statBlockId === 'ghoul')).toHaveLength(2);
  });

  it('the foundry: two true stations cool the moulds; Brannoc speaks the rite without a roll; a failed station wakes the guardians, with a rematch', () => {
    const b = ctx({}, { scene: 'vaelthorn_foundry', party: ['brannoc'] });
    expect(ids(b)).not.toContain('stations.rite_alone');
    play(b, ['stations.rite']);
    expect(b.state.flags['world.brannoc_loyalty']).toBe(60);
    b.rng = new LuckyRng();
    play(b, ['stations.ledger']);
    expect(b.state.flags[`${L}moulds_cooled`]).toBe(true);
    expect(ids(b)).toEqual(expect.arrayContaining(['seal.compare', 'exit.to_coronation']));
    expect(ids(b)).not.toContain('storm_floor');

    const f = ctx({}, { scene: 'vaelthorn_foundry', unlucky: true });
    expect(perform(f, 'stations.arcane').encounter).toBe('foundry_guardians');
    resolveEncounter(f, 'foundry_guardians', 'lose');
    expect(ids(f)).not.toContain('exit.to_coronation');
    expect(ids(f).filter((x) => x.startsWith('stations.'))).toEqual([]);
    expect(perform(f, 'storm_floor').encounter).toBe('foundry_guardians');
    resolveEncounter(f, 'foundry_guardians', 'win');
    expect(ids(f)).toEqual(expect.arrayContaining(['seal.compare', 'exit.to_coronation']));
  });

  it('the coronation: naming Vexx needs three clues; the borrowed face is spent either way and sends the fanatics off; Gilt and Tallow fight only if earlier chapters left them', () => {
    expect(ids(ctx(CLUES(2), { scene: 'coronation' }))).not.toContain('name_vexx');
    expect(ids(ctx({ ...CLUES(1), [`${C}clue_6`]: true, [`${C}clue_4`]: true }, { scene: 'coronation' }))).toContain('name_vexx');

    const party = ['brannoc', 'ilse', 'wren'];
    const all = ctx({}, { scene: 'coronation', party });
    expect(foes(all, 'coronation_fight').foes.map((x) => x.statBlockId).sort()).toEqual(['cultist_fanatic', 'cultist_fanatic', 'doppelganger', 'spy']);
    const vexx = foes(all, 'coronation_fight').foes.find((x) => x.statBlockId === 'spy')!;
    expect(vexx.name).toBe('Ondra Vexx');
    expect(vexx.maxHp).toBe(Math.round(db.monsters.get('spy')!.hp * 1.5));

    const later = ctx({ [`${C}gilt_exposed`]: true, 'arc.crown.ch2_market_burned': true, [`${L}face_used`]: true }, { scene: 'coronation', party });
    const f = foes(later, 'coronation_fight').foes;
    expect(f.map((x) => x.statBlockId).sort()).toEqual(['night_hag', 'spy']);
    expect(f.find((x) => x.statBlockId === 'night_hag')!.name).toBe('Mother Tallow');

    const face = ctx({ [`${C}borrowed_face`]: true }, { scene: 'coronation', unlucky: true });
    expect(perform(face, 'wear_face').encounter).toBe('coronation_fight');
    expect(face.state.flags[`${C}borrowed_face`]).toBeUndefined();
    expect(ids(face)).not.toContain('wear_face');
    expect(face.state.flags[`${L}face_failed`]).toBe(true);
    expect(face.state.flags[`${L}face_used`]).toBeUndefined();

    const named = ctx(CLUES(3), { scene: 'coronation' });
    perform(named, 'name_vexx');
    expect(foes(named, 'coronation_fight').allies.map((a) => a.statBlockId)).toEqual(['guard', 'guard']);
  });

  it('losing or fleeing the coronation crowns the Face: only The False Coin is left, at level 5', () => {
    for (const how of ['lose', 'flee'] as const) {
      const c = ctx({ 'world.player_outlawed': true }, { scene: 'coronation' });
      const facts = play(c, ['storm'], how).join(' ');
      expect(getProgress(c.state)!.sceneId).toBe('epilogue_deepanvil');
      expect(c.state.flags).toMatchObject({ [`${C}crowned`]: true, [`${C}vexx_fate`]: 'escaped' });
      expect(c.state.hero.xp).toBeGreaterThanOrEqual(6500);
      expect(endsOffered(c)).toEqual(['end_false_coin']);
      expect(facts).toContain('a new crowned seal');
      // The false crown keeps the hero's name on the broadsheets.
      expect(c.state.flags['world.player_outlawed']).toBe(true);
      play(c, ['end_false_coin']);
      expect(getProgress(c.state)?.ending).toBe('ending_false_coin');
    }
  });

  it('after the fight: catch Vexx, then the court (unmasked), the blade (killed) or the bargain (scar + story condition, crown melted)', () => {
    const won = (party: string[] = []) => {
      const c = ctx({}, { scene: 'coronation', lucky: true, party });
      play(c, ['storm']);
      return c;
    };
    const court = won(['ilse']);
    expect(ids(court)).not.toContain('crown_destroy');
    expect(perform(court, 'catch_vexx').rolls[0]!.advantage).toContain("Ilse has dreamed Vexx's true face");
    play(court, ['vexx_court']);
    expect(court.state.flags[`${C}vexx_fate`]).toBe('unmasked');
    expect(ids(court)).toEqual(expect.arrayContaining(['crown_destroy', 'crown_hand', 'crown_keep']));

    const killed = won();
    play(killed, ['catch_vexx', 'vexx_kill']);
    expect(killed.state.flags[`${C}vexx_fate`]).toBe('killed');

    const bargain = won();
    play(bargain, ['catch_vexx', 'vexx_bargain']);
    expect(bargain.state.flags).toMatchObject({ [`${C}vexx_fate`]: 'bargained', 'world.hollow_crown': 'destroyed' });
    expect(bargain.state.hero.scars.at(-1)).toMatchObject({ description: 'a stranger in the mirror', location: 'left_cheek' });
    expect(JSON.stringify(bargain.state.hero.conditions)).toContain('frightened');
    expect(ids(bargain)).not.toContain('crown_keep');
    play(bargain, ['camp', 'exit.to_deepanvil']);
    expect(perform(bargain, 'read_thane').rolls[0]!.disadvantage).toContain('A stranger in the mirror');
    expect(endsOffered(bargain)).toEqual(['end_stranger']);
  });

  it('the crown: kept → The Hollow Keeper (even with Vexx unmasked); handed over with Vexx killed → True Weight; approvals follow the bible', () => {
    const keep = ctx({}, { scene: 'coronation', lucky: true, party: ['brannoc'] });
    play(keep, ['storm', 'catch_vexx', 'vexx_court', 'crown_keep', 'camp', 'exit.to_deepanvil']);
    expect(keep.state.flags['world.hollow_crown']).toBe('player');
    expect(keep.state.flags['world.brannoc_loyalty']).toBe(35);
    expect(endsOffered(keep)).toEqual(['end_hollow_keeper']);
    play(keep, ['end_hollow_keeper']);
    expect(getProgress(keep.state)?.ending).toBe('ending_hollow_king');

    const hand = ctx({}, { scene: 'coronation', lucky: true, party: ['ilse'] });
    const before = hand.state.flags['world.ilse_loyalty'] as number;
    play(hand, ['storm', 'catch_vexx', 'vexx_kill', 'crown_hand', 'camp', 'exit.to_deepanvil']);
    expect(hand.state.flags['world.ilse_loyalty']).toBe(before - 20);
    expect((hand.state.extensions.reputation as Record<string, number>).crown_of_aurelmark).toBe(20);
    expect(endsOffered(hand)).toEqual(['end_true_weight']);
  });

  it('an imported world: Corwin at Dawnspire, the Regent on the throne, the stirring Maw and the old defeats in the epilogue', () => {
    const imported: Flags = { 'world.queen_alive': false, 'world.maw_state': 'stirring', 'world.corwin_status': 'left', 'world.corwin_quest_done': true, 'world.times_defeated': 3, 'world.player_outlawed': true };
    const c = ctx(imported, { lucky: true });
    expect(npcsHere(c)).toContain('corwin_cameo');
    expect(npcsHere(ctx())).not.toContain('corwin_cameo');
    play(c, ['talk.corwin_cameo.old_road', 'dlg.greet.go']);
    expect(c.state.flags[`${L}corwin_met`]).toBe(true);
    c.adventure = { ...ADV, start: { ...ADV.start, scene: 'coronation' } };
    getProgress(c.state)!.sceneId = 'coronation';
    const facts = play(c, ['storm', 'catch_vexx', 'vexx_court', 'crown_destroy', 'camp', 'exit.to_deepanvil']).join(' ');
    for (const line of ['Regent rules on', 'voice that sang along', 'knocked down on the way', 'Ser Corwin hears your story', 'Your name is clean']) expect(facts, line).toContain(line);
    expect(facts).not.toContain('Queen Isolde');
    expect(endsOffered(c)).toEqual(['end_true_weight']);
    play(c, ['end_true_weight']);
    expect(getProgress(c.state)?.ending).toBe('ending_true_weight');
  });

  it('the five end actions are mutually exclusive for every fate × crown combination', () => {
    const fates = ['unmasked', 'killed', 'bargained', 'escaped'];
    const crowns = ['destroyed', 'crown', 'player'];
    for (const fate of fates)
      for (const crown of crowns) {
        const c = ctx({ [`${C}vexx_fate`]: fate, 'world.hollow_crown': crown }, { scene: 'epilogue_deepanvil' });
        expect(endsOffered(c), `${fate} ${crown}`).toHaveLength(1);
      }
    expect(endsOffered(ctx({ [`${C}crowned`]: true, [`${C}vexx_fate`]: 'escaped' }, { scene: 'epilogue_deepanvil' }))).toEqual(['end_false_coin']);
  });
});

describe('arc2_ch3_blightwood_mint: policy playthrough through the game host', () => {
  const nextChoice = ch3Choice;

  it('plays chapter 3 at level 4 through the game host with no errors to an ending', async () => {
    const tables = worldTables();
    const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
    const h = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, saves: new MemorySaves(), sessionPorts: { newSeed: () => 'arc2-ch3-smoke' } });
    const events: ServerEvent[] = [];
    h.on((e) => events.push(e));
    await h.send({ type: 'new_game', hero: level4(), mode: 'heroic', campaign: 'arc2_ch3_blightwood_mint' });
    await h.idle();
    const session = h.session;
    const lastSuggestions = () => [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.ending) break;
      if (activeFight(session.current)) {
        fights++;
        await h.send(combatStep(session, db));
        await h.idle();
        continue;
      }
      const offered = (lastSuggestions()?.actions ?? []).map((a) => a.id);
      const rests = ['rest_keep', 'bind_wounds', 'catch_breath'];
      const rest = session.current.hero.hp < session.current.hero.maxHp / 2 ? rests.find((r) => offered.includes(r)) : undefined;
      const choice = rest ?? nextChoice(p.sceneId, session.current.flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      await h.send({ type: 'choose', actionId: choice });
      await h.idle();
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0);
    const end = getProgress(session.current)!;
    expect(ENDINGS, `${end.sceneId} after ${fights} fight turns: ${session.current.log.slice(-40).map((l) => l.text).join(' | ')}`).toContain(end.ending);
    // Level 5 milestone (the coronation is won or lost, either way it pays).
    expect(session.current.hero.xp).toBeGreaterThanOrEqual(6500);
  }, 120_000);
});
