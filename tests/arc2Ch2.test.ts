/**
 * B006 — Hollow Crown chapter 2, "The Gambler's Tide" (data/adventures/arc2/ch2_gamblers_tide.json,
 * DESIGN_ARC2 §6): validates against the SRD, the flag registry and the companion roster; uses the
 * bible's scene ids with a ship-deck map and fogged sea caves; the solver reaches the ending; the dice
 * game is a check sequence; Salt can be bought, threatened, tricked or fought; the reef run reads the
 * weather; the stash sends the Red Gull a bill; Tallow's market can be bought from (memory scar + story
 * condition), bargained with or burned; Wren joins; and a policy plays the chapter through the game host.
 */
import { describe, expect, it } from 'vitest';
import ch2Json from '../data/adventures/arc2/ch2_gamblers_tide.json';
import ch1Json from '../data/adventures/arc2/ch1_faces.json';
import flagsJson from '../data/adventures/flags.json';
import companionsJson from '../data/companions.json';
import { combatStep } from './helpers/combatPolicy';
import { ch2Choice } from './helpers/arc2Policy';
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
  const r = validateAdventure(structuredClone(ch2Json), db, registry(), roster);
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const C = 'arc.crown.';
const L = 'arc.crown.ch2_';

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

const level3 = () => {
  const hero = buildCharacter({ ...toBuildInput(quickBuild('fighter', db, Rng.fromSeed('arc2ch2'))), level: 3, subclassId: 'champion' }, db);
  hero.xp = 900;
  return hero;
};

function ctx(flags: Flags = {}, opts: { scene?: string; lucky?: boolean; unlucky?: boolean; coins?: number; rep?: number; weather?: string } = {}): RunContext {
  const state = newGameState(level3(), 'heroic', 'arc2ch2', 'arc2_ch0_hollow_coin');
  if (opts.coins !== undefined) state.hero.coins = opts.coins;
  if (opts.rep !== undefined) state.extensions.reputation = { red_gull_brotherhood: opts.rep };
  if (opts.weather) state.extensions.weather = { kind: opts.weather };
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
const rep = (c: RunContext) => (c.state.extensions.reputation as Record<string, number> | undefined)?.red_gull_brotherhood ?? 0;
const wren = () => roster.companions.find((d) => d.id === 'wren')!;

describe('arc2_ch2_gamblers_tide: data', () => {
  it('validates with no errors or warnings and follows chapter 1', () => {
    const r = validateAdventure(structuredClone(ch2Json), db, registry(), roster);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'arc2_ch2_gamblers_tide', arcId: 'crown', kind: 'arc', levelRange: [3, 4], regionId: 'brinescatter_isles' });
    expect(ch1Json.endings[0]!.next).toBe(ADV.id);
    expect(ADV.endings).toEqual([expect.objectContaining({ id: 'ch2_to_blightwood', next: 'arc2_ch3_blightwood_mint' })]);
  });

  it('uses the bible scene ids at their lore locations, with a ship-deck map and fogged sea caves', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'arc2_ch2_gamblers_tide');
    const scenes = allScenes(ADV);
    expect(scenes).toHaveLength(6);
    for (const d of design) expect(scenes.find((s) => s.id === d.id)?.locationId, d.id).toBe(d.locationId);
    expect(scenes).toHaveLength(design.length);
    expect(scenes.find((s) => s.id === 'wreckers_cove')!.map).toEqual({ id: 'cove_caves', room: 'landing' });
    expect(ADV.maps.map((m) => m.id)).toEqual(['lucky_wake', 'cove_caves']);
    expect(ADV.encounters.find((e) => e.id === 'salt_crew')).toMatchObject({ map: 'lucky_wake', room: 'deck' });
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
    for (const id of [`${C}clue_5`, `${C}borrowed_face`, `${C}salt_unpaid`, 'world.hag_bargain', 'world.red_gull_debt', 'world.wren_status', `${L}market_burned`]) expect(written.has(id), id).toBe(true);
  });

  it('encounters follow the bible, and the solo hero still meets each boss', () => {
    const counts = (id: string) => ADV.encounters.find((e) => e.id === id)!.monsters.reduce<Record<string, number>>((o, m) => ({ ...o, [m.id]: (o[m.id] ?? 0) + m.count }), {});
    expect(counts('salt_crew')).toEqual({ bandit_captain: 1, pirate: 4 });
    expect(counts('merrow_ambush')).toEqual({ merrow: 2 });
    expect(counts('cove_oozes')).toEqual({ gray_ooze: 2 });
    expect(counts('cove_ghast')).toEqual({ ghast: 1 });
    expect(counts('tallow_burn')).toEqual({ green_hag: 1 });
    const tables = db.tables!;
    for (const e of ADV.encounters) {
      expect(e.scaling, e.id).toBeDefined();
      const solo = scaleMonsters(e.monsters, [3], db, tables, { pool: e.scaling?.pool ?? [], bossIds: e.bosses });
      expect(solo.length, e.id).toBeGreaterThan(0);
      for (const b of e.bosses ?? []) expect(solo.find((m) => m.id === b)?.count, `${e.id} ${b}`).toBe(1);
      if (!e.bosses?.length && e.id !== 'merrow_ambush') expect(solo.reduce((s, m) => s + db.monsters.get(m.id)!.xp * m.count, 0), e.id).toBeLessThanOrEqual(xpBudget([3], 'high', tables));
    }
  });

  it('Wren joins only through recruit outcomes; approvals use the ±5/±10 scale', () => {
    const all = outcomes();
    expect(all.filter((o) => o.recruit).map((o) => o.recruit)).toEqual(['wren', 'wren', 'wren']);
    for (const d of all.flatMap((o) => o.approval)) {
      expect(['brannoc', 'ilse', 'wren']).toContain(d.companion);
      expect([5, 10, -5, -10]).toContain(d.delta);
    }
  });
});

describe('arc2_ch2_gamblers_tide: reachability', () => {
  it('the solver reaches the ending from the start', () => {
    const c = ctx();
    const res = solveAdventure({ state: newGameState(c.state.hero, 'heroic', 'solve', ADV.id), adventure: ADV, db, flags: registry() }, 'ch2_to_blightwood', { depth: 50, nodes: 30000 });
    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it('a scripted path wins the marker at dice, recruits Wren, tricks Salt, bargains with Tallow and reaches level 4 XP', () => {
    const c = ctx({}, { lucky: true });
    play(c, [
      'cage.watch_cage',
      'talk.quillon_vane.dice',
      'dlg.greet.play',
      'dlg.r1.read',
      'dlg.r2_up.read',
      'dlg.won.take',
      'talk.wren_npc.deal',
      'dlg.greet.marker',
      'dlg.joined.deal',
      'exit.to_sloop',
      'talk.captain_salt.passage',
      'dlg.greet.trick',
      'dlg.tricked.aboard',
      'exit.to_reef',
      'sail_day',
      'read_weather',
      'run_reef',
      'make_cove_day',
      'tide_tunnel.ledge',
      'stash.sneak',
      'stash.hollow_chest',
      'exit.to_market',
      'talk.mother_tallow.faces',
      'dlg.greet.bargain',
      'dlg.book.go',
      'exit.to_camp',
      'long_rest',
      'wren_winnings',
      'sloop.sail_north',
    ]);
    expect(getProgress(c.state)?.ending).toBe('ch2_to_blightwood');
    expect(c.state.flags).toMatchObject({
      [`${C}clue_5`]: true,
      [`${C}salt_unpaid`]: true,
      [`${L}marker`]: true,
      [`${L}bargained`]: true,
      'world.wren_status': 'in_party',
      'world.wren_loyalty': 70,
    });
    expect(c.state.flags[`${C}borrowed_face`]).toBeUndefined();
    expect(c.state.flags['world.hag_bargain']).toBeUndefined();
    // 900 from chapters 0–1 + the chapter's checks + the 1500 camp milestone: level 4 (2700), short of level 5 (6500).
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(2700);
    expect(c.state.hero.xp).toBeLessThan(6500);
  });

  it('the shortest no-fight path still reaches level 4 XP', () => {
    const c = ctx({}, { unlucky: true, coins: 3000 });
    play(c, ['harbour_office.ask_harbour', 'exit.to_sloop', 'talk.captain_salt.passage', 'dlg.greet.buy', 'dlg.bought.aboard', 'exit.to_reef', 'sail_day', 'read_weather', 'run_reef', 'make_cove_day']);
    expect(getProgress(c.state)!.sceneId).toBe('wreckers_cove');
    c.rng = new LuckyRng();
    play(c, ['tide_tunnel.ledge', 'stash.sneak', 'exit.to_market', 'talk.mother_tallow.faces', 'dlg.greet.leave', 'dlg.goodbye.go', 'exit.to_camp', 'long_rest']);
    expect(c.state.flags[`${C}clue_5`]).toBeUndefined();
    expect(c.state.hero.xp).toBeGreaterThanOrEqual(2700);
  });
});

describe('arc2_ch2_gamblers_tide: approaches and consequences', () => {
  it('the dice game: two wins take the marker; losing costs ten gold of Red Gull debt; a caught cheat is barred', () => {
    const lost = ctx({}, { unlucky: true });
    play(lost, ['talk.quillon_vane.dice', 'dlg.greet.play', 'dlg.r1.luck', 'dlg.r2_down.luck', 'dlg.lost.leave']);
    expect(lost.state.flags).toMatchObject({ [`${L}dice_lost`]: true, 'world.red_gull_debt': 10 });
    expect(ids(lost)).toContain('talk.quillon_vane.dice');

    const caught = ctx({}, { unlucky: true });
    play(caught, ['talk.quillon_vane.dice', 'dlg.greet.play', 'dlg.r1.cheat', 'dlg.caught.leave']);
    expect(caught.state.flags[`${L}dice_caught`]).toBe(true);
    expect(rep(caught)).toBe(-5);
    expect(ids(caught)).not.toContain('talk.quillon_vane.dice');

    // Wren palms the dice for a hero she has joined.
    const w = ctx({}, { lucky: true });
    recruitCompanion(w.state, wren(), db);
    play(w, ['talk.quillon_vane.dice', 'dlg.greet.play']);
    expect(perform(w, 'dlg.r1.cheat').rolls[0]!.advantage).toContain('Wren palms the house dice for you');
  });

  it('Salt can be found without a roll: the harbour master or Wren names him', () => {
    const c = ctx();
    expect(ids(c)).not.toContain('exit.to_sloop');
    play(c, ['harbour_office.ask_harbour']);
    expect(c.state.flags).toMatchObject({ [`${L}salt_known`]: true, [`${L}deserter_known`]: true });
    expect(ids(c)).toContain('exit.to_sloop');
    const w = ctx();
    play(w, ['talk.wren_npc.deal', 'dlg.greet.salt']);
    expect(w.state.flags[`${L}salt_known`]).toBe(true);
  });

  it('Wren: the marker, a speech or a cut recruits her; a failed speech does not', () => {
    const m = ctx({ [`${L}marker`]: true });
    expect(m.state.flags['world.wren_status']).toBe('met');
    expect(npcsHere(m)).toContain('wren_npc');
    play(m, ['talk.wren_npc.deal', 'dlg.greet.marker']);
    expect(m.state.flags).toMatchObject({ 'world.wren_status': 'in_party', 'world.wren_loyalty': 60 });
    expect(npcsHere(m)).not.toContain('wren_npc');

    const p = ctx({}, { unlucky: true });
    play(p, ['talk.wren_npc.deal', 'dlg.greet.persuade', 'dlg.not_yet.back']);
    expect(p.state.flags).toMatchObject({ 'world.wren_status': 'met', [`${L}wren_declined`]: true });

    const cut = ctx({}, { coins: 1500 });
    play(cut, ['talk.wren_npc.deal', 'dlg.greet.cut']);
    expect(cut.state.flags['world.wren_status']).toBe('in_party');
    expect(cut.state.hero.coins).toBe(500);
  });

  it('Salt: bought (paid), threatened or tricked (alive and unpaid), or fought; a lost fight wakes the hero at the hall with a rematch', () => {
    const bought = ctx({ [`${L}salt_known`]: true }, { scene: 'salt_s_sloop', coins: 3000 });
    play(bought, ['talk.captain_salt.passage', 'dlg.greet.buy']);
    expect(bought.state.hero.coins).toBe(500);
    expect(bought.state.flags[`${L}passage`]).toBe(true);
    expect(bought.state.flags[`${C}salt_unpaid`]).toBeUndefined();

    const scared = ctx({ [`${L}deserter_known`]: true }, { scene: 'salt_s_sloop', lucky: true });
    play(scared, ['talk.captain_salt.passage']);
    expect(ids(scared)).not.toContain('dlg.greet.trick');
    const roll = perform(scared, 'dlg.greet.threaten').rolls[0]!;
    expect(roll.advantage).toContain('You know which prize he ran off with');
    expect(scared.state.flags).toMatchObject({ [`${L}passage`]: true, [`${C}salt_unpaid`]: true });

    const failed = ctx({ [`${L}salt_known`]: true }, { scene: 'salt_s_sloop', unlucky: true });
    play(failed, ['talk.captain_salt.passage', 'dlg.greet.threaten']);
    expect(ids(failed)).toContain('dlg.fight.draw');
    expect(perform(failed, 'dlg.fight.draw').encounter).toBe('salt_crew');
    resolveEncounter(failed, 'salt_crew', 'lose');
    expect(getProgress(failed.state)!.sceneId).toBe('fennicks_rest_hall');
    play(failed, ['exit.to_sloop']);
    expect(ids(failed)).toContain('board');
  });

  it('after beating Salt: spare him (Wren approves, he stays unpaid) or hand him to the Red Gull (Wren disapproves)', () => {
    const spare = ctx({}, { scene: 'salt_s_sloop' });
    recruitCompanion(spare.state, wren(), db);
    play(spare, ['board']);
    expect(spare.state.flags).toMatchObject({ [`${L}salt_beaten`]: true, [`${L}passage`]: true });
    play(spare, ['spare_salt']);
    expect(spare.state.flags).toMatchObject({ [`${C}salt_unpaid`]: true, 'world.wren_loyalty': 60 });
    expect(ids(spare)).not.toContain('hand_salt');

    const hand = ctx({}, { scene: 'salt_s_sloop' });
    recruitCompanion(hand.state, wren(), db);
    play(hand, ['board', 'hand_salt']);
    expect(hand.state.flags[`${C}salt_unpaid`]).toBeUndefined();
    expect(hand.state.flags['world.wren_loyalty']).toBe(40);
    expect(rep(hand)).toBe(5);
  });

  it('the reef run reads the weather; a night crossing meets the merrow; failed rolls cost HP but never strand the hero', () => {
    const storm = ctx({ [`${L}passage`]: true }, { scene: 'reef_run', weather: 'storm' });
    play(storm, ['sail_day']);
    expect(perform(storm, 'read_weather').rolls[0]!.disadvantage).toContain('Oshaya\'s weather is foul');
    const clear = ctx({ [`${L}passage`]: true }, { scene: 'reef_run', weather: 'clear' });
    play(clear, ['sail_night']);
    expect(perform(clear, 'read_weather').rolls[0]!.advantage).toContain('A clear sky over the Isles');

    const night = ctx({}, { scene: 'reef_run', unlucky: true });
    const hp = night.state.hero.hp;
    play(night, ['sail_night', 'read_weather', 'run_reef']);
    expect(night.state.hero.hp).toBeLessThan(hp);
    expect(night.state.flags[`${L}reef_cleared`]).toBe(true);
    expect(ids(night)).not.toContain('make_cove_day');
    expect(perform(night, 'make_cove_night').encounter).toBe('merrow_ambush');
    resolveEncounter(night, 'merrow_ambush', 'lose');
    expect(getProgress(night.state)!.sceneId).toBe('wreckers_cove');
  });

  it('the caves: a ledge or a fight past the oozes; the stash sends a Red Gull bill unless the hero is a friend', () => {
    const c = ctx({}, { scene: 'wreckers_cove', unlucky: true });
    expect(perform(c, 'tide_tunnel.ledge').encounter).toBe('cove_oozes');
    resolveEncounter(c, 'cove_oozes', 'win');
    expect(c.state.flags[`${L}tunnel_passed`]).toBe(true);
    expect(perform(c, 'stash.sneak').encounter).toBe('cove_ghast');
    resolveEncounter(c, 'cove_ghast', 'win');
    const coins = c.state.hero.coins;
    play(c, ['stash.take_share']);
    expect(c.state.flags['world.red_gull_debt']).toBe(50);
    expect(c.state.hero.coins).toBe(coins + 6000);
    expect(ids(c)).toContain('exit.to_market');

    const friend = ctx({ [`${L}tunnel_passed`]: true, [`${L}ghast_done`]: true, [`${L}stash_done`]: true }, { scene: 'wreckers_cove', rep: 30 });
    expect(ids(friend)).not.toContain('stash.take_share');
    play(friend, ['stash.take_share_friend']);
    expect(friend.state.flags['world.red_gull_debt']).toBeUndefined();
  });

  it('Tallow: buying a face costs a memory (scar + story condition); a failed bargain leaves only memories; burning starts the hag fight', () => {
    const buy = ctx({}, { scene: 'tallow_s_market' });
    play(buy, ['talk.mother_tallow.faces', 'dlg.greet.buy']);
    expect(buy.state.flags).toMatchObject({ [`${C}borrowed_face`]: true, 'world.hag_bargain': true, [`${C}clue_5`]: true, [`${L}market_done`]: true });
    expect(buy.state.hero.scars.at(-1)).toMatchObject({ description: 'the memory of a name', location: 'brow' });
    expect(JSON.stringify(buy.state.hero.conditions)).toContain('frightened');

    const refused = ctx({}, { scene: 'tallow_s_market', unlucky: true });
    play(refused, ['talk.mother_tallow.faces', 'dlg.greet.bargain']);
    expect(ids(refused)).toEqual(expect.arrayContaining(['dlg.refused.buy', 'dlg.refused.think']));
    play(refused, ['dlg.refused.think']);
    expect(refused.state.flags[`${L}market_done`]).toBeUndefined();
    expect(ids(refused)).toContain('face_racks.burn');

    const burn = ctx({}, { scene: 'tallow_s_market' });
    expect(perform(burn, 'face_racks.burn').encounter).toBe('tallow_burn');
    resolveEncounter(burn, 'tallow_burn', 'lose');
    expect(getProgress(burn.state)!.sceneId).toBe('cove_camp');
    expect(burn.state.flags).toMatchObject({ [`${L}market_burned`]: true, [`${C}clue_5`]: true });
    expect(burn.state.flags[`${C}borrowed_face`]).toBeUndefined();
  });
});

describe('arc2_ch2_gamblers_tide: policy playthrough through the game host', () => {
  const nextChoice = ch2Choice;

  it('plays chapter 2 at level 3 through the game host with no errors to the road to the Blightwood', async () => {
    const tables = worldTables();
    const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
    const h = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, saves: new MemorySaves(), sessionPorts: { newSeed: () => 'arc2-ch2-smoke' } });
    const events: ServerEvent[] = [];
    h.on((e) => events.push(e));
    await h.send({ type: 'new_game', hero: level3(), mode: 'heroic', campaign: 'arc2_ch2_gamblers_tide' });
    await h.idle();
    const session = h.session;
    const lastSuggestions = () => [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    let wrenAsked = false;
    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.ending || p.adventureId !== 'arc2_ch2_gamblers_tide') break;
      if (activeFight(session.current)) {
        fights++;
        await h.send(combatStep(session, db));
        await h.idle();
        continue;
      }
      const offered = (lastSuggestions()?.actions ?? []).map((a) => a.id);
      const hurt = session.current.hero.hp < session.current.hero.maxHp / 2 && (offered.includes('rest_room') || offered.includes('catch_breath'));
      const flags = { ...session.current.flags, ...(wrenAsked ? { [`${L}wren_asked`]: true } : {}) };
      const choice = hurt ? (offered.includes('rest_room') ? 'rest_room' : 'catch_breath') : nextChoice(p.sceneId, flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      if (choice === 'talk.wren_npc.deal') wrenAsked = true;
      await h.send({ type: 'choose', actionId: choice });
      await h.idle();
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0);
    // The ending chained straight into chapter 3 (B007).
    expect(getProgress(session.current)!.adventureId, `${getProgress(session.current)!.sceneId}: ${session.current.log.slice(-4).map((l) => l.text).join(' | ')}`).toBe('arc2_ch3_blightwood_mint');
    expect(session.current.flags).toMatchObject({ [`${L}passage`]: true, [`${L}reef_cleared`]: true, [`${L}market_done`]: true, [`${L}rested`]: true });
    // Level 4 milestone.
    expect(session.current.hero.xp).toBeGreaterThanOrEqual(2700);
  }, 120_000);
});
