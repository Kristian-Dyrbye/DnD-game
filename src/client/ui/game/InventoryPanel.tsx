/** Inventory (spec §11.5 UI): carried items grouped by kind, equip/unequip, coins, AC and speed. */
import { equipSlots, itemName, type EquipSlot } from '../../../engine/character/inventory';
import { db, shops } from '../../data';
import { repairCost } from '../../../engine/character/armorWear';
import { shopsAt } from '../../../engine/world/shops';
import { getMap } from '../../../engine/world/travel';
import { gameState, send } from '../../net/gameSocket';
import { coins, t } from '../i18n';
import { wearText } from './labels';

const slotLabel = (slot: EquipSlot) => t(`inv.slot.${slot}`);

type Kind = 'weapons' | 'armor' | 'magic' | 'gear';

function kindOf(itemId: string): Kind {
  if (db.weapons.has(itemId)) return 'weapons';
  if (db.armor.has(itemId)) return 'armor';
  if (db.magicItems.has(itemId)) return 'magic';
  return 'gear';
}

export function InventoryPanel({ onClose }: { onClose: () => void }) {
  const hero = gameState.value?.hero;
  if (!hero) return null;
  const here = gameState.value ? getMap(gameState.value)?.current : undefined;
  const smith = here ? shopsAt(shops, here).find((s) => s.kind === 'smith') : undefined;
  const groups = new Map<Kind, typeof hero.inventory>();
  for (const i of hero.inventory) groups.set(kindOf(i.itemId), [...(groups.get(kindOf(i.itemId)) ?? []), i]);
  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('game.inventory')}>
      <section class="journal inventory">
        <header class="journal-head">
          <h2>{t('game.inventory')}</h2>
          <span class="muted small">{t('inv.summary', { ac: hero.ac, speed: hero.speed.walk, coins: coins(hero.coins) })}</span>
          <button type="button" onClick={onClose} aria-label={t('inv.closeAria')}>
            {t('common.close')}
          </button>
        </header>
        <div class="inventory-body">
          {hero.inventory.length === 0 && <p class="hint">{t('inv.empty')}</p>}
          {[...groups.entries()].map(([kind, items]) => (
            <section key={kind}>
              <h3>{t(`inv.kind.${kind}`)}</h3>
              <ul class="inventory-list">
                {items.map((i) => {
                  const slots = equipSlots(i.itemId, db);
                  return (
                    <li key={i.uid} class={i.equipped ? 'equipped' : ''}>
                      <span class="item-name">
                        {i.quantity > 1 && <span class="muted">{i.quantity} × </span>}
                        {itemName(i.itemId, db)}
                        {i.equipped && <span class="tag tag-equipped">{slotLabel(i.equipped)}</span>}
                        {(i.wear ?? 0) > 0 && (
                          <span class="tag tag-wear" title={t('inv.wearTitle', { n: i.wear ?? 0 })}>
                            {wearText(i.wear ?? 0)}
                          </span>
                        )}
                      </span>
                      <span class="item-actions">
                        {(i.wear ?? 0) > 0 && smith && (
                          <button type="button" title={t('inv.repairTitle', { smith: smith.name })} onClick={() => send({ type: 'repair', uid: i.uid, how: 'smith', shopId: smith.id })}>
                            {t('inv.repair', { cost: coins(repairCost(i, db)) })}
                          </button>
                        )}
                        {(i.wear ?? 0) > 0 && (
                          <button type="button" title={t('inv.mendTitle')} onClick={() => send({ type: 'repair', uid: i.uid, how: 'self' })}>
                            {t('inv.mend')}
                          </button>
                        )}
                        {i.equipped ? (
                          <button type="button" onClick={() => send({ type: 'unequip', uid: i.uid })}>
                            {t('inv.unequip')}
                          </button>
                        ) : (
                          slots.map((s) => (
                            <button key={s} type="button" onClick={() => send({ type: 'equip', uid: i.uid, slot: s })}>
                              {slots.length > 1 ? slotLabel(s) : t('inv.equip')}
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
