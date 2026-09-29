import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import shopsJson from '../../../data/world/shops.json';
import type { ServerEvent } from '../../shared/protocol';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { LoreSchema } from '../world/lore';
import { ShopTableSchema } from '../world/shops';
import { buildCharacter } from './builder';
import { toBuildInput } from './creator';
import { addItem, equipItem, equipSlots, removeItem, unequipItem } from './inventory';
import { quickBuild } from './quickBuild';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const shops = ShopTableSchema.parse(shopsJson);
const fighter = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);

describe('inventory', () => {
  it('stacks gear, keeps weapons/armor separate, removes by uid', () => {
    const h = fighter();
    const n = h.inventory.length;
    const [rope] = addItem(h, 'rope', 2, db);
    addItem(h, 'rope', 1, db);
    expect(h.inventory.find((i) => i.uid === rope)?.quantity).toBeGreaterThanOrEqual(3);
    const daggers = addItem(h, 'dagger', 2, db);
    expect(daggers).toHaveLength(2);
    expect(removeItem(h, daggers[0]!, 1)).toBe(true);
    expect(removeItem(h, daggers[1]!, 5)).toBe(false);
    // One dagger left, plus the rope stack (new or grown).
    expect(h.inventory.filter((i) => daggers.includes(i.uid))).toHaveLength(1);
    expect(h.inventory.length).toBeGreaterThanOrEqual(n + 1);
  });

  it('knows which slots items use', () => {
    expect(equipSlots('shield', db)).toEqual(['shield']);
    expect(equipSlots('chain_mail', db)).toEqual(['armor']);
    expect(equipSlots('dagger', db)).toEqual(['main_hand', 'off_hand']);
    expect(equipSlots('greatsword', db)).toEqual(['main_hand']);
    expect(equipSlots('rope', db)).toEqual([]);
  });

  it('equipping updates AC and keeps hands consistent', () => {
    const h = fighter();
    const baseAc = h.ac;
    const armor = h.inventory.find((i) => i.equipped === 'armor');
    if (armor) {
      expect(unequipItem(h, armor.uid, db)).toEqual({ ok: true });
      expect(h.ac).toBeLessThan(baseAc);
      expect(equipItem(h, armor.uid, db)).toEqual({ ok: true });
      expect(h.ac).toBe(baseAc);
    }
    const [shield] = addItem(h, 'shield', 1, db);
    const [great] = addItem(h, 'greatsword', 1, db);
    expect(equipItem(h, shield!, db).ok).toBe(true);
    expect(equipItem(h, great!, db).ok).toBe(true);
    // Two-handed weapon pushes the shield off.
    expect(h.inventory.find((i) => i.uid === shield)?.equipped).toBeUndefined();
    expect(equipItem(h, shield!, db).ok).toBe(true);
    expect(h.inventory.find((i) => i.uid === great)?.equipped).toBeUndefined();
    expect(equipItem(h, 'nope', db)).toEqual({ ok: false, error: 'You do not have that.' });
    const rope = addItem(h, 'rope', 1, db)[0]!;
    expect(equipItem(h, rope, db)).toEqual({ ok: false, error: 'That cannot be equipped there.' });
  });
});

describe('inventory and shop commands', () => {
  it('equip, open a shop at the current location, buy, sell and haggle through the session', async () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const session = new GameSession({
      actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, shops }),
      systems: createDefaultRegistry({ lore }),
      newSeed: () => 'shop',
    });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: fighter(), mode: 'heroic' });
    session.current.hero.coins = 50_000;

    await session.handle({ type: 'shop_open', shopId: 'highcrown_arcana', reqId: 'far' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'That shop is not here.', reqId: 'far' });

    await session.handle({ type: 'shop_open', shopId: 'marrows_goods' });
    const view = events.filter((e) => e.type === 'shop').at(-1);
    if (view?.type !== 'shop') throw new Error('no shop view');
    expect(view.shop.name).toBe("Marrow's Goods");
    const line = view.shop.stock[0]!;
    await session.handle({ type: 'shop_buy', shopId: 'marrows_goods', itemId: line.itemId, qty: 1 });
    expect(session.current.hero.coins).toBe(50_000 - line.price);
    expect(events.some((e) => e.type === 'log' && e.entry.text.startsWith('Bought 1×'))).toBe(true);

    const bought = session.current.hero.inventory.find((i) => i.itemId === line.itemId && !i.equipped)!;
    await session.handle({ type: 'shop_sell', shopId: 'marrows_goods', uid: bought.uid, qty: 1 });
    expect(events.some((e) => e.type === 'log' && e.entry.text.startsWith('Sold 1×'))).toBe(true);

    await session.handle({ type: 'shop_haggle', shopId: 'marrows_goods' });
    expect(events.some((e) => e.type === 'roll' && e.roll.label === 'Persuasion')).toBe(true);
    await session.handle({ type: 'shop_haggle', shopId: 'marrows_goods', reqId: 'again' });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'The shopkeeper will not haggle again today.', reqId: 'again' });

    const weapon = session.current.hero.inventory.find((i) => db.weapons.has(i.itemId) && !i.equipped);
    if (weapon) {
      await session.handle({ type: 'equip', uid: weapon.uid });
      expect(session.current.hero.inventory.find((i) => i.uid === weapon.uid)?.equipped).toBeDefined();
    }
  });
});
