/**
 * Armor wear (spec §12): dents, scratches and tears accumulate on equipped armor and shields as
 * the wearer is hit in combat, and are cleared by repairing — for gold at a smith (an hour) or by
 * mending it yourself during downtime (8 hours, removes up to 50 wear). Wear is cosmetic (model
 * overlay, inventory label, narration); it never changes AC.
 *
 * Combat counts hits per character (CombatState.armorHits); `wearFromFight` applies them when the
 * fight ends: armor +3 per hit, shields +2, both doubled for critical hits, capped at 100.
 */
import type { Character, InventoryItem } from '../core/creature';
import type { SrdDatabase } from '../data/srd';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

export const WEAR_MAX = 100;
export const WEAR_PER_HIT = { armor: 3, shield: 2 } as const;
export const SMITH_MINUTES = 60;
export const MEND_MINUTES = 480;
export const MEND_AMOUNT = 50;

export interface HitTally {
  hits: number;
  crits: number;
}

export function wearLabel(wear: number): string {
  if (wear <= 0) return 'pristine';
  if (wear < 25) return 'scuffed';
  if (wear < 50) return 'scratched';
  if (wear < 75) return 'dented';
  return 'battered';
}

/** Wear of the character's equipped body armor (0 when none). */
export function armorWear(c: Pick<Character, 'inventory'>): number {
  return c.inventory.find((i) => i.equipped === 'armor')?.wear ?? 0;
}

/** Wear added to equipped armor and shield after being hit `t.hits` times (`t.crits` of them critical). */
export function wearFromFight(c: Character, t: HitTally): Character {
  if (t.hits <= 0) return c;
  const weighted = t.hits + t.crits; // crits count double
  const inventory = c.inventory.map((i): InventoryItem => {
    const per = i.equipped === 'armor' ? WEAR_PER_HIT.armor : i.equipped === 'shield' ? WEAR_PER_HIT.shield : 0;
    if (!per) return i;
    return { ...i, wear: Math.min(WEAR_MAX, (i.wear ?? 0) + per * weighted) };
  });
  return { ...c, inventory };
}

/** Smith's price to repair an item fully: a quarter of its value scaled by wear, at least 1 gp (copper). */
export function repairCost(item: InventoryItem, db: SrdDatabase): number {
  const wear = item.wear ?? 0;
  if (wear <= 0) return 0;
  const base = db.armor.get(item.itemId)?.cost ?? 1000;
  return Math.max(100, Math.round((base * 0.25 * wear) / WEAR_MAX));
}

export type RepairResult = { ok: true; character: Character; coins: number; minutes: number; text: string } | { ok: false; error: string };

/** Repair at a smith: pay and wait an hour; the item is as good as new. */
export function repairAtSmith(c: Character, uid: string, db: SrdDatabase, { m }: Messages = ENGLISH_MESSAGES): RepairResult {
  const item = c.inventory.find((i) => i.uid === uid);
  if (!item || !(item.wear ?? 0)) return { ok: false, error: m('repair.notNeeded') };
  const cost = repairCost(item, db);
  if (c.coins < cost) return { ok: false, error: m('repair.cantAfford') };
  return {
    ok: true,
    character: { ...c, coins: c.coins - cost, inventory: c.inventory.map((i) => (i.uid === uid ? { ...i, wear: 0 } : i)) },
    coins: cost,
    minutes: SMITH_MINUTES,
    text: m('repair.smith'),
  };
}

/** Mend it yourself during downtime: 8 hours, removes up to 50 wear, free. */
export function mendYourself(c: Character, uid: string, { m }: Messages = ENGLISH_MESSAGES): RepairResult {
  const item = c.inventory.find((i) => i.uid === uid);
  if (!item || !(item.wear ?? 0)) return { ok: false, error: m('repair.mendNotNeeded') };
  return {
    ok: true,
    character: { ...c, inventory: c.inventory.map((i) => (i.uid === uid ? { ...i, wear: Math.max(0, (i.wear ?? 0) - MEND_AMOUNT) } : i)) },
    coins: 0,
    minutes: MEND_MINUTES,
    text: m('repair.mend'),
  };
}
