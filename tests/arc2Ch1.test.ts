/**
 * B005 — Hollow Crown chapter 1, "Faces in the Ledger" (data/adventures/arc2/ch1_faces.json,
 * DESIGN_ARC2 §5): validates against the SRD, the flag registry and the companion roster; uses the
 * bible's scene ids with a fogged vault map; the solver reaches the ending; the gate, the ledger
 * and the court each offer several approaches; the false auditor can be fought or named away; the
 * court hires or outlaws the hero; Ilse joins; and a policy plays the chapter through the game host.
 */
import { describe, expect, it } from 'vitest';
import ch1Json from '../data/adventures/arc2/ch1_faces.json';
import ch0Json from '../data/adventures/arc2/ch0_hollow_coin.json';
import flagsJson from '../data/adventures/flags.json';
import companionsJson from '../data/companions.json';
import { combatStep } from './helpers/combatPolicy';
import { ch1Choice } from './helpers/arc2Policy';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { availableActions, getProgress, npcsHere, perform as runnerPerform, resolveEncounter as runnerResolve, startAdventure, type RunContext, type StepResult } from '../src/engine/adventure/runner';
import type { Adventure, Outcome } from '../src/engine/adventure/schema';
import { scaleMonsters, xpBudget } from '../src/engine/adventure/encounters';
import { activeFight } from '../src/engine/adventure/fights';
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
  const r = validateAdventure(structuredClone(ch1Json), db, registry(), roster);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const C = 'arc.crown.';
const L = 'arc.crown.ch1_';
const L0 = 'arc.crown.ch0_';

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

function outcomes(x: unknown = ADV, out: Outcome[] = []): Outcome[] {
  if (Array.isArray(x)) for (const v of x) outcomes(v, out);
  else if (x && typeof x === 'object') {
    if (Array.isArray((x as Outcome).approval) && Array.isArray((x as Outcome).flags)) out.push(x as Outcome);
    for (const v of Object.values(x)) outcomes(v, out);
  }
  return out;
}

/** Always rolls 1 (every check fails). */
class UnluckyRng extends Rng {
  constructor() {
    super([1, 2, 3, 4]);
  }
  override int(min: number, max: number): number {
    return max === 20 ? 1 : super.int(min, max);
  }
}

const level2 = () => {
  const hero = buildCharacter({ ...toBuildInput(quickBuild('fighter', db, Rng.fromSeed('arc2ch1'))), level: 2 }, db);
  hero.xp = 300;
  return hero;
};

function ctx(flags: Flags = {}, opts: { scene?: string; lucky?: boolean; unlucky?: boolean; coins?: number; rep?: number } = {}): RunContext {
  const state = newGameState(level2(), 'heroic', 'arc2ch1', 'arc2_ch0_hollow_coin');
  if (opts.coins !== undefined) state.hero.coins = opts.coins;
  if (opts.rep !== undefined) state.extensions.reputation = { ironvault_consortium: opts.rep };
  Object.assign(state.flags, flags);
  const adventure = opts.scene ? { ...ADV, start: { ...ADV.start, scene: opts.scene } } : ADV;
  const c: RunContext = { state, adventure, rng: opts.lucky ? new LuckyRng() : opts.unlucky ? new UnluckyRng() : Rng.fromSeed(7), db, flags: registry() };
  startAdventure(c);
  return c;
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
/** Performs a scripted path, resolving every fight the given way. */
function play(c: RunContext, path: string[], how: 'win' | 'lose' | 'flee' = 'win'): void {
  for (const id of path) {
    let r = perform(c, id);
    for (let g = 0; r.encounter && g < 5; g++) r = resolveEncounter(c, r.encounter, how);
  }
}
const rep = (c: RunContext) => (c.state.extensions.reputation as Record<string, number> | undefined)?.ironvault_consortium ?? 0;

describe('arc2_ch1_faces: data', () => {
  it('validates with no errors or warnings and follows chapter 0', () => {
    const r = validateAdventure(structuredClone(ch1Json), db, registry(), roster);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'arc2_ch1_faces', arcId: 'crown', kind: 'arc', levelRange: [2, 3], regionId: 'aurelmark' });
    expect(ch0Json.endings[0]!.next).toBe(ADV.id);
    expect(ADV.endings).toEqual([expect.objectContaining({ id: 'ch1_to_fennicks', next: 'arc2_ch2_gamblers_tide' })]);
  });

  it('uses the bible scene ids at their lore locations, with a fogged dungeon map for the vault', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'arc2_ch1_faces');
    const scenes = allScenes(ADV);
    expect(scenes).toHaveLength(6);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(scenes).toHaveLength(design.length);
    expect(scenes.find((s) => s.id === 'vault_audit')!.map).toEqual({ id: 'third_vault', room: 'vault_stair' });
    expect(ADV.maps.map((m) => m.id)).toEqual(['third_vault']);
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
    for (const id of [`${C}clue_3`, `${C}clue_4`, `${C}gilt_exposed`, `${C}gilt_fled`, 'world.player_outlawed', 'world.ilse_status']) expect(written.has(id), id).toBe(true);
    // Chapter 0's letter and die are read here.
    expect([...reads]).toEqual(expect.arrayContaining([`${L0}dunmore_letter`, `${L0}die_kept`]));
  });

  it('encounters follow the bible (armor ×2; doppelganger + guards ×2) with the doppelganger kept as boss', () => {
    const counts = (id: string) => ADV.encounters.find((e) => e.id === id)!.monsters.reduce<Record<string, number>>((o, m) => ({ ...o, [m.id]: (o[m.id] ?? 0) + m.count }), {});
    expect(counts('vault_guardians')).toEqual({ animated_armor: 2 });
    expect(counts('gilt_fight')).toEqual({ doppelganger: 1, guard: 2 });
    const tables = db.tables!;
    for (const e of ADV.encounters) {
      expect(e.scaling, e.id).toBeDefined();
      const solo = scaleMonsters(e.monsters, [2], db, tables, { pool: e.scaling?.pool ?? [], bossIds: e.bosses });
      if (e.id === 'gilt_fight') expect(solo.find((m) => m.id === 'doppelganger')?.count).toBe(1);
      else expect(solo.reduce((s, m) => s + db.monsters.get(m.id)!.xp * m.count, 0)).toBeLessThanOrEqual(xpBudget([2], 'high', tables));
    }
  });

  it('Ilse joins only through recruit outcomes; approvals use the ±5/±10 scale', () => {
    const all = outcomes();
    expect(all.filter((o) => o.recruit).map((o) => o.recruit)).toEqual(['ilse', 'ilse', 'ilse']);
    for (const d of all.flatMap((o) => o.approval)) {
      expect(['brannoc', 'ilse']).toContain(d.companion);
      expect([5, 10, -5, -10]).toContain(d.delta);
    }
  });
});

describe('arc2_ch1_faces: reachability', () => {
  it('the solver reaches the ending from the start', () => {
    const c = ctx();
    const res = solveAdventure({ state: newGameState(c.state.hero, 'heroic', 'solve', ADV.id), adventure: ADV, db, flags: registry() }, 'ch1_to_fennicks', { depth: 40, nodes: 30000 });
    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it('a scripted path by the book unmasks Gilt in a fight, wins the commission, recruits Ilse and reaches level 3 XP', () => {
    const c = ctx({ [`${L0}dunmore_letter`]: true, [`${C}clue_1`]: true }, { lucky: true });
    play(c, [
      'talk.warden_brekka.papers',
      'dlg.greet.letter',
      'dlg.letter.in',
      'exit.to_counting_house',
      'hesk_desk.portrait',
      'talk.false_hesk.audit',
      'dlg.greet.family',
      'dlg.daughter.back',
      'dlg.greet.by_book',
      'dlg.audit_granted.thanks',
      'exit.to_vault',
      'watchword',
      'hollow_tenth.weigh_bars',
      'ledger_alcove.read_ledger',
      'exit.to_confront',
      'show_guards',
      'unmask',
      'talk.thane_orsa.verdict',
      'dlg.greet.body',
      'dlg.hired.accept',
      'talk.ilse_npc.dreams',
      'dlg.greet.share',
      'dlg.joined.back',
      'exit.to_rest',
      'long_rest',
      'ilse_dream',
      'road_board.road_south',
    ]);
    expect(getProgress(c.state)?.ending).toBe('ch1_to_fennicks');
    expect(c.state.flags).toMatchObject({
      [`${C}clue_3`]: true,
      [`${C}clue_4`]: true,
      [`${C}gilt_exposed`]: true,
      [`${L}commission`]: true,
      'world.ilse_status': 'in_party',
      'world.ilse_loyalty': 65,
    });
    expect(c.state.flags['world.player_outlawed']).toBeUndefined();
    expect(c.state.flags[`${C}gilt_fled`]).toBeUndefined();
    expect(rep(c)).toBeGreaterThanOrEqual(20);
    // 300 from chapter 0 + ledger/watchword + the 600 rest milestone: level 3 (900), short of level 4 (2700).
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(900);
    expect(c.state.hero.xp).toBeLessThan(2700);
  });
});

describe('arc2_ch1_faces: approaches and consequences', () => {
  it('the gate: letter, persuasion, deception, toll, or a shift of honest work', () => {
    const npc = ADV.npcs.find((n) => n.id === 'warden_brekka')!;
    const opts = npc.conversations[0]!.nodes.find((n) => n.id === 'greet')!.options.map((o) => o.id);
    expect(opts).toEqual(['letter', 'persuade', 'deceive', 'pay', 'pay_outlaw', 'bye']);
    // No letter, no coin, every roll fails: hauling ore still gets the hero in.
    const u = ctx({}, { unlucky: true, coins: 0 });
    play(u, ['talk.warden_brekka.papers', 'dlg.greet.persuade', 'dlg.greet.deceive']);
    expect(ids(u)).not.toContain('exit.to_counting_house');
    play(u, ['dlg.greet.bye', 'ore_line.haul_ore']);
    expect(ids(u)).toContain('exit.to_counting_house');
    // An outlaw pays double.
    const o = ctx({ 'world.player_outlawed': true }, { coins: 2000 });
    play(o, ['talk.warden_brekka.papers']);
    expect(ids(o)).toContain('dlg.greet.pay_outlaw');
    expect(ids(o)).not.toContain('dlg.greet.pay');
    play(o, ['dlg.greet.pay_outlaw']);
    expect(o.state.hero.coins).toBe(1000);
  });

  it('the vault: by the book, a bribe, a night break-in, Ironvault standing, or a supervised audit after a failed citation', () => {
    const b = ctx({}, { scene: 'counting_house', coins: 1500 });
    play(b, ['talk.false_hesk.audit', 'dlg.greet.bribe']);
    expect(b.state.hero.coins).toBe(500);
    expect(b.state.flags[`${L}vault_access`]).toBe(true);

    const n = ctx({}, { scene: 'counting_house', lucky: true });
    play(n, ['vault_stair.break_in']);
    expect(n.state.flags).toMatchObject({ [`${L}vault_access`]: true, [`${L}broke_in`]: true });

    const s = ctx({}, { scene: 'counting_house', rep: 50 });
    expect(ids(s)).toContain('vault_stair.standing');
    expect(ids(ctx({}, { scene: 'counting_house' }))).not.toContain('vault_stair.standing');

    const f = ctx({}, { scene: 'counting_house', unlucky: true });
    play(f, ['talk.false_hesk.audit', 'dlg.greet.by_book', 'dlg.audit_later.thanks']);
    expect(ids(f)).not.toContain('exit.to_vault');
    const before = f.state.time;
    play(f, ['supervised_audit']);
    expect(f.state.time - before).toBeGreaterThanOrEqual(900);
    expect(ids(f)).toContain('exit.to_vault');
  });

  it('an imported world with the money trail proven hands over clue 4 without the vault', () => {
    const c = ctx({ 'arc.main.money_trail_proven': true }, { scene: 'counting_house' });
    play(c, ['almonry_file']);
    expect(c.state.flags).toMatchObject({ [`${C}clue_4`]: true, [`${L}ledger_found`]: true });
    expect(ids(c)).toContain('exit.to_confront');
    expect(ids(ctx({}, { scene: 'counting_house' }))).not.toContain('almonry_file');
  });

  it('the guardians: a failed watchword starts the fight; losing it wakes the hero upstairs with a rematch', () => {
    const c = ctx({ [`${L}vault_access`]: true }, { scene: 'vault_audit', unlucky: true });
    expect(perform(c, 'watchword').encounter).toBe('vault_guardians');
    resolveEncounter(c, 'vault_guardians', 'lose');
    expect(getProgress(c.state)!.sceneId).toBe('counting_house');
    play(c, ['exit.to_vault']);
    expect(ids(c)).toContain('advance');
    expect(ids(c)).not.toContain('ledger_alcove.read_ledger');
  });

  it('Brannoc finds his father\'s mark in the hollow tenth only when he is in the party', () => {
    const c = ctx({ [`${L}guardians_done`]: true }, { scene: 'vault_audit' });
    expect(ids(c)).not.toContain('hollow_tenth.fathers_seal');
    recruitCompanion(c.state, roster.companions.find((d) => d.id === 'brannoc')!, db);
    expect(ids(c)).toContain('hollow_tenth.fathers_seal');
    play(c, ['hollow_tenth.fathers_seal']);
    expect(c.state.flags['world.brannoc_loyalty']).toBe(60);
  });

  it('Gilt: naming the daughter makes it flee without a fight; convinced guards fight beside the hero', () => {
    const named = ctx({ [`${C}clue_3`]: true, [`${L}ledger_found`]: true }, { scene: 'hesk_unmasked' });
    const r = perform(named, 'name_daughter');
    expect(r.encounter).toBeUndefined();
    expect(named.state.flags).toMatchObject({ [`${C}gilt_fled`]: true, [`${L}hesk_done`]: true });
    expect(named.state.flags[`${C}gilt_exposed`]).toBeUndefined();
    expect(ids(named)).toContain('exit.to_court');
    expect(ids(ctx({ [`${L}ledger_found`]: true }, { scene: 'hesk_unmasked' }))).not.toContain('name_daughter');

    const gilt = ADV.encounters.find((e) => e.id === 'gilt_fight')!;
    expect(gilt.monsters.find((m) => m.id === 'guard')!.if).toEqual({ not: { flag: `${L}guards_convinced` } });
    expect(gilt.allies).toEqual([{ id: 'guard', count: 2, if: { flag: `${L}guards_convinced` } }]);

    const lost = ctx({ [`${L}ledger_found`]: true }, { scene: 'hesk_unmasked' });
    play(lost, ['unmask'], 'lose');
    expect(getProgress(lost.state)!.sceneId).toBe('ironvault_court');
    expect(lost.state.flags[`${C}gilt_fled`]).toBe(true);
  });

  it('the court: proof wins the commission; a failed plea or defiance outlaws the hero', () => {
    const hired = ctx({ [`${C}gilt_exposed`]: true }, { scene: 'ironvault_court' });
    play(hired, ['talk.thane_orsa.verdict', 'dlg.greet.body']);
    expect(hired.state.flags[`${L}commission`]).toBe(true);
    expect(rep(hired)).toBe(15);

    const ledger = ctx({ [`${C}clue_4`]: true, [`${C}gilt_fled`]: true, [`${L0}die_kept`]: true }, { scene: 'ironvault_court' });
    play(ledger, ['talk.thane_orsa.verdict']);
    expect(ids(ledger)).not.toContain('dlg.greet.body');
    const roll = perform(ledger, 'dlg.greet.ledger').rolls[0]!;
    expect(roll.advantage).toEqual(expect.arrayContaining(['The false die from Brightwater', 'Forty clerks saw the auditor\'s face run']));

    const plea = ctx({}, { scene: 'ironvault_court', unlucky: true });
    play(plea, ['talk.thane_orsa.verdict', 'dlg.greet.plead']);
    expect(plea.state.flags).toMatchObject({ 'world.player_outlawed': true, [`${L}blamed`]: true, [`${L}verdict`]: true });
    expect(rep(plea)).toBe(-10);

    const defy = ctx({}, { scene: 'ironvault_court' });
    play(defy, ['talk.thane_orsa.verdict', 'dlg.greet.defy', 'dlg.blamed.accept']);
    expect(defy.state.flags['world.player_outlawed']).toBe(true);
    expect(ids(defy)).toContain('exit.to_rest');
  });

  it('Ilse: met on arrival; shared clues, persuasion or reading her dreams recruit her; a failed plea leaves her at court', () => {
    const s = ctx({ [`${C}clue_1`]: true, [`${C}clue_2`]: true }, { scene: 'ironvault_court' });
    expect(s.state.flags['world.ilse_status']).toBe('met');
    expect(npcsHere(s)).toContain('ilse_npc');
    play(s, ['talk.ilse_npc.dreams', 'dlg.greet.share']);
    expect(s.state.flags).toMatchObject({ 'world.ilse_status': 'in_party', 'world.ilse_loyalty': 60 });
    expect(npcsHere(s)).not.toContain('ilse_npc');

    const one = ctx({ [`${C}clue_1`]: true }, { scene: 'ironvault_court' });
    play(one, ['talk.ilse_npc.dreams']);
    expect(ids(one)).not.toContain('dlg.greet.share');

    const r = ctx({}, { scene: 'ironvault_court', lucky: true });
    play(r, ['talk.ilse_npc.dreams', 'dlg.greet.read']);
    expect(r.state.flags['world.ilse_status']).toBe('in_party');

    const u = ctx({}, { scene: 'ironvault_court', unlucky: true });
    play(u, ['talk.ilse_npc.dreams', 'dlg.greet.persuade', 'dlg.duty.back']);
    expect(u.state.flags).toMatchObject({ 'world.ilse_status': 'met', [`${L}ilse_declined`]: true });
  });
});

describe('arc2_ch1_faces: policy playthrough through the game host', () => {
  const nextChoice = ch1Choice;

  it('plays chapter 1 at level 2 through the game host with no errors to the road to Fennick\'s Rest', async () => {
    const tables = worldTables();
    const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
    const h = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, saves: new MemorySaves(), sessionPorts: { newSeed: () => 'arc2-ch1-smoke' } });
    const events: ServerEvent[] = [];
    h.on((e) => events.push(e));
    await h.send({ type: 'new_game', hero: level2(), mode: 'heroic', campaign: 'arc2_ch1_faces' });
    await h.idle();
    const session = h.session;
    const lastSuggestions = () => [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    let ilseAsked = false;
    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.ending || p.adventureId !== 'arc2_ch1_faces') break;
      if (activeFight(session.current)) {
        fights++;
        await h.send(combatStep(session, db));
        await h.idle();
        continue;
      }
      const offered = (lastSuggestions()?.actions ?? []).map((a) => a.id);
      const hurt = session.current.hero.hp < session.current.hero.maxHp / 2 && offered.includes('rest_lodging');
      const flags = { ...session.current.flags, ...(ilseAsked ? { [`${L}ilse_asked`]: true } : {}) };
      const choice = hurt ? 'rest_lodging' : nextChoice(p.sceneId, flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      if (choice === 'talk.ilse_npc.dreams') ilseAsked = true;
      await h.send({ type: 'choose', actionId: choice });
      await h.idle();
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0);
    // The ending chained straight into chapter 2 (B006).
    expect(getProgress(session.current)!.adventureId).toBe('arc2_ch2_gamblers_tide');
    expect(session.current.flags).toMatchObject({ [`${C}clue_4`]: true, [`${L}verdict`]: true, [`${L}rested`]: true });
    // Level 3 milestone.
    expect(session.current.hero.xp).toBeGreaterThanOrEqual(900);
  }, 120_000);
});
