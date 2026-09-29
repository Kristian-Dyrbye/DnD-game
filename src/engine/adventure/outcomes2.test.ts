import { describe, expect, it } from 'vitest';
import flagsJson from '../../../data/adventures/flags.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import type { Rng } from '../core/rng';
import { Rng as RealRng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { playerAct, setupEncounter } from '../combat/encounter';
import { createGrid } from '../combat/grid';
import { availableActions, formatCoins, perform, startAdventure, type RunContext } from './runner';
import { validateAdventure } from './validate';

const db = loadSrd();
const flags = FlagRegistry.fromJson(flagsJson);

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10, next: () => 0.5 } as unknown as Rng;
}

const raw = {
  formatVersion: 1,
  id: 'outcome_test',
  name: 'Outcome test',
  kind: 'test',
  levelRange: [1, 3],
  summary: 'test',
  flags: [{ id: '~bribed', type: 'boolean', default: false, description: 'paid the guard' }],
  start: { chapter: 'c1', scene: 'gate' },
  chapters: [
    {
      id: 'c1',
      name: 'C1',
      summary: 's',
      start: 'gate',
      scenes: [
        {
          id: 'gate',
          name: 'Gate',
          seed: 'A gate.',
          actions: [
            { id: 'bribe', label: 'Bribe the guard (5 gp)', if: { coins: { gte: 500 } }, outcome: { cost: 500, text: 'He pockets it.', flags: [{ set: '~bribed' }] } },
            { id: 'overpay', label: 'Pay 1000 gp', outcome: { cost: 100000, text: 'Paid.', xp: 50 } },
            { id: 'trap', label: 'Open the chest', outcome: { damage: { dice: '10d10', type: 'piercing', save: { ability: 'dex', dc: 30 } } } },
            { id: 'march', label: 'Forced march', outcome: { exhaustion: 1 } },
            { id: 'rest', label: 'Rest', outcome: { exhaustion: -1, minutes: 180 } },
            { id: 'enter', label: 'Walk in', if: { since: { flag: '~bribed', gteHours: 2 } }, outcome: { ending: 'in' } },
          ],
        },
      ],
    },
  ],
  encounters: [{ id: 'guarded', name: 'Guarded', monsters: [{ id: 'goblin_warrior', count: 1 }], allies: [{ id: 'guard', count: 2 }] }],
  endings: [{ id: 'in', name: 'In', text: 'You are in.' }],
};

function ctx(mode: 'heroic' | 'hardcore' = 'heroic', rng: Rng = RealRng.fromSeed(1)): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, RealRng.fromSeed('o'))), db);
  const v = validateAdventure(structuredClone(raw), db, flags);
  if (!v.adventure) throw new Error(v.errors.join('\n'));
  const state = newGameState(hero, mode, 'o');
  return { state, adventure: v.adventure, rng, db, flags };
}

const ids = (c: RunContext) => availableActions(c).map((a) => a.id);

describe('adventure outcomes and conditions for authors (A068c)', () => {
  it('cost: pays when the hero can; otherwise nothing else in the outcome happens; `coins` gates the action', () => {
    const c = ctx();
    startAdventure(c);
    c.state.hero.coins = 400;
    expect(ids(c)).not.toContain('bribe');
    c.state.hero.coins = 600;
    expect(ids(c)).toContain('bribe');
    const r = perform(c, 'bribe');
    expect(c.state.hero.coins).toBe(100);
    expect(r.coins).toBe(-500);
    const xp = c.state.hero.xp;
    const poor = perform(c, 'overpay');
    expect(poor.facts[0]).toContain("can't afford");
    expect(c.state.hero.xp).toBe(xp);
    expect(formatCoins(1234)).toBe('12 gp 3 sp 4 cp');
  });

  it('since: hours after a flag was set', () => {
    const c = ctx();
    startAdventure(c);
    c.state.hero.coins = 500;
    perform(c, 'bribe');
    expect(ids(c)).not.toContain('enter');
    perform(c, 'rest'); // 3 hours pass
    expect(ids(c)).toContain('enter');
  });

  it('damage: Heroic never drops below 1 HP; Hardcore can drop to 0 (unconscious, stable); a save halves it', () => {
    const heroic = ctx('heroic', fixed(1, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1));
    startAdventure(heroic);
    perform(heroic, 'trap');
    expect(heroic.state.hero.hp).toBe(1);
    const hard = ctx('hardcore');
    startAdventure(hard);
    perform(hard, 'trap');
    expect(hard.state.hero.hp).toBe(0);
    expect(hard.state.hero.deathSaves.stable).toBe(true);
    expect(hard.state.hero.dead).toBe(false);
  });

  it('exhaustion goes up and down, clamped at 0', () => {
    const c = ctx();
    startAdventure(c);
    perform(c, 'march');
    expect(c.state.hero.exhaustion).toBe(1);
    perform(c, 'rest');
    perform(c, 'rest');
    expect(c.state.hero.exhaustion).toBe(0);
  });

  it('encounter allies fight on the party side under the AI', () => {
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, RealRng.fromSeed('a'))), db);
    const enc = setupEncounter({ hero, monsters: [{ id: 'goblin_warrior', count: 1 }], allies: [{ id: 'guard', count: 2 }], db, grid: createGrid(10, 8) }, { rng: RealRng.fromSeed('allies'), db });
    expect(enc.roster.ally_guard_1).toBe('party');
    expect(enc.state.creatures.ally_guard_2!.name).toBe('Allied Guard 2');
    for (let i = 0; i < 10 && enc.status === 'ongoing'; i++) playerAct(enc, { rng: RealRng.fromSeed(`t${i}`), db }, { kind: 'end_turn' });
    expect(enc.log.some((l) => l.startsWith('Allied Guard'))).toBe(true);
  });
});
