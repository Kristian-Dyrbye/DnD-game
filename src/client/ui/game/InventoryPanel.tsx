/** Inventory (spec §11.5 UI): carried items grouped by kind, equip/unequip, coins, AC and speed. */
import { equipSlots, itemName, type EquipSlot } from '../../../engine/character/inventory';
import { db, shops } from '../../data';
import { repairCost, wearLabel } from '../../../engine/character/armorWear';
import { shopsAt } from '../../../engine/world/shops';
import { getMap } from '../../../engine/world/travel';
import { gameState, send } from '../../net/gameSocket';
import { formatCoins } from '../text';

const SLOT_LABEL: Record<EquipSlot, string> = { armor: 'Armor', shield: 'Shield', main_hand: 'Main hand', off_hand: 'Off hand', worn: 'Worn' };

function kindOf(itemId: string): string {
  if (db.weapons.has(itemId)) return 'Weapons';
  if (db.armor.has(itemId)) return 'Armor';
  if (db.magicItems.has(itemId)) return 'Magic items';
  return 'Gear';
}

export function InventoryPanel({ onClose }: { onClose: () => void }) {
  const hero = gameState.value?.hero;
  if (!hero) return null;
  const here = gameState.value ? getMap(gameState.value)?.current : undefined;
  const smith = here ? shopsAt(shops, here).find((s) => s.kind === 'smith') : undefined;
  const groups = new Map<string, typeof hero.inventory>();
  for (const i of hero.inventory) groups.set(kindOf(i.itemId), [...(groups.get(kindOf(i.itemId)) ?? []), i]);
  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Inventory">
      <section class="journal inventory">
        <header class="journal-head">
          <h2>Inventory</h2>
          <span class="muted small">
            AC {hero.ac} · Speed {hero.speed.walk} ft · {formatCoins(hero.coins)}
          </span>
          <button type="button" onClick={onClose} aria-label="Close inventory">
            Close
          </button>
        </header>
        <div class="inventory-body">
          {hero.inventory.length === 0 && <p class="hint">You carry nothing but the clothes on your back.</p>}
          {[...groups.entries()].map(([kind, items]) => (
            <section key={kind}>
              <h3>{kind}</h3>
              <ul class="inventory-list">
                {items.map((i) => {
                  const slots = equipSlots(i.itemId, db);
                  return (
                    <li key={i.uid} class={i.equipped ? 'equipped' : ''}>
                      <span class="item-name">
                        {i.quantity > 1 && <span class="muted">{i.quantity} × </span>}
                        {itemName(i.itemId, db)}
                        {i.equipped && <span class="tag tag-equipped">{SLOT_LABEL[i.equipped]}</span>}
                        {(i.wear ?? 0) > 0 && (
                          <span class="tag tag-wear" title={`Wear ${i.wear}/100 (cosmetic)`}>
                            {wearLabel(i.wear ?? 0)}
                          </span>
                        )}
                      </span>
                      <span class="item-actions">
                        {(i.wear ?? 0) > 0 && smith && (
                          <button type="button" title={`${smith.name} repairs it fully (1 hour)`} onClick={() => send({ type: 'repair', uid: i.uid, how: 'smith', shopId: smith.id })}>
                            Repair ({formatCoins(repairCost(i, db))})
                          </button>
                        )}
                        {(i.wear ?? 0) > 0 && (
                          <button type="button" title="Mend it yourself: 8 hours, removes up to half the wear" onClick={() => send({ type: 'repair', uid: i.uid, how: 'self' })}>
                            Mend (8 h)
                          </button>
                        )}
                        {i.equipped ? (
                          <button type="button" onClick={() => send({ type: 'unequip', uid: i.uid })}>
                            Unequip
                          </button>
                        ) : (
                          slots.map((s) => (
                            <button key={s} type="button" onClick={() => send({ type: 'equip', uid: i.uid, slot: s })}>
                              {slots.length > 1 ? SLOT_LABEL[s] : 'Equip'}
                            </button>
                          ))
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
