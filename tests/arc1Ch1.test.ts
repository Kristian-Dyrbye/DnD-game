/**
 * Arc chapter 1, "The Whispering Fen" (data/adventures/arc1/ch1_whispering_fen.json, DESIGN §6):
 * validates against the SRD and the flag registry, every flag write is registered or documented,
 * every ending is reachable, and starter-arc flags visibly change the chapter.
 */
import { describe, expect, it } from 'vitest';
import ch1Json from '../data/adventures/arc1/ch1_whispering_fen.json';
import flagsJson from '../data/adventures/flags.json';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import companionsJson from '../data/companions.json';
import { availableActions, describeScene, getProgress, npcsHere, perform as runnerPerform, resolveEncounter as runnerResolve, startAdventure, type RunContext, type StepResult } from '../src/engine/adventure/runner';
import type { Adventure, Outcome } from '../src/engine/adventure/schema';
import { scaleMonsters, xpBudget } from '../src/engine/adventure/encounters';
import { changeApproval, CompanionRosterSchema, partWithCompanion, recruitCompanion } from '../src/engine/party/companions';
import { LuckyRng, solveAdventure } from '../src/engine/adventure/solver';
import { allScenes, flagRefs, validateAdventure } from '../src/engine/adventure/validate';
import { newGameState } from '../src/engine/session/GameSession';
import { FlagRegistry, type Flags } from '../src/engine/world/flags';

const db = loadSrd();
const registry = () => FlagRegistry.fromJson(flagsJson);
const chapter = (): Adventure => {
  const r = validateAdventure(structuredClone(ch1Json), db, registry());
  if (!r.adventure) throw new Error(r.errors.join('\n'));
  return r.adventure;
};
const ADV = chapter();
const roster = CompanionRosterSchema.parse(companionsJson);

/**
 * Applies a step's companion effects the way the session port does (sessionActions: recruits,
 * then approvals, then partings), so runner-level tests see status and loyalty flags change.
 */
function applyParty(c: RunContext, r: StepResult): StepResult {
  const def = (id: string) => roster.companions.find((d) => d.id === id)!;
  for (const id of r.recruits ?? []) recruitCompanion(c.state, def(id), db);
  for (const a of r.approvals ?? []) changeApproval(c.state, def(a.companion), a.delta);
  for (const p of r.partings ?? []) partWithCompanion(c.state, def(p.id), p.status);
  return r;
}
const perform = (c: RunContext, id: string): StepResult => applyParty(c, runnerPerform(c, id));
const resolveEncounter = (c: RunContext, id: string, how: 'win' | 'lose' | 'flee'): StepResult => applyParty(c, runnerResolve(c, id, how));

/** Every outcome in the chapter (actions, checks, scene entries, beats, encounters, deadlines...). */
function outcomes(x: unknown = ADV, out: Outcome[] = []): Outcome[] {
  if (Array.isArray(x)) for (const v of x) outcomes(v, out);
  else if (x && typeof x === 'object') {
    if (Array.isArray((x as Outcome).approval) && Array.isArray((x as Outcome).flags)) out.push(x as Outcome);
    for (const v of Object.values(x)) outcomes(v, out);
  }
  return out;
}

function ctx(flags: Flags = {}, opts: { hour?: number; adventure?: Adventure; lucky?: boolean } = {}): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('ch1'))), db);
  hero.classes[0]!.level = 2;
  const state = newGameState(hero, 'heroic', 'ch1');
  if (opts.hour !== undefined) state.time = opts.hour * 60;
  Object.assign(state.flags, flags);
  return { state, adventure: opts.adventure ?? ADV, rng: opts.lucky ? new LuckyRng() : Rng.fromSeed(7), db, flags: registry() };
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);
/** Performs a scripted path, winning every fight. A trailing `*` picks the first offered id with that prefix. */
function play(c: RunContext, path: string[]): void {
  for (const step of path) {
    const id = step.endsWith('*') ? (ids(c).find((x) => x.startsWith(step.slice(0, -1))) ?? step) : step;
    let r = perform(c, id);
    for (let g = 0; r.encounter && g < 5; g++) r = resolveEncounter(c, r.encounter, 'win');
  }
}
/** Same chapter, starting at another scene (keeps solver searches small). */
const startingAt = (scene: string): Adventure => ({ ...ADV, start: { ...ADV.start, scene } });

describe('ch1_whispering_fen: data', () => {
  it('validates with no errors or warnings', () => {
    const r = validateAdventure(structuredClone(ch1Json), db, registry());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(ADV).toMatchObject({ id: 'ch1_whispering_fen', arcId: 'main', kind: 'arc', levelRange: [2, 3], regionId: 'gloamfen' });
  });

  it('uses the design scene ids at their lore locations', () => {
    const design = (flagsJson as { scenes: { id: string; chapter: string; locationId: string }[] }).scenes.filter((s) => s.chapter === 'ch1_whispering_fen');
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
      // Local (undocumented-in-registry) flags must be boolean: adventure docs register as boolean.
      if (!reg.has(w.id) && w.value !== undefined) expect(typeof w.value, w.id).toBe('boolean');
    }
    for (const id of reads) expect(reg.has(id) || docs.has(id), id).toBe(true);
    // The flags later chapters read are all written here.
    const written = new Set(writes.map((w) => w.id));
    for (const id of ['arc.main.hollowmere_fate', 'arc.main.sallow_fate', 'arc.main.wick_fate', 'arc.main.tooth_abbey_holder', 'arc.main.tooth_wick_holder', 'arc.main.abbot_cendric_alive', 'arc.main.cure_recipe', 'world.sickness_cure', 'world.nettle_status', 'world.briarkin_favor_owed']) {
      expect(written.has(id), id).toBe(true);
    }
    // Derived Tooth counts are never written by content.
    expect(written.has('arc.main.teeth_secured')).toBe(false);
    expect(written.has('arc.main.teeth_choir')).toBe(false);
  });
});

describe('ch1_whispering_fen: companions and encounter scaling', () => {
  const all = outcomes();

  it('Nettle joins only through the recruit outcome, and every companion reference is on the roster', () => {
    const known = new Set(roster.companions.map((d) => d.id));
    const recruits = all.filter((o) => o.recruit);
    expect(recruits.length).toBeGreaterThanOrEqual(3); // persuasion, shrine, after the child
    for (const o of recruits) expect(known.has(o.recruit!), o.recruit).toBe(true);
    for (const o of all) {
      for (const a of o.approval) expect(known.has(a.companion), a.companion).toBe(true);
      if (o.companionLeaves) expect(known.has(o.companionLeaves.id), o.companionLeaves.id).toBe(true);
    }
    expect(all.some((o) => o.companionLeaves?.id === 'nettle' && o.companionLeaves.status === 'left')).toBe(true);
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

  it('approval deltas follow the ±5 / ±10 / ±20 scale (the Choir offer is the design-mandated −30)', () => {
    const deltas = all.flatMap((o) => o.approval.map((a) => a.delta));
    expect(deltas.length).toBeGreaterThan(10);
    for (const d of deltas) expect([5, 10, 20, -5, -10, -20, -30], String(d)).toContain(d);
  });

  it('encounters keep their authored groups and declare scaling pools of their own monsters', () => {
    // Summed over groups: conditional groups (A132: one ghoul skipped if the landing is known) count at full strength.
    const counts = (id: string) => ADV.encounters.find((e) => e.id === id)!.monsters.reduce<Record<string, number>>((o, m) => ({ ...o, [m.id]: (o[m.id] ?? 0) + m.count }), {});
    expect(counts('abbey_nave')).toEqual({ zombie: 4, ghoul: 1 });
    expect(counts('abbey_nave_midnight')).toEqual({ zombie: 4, ghoul: 1, specter: 1 });
    expect(counts('thornwife_raid')).toEqual({ scout: 2, giant_spider: 1 });
    expect(counts('bells_choir')).toEqual({ cultist_fanatic: 1, cultist: 2, ghoul: 2, swarm_of_insects: 1 });
    expect(counts('bells_choir_ashby')).toEqual({ cultist_fanatic: 2, cultist: 2, ghoul: 2, swarm_of_insects: 1 });
    expect(counts('stilts_deacons_ambush')).toEqual({ cultist: 3, giant_toad: 1 });
    for (const e of ADV.encounters) {
      if (e.monsters.reduce((s, m) => s + m.count, 0) < 2) continue; // a lone monster can't be trimmed
      expect(e.scaling, e.id).toBeDefined();
      for (const id of e.scaling!.pool) {
        expect(db.monsters.has(id), id).toBe(true);
        expect(e.monsters.some((m) => m.id === id), `${e.id} pool ${id}`).toBe(true);
      }
    }
  });

  it('scaleMonsters trims fights for a lone hero and keeps them whole for a full party', () => {
    const tables = db.tables!;
    const xp = (ms: { id: string; count: number }[]) => ms.reduce((s, m) => s + db.monsters.get(m.id)!.xp * m.count, 0);
    for (const e of ADV.encounters) {
      const solo = scaleMonsters(e.monsters, [2], db, tables, { pool: e.scaling?.pool ?? [] });
      const soloCount = solo.reduce((s, m) => s + m.count, 0);
      expect(xp(solo) <= xpBudget([2], 'high', tables) || soloCount === 1, e.id).toBe(true);
    }
    const nave = ADV.encounters.find((e) => e.id === 'abbey_nave')!;
    const full = scaleMonsters(nave.monsters, [3, 3, 3, 3], db, tables, { pool: nave.scaling!.pool });
    for (const m of nave.monsters) expect(full.find((x) => x.id === m.id)!.count, m.id).toBeGreaterThanOrEqual(m.count);
    expect(xp(full)).toBeGreaterThanOrEqual(xp(nave.monsters)); // the pool tops a big party up, never down
  });
});

describe('ch1_whispering_fen: reachability', () => {
  it('the solver reaches the chapter end from the start with default flags', () => {
    const res = solveAdventure({ state: ctx().state, adventure: ADV, db, flags: registry() }, undefined, { depth: 40, nodes: 20000 });
    expect(res.reason).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it.each(['fen_cured', 'fen_purged', 'fen_abandoned'])('the solver reaches ending %s from the tribunal', (ending) => {
    const base = ctx({ 'arc.main.cure_recipe': true });
    // A132: Grell's conversation multiplies the states before the purge pledge (~21k nodes, < 1 s).
    const res = solveAdventure({ state: base.state, adventure: startingAt('lantern_hold_tribunal'), db, flags: registry() }, ending, { depth: 20, nodes: 50000 });
    expect(res.ok, res.reason).toBe(true);
  });

  it('a scripted cure-path playthrough sets the flags later chapters read', () => {
    const c = ctx({}, { lucky: true });
    startAdventure(c);
    play(c, [
      'inspection',
      'exit.causeway',
      'hide_pass',
      'recruit_nettle',
      'stop_deacons',
      'exit.nettle_path',
      'talk_wick',
      'trade_oath',
      'exit.to_hollowmere',
      'exit.to_abbey',
      'swim',
      'fight_nave*', // plain, or the midnight variant, depending on the clock
      'save_abbot',
      'spot_boat',
      'collect_ash',
      'tithe_offerings',
      'climb_out',
      'exit.to_hollowmere',
      'exit.nettle_path',
      'deliver_ash',
      'exit.to_hollowmere',
      'exit.to_hold',
      'argue_cure',
      'exit.new_moon',
      'cure_first',
      'meet_boats',
      'spot_escape',
      'capture_sallow',
      'question_sallow',
      'search_letters',
      'dawn_cured',
    ]);
    const f = c.state.flags;
    expect(getProgress(c.state)?.ending).toBe('fen_cured');
    expect(c.state.companions.map((x) => x.id)).toEqual(['nettle']);
    expect(f).toMatchObject({
      'world.nettle_status': 'in_party',
      'world.nettle_loyalty': 75,
      'arc.main.tooth_wick_holder': 'player',
      'arc.main.wick_fate': 'ally',
      'world.briarkin_favor_owed': true,
      'arc.main.tooth_abbey_holder': 'player',
      'arc.main.abbot_cendric_alive': true,
      'arc.main.cure_recipe': true,
      'arc.main.hollowmere_fate': 'cured',
      'arc.main.sallow_fate': 'captured',
      'world.sickness_cure': 'briarkin_cure',
      'arc.main.ch1_sallow_confessed': true,
    });
  });

  it('the purge deadline burns Hollowmere and raids Thornwife if the tribunal is never faced', () => {
    const c = ctx({}, { lucky: true });
    startAdventure(c);
    play(c, ['inspection', 'exit.causeway']);
    c.state.time += 6 * 24 * 60;
    perform(c, 'read_sallow');
    expect(c.state.flags['arc.main.hollowmere_fate']).toBe('purged');
    perform(c, 'bread.examine'); // the raid's beats fire on the next step
    expect(c.state.flags).toMatchObject({ 'arc.main.hollowmere_fate': 'purged', 'arc.main.wick_fate': 'burned', 'arc.main.tooth_wick_holder': 'wardens' });
    expect(ids(c)).toContain('exit.new_moon');
  });

  it('joining the Purge makes Nettle leave and Corwin disapprove', () => {
    const c = ctx({ 'world.nettle_status': 'in_party', 'world.corwin_status': 'in_party' }, { adventure: startingAt('lantern_hold_tribunal') });
    startAdventure(c);
    play(c, ['pledge_purge']);
    expect(c.state.flags).toMatchObject({ 'world.nettle_status': 'left', 'world.corwin_loyalty': 40, 'arc.main.hollowmere_fate': 'purged', 'arc.main.wick_fate': 'burned' });
  });
});

describe('ch1_whispering_fen: A132 conversations, approaches and consequences', () => {
  const L = 'arc.main.ch1_';
  /** Always rolls 1 (every check fails). */
  class UnluckyRng extends Rng {
    constructor() {
      super([1, 2, 3, 4]);
    }
    override int(min: number, max: number): number {
      return max === 20 ? 1 : super.int(min, max);
    }
  }
  const at = (scene: string, flags: Flags = {}, opts: { hour?: number; lucky?: boolean; unlucky?: boolean } = {}) => {
    const c = ctx(flags, { ...opts, adventure: startingAt(scene) });
    if (opts.unlucky) c.rng = new UnluckyRng();
    startAdventure(c);
    return c;
  };
  const beats = (c: RunContext) => getProgress(c.state)!.beats;

  it('every key NPC has a conversation with at least 3 approaches that do something; hub scenes vary on return', () => {
    for (const id of ['odo_brask', 'maud_grell', 'grandmother_wick', 'mother_sallow', 'brother_ashby', 'nettle', 'abbot_cendric']) {
      const npc = ADV.npcs.find((n) => n.id === id)!;
      const approaches = new Set<string>();
      for (const conv of npc.conversations) {
        for (const node of conv.nodes) {
          for (const o of node.options) {
            const out = [o.outcome, o.check?.success, o.check?.failure];
            if (o.check || out.some((x) => x && (x.flags.length || x.cost || x.conditions.length || x.approval.length || x.reputation.length))) approaches.add(o.id);
          }
        }
      }
      expect(approaches.size, id).toBeGreaterThanOrEqual(3);
    }
    for (const s of ['ravensgate_gates', 'hollowmere_stilts', 'thornwife_moot', 'drowned_abbey_undercroft', 'lantern_hold_tribunal']) {
      expect(allScenes(ADV).find((x) => x.id === s)!.revisitSeed, s).toBeDefined();
    }
  });

  it('Brask: confiding opens the postern at night and brings him to the tribunal as a witness', () => {
    const c = at('ravensgate_gates', {}, { hour: 22, lucky: true });
    expect(ids(c)).not.toContain('talk_brask'); // replaced by the conversation
    play(c, ['talk.odo_brask.gate', 'dlg.greet.order', 'dlg.confide.witness', 'dlg.witness.postern']);
    expect(c.state.flags).toMatchObject({ [`${L}brask_confided`]: true, [`${L}brask_witness`]: true, [`${L}postern`]: true, [`${L}inside`]: true, [`${L}pass`]: true });
    const t = at('lantern_hold_tribunal', { [`${L}brask_witness`]: true, [`${L}abbot_letter`]: true });
    expect(ids(t)).not.toContain('talk.odo_brask.gate'); // on duty in the hall
    const r = perform(t, 'argue_cure');
    expect(r.rolls[0]!.advantage).toEqual(expect.arrayContaining(['Sergeant Brask speaks for Hollowmere', 'Abbot Cendric\'s letter to the Captain']));
  });

  it('Brask: a bribe gets you in but costs you at the tribunal; a failed threat turns him against you', () => {
    const c = at('ravensgate_gates', { 'world.corwin_status': 'in_party' }, { hour: 10 });
    c.state.hero.coins = 1000;
    play(c, ['talk.odo_brask.gate', 'dlg.greet.bribe']);
    expect(c.state.hero.coins).toBe(500);
    expect(c.state.flags).toMatchObject({ [`${L}brask_bribed`]: true, [`${L}pass`]: true });
    expect(beats(c)).toContain('corwin_bribe');
    const t = at('lantern_hold_tribunal', { [`${L}brask_bribed`]: true });
    expect(perform(t, 'argue_cure').rolls[0]!.disadvantage).toContain('Grell found five gold too many in Brask\'s ledger');

    const u = at('ravensgate_gates', {}, { hour: 22, unlucky: true });
    play(u, ['talk.odo_brask.gate', 'dlg.greet.lean']);
    expect(u.state.flags[`${L}brask_cold`]).toBe(true);
    expect(u.state.flags[`${L}inside`]).toBeUndefined();
    expect(ids(u)).not.toContain('talk.odo_brask.gate');
  });

  it('Grell: the bread warning brings Warden lanterns to the landing; sparing the healthy softens a purge', () => {
    const c = at('lantern_hold_tribunal', { [`${L}bread_spores`]: true }, { lucky: true });
    play(c, ['talk.maud_grell.hearing', 'dlg.greet.spores', 'dlg.warned.healthy', 'dlg.spared.list', 'dlg.ledger.names', 'dlg.moved.bye']);
    expect(c.state.flags).toMatchObject({ [`${L}grell_warned`]: true, [`${L}healthy_spared`]: true, [`${L}grell_moved`]: true });
    expect(perform(c, 'argue_cure').rolls[0]!.advantage).toContain('Grell\'s own ledger weighs on her');
    for (const id of ['bells_choir', 'bells_choir_ashby']) {
      expect(ADV.encounters.find((e) => e.id === id)!.allies).toEqual([{ id: 'guard', count: 2, if: { flag: `${L}grell_warned` } }]);
    }
    const p = at('lantern_hold_tribunal', { [`${L}healthy_spared`]: true });
    play(p, ['pledge_purge']);
    expect(beats(p)).toContain('purge_spared');
  });

  it('Sallow: eating her bread poisons you but proves it; exposing her ends the bread and helps the cure', () => {
    const c = at('hollowmere_stilts', {}, { hour: 10, lucky: true });
    play(c, ['talk.mother_sallow.lamb', 'dlg.bread.eat']);
    expect(c.state.hero.conditions.map((x) => x.condition)).toContain('poisoned');
    expect(c.state.flags[`${L}bread_spores`]).toBe(true);
    play(c, ['dlg.hums.accuse']);
    expect(c.state.flags[`${L}sallow_exposed`]).toBe(true);
    expect(npcsHere(c)).not.toContain('mother_sallow');
    const n = at('night_of_bells', { [`${L}sallow_exposed`]: true, [`${L}cure_path`]: true, 'arc.main.cure_recipe': true });
    expect(perform(n, 'cure_first').rolls[0]!.advantage).toContain('Nobody is eating the Choir bread any more');
  });

  it('Sallow: playing the convert reveals the landing (one ghoul fewer, easier spotting); failing makes her wary', () => {
    const c = at('hollowmere_stilts', {}, { hour: 10, lucky: true });
    play(c, ['talk.mother_sallow.lamb', 'dlg.bread.convert']);
    expect(c.state.flags[`${L}landing_known`]).toBe(true);
    const ghouls = ADV.encounters.find((e) => e.id === 'bells_choir')!.monsters.filter((m) => m.id === 'ghoul');
    expect(ghouls).toEqual([{ id: 'ghoul', count: 1 }, { id: 'ghoul', count: 1, if: { not: { flag: `${L}landing_known` } } }]);
    const n = at('night_of_bells', { [`${L}bells_won`]: true, [`${L}landing_known`]: true });
    expect(perform(n, 'spot_escape').rolls[0]!.advantage).toContain('You know the eel-landing she will run for');

    const u = at('hollowmere_stilts', {}, { hour: 10, unlucky: true });
    play(u, ['talk.mother_sallow.lamb', 'dlg.bread.convert']);
    expect(u.state.flags[`${L}sallow_wary`]).toBe(true);
    const w = at('night_of_bells', { [`${L}bells_won`]: true, [`${L}sallow_wary`]: true });
    expect(perform(w, 'spot_escape').rolls[0]!.disadvantage).toContain('Sallow knows your face and keeps to the dark');
  });

  it('Ashby: talked out of the Choir, he skips the night fight (Corwin approves); scared off, he warns Sallow', () => {
    const esc = { 'arc.starter.ashby_fate': 'escaped', [`${L}child_saved`]: true, 'world.corwin_status': 'in_party', 'world.corwin_loyalty': 50 };
    const c = at('hollowmere_stilts', esc, { hour: 10, lucky: true });
    play(c, ['talk.brother_ashby.sexton', 'dlg.greet.watch', 'dlg.greet2.mercy']);
    expect(c.state.flags[`${L}ashby_turned`]).toBe(true);
    expect(beats(c)).toContain('corwin_ashby');
    expect(c.state.flags['world.corwin_loyalty']).toBe(60);
    const n = at('night_of_bells', { 'arc.starter.ashby_fate': 'escaped', [`${L}ashby_turned`]: true });
    expect(ids(n)).toContain('meet_boats');
    expect(ids(n)).not.toContain('meet_boats_ashby');
    expect(npcsHere(n)).not.toContain('brother_ashby');

    const s = at('hollowmere_stilts', esc, { hour: 10, lucky: true });
    play(s, ['talk.brother_ashby.sexton', 'dlg.greet.taunt']);
    expect(s.state.flags).toMatchObject({ [`${L}ashby_shaken`]: true, [`${L}sallow_wary`]: true });
  });

  it('Nettle: honesty about the pass lets her join (and she remembers it); helping her gives advantage', () => {
    const c = at('hollowmere_stilts', { [`${L}pass`]: true }, { hour: 10, lucky: true });
    expect(ids(c)).not.toContain('recruit_nettle'); // the pass is in plain sight
    play(c, ['talk.nettle.healer', 'dlg.work.help', 'dlg.worked.truth', 'dlg.honest.bye']);
    expect(c.state.flags[`${L}pass_hidden`]).toBe(true);
    const r = perform(c, 'recruit_nettle');
    expect(r.rolls[0]!.advantage).toContain('You worked beside her');
    expect(c.state.flags['world.nettle_status']).toBe('in_party');
    perform(c, 'bread.examine');
    expect(beats(c)).toContain('nettle_honest');
    expect(c.state.flags['world.nettle_loyalty']).toBe(60);
  });

  it('Wick: Nettle\'s true name can be asked for or stolen; a failed threat closes her bargains', () => {
    const nettle = { 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 50 };
    const c = at('thornwife_moot', nettle, { lucky: true });
    play(c, ['talk.grandmother_wick.fire', 'dlg.fire.name', 'dlg.jar.ask_name']);
    expect(c.state.flags).toMatchObject({ [`${L}nettle_named`]: true, 'world.nettle_loyalty': 60 });
    const s = at('thornwife_moot', nettle, { lucky: true });
    play(s, ['talk.grandmother_wick.fire', 'dlg.fire.name', 'dlg.jar.steal_name']);
    expect(s.state.flags).toMatchObject({ [`${L}name_stolen`]: true, 'world.nettle_loyalty': 55 });

    const u = at('thornwife_moot', nettle, { unlucky: true });
    play(u, ['talk.grandmother_wick.fire', 'dlg.fire.threaten']);
    expect(u.state.flags[`${L}wick_threatened`]).toBe(true);
    expect(u.state.flags['world.nettle_loyalty']).toBe(40);
    expect(ids(u).filter((x) => ['talk_wick', 'trade_oath', 'ask_tooth_nettle', 'talk.grandmother_wick.fire'].includes(x))).toEqual([]);
  });

  it('Abbot Cendric: his blessing helps the swim and his letter helps at the tribunal', () => {
    const c = at('drowned_abbey_undercroft', {}, { lucky: true });
    expect(ids(c)).not.toContain('talk_abbot');
    play(c, ['talk.abbot_cendric.litany', 'dlg.greet.what', 'dlg.what.bless', 'dlg.blessed.bye']);
    expect(perform(c, 'swim').rolls[0]!.advantage).toContain('The Drowned Lady\'s blessing');
    const l = at('drowned_abbey_undercroft', { [`${L}nave_cleared`]: true }, { lucky: true });
    play(l, ['talk.abbot_cendric.litany', 'dlg.greet.letter']);
    expect(l.state.flags[`${L}abbot_letter`]).toBe(true);
    const d = at('drowned_abbey_undercroft', {}, { lucky: true });
    play(d, ['talk.abbot_cendric.litany', 'dlg.greet.divers']);
    expect(d.state.flags[`${L}divers_known`]).toBe(true);
    Object.assign(d.state.flags, { [`${L}abbey_choice`]: true });
    play(d, ['dlg.wrote.bye']);
    expect(perform(d, 'spot_boat').rolls[0]!.advantage).toContain('You know the crypt-stair where the divers surface');
  });
});

describe('ch1_whispering_fen: starter-arc flags change the chapter', () => {
  it('first_destination and reeve_attitude open different ways through the shut gate', () => {
    const plain = ctx({}, { hour: 22 });
    startAdventure(plain);
    expect(ids(plain)).toContain('talk_way_in');
    expect(ids(plain)).not.toContain('reeve_letter');
    expect(ids(plain)).not.toContain('crown_writ');

    const writ = ctx({ 'arc.starter.first_destination': 'brightwater', 'arc.starter.reeve_attitude': 'friendly' }, { hour: 22 });
    startAdventure(writ);
    expect(ids(writ)).toEqual(expect.arrayContaining(['reeve_letter', 'crown_writ']));
    expect(describeScene(writ).seed).toContain('crown writ from Brightwater');
    perform(writ, 'crown_writ');
    expect(writ.state.flags['arc.main.ch1_pass']).toBe(true);
  });

  it('Brask demands the Tooth of Want only if the hero came straight to Ravensgate with it', () => {
    const direct = ctx({ 'arc.main.tooth_want_holder': 'player' });
    startAdventure(direct);
    expect(ids(direct)).toEqual(expect.arrayContaining(['hand_over_tooth', 'keep_tooth']));
    perform(direct, 'hand_over_tooth');
    expect(direct.state.flags['arc.main.tooth_want_holder']).toBe('wardens');

    const viaBrightwater = ctx({ 'arc.main.tooth_want_holder': 'player', 'arc.starter.first_destination': 'brightwater' });
    startAdventure(viaBrightwater);
    expect(ids(viaBrightwater)).not.toContain('hand_over_tooth');
  });

  it('ashby_fate changes who is in Hollowmere and how the deacon fight starts', () => {
    const at = startingAt('hollowmere_stilts');
    const plain = ctx({}, { adventure: at });
    startAdventure(plain);
    expect(ids(plain)).toContain('stop_deacons');
    expect(npcsHere(plain)).not.toContain('brother_ashby');

    const escaped = ctx({ 'arc.starter.ashby_fate': 'escaped' }, { adventure: at });
    startAdventure(escaped);
    expect(ids(escaped)).toContain('stop_deacons_ashby');
    expect(ids(escaped)).not.toContain('stop_deacons');
    expect(npcsHere(escaped)).toContain('brother_ashby');
    expect(describeScene(escaped).seed).toContain('Brother Ashby');
    expect(perform(escaped, 'stop_deacons_ashby').encounter).toBe('stilts_deacons_ashby');

    const captured = ctx({ 'arc.starter.ashby_fate': 'captured' }, { adventure: at });
    startAdventure(captured);
    expect(ids(captured)).toContain('ambush_boat');
    expect(perform(captured, 'ambush_boat').encounter).toBe('stilts_deacons_ambush');
  });

  it('a rekindled shrine recruits Nettle outright at higher loyalty and softens Wick', () => {
    const at = startingAt('hollowmere_stilts');
    const plain = ctx({}, { adventure: at });
    startAdventure(plain);
    expect(ids(plain)).toContain('recruit_nettle');
    expect(ids(plain)).not.toContain('recruit_nettle_shrine');

    const shrine = ctx({ 'arc.starter.shrine_rekindled': true }, { adventure: at });
    startAdventure(shrine);
    expect(ids(shrine)).toContain('recruit_nettle_shrine');
    expect(ids(shrine)).not.toContain('recruit_nettle');
    const r = perform(shrine, 'recruit_nettle_shrine');
    expect(r.recruits).toEqual(['nettle']);
    expect(shrine.state.flags).toMatchObject({ 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 55 });
    expect(shrine.state.companions.map((c) => c.id)).toEqual(['nettle']);
    expect(npcsHere(shrine)).not.toContain('nettle');
    expect(ids(shrine)).toContain('exit.nettle_path');
    expect(ids(shrine)).not.toContain('exit.briars');
  });

  it('Corwin in the party reacts to the chapter', () => {
    const c = ctx({ 'world.corwin_status': 'in_party' });
    startAdventure(c);
    expect(describeScene(c).seed).toContain('Ser Corwin');
    const alone = ctx();
    startAdventure(alone);
    expect(describeScene(alone).seed).not.toContain('Ser Corwin');
  });
});
