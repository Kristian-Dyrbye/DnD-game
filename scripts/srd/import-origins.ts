/**
 * Imports species.json and backgrounds.json from character-origins.md.
 *   npx tsx scripts/srd/import-origins.ts   (run after import-equipment.ts: backgrounds reference item ids)
 */
import fs from 'node:fs';
import path from 'node:path';
import { toId } from '../../src/engine/data/common';
import type { Background, Species } from '../../src/engine/data/schemas';
import {
  ABILITIES,
  ABILITY_NAMES,
  DAMAGE_TYPES,
  SKILLS,
  SKILL_NAMES,
  type Ability,
  type DamageType,
  type Size,
  type Skill,
} from '../../src/engine/rules/basics';
import { DATA_DIR, applyOverrides, cleanText, costToCp, htmlTables, makeItemResolver, readSource, sectionByTitle, sections, writeData } from './lib';

const md = readSource('character-origins.md');

// ---------------------------------------------------------------- species

type Lineage = NonNullable<Species['lineages']>[number];

/** "_Name._ text" paragraphs → traits (tables and bold sub-options stay in the owning trait's text). */
function traits(body: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const para of body.split(/\n(?=_[^_\n]+\._\s)/)) {
    const m = /^_([^_\n]+)\._\s*([\s\S]*)$/.exec(para.trim());
    if (m) out.push({ name: m[1]!, text: cleanText(m[2]!.replace(/<table>[\s\S]*?<\/table>/g, '').replace(/\*\*[^*]+\*\*\s*$/g, '')) });
  }
  return out;
}

const spellIds = (names: string[]) => [...new Set(names.map((n) => toId(n.replace(/_/g, ''))))];
const cantripsIn = (text: string) => [...text.matchAll(/know the _?([A-Z][A-Za-z' ]+?)_? cantrips?/g)].map((m) => m[1]!);

function lineagesFor(name: string, body: string): { label?: string; lineages?: Lineage[] } {
  const tables = htmlTables(body);
  if (name === 'Dragonborn') {
    const rows = tables[0]!.slice(1);
    const lineages: Lineage[] = [];
    for (const r of rows) {
      for (const [dragon, type] of [
        [r[0], r[1]],
        [r[2], r[3]],
      ]) {
        if (!dragon || !type) continue;
        const damageType = type.toLowerCase() as DamageType;
        if (!DAMAGE_TYPES.includes(damageType)) throw new Error(`Bad ancestry type ${type}`);
        lineages.push({ id: toId(dragon), name: `${dragon} Dragon`, damageType });
      }
    }
    return { label: 'Draconic Ancestry', lineages };
  }
  if (name === 'Elf' || name === 'Tiefling') {
    const rows = tables[0]!.slice(1);
    return {
      label: name === 'Elf' ? 'Elven Lineage' : 'Fiendish Legacy',
      lineages: rows.map((r) => {
        const [lname, level1, level3, level5] = r as [string, string, string, string];
        const resist = /Resistance to (\w+) damage/i.exec(level1)?.[1]?.toLowerCase() as DamageType | undefined;
        return {
          id: toId(lname),
          name: lname,
          text: level1,
          ...(resist && { damageType: resist }),
          spells: { '1': spellIds(cantripsIn(level1)), '3': spellIds([level3]), '5': spellIds([level5]) },
        };
      }),
    };
  }
  if (name === 'Gnome' || name === 'Goliath') {
    const lineages = [...body.matchAll(/\*\*([^*]+?)\.\*\*\s*(.+)/g)].map((m) => {
      const lname = m[1]!.replace(/\s*\(.*\)$/, '');
      const text = cleanText(m[2]!);
      const known = [...text.matchAll(/_([A-Z][A-Za-z' ]+)_/g)].map((x) => x[1]!);
      return { id: toId(lname), name: m[1]!, text, ...(name === 'Gnome' && { spells: { '1': spellIds(known) } }) };
    });
    return { label: name === 'Gnome' ? 'Gnomish Lineage' : 'Giant Ancestry', lineages };
  }
  return {};
}

const speciesSection = sectionByTitle(md, 'Species Descriptions') ?? '';
const species: Species[] = sections(speciesSection, 4).map((s) => {
  const type = /\*\*Creature Type:\*\*\s*(\w+)/.exec(s.body)![1]!.toLowerCase() as Species['creatureType'];
  const sizeLine = /\*\*Size:\*\*\s*(.+)/.exec(s.body)![1]!;
  const sizes = (['medium', 'small'] as Size[]).filter((z) => new RegExp(z, 'i').test(sizeLine));
  const speed = Number(/\*\*Speed:\*\*\s*(\d+)/.exec(s.body)![1]);
  const t = traits(s.body);
  const dark = t.find((x) => x.name === 'Darkvision');
  const darkvision = dark ? Number(/(\d+) feet/.exec(dark.text)?.[1]) : undefined;
  const { label, lineages } = lineagesFor(s.title, s.body);
  return {
    id: toId(s.title),
    name: s.title,
    creatureType: type,
    sizes,
    speed,
    ...(darkvision && { darkvision }),
    traits: t,
    ...(lineages && { lineages, lineageLabel: label }),
  };
});

// ---------------------------------------------------------------- backgrounds

const itemIds = new Set<string>();
for (const f of ['weapons.json', 'armor.json', 'gear.json']) {
  for (const r of JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) as { id: string }[]) itemIds.add(r.id);
}
const resolve = makeItemResolver(itemIds);
const abilityByName = Object.fromEntries(ABILITIES.map((a) => [ABILITY_NAMES[a], a])) as Record<string, Ability>;
const skillByName = Object.fromEntries(SKILLS.map((k) => [SKILL_NAMES[k], k])) as Record<string, Skill>;

/** Generic items that are a player choice rather than a specific item. */
const CHOICE_ITEMS: Record<string, string> = {
  'Holy Symbol': 'holy_symbol',
  'Gaming Set': 'gaming_set',
  'Musical Instrument': 'musical_instrument',
  'Arcane Focus': 'arcane_focus',
  'Druidic Focus': 'druidic_focus',
};

function equipmentOption(list: string): Background['equipment']['a'] {
  const out: Background['equipment']['a'] = { items: [], cost: 0, choices: [] };
  for (const raw of list.split(/,\s*(?![^()]*\))/)) {
    const part = raw.trim().replace(/\.$/, '');
    const coins = /^([\d,]+ (?:GP|SP|CP))$/.exec(part);
    if (coins) {
      out.cost += costToCp(coins[1]!);
      continue;
    }
    const generic = Object.keys(CHOICE_ITEMS).find((k) => part.startsWith(k));
    if (generic) {
      out.choices.push(CHOICE_ITEMS[generic]!);
      continue;
    }
    const r = resolve(part);
    if (!r) throw new Error(`Unknown background item: "${part}"`);
    out.items.push(r);
  }
  return out;
}

const backgroundSection = sectionByTitle(md, 'Background Descriptions') ?? '';
const backgrounds: Background[] = sections(backgroundSection, 4).map((s) => {
  const line = (label: string) => {
    const m = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(s.body);
    if (!m) throw new Error(`${s.title}: missing ${label}`);
    return m[1]!.trim();
  };
  const abilityScores = line('Ability Scores').split(/,\s*/).map((a) => abilityByName[a]!);
  const featLine = line('Feat').replace(/\s*\(see.*$/, '');
  const featMatch = /^(.+?)(?:\s*\((\w+)\))?$/.exec(featLine)!;
  const skills = line('Skill Proficiencies').split(/\s+and\s+/).map((k) => skillByName[k.trim()]!);
  const toolLine = line('Tool Proficiency');
  const toolChoice = /_Choose one kind of_\s*(.+?)(?:\s*\(|$)/.exec(toolLine);
  const tool = toolChoice ? `choice:${CHOICE_ITEMS[toolChoice[1]!.trim()]}` : resolve(toolLine)?.[0];
  if (!tool) throw new Error(`${s.title}: unknown tool ${toolLine}`);
  const eq = /\(A\)\s*(.+?);\s*or\s*\(B\)\s*(.+)$/.exec(line('Equipment'));
  if (!eq) throw new Error(`${s.title}: bad equipment line`);
  return {
    id: toId(s.title),
    name: s.title,
    abilityScores,
    featId: toId(featMatch[1]!),
    ...(featMatch[2] && { featOption: featMatch[2].toLowerCase() }),
    skills,
    tool,
    equipment: { a: equipmentOption(eq[1]!), b: equipmentOption(eq[2]!) },
  };
});

writeData('species.json', applyOverrides(species, 'species.json'));
writeData('backgrounds.json', applyOverrides(backgrounds, 'backgrounds.json'));
