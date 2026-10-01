/**
 * B004 — Hollow Crown chapter 0, "The Hollow Coin" (data/adventures/arc2/ch0_hollow_coin.json,
 * DESIGN_ARC2 §4): validates against the SRD, the flag registry and the companion roster; uses the
 * bible's scene ids; every flag it writes is registered or documented; the solver reaches the
 * ending; Dunmore's conversation offers several approaches; the mint deadline, the wererat choice and
 * the Brannoc recruit work; and a policy plays the chapter through the game host with real fights.
 */
import { describe, expect, it } from 'vitest';
import ch0Json from '../data/adventures/arc2/ch0_hollow_coin.json';
import flagsJson from '../data/adventures/flags.json';
import companionsJson from '../data/companions.json';
import { combatStep } from './helpers/combatPolicy';
import { ch0Choice } from './helpers/arc2Policy';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { availableActions, describeScene, getProgress, npcsHere, perform as runnerPerform, resolveEncounter as runnerResolve, startAdventure, type RunContext, type StepResult } from '../src/engine/adventure/runner';
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
import { CAMPAIGNS } from '../src/host/campaigns';
import type { ServerEvent } from '../src/shared/protocol';

const db = loadSrd();
const registry = () => FlagRegistry.fromJson(flagsJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const chapter = (): Adventure => {
  const r = validateAdventure(structuredClone(ch0Json), db, registry(), roster);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const C = 'arc.crown.';
const L = 'arc.crown.ch0_';

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

function ctx(flags: Flags = {}, opts: { scene?: string; lucky?: boolean; unlucky?: boolean; coins?: number } = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('arc2ch0'))), db);
  const state = newGameState(hero, 'heroic', 'arc2ch0', 'arc2_ch0_hollow_coin');
  if (opts.coins !== undefined) state.hero.coins = opts.coins;
  Object.assign(state.flags, flags);
  const adventure = opts.scene ? { ...ADV, start: { ...ADV.start, scene: opts.scene } } : ADV;
  const c: RunContext = { state, adventure, rng: opts.lucky ? new LuckyRng() : opts.unlucky ? new UnluckyRng() : Rng.fromSeed(7), db, flags: registry() };
  startAdventure(c);
  return c;
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
/** Performs a scripted path, winning every fight. */
function play(c: RunContext, path: string[]): void {
  for (const id of path) {
    let r = perform(c, id);
    for (let g = 0; r.encounter && g < 5; g++) r = resolveEncounter(c, r.encounter, 'win');
  }
}

describe('arc2_ch0_hollow_coin: data', () => {
  it('validates with no errors or warnings and is the Hollow Crown campaign start', () => {
    const r = validateAdventure(structuredClone(ch0Json), db, registry(), roster);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'arc2_ch0_hollow_coin', arcId: 'crown', kind: 'arc', levelRange: [1, 2], regionId: 'aurelmark' });
    expect(CAMPAIGNS.find((c) => c.id === 'hollow_crown')).toMatchObject({ adventure: ADV.id, playable: true });
    expect(ADV.endings).toEqual([expect.objectContaining({ id: 'ch0_to_deepanvil', next: 'arc2_ch1_faces' })]);
  });

  it('uses the bible scene ids at their lore locations, with a fogged dungeon map for the cellars', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'arc2_ch0_hollow_coin');
    const scenes = allScenes(ADV);
    expect(scenes).toHaveLength(6);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(scenes).toHaveLength(design.length);
    expect(scenes.find((s) => s.id === 'mill_cellars')!.map).toEqual({ id: 'mill_cellars', room: 'race_tunnel' });
    expect(ADV.maps.map((m) => m.id)).toEqual(['mill_cellars']);
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
    for (const id of ['saw_ash', 'clue_1', 'clue_2', 'mint_fled', 'courier_known']) expect(written.has(`${C}${id}`), id).toBe(true);
  });

  it('encounters follow the bible (rats ×4; wererat + bandits ×2) with the wererat kept as boss', () => {
    const counts = (id: string) => ADV.encounters.find((e) => e.id === id)!.monsters.reduce<Record<string, number>>((o, m) => ({ ...o, [m.id]: (o[m.id] ?? 0) + m.count }), {});
    expect(counts('cellar_rats')).toEqual({ giant_rat: 4 });
    expect(counts('mint_fight')).toEqual({ wererat: 1, bandit: 2 });
    expect(counts('mint_fight_silver')).toEqual({ wererat: 1, bandit: 2 });
    // Silver matters: the silvered fight's wererat is weaker.
    const hp = (id: string) => ADV.encounters.find((e) => e.id === id)!.statOverrides.wererat!.hpPercent!;
    expect(hp('mint_fight_silver')).toBeLessThan(hp('mint_fight'));
    const tables = db.tables!;
    for (const e of ADV.encounters) {
      if (e.monsters.reduce((s, m) => s + m.count, 0) >= 2) expect(e.scaling, e.id).toBeDefined();
      const solo = scaleMonsters(e.monsters, [1], db, tables, { pool: e.scaling?.pool ?? [], bossIds: e.bosses });
      if (e.id.startsWith('mint')) expect(solo.find((m) => m.id === 'wererat')?.count, e.id).toBe(1);
      else expect(solo.reduce((s, m) => s + db.monsters.get(m.id)!.xp * m.count, 0)).toBeLessThanOrEqual(xpBudget([1], 'high', tables));
    }
  });

  it('Brannoc joins only through recruit outcomes; approvals use the ±5/±10 scale', () => {
    const all = outcomes();
    expect(all.filter((o) => o.recruit).map((o) => o.recruit)).toEqual(['brannoc', 'brannoc', 'brannoc']);
    for (const d of all.flatMap((o) => o.approval)) {
      expect(d.companion).toBe('brannoc');
      expect([5, 10, -5, -10]).toContain(d.delta);
    }
  });
});

describe('arc2_ch0_hollow_coin: reachability', () => {
  it('the solver reaches the ending from the start', () => {
    const c = ctx();
    const res = solveAdventure({ state: newGameState(c.state.hero, 'heroic', 'solve', ADV.id), adventure: ADV, db, flags: registry() }, 'ch0_to_deepanvil', { depth: 40, nodes: 30000 });
    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it('a scripted honest path finds both clues, recruits Brannoc by oath and reaches level 2 XP', () => {
    const c = ctx({}, { lucky: true, coins: 2000 });
    play(c, [
      'moneychanger.change_coin',
      'exit.to_assay',
      'talk.mistress_dunmore.assay',
      'dlg.greet.honest',
      'dlg.test.to_bench',
      'assay_bench.assay_eye',
      'ask_letter',
      'exit.to_market',
      'forge.silver_blade',
      'mill_race_gate.unlock_gate',
      'exit.to_cellars',
      'push_on',
      'storm_mint_silver',
      'free_clerk',
      'search_mint',
      'presses.smash_dies',
      'hand_to_reeve',
      'exit.to_market',
      'exit.to_shrine',
      'talk.brannoc_npc.scales',
      'dlg.greet.oath',
      'dlg.joined.back',
      'scales.kneel_scales',
      'exit.to_road',
      'walk_east',
    ]);
    expect(getProgress(c.state)?.ending).toBe('ch0_to_deepanvil');
    expect(c.state.companions.map((x) => x.id)).toEqual(['brannoc']);
    expect(c.state.flags).toMatchObject({
      [`${C}saw_ash`]: true,
      [`${C}clue_1`]: true,
      [`${C}clue_2`]: true,
      [`${L}dunmore_letter`]: true,
      [`${L}rat_handed`]: true,
      'world.brannoc_status': 'in_party',
      // Recruited at 50, the oath +10; the clerk/reeve/dies approvals came before he joined and do not count.
      'world.brannoc_loyalty': 60,
    });
    // The oath's 250 XP (the runner does not award fight XP; the session does).
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(250);
  });
});

describe('arc2_ch0_hollow_coin: approaches and consequences', () => {
  it('Mistress Dunmore has at least 3 approaches that do something, and the bench offers two skills', () => {
    const npc = ADV.npcs.find((n) => n.id === 'mistress_dunmore')!;
    const approaches = npc.conversations[0]!.nodes.find((n) => n.id === 'greet')!.options.filter((o) => o.check || [o.outcome].some((x) => x && (x.flags.length || x.cost)));
    expect(approaches.map((o) => o.id)).toEqual(['honest', 'bribe', 'read_fear', 'lean']);
    const c = ctx({ [`${C}saw_ash`]: true }, { scene: 'assay_house' });
    play(c, ['talk.mistress_dunmore.assay', 'dlg.greet.honest', 'dlg.test.to_bench']);
    expect(ids(c)).toEqual(expect.arrayContaining(['assay_bench.assay_eye', 'assay_bench.assay_spell']));
    expect(perform(c, 'assay_bench.assay_eye').rolls[0]!.advantage).toContain('Mistress Dunmore guides your hand');
  });

  it('a bribe costs coin and no key; insight learns her fear (and opens the bluff); a threat costs the letter', () => {
    const b = ctx({ [`${C}saw_ash`]: true }, { scene: 'assay_house', coins: 500 });
    play(b, ['talk.mistress_dunmore.assay', 'dlg.greet.bribe', 'dlg.paid.to_bench']);
    expect(b.state.hero.coins).toBe(300);
    expect(b.state.flags).toMatchObject({ [`${L}dunmore_paid`]: true, [`${L}bench_ready`]: true });
    expect(b.state.flags[`${L}mill_key`]).toBeUndefined();

    const f = ctx({ [`${C}saw_ash`]: true }, { scene: 'assay_house', lucky: true });
    play(f, ['talk.mistress_dunmore.assay', 'dlg.greet.read_fear', 'dlg.fear.take_key']);
    expect(f.state.flags).toMatchObject({ [`${L}dunmore_fear`]: true, [`${L}mill_key`]: true });
    const mint = ctx({ [`${L}dunmore_fear`]: true, [`${L}at_mint`]: true }, { scene: 'mill_cellars' });
    expect(ids(mint)).toEqual(expect.arrayContaining(['storm_mint', 'bluff_mint']));

    const t = ctx({ [`${C}saw_ash`]: true }, { scene: 'assay_house', lucky: true });
    play(t, ['talk.mistress_dunmore.assay', 'dlg.greet.lean', 'dlg.cowed.to_bench', 'assay_bench.assay_spell']);
    expect(t.state.flags).toMatchObject({ [`${L}dunmore_cowed`]: true, [`${C}clue_1`]: true });
    expect(ids(t)).not.toContain('ask_letter');
  });

  it('a won bluff sends the bandits running: Skeet fights alone', () => {
    const c = ctx({ [`${L}dunmore_fear`]: true, [`${L}at_mint`]: true }, { scene: 'mill_cellars', lucky: true });
    expect(perform(c, 'bluff_mint').encounter).toBe('mint_fight_bluffed');
    expect(ADV.encounters.find((e) => e.id === 'mint_fight_bluffed')!.monsters).toEqual([{ id: 'wererat', count: 1 }]);
  });

  it('the mint moves two days after the coin crumbles unless the hero reaches it; the clerk still gives clue 2', () => {
    const c = ctx();
    perform(c, 'moneychanger.change_coin');
    c.state.time += 2 * 24 * 60 + 10;
    perform(c, 'weir_stall.ask_hetty');
    expect(c.state.flags[`${C}mint_fled`]).toBe(true);
    Object.assign(c.state.flags, { [`${L}gate_open`]: true });
    play(c, ['exit.to_cellars', 'push_on']);
    expect(ids(c)).not.toContain('storm_mint');
    play(c, ['search_empty_mint']);
    expect(getProgress(c.state)!.sceneId).toBe('wererat_den_rest');
    expect(npcsHere(c)).toEqual(['clerk_aldous']);
    expect(ids(c)).not.toContain('hand_to_reeve');
    play(c, ['free_clerk']);
    expect(c.state.flags[`${C}clue_2`]).toBe(true);
    expect(describeScene(c).seed).toContain('left in a hurry');
  });

  it('reaching the mint in time meets the deadline', () => {
    const c = ctx({ [`${L}gate_open`]: true });
    play(c, ['moneychanger.change_coin', 'exit.to_cellars', 'push_on']);
    c.state.time += 3 * 24 * 60;
    perform(c, 'exit.to_market');
    expect(c.state.flags[`${C}mint_fled`]).toBeUndefined();
  });

  it('Skeet: the reeve (reputation), freedom for the courier\'s name, or a threat that gets both', () => {
    const won = { [`${L}mint_won`]: true, [`${L}rat_captured`]: true };
    const h = ctx(won, { scene: 'wererat_den_rest' });
    expect(npcsHere(h)).toEqual(expect.arrayContaining(['clerk_aldous', 'skeet']));
    play(h, ['hand_to_reeve']);
    expect(h.state.extensions.reputation).toMatchObject({ crown_of_aurelmark: expect.any(Number) });
    expect(ids(h)).not.toContain('let_go');
    expect(npcsHere(h)).not.toContain('skeet');

    const g = ctx(won, { scene: 'wererat_den_rest' });
    play(g, ['let_go']);
    expect(g.state.flags).toMatchObject({ [`${C}clue_2`]: true, [`${C}courier_known`]: true, [`${L}rat_freed`]: true });
    expect(ids(g)).not.toContain('hand_to_reeve');

    const q = ctx(won, { scene: 'wererat_den_rest', lucky: true });
    play(q, ['question_rat', 'hand_to_reeve']);
    expect(q.state.flags).toMatchObject({ [`${C}courier_known`]: true, [`${L}rat_handed`]: true });
  });

  it('Brannoc: persuaded early, bought (lower loyalty), or put off until the mint is found', () => {
    const p = ctx({}, { scene: 'korrath_shrine_oath', lucky: true });
    expect(p.state.flags['world.brannoc_status']).toBe('met');
    play(p, ['talk.brannoc_npc.scales', 'dlg.greet.persuade']);
    expect(p.state.flags).toMatchObject({ 'world.brannoc_status': 'in_party', 'world.brannoc_loyalty': 50 });
    expect(npcsHere(p)).not.toContain('brannoc_npc');

    const d = ctx({}, { scene: 'korrath_shrine_oath', coins: 500 });
    play(d, ['talk.brannoc_npc.scales', 'dlg.greet.donate']);
    expect(d.state.flags).toMatchObject({ 'world.brannoc_status': 'in_party', 'world.brannoc_loyalty': 40 });

    const u = ctx({}, { scene: 'korrath_shrine_oath', unlucky: true });
    play(u, ['talk.brannoc_npc.scales', 'dlg.greet.persuade', 'dlg.prove.back']);
    expect(u.state.flags[`${L}brannoc_waits`]).toBe(true);
    play(u, ['talk.brannoc_npc.scales']);
    expect(ids(u)).not.toContain('dlg.greet.persuade');
    expect(ids(u)).not.toContain('dlg.greet.oath');
    expect(ids(u)).not.toContain('scales.kneel_scales');
  });
});

describe('arc2_ch0_hollow_coin: policy playthrough through the game host', () => {
  const nextChoice = ch0Choice;

  it('plays from the campaign picker to the road to Deepanvil with real fights and no errors', async () => {
    const tables = worldTables();
    const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
    const h = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, saves: new MemorySaves(), sessionPorts: { newSeed: () => 'arc2-ch0-smoke' } });
    const events: ServerEvent[] = [];
    h.on((e) => events.push(e));
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('arc2-smoke'))), db);
    await h.send({ type: 'new_game', hero, mode: 'heroic', campaign: 'arc2_ch0_hollow_coin' });
    await h.idle();
    const session = h.session;
    const lastSuggestions = () => [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.ending || p.adventureId !== 'arc2_ch0_hollow_coin') break;
      if (activeFight(session.current)) {
        fights++;
        await h.send(combatStep(session, db));
        await h.idle();
        continue;
      }
      const offered = (lastSuggestions()?.actions ?? []).map((a) => a.id);
      // A lost fight leaves the hero at 1 HP: sleep at the inn before trying again.
      const hurt = session.current.hero.hp < session.current.hero.maxHp / 2 && offered.includes('rest_inn');
      const choice = hurt ? 'rest_inn' : nextChoice(p.sceneId, session.current.flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      await h.send({ type: 'choose', actionId: choice });
      await h.idle();
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0);
    // The ending chained straight into chapter 1 (B005).
    expect(getProgress(session.current)!.adventureId).toBe('arc2_ch1_faces');
    expect(session.current.campaign).toBe('arc2_ch0_hollow_coin');
    expect(session.current.flags).toMatchObject({ [`${C}saw_ash`]: true, 'world.brannoc_status': 'in_party' });
    // Level 2 milestone: fight XP plus the oath.
    expect(session.current.hero.xp).toBeGreaterThanOrEqual(300);
  }, 120_000);
});
