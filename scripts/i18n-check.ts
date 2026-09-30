/**
 * Content translation check (A142): compares every overlay in data/i18n/<lang>/ with its English source
 * (adventures by id under data/adventures/, world tables per src/host/translations.ts TABLE_SOURCES)
 * and reports missing, stale (English changed since), orphaned and broken entries.
 *
 *   npm run i18n:check                     report for every language folder (always includes da)
 *   npm run i18n:check -- --lang=da -v     one language, list the paths
 *   npm run i18n:check -- --lang=da --stub=<key>[,<key>]   add stubs (English text, "todo": true) for
 *                                          missing entries and drop orphans in data/i18n/da/<key>.json
 *   npm run i18n:check -- --strict         exit 1 unless every overlay that exists is complete and current
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkOverlay, parseOverlay, stubOverlay, type ContentOverlay } from '../src/shared/contentI18n';
import { TABLE_SOURCES } from '../src/host/translations';

const root = process.cwd();
const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const verbose = args.includes('-v') || args.includes('--verbose');
const strict = args.includes('--strict');
const i18nDir = path.join(root, 'data', 'i18n');

/** Content key → project-relative English file. */
function sources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json') && e.name !== 'flags.json') {
        const id = (JSON.parse(fs.readFileSync(full, 'utf8')) as { id?: unknown }).id;
        if (typeof id === 'string') out.set(id, path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(root, 'data', 'adventures'));
  for (const [key, file] of Object.entries(TABLE_SOURCES)) out.set(key, file);
  return out;
}

const langs = opt('lang')
  ? [opt('lang')!]
  : [...new Set(['da', ...(fs.existsSync(i18nDir) ? fs.readdirSync(i18nDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [])])];
const stubKeys = new Set((opt('stub') ?? '').split(',').filter(Boolean));
const src = sources();
for (const k of stubKeys) if (!src.has(k)) throw new Error(`Unknown content key "${k}" (known: ${[...src.keys()].join(', ')})`);
let bad = 0;

for (const lang of langs) {
  console.log(`== ${lang}`);
  const dir = path.join(i18nDir, lang);
  const present = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
  for (const k of present) if (!src.has(k)) {
    console.log(`  ${k}.json: no English source with this key`);
    bad++;
  }
  for (const [key, file] of src) {
    const content: unknown = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const overlayFile = path.join(dir, `${key}.json`);
    let overlay: ContentOverlay | undefined;
    if (present.has(key)) {
      try {
        overlay = parseOverlay(JSON.parse(fs.readFileSync(overlayFile, 'utf8')));
      } catch (err) {
        console.log(`  ${key}: ${(err as Error).message}`);
        bad++;
        continue;
      }
    }
    if (stubKeys.has(key)) {
      fs.mkdirSync(dir, { recursive: true });
      overlay = stubOverlay(content, overlay, file);
      fs.writeFileSync(overlayFile, JSON.stringify(overlay, null, 2) + '\n');
    }
    const r = checkOverlay(content, overlay);
    const status = !overlay ? 'no translation' : `${r.translated}/${r.total} translated, ${r.missing.length} missing, ${r.stale.length} stale, ${r.orphan.length} orphan, ${r.broken.length} broken`;
    console.log(`  ${key.padEnd(28)} ${status}`);
    if (overlay && (r.missing.length || r.stale.length || r.orphan.length || r.broken.length)) bad++;
    if (verbose && overlay) {
      for (const [label, list] of [['missing', r.missing], ['stale', r.stale], ['orphan', r.orphan], ['broken', r.broken]] as const) for (const p of list) console.log(`    ${label}: ${p}`);
    }
  }
}
if (strict && bad) {
  console.log(`${bad} overlay(s) need work.`);
  process.exit(1);
}
