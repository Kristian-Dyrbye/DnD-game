/**
 * Character builder: turns creator choices (class, species, background, scores, skills,
 * equipment, spells) into a validated Character. validateBuild() lists every problem so the
 * creator UI can show them; buildCharacter() throws BuildError if there are any.
 * Species/feat features with complex mechanics are applied later by hooks; the numbers that
 * affect the sheet now (HP, AC, speed, senses, resistances, proficiencies) are applied here.
 */
import { CharacterSchema, type Character, type InventoryItem } from '../core/creature';
import type { SrdDatabase } from '../data/srd';
import type { EquipmentChoiceSchema } from '../data/schemas';
import type { z } from 'zod';
import {
  ABILITIES,
  SKILLS,
  proficiencyBonus,
  type Ability,
  type AbilityScores,
  type DamageType,
  type Skill,
} from '../rules/basics';
import { hitDicePool } from '../rules/rest';
import { pactSlots, spellSlots } from '../rules/spellcasting';
import { armorClass, baseSpeed, maxHitPoints } from './derived';

export interface CharacterBuildInput {
  id: string;
  name: string;
  classId: string;
  subclassId?: string;
  /** Default 1. Higher levels use average HP (companions, quick NPCs). */
  level?: number;
  speciesId: string;
  lineageId?: string;
  size?: 'small' | 'medium';
  backgroundId: string;
  /** Scores before the background increase. */
  baseScores: AbilityScores;
  /** Background increase: +2/+1 to two, or +1/+1/+1 to three, of the background's abilities. */
  backgroundBonus: Partial<Record<Ability, number>>;
  classSkills: Skill[];
  /** Species skill choices: Human Skillful (any 1), Elf Keen Senses (Insight/Perception/Survival). */
  speciesSkills?: Skill[];
  /** Human Versatile: an extra origin feat. */
  speciesFeatId?: string;
  /** Starting equipment option indexes: class 0=A, 1=B, 2=C; background 'a' | 'b'. */
  classEquipment: number;
  backgroundEquipment: 'a' | 'b';
  /** Concrete items for generic choices (holy_symbol → holy_symbol_amulet, gaming_set → dice_set...). */
  choiceItems?: Record<string, string>;
  weaponMasteries?: string[];
  /** Class option picks, e.g. { fighting_style: ['defense'] }. Fighting-style feats also go into featIds. */
  choices?: Record<string, string[]>;
  cantrips?: string[];
  preparedSpells?: string[];
  languages?: string[];
  personality?: Character['personality'];
}

export class BuildError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid character: ${problems.join('; ')}`);
    this.name = 'BuildError';
  }
}

/** Keen Senses options; Human Skillful allows any skill. */
const SPECIES_SKILL_RULES: Record<string, { count: number; from: readonly Skill[] }> = {
  elf: { count: 1, from: ['insight', 'perception', 'survival'] },
  human: { count: 1, from: SKILLS },
};

/** Default concrete item for a generic choice tag. */
const DEFAULT_CHOICE_ITEM: Record<string, string> = {
  holy_symbol: 'holy_symbol_amulet',
  gaming_set: 'dice_set',
  musical_instrument: 'lute',
  arcane_focus: 'arcane_focus_crystal',
  druidic_focus: 'druidic_focus_sprig_of_mistletoe',
  artisans_tools_or_musical_instrument: 'lute',
};

export function validateBuild(input: CharacterBuildInput, db: SrdDatabase): string[] {
  const problems: string[] = [];
  const cls = db.classes.get(input.classId);
  const species = db.species.get(input.speciesId);
  const bg = db.backgrounds.get(input.backgroundId);
  if (!cls) problems.push(`Unknown class ${input.classId}`);
  if (!species) problems.push(`Unknown species ${input.speciesId}`);
  if (!bg) problems.push(`Unknown background ${input.backgroundId}`);
  if (!cls || !species || !bg) return problems;
  const level = input.level ?? 1;
  if (level < 1 || level > 20) problems.push('Level must be 1–20');

  // Scores
  for (const a of ABILITIES) {
    const v = input.baseScores[a];
    if (!Number.isInteger(v) || v < 3 || v > 18) problems.push(`Base ${a} must be 3–18`);
  }
  const bonus = Object.entries(input.backgroundBonus).filter(([, v]) => v);
  const values = bonus.map(([, v]) => v).sort();
  const pattern = values.join(',');
  if (pattern !== '1,2' && pattern !== '1,1,1') problems.push('Background bonus must be +2/+1 or +1/+1/+1');
  for (const [a] of bonus) if (!bg.abilityScores.includes(a as Ability)) problems.push(`${bg.name} can't increase ${a}`);

  // Skills
  const bgSkills = new Set(bg.skills);
  if (input.classSkills.length !== cls.skillChoices.count) problems.push(`Choose ${cls.skillChoices.count} class skills`);
  for (const s of input.classSkills) {
    if (!cls.skillChoices.from.includes(s)) problems.push(`${s} is not a ${cls.name} skill`);
    if (bgSkills.has(s)) problems.push(`${s} is already granted by the background`);
  }
  if (new Set(input.classSkills).size !== input.classSkills.length) problems.push('Duplicate class skills');
  const rule = SPECIES_SKILL_RULES[species.id];
  const speciesSkills = input.speciesSkills ?? [];
  if (rule) {
    if (speciesSkills.length !== rule.count) problems.push(`Choose ${rule.count} ${species.name} skill`);
    for (const s of speciesSkills) if (!rule.from.includes(s)) problems.push(`${s} is not a valid ${species.name} skill`);
  } else if (speciesSkills.length) problems.push(`${species.name} grants no skill choice`);

  // Lineage, size, feats
  if (species.lineages?.length && !species.lineages.some((l) => l.id === input.lineageId)) problems.push(`Choose a ${species.lineageLabel ?? 'lineage'}`);
  if (input.size && !species.sizes.includes(input.size)) problems.push(`${species.name} can't be ${input.size}`);
  if (species.id === 'human') {
    const f = input.speciesFeatId ? db.feats.get(input.speciesFeatId) : undefined;
    if (!f || f.category !== 'origin') problems.push('Human Versatile: choose an origin feat');
  } else if (input.speciesFeatId) problems.push(`${species.name} grants no extra feat`);

  // Subclass
  if (level >= cls.subclassLevel && !input.subclassId) problems.push(`Choose a subclass (level ${cls.subclassLevel}+)`);
  if (input.subclassId && db.subclasses.get(input.subclassId)?.classId !== cls.id) problems.push(`${input.subclassId} is not a ${cls.name} subclass`);

  // Equipment
  if (!cls.startingEquipment[input.classEquipment]) problems.push('Invalid class equipment option');

  // Weapon masteries
  const masteryCount = Number(cls.columns.weapon_mastery?.[level - 1] ?? 0);
  if ((input.weaponMasteries?.length ?? 0) > masteryCount) problems.push(`${cls.name} can master ${masteryCount} weapon(s)`);
  for (const w of input.weaponMasteries ?? []) if (!db.weapons.has(w)) problems.push(`Unknown weapon ${w}`);

  // Spells (counts are checked in detail by the creator, A046)
  for (const id of [...(input.cantrips ?? []), ...(input.preparedSpells ?? [])]) {
    const sp = db.spells.get(id);
    if (!sp) problems.push(`Unknown spell ${id}`);
  }
  return problems;
}

export function buildCharacter(input: CharacterBuildInput, db: SrdDatabase): Character {
  const problems = validateBuild(input, db);
  if (problems.length) throw new BuildError(problems);
  const cls = db.classes.get(input.classId)!;
  const species = db.species.get(input.speciesId)!;
  const bg = db.backgrounds.get(input.backgroundId)!;
  const level = input.level ?? 1;
  const lineage = species.lineages?.find((l) => l.id === input.lineageId);

  const abilities = { ...input.baseScores };
  for (const [a, v] of Object.entries(input.backgroundBonus)) abilities[a as Ability] = Math.min(20, abilities[a as Ability] + (v ?? 0));

  const skills: Character['skills'] = {};
  for (const s of [...bg.skills, ...input.classSkills, ...(input.speciesSkills ?? [])]) skills[s] = 'proficient';

  const resistances: DamageType[] = [];
  if (species.id === 'dwarf') resistances.push('poison');
  if (lineage?.damageType && (species.id === 'dragonborn' || species.id === 'tiefling')) resistances.push(lineage.damageType);

  const darkvision = lineage?.id === 'drow' ? 120 : species.darkvision;

  // Equipment → inventory
  const inventory: InventoryItem[] = [];
  let uid = 0;
  const addItem = (itemId: string, quantity: number) => {
    const existing = inventory.find((i) => i.itemId === itemId);
    if (existing && !db.weapons.has(itemId) && !db.armor.has(itemId)) existing.quantity += quantity;
    else if (db.weapons.has(itemId) || db.armor.has(itemId)) for (let i = 0; i < quantity; i++) inventory.push({ uid: `i${++uid}`, itemId, quantity: 1 });
    else inventory.push({ uid: `i${++uid}`, itemId, quantity });
  };
  let coins = 0;
  const takeOption = (opt: z.infer<typeof EquipmentChoiceSchema>) => {
    for (const [id, q] of opt.items) addItem(id, q);
    for (const tag of opt.choices) addItem(input.choiceItems?.[tag] ?? DEFAULT_CHOICE_ITEM[tag] ?? tag, 1);
    coins += opt.cost;
  };
  takeOption(cls.startingEquipment[input.classEquipment]!);
  takeOption(bg.equipment[input.backgroundEquipment]);
  autoEquip(inventory, db);

  const featIds = [bg.featId, ...(input.speciesFeatId ? [input.speciesFeatId] : []), ...(input.choices?.fighting_style ?? [])];
  const classLevels = [{ hitDie: cls.hitDie, level }];

  const sc = cls.spellcasting;
  const slots = spellSlots([{ progression: sc.progression, level }], db.rules);
  const pact = sc.progression === 'pact' ? pactSlots(level, db.rules) : undefined;
  const spellcasting =
    sc.progression === 'none'
      ? undefined
      : {
          slots: [...slots],
          maxSlots: slots,
          ...(pact && { pact: { current: pact.max, max: pact.max, level: pact.level } }),
          cantrips: input.cantrips ?? [],
          prepared: (input.preparedSpells ?? []).map((spellId) => ({ spellId, classId: cls.id })),
        };

  const draft = CharacterSchema.parse({
    id: input.id,
    name: input.name,
    kind: 'character',
    size: input.size ?? species.sizes[0],
    creatureType: species.creatureType,
    abilities,
    proficiencyBonus: proficiencyBonus(level),
    maxHp: 1,
    hp: 1,
    ac: 10,
    speed: { walk: species.speed },
    senses: darkvision ? { darkvision } : {},
    saveProficiencies: cls.saveProficiencies,
    skills,
    resistances,
    languages: ['Common', ...(input.languages ?? [])],
    classes: [{ classId: cls.id, level, ...(input.subclassId && { subclassId: input.subclassId }) }],
    speciesId: species.id,
    ...(lineage && { lineageId: lineage.id }),
    backgroundId: bg.id,
    hitDice: hitDicePool(classLevels),
    featIds,
    inventory,
    coins,
    weaponMasteries: input.weaponMasteries ?? [],
    proficiencies: {
      weapons: cls.weaponProficiencies,
      armor: cls.armorTraining,
      tools: [bg.tool.startsWith('choice:') ? (input.choiceItems?.[bg.tool.slice(7)] ?? DEFAULT_CHOICE_ITEM[bg.tool.slice(7)] ?? bg.tool) : bg.tool],
    },
    choices: input.choices ?? {},
    ...(input.personality && { personality: input.personality }),
    ...(spellcasting && { spellcasting }),
  });

  const hp = maxHitPoints(classLevels, abilities.con, species.id === 'dwarf' ? 1 : 0);
  const withHp: Character = { ...draft, maxHp: hp, hp };
  return {
    ...withHp,
    ac: armorClass(withHp, db).ac,
    speed: { ...withHp.speed, walk: baseSpeed(withHp, db) },
  };
}

/** Equips the best armor, a shield and the first weapon(s) from a fresh inventory. */
export function autoEquip(inventory: InventoryItem[], db: SrdDatabase): void {
  const armors = inventory.filter((i) => db.armor.get(i.itemId)?.category !== 'shield' && db.armor.has(i.itemId));
  const bestArmor = armors.sort((a, b) => db.armor.get(b.itemId)!.ac - db.armor.get(a.itemId)!.ac)[0];
  if (bestArmor) bestArmor.equipped = 'armor';
  const shield = inventory.find((i) => db.armor.get(i.itemId)?.category === 'shield');
  const weapons = inventory.filter((i) => db.weapons.get(i.itemId)?.kind === 'melee');
  const main = weapons.sort((a, b) => weaponScore(db, b.itemId) - weaponScore(db, a.itemId))[0];
  if (main) main.equipped = 'main_hand';
  const twoHanded = main && db.weapons.get(main.itemId)!.properties.includes('two_handed');
  if (shield && !twoHanded) shield.equipped = 'shield';
}

function weaponScore(db: SrdDatabase, id: string): number {
  const w = db.weapons.get(id)!;
  const m = /(\d+)d(\d+)/.exec(w.damage.dice);
  return m ? Number(m[1]) * (Number(m[2]) + 1) : 1;
}
