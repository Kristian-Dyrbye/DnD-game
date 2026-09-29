/**
 * Imports conditions.json and rules-tables.json from the SRD source.
 *   npx tsx scripts/srd/import-core.ts
 * Condition modifiers are hand-written in data/srd/overrides/conditions.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONDITIONS } from '../../src/engine/rules/basics';
import { RulesTablesSchema } from '../../src/engine/data/schemas';
import { parseCR } from '../../src/engine/rules/basics';
import { DATA_DIR, applyOverrides, cleanText, num, readSource, sections, tableAfterCaption, writeData } from './lib';

// ---------------------------------------------------------------- conditions

const glossary = readSource('rules-glossary.md');
const conditionSections = new Map(
  sections(glossary, 4)
    .filter((s) => s.title.endsWith('[Condition]'))
    .map((s) => [s.title.replace(' [Condition]', '').toLowerCase(), s]),
);

const conditions = CONDITIONS.map((id) => {
  const s = conditionSections.get(id);
  if (!s) throw new Error(`Condition not found in glossary: ${id}`);
  return { id, name: s.title.replace(' [Condition]', ''), text: cleanText(s.body), modifiers: {} };
});
writeData('conditions.json', applyOverrides(conditions, 'conditions.json'));

// ---------------------------------------------------------------- rules tables

const creation = readSource('character-creation.md');
const classesMd = readSource('classes.md');

const body = (rows: string[][], skip = 1) => rows.slice(skip);

const advancement = body(tableAfterCaption(creation, 'Character Advancement'));
const xpByLevel = advancement.map((r) => num(r[1]));

const slotsRow = (r: string[], from: number, count: number) => {
  const slots = r.slice(from, from + count).map(num);
  while (slots.length < 9) slots.push(0);
  return slots;
};

const multiclassSlots = body(tableAfterCaption(creation, 'Multiclass Spellcaster: Spell Slots per Spell Level')).map((r) => slotsRow(r, 1, 9));

const wizard = body(tableAfterCaption(classesMd, 'Wizard Features'), 2);
// Wizard columns: Level, PB, Features, Cantrips, Prepared, slots 1–9
const spellSlotsFull = wizard.map((r) => slotsRow(r, 5, 9));

const paladin = body(tableAfterCaption(classesMd, 'Paladin Features'), 2);
// Paladin columns: Level, PB, Features, Channel Divinity, Prepared, slots 1–5
const spellSlotsHalf = paladin.map((r) => slotsRow(r, 5, 5));

const warlock = body(tableAfterCaption(classesMd, 'Warlock Features'));
const pactMagic = warlock.map((r) => [num(r[6]), num(r[7])] as [number, number]);

const crRows = body(tableAfterCaption(readSource('monsters.md'), 'Experience Points by Challenge Rating'));
const xpByCR: [number, number][] = [];
for (const r of crRows) {
  for (const [crCell, xpCell] of [
    [r[0], r[1]],
    [r[2], r[3]],
  ]) {
    if (!crCell) continue;
    // CR 0 is "0 or 10" (10 if it has an effective attack); use 10 for combat XP.
    const xp = xpCell === '0 or 10' ? 10 : num(xpCell);
    xpByCR.push([parseCR(crCell), xp]);
  }
}
xpByCR.sort((a, b) => a[0] - b[0]);

const budget = body(tableAfterCaption(readSource('gameplay-toolbox.md'), 'XP Budget per Character')).map(
  (r) => [num(r[1]), num(r[2]), num(r[3])] as [number, number, number],
);

// The source table drops the "Medium 15" row in conversion; the SRD values are 5/10/15/20/25/30.
const dcByDifficulty: Record<string, number> = { very_easy: 5, easy: 10, medium: 15, hard: 20, very_hard: 25, nearly_impossible: 30 };
const dcRows = body(tableAfterCaption(readSource('playing-the-game.md'), 'Typical Difficulty Classes'));
for (const r of dcRows) {
  for (const [label, dc] of [
    [r[0], r[1]],
    [r[2], r[3]],
  ]) {
    if (!label || !dc) continue;
    const key = label.toLowerCase().replace(/\s+/g, '_');
    if (dcByDifficulty[key] !== num(dc)) throw new Error(`DC table mismatch for ${label}: ${dc}`);
  }
}

const tables = RulesTablesSchema.parse({
  xpByLevel,
  xpByCR,
  spellSlotsFull,
  spellSlotsHalf,
  pactMagic,
  multiclassSlots,
  encounterBudget: budget,
  dcByDifficulty,
});

// Sanity: the multiclass table equals the full-caster table in the SRD.
if (JSON.stringify(tables.multiclassSlots) !== JSON.stringify(tables.spellSlotsFull)) {
  throw new Error('Multiclass slots differ from Wizard slots — check the source tables');
}

fs.writeFileSync(path.join(DATA_DIR, 'rules-tables.json'), `${JSON.stringify(tables, null, 1)}\n`, 'utf8');
console.log(`rules-tables.json: wrote ${Object.keys(tables).length} tables`);
