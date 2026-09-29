import { describe, expect, it } from 'vitest';
import flagsJson from '../../../data/adventures/flags.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { startFight } from './fights';
import { perform, resolveEncounter, startAdventure, type RunContext } from './runner';
import { validateAdventure } from './validate';

const db = loadSrd();
const flags = FlagRegistry.fromJson(flagsJson);

const raw = {
  formatVersion: 1,
  id: 'extras',
  name: 'Extras',
  kind: 'test',
  levelRange: [5, 5],
  summary: 't',
  flags: [{ id: '~artillery', description: 'the guns are manned' }],
  start: { chapter: 'c', scene: 'hall' },
  maps: [{ id: 'keep', name: 'Keep', width: 12, height: 6, rooms: [{ id: 'hall', name: 'Hall', x: 0, y: 0, w: 5, h: 5 }, { id: 'vault', name: 'Vault', x: 5, y: 0, w: 5, h: 5 }], doors: [{ x: 4, y: 2, side: 'E' }] }],
  chapters: [
    {
      id: 'c',
      name: 'C',
      summary: 's',
      start: 'hall',
      scenes: [
        {
          id: 'hall',
          name: 'Hall',
          seed: 'x',
          map: { id: 'keep', room: 'hall' },
          actions: [
            { id: 'man_guns', label: 'Man the guns', outcome: { flags: [{ set: '~artillery' }] } },
            { id: 'peek', label: 'Peek through the keyhole', outcome: { revealRoom: { map: 'keep', room: 'vault' } } },
            { id: 'fight', label: 'Fight', outcome: { encounter: 'boss_fight' } },
            { id: 'leave', label: 'Leave', outcome: { ending: 'done' } },
          ],
        },
      ],
    },
  ],
  encounters: [
    {
      id: 'boss_fight',
      name: 'Boss',
      map: 'keep',
      room: 'vault',
      monsters: [
        { id: 'ogre', count: 1 },
        { id: 'goblin_warrior', count: 2, if: { not: { flag: '~artillery' } } },
      ],
      bosses: ['ogre'],
      statOverrides: { ogre: { name: 'Grok the Wounded', hpPercent: 50, ac: 15 } },
      allies: [{ id: 'guard', count: 1, if: { flag: '~artillery' } }],
    },
  ],
  endings: [{ id: 'done', name: 'Done', text: 'Done.' }],
};

function ctx(): RunContext {
  const v = validateAdventure(structuredClone(raw), db, flags);
  if (!v.adventure) throw new Error(v.errors.join('\n'));
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('x'))), db);
  hero.classes[0]!.level = 5; // big enough budget that scaling keeps the goblins
  return { state: newGameState(hero, 'heroic', 'x'), adventure: v.adventure, rng: Rng.fromSeed(2), db, flags };
}

describe('encounter authoring extras (A068e)', () => {
  it('stat overrides rename and resize a monster', () => {
    const c = ctx();
    startAdventure(c);
    const f = startFight(c, 'boss_fight', c.rng, db);
    const ogre = Object.values(f.enc.state.creatures).find((x) => x.statBlockId === 'ogre')!;
    expect(ogre.name).toBe('Grok the Wounded');
    expect(ogre.maxHp).toBe(Math.round(db.monsters.get('ogre')!.hp / 2));
    expect(ogre.ac).toBe(15);
  });

  it('conditional groups: flags decide which monsters and allies show up', () => {
    const plain = ctx();
    startAdventure(plain);
    const a = startFight(plain, 'boss_fight', plain.rng, db);
    expect(Object.values(a.enc.state.creatures).some((x) => x.statBlockId === 'goblin_warrior')).toBe(true);
    expect(Object.keys(a.enc.state.creatures).some((id) => id.startsWith('ally_'))).toBe(false);
    const guns = ctx();
    startAdventure(guns);
    perform(guns, 'man_guns');
    const b = startFight(guns, 'boss_fight', guns.rng, db);
    expect(Object.values(b.enc.state.creatures).some((x) => x.statBlockId === 'goblin_warrior')).toBe(false);
    expect(Object.keys(b.enc.state.creatures).some((id) => id.startsWith('ally_guard'))).toBe(true);
  });

  it('revealRoom outcome and auto-resolved fights reveal rooms', () => {
    const c = ctx();
    startAdventure(c);
    expect((c.state.extensions.dungeon as Record<string, { revealed: string[] }>).keep!.revealed).toEqual(['hall']);
    perform(c, 'peek');
    expect((c.state.extensions.dungeon as Record<string, { revealed: string[] }>).keep!.revealed).toEqual(['hall', 'vault']);
    const d = ctx();
    startAdventure(d);
    resolveEncounter(d, 'boss_fight', 'win');
    expect((d.state.extensions.dungeon as Record<string, { revealed: string[] }>).keep!.revealed).toContain('vault');
  });

  it('the validator checks override ids and revealRoom targets', () => {
    const bad = structuredClone(raw) as typeof raw & Record<string, unknown>;
    (bad.encounters[0] as Record<string, unknown>).statOverrides = { dragon: { hp: 5 } };
    (bad.chapters[0]!.scenes[0]!.actions[1] as Record<string, unknown>).outcome = { revealRoom: { map: 'keep', room: 'attic' } };
    const errs = validateAdventure(bad, db, flags).errors;
    expect(errs.some((e) => e.includes('statOverrides for "dragon"'))).toBe(true);
    expect(errs.some((e) => e.includes('has no room "attic"'))).toBe(true);
  });
});
