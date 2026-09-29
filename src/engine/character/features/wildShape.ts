/**
 * Druid Wild Shape (SRD 5.2). Forms are Beast stat blocks within the level's CR limit (fly speed
 * only from level 8); the druid knows 4/6/8 forms (character.choices.wild_shape_forms). While
 * shifted the druid is an active effect 'wild_shape' {beastId}; wildShapeCombatant() builds the
 * merged creature combat uses: beast physical stats, druid HP/Int/Wis/Cha/type, best of the two
 * save and skill bonuses, beast attacks (statBlockId = beast). Temp HP = druid level on shift.
 */
import type { Character, Creature } from '../../core/creature';
import type { Monster } from '../../data/schemas';
import type { SrdDatabase } from '../../data/srd';
import { ABILITIES, SKILLS, SKILL_ABILITY, abilityModifier, proficiencyContribution } from '../../rules/basics';
import { addEffect, removeEffects } from '../../rules/activeEffects';
import { canAct } from '../../rules/conditions';
import { grantTempHp } from '../../rules/damage';
import { classLevel } from '../derived';
import type { FeatureAction } from './types';

const level = (c: Character) => classLevel(c, 'druid');

/** Beast Shapes table: known forms, max CR, fly allowed. */
export function beastShapeLimits(druidLevel: number): { known: number; maxCr: number; fly: boolean } {
  if (druidLevel >= 8) return { known: 8, maxCr: 1, fly: true };
  if (druidLevel >= 4) return { known: 6, maxCr: 0.5, fly: false };
  return { known: 4, maxCr: 0.25, fly: false };
}

export function isEligibleForm(m: Monster, druidLevel: number): boolean {
  const lim = beastShapeLimits(druidLevel);
  return m.creatureType === 'beast' && !m.tags.includes('swarm') && m.cr <= lim.maxCr && (lim.fly || !m.speed.fly);
}

/** All eligible forms at a level, cheapest first (for the chooser UI). */
export function eligibleForms(db: SrdDatabase, druidLevel: number): Monster[] {
  return [...db.monsters.values()].filter((m) => isEligibleForm(m, druidLevel)).sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name));
}

export function knownFormProblems(c: Character, db: SrdDatabase, forms: string[]): string[] {
  const lim = beastShapeLimits(level(c));
  const problems: string[] = [];
  if (forms.length > lim.known) problems.push(`You can know ${lim.known} forms`);
  for (const id of forms) {
    const m = db.monsters.get(id);
    if (!m) problems.push(`Unknown beast ${id}`);
    else if (!isEligibleForm(m, level(c))) problems.push(`${m.name} isn't an eligible form at Druid level ${level(c)}`);
  }
  return problems;
}

export const wildShapeActions: FeatureAction[] = [
  {
    id: 'wild_shape',
    name: 'Wild Shape',
    cost: 'bonus_action',
    resource: 'wild_shape',
    problem: (c) => ((c.resources.wild_shape?.current ?? 0) < 1 ? 'No Wild Shape uses left' : !canAct(c) ? 'Incapacitated' : undefined),
    use: (c, db, { choice: beastId }) => {
      const beast = beastId ? db.monsters.get(beastId) : undefined;
      const known = c.choices.wild_shape_forms ?? [];
      if (!beast || !known.includes(beast.id)) return { character: c, log: ['Choose one of your known forms.'] };
      if (!isEligibleForm(beast, level(c))) return { character: c, log: [`${beast.name} is not an eligible form.`] };
      const ws = c.resources.wild_shape!;
      let next: Character = { ...removeEffects(c, (e) => e.key === 'wild_shape'), resources: { ...c.resources, wild_shape: { ...ws, current: ws.current - 1 } } };
      next = addEffect(next, { key: 'wild_shape', sourceId: c.id, roundsLeft: Math.max(1, Math.floor(level(c) / 2)) * 600, data: { beastId: beast.id } });
      next = grantTempHp(next, level(c));
      return { character: next, log: [`${c.name} shifts into a ${beast.name} (+${level(c)} temporary HP).`] };
    },
  },
  {
    id: 'revert_form',
    name: 'Leave Wild Shape',
    cost: 'bonus_action',
    problem: (c) => (c.effects.some((e) => e.key === 'wild_shape') ? undefined : 'Not in Wild Shape'),
    use: (c) => ({ character: removeEffects(c, (e) => e.key === 'wild_shape'), log: [`${c.name} returns to their true form.`] }),
  },
];

export function currentForm(c: Character, db: SrdDatabase): Monster | undefined {
  const id = c.effects.find((e) => e.key === 'wild_shape')?.data.beastId;
  return typeof id === 'string' ? db.monsters.get(id) : undefined;
}

/** Wild Shape ends if the druid is Incapacitated or dies. */
export function checkWildShapeEnds(c: Character): Character {
  if (!c.effects.some((e) => e.key === 'wild_shape')) return c;
  return c.dead || !canAct(c) ? removeEffects(c, (e) => e.key === 'wild_shape') : c;
}

/** The creature to use in combat: the druid itself, or the merged beast form. */
export function wildShapeCombatant(c: Character, db: SrdDatabase): Creature {
  const beast = currentForm(c, db);
  if (!beast) return c;
  const abilities = { ...c.abilities, str: beast.abilities.str, dex: beast.abilities.dex, con: beast.abilities.con };
  const pb = c.proficiencyBonus;
  const saveBonuses: Partial<Record<(typeof ABILITIES)[number], number>> = {};
  for (const a of ABILITIES) {
    const mine = abilityModifier(abilities[a]) + (c.saveProficiencies.includes(a) ? pb : 0);
    saveBonuses[a] = Math.max(mine, beast.saves[a] ?? -99);
  }
  const skillBonuses: Partial<Record<(typeof SKILLS)[number], number>> = {};
  for (const s of SKILLS) {
    const lvl = c.skills[s];
    const beastBonus = beast.skills[s];
    if (!lvl && beastBonus === undefined) continue;
    const mine = abilityModifier(abilities[SKILL_ABILITY[s]]) + proficiencyContribution(lvl ?? 'none', pb);
    skillBonuses[s] = Math.max(mine, beastBonus ?? -99);
  }
  return {
    ...c,
    kind: 'character',
    size: beast.size[beast.size.length - 1]!,
    abilities,
    ac: beast.ac,
    speed: beast.speed,
    senses: { ...c.senses, ...beast.senses },
    saveBonuses,
    skillBonuses,
    statBlockId: beast.id,
  } as Creature;
}

/** Archdruid (20) Evergreen Wild Shape: on Initiative with no uses left, regain one. */
export function evergreenWildShape(c: Character): Character {
  const ws = c.resources.wild_shape;
  if (level(c) < 20 || !ws || ws.current > 0) return c;
  return { ...c, resources: { ...c.resources, wild_shape: { ...ws, current: 1 } } };
}
