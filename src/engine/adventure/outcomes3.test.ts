import { describe, expect, it } from 'vitest';
import flagsJson from '../../../data/adventures/flags.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { availableActions, perform, startAdventure, type RunContext } from './runner';
import { validateAdventure } from './validate';

const db = loadSrd();
const flags = FlagRegistry.fromJson(flagsJson);

const raw = {
  formatVersion: 1,
  id: 'a068d',
  name: 'A068d',
  kind: 'test',
  levelRange: [1, 3],
  summary: 't',
  flags: [
    { id: '~clues', description: 'clues found', type: 'number', default: 1, min: 0, max: 3 },
    { id: '~late_beat', description: 'set by the second beat' },
    { id: '~early_beat', description: 'set by the first beat' },
  ],
  start: { chapter: 'c', scene: 's' },
  chapters: [
    {
      id: 'c',
      name: 'C',
      summary: 's',
      start: 's',
      scenes: [
        {
          id: 's',
          name: 'S',
          seed: 'x',
          actions: [
            { id: 'clue', label: 'Find a clue', outcome: { flags: [{ inc: '~clues' }] } },
            { id: 'accuse', label: 'Accuse', if: { flag: '~clues', gte: 3 }, outcome: { ending: 'done' } },
            { id: 'give', label: 'Hand over the rope', if: { item: 'rope_hempen' }, outcome: { removeItems: [{ itemId: 'rope_hempen', quantity: 5 }] } },
          ],
        },
      ],
    },
  ],
  beats: [
    // Listed first but depends on the second beat: fires in the same step thanks to repeated passes.
    { id: 'reacts', text: 'The crowd reacts.', trigger: { flag: '~late_beat' }, outcome: { flags: [{ set: '~early_beat' }] } },
    { id: 'second', text: 'Two clues!', trigger: { flag: '~clues', gte: 2 }, outcome: { flags: [{ set: '~late_beat' }] } },
  ],
  endings: [{ id: 'done', name: 'Done', text: 'Done.' }],
};

function ctx(): RunContext {
  const v = validateAdventure(structuredClone(raw), db, flags);
  if (!v.adventure) throw new Error(v.errors.join('\n'));
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('q'))), db);
  return { state: newGameState(hero, 'heroic', 'q'), adventure: v.adventure, rng: Rng.fromSeed(1), db, flags };
}
const ids = (c: RunContext) => availableActions(c).map((a) => a.id);

describe('A068d authoring features', () => {
  it('local number flags: default, inc and max from the adventure docs', () => {
    const c = ctx();
    startAdventure(c);
    expect(ids(c)).not.toContain('accuse');
    perform(c, 'clue'); // 1 (default) → 2
    expect(c.state.flags['adv.a068d.clues']).toBe(2);
    perform(c, 'clue');
    perform(c, 'clue'); // clamped at 3
    expect(c.state.flags['adv.a068d.clues']).toBe(3);
    expect(ids(c)).toContain('accuse');
  });

  it('the validator checks writes against local types', () => {
    const bad = structuredClone(raw);
    bad.chapters[0]!.scenes[0]!.actions[0]!.outcome = { flags: [{ set: '~clues', value: 'many' }] } as never;
    expect(validateAdventure(bad, db, flags).errors.some((e) => e.includes('is number'))).toBe(true);
  });

  it('beats fire in the same step regardless of their order', () => {
    const c = ctx();
    startAdventure(c);
    const r = perform(c, 'clue');
    expect(r.facts).toEqual(expect.arrayContaining(['Two clues!', 'The crowd reacts.']));
    expect(c.state.flags['adv.a068d.early_beat']).toBe(true);
  });

  it('removeItems takes what the hero has; the item condition gates actions', () => {
    const c = ctx();
    startAdventure(c);
    const had = c.state.hero.inventory.filter((i) => i.itemId === 'rope_hempen').reduce((s, i) => s + i.quantity, 0);
    if (!had) c.state.hero.inventory.push({ uid: 'r1', itemId: 'rope_hempen', quantity: 2 });
    expect(ids(c)).toContain('give');
    const r = perform(c, 'give');
    expect(r.removed?.[0]?.itemId).toBe('rope_hempen');
    expect(c.state.hero.inventory.some((i) => i.itemId === 'rope_hempen')).toBe(false);
    expect(ids(c)).not.toContain('give');
  });
});

describe('Teeth counts (DESIGN §3)', () => {
  it('teeth_secured / teeth_choir follow the holder flags', async () => {
    const { recountTeeth } = await import('./runner');
    const flags: Record<string, string | number | boolean> = { 'arc.main.tooth_want_holder': 'player', 'arc.main.tooth_abbey_holder': 'wardens', 'arc.main.tooth_wick_holder': 'choir', 'arc.main.tooth_reef_holder': 'unclaimed' };
    recountTeeth(flags);
    expect(flags['arc.main.teeth_secured']).toBe(2);
    expect(flags['arc.main.teeth_choir']).toBe(1);
  });
});
