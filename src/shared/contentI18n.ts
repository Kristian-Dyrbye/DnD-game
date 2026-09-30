/**
 * Content translation overlays (A142). English content files (adventures, companions, lore, tables)
 * stay the source of truth; a translation is an overlay file `data/i18n/<lang>/<key>.json` that maps
 * id paths of translatable text fields to translated text plus a hash of the English it was made from.
 * Loading merges the overlay over a copy of the English content (missing entries fall back to English);
 * `npm run i18n:check` reports missing and stale entries (stale = the English changed since, by hash).
 *
 * Paths: object keys joined by '/', array elements by their `id` when it is unique in the array, else
 * by index (`scenes/millbrook_arrival/pois/well/actions/examine/label`, `onEnter/0/text`). String arrays
 * (keywords, secrets, text variants) are one entry whose translation is an array.
 * Pure module (no Node imports): used by the host, the web build, the server and scripts.
 */

/** Field names whose string (or string-array) values are player/LLM-facing text. Everything else
 * (ids, flags, skills, conditions, SRD ids, style lists for the English LLM prompt) is never translated. */
export const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'name', 'seed', 'revisitSeed', 'text', 'texts', 'label', 'description', 'personality', 'voice', 'secrets',
  'summary', 'tip', 'warning', 'keywords', 'terrain', 'source', 'goal', 'goals', 'banter', 'grumbles', 'symbol',
  'title', 'style', 'travelNotes', 'success', 'failure', 'claim', 'villain', 'heirlooms', 'mysteries', 'names',
  'parcels', 'relatives',
]);

/** Keys never walked into: adventure flag docs are developer notes/LLM facts, and their ids change
 * when `~name` is resolved at load, so their paths would not match the loaded adventure. */
const SKIPPED: ReadonlySet<string> = new Set(['flags', '$comment']);

export type TextValue = string | string[];

/** One translatable text in an English source file. */
export interface SourceString {
  path: string;
  value: TextValue;
  hash: string;
}

/** One overlay entry: the translation and the hash of the English it translates. `todo` = a stub
 * written by `i18n:check --stub` that still holds the English (ignored when merging). */
export interface OverlayEntry {
  hash: string;
  text: TextValue;
  todo?: boolean;
}

/** An overlay file: `$source` = the English file (project-relative), `strings` by id path. */
export interface ContentOverlay {
  $source?: string;
  strings: Record<string, OverlayEntry>;
}

/** Overlays by language, then by content key (adventure id, or companions/lore/travel-events/shops/sidequests/defeat-outcomes). */
export type ContentTranslations = Partial<Record<string, Record<string, ContentOverlay>>>;

/** Checks the shape of a parsed overlay file; throws with the first problem. */
export function parseOverlay(raw: unknown): ContentOverlay {
  const o = raw as { $source?: unknown; strings?: unknown } | null;
  if (!o || typeof o !== 'object' || !o.strings || typeof o.strings !== 'object' || Array.isArray(o.strings)) throw new Error('Overlay needs a "strings" object');
  if (o.$source !== undefined && typeof o.$source !== 'string') throw new Error('"$source" must be a string');
  for (const [path, e] of Object.entries(o.strings as Record<string, unknown>)) {
    const entry = e as Partial<OverlayEntry> | null;
    const textOk = typeof entry?.text === 'string' || (Array.isArray(entry?.text) && entry.text.every((x) => typeof x === 'string'));
    if (!entry || typeof entry.hash !== 'string' || !textOk || (entry.todo !== undefined && typeof entry.todo !== 'boolean')) throw new Error(`Bad overlay entry "${path}"`);
  }
  return o as ContentOverlay;
}

/** Short stable hash (FNV-1a 32-bit, hex) of an English text (arrays joined with a separator). */
export function textHash(value: TextValue): string {
  const s = typeof value === 'string' ? value : value.join('␞');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const isTextValue = (v: unknown): v is TextValue =>
  typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');

/** Path segment of each element of an array: its id when unique, else its index. */
function segments(arr: unknown[]): string[] {
  const ids = arr.map((x) => (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : undefined));
  const count = new Map<string, number>();
  for (const id of ids) if (id !== undefined) count.set(id, (count.get(id) ?? 0) + 1);
  return ids.map((id, i) => (id !== undefined && count.get(id) === 1 ? id : String(i)));
}

/** Walks a content value and calls `visit` for every translatable text (with its container + key). */
function walk(v: unknown, path: string, visit: (path: string, holder: Record<string, unknown>, key: string, value: TextValue) => void): void {
  if (Array.isArray(v)) {
    const seg = segments(v);
    v.forEach((x, i) => walk(x, path ? `${path}/${seg[i]}` : seg[i]!, visit));
    return;
  }
  if (!v || typeof v !== 'object') return;
  const obj = v as Record<string, unknown>;
  for (const [k, x] of Object.entries(obj)) {
    const p = path ? `${path}/${k}` : k;
    if (SKIPPED.has(k)) continue;
    if (TEXT_FIELDS.has(k) && isTextValue(x)) visit(p, obj, k, x);
    else if (typeof x === 'object') walk(x, p, visit);
  }
}

/** Every translatable text of an English content file, in file order. */
export function sourceStrings(content: unknown): SourceString[] {
  const out: SourceString[] = [];
  walk(content, '', (path, _h, _k, value) => out.push({ path, value, hash: textHash(value) }));
  return out;
}

/** Returns a copy of `content` with the overlay's translations merged in. Entries that are stubs,
 * have the wrong shape (string vs array) or name paths that don't exist are ignored (English stays).
 * Stale entries (hash differs) are still used: an older translation beats none. */
export function applyOverlay<T>(content: T, overlay: ContentOverlay | undefined): T {
  if (!overlay) return content;
  const copy = structuredClone(content);
  walk(copy, '', (path, holder, key, value) => {
    const e = overlay.strings[path];
    if (!e || e.todo) return;
    if (typeof value === 'string' ? typeof e.text === 'string' && e.text.trim() !== '' : isTextValue(e.text) && Array.isArray(e.text)) holder[key] = e.text;
  });
  return copy;
}

/** Placeholders like `{antagonist}` in a text (sorted, unique). */
function placeholders(v: TextValue): string {
  const all = (typeof v === 'string' ? [v] : v).flatMap((s) => s.match(/\{[a-zA-Z_]+\}/g) ?? []);
  return [...new Set(all)].sort().join(',');
}

export interface OverlayReport {
  total: number;
  translated: number;
  /** In the English file but not (or only as a stub) in the overlay. */
  missing: string[];
  /** Translated from an older English text (hash differs). */
  stale: string[];
  /** In the overlay but no longer in the English file. */
  orphan: string[];
  /** Wrong shape or placeholders that differ from the English. */
  broken: string[];
}

/** Compares an overlay with its English source. */
export function checkOverlay(content: unknown, overlay: ContentOverlay | undefined): OverlayReport {
  return checkStrings(sourceStrings(content), overlay);
}

/** checkOverlay over an explicit list of English strings (SRD name overlays, A149). */
export function checkStrings(src: SourceString[], overlay: ContentOverlay | undefined): OverlayReport {
  const r: OverlayReport = { total: src.length, translated: 0, missing: [], stale: [], orphan: [], broken: [] };
  const known = new Set<string>();
  for (const s of src) {
    known.add(s.path);
    const e = overlay?.strings[s.path];
    if (!e || e.todo) {
      r.missing.push(s.path);
      continue;
    }
    if (typeof s.value === 'string' ? typeof e.text !== 'string' : !Array.isArray(e.text)) {
      r.broken.push(s.path);
      continue;
    }
    if (placeholders(s.value) !== placeholders(e.text)) r.broken.push(s.path);
    else r.translated++;
    if (e.hash !== s.hash) r.stale.push(s.path);
  }
  for (const p of Object.keys(overlay?.strings ?? {})) if (!known.has(p)) r.orphan.push(p);
  return r;
}

/** Adds stub entries (English text, `todo: true`) for every missing path and drops orphans; keeps
 * existing translations (also stale ones, for the translator to review). Entries follow file order. */
export function stubOverlay(content: unknown, overlay: ContentOverlay | undefined, source?: string): ContentOverlay {
  return stubStrings(sourceStrings(content), overlay, source);
}

/** stubOverlay over an explicit list of English strings (SRD name overlays, A149). */
export function stubStrings(src: SourceString[], overlay: ContentOverlay | undefined, source?: string): ContentOverlay {
  const strings: Record<string, OverlayEntry> = {};
  for (const s of src) {
    const e = overlay?.strings[s.path];
    strings[s.path] = e && !e.todo ? e : { hash: s.hash, text: s.value, todo: true };
  }
  return { ...((source ?? overlay?.$source) !== undefined && { $source: source ?? overlay?.$source }), strings };
}
