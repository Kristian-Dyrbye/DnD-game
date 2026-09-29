/**
 * Quick Build (spec §5): sensible choices for a chosen class so a new player can start at once.
 * Uses the Standard Array assigned to the class's primary abilities, a fitting background and
 * species, the first starting-equipment package and curated spell / option picks.
 */
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import type { Skill } from '../rules/basics';
import { STANDARD_ARRAY, suggestAssignment, suggestBackgroundBonus } from './abilityScores';
import { DEFAULT_APPEARANCE, creationChoices, newCreatorState, setChoiceValues, spellCounts, type CreatorState } from './creator';

interface Plan {
  background: string;
  species: string;
  lineage?: string;
  cantrips?: string[];
  spells?: string[];
  picks?: Record<string, string[]>;
}

/** Curated picks per class (fall back to the first valid options if an id is missing). */
const PLANS: Record<string, Plan> = {
  barbarian: { background: 'soldier', species: 'goliath', lineage: 'stones_endurance', picks: { weapon_mastery: ['greataxe', 'handaxe'] } },
  bard: { background: 'criminal', species: 'halfling', cantrips: ['vicious_mockery', 'light'], spells: ['healing_word', 'dissonant_whispers', 'charm_person', 'faerie_fire'] },
  cleric: { background: 'acolyte', species: 'dwarf', cantrips: ['sacred_flame', 'guidance', 'spare_the_dying'], spells: ['cure_wounds', 'bless', 'healing_word', 'guiding_bolt'], picks: { divine_order: ['protector'] } },
  druid: { background: 'sage', species: 'elf', lineage: 'wood_elf', cantrips: ['produce_flame', 'druidcraft'], spells: ['cure_wounds', 'entangle', 'thunderwave', 'faerie_fire'], picks: { primal_order: ['warden'] } },
  fighter: { background: 'soldier', species: 'human', picks: { weapon_mastery: ['greatsword', 'longsword', 'javelin'], fighting_style: ['defense'] } },
  monk: { background: 'criminal', species: 'elf', lineage: 'wood_elf', picks: {} },
  paladin: { background: 'soldier', species: 'dragonborn', lineage: 'gold', spells: ['bless', 'cure_wounds'], picks: { weapon_mastery: ['longsword', 'javelin'] } },
  ranger: { background: 'criminal', species: 'elf', lineage: 'wood_elf', spells: ['hunters_mark', 'cure_wounds'], picks: { weapon_mastery: ['longbow', 'shortsword'] } },
  rogue: { background: 'criminal', species: 'halfling', picks: { weapon_mastery: ['dagger', 'shortbow'] } },
  sorcerer: { background: 'sage', species: 'tiefling', lineage: 'infernal', cantrips: ['fire_bolt', 'light', 'mage_hand', 'prestidigitation'], spells: ['magic_missile', 'shield'] },
  warlock: { background: 'sage', species: 'tiefling', lineage: 'chthonic', cantrips: ['eldritch_blast', 'minor_illusion'], spells: ['hex', 'protection_from_evil_and_good'], picks: { eldritch_invocation: ['pact_of_the_blade'] } },
  wizard: { background: 'sage', species: 'gnome', lineage: 'rock_gnome', cantrips: ['fire_bolt', 'light', 'mage_hand'], spells: ['magic_missile', 'shield', 'sleep', 'mage_armor'] },
};

const NAMES: Record<string, string[]> = {
  dragonborn: ['Kaelith', 'Vorrun', 'Sazira', 'Draxen', 'Irthane', 'Myrrak'],
  dwarf: ['Brenna', 'Torvald', 'Dagna', 'Hurlin', 'Ottra', 'Grimsel'],
  elf: ['Ilsa', 'Thaeron', 'Lirael', 'Caelis', 'Vaenna', 'Eryndor'],
  gnome: ['Pip', 'Wenna', 'Fizzwick', 'Tobble', 'Nissa', 'Quill'],
  goliath: ['Kavak', 'Ruvaa', 'Thalgar', 'Ennika', 'Morrak', 'Vaunea'],
  halfling: ['Lark', 'Merry', 'Tessa', 'Wilby', 'Poppy', 'Corrin'],
  human: ['Aldric', 'Mira', 'Tomas', 'Elena', 'Rowan', 'Sabine'],
  orc: ['Grisha', 'Durnak', 'Ushka', 'Varg', 'Oreka', 'Thokk'],
  tiefling: ['Nyx', 'Vesper', 'Kairon', 'Lilith', 'Morrow', 'Zephra'],
};

export function randomName(speciesId: string | undefined, rng: Rng): string {
  return rng.pick(NAMES[speciesId ?? 'human'] ?? NAMES.human!);
}

export function quickBuild(classId: string, db: SrdDatabase, rng: Rng): CreatorState {
  const cls = db.classes.get(classId);
  if (!cls) throw new Error(`Unknown class ${classId}`);
  const plan = PLANS[classId] ?? { background: 'soldier', species: 'human' };
  const bg = db.backgrounds.get(plan.background)!;
  const species = db.species.get(plan.species)!;
  const baseScores = suggestAssignment([...STANDARD_ARRAY], cls.primaryAbilities);
  let s: CreatorState = {
    ...newCreatorState(),
    step: 'review',
    classId,
    backgroundId: bg.id,
    speciesId: species.id,
    ...(plan.lineage && { lineageId: plan.lineage }),
    ...(species.sizes.length > 1 && { size: 'medium' as const }),
    abilityMethod: 'standard_array',
    baseScores,
    backgroundBonus: suggestBackgroundBonus(bg.abilityScores, cls.primaryAbilities, baseScores),
    classEquipment: 0,
    backgroundEquipment: 'a',
    appearance: { ...DEFAULT_APPEARANCE },
    difficulty: 'heroic',
  };
  // Class skills: the first ones not already granted by the background.
  const bgSkills = new Set<Skill>(bg.skills);
  s.classSkills = cls.skillChoices.from.filter((k) => !bgSkills.has(k)).slice(0, cls.skillChoices.count);
  if (species.id === 'human') {
    s.speciesSkills = [(['perception', 'insight', 'stealth', 'survival'] as Skill[]).find((k) => !bgSkills.has(k) && !s.classSkills.includes(k))!];
    s.speciesFeatId = bg.featId === 'alert' ? 'skilled' : 'alert';
  }
  if (species.id === 'elf') s.speciesSkills = [(['perception', 'insight', 'survival'] as Skill[]).find((k) => !bgSkills.has(k) && !s.classSkills.includes(k))!];
  // Class options: curated picks when valid, else the first options.
  for (const ch of creationChoices(s, db)) {
    const wanted = (plan.picks?.[ch.key] ?? []).filter((id) => ch.options.some((o) => o.id === id));
    const fill = ch.options.map((o) => o.id).filter((id) => !wanted.includes(id));
    s = setChoiceValues(s, ch.key, [...wanted, ...fill].slice(0, ch.count));
  }
  const need = spellCounts(s, db);
  const list = db.spellsForClass(classId, 1);
  const pick = (level: 0 | 1, preferred: string[] | undefined, n: number) => {
    const ok = (preferred ?? []).filter((id) => list.some((sp) => sp.id === id && sp.level === level));
    const rest = list.filter((sp) => sp.level === level && !ok.includes(sp.id)).map((sp) => sp.id);
    return [...ok, ...rest].slice(0, n);
  };
  s.cantrips = pick(0, plan.cantrips, need.cantrips);
  s.preparedSpells = pick(1, plan.spells, need.spells);
  s.name = randomName(species.id, rng);
  return s;
}
