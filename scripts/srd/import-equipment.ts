/**
 * Imports weapons.json, armor.json and gear.json from equipment.md.
 *   npx tsx scripts/srd/import-equipment.ts
 */
import { toId } from '../../src/engine/data/common';
import type { Armor, Gear, Weapon } from '../../src/engine/data/schemas';
import { ABILITIES, ABILITY_NAMES, DAMAGE_TYPES, type Ability, type DamageType } from '../../src/engine/rules/basics';
import { applyOverrides, cleanText, costToCp, readSource, sectionByTitle, sections, tableAfterCaption, weightLb, writeData } from './lib';

const md = readSource('equipment.md');

// ---------------------------------------------------------------- weapons

/** Ammunition names in weapon properties → gear ids. */
const AMMO_IDS: Record<string, string> = {
  Arrow: 'arrows',
  Bolt: 'bolts',
  Needle: 'needles',
  'Bullet:firearm': 'bullets_firearm',
  'Bullet:sling': 'bullets_sling',
};

const FIREARMS = new Set(['musket', 'pistol']);

function parseDamage(cell: string): { dice: string; type: DamageType } {
  const m = /^(\d+(?:d\d+)?)\s+(\w+)$/.exec(cell.trim());
  const type = m?.[2]?.toLowerCase() as DamageType | undefined;
  if (!m || !type || !DAMAGE_TYPES.includes(type)) throw new Error(`Bad weapon damage: ${cell}`);
  return { dice: m[1]!, type };
}

const weapons: Weapon[] = [];
let category: Weapon['category'] = 'simple';
let kind: Weapon['kind'] = 'melee';
for (const row of tableAfterCaption(md, 'Weapons').slice(1)) {
  if (row.length === 1) {
    category = row[0]!.startsWith('Simple') ? 'simple' : 'martial';
    kind = row[0]!.includes('Ranged') ? 'ranged' : 'melee';
    continue;
  }
  const [name, damageCell, propsCell, mastery, weight, cost] = row as [string, string, string, string, string, string];
  const id = toId(name);
  const weapon: Weapon = {
    id,
    name,
    category,
    kind,
    damage: parseDamage(damageCell),
    properties: [],
    mastery: mastery.toLowerCase() as Weapon['mastery'],
    weightLb: weightLb(weight) ?? 0,
    cost: costToCp(cost),
  };
  if (propsCell !== '—') {
    for (const raw of propsCell.split(/,\s*(?![^()]*\))/)) {
      const p = raw.trim();
      const base = p.replace(/\s*\(.*\)$/, '').toLowerCase().replace(/-/g, '_');
      const inner = /\((.*)\)/.exec(p)?.[1];
      if (base === 'ammunition' || base === 'thrown') {
        const range = /Range (\d+)\/(\d+)/.exec(inner ?? '');
        if (!range) throw new Error(`No range in ${name}: ${p}`);
        weapon.range = { normal: Number(range[1]), long: Number(range[2]) };
        if (base === 'ammunition') {
          const ammo = /;\s*(\w+)/.exec(inner ?? '')?.[1] ?? '';
          const key = ammo === 'Bullet' ? `Bullet:${FIREARMS.has(id) ? 'firearm' : 'sling'}` : ammo;
          weapon.ammunition = AMMO_IDS[key];
          if (!weapon.ammunition) throw new Error(`Unknown ammunition ${ammo} for ${name}`);
          weapon.properties.push('ammunition', 'range');
        } else weapon.properties.push('thrown');
      } else if (base === 'versatile') {
        weapon.properties.push('versatile');
        weapon.versatileDice = inner;
      } else {
        weapon.properties.push(base as Weapon['properties'][number]);
      }
    }
  }
  weapons.push(weapon);
}

// ---------------------------------------------------------------- armor

const armor: Armor[] = [];
let armorCat: Armor['category'] = 'light';
let don = 1;
let doff = 1;
for (const row of tableAfterCaption(md, 'Armor').slice(1)) {
  if (row.length === 1) {
    const h = row[0]!;
    armorCat = h.startsWith('Light') ? 'light' : h.startsWith('Medium') ? 'medium' : h.startsWith('Heavy') ? 'heavy' : 'shield';
    [don, doff] = armorCat === 'light' ? [1, 1] : armorCat === 'medium' ? [5, 1] : armorCat === 'heavy' ? [10, 5] : [0, 0];
    continue;
  }
  const [name, acCell, strCell, stealth, weight, cost] = row as [string, string, string, string, string, string];
  const ac = Number(/^\+?(\d+)/.exec(acCell)?.[1]);
  const dexCap = armorCat === 'light' ? null : armorCat === 'medium' ? 2 : 0;
  const str = /Str (\d+)/.exec(strCell)?.[1];
  armor.push({
    id: toId(name),
    name,
    category: armorCat,
    ac,
    dexCap: armorCat === 'shield' ? 0 : dexCap,
    ...(str && { strengthRequirement: Number(str) }),
    stealthDisadvantage: stealth === 'Disadvantage',
    weightLb: weightLb(weight) ?? 0,
    cost: costToCp(cost),
    donMinutes: don,
    doffMinutes: doff,
  });
}

// ---------------------------------------------------------------- gear

const gear: Gear[] = [];
const push = (g: Omit<Gear, 'tags'> & { tags?: string[] }) => gear.push({ tags: [], ...g });

// Descriptions: "#### Name (cost)" sections inside "## Adventuring Gear".
const gearSection = sectionByTitle(md, 'Adventuring Gear') ?? '';
const descriptions = new Map(sections(gearSection, 4).map((s) => [s.title.replace(/\s*\([^)]*\)$/, ''), cleanText(s.body)]));

const CATEGORY_ROWS = new Set(['Ammunition', 'Arcane Focus', 'Druidic Focus', 'Holy Symbol']);
const PACKS = new Set(["Burglar's Pack", "Diplomat's Pack", "Dungeoneer's Pack", "Entertainer's Pack", "Explorer's Pack", "Priest's Pack", "Scholar's Pack"]);
for (const [name, weight, cost] of tableAfterCaption(md, 'Adventuring Gear').slice(1) as [string, string, string][]) {
  if (CATEGORY_ROWS.has(name)) continue;
  const text = descriptions.get(name);
  push({
    id: toId(name),
    name,
    category: PACKS.has(name) ? 'pack' : 'adventuring_gear',
    cost: costToCp(cost),
    weightLb: weightLb(weight),
    ...(text && { text }),
  });
}

const AMMO_ROW_IDS: Record<string, string> = {
  Arrows: 'arrows',
  Bolts: 'bolts',
  'Bullets, Firearm': 'bullets_firearm',
  'Bullets, Sling': 'bullets_sling',
  Needles: 'needles',
};
for (const [name, amount, , weight, cost] of tableAfterCaption(md, 'Ammunition').slice(1) as string[][]) {
  push({ id: AMMO_ROW_IDS[name!]!, name: name!, category: 'ammunition', cost: costToCp(cost!), weightLb: weightLb(weight!), bundle: Number(amount) });
}

const focusTable = (caption: string, category: Gear['category'], prefix: string) => {
  for (const [label, weight, cost] of tableAfterCaption(md, caption).slice(1) as [string, string, string][]) {
    const name = label.replace(/\s*\(.*\)$/, '');
    push({
      id: `${prefix}_${toId(name)}`,
      name: `${name[0]!.toUpperCase()}${name.slice(1)} (${caption.replace(/es$|s$/, '')})`,
      category,
      cost: costToCp(cost),
      weightLb: weightLb(weight),
      ...(label.includes('Quarterstaff') && { text: 'Also counts as a Quarterstaff.' }),
    });
  }
};
focusTable('Arcane Focuses', 'arcane_focus', 'arcane_focus');
focusTable('Druidic Focuses', 'druidic_focus', 'druidic_focus');
focusTable('Holy Symbols', 'holy_symbol', 'holy_symbol');

// Tools: "**Name (cost)**" blocks with Ability/Weight/Utilize/Craft/Variants lines.
const toolsMd = sectionByTitle(md, 'Tools') ?? '';
const abilityByName = Object.fromEntries(ABILITIES.map((a) => [ABILITY_NAMES[a], a])) as Record<string, Ability>;
for (const block of toolsMd.split(/\n(?=\*\*[^*]+\((?:[\d,]+ [GSC]P|Varies)\)\*\*)/)) {
  const head = /^\*\*([^*]+?) \(([^)]+)\)\*\*/.exec(block.trim());
  if (!head) continue;
  const [, name, costCell] = head as unknown as [string, string, string];
  const ability = abilityByName[/\*\*Ability:\*\*\s*(\w+)/.exec(block)?.[1] ?? ''];
  const weight = /\*\*Weight:\*\*\s*([^*\n]+)/.exec(block)?.[1]?.trim() ?? '—';
  const utilize = /\*\*Utilize:\*\*\s*(.+)/.exec(block)?.[1]?.trim();
  const craft = /\*\*Craft:\*\*\s*(.+)/.exec(block)?.[1]?.split(/,\s*/).map((c) => c.replace(/_/g, '').trim());
  const variants = /\*\*Variants:\*\*\s*(.+)/.exec(block)?.[1];
  const base = { category: 'tool' as const, ...(ability && { toolAbility: ability }), ...(utilize && { utilize }), ...(craft && { craft }) };
  if (variants) {
    const tag = toId(name);
    for (const v of variants.split(/,\s*(?![^()]*\))/)) {
      const m = /^([^(]+)\(([^,)]+)(?:,\s*([^)]+))?\)/.exec(v.trim());
      if (!m) throw new Error(`Bad tool variant: ${v}`);
      const vName = m[1]!.trim();
      const pretty = `${vName[0]!.toUpperCase()}${vName.slice(1)}`;
      push({
        ...base,
        id: tag === 'gaming_set' ? `${toId(vName)}_set` : toId(vName),
        name: tag === 'gaming_set' ? `${pretty} Set` : pretty,
        cost: costToCp(m[2]!),
        weightLb: m[3] ? weightLb(m[3]) : 0,
        tags: [tag],
      });
    }
  } else {
    push({ ...base, id: toId(name), name, cost: costToCp(costCell), weightLb: weightLb(weight) });
  }
}

for (const [name, capacity, cost] of tableAfterCaption(md, 'Mounts and Other Animals').slice(1) as [string, string, string][]) {
  push({ id: toId(name), name, category: 'mount', cost: costToCp(cost), carryingCapacityLb: weightLb(capacity) ?? 0 });
}

let saddle = false;
for (const [label, weight, cost] of tableAfterCaption(md, 'Tack, Harness, and Drawn Vehicles').slice(1) as [string, string, string][]) {
  if (label === 'Saddle') {
    saddle = true;
    continue;
  }
  const isSaddle = saddle && ['Exotic', 'Military', 'Riding'].includes(label);
  const name = isSaddle ? `Saddle, ${label}` : label;
  const vehicle = ['Carriage', 'Cart', 'Chariot', 'Sled', 'Wagon'].includes(label);
  push({ id: toId(name), name, category: vehicle ? 'vehicle' : 'tack', cost: costToCp(cost), weightLb: weightLb(weight) });
}

// ---------------------------------------------------------------- pack contents

const ids = new Set([...gear.map((g) => g.id), ...weapons.map((w) => w.id), ...armor.map((a) => a.id)]);
/** "Hooded Lantern" → lantern_hooded, "10 Candles" → candle ×10, "7 flasks of Oil" → oil ×7. */
function resolveItem(phrase: string): [string, number] {
  let text = phrase.trim().replace(/^and\s+/, '').replace(/\.$/, '');
  let qty = 1;
  const q = /^(\d+)\s+(.*)$/.exec(text);
  if (q) {
    qty = Number(q[1]);
    text = q[2]!;
  }
  text = text.replace(/^(flasks?|days?|sheets?|feet|bottles?|pieces?|sticks?|vials?|blocks?) of\s+/i, '').replace(/\s*\(.*\)$/, '');
  const candidates = [text, text.replace(/s$/, ''), text.replace(/es$/, '')];
  const words = text.split(' ');
  if (words.length === 2) candidates.push(`${words[1]}, ${words[0]}`, `${words[1]!.replace(/s$/, '')}, ${words[0]}`);
  for (const c of candidates) {
    const id = toId(c);
    if (ids.has(id)) return [id, qty];
  }
  const alias = PACK_ALIASES[text];
  if (alias) return [alias, qty];
  unresolved.push(phrase);
  return ['?', qty];
}

/** Pack wording that doesn't match item names. */
const PACK_ALIASES: Record<string, string> = {
  'Map or Scroll Cases': 'case_map_or_scroll',
};
const unresolved: string[] = [];

for (const g of gear) {
  if (g.category !== 'pack' || !g.text) continue;
  const list = /contains the following items:\s*(.+?)(?:\.\s|\.$)/s.exec(g.text)?.[1];
  if (!list) throw new Error(`No contents for ${g.name}`);
  g.contents = list.split(/,\s*/).map(resolveItem);
}

if (unresolved.length) throw new Error(`Unresolved pack items: ${unresolved.join(' | ')}`);

writeData('weapons.json', applyOverrides(weapons, 'weapons.json'));
writeData('armor.json', applyOverrides(armor, 'armor.json'));
writeData('gear.json', applyOverrides(gear, 'gear.json'));
