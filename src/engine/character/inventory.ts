/**
 * Inventory helpers shared by loot, shops and trading. Weapons, armor and magic items are unique
 * entries (one per item, so they can be equipped separately); everything else stacks.
 */
import type { Character, InventoryItem } from '../core/creature';
import type { SrdDatabase } from '../data/srd';

export function isUniqueItem(itemId: string, db?: SrdDatabase): boolean {
  return db ? db.weapons.has(itemId) || db.armor.has(itemId) || db.magicItems.has(itemId) : false;
}

function nextUid(inv: readonly InventoryItem[]): string {
  return `i${inv.reduce((m, i) => Math.max(m, Number(i.uid.replace(/\D/g, '')) || 0), 0) + 1}`;
}

/** Adds items (stacking where possible). Returns the uids that were created or grew. */
export function addItem(hero: Character, itemId: string, quantity: number, db?: SrdDatabase): string[] {
  if (quantity <= 0) return [];
  if (isUniqueItem(itemId, db)) {
    const uids: string[] = [];
    for (let i = 0; i < quantity; i++) {
      const uid = nextUid(hero.inventory);
      hero.inventory.push({ uid, itemId, quantity: 1 });
      uids.push(uid);
    }
    return uids;
  }
  const existing = hero.inventory.find((i) => i.itemId === itemId && !i.equipped);
  if (existing) {
    existing.quantity += quantity;
    return [existing.uid];
  }
  const uid = nextUid(hero.inventory);
  hero.inventory.push({ uid, itemId, quantity });
  return [uid];
}

/** Removes `quantity` from an inventory entry (dropping it when empty). Returns false if not enough. */
export function removeItem(hero: Character, uid: string, quantity: number): boolean {
  const entry = hero.inventory.find((i) => i.uid === uid);
  if (!entry || quantity <= 0 || entry.quantity < quantity) return false;
  entry.quantity -= quantity;
  if (entry.quantity === 0) hero.inventory = hero.inventory.filter((i) => i.uid !== uid);
  return true;
}
