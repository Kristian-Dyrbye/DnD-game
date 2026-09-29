/**
 * Downloads the SRD 5.2.1 source text (Markdown conversion, CC-BY-4.0) into data/srd/_source/.
 * The source is gitignored; the structured JSON built from it (data/srd/*.json) is committed.
 * Pinned to one commit so re-running always yields the same text.
 *   node scripts/srd-fetch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'downfallx/dnd-5e-srd-markdown';
const COMMIT = '1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4';
const FILES = [
  'LICENSE',
  'animals.md',
  'character-creation.md',
  'character-origins.md',
  'classes.md',
  'equipment.md',
  'feats.md',
  'gameplay-toolbox.md',
  'magic-items.md',
  'monsters-A-Z.md',
  'monsters.md',
  'playing-the-game.md',
  'rules-glossary.md',
  'spells.md',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'srd', '_source');

fs.mkdirSync(OUT, { recursive: true });
for (const file of FILES) {
  const target = path.join(OUT, file);
  if (fs.existsSync(target) && !process.argv.includes('--force')) {
    console.log(`skip ${file} (exists)`);
    continue;
  }
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(target, await res.text(), 'utf8');
  console.log(`got  ${file}`);
}
fs.writeFileSync(path.join(OUT, 'SOURCE.txt'), `https://github.com/${REPO}/tree/${COMMIT}\n`, 'utf8');
