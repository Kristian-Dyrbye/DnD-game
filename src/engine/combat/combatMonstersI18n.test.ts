/** A149c: monster names are set in the session language when a fight spawns them (log, map, scars). */
import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages, type Messages } from '../i18n';
import { srdName } from '../i18n/srdNames';
import { setupEncounter, type EncounterSetup } from './encounter';

const db = loadSrd();
const hero = { ...buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('fighter'))), db), id: 'hero', name: 'Brenna' };

const fight = (msgs?: Messages, extra: Partial<EncounterSetup> = {}) =>
  setupEncounter(
    { hero, monsters: [{ id: 'goblin_warrior', count: 2 }, { id: 'ogre', count: 1 }], allies: [{ id: 'guard', count: 2 }], db, ...extra },
    { rng: Rng.fromSeed('a149c'), db, ...(msgs && { msgs }) },
  );
const names = (e: ReturnType<typeof fight>) => Object.values(e.state.creatures).map((c) => c.name).sort();

describe('monster names in fights (A149c)', () => {
  it('English names are unchanged', () => {
    expect(names(fight())).toEqual(['Allied Guard 1', 'Allied Guard 2', 'Brenna', 'Goblin Warrior 1', 'Goblin Warrior 2', 'Ogre']);
  });

  it('a Danish fight names monsters and allies in Danish, in the log too', () => {
    const e = fight(messages('da'));
    expect(names(e)).toEqual(['Brenna', 'Goblinkriger 1', 'Goblinkriger 2', 'Ogre', 'Vagt 1 (allieret)', 'Vagt 2 (allieret)']);
    const log = e.log.join('\n');
    expect(log).toMatch(/Goblinkriger/);
    expect(log).not.toMatch(/Goblin Warrior|Allied|Guard/);
  });

  it('authored statOverrides names win (adventure overlays translate them)', () => {
    const e = fight(messages('da'), { overrides: { ogre: { name: 'Grumsk' } } });
    expect(names(e)).toContain('Grumsk');
  });

  it('every SRD monster has a Danish name', () => {
    const same = [...db.monsters.values()].filter((m) => srdName('da', 'monsters', m.id, '') === '');
    expect(same.map((m) => m.id)).toEqual([]);
    expect(srdName('da', 'monsters', 'adult_red_dragon', 'Adult Red Dragon')).toBe('Voksen rød drage');
    expect(srdName('en', 'monsters', 'adult_red_dragon', 'Adult Red Dragon')).toBe('Adult Red Dragon');
  });
});
