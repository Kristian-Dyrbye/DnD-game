/**
 * Story policy for automated playthroughs of "The Hollow Crown" (B004–B008): the next action for
 * each chapter by scene and flags (failed checks just take the next branch), a rest when the hero
 * is hurt, and automatic level-ups between chapters. Used by the chapter tests (tests/arc2Ch*.test.ts)
 * and the whole-campaign smoke test (tests/arc2Smoke.test.ts).
 */
import { canLevelUp } from '../../src/engine/character/leveling';
import type { Character } from '../../src/engine/core/creature';
import type { SrdDatabase } from '../../src/engine/data/srd';
import { autoLevelChoices } from '../../src/engine/party/companions';
import type { Flags } from '../../src/engine/world/flags';
import type { ClientCommand } from '../../src/shared/protocol';

const C = 'arc.crown.';
type Policy = (scene: string, flags: Flags, offered: string[]) => string | undefined;

/** The five exclusive ending actions of the epilogue (B007). */
export const ARC2_END_ACTIONS = ['end_false_coin', 'end_true_weight', 'end_hollow_keeper', 'end_stranger', 'end_thousand_faces'];

const pick = (offered: string[]) => (...xs: string[]) => xs.find((x) => offered.includes(x));

/** Chapter 0 "The Hollow Coin". */
export const ch0Choice: Policy = (scene, flags, offered) => {
  const f = (k: string) => flags[`${C}ch0_${k}`] ?? flags[`${C}${k}`];
  const first = pick(offered);
  const talking = offered.filter((x) => x.startsWith('dlg.'));
  if (talking.length) return first('dlg.greet.persuade', 'dlg.greet.oath', 'dlg.greet.honest', 'dlg.test.to_bench', 'dlg.fear.take_key', 'dlg.paid.to_bench', 'dlg.cowed.to_bench') ?? talking.at(-1);
  const mintDone = f('mint_won') || f('mint_searched');
  switch (scene) {
    case 'brightwater_market':
      if (!f('saw_ash')) return first('moneychanger.change_coin');
      if (flags['world.brannoc_status'] === 'unmet') return first('exit.to_shrine');
      if (!f('bench_ready')) return first('exit.to_assay');
      if (!f('gate_open')) return first('mill_race_gate.unlock_gate', 'mill_race_gate.force_gate', 'mill_race_gate.pick_gate');
      if (!mintDone) return first('exit.to_cellars');
      if (!f('oath_sworn')) return first('exit.to_shrine');
      return first('exit.to_road');
    case 'assay_house':
      if (!f('bench_ready')) return first('talk.mistress_dunmore.assay');
      return first('assay_bench.assay_eye', 'assay_bench.assay_spell', 'ask_letter', 'exit.to_market');
    case 'mill_cellars':
      return first('storm_mint_silver', 'storm_mint', 'push_on', 'sneak_past', 'search_empty_mint', 'exit.to_den');
    case 'wererat_den_rest':
      return first('free_clerk', 'search_mint', 'presses.smash_dies', 'question_rat', 'hand_to_reeve', 'exit.to_market');
    case 'korrath_shrine_oath':
      if (flags['world.brannoc_status'] === 'met' && !f('brannoc_waits')) return first('talk.brannoc_npc.scales');
      if (mintDone && flags['world.brannoc_status'] === 'met') return first('talk.brannoc_npc.scales', 'scales.kneel_scales');
      return first('scales.kneel_scales', mintDone ? 'exit.to_road' : 'exit.to_market');
    case 'road_east':
      return first('walk_east');
  }
  return undefined;
};

/** Chapter 1 "Faces in the Ledger" (reads `arc.crown.ch1_ilse_asked`, which the runner below fills in). */
export const ch1Choice: Policy = (scene, flags, offered) => {
  const f = (k: string) => flags[`${C}ch1_${k}`] ?? flags[`${C}${k}`];
  const first = pick(offered);
  const talking = offered.filter((x) => x.startsWith('dlg.'));
  if (talking.length)
    return (
      first('dlg.greet.letter', 'dlg.greet.persuade', 'dlg.greet.pay', 'dlg.greet.family', 'dlg.greet.by_book', 'dlg.greet.body', 'dlg.greet.ledger', 'dlg.greet.share', 'dlg.greet.read', 'dlg.greet.plead', 'dlg.greet.defy') ??
      talking.find((x) => !x.startsWith('dlg.greet.')) ??
      talking.at(-1)
    );
  switch (scene) {
    case 'deepanvil_gate':
      if (!f('gate_passed')) return first('talk.warden_brekka.papers', 'ore_line.haul_ore');
      return first('exit.to_counting_house');
    case 'counting_house':
      if (!f('ledger_found')) {
        if (!f('saw_portrait')) return first('hesk_desk.portrait');
        if (!f('vault_access')) return first('talk.false_hesk.audit', 'supervised_audit', 'vault_stair.break_in');
        return first('exit.to_vault');
      }
      return first('exit.to_confront');
    case 'vault_audit':
      return first('watchword', 'advance', 'hollow_tenth.weigh_bars', 'hollow_tenth.fathers_seal', 'ledger_alcove.read_ledger', 'exit.to_confront');
    case 'hesk_unmasked':
      return first('name_daughter', 'show_guards', 'unmask', 'exit.to_court');
    case 'ironvault_court':
      if (!f('verdict')) return first('talk.thane_orsa.verdict');
      if (flags['world.ilse_status'] === 'met' && !f('ilse_declined') && !f('ilse_asked')) return first('talk.ilse_npc.dreams', 'exit.to_rest');
      return first('exit.to_rest');
    case 'thane_s_rest':
      return first('long_rest', 'ilse_dream', 'road_board.road_south');
  }
  return undefined;
};

/** Chapter 2 "The Gambler's Tide" (reads `arc.crown.ch2_wren_asked`, which the runner below fills in). */
export const ch2Choice: Policy = (scene, flags, offered) => {
  const f = (k: string) => flags[`${C}ch2_${k}`];
  const first = pick(offered);
  const talking = offered.filter((x) => x.startsWith('dlg.'));
  if (talking.length)
    return (
      first('dlg.greet.marker', 'dlg.greet.play', 'dlg.r1.read', 'dlg.r2_up.read', 'dlg.r2_down.read', 'dlg.r3.read', 'dlg.greet.trick', 'dlg.greet.threaten', 'dlg.fight.draw', 'dlg.greet.bargain', 'dlg.refused.buy', 'dlg.greet.persuade', 'dlg.greet.salt') ??
      talking.find((x) => !x.startsWith('dlg.greet.')) ??
      talking.at(-1)
    );
  switch (scene) {
    case 'fennicks_rest_hall':
      if (!f('wash_seen') && offered.includes('cage.watch_cage')) return 'cage.watch_cage';
      if (!f('marker') && !f('dice_lost') && !f('dice_caught')) return first('talk.quillon_vane.dice');
      if (flags['world.wren_status'] === 'met' && !f('wren_asked')) return first('talk.wren_npc.deal');
      if (!f('salt_known')) return first('harbour_office.ask_harbour');
      return first('exit.to_sloop');
    case 'salt_s_sloop':
      if (!f('passage')) return first('talk.captain_salt.passage', 'board');
      return first('spare_salt', 'exit.to_reef');
    case 'reef_run':
      return first('sail_day', 'read_weather', 'run_reef', 'make_cove_day', 'make_cove_night');
    case 'wreckers_cove':
      return first('tide_tunnel.wade', 'stash.sneak', 'stash.search', 'stash.hollow_chest', 'exit.to_market');
    case 'tallow_s_market':
      return first('talk.mother_tallow.faces', 'exit.to_camp');
    case 'cove_camp':
      return first('long_rest', 'wren_winnings', 'sloop.sail_north');
  }
  return undefined;
};

/** Chapter 3 "The Blightwood Mint" + the epilogue's endings. */
export const ch3Choice: Policy = (scene, flags, offered) => {
  const first = pick(offered);
  const talking = offered.filter((x) => x.startsWith('dlg.'));
  if (talking.length) return first('dlg.greet.commission', 'dlg.greet.standing', 'dlg.greet.persuade', 'dlg.greet.go') ?? talking.find((x) => !x.startsWith('dlg.greet.')) ?? talking.at(-1);
  switch (scene) {
    case 'dawnspire_muster_lite':
      if (!flags[`${C}ch3_knight`] && !flags[`${C}ch3_lance_refused`]) return first('talk.captain_ashe.lance');
      return first('exit.to_blightwood');
    case 'blightwood_paths':
      return first('weeping_trees.read_sap', 'keep_path', 'exit.day_trail', 'exit.night_trail', 'push_on');
    case 'vaelthorn_foundry':
      return first('stations.ledger', 'stations.arcane', 'stations.rite_alone', 'seal.compare', 'exit.to_coronation', 'storm_floor');
    case 'coronation':
      return first('name_vexx', 'wear_face', 'storm');
    case 'hollow_crown_choice':
      return first('catch_vexx', 'vexx_court', 'crown_destroy', 'camp', 'exit.to_deepanvil');
    case 'epilogue_deepanvil':
      return first('read_thane', ...ARC2_END_ACTIONS);
  }
  return undefined;
};

export const ARC2_POLICIES: Record<string, Policy> = {
  arc2_ch0_hollow_coin: ch0Choice,
  arc2_ch1_faces: ch1Choice,
  arc2_ch2_gamblers_tide: ch2Choice,
  arc2_ch3_blightwood_mint: ch3Choice,
};

/** Rest actions of the four chapters (inn, lodging, ship's room, camp…), first offered wins. */
const RESTS = ['rest_inn', 'rest_lodging', 'rest_room', 'rest_keep', 'bind_wounds', 'catch_breath'];
/** Talks the policy asks only once (their "asked" flag is not written by the chapter). */
const ASK_ONCE: Record<string, string> = { 'talk.ilse_npc.dreams': `${C}ch1_ilse_asked`, 'talk.wren_npc.deal': `${C}ch2_wren_asked` };

/**
 * A stateful arc 2 player: `next` returns the action for the current chapter and scene (a rest
 * first when the hero is below half HP), remembering talks it already asked.
 */
export function arc2Player() {
  const asked: Flags = {};
  return {
    next(adventureId: string, scene: string, hero: Character, flags: Flags, offered: string[]): string | undefined {
      const policy = ARC2_POLICIES[adventureId];
      if (!policy) return undefined;
      const rest = hero.hp < hero.maxHp / 2 ? RESTS.find((r) => offered.includes(r)) : undefined;
      const choice = rest ?? policy(scene, { ...flags, ...asked }, offered);
      if (choice && ASK_ONCE[choice]) asked[ASK_ONCE[choice]] = true;
      return choice;
    },
  };
}

/** The level_up command a player would send now (single class, average HP, automatic choices), if any. */
export function autoLevelUp(hero: Character, db: SrdDatabase): ClientCommand | undefined {
  if (!canLevelUp(hero, db)) return undefined;
  const classId = hero.classes[0]!.classId;
  const ch = autoLevelChoices(hero, db, classId);
  return {
    type: 'level_up',
    classId,
    hpMode: 'average',
    ...(ch.subclassId && { subclassId: ch.subclassId }),
    ...(ch.feat && { feat: { featId: ch.feat.featId, ...(ch.feat.increases && { increases: ch.feat.increases as Record<string, number> }) } }),
    ...(ch.cantrips && { cantrips: ch.cantrips }),
    ...(ch.spells && { spells: ch.spells }),
    ...(ch.weaponMasteries && { weaponMasteries: ch.weaponMasteries }),
    ...(ch.expertise && { expertise: ch.expertise }),
    ...(ch.skills && { skills: ch.skills }),
  };
}
