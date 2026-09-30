/**
 * Dynamic shops (spec §11.5). Shops are data (data/world/shops.json). Stock is generated from the
 * SRD per shop kind and restocks every `restockDays` (deterministic per campaign + period).
 * Magic items follow SRD availability (Common in towns and cities; Uncommon and Rare only in
 * cities) and SRD values by rarity (consumables half). Prices combine region, faction reputation,
 * scarcity and a once-a-day Persuasion haggle. Equipment sells for half its cost (SRD), and each
 * unit of the same item sold to a shop lowers what it pays next time (no flooding one shop).
 */
import { z } from 'zod';
import { addItem, removeItem } from '../character/inventory';
import { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import { skillCheck, type D20TestResult } from '../rules/checks';
import type { GameState } from '../session/gameState';
import { inHours } from '../adventure/conditions';
import { MINUTES_PER_DAY } from './clock';
import { getReputation, priceMultiplier } from './factions';
import type { Lore } from './lore';

export const SHOP_KINDS = ['general', 'smith', 'alchemist', 'magic'] as const;

export const ShopDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  locationId: z.string(),
  kind: z.enum(SHOP_KINDS),
  factionId: z.string().optional(),
  restockDays: z.number().int().min(1).default(7),
  hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(24) }).optional(),
});
export type ShopDef = z.infer<typeof ShopDefSchema>;

export const ShopTableSchema = z.object({ regions: z.record(z.string(), z.number().positive()).default({}), shops: z.array(ShopDefSchema) });
export type ShopTable = z.infer<typeof ShopTableSchema>;

/** SRD Magic Item Rarities and Values (GP). */
export const RARITY_VALUE_GP: Record<string, number> = { common: 100, uncommon: 400, rare: 4000, very_rare: 40000, legendary: 200000 };
export const HAGGLE_DC = 15;
const HAGGLE_BONUS = 0.1;

export interface ShopState {
  stock: { itemId: string; qty: number }[];
  /** Units of each item the player sold here since the last restock. */
  sold: Record<string, number>;
  period: number;
  haggle?: { day: number; success: boolean };
}

export interface ShopContext {
  state: GameState;
  db: SrdDatabase;
  lore: Lore;
  table: ShopTable;
  /** Language of trade errors (default English). */
  msgs?: Messages;
}

const msg = (ctx: ShopContext) => (ctx.msgs ?? ENGLISH_MESSAGES).m;

// ---------------------------------------------------------------- availability and value

type Settlement = 'village' | 'town' | 'city';

export function settlementOf(lore: Lore, locationId: string): Settlement {
  const kind = lore.locations.find((l) => l.id === locationId)?.kind;
  if (kind === 'city') return 'city';
  if (kind === 'town' || kind === 'port' || kind === 'fortress') return 'town';
  return 'village';
}

/** Magic item rarities a settlement can supply (SRD availability guidance). */
export function availableRarities(s: Settlement): string[] {
  return s === 'city' ? ['common', 'uncommon', 'rare'] : s === 'town' ? ['common'] : [];
}

/** Base value in copper: equipment cost, or SRD rarity value (consumables half) + base item cost. */
export function baseValue(db: SrdDatabase, itemId: string): number | undefined {
  const mundane = db.item(itemId);
  if (mundane) return mundane.cost;
  const magic = db.magicItems.get(itemId);
  const gp = magic ? RARITY_VALUE_GP[magic.rarity] : undefined;
  if (!magic || gp === undefined) return undefined;
  const consumable = magic.category === 'potion' || magic.category === 'scroll';
  const base = magic.baseItem ? (db.item(magic.baseItem)?.cost ?? 0) : 0;
  return (consumable ? gp * 50 : gp * 100) + base;
}

// ---------------------------------------------------------------- stock

function pool(def: ShopDef, ctx: ShopContext): string[] {
  const { db } = ctx;
  const rarities = availableRarities(settlementOf(ctx.lore, def.locationId));
  const magic = (cats: string[]) =>
    [...db.magicItems.values()].filter((m) => cats.includes(m.category) && rarities.includes(m.rarity) && !m.baseItem && baseValue(db, m.id) !== undefined).map((m) => m.id);
  switch (def.kind) {
    case 'smith':
      return [...db.weapons.keys(), ...db.armor.keys()];
    case 'alchemist':
      return [...[...db.gear.values()].filter((g) => /acid|alchemist|antitoxin|healer|holy_water|oil|perfume|poison|herbalism|potion/.test(g.id)).map((g) => g.id), ...magic(['potion'])];
    case 'magic':
      return magic(['potion', 'ring', 'wondrous_item', 'wand', 'rod', 'staff']);
    default:
      return [...db.gear.values()].filter((g) => ['adventuring_gear', 'ammunition', 'food', 'pack', 'tool'].includes(g.category)).map((g) => g.id);
  }
}

const STOCK_SIZE: Record<ShopDef['kind'], number> = { general: 14, smith: 10, alchemist: 8, magic: 6 };

function period(def: ShopDef, time: number): number {
  return Math.floor(time / (def.restockDays * MINUTES_PER_DAY));
}

export function generateStock(def: ShopDef, ctx: ShopContext, p: number): ShopState['stock'] {
  const rng = Rng.fromSeed(`${ctx.state.campaignId}:shop:${def.id}:${p}`);
  const ids = rng.shuffle(pool(def, ctx)).slice(0, STOCK_SIZE[def.kind]).sort();
  return ids.map((itemId) => {
    const unique = ctx.db.weapons.has(itemId) || ctx.db.armor.has(itemId) || ctx.db.magicItems.has(itemId);
    return { itemId, qty: unique ? rng.int(1, 2) : rng.int(3, 12) };
  });
}

/** The shop's current state, restocking (and resetting sold counts) when a new period started. */
export function shopState(def: ShopDef, ctx: ShopContext): ShopState {
  const all = ((ctx.state.extensions.shops as Record<string, ShopState> | undefined) ?? {}) as Record<string, ShopState>;
  const p = period(def, ctx.state.time);
  let s = all[def.id];
  if (!s || s.period !== p) {
    s = { stock: generateStock(def, ctx, p), sold: {}, period: p, ...(s?.haggle && { haggle: s.haggle }) };
    all[def.id] = s;
    ctx.state.extensions.shops = all;
  }
  return s;
}

// ---------------------------------------------------------------- prices

export function findShop(ctx: ShopContext, shopId: string): ShopDef | undefined {
  return ctx.table.shops.find((s) => s.id === shopId);
}

function regionMultiplier(def: ShopDef, ctx: ShopContext): number {
  const region = ctx.lore.locations.find((l) => l.id === def.locationId)?.regionId ?? '';
  return ctx.table.regions[region] ?? 1;
}

function haggleBonus(def: ShopDef, ctx: ShopContext): number {
  const h = shopState(def, ctx).haggle;
  return h && h.success && h.day === Math.floor(ctx.state.time / MINUTES_PER_DAY) ? HAGGLE_BONUS : 0;
}

/** Reputation multiplier (undefined = the shop refuses to trade). */
function repMultiplier(def: ShopDef, ctx: ShopContext): number | undefined {
  return def.factionId ? priceMultiplier(getReputation(ctx.state, def.factionId, ctx.lore)) : 1;
}

/** What the player pays for one unit (copper), or undefined if not for sale here. */
export function buyPrice(def: ShopDef, ctx: ShopContext, itemId: string): number | undefined {
  const base = baseValue(ctx.db, itemId);
  const rep = repMultiplier(def, ctx);
  const line = shopState(def, ctx).stock.find((s) => s.itemId === itemId);
  if (base === undefined || rep === undefined || !line || line.qty === 0) return undefined;
  const scarcity = line.qty === 1 ? 1.1 : 1;
  return Math.max(1, Math.round(base * regionMultiplier(def, ctx) * rep * scarcity * (1 - haggleBonus(def, ctx))));
}

/** What the shop pays for one unit: half value (SRD), better with reputation/haggling, lower as it floods. */
export function sellPrice(def: ShopDef, ctx: ShopContext, itemId: string): number | undefined {
  const base = baseValue(ctx.db, itemId);
  const rep = repMultiplier(def, ctx);
  if (base === undefined || rep === undefined) return undefined;
  const flooded = Math.max(0.2, 0.9 ** (shopState(def, ctx).sold[itemId] ?? 0));
  return Math.floor((base / 2) * Math.min(1.2, 1 / rep) * flooded * (1 + haggleBonus(def, ctx)));
}

export function isOpen(def: ShopDef, time: number): boolean {
  return !def.hours || inHours(Math.floor(time / 60) % 24, def.hours.from, def.hours.to);
}

// ---------------------------------------------------------------- trading

export type TradeResult = { ok: true; coins: number } | { ok: false; error: string };

function refusal(def: ShopDef, ctx: ShopContext): string | undefined {
  if (!isOpen(def, ctx.state.time)) return msg(ctx)('shop.closed', { shop: def.name });
  if (repMultiplier(def, ctx) === undefined) return msg(ctx)('shop.refuses', { shop: def.name });
  return undefined;
}

export function buy(ctx: ShopContext, shopId: string, itemId: string, qty = 1): TradeResult {
  const m = msg(ctx);
  const def = findShop(ctx, shopId);
  if (!def) return { ok: false, error: m('shop.none') };
  const refused = refusal(def, ctx);
  if (refused) return { ok: false, error: refused };
  const line = shopState(def, ctx).stock.find((s) => s.itemId === itemId);
  if (!line || line.qty < qty) return { ok: false, error: m('shop.noStock') };
  const unit = buyPrice(def, ctx, itemId)!;
  const cost = unit * qty;
  if (ctx.state.hero.coins < cost) return { ok: false, error: m('shop.cantAfford') };
  ctx.state.hero.coins -= cost;
  line.qty -= qty;
  addItem(ctx.state.hero, itemId, qty, ctx.db);
  return { ok: true, coins: -cost };
}

export function sell(ctx: ShopContext, shopId: string, uid: string, qty = 1): TradeResult {
  const m = msg(ctx);
  const def = findShop(ctx, shopId);
  if (!def) return { ok: false, error: m('shop.none') };
  const refused = refusal(def, ctx);
  if (refused) return { ok: false, error: refused };
  const entry = ctx.state.hero.inventory.find((i) => i.uid === uid);
  if (!entry || entry.quantity < qty) return { ok: false, error: m('shop.notEnough') };
  if (entry.equipped) return { ok: false, error: m('shop.unequipFirst') };
  const s = shopState(def, ctx);
  let paid = 0;
  // Price drops unit by unit as the shop fills up with the same item.
  for (let i = 0; i < qty; i++) {
    const unit = sellPrice(def, ctx, entry.itemId);
    if (unit === undefined) return { ok: false, error: m('shop.noUse', { shop: def.name }) };
    paid += unit;
    s.sold[entry.itemId] = (s.sold[entry.itemId] ?? 0) + 1;
  }
  removeItem(ctx.state.hero, uid, qty);
  ctx.state.hero.coins += paid;
  const line = s.stock.find((l) => l.itemId === entry.itemId);
  if (line) line.qty += qty;
  else s.stock.push({ itemId: entry.itemId, qty });
  return { ok: true, coins: paid };
}

/** Once per shop per day: DC 15 Persuasion; success = 10% better prices for the rest of the day. */
export function haggle(ctx: ShopContext & { rng: Rng }, shopId: string): { ok: false; error: string } | { ok: true; roll: D20TestResult; success: boolean } {
  const m = msg(ctx);
  const def = findShop(ctx, shopId);
  if (!def) return { ok: false, error: m('shop.none') };
  const refused = refusal(def, ctx);
  if (refused) return { ok: false, error: refused };
  const s = shopState(def, ctx);
  const day = Math.floor(ctx.state.time / MINUTES_PER_DAY);
  if (s.haggle?.day === day) return { ok: false, error: m('shop.noHaggle') };
  const roll = skillCheck(ctx.state.hero, 'persuasion', { rng: ctx.rng, dc: HAGGLE_DC });
  s.haggle = { day, success: roll.success === true };
  return { ok: true, roll, success: roll.success === true };
}

// ---------------------------------------------------------------- views (UI)

export interface ShopView {
  id: string;
  name: string;
  kind: ShopDef['kind'];
  open: boolean;
  refuses: boolean;
  /** Haggled today: undefined = not yet, true/false = the result. */
  haggled?: boolean;
  stock: { itemId: string; name: string; qty: number; price: number }[];
  /** What the shop would pay for each unequipped item the hero carries. */
  offers: { uid: string; itemId: string; name: string; qty: number; price: number }[];
}

export function shopsAt(table: ShopTable, locationId: string): ShopDef[] {
  return table.shops.filter((s) => s.locationId === locationId);
}

export function shopView(ctx: ShopContext, shopId: string): ShopView | undefined {
  const def = findShop(ctx, shopId);
  if (!def) return undefined;
  const s = shopState(def, ctx);
  const day = Math.floor(ctx.state.time / MINUTES_PER_DAY);
  const name = (id: string) => ctx.db.item(id)?.name ?? ctx.db.magicItems.get(id)?.name ?? id;
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    open: isOpen(def, ctx.state.time),
    refuses: repMultiplier(def, ctx) === undefined,
    ...(s.haggle?.day === day && { haggled: s.haggle.success }),
    stock: s.stock.filter((l) => l.qty > 0).map((l) => ({ itemId: l.itemId, name: name(l.itemId), qty: l.qty, price: buyPrice(def, ctx, l.itemId) ?? 0 })),
    offers: ctx.state.hero.inventory
      .filter((i) => !i.equipped)
      .map((i) => ({ uid: i.uid, itemId: i.itemId, name: name(i.itemId), qty: i.quantity, price: sellPrice(def, ctx, i.itemId) ?? 0 }))
      .filter((o) => o.price > 0),
  };
}
