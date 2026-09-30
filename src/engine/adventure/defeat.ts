/**
 * Defeat and death (spec §9). Heroic mode: losing a fight is a setback, not death — the first
 * matching defeat outcome (data/tables/defeat-outcomes.json, from the campaign bible) heals the
 * hero to 1 HP, moves the clock (and maybe the party), costs money or an item, and bumps
 * world.times_defeated. Hardcore mode: a hero who dies stays dead; a new hero can continue in the
 * same world (flags, map, reputation, time and the adventure's progress are kept).
 */
import { z } from 'zod';
import { removeItem } from '../character/inventory';
import type { Character } from '../core/creature';
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import type { GameState } from '../session/gameState';
import type { FlagRegistry } from '../world/flags';
import type { Lore } from '../world/lore';
import { arriveAt, getMap } from '../world/travel';
import { applyFlagWrites, evalCondition } from './conditions';
import { conditionContext, getProgress } from './runner';
import { ConditionSchema, FlagWriteSchema, type Condition } from './schema';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

type When = { locations?: string[]; regions?: string[]; enemyTypes?: string[]; enemyTags?: string[]; if?: Condition; any?: When[] };
const WhenSchema: z.ZodType<When> = z.lazy(() =>
  z.object({
    locations: z.array(z.string()).optional(),
    regions: z.array(z.string()).optional(),
    enemyTypes: z.array(z.string()).optional(),
    enemyTags: z.array(z.string()).optional(),
    if: ConditionSchema.optional(),
    any: z.array(WhenSchema).optional(),
  }),
);

export const DefeatTableSchema = z.object({
  outcomes: z.array(
    z.object({
      id: z.string(),
      when: WhenSchema,
      text: z.string(),
      minutes: z.number().int().min(0),
      relocate: z.string().optional(),
      coinsLost: z.number().int().min(0).optional(),
      coinsLostFraction: z.number().min(0).max(1).optional(),
      loseItem: z.boolean().optional(),
      exhaustion: z.number().int().min(0).max(2).optional(),
      flags: z.array(FlagWriteSchema).default([]),
    }),
  ),
  enemyTagRules: z.array(z.object({ tag: z.string(), monsters: z.array(z.string()) })).default([]),
});
export type DefeatTable = z.infer<typeof DefeatTableSchema>;
export type DefeatOutcome = DefeatTable['outcomes'][number];

export interface DefeatSituation {
  locationId?: string;
  regionId?: string;
  /** Monster ids of the enemies (the encounter's). */
  enemies: string[];
}

function matches(w: When, s: DefeatSituation, table: DefeatTable, db: SrdDatabase, state: GameState, flags?: FlagRegistry): boolean {
  if (w.any && !w.any.some((x) => matches(x, s, table, db, state, flags))) return false;
  if (w.locations && !(s.locationId && w.locations.includes(s.locationId))) return false;
  if (w.regions && !(s.regionId && w.regions.includes(s.regionId))) return false;
  if (w.enemyTypes && !s.enemies.some((id) => w.enemyTypes!.includes(db.monsters.get(id)?.creatureType ?? ''))) return false;
  if (w.enemyTags) {
    const tagged = new Set(table.enemyTagRules.filter((r) => w.enemyTags!.includes(r.tag)).flatMap((r) => r.monsters));
    if (!s.enemies.some((id) => tagged.has(id))) return false;
  }
  if (w.if && !evalCondition(w.if, conditionContext(state, getProgress(state), flags))) return false;
  return true;
}

export function pickDefeatOutcome(table: DefeatTable, s: DefeatSituation, db: SrdDatabase, state: GameState, flags?: FlagRegistry): DefeatOutcome {
  return table.outcomes.find((o) => matches(o.when, s, table, db, state, flags)) ?? table.outcomes.at(-1)!;
}

export interface DefeatResult {
  outcome: DefeatOutcome;
  facts: string[];
  coinsLost: number;
  itemLost?: string;
  movedTo?: string;
}

/** Applies a Heroic defeat outcome to the state (hero, clock, map, flags). */
export function applyDefeat(state: GameState, o: DefeatOutcome, deps: { lore?: Lore; rng: Rng; flags?: FlagRegistry; regionId?: string; msgs?: Messages }): DefeatResult {
  const hero = state.hero;
  hero.hp = Math.max(1, hero.hp);
  hero.dead = false;
  hero.deathSaves = { successes: 0, failures: 0, stable: false };
  hero.conditions = hero.conditions.filter((c) => c.condition !== 'unconscious');
  for (const c of state.companions) if (c.hp <= 0) c.deathSaves = { ...c.deathSaves, stable: true };
  state.time += o.minutes;
  const coinsLost = Math.min(hero.coins, (o.coinsLost ?? 0) + Math.floor(hero.coins * (o.coinsLostFraction ?? 0)));
  hero.coins -= coinsLost;
  hero.exhaustion = Math.min(6, hero.exhaustion + (o.exhaustion ?? 0));
  let itemLost: string | undefined;
  if (o.loseItem) {
    const pool = hero.inventory.filter((i) => !i.equipped);
    if (pool.length) {
      const it = deps.rng.pick(pool);
      itemLost = it.itemId;
      removeItem(hero, it.uid, it.quantity);
    }
  }
  applyFlagWrites(state.flags, [...o.flags, { inc: 'world.times_defeated', by: 1 }], deps.flags);
  let movedTo: string | undefined;
  if (o.relocate && deps.lore) {
    const target =
      o.relocate === 'temple'
        ? deps.lore.locations.find((l) => (l.tags.includes('temple') || l.kind === 'temple') && l.regionId === deps.regionId)?.id ?? deps.lore.locations.find((l) => l.tags.includes('temple'))?.id
        : o.relocate;
    const map = getMap(state);
    if (target && map) {
      arriveAt(map, deps.lore, target);
      movedTo = target;
    }
  }
  const { m } = deps.msgs ?? ENGLISH_MESSAGES;
  const facts = [o.text, ...(coinsLost ? [m('defeat.coinsLost', { coins: m('coins.gp', { n: Math.floor(coinsLost / 100) }) })] : []), ...(itemLost ? [m('defeat.itemLost')] : [])];
  return { outcome: o, facts, coinsLost, ...(itemLost && { itemLost }), ...(movedTo && { movedTo }) };
}

/** Hardcore: records the fallen hero (for the world's memory and the journal). */
export function recordFallen(state: GameState, hero: Character, cause: string): void {
  const fallen = (state.extensions.fallen as { name: string; level: number; at: number; cause: string }[] | undefined) ?? [];
  fallen.push({ name: hero.name, level: hero.classes.reduce((s, c) => s + c.level, 0), at: state.time, cause });
  state.extensions.fallen = fallen;
}
