import { describe, expect, it } from 'vitest';
import loreJson from '../../../data/world/lore.json';
import shopsJson from '../../../data/world/shops.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { MINUTES_PER_DAY } from './clock';
import { changeReputation } from './factions';
import { LoreSchema } from './lore';
import {
  availableRarities,
  baseValue,
  buy,
  buyPrice,
  findShop,
  haggle,
  isOpen,
  sell,
  sellPrice,
  settlementOf,
  shopState,
  ShopTableSchema,
  type ShopContext,
} from './shops';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const table = ShopTableSchema.parse(shopsJson);

function ctx(hour = 10): ShopContext {
  const hero = buildCharacter(toBuildInput(quickBuild('bard', db, Rng.fromSeed('b'))), db);
  const state = newGameState(hero, 'heroic', 'shop-test');
  createDefaultRegistry({ lore }).init(state);
  state.time = hour * 60;
  state.hero.coins = 100_000; // 1000 gp
  return { state, db, lore, table };
}

describe('shop data', () => {
  it('every shop is at a lore location, with a lore faction, and has stock', () => {
    const c = ctx();
    for (const s of table.shops) {
      expect(lore.locations.some((l) => l.id === s.locationId), s.id).toBe(true);
      if (s.factionId) expect(lore.factions.some((f) => f.id === s.factionId), s.id).toBe(true);
      expect(shopState(s, c).stock.length, s.id).toBeGreaterThan(0);
      for (const line of shopState(s, c).stock) expect(baseValue(db, line.itemId), line.itemId).toBeDefined();
    }
  });
});

describe('values and availability', () => {
  it('uses SRD equipment costs and magic item values by rarity (consumables half)', () => {
    expect(baseValue(db, 'rope')).toBe(db.item('rope')!.cost);
    expect(baseValue(db, 'potion_of_healing')).toBe(50 * 100);
    expect(baseValue(db, 'no_such_item')).toBeUndefined();
  });

  it('follows SRD availability: common in towns, up to rare in cities, none in villages', () => {
    expect(settlementOf(lore, 'millbrook')).toBe('village');
    expect(settlementOf(lore, 'highcrown')).toBe('city');
    expect(availableRarities('village')).toEqual([]);
    expect(availableRarities('town')).toEqual(['common']);
    expect(availableRarities('city')).toEqual(['common', 'uncommon', 'rare']);
    const c = ctx();
    const arcana = shopState(findShop(c, 'highcrown_arcana')!, c).stock;
    for (const l of arcana) expect(['common', 'uncommon', 'rare']).toContain(db.magicItems.get(l.itemId)?.rarity);
  });
});

describe('stock and restock', () => {
  it('is deterministic per campaign and restocks each period', () => {
    const def = findShop(ctx(), 'marrows_goods')!;
    const a = ctx();
    const b = ctx();
    expect(shopState(def, a).stock).toEqual(shopState(def, b).stock);
    const first = shopState(def, a).stock.map((l) => l.itemId);
    a.state.time += def.restockDays * MINUTES_PER_DAY;
    expect(shopState(def, a).stock.map((l) => l.itemId)).not.toEqual(first);
  });
});

describe('trading', () => {
  it('buying moves coins, stock and items; selling pays half and floods the market', () => {
    const c = ctx();
    const def = findShop(c, 'brightwater_market')!;
    const line = shopState(def, c).stock.find((l) => l.qty >= 3)!;
    const price = buyPrice(def, c, line.itemId)!;
    const coins = c.state.hero.coins;
    expect(buy(c, def.id, line.itemId, 2)).toEqual({ ok: true, coins: -price * 2 });
    expect(c.state.hero.coins).toBe(coins - price * 2);
    const entry = c.state.hero.inventory.find((i) => i.itemId === line.itemId && !i.equipped)!;
    expect(entry.quantity).toBeGreaterThanOrEqual(2);

    const firstOffer = sellPrice(def, c, line.itemId)!;
    expect(firstOffer).toBe(Math.floor(baseValue(db, line.itemId)! / 2));
    const r = sell(c, def.id, entry.uid, 2);
    expect(r.ok).toBe(true);
    expect(sellPrice(def, c, line.itemId)!).toBeLessThan(firstOffer);
  });

  it('refuses when closed, when hostile, when broke or out of stock', () => {
    const night = ctx(22);
    expect(isOpen(findShop(night, 'marrows_goods')!, night.state.time)).toBe(false);
    expect(buy(night, 'marrows_goods', 'rope')).toEqual({ ok: false, error: "Marrow's Goods is closed right now." });

    const c = ctx();
    const def = findShop(c, 'brightwater_forge')!;
    const item = shopState(def, c).stock[0]!.itemId;
    expect(buy(c, def.id, item, 99)).toEqual({ ok: false, error: 'Not enough in stock.' });
    c.state.hero.coins = 0;
    expect(buy(c, def.id, item)).toEqual({ ok: false, error: 'You cannot afford that.' });
    changeReputation(c.state, 'ironvault_consortium', -80, lore);
    expect(buy(c, def.id, item)).toEqual({ ok: false, error: 'The Brightwater Forge refuses to trade with you.' });
  });

  it('reputation, region and haggling change prices', () => {
    const c = ctx();
    const def = findShop(c, 'brightwater_forge')!;
    const item = shopState(def, c).stock.find((l) => l.qty >= 2)?.itemId ?? shopState(def, c).stock[0]!.itemId;
    const neutral = buyPrice(def, c, item)!;
    changeReputation(c.state, 'ironvault_consortium', 55, lore); // Honored → ×0.8
    expect(buyPrice(def, c, item)!).toBeLessThan(neutral);

    // Haggle once a day; success gives 10% off.
    let found = false;
    for (let seed = 0; seed < 30 && !found; seed++) {
      const h = ctx();
      const before = buyPrice(def, h, item)!;
      const r = haggle({ ...h, rng: Rng.fromSeed(seed) }, def.id);
      if (!r.ok) throw new Error(r.error);
      expect(r.roll.target?.value).toBe(15);
      expect(haggle({ ...h, rng: Rng.fromSeed(seed) }, def.id)).toEqual({ ok: false, error: 'The shopkeeper will not haggle again today.' });
      if (r.success) {
        found = true;
        expect(buyPrice(def, h, item)!).toBeLessThan(before);
      }
    }
    expect(found).toBe(true);
  });
});
