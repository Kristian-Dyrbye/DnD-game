/** A149e: SRD words inside Danish engine lines (roll labels, Advantage sources, conditions, damage types). */
import { describe, expect, it } from 'vitest';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import type { Character, Creature } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { ENGLISH_MESSAGES, messages, type Messages } from '../i18n';
import { conditionWord, creatureTypeWord, damageWord, srdLabel } from '../i18n/srdLabels';
import { savingThrow } from '../rules/checks';
import { rollDamage } from '../rules/damage';
import { monsterToCreature } from '../rules/monsters';
import { resolveAttack, dealCombatDamage } from './attack';
import type { CombatContext, CombatState } from './combatState';
import { createGrid, placeToken } from './grid';
import { startCombat } from './turns';

const db = loadSrd();
const da = messages('da');

function fixed(...faces: number[]): Rng {
  const q = [...faces];
  return { int: () => q.shift() ?? 10 } as unknown as Rng;
}
const ctx = (msgs?: Messages, ...faces: number[]): CombatContext => ({ rng: fixed(...faces), db, ...(msgs && { msgs }) });
const text = (r: { ok: boolean; events?: { text: string }[] }) => (r.ok && r.events ? r.events.map((e) => e.text).join('\n') : '');

/** A poisoned fighter with a longsword next to a prone, slashing-resistant goblin. */
function fight(): CombatState {
  const base = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('fighter'))), db);
  const hero: Character = {
    ...base,
    id: 'hero',
    name: 'Brenna',
    conditions: [{ condition: 'poisoned' }],
    inventory: [...base.inventory.filter((i) => !db.weapons.has(i.itemId)), { uid: 'ls', itemId: 'longsword', quantity: 1, equipped: 'main_hand' }],
  };
  const goblin: Creature = { ...monsterToCreature(db.monsters.get('goblin_warrior')!, 'g1', 'Goblin'), conditions: [{ condition: 'prone' }], resistances: ['slashing'] };
  const grid = createGrid(10, 10);
  placeToken(grid, { id: 'hero', x: 2, y: 2, size: hero.size });
  placeToken(grid, { id: 'g1', x: 3, y: 2, size: goblin.size });
  const turns = startCombat([
    { id: 'hero', side: 'party', initiative: 20, dexMod: 0 },
    { id: 'g1', side: 'enemy', initiative: 1, dexMod: 0 },
  ]);
  return { grid, turns: { ...turns, round: 1, currentIndex: 0, turnActive: true }, creatures: { hero, g1: goblin } };
}

/** English SRD words that must not show up in a Danish fight line. */
const ENGLISH = /\b(Prone|Poisoned|Paralyzed|attacker|target|within 5 ft|Strength|Dexterity|Proficiency|Half Cover|slashing|resisted|poisoned|Bless|Sap|Longsword)\b/;

describe('SRD words in Danish engine lines (A149e)', () => {
  it('srdLabel translates known labels and keeps English as is', () => {
    expect(srdLabel(da, 'Half Cover')).toBe('Halvt dække');
    expect(srdLabel(da, 'Proficiency')).toBe('Kyndighed');
    expect(srdLabel(da, 'Strength')).not.toBe('Strength');
    expect(srdLabel(da, 'Prone (target, within 5 ft)')).toMatch(/^\S+ \(mål, inden for 5 fod\)$/);
    expect(srdLabel(da, 'Poisoned (attacker)')).toMatch(/ \(angriber\)$/);
    expect(srdLabel(da, 'Paralyzed: Strength')).not.toMatch(ENGLISH);
    expect(srdLabel(da, 'Bless')).not.toBe('Bless');
    expect(srdLabel(da, 'Rage')).toBe('Raseri');
    expect(srdLabel(da, 'Reduce 1d4')).toBe('Formindsk 1d4');
    expect(srdLabel(da, 'Somebody (Help)')).toBe('Somebody (Help)');
    expect(srdLabel(ENGLISH_MESSAGES, 'Half Cover')).toBe('Half Cover');
    expect(conditionWord('da', 'poisoned')).toBe(conditionWord('da', 'poisoned').toLocaleLowerCase());
    expect(conditionWord('en', 'poisoned')).toBe('poisoned');
    expect(damageWord('da', 'fire')).toBe('ild');
    expect(creatureTypeWord('da', 'undead')).toBe('udød');
  });

  it('a Danish attack line names advantage sources, modifiers and damage types in Danish', () => {
    const r = resolveAttack(fight(), ctx(da, 15, 15, 5), { attackerId: 'hero', targetId: 'g1', profile: 'weapon:ls:melee' });
    const lines = text(r);
    expect(lines).toContain('Svæk: Goblin');
    expect(lines).toContain('Kyndighed');
    expect(lines).toContain('(mål, inden for 5 fod)');
    expect(lines).toContain('(angriber)');
    expect(lines).toContain('huggende: modstået');
    expect(lines).not.toMatch(ENGLISH);
    const en = text(resolveAttack(fight(), ctx(undefined, 15, 15, 5), { attackerId: 'hero', targetId: 'g1', profile: 'weapon:ls:melee' }));
    expect(en).toContain('Prone (target, within 5 ft)');
    expect(en).toContain('Poisoned (attacker)');
    expect(en).toContain('slashing resisted');
  });

  it('damage rolls, saves and automatic failures read Danish', () => {
    const dmg = rollDamage(fixed(4), [{ dice: '1d6', type: 'fire' }], { modifiers: [{ value: 2, label: 'Magic Weapon' }], msgs: da });
    expect(dmg.text).toMatch(/^1d6 ild: \[4\] \+ 2 \(.+\) = 6$/);
    expect(dmg.text).not.toContain('Magic Weapon');
    const hero = fight().creatures.hero!;
    const save = savingThrow(hero, 'str', { rng: fixed(12), dc: 15, autoFail: 'Paralyzed: Strength', bonuses: [{ value: 2, label: 'Half Cover' }], msgs: da });
    expect(save.text).toContain('Halvt dække');
    expect(save.text).not.toMatch(ENGLISH);
  });

  it('damage notes and resistance lines name the damage type in Danish', () => {
    const state = fight();
    const d = dealCombatDamage(state, ctx(da), 'hero', 'g1', [{ amount: 6, type: 'slashing' }]);
    expect(d.events.map((e) => e.text).join('\n')).toContain('[huggende: modstået]');
    const en = dealCombatDamage(state, ctx(), 'hero', 'g1', [{ amount: 6, type: 'slashing' }]);
    expect(en.events.map((e) => e.text).join('\n')).toContain('[slashing resisted]');
  });
});
