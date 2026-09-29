/**
 * Imports magic-items.json from magic-items.md.
 *   npx tsx scripts/srd/import-magic-items.ts
 * "+1, +2, or +3" items are expanded into three records (e.g. weapon_1, weapon_2, weapon_3) so
 * shops and loot tables can price and place them by rarity.
 */
import { toId } from '../../src/engine/data/common';
import type { MagicItem } from '../../src/engine/data/schemas';
import { applyOverrides, cleanText, htmlTables, readSource, sectionByTitle, sections, writeData } from './lib';

const md = readSource('magic-items.md');

const CATEGORIES: Record<string, MagicItem['category']> = {
  Armor: 'armor',
  Potion: 'potion',
  Ring: 'ring',
  Rod: 'rod',
  Scroll: 'scroll',
  Staff: 'staff',
  Wand: 'wand',
  Weapon: 'weapon',
  'Wondrous Item': 'wondrous_item',
};

const RARITIES: Record<string, MagicItem['rarity']> = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  'Very Rare': 'very_rare',
  Legendary: 'legendary',
  Artifact: 'artifact',
};

const items: MagicItem[] = [];
const descriptions = sectionByTitle(md, 'Magic Items A–Z') ?? md;
for (const s of sections(descriptions, 4)) {
  const head = /^_([^_]+)_/.exec(s.body);
  if (!head) continue;
  const line = head[1]!;
  const categoryName = Object.keys(CATEGORIES).find((c) => line.startsWith(c));
  if (!categoryName) continue; // embedded stat blocks ("Medium Undead, ...") etc.
  const category = CATEGORIES[categoryName]!;
  const baseItem = new RegExp(`^${categoryName} \\(([^)]+)\\)`).exec(line)?.[1];
  const attune = /\(Requires Attunement(?: by ([^)]+))?\)/.exec(line);
  const attunement = { required: Boolean(attune), ...(attune?.[1] && { by: attune[1] }) };
  const text = cleanText(s.body.slice(head[0].length));
  const charges = /has (\d+) charges/i.exec(text)?.[1];
  const common = {
    category,
    attunement,
    ...(baseItem && { baseItem }),
    ...(charges && { charges: Number(charges) }),
    text,
  };

  // "Uncommon (+1), Rare (+2), or Very Rare (+3)" → three records.
  const tiers = [...line.matchAll(/(Common|Uncommon|Rare|Very Rare|Legendary) \(\+(\d)\)/g)];
  if (tiers.length > 1) {
    const baseName = s.title.replace(/,?\s*\+1, \+2, or \+3$/, '');
    for (const t of tiers) {
      const name = `${baseName}, +${t[2]}`;
      items.push({ id: toId(name), name, rarity: RARITIES[t[1]!]!, bonus: Number(t[2]), ...common });
    }
    continue;
  }

  // "Potions of Healing": one entry with a Potion | HP Regained | Rarity table → one record per potion.
  if (s.title === 'Potions of Healing') {
    for (const [name, dice, rarityName] of htmlTables(s.body)[0]!.slice(1) as [string, string, string][]) {
      const heal = dice.replace(/\s+/g, '');
      items.push({
        id: toId(name),
        name: name.replace(/\((\w)/, (_m, c: string) => `(${c.toUpperCase()}`),
        rarity: RARITIES[rarityName]!,
        ...common,
        text: `You regain ${dice} Hit Points when you drink this potion. Drinking or administering a potion takes a Bonus Action.`,
        effects: [{ kind: 'heal', dice: heal, addSpellMod: false }],
      });
    }
    continue;
  }

  const afterCategory = line.slice(line.indexOf(',', baseItem ? line.indexOf(')') : 0) + 1).trim();
  const rarityMatches = [...afterCategory.matchAll(/\b(Common|Uncommon|Rare|Very Rare|Legendary|Artifact)\b/g)];
  const single = rarityMatches.length === 1 && !/Varies/.test(afterCategory) ? RARITIES[rarityMatches[0]![1]!] : undefined;
  const rarity = /Varies/.test(afterCategory) || rarityMatches.length > 1 ? 'varies' : single;
  if (!rarity) throw new Error(`${s.title}: no rarity in "${line}"`);
  const bonus = /\+(\d)$/.exec(s.title)?.[1];
  items.push({ id: toId(s.title), name: s.title, rarity, ...(bonus && { bonus: Number(bonus) }), ...common });
}

writeData('magic-items.json', applyOverrides(items, 'magic-items.json'));
const count = items.reduce<Record<string, number>>((acc, i) => ((acc[i.rarity] = (acc[i.rarity] ?? 0) + 1), acc), {});
console.log('by rarity:', JSON.stringify(count));
