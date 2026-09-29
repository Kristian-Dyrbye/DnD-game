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
import { availableActions, describeScene, getProgress, npcsHere, perform, resolveEncounter, startAdventure, type RunContext } from '../src/engine/adventure/runner';
import type { Adventure } from '../src/engine/adventure/schema';
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
    for (const id of ['arc.main.hollowmere_fate', 'arc.main.sallow_fate', 'arc.main.wick_fate', 'arc.main.tooth_abbey_holder', 'arc.main.tooth_wick_holder', 'arc.main.abbot_cendric_alive', 'arc.main.cure_recipe', 'world.sickness_cure', 'world.nettle_status', 'world.nettle_loyalty', 'world.briarkin_favor_owed']) {
      expect(written.has(id), id).toBe(true);
    }
    // Derived Tooth counts are never written by content.
    expect(written.has('arc.main.teeth_secured')).toBe(false);
    expect(written.has('arc.main.teeth_choir')).toBe(false);
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
    const res = solveAdventure({ state: base.state, adventure: startingAt('lantern_hold_tribunal'), db, flags: registry() }, ending, { depth: 20, nodes: 20000 });
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
    perform(shrine, 'recruit_nettle_shrine');
    expect(shrine.state.flags).toMatchObject({ 'world.nettle_status': 'in_party', 'world.nettle_loyalty': 55 });
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
