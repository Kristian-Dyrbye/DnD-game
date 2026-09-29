/**
 * SRD database: validates the raw JSON from data/srd/ and offers id lookups.
 * Pure (no file I/O) so client, server and tests share it. `loadSrd()` in srdBundle.ts
 * feeds it the bundled JSON files.
 */
import type { z } from 'zod';
import {
  SRD_FILES,
  type Armor,
  type Background,
  type ClassData,
  type ConditionData,
  type Feat,
  type Gear,
  type MagicItem,
  type Monster,
  type Species,
  type Spell,
  type SrdFileName,
  type Subclass,
  type Weapon,
} from './schemas';

export interface FileValidation {
  file: string;
  count: number;
  errors: string[];
}

/** Validates one file's JSON: must be an array of valid records with unique ids. */
export function validateSrdFile<N extends SrdFileName>(
  file: N,
  raw: unknown,
): { records: z.infer<(typeof SRD_FILES)[N]>[]; report: FileValidation } {
  const schema = SRD_FILES[file];
  const errors: string[] = [];
  const records: z.infer<(typeof SRD_FILES)[N]>[] = [];
  if (!Array.isArray(raw)) {
    return { records, report: { file, count: 0, errors: [`${file}: expected a JSON array`] } };
  }
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const label = `${file}[${i}]${item && typeof item === 'object' && 'id' in item ? ` (${String(item.id)})` : ''}`;
    const res = schema.safeParse(item);
    if (!res.success) {
      for (const issue of res.error.issues.slice(0, 5)) errors.push(`${label} ${issue.path.join('.')}: ${issue.message}`);
      return;
    }
    const id = (res.data as { id: string }).id;
    if (seen.has(id)) errors.push(`${label}: duplicate id "${id}"`);
    seen.add(id);
    records.push(res.data as z.infer<(typeof SRD_FILES)[N]>);
  });
  return { records, report: { file, count: records.length, errors } };
}

export class SrdDatabase {
  readonly conditions: ReadonlyMap<string, ConditionData>;
  readonly weapons: ReadonlyMap<string, Weapon>;
  readonly armor: ReadonlyMap<string, Armor>;
  readonly gear: ReadonlyMap<string, Gear>;
  readonly species: ReadonlyMap<string, Species>;
  readonly backgrounds: ReadonlyMap<string, Background>;
  readonly feats: ReadonlyMap<string, Feat>;
  readonly classes: ReadonlyMap<string, ClassData>;
  readonly subclasses: ReadonlyMap<string, Subclass>;
  readonly spells: ReadonlyMap<string, Spell>;
  readonly monsters: ReadonlyMap<string, Monster>;
  readonly magicItems: ReadonlyMap<string, MagicItem>;
  readonly reports: FileValidation[];

  /** @param files raw JSON per file name; missing files count as empty. */
  constructor(files: Partial<Record<SrdFileName, unknown>>) {
    const reports: FileValidation[] = [];
    const load = <N extends SrdFileName>(name: N) => {
      const { records, report } = validateSrdFile(name, files[name] ?? []);
      reports.push(report);
      return new Map(records.map((r) => [(r as { id: string }).id, r]));
    };
    this.conditions = load('conditions.json') as Map<string, ConditionData>;
    this.weapons = load('weapons.json') as Map<string, Weapon>;
    this.armor = load('armor.json') as Map<string, Armor>;
    this.gear = load('gear.json') as Map<string, Gear>;
    this.species = load('species.json') as Map<string, Species>;
    this.backgrounds = load('backgrounds.json') as Map<string, Background>;
    this.feats = load('feats.json') as Map<string, Feat>;
    this.classes = load('classes.json') as Map<string, ClassData>;
    this.subclasses = load('subclasses.json') as Map<string, Subclass>;
    this.spells = load('spells.json') as Map<string, Spell>;
    this.monsters = load('monsters.json') as Map<string, Monster>;
    this.magicItems = load('magic-items.json') as Map<string, MagicItem>;
    this.reports = reports;
  }

  get errors(): string[] {
    return this.reports.flatMap((r) => r.errors);
  }

  /** Any equipment item (weapon, armor or gear) by id. */
  item(id: string): Weapon | Armor | Gear | undefined {
    return this.weapons.get(id) ?? this.armor.get(id) ?? this.gear.get(id);
  }

  spellsForClass(classId: string, maxLevel = 9): Spell[] {
    return [...this.spells.values()].filter((s) => s.classes.includes(classId) && s.level <= maxLevel);
  }
}
