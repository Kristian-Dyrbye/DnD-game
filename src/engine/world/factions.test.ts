import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { evalCondition } from '../adventure/conditions';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import {
  canUseSafeHouse,
  changeReputation,
  describeChange,
  getReputation,
  priceMultiplier,
  refusesService,
  reputationMap,
  tierAtLeast,
  tierOf,
} from './factions';
import { LoreSchema } from './lore';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const hero = () => buildCharacter(toBuildInput(quickBuild('cleric', db, Rng.fromSeed('c'))), db);

function fresh() {
  const s = newGameState(hero(), 'heroic', 1);
  createDefaultRegistry({ lore }).init(s);
  return s;
}

describe('tiers', () => {
  it('maps scores to the campaign-bible tiers', () => {
    expect([-100, -60, -59, -20, -19, 0, 19, 20, 49, 50, 79, 80, 100].map(tierOf)).toEqual([
      'hostile', 'hostile', 'unfriendly', 'unfriendly', 'neutral', 'neutral', 'neutral', 'friendly', 'friendly', 'honored', 'honored', 'revered', 'revered',
    ]);
    expect(tierAtLeast(25, 'friendly')).toBe(true);
    expect(tierAtLeast(25, 'honored')).toBe(false);
  });

  it('gates prices, service and safe houses', () => {
    expect(priceMultiplier(-70)).toBeUndefined();
    expect(refusesService(-70)).toBe(true);
    expect(priceMultiplier(-30)).toBe(1.25);
    expect(priceMultiplier(0)).toBe(1);
    expect(priceMultiplier(85)).toBe(0.7);
    expect(canUseSafeHouse(19)).toBe(false);
    expect(canUseSafeHouse(20)).toBe(true);
  });
});

describe('reputation', () => {
  it('starts from lore defaults via the factions system', () => {
    const s = fresh();
    expect(getReputation(s, 'hollow_choir', lore)).toBe(-60);
    expect(getReputation(s, 'lantern_wardens', lore)).toBe(-10);
    expect(Object.keys(reputationMap(s))).toHaveLength(lore.factions.length);
  });

  it('ripples half to allies and the opposite half to enemies, clamped, with tier changes', () => {
    const s = fresh();
    const changes = changeReputation(s, 'crown_of_aurelmark', 25, lore);
    expect(changes[0]).toEqual({ faction: 'crown_of_aurelmark', delta: 25, from: 0, to: 25, newTier: 'friendly' });
    expect(getReputation(s, 'order_of_the_dawn_lance')).toBe(12);
    expect(getReputation(s, 'red_gull_brotherhood')).toBe(-12);
    expect(getReputation(s, 'hollow_choir')).toBe(-72);
    expect(changes.find((c) => c.faction === 'order_of_the_dawn_lance')).toMatchObject({ ripple: true });
    // Neutral third parties are untouched.
    expect(getReputation(s, 'tidewright_guild')).toBe(0);
    changeReputation(s, 'crown_of_aurelmark', 500, lore);
    expect(getReputation(s, 'crown_of_aurelmark')).toBe(100);
    expect(describeChange(changes[0]!, lore)).toBe('The Crown of Aurelmark: +25 reputation (now Friendly)');
  });

  it('conditions can require a tier', () => {
    const s = fresh();
    changeReputation(s, 'crown_of_aurelmark', 55, lore);
    const ctx = { flags: {}, timeOfDay: 'day' as const, reputation: reputationMap(s), level: 1, visited: new Set<string>() };
    expect(evalCondition({ reputation: { faction: 'crown_of_aurelmark', tier: 'honored' } }, ctx)).toBe(true);
    expect(evalCondition({ reputation: { faction: 'crown_of_aurelmark', tier: 'revered' } }, ctx)).toBe(false);
    expect(evalCondition({ reputation: { faction: 'hollow_choir', tier: 'neutral' } }, ctx)).toBe(false);
  });

  it('adventure outcomes change reputation with ripples and log it', async () => {
    const adventure = validateAdventure(structuredClone(demo), db).adventure!;
    const session = new GameSession({
      actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore }),
      newSeed: () => 's',
      systems: createDefaultRegistry({ lore }),
    });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    const s = session.current;
    s.flags['adv.millbrook_demo.rats_cleared'] = true;
    await session.handle({ type: 'choose', actionId: 'claim_reward' });
    expect(getReputation(s, 'crown_of_aurelmark')).toBe(1);
    expect(events.some((e) => e.type === 'log' && e.entry.text === 'The Crown of Aurelmark: +1 reputation')).toBe(true);
  });
});
