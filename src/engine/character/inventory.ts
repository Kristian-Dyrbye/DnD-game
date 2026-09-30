/**
 * Inventory helpers shared by loot, shops and trading, plus equipping. Weapons, armor and magic
 * items are unique entries (one per item, so they can be equipped separately); everything else
 * stacks. Equipping keeps slots consistent (one armor, shield vs two-handed/off-hand, 3 worn
 * magic items as the SRD attunement limit) and recomputes AC and speed.
 */
import type { Character, InventoryItem } from '../core/creature';
import type { SrdDatabase } from '../data/srd';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { armorClass, baseSpeed } from './derived';

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

// ---------------------------------------------------------------- equipping

export type EquipSlot = NonNullable<InventoryItem['equipped']>;

/** Slots an item can go in (first = default). Empty when it can't be equipped. */
export function equipSlots(itemId: string, db: SrdDatabase): EquipSlot[] {
  const armor = db.armor.get(itemId);
  if (armor) return [armor.category === 'shield' ? 'shield' : 'armor'];
  const weapon = db.weapons.get(itemId);
  if (weapon) return weapon.properties.includes('light') ? ['main_hand', 'off_hand'] : ['main_hand'];
  const magic = db.magicItems.get(itemId);
  if (magic && ['ring', 'wondrous_item', 'staff', 'rod', 'wand'].includes(magic.category)) return ['worn'];
  return [];
}

/** Recomputes AC and walking speed after the equipment changed. */
export function refreshDerived(hero: Character, db: SrdDatabase): void {
  hero.ac = armorClass(hero, db).ac;
  hero.speed = { ...hero.speed, walk: baseSpeed(hero, db) };
}

export type EquipResult = { ok: true } | { ok: false; error: string };

/** Equips an inventory entry, freeing whatever the slot (or a two-handed grip) needs. */
export function equipItem(hero: Character, uid: string, db: SrdDatabase, slot?: EquipSlot, { m }: Messages = ENGLISH_MESSAGES): EquipResult {
  const entry = hero.inventory.find((i) => i.uid === uid);
  if (!entry) return { ok: false, error: m('equip.notOwned') };
  const slots = equipSlots(entry.itemId, db);
  const target = slot ?? slots[0];
  if (!target || !slots.includes(target)) return { ok: false, error: m('equip.wrongSlot') };
  const clear = (s: EquipSlot) => hero.inventory.forEach((i) => i.equipped === s && i.uid !== uid && delete i.equipped);
  const twoHanded = (i: InventoryItem | undefined) => !!i && !!db.weapons.get(i.itemId)?.properties.includes('two_handed');
  if (target === 'worn') {
    if (hero.inventory.filter((i) => i.equipped === 'worn').length >= 3 && entry.equipped !== 'worn') return { ok: false, error: m('equip.threeWorn') };
  } else clear(target);
  if (target === 'main_hand' && twoHanded(entry)) {
    clear('shield');
    clear('off_hand');
  }
  if (target === 'shield' || target === 'off_hand') {
    const main = hero.inventory.find((i) => i.equipped === 'main_hand');
    if (twoHanded(main)) delete main!.equipped;
    if (target === 'shield') clear('off_hand');
    else clear('shield');
  }
  entry.equipped = target;
  refreshDerived(hero, db);
  return { ok: true };
}

export function unequipItem(hero: Character, uid: string, db: SrdDatabase, { m }: Messages = ENGLISH_MESSAGES): EquipResult {
  const entry = hero.inventory.find((i) => i.uid === uid);
  if (!entry?.equipped) return { ok: false, error: m('equip.notEquipped') };
  delete entry.equipped;
  refreshDerived(hero, db);
  return { ok: true };
}

export function itemName(itemId: string, db: SrdDatabase): string {
  return db.item(itemId)?.name ?? db.magicItems.get(itemId)?.name ?? itemId.replace(/_/g, ' ');
}
