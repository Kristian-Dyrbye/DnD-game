/**
 * Story policy for automated starter-arc playthroughs (A106 server smoke test, A128 web smoke test):
 * picks the next offered action by scene and flags, so failed checks just take the other branch.
 */
import type { Flags } from '../../src/engine/world/flags';

const S = 'arc.starter.';

/** The next story action, from what is offered and what has happened. */
export function nextStarterChoice(scene: string, flags: Flags, offered: string[]): string | undefined {
  const f = (k: string) => flags[`${S}${k}`];
  const first = (...ids: string[]) => ids.find((id) => offered.includes(id));
  switch (scene) {
    case 'millbrook_arrival':
      if (!f('altar_won')) return first('well.examine', f('barrow_key') ? 'exit.hill' : 'exit.tavern');
      if (!f('slept')) return first('exit.tavern');
      if (!f('oath_done')) return first('wait_evening', 'wait_night', 'exit.shop');
      return first('exit.road');
    case 'plough_tavern_talk':
      if (f('altar_won')) return f('slept') ? first('exit.out') : first('sleep_free', 'sleep_paid', 'sleep_barred', 'exit.out');
      return first('persuade_reeve', 'intimidate_reeve', 'deposit', 'exit.out');
    case 'gallows_hill_trail':
      return first('track', 'ford_athletics', 'ford_acrobatics', 'sneak', 'exit.barrow', 'exit.force', 'exit.back');
    case 'barrow_of_the_first_sheaf':
      return first('exit.crypt');
    case 'barrow_sheaf_crypt':
      return first('slip_chains', 'free_corwin', 'bind_wounds', 'exit.altar');
    case 'barrow_tithe_altar':
      return first('rematch', 'free_fast', 'free_tools', 'chase', 'exit.shrine');
    case 'barrow_shrine_rest':
      return first('rekindle', 'rekindle_nature', 'rest_safe', 'rest_cold', 'exit.home');
    case 'marrows_goods_and_oath':
      return first('return_ring', 'recruit', 'recruit_cruel', 'go_alone', 'exit.green');
    case 'road_south':
      return first('to_ravensgate');
    case 'road_ravensgate':
      return first('arrive');
    case 'road_brightwater':
      return first('pay', 'talk_down', 'fight', 'hand_over', 'keep');
  }
  return undefined;
}
