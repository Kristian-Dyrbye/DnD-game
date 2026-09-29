import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import flagsJson from '../../../data/adventures/flags.json';
import { applyFlagWrites, evalCondition } from '../adventure/conditions';
import { availableActions, perform, startAdventure } from '../adventure/runner';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { FlagRegistry, isNamespaced, localNamespace, readFlag, resolveAdventureFlags, resolveFlagName } from './flags';

const db = loadSrd();
const registry = () => FlagRegistry.fromJson(flagsJson);

/** A tiny two-scene arc that reads flags written by another arc. */
function laterArc(extra: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    id: 'arc2_ch1',
    name: 'Later arc',
    arcId: 'main',
    levelRange: [3, 4],
    summary: 'Reads starter flags.',
    start: { chapter: 'c', scene: 'gate' },
    chapters: [
      {
        id: 'c',
        name: 'C',
        summary: 'S',
        start: 'gate',
        scenes: [
          {
            id: 'gate',
            name: 'Gate',
            seed: 'A gate.',
            variants: [{ if: { flag: 'arc.starter.reeve_attitude', eq: 'friendly' }, seed: 'The guards wave you through; the Reeve vouched for you.' }],
            actions: [
              { id: 'show_letter', label: 'Show the Reeve’s letter', if: { flag: 'arc.starter.reeve_attitude', eq: 'friendly' }, outcome: { text: 'The captain reads it and nods.', flags: [{ set: '~gate_open' }], ending: 'in' } },
              { id: 'bribe', label: 'Bribe the guard', outcome: { flags: [{ inc: 'world.times_defeated', by: 1 }], ending: 'in' } },
            ],
          },
        ],
      },
    ],
    flags: [{ id: '~gate_open', description: 'The gate was opened.' }],
    endings: [{ id: 'in', name: 'In', text: 'You are in.' }],
    ...extra,
  };
}

describe('flag names', () => {
  it('resolves ~names into the adventure namespace', () => {
    expect(localNamespace({ id: 'x', arcId: 'main' })).toBe('arc.main.');
    expect(localNamespace({ id: 'q7', kind: 'side_quest' })).toBe('side.q7.');
    expect(localNamespace({ id: 'millbrook_demo', kind: 'test' })).toBe('adv.millbrook_demo.');
    expect(resolveFlagName('~met', { id: 'x', arcId: 'starter' })).toBe('arc.starter.met');
    expect(resolveFlagName('world.queen_alive', { id: 'x', arcId: 'starter' })).toBe('world.queen_alive');
    expect(isNamespaced('arc.main.x')).toBe(true);
    expect(isNamespaced('demo.x')).toBe(false);
  });

  it('resolves every reference in an adventure (conditions, writes, docs) without touching other text', () => {
    const r = resolveAdventureFlags(laterArc());
    const json = JSON.stringify(r);
    expect(json).not.toContain('"~');
    expect(json).toContain('"set":"arc.main.gate_open"');
    expect(json).toContain('"id":"arc.main.gate_open"');
    expect(json).toContain('"id":"gate"');
  });
});

describe('FlagRegistry', () => {
  it('loads the campaign registry with types, values and defaults', () => {
    const reg = registry();
    expect(reg.size).toBe(65);
    expect(reg.get('arc.starter.reeve_attitude')).toMatchObject({ type: 'string', default: 'neutral', values: ['neutral', 'friendly', 'hostile'] });
    expect(reg.defaults()['arc.starter.reeve_attitude']).toBe('neutral');
    expect(readFlag({}, 'arc.starter.reeve_attitude', reg)).toBe('neutral');
    expect(readFlag({ 'arc.starter.reeve_attitude': 'hostile' }, 'arc.starter.reeve_attitude', reg)).toBe('hostile');
  });

  it('checks write types/values and clamps numbers', () => {
    const reg = registry();
    expect(reg.checkValue('arc.starter.reeve_attitude', 'grumpy')).toMatch(/must be one of/);
    expect(reg.checkValue('arc.starter.reeve_attitude', true)).toMatch(/is string/);
    expect(reg.checkValue('unknown.flag', 3)).toBeUndefined();
    const loyalty = reg.get('world.corwin_loyalty');
    if (loyalty?.max !== undefined) expect(reg.clamp('world.corwin_loyalty', 999)).toBe(loyalty.max);
  });

  it('applyFlagWrites skips invalid writes, starts inc from the default, and clamps', () => {
    const reg = new FlagRegistry().add({ id: 'world.loyal', type: 'number', default: 50, min: 0, max: 100, description: '', setBy: [], readBy: [] });
    reg.add({ id: 'arc.a.mood', type: 'string', values: ['calm', 'angry'], description: '', setBy: [], readBy: [] });
    const flags: Record<string, boolean | number | string> = {};
    applyFlagWrites(flags, [{ inc: 'world.loyal', by: 70 }, { set: 'arc.a.mood', value: 'furious' }, { set: 'arc.a.mood', value: 'angry' }], reg);
    expect(flags).toEqual({ 'world.loyal': 100, 'arc.a.mood': 'angry' });
  });

  it('conditions read registry defaults for unset flags', () => {
    const reg = registry();
    const ctx = { flags: {}, defaults: reg.defaults(), timeOfDay: 'day' as const, reputation: {}, level: 1, visited: new Set<string>() };
    expect(evalCondition({ flag: 'arc.starter.reeve_attitude', eq: 'neutral' }, ctx)).toBe(true);
    expect(evalCondition({ flag: 'arc.starter.reeve_attitude', exists: true }, ctx)).toBe(true);
  });
});

describe('flags in adventures', () => {
  it('the validator warns about un-namespaced or undocumented flags and rejects bad writes', () => {
    const bad = laterArc();
    const scene = bad.chapters[0]!.scenes[0]!;
    scene.actions.push({ id: 'x', label: 'x', outcome: { flags: [{ set: 'loose_flag' }, { set: 'arc.starter.reeve_attitude', value: 'grumpy' } as never, { set: 'world.not_in_registry' }], ending: 'in' } } as never);
    const r = validateAdventure(bad, db, registry());
    expect(r.warnings).toEqual(expect.arrayContaining(['flag "loose_flag" is not namespaced (use arc.<arc>., world., side.<quest>. or ~name)', 'flag "world.not_in_registry" is not documented']));
    expect(r.errors).toContain('flag arc.starter.reeve_attitude must be one of neutral, friendly, hostile');
  });

  it('the demo adventure has only namespaced, documented flags', () => {
    const r = validateAdventure(structuredClone(demo), db, registry());
    expect(r.warnings).toEqual([]);
    expect(r.adventure!.flags.map((f) => f.id)).toEqual(['adv.millbrook_demo.knows_key', 'adv.millbrook_demo.has_key', 'adv.millbrook_demo.rats_cleared', 'adv.millbrook_demo.reward_claimed']);
  });

  it('a later arc reads flags written by an earlier arc (cross-arc), including defaults', () => {
    const reg = registry();
    const adv = validateAdventure(laterArc(), db, reg).adventure!;
    const hero = buildCharacter(toBuildInput(quickBuild('paladin', db, Rng.fromSeed('p'))), db);

    const neutral = { state: newGameState(hero, 'heroic', 1), adventure: adv, rng: Rng.fromSeed(1), db, flags: reg };
    startAdventure(neutral);
    expect(availableActions(neutral).map((a) => a.id)).toEqual(['bribe']);
    perform(neutral, 'bribe');
    // inc on a registry number starts from its default (0) → 1.
    expect(neutral.state.flags['world.times_defeated']).toBe(1);

    const friendly = { state: newGameState(hero, 'heroic', 1), adventure: adv, rng: Rng.fromSeed(1), db, flags: reg };
    friendly.state.flags['arc.starter.reeve_attitude'] = 'friendly'; // written by the starter arc
    startAdventure(friendly);
    expect(availableActions(friendly).map((a) => a.id)).toEqual(['show_letter', 'bribe']);
    perform(friendly, 'show_letter');
    expect(friendly.state.flags['arc.main.gate_open']).toBe(true);
  });
});
