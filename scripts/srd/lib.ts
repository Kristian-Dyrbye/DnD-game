/**
 * Helpers for the SRD importers (scripts/srd/import-*.ts, run with `npx tsx`).
 * Reads the Markdown source from data/srd/_source, splits it into sections, parses the
 * HTML tables it uses, applies hand overrides and writes validated JSON to data/srd/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSrdFile } from '../../src/engine/data/srd';
import type { SrdFileName } from '../../src/engine/data/schemas';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE_DIR = path.join(ROOT, 'data', 'srd', '_source');
export const DATA_DIR = path.join(ROOT, 'data', 'srd');
export const OVERRIDE_DIR = path.join(DATA_DIR, 'overrides');

export function readSource(file: string): string {
  const p = path.join(SOURCE_DIR, file);
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Run: npm run srd:fetch`);
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

export interface Section {
  title: string;
  level: number;
  /** Text until the next heading of the same or higher level. */
  body: string;
}

/** Splits Markdown into sections at headings of exactly `level` (e.g. 4 for "#### Name"). */
export function sections(md: string, level: number): Section[] {
  const lines = md.split('\n');
  const out: Section[] = [];
  let current: Section | null = null;
  const re = /^(#{1,6})\s+(.*)$/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const depth = m[1]!.length;
      if (depth <= level) {
        if (current) out.push(current);
        current = depth === level ? { title: m[2]!.trim(), level, body: '' } : null;
        continue;
      }
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) out.push(current);
  return out.map((s) => ({ ...s, body: s.body.trim() }));
}

/** Text between a heading (exact title, any level) and the next heading of the same or higher level. */
export function sectionByTitle(md: string, title: string): string | undefined {
  for (let level = 1; level <= 6; level++) {
    const found = sections(md, level).find((s) => s.title === title);
    if (found) return found.body;
  }
  return undefined;
}

/** Parses every <table> in the text into rows of cleaned cell strings (header rows included). */
export function htmlTables(text: string): string[][][] {
  const tables: string[][][] = [];
  for (const t of text.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
    const rows: string[][] = [];
    for (const r of t[1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      rows.push([...r[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => cleanText(c[1]!)));
    }
    tables.push(rows);
  }
  return tables;
}

/** The first HTML table after a bold caption line like "**Character Advancement**". */
export function tableAfterCaption(md: string, caption: string): string[][] {
  const idx = md.indexOf(`**${caption}**`);
  if (idx < 0) throw new Error(`Table caption not found: ${caption}`);
  const table = htmlTables(md.slice(idx))[0];
  if (!table) throw new Error(`No table after caption: ${caption}`);
  return table;
}

/** Strips HTML tags and entities, collapses whitespace. Keeps Markdown emphasis. */
export function cleanText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** "—" or "–" (em/en dash) and empty cells mean zero in SRD tables. */
export function num(cell: string | undefined): number {
  const c = (cell ?? '').replace(/[,+]/g, '').replace(/[−–]/g, '-').trim();
  if (c === '' || c === '-' || c === '—') return 0;
  const n = Number(c);
  if (!Number.isFinite(n)) throw new Error(`Not a number: "${cell}"`);
  return n;
}

/** Loads data/srd/overrides/<file> (array of partial records keyed by id), if present. */
export function loadOverrides(file: SrdFileName): Map<string, Record<string, unknown>> {
  const p = path.join(OVERRIDE_DIR, file);
  if (!fs.existsSync(p)) return new Map();
  const arr = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>[];
  return new Map(arr.map((o) => [String(o.id), o]));
}

/** Shallow-merges overrides into records by id (override wins). */
export function applyOverrides<T extends { id: string }>(records: T[], file: SrdFileName): T[] {
  const overrides = loadOverrides(file);
  const ids = new Set(records.map((r) => r.id));
  for (const id of overrides.keys()) if (!ids.has(id)) throw new Error(`Override for unknown id "${id}" in ${file}`);
  return records.map((r) => ({ ...r, ...(overrides.get(r.id) ?? {}) }) as T);
}

/** Validates and writes data/srd/<file>. Exits with an error listing if validation fails. */
export function writeData(file: SrdFileName, records: unknown[]): void {
  const { report } = validateSrdFile(file, records);
  if (report.errors.length > 0) {
    console.error(`${file}: ${report.errors.length} validation error(s):`);
    for (const e of report.errors.slice(0, 40)) console.error(`  ${e}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(DATA_DIR, file), `${JSON.stringify(records, null, 1)}\n`, 'utf8');
  console.log(`${file}: wrote ${records.length} records`);
}

/** "1,500 GP" / "5 SP" / "2 CP" → copper pieces. Throws on anything else. */
export function costToCp(cell: string): number {
  const m = /^([\d,]+)\s*(CP|SP|EP|GP|PP)$/i.exec(cell.trim());
  if (!m) throw new Error(`Bad cost: "${cell}"`);
  const mult = { CP: 1, SP: 10, EP: 50, GP: 100, PP: 1000 }[m[2]!.toUpperCase() as 'CP'];
  return Number(m[1]!.replace(/,/g, '')) * mult;
}

/** "1/4 lb." / "1½ lb." / "5 lb. (full)" / "—" → pounds (0 for "—"; undefined for "Varies"). */
export function weightLb(cell: string): number | undefined {
  const c = cell.trim().replace(/(\d),(\d)/g, '$1$2');
  if (c === '' || c === '—' || c === '-') return 0;
  if (/varies/i.test(c)) return undefined;
  const m = /^(\d+)?\s*(½|1\/2|1\/4)?\s*lb/.exec(c);
  if (!m || (!m[1] && !m[2])) throw new Error(`Bad weight: "${cell}"`);
  const whole = m[1] ? Number(m[1]) : 0;
  const frac = m[2] === '1/4' ? 0.25 : m[2] ? 0.5 : 0;
  return whole + frac;
}

/** Item wording in the SRD that doesn't match item names. */
const ITEM_ALIASES: Record<string, string> = {
  'Map or Scroll Cases': 'case_map_or_scroll',
  'Map or Scroll Case': 'case_map_or_scroll',
};

/**
 * Resolves SRD item phrases to [itemId, quantity]:
 * "Hooded Lantern" → lantern_hooded, "10 Candles" → candle ×10, "7 flasks of Oil" → oil ×7,
 * "Parchment (10 sheets)" → parchment ×10, "Book (prayers)" → book. Returns undefined if unknown.
 */
export function makeItemResolver(ids: Set<string>) {
  return (phrase: string): [string, number] | undefined => {
    let text = phrase.trim().replace(/^and\s+/, '').replace(/\.$/, '');
    let qty = 1;
    const q = /^(\d+)\s+(.*)$/.exec(text);
    if (q) {
      qty = Number(q[1]);
      text = q[2]!;
    }
    const inner = /\((\d+)\s+\w+\)$/.exec(text);
    if (inner) qty = Number(inner[1]);
    text = text.replace(/^(flasks?|days?|sheets?|feet|bottles?|pieces?|sticks?|vials?|blocks?) of\s+/i, '').replace(/\s*\(.*\)$/, '');
    const candidates = [text, text.replace(/s$/, ''), text.replace(/es$/, '')];
    const words = text.split(' ');
    if (words.length === 2) candidates.push(`${words[1]}, ${words[0]}`, `${words[1]!.replace(/s$/, '')}, ${words[0]}`);
    for (const c of candidates) {
      const id = c.normalize('NFKD').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (ids.has(id)) return [id, qty];
    }
    const alias = ITEM_ALIASES[text];
    return alias ? [alias, qty] : undefined;
  };
}
