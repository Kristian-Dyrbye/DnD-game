/**
 * Derived character statistics computed from the character sheet + SRD data:
 * Armor Class (armor, shield, Unarmored Defense, Defense style, magic bonuses), speed,
 * weapon attacks (ability, proficiency, damage, mastery), max HP, initiative, proficiency checks.
 * Pure functions; the sheet stores choices, these compute the numbers.
 */
import type { Character, InventoryItem } from '../core/creature';
import type { Damage } from '../data/common';
import type { Armor, Weapon } from '../data/schemas';
import type { SrdDatabase } from '../data/srd';
import { abilityModifier, type Ability } from '../rules/basics';
import type { Modifier } from '../core/dice';

// ---------------------------------------------------------------- helpers

export const classLevel = (c: Character, classId: string): number => c.classes.find((x) => x.classId === classId)?.level ?? 0;

export function equipped(c: Character, slot: NonNullable<InventoryItem['equipped']>): InventoryItem[] {
  return c.inventory.filter((i) => i.equipped === slot);
}

function magicBonus(db: SrdDatabase, item: InventoryItem | undefined): number {
  return item?.magicItemId ? (db.magicItems.get(item.magicItemId)?.bonus ?? 0) : 0;
}

/** Worn/attuned magic items that add a flat AC bonus. */
const WORN_AC_BONUS: Record<string, number> = { ring_of_protection: 1, cloak_of_protection: 1 };

// ---------------------------------------------------------------- armor class

export interface ArmorClassResult {
  ac: number;
  breakdown: Modifier[];
  /** Wearing armor or a shield without training (Disadvantage on Str/Dex D20 Tests, no spellcasting). */
  untrainedArmor: boolean;
  /** Heavy armor without the Strength requirement (−10 ft speed). */
  heavyArmorTooHeavy: boolean;
}

export function armorClass(c: Character, db: SrdDatabase): ArmorClassResult {
  const dex = abilityModifier(c.abilities.dex);
  const armorItem = equipped(c, 'armor')[0];
  const shieldItem = equipped(c, 'shield')[0];
  const armor: Armor | undefined = armorItem ? db.armor.get(armorItem.itemId) : undefined;
  const shield: Armor | undefined = shieldItem ? db.armor.get(shieldItem.itemId) : undefined;

  const options: { ac: number; breakdown: Modifier[] }[] = [];
  if (armor) {
    const dexPart = armor.dexCap === null ? dex : Math.min(dex, armor.dexCap);
    options.push({ ac: armor.ac + dexPart + magicBonus(db, armorItem), breakdown: [{ value: armor.ac, label: armor.name }, { value: dexPart, label: 'Dexterity' }, ...(magicBonus(db, armorItem) ? [{ value: magicBonus(db, armorItem), label: 'Magic armor' }] : [])] });
  } else {
    options.push({ ac: 10 + dex, breakdown: [{ value: 10, label: 'Unarmored' }, { value: dex, label: 'Dexterity' }] });
    if (classLevel(c, 'barbarian') > 0) {
      const con = abilityModifier(c.abilities.con);
      options.push({ ac: 10 + dex + con, breakdown: [{ value: 10, label: 'Unarmored Defense' }, { value: dex, label: 'Dexterity' }, { value: con, label: 'Constitution' }] });
    }
    if (c.classes.some((x) => x.subclassId === 'draconic_sorcery' && x.level >= 3)) {
      const cha = abilityModifier(c.abilities.cha);
      options.push({ ac: 10 + dex + cha, breakdown: [{ value: 10, label: 'Draconic Resilience' }, { value: dex, label: 'Dexterity' }, { value: cha, label: 'Charisma' }] });
    }
    if (classLevel(c, 'monk') > 0 && !shield) {
      const wis = abilityModifier(c.abilities.wis);
      options.push({ ac: 10 + dex + wis, breakdown: [{ value: 10, label: 'Unarmored Defense' }, { value: dex, label: 'Dexterity' }, { value: wis, label: 'Wisdom' }] });
    }
  }
  const best = options.reduce((a, b) => (b.ac > a.ac ? b : a));
  const breakdown = [...best.breakdown];
  let ac = best.ac;
  if (shield) {
    const bonus = shield.ac + magicBonus(db, shieldItem);
    ac += bonus;
    breakdown.push({ value: bonus, label: shieldItem?.magicItemId ? 'Magic shield' : 'Shield' });
  }
  if (armor && c.featIds.includes('defense')) {
    ac += 1;
    breakdown.push({ value: 1, label: 'Defense' });
  }
  for (const worn of c.inventory.filter((i) => i.equipped === 'worn' && i.attuned && i.magicItemId)) {
    const bonus = WORN_AC_BONUS[worn.magicItemId!];
    if (bonus) {
      ac += bonus;
      breakdown.push({ value: bonus, label: db.magicItems.get(worn.magicItemId!)?.name ?? worn.magicItemId! });
    }
  }
  const trained = (a: Armor | undefined) => !a || c.proficiencies.armor.includes(a.category);
  return {
    ac,
    breakdown,
    untrainedArmor: !trained(armor) || !trained(shield),
    heavyArmorTooHeavy: Boolean(armor?.strengthRequirement && c.abilities.str < armor.strengthRequirement),
  };
}

// ---------------------------------------------------------------- speed

/** Walking speed: species (+ lineage), class movement features, heavy-armor Strength penalty. */
export function baseSpeed(c: Character, db: SrdDatabase): number {
  let speed = db.species.get(c.speciesId)?.speed ?? 30;
  if (c.speciesId === 'elf' && c.lineageId === 'wood_elf') speed = 35;
  const armorItem = equipped(c, 'armor')[0];
  const armor = armorItem ? db.armor.get(armorItem.itemId) : undefined;
  const shield = equipped(c, 'shield').length > 0;
  if (classLevel(c, 'barbarian') >= 5 && armor?.category !== 'heavy') speed += 10;
  const monk = classLevel(c, 'monk');
  if (monk >= 2 && !armor && !shield) {
    const col = db.classes.get('monk')?.columns.unarmored_movement?.[monk - 1];
    const bonus = typeof col === 'string' ? Number(/\d+/.exec(col)?.[0] ?? 0) : 0;
    speed += bonus;
  }
  // Ranger Roving (6): +10 ft while not wearing Heavy armor.
  if (classLevel(c, 'ranger') >= 6 && armor?.category !== 'heavy') speed += 10;
  if (armor?.strengthRequirement && c.abilities.str < armor.strengthRequirement) speed -= 10;
  return Math.max(0, speed);
}

// ---------------------------------------------------------------- weapons

export function isProficientWith(c: Character, w: Weapon): boolean {
  const p = c.proficiencies.weapons;
  if (p.includes(w.id) || p.includes(w.category)) return true;
  if (w.category === 'martial') {
    if (p.includes('martial:light') && w.properties.includes('light')) return true;
    if (p.includes('martial:finesse') && w.properties.includes('finesse')) return true;
  }
  return false;
}

export interface WeaponAttack {
  uid: string;
  weaponId: string;
  name: string;
  ability: Ability;
  toHit: number;
  toHitBreakdown: Modifier[];
  damage: Damage[];
  /** Flat damage modifiers (ability mod, magic bonus) added once. */
  damageModifiers: Modifier[];
  versatileDice?: string;
  reach: number;
  range?: { normal: number; long: number };
  mastery?: Weapon['mastery'];
  properties: Weapon['properties'];
  proficient: boolean;
}

/** Attack profile for an inventory weapon. `mode` picks melee vs thrown for thrown melee weapons. */
export function weaponAttack(c: Character, db: SrdDatabase, item: InventoryItem, mode: 'melee' | 'ranged' = 'melee'): WeaponAttack | undefined {
  const w = db.weapons.get(item.itemId);
  if (!w) return undefined;
  const str = abilityModifier(c.abilities.str);
  const dex = abilityModifier(c.abilities.dex);
  let ability: Ability;
  if (w.kind === 'ranged') ability = 'dex';
  else if (w.properties.includes('finesse')) ability = dex > str ? 'dex' : 'str';
  else ability = 'str';
  const abilityMod = ability === 'dex' ? dex : str;
  const proficient = isProficientWith(c, w);
  const magic = magicBonus(db, item);
  const ranged = w.kind === 'ranged' || mode === 'ranged';
  const toHitBreakdown: Modifier[] = [{ value: abilityMod, label: ability === 'dex' ? 'Dexterity' : 'Strength' }];
  if (proficient) toHitBreakdown.push({ value: c.proficiencyBonus, label: 'Proficiency' });
  if (magic) toHitBreakdown.push({ value: magic, label: `+${magic} weapon` });
  if (ranged && w.kind === 'ranged' && c.featIds.includes('archery')) toHitBreakdown.push({ value: 2, label: 'Archery' });
  const damageModifiers: Modifier[] = [{ value: abilityMod, label: ability === 'dex' ? 'Dexterity' : 'Strength' }];
  if (magic) damageModifiers.push({ value: magic, label: `+${magic} weapon` });
  return {
    uid: item.uid,
    weaponId: w.id,
    name: item.magicItemId ? `${w.name} (${db.magicItems.get(item.magicItemId)?.name ?? item.magicItemId})` : w.name,
    ability,
    toHit: toHitBreakdown.reduce((s, m) => s + m.value, 0),
    toHitBreakdown,
    damage: [w.damage],
    damageModifiers,
    ...(w.versatileDice && { versatileDice: w.versatileDice }),
    reach: w.properties.includes('reach') ? 10 : 5,
    ...(w.range && (ranged || w.properties.includes('thrown')) && { range: w.range }),
    ...(c.weaponMasteries.includes(w.id) && { mastery: w.mastery }),
    properties: w.properties,
    proficient,
  };
}

/** Unarmed Strike: 1 + Str mod bludgeoning (Monk Martial Arts die handled by the monk feature later). */
export function unarmedStrike(c: Character): WeaponAttack {
  const str = abilityModifier(c.abilities.str);
  return {
    uid: 'unarmed',
    weaponId: 'unarmed_strike',
    name: 'Unarmed Strike',
    ability: 'str',
    toHit: str + c.proficiencyBonus,
    toHitBreakdown: [
      { value: str, label: 'Strength' },
      { value: c.proficiencyBonus, label: 'Proficiency' },
    ],
    damage: [{ dice: '1', type: 'bludgeoning' }],
    damageModifiers: [{ value: str, label: 'Strength' }],
    reach: 5,
    properties: [],
    proficient: true,
  };
}

// ---------------------------------------------------------------- HP, initiative

/**
 * Max HP: first class's die at max on level 1, then the fixed average (die/2 + 1) per level,
 * + Con mod per level (min 1 per level), + extra per level (Dwarven Toughness).
 */
export function maxHitPoints(levels: { hitDie: string; level: number }[], conScore: number, extraPerLevel = 0): number {
  const con = abilityModifier(conScore);
  let hp = 0;
  let first = true;
  for (const { hitDie, level } of levels) {
    const die = Number(hitDie.slice(1));
    for (let i = 0; i < level; i++) {
      const roll = first ? die : die / 2 + 1;
      first = false;
      hp += Math.max(1, roll + con) + extraPerLevel;
    }
  }
  return hp;
}

export function initiativeModifiers(c: Character): Modifier[] {
  const mods: Modifier[] = [{ value: abilityModifier(c.abilities.dex), label: 'Dexterity' }];
  if (c.featIds.includes('alert')) mods.push({ value: c.proficiencyBonus, label: 'Alert' });
  // Jack of All Trades (Bard 2): half proficiency on ability checks without proficiency, incl. Initiative.
  else if (classLevel(c, 'bard') >= 2) mods.push({ value: Math.floor(c.proficiencyBonus / 2), label: 'Jack of All Trades' });
  return mods;
}
