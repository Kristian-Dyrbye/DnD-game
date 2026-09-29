import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import flagsJson from '../../../data/adventures/flags.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema } from '../party/companions';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { bossesOf } from './fights';
import { perform, startAdventure, type RunContext } from './runner';
import { solveAdventure } from './solver';
import { validateAdventure } from './validate';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const flags = FlagRegistry.fromJson(flagsJson);

/** A tiny adventure: recruit Nettle, anger her in one step (a beat makes her leave at once), or keep her for the good ending. */
const raw = {
  formatVersion: 1,
  id: 'party_test',
  name: 'Party test',
  kind: 'test',
  levelRange: [1, 3],
  summary: 'test',
  start: { chapter: 'c1', scene: 'camp' },
  chapters: [
    {
      id: 'c1',
      name: 'C1',
      summary: 's',
      start: 'camp',
      scenes: [
        {
          id: 'camp',
          name: 'Camp',
          seed: 'A camp.',
          actions: [
            { id: 'recruit', label: 'Ask Nettle to come', once: true, outcome: { text: 'She agrees.', recruit: 'nettle' } },
            { id: 'insult', label: 'Insult her', if: { flag: 'world.nettle_status', eq: 'in_party' }, outcome: { approval: [{ companion: 'nettle', delta: -40 }] } },
            { id: 'finish', label: 'Set out together', if: { flag: 'world.nettle_status', eq: 'in_party' }, outcome: { ending: 'together' } },
          ],
        },
      ],
    },
  ],
  beats: [
    {
      id: 'nettle_goes',
      text: 'Nettle has had enough.',
      trigger: { all: [{ flag: 'world.nettle_status', eq: 'in_party' }, { flag: 'world.nettle_loyalty', lte: 20 }] },
      outcome: { companionLeaves: { id: 'nettle', status: 'left' } },
    },
  ],
  endings: [{ id: 'together', name: 'Together', text: 'You leave together.' }],
};

function ctx(withRoster: boolean, withDb = true): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('p'))), db);
  const adventure = validateAdventure(structuredClone(raw), db, flags, roster).adventure!;
  const state = newGameState(hero, 'heroic', 'party');
  return { state, adventure, rng: Rng.fromSeed(1), ...(withDb && { db }), flags, ...(withRoster && { companions: roster }) };
}

describe('party outcomes inside the runner (A068b)', () => {
  it('with a roster, recruit and approval apply in the same step, so a loyalty beat fires at once', () => {
    const c = ctx(true);
    startAdventure(c);
    const r1 = perform(c, 'recruit');
    expect(r1.partyLog).toEqual(['Nettle joins your party.']);
    expect(c.state.companions.map((x) => x.id)).toEqual(['nettle']);
    expect(r1.recruits).toBeUndefined();
    const r2 = perform(c, 'insult');
    expect(c.state.flags['world.nettle_status']).toBe('left');
    expect(c.state.companions).toHaveLength(0);
    expect(r2.partyLog?.at(-1)).toContain('leaves the party');
  });

  it('without a roster the outcomes are only collected (the caller applies them)', () => {
    const c = ctx(false);
    startAdventure(c);
    const r = perform(c, 'recruit');
    expect(r.recruits).toEqual(['nettle']);
    expect(c.state.companions).toHaveLength(0);
  });

  it('without rules data only the flags change (solver), and the solver reaches companion-gated content', () => {
    const c = ctx(true, false);
    startAdventure(c);
    perform(c, 'recruit');
    expect(c.state.flags['world.nettle_status']).toBe('in_party');
    expect(c.state.flags['world.nettle_loyalty']).toBe(50);
    expect(c.state.companions).toHaveLength(0);
    const base = ctx(true, false);
    const { rng: _r, ...noRng } = base;
    const solved = solveAdventure(noRng, 'together');
    expect(solved.ok).toBe(true);
  });

  it('the validator rejects unknown companions and bosses that are not in the fight', () => {
    const bad = structuredClone(raw) as typeof raw & { encounters?: unknown[] };
    bad.chapters[0]!.scenes[0]!.actions[0]!.outcome = { text: 'x', recruit: 'nobody' };
    bad.encounters = [{ id: 'e', name: 'E', monsters: [{ id: 'goblin_warrior', count: 2 }], bosses: ['ogre'] }];
    const r = validateAdventure(bad, db, flags, roster);
    expect(r.errors.some((e) => e.endsWith('recruit names unknown companion "nobody"'))).toBe(true);
    expect(r.errors).toContain('encounter e: boss "ogre" is not one of its monsters');
  });

  it('bosses: authored, else the single most expensive monster type', () => {
    const enc = (monsters: { id: string; count: number }[], bosses: string[] = []) => ({ id: 'e', name: 'E', monsters, terrain: [], canFlee: true, bosses, win: {}, lose: {}, flee: {} }) as unknown as Parameters<typeof bossesOf>[0];
    expect(bossesOf(enc([{ id: 'goblin_warrior', count: 4 }, { id: 'bugbear_warrior', count: 1 }]), db)).toEqual(['bugbear_warrior']);
    expect(bossesOf(enc([{ id: 'goblin_warrior', count: 4 }]), db)).toEqual([]);
    expect(bossesOf(enc([{ id: 'goblin_warrior', count: 4 }, { id: 'bugbear_warrior', count: 1 }], ['goblin_warrior']), db)).toEqual(['goblin_warrior']);
  });
});
