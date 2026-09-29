/**
 * Imports classes.json and subclasses.json from classes.md (all 12 classes + their SRD subclass).
 *   npx tsx scripts/srd/import-classes.ts   (run after import-equipment.ts)
 */
import fs from 'node:fs';
import path from 'node:path';
import { toId } from '../../src/engine/data/common';
import type { ClassData, Subclass } from '../../src/engine/data/schemas';
import { ABILITIES, ABILITY_NAMES, SKILLS, SKILL_NAMES, type Ability, type Skill } from '../../src/engine/rules/basics';
import {
  DATA_DIR,
  applyOverrides,
  cleanText,
  costToCp,
  htmlTables,
  makeItemResolver,
  readSource,
  sectionByTitle,
  sections,
  tableAfterCaption,
  writeData,
} from './lib';

const md = readSource('classes.md');
const abilityByName = Object.fromEntries(ABILITIES.map((a) => [ABILITY_NAMES[a], a])) as Record<string, Ability>;
const skillByName = Object.fromEntries(SKILLS.map((k) => [SKILL_NAMES[k], k])) as Record<string, Skill>;

const SPELLCASTING: Record<string, { progression: ClassData['spellcasting']['progression']; ability?: Ability }> = {
  barbarian: { progression: 'none' },
  bard: { progression: 'full', ability: 'cha' },
  cleric: { progression: 'full', ability: 'wis' },
  druid: { progression: 'full', ability: 'wis' },
  fighter: { progression: 'none' },
  monk: { progression: 'none' },
  paladin: { progression: 'half', ability: 'cha' },
  ranger: { progression: 'half', ability: 'wis' },
  rogue: { progression: 'none' },
  sorcerer: { progression: 'full', ability: 'cha' },
  warlock: { progression: 'pact', ability: 'cha' },
  wizard: { progression: 'full', ability: 'int' },
};

/** Game decision: classes tagged "recommended for beginners" in the creator. */
const BEGINNER = new Set(['fighter', 'barbarian', 'rogue']);

// ---------------------------------------------------------------- equipment

const itemIds = new Set<string>();
for (const f of ['weapons.json', 'armor.json', 'gear.json']) {
  for (const r of JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) as { id: string }[]) itemIds.add(r.id);
}
const resolve = makeItemResolver(itemIds);

/** Class-equipment wording → specific item ids or generic choices. */
const EQUIPMENT_ALIASES: Record<string, { item?: string; choice?: string }> = {
  'Holy Symbol': { choice: 'holy_symbol' },
  'Musical Instrument of your choice': { choice: 'musical_instrument' },
  'Druidic Focus (Quarterstaff)': { item: 'druidic_focus_wooden_staff' },
  'Druidic Focus (sprig of mistletoe)': { item: 'druidic_focus_sprig_of_mistletoe' },
  'Arcane Focus (crystal)': { item: 'arcane_focus_crystal' },
  'Arcane Focus (orb)': { item: 'arcane_focus_orb' },
  'Arcane Focus (Quarterstaff)': { item: 'arcane_focus_staff' },
  "Artisan's Tools or Musical Instrument chosen for the tool proficiency above": { choice: 'artisans_tools_or_musical_instrument' },
};

function equipmentOptions(cell: string): ClassData['startingEquipment'] {
  const body = cell.replace(/^Choose [A-C, or]+:\s*/, '');
  const options = [...body.matchAll(/\(([A-C])\)\s*([^;]+?)(?=;\s*(?:or\s*)?\([A-C]\)|$)/g)].map((m) => m[2]!.trim());
  if (options.length < 2) throw new Error(`Bad equipment cell: ${cell}`);
  return options.map((opt) => {
    const out: ClassData['startingEquipment'][number] = { items: [], cost: 0, choices: [] };
    for (const raw of opt.split(/,\s*(?:and\s+)?(?![^()]*\))/)) {
      const part = raw.trim().replace(/^and\s+/, '');
      const coins = /^([\d,]+ (?:GP|SP|CP))$/.exec(part);
      if (coins) {
        out.cost += costToCp(coins[1]!);
        continue;
      }
      const alias = EQUIPMENT_ALIASES[part];
      if (alias?.item) out.items.push([alias.item, 1]);
      else if (alias?.choice) out.choices.push(alias.choice);
      else {
        const r = resolve(part);
        if (!r) throw new Error(`Unknown class item: "${part}"`);
        out.items.push(r);
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------- helpers

const list = (text: string) =>
  text
    .split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

function weaponProficiencies(text: string): string[] {
  const out = ['simple'];
  if (/Martial weapons that have the Finesse or Light property/.test(text)) out.push('martial:finesse', 'martial:light');
  else if (/Martial weapons that have the Light property/.test(text)) out.push('martial:light');
  else if (/Martial/.test(text)) out.push('martial');
  return out;
}

function armorTraining(text: string): ClassData['armorTraining'] {
  const out: ClassData['armorTraining'] = [];
  for (const kind of ['light', 'medium', 'heavy'] as const) if (new RegExp(`\\b${kind}\\b`, 'i').test(text)) out.push(kind);
  if (/Shields/.test(text)) out.push('shield');
  return out;
}

/** "Level 3: Name" feature sections → features. */
function features(body: string): ClassData['features'] {
  return sections(body, 4)
    .filter((s) => /^Level \d+: /.test(s.title))
    .map((s) => {
      const [, level, name] = /^Level (\d+): (.+)$/.exec(s.title)!;
      return { id: toId(name!), name: name!, level: Number(level), text: cleanText(s.body) };
    });
}

function cellValue(cell: string): number | string {
  const c = cell.replace(/−/g, '-').trim();
  if (c === '—' || c === '-' || c === '') return 0;
  if (/^[+-]?\d+$/.test(c)) return Number(c);
  return c;
}

// ---------------------------------------------------------------- classes

const classes: ClassData[] = [];
const subclasses: Subclass[] = [];

for (const c of sections(md, 2)) {
  const id = toId(c.title);
  const core = Object.fromEntries(htmlTables(c.body)[0]!.map((r) => [r[0]!, r[1]!]));
  const hitDie = `d${/D(\d+)/.exec(core['Hit Point Die']!)![1]}` as ClassData['hitDie'];
  const primaryAbilities = list(core['Primary Ability']!).map((a) => abilityByName[a]!);
  const saves = list(core['Saving Throw Proficiencies']!).map((a) => abilityByName[a]!) as [Ability, Ability];
  const skillCell = core['Skill Proficiencies']!;
  const skillCount = Number(/Choose (?:any )?(\d+)/.exec(skillCell)![1]);
  const skillFrom = /any \d+ skills/.test(skillCell) ? [...SKILLS] : list(skillCell.replace(/^Choose \d+:\s*/, '')).map((k) => skillByName[k]!);

  // Features table: class-specific columns (not Level/PB/Features/slots).
  const table = tableAfterCaption(c.body, `${c.title} Features`);
  const twoRowHeader = table[1]![0] === '';
  const header = table[0]!;
  const rows = table.slice(twoRowHeader ? 2 : 1);
  const columns: Record<string, (number | string)[]> = {};
  let cantripsKnown: number[] | undefined;
  let preparedSpells: number[] | undefined;
  header.forEach((h, i) => {
    if (i < 3 || /Spell Slots|Slot Level/.test(h)) return;
    const values = rows.map((r) => cellValue(r[i] ?? ''));
    if (h === 'Cantrips') cantripsKnown = values as number[];
    else if (h === 'Prepared Spells') preparedSpells = values as number[];
    else columns[toId(h)] = values;
  });

  const classFeatures = features(sectionByTitle(c.body, `${c.title} Class Features`) ?? '');

  // "Gain the following traits from the Core X Traits table: Hit Point Die, proficiency with ..., and training with ..."
  const multiclassText = /^[•-]\s*Gain the following traits from the Core \w+ Traits table:\s*(.+)$/m.exec(c.body)?.[1] ?? '';
  const proficienciesGained = multiclassText
    .replace(/\.$/, '')
    .replace(/^Hit Point Die(?:,\s*|\s+and\s+)?/, '')
    .split(/,\s*(?:and\s+)?/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Option lists such as Metamagic and Eldritch Invocations.
  const options: ClassData['options'] = {};
  for (const listTitle of ['Metamagic Options', 'Eldritch Invocation Options']) {
    const body = sectionByTitle(c.body, listTitle);
    if (!body) continue;
    options[toId(listTitle.replace(/ Options$/, ''))] = sections(body, 4).map((o) => {
      const pre = /^_Prerequisite:\s*([^_]+)_/.exec(o.body);
      return {
        id: toId(o.title.replace(/\s*\(.*\)$/, '')),
        name: o.title,
        ...(pre && { prerequisite: pre[1]!.trim() }),
        text: cleanText(pre ? o.body.slice(pre[0].length) : o.body),
      };
    });
  }

  const sc = SPELLCASTING[id]!;
  classes.push({
    id,
    name: c.title,
    hitDie,
    primaryAbilities,
    saveProficiencies: saves,
    skillChoices: { count: skillCount, from: skillFrom },
    weaponProficiencies: weaponProficiencies(core['Weapon Proficiencies']!),
    armorTraining: armorTraining(core['Armor Training']!),
    toolProficiencies: core['Tool Proficiencies'] ? [core['Tool Proficiencies']] : [],
    startingEquipment: equipmentOptions(core['Starting Equipment']!),
    spellcasting: {
      progression: sc.progression,
      ...(sc.ability && { ability: sc.ability }),
      ...(cantripsKnown && { cantripsKnown }),
      ...(preparedSpells && { preparedSpells }),
    },
    columns,
    multiclass: {
      prerequisites: primaryAbilities,
      anyOf: / or /.test(core['Primary Ability']!),
      proficienciesGained,
    },
    features: classFeatures,
    options,
    subclassLevel: 3,
    beginnerFriendly: BEGINNER.has(id),
  });

  // Subclass
  const subSection = sections(c.body, 3).find((s) => s.title.startsWith(`${c.title} Subclass:`));
  if (!subSection) throw new Error(`${c.title}: no subclass`);
  const subName = subSection.title.replace(`${c.title} Subclass: `, '');
  const subFeatures = features(subSection.body);
  // Always-prepared subclass spells: one table ("3" → ids), or several captioned tables (Circle of the Land: "arid:3").
  const spellFeature = sections(subSection.body, 4).find((s) => /Spells$/.test(s.title));
  let spells: Subclass['spells'];
  if (spellFeature) {
    spells = {};
    const captions = [...spellFeature.body.matchAll(/\*\*(\w+) Land\*\*/g)].map((m) => m[1]!.toLowerCase());
    htmlTables(spellFeature.body).forEach((t, i) => {
      const prefix = captions[i] ? `${captions[i]}:` : '';
      for (const r of t.slice(1)) spells![`${prefix}${Number(r[0])}`] = r[1]!.split(/,\s*/).map((n) => toId(n.replace(/_/g, '')));
    });
  }
  subclasses.push({
    id: toId(subName),
    name: subName,
    classId: id,
    text: cleanText(subSection.body.split(/\n#### /)[0]!),
    features: subFeatures,
    ...(spells && { spells }),
  });
}

writeData('classes.json', applyOverrides(classes, 'classes.json'));
writeData('subclasses.json', applyOverrides(subclasses, 'subclasses.json'));
