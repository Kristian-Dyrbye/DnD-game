import { describe, expect, it } from 'vitest';
import ch2 from '../data/adventures/arc1/ch2_salt_and_treason.json';
import ch3 from '../data/adventures/arc1/ch3_the_gilded_lie.json';

type Json = Record<string, unknown>;
function action(adv: Json, id: string): Json {
  for (const ch of adv.chapters as Json[]) for (const sc of ch.scenes as Json[]) for (const a of (sc.actions as Json[] | undefined) ?? []) if (a.id === id) return a;
  throw new Error(id);
}
const failure = (a: Json) => (a.check as Json).failure as Json;

describe('chapters 1–3 use the A068c/A091 outcomes (A101c)', () => {
  it('bribes and restitution cost real coins and are gated on having them', () => {
    for (const [adv, id, cp] of [[ch2, 'bribe_lusk', 5000], [ch2, 'bribe_lusk_lie', 5000], [ch3, 'jail_bribe', 15000], [ch3, 'pay_restitution', 30000]] as const) {
      const a = action(adv as Json, id);
      expect(JSON.stringify(a.if)).toContain(`"coins":{"gte":${cp}}`);
      const paid = (a.outcome as Json | undefined)?.cost ?? ((a.check as Json).success as Json).cost;
      expect(paid).toBe(cp);
    }
  });

  it('traps and falls deal real damage; dramatic wounds leave scars', () => {
    expect(failure(action(ch2 as Json, 'door_1')).damage).toEqual({ dice: '2d6', type: 'fire', save: { ability: 'dex', dc: 13, half: true } });
    expect(failure(action(ch3 as Json, 'climb_first')).damage).toEqual({ dice: '3d6', type: 'bludgeoning' });
    expect(failure(action(ch3 as Json, 'climb_first')).scar).toMatchObject({ location: 'brow' });
    expect(failure(action(ch3 as Json, 'keep_watch')).scar).toMatchObject({ location: 'left_shoulder' });
    const kestrel = (ch2.encounters as Json[]).find((e) => e.id === 'kestrel_alarm')!;
    expect((kestrel.win as Json).scar).toMatchObject({ location: 'neck' });
  });
});
