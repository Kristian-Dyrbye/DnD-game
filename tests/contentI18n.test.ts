/**
 * A142: content translation overlays (shared/contentI18n.ts): id paths, merge with English fallback,
 * missing/stale/orphan/broken report, stubs; every real content file's paths survive loading; the host
 * serves translated content to a session in that language; the server loads data/i18n/<lang>/*.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyOverlay, checkOverlay, parseOverlay, sourceStrings, stubOverlay, textHash, type ContentOverlay } from '../src/shared/contentI18n';
import { BUNDLED_ADVENTURES, BUNDLED_TRANSLATIONS, bundledFlagRegistry, loadBundledAdventures } from '../src/host/bundled';
import { createGameHost, worldTables, type WorldTables } from '../src/host/gameHost';
import { TABLE_KEYS, TABLE_SOURCES, contentByLanguage } from '../src/host/translations';
import { loadTranslations } from '../src/server/adventures';
import { loadSrd } from '../src/engine/data/srdBundle';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import type { ServerEvent } from '../src/shared/protocol';

const sample = {
  id: 'x',
  name: 'Sample',
  flags: [{ id: '~f', description: 'Flag docs stay English' }],
  scenes: [
    { id: 'a', seed: 'Scene A', pois: [{ id: 'well', name: 'Well', actions: [{ id: 'look', label: 'Look', keywords: ['well', 'look'], skill: 'perception' }] }] },
    { id: 'b', seed: '' },
  ],
  onEnter: [{ id: 'dup', text: 'first' }, { id: 'dup', text: 'second' }],
  claim: 'Hand {antagonist} over',
};

const overlay = (strings: Record<string, string | string[]>, content: unknown = sample): ContentOverlay => {
  const hashes = new Map(sourceStrings(content).map((s) => [s.path, s.hash]));
  return { strings: Object.fromEntries(Object.entries(strings).map(([p, text]) => [p, { hash: hashes.get(p) ?? 'none', text }])) };
};

describe('content overlays', () => {
  it('lists text fields by id path; duplicate ids use indexes; flags, ids and empty texts are skipped', () => {
    expect(sourceStrings(sample).map((s) => s.path)).toEqual([
      'name',
      'scenes/a/seed',
      'scenes/a/pois/well/name',
      'scenes/a/pois/well/actions/look/label',
      'scenes/a/pois/well/actions/look/keywords',
      'onEnter/0/text',
      'onEnter/1/text',
      'claim',
    ]);
    expect(sourceStrings(sample).find((s) => s.path.endsWith('keywords'))!.value).toEqual(['well', 'look']);
    expect(textHash('Look')).toMatch(/^[0-9a-f]{8}$/);
    expect(textHash('Look')).not.toBe(textHash('Look.'));
  });

  it('merges translations over a copy and falls back to English', () => {
    const o = overlay({ name: 'Prøve', 'scenes/a/pois/well/actions/look/keywords': ['brønd', 'kig'], 'onEnter/1/text': 'anden' });
    o.strings['scenes/a/seed'] = { hash: 'x', text: 'Scene A (stub)', todo: true };
    o.strings['scenes/a/pois/well/name'] = { hash: 'x', text: ['wrong', 'shape'] };
    o.strings['scenes/zzz/seed'] = { hash: 'x', text: 'nowhere' };
    const out = applyOverlay(sample, o);
    expect(out.name).toBe('Prøve');
    expect(out.scenes[0]!.seed).toBe('Scene A');
    expect(out.scenes[0]!.pois![0]!.name).toBe('Well');
    expect(out.scenes[0]!.pois![0]!.actions[0]!.keywords).toEqual(['brønd', 'kig']);
    expect(out.onEnter.map((e) => e.text)).toEqual(['first', 'anden']);
    expect(out.flags[0]!.description).toBe('Flag docs stay English');
    expect(sample.name).toBe('Sample');
    expect(applyOverlay(sample, undefined)).toBe(sample);
  });

  it('reports missing, stale, orphan and broken entries', () => {
    const o = overlay({ name: 'Prøve', claim: 'Aflever {villain}', 'onEnter/0/text': 'første', 'scenes/a/pois/well/name': ['x'] });
    o.strings['scenes/a/seed'] = { hash: 'old', text: 'Scene A på dansk' };
    o.strings['gone/text'] = { hash: 'x', text: 'væk' };
    const r = checkOverlay(sample, o);
    expect(r.total).toBe(8);
    expect(r.translated).toBe(3);
    expect(r.missing).toEqual(['scenes/a/pois/well/actions/look/label', 'scenes/a/pois/well/actions/look/keywords', 'onEnter/1/text']);
    expect(r.stale).toEqual(['scenes/a/seed']);
    expect(r.orphan).toEqual(['gone/text']);
    expect(r.broken).toEqual(['scenes/a/pois/well/name', 'claim']);
  });

  it('stubs missing entries with the English text and drops orphans', () => {
    const o = overlay({ name: 'Prøve' });
    o.strings['gone/text'] = { hash: 'x', text: 'væk' };
    const s = stubOverlay(sample, o, 'data/sample.json');
    expect(s.$source).toBe('data/sample.json');
    expect(Object.keys(s.strings)).toEqual(sourceStrings(sample).map((x) => x.path));
    expect(s.strings.name).toEqual(o.strings.name);
    expect(s.strings.claim).toEqual({ hash: textHash('Hand {antagonist} over'), text: 'Hand {antagonist} over', todo: true });
    expect(applyOverlay(sample, s).claim).toBe('Hand {antagonist} over');
    expect(checkOverlay(sample, s).missing).toHaveLength(7);
  });

  it('rejects malformed overlay files', () => {
    expect(() => parseOverlay({})).toThrow(/strings/);
    expect(() => parseOverlay({ strings: { a: { text: 'x' } } })).toThrow(/"a"/);
    expect(() => parseOverlay({ strings: { a: { hash: 'h', text: 3 } } })).toThrow();
    expect(parseOverlay({ $source: 'f.json', strings: { a: { hash: 'h', text: ['x'] } } }).strings.a!.text).toEqual(['x']);
  });
});

describe('real content', () => {
  const db = loadSrd();
  const tables = worldTables();
  const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), tables.companions);
  /** Overlay that replaces every text with a marker. */
  const markAll = (raw: unknown): ContentOverlay => ({
    strings: Object.fromEntries(sourceStrings(raw).map((s) => [s.path, { hash: s.hash, text: typeof s.value === 'string' ? '§' : ['§'] }])),
  });
  /** Source paths whose text did not land in the loaded object (schema defaults that exist only after
   * parsing, e.g. a side-quest approach's default success text, can't be translated and are ignored). */
  const allMarked = (loaded: unknown, raw: unknown) => {
    const marked = new Set(sourceStrings(applyOverlay(loaded, markAll(raw))).filter((s) => s.value === '§' || (Array.isArray(s.value) && s.value[0] === '§')).map((s) => s.path));
    return sourceStrings(raw).map((s) => s.path).filter((p) => !marked.has(p));
  };

  it('every text path in the adventure files reaches the loaded (validated) adventure', () => {
    for (const src of BUNDLED_ADVENTURES) {
      const id = (src.raw as { id: string }).id;
      expect(allMarked(adventures.get(id), src.raw), src.file).toEqual([]);
    }
  });

  it('every text path in the table files reaches the parsed tables', () => {
    for (const [field, key] of Object.entries(TABLE_KEYS) as [keyof WorldTables, string][]) {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(process.cwd(), TABLE_SOURCES[key]!), 'utf8'));
      expect(sourceStrings(raw).length, key).toBeGreaterThan(0);
      expect(allMarked(tables[field], raw), key).toEqual([]);
    }
  });

  it('shipped overlays are well-formed and current (no stale, orphan or broken entries)', () => {
    for (const [lang, overlays] of Object.entries(BUNDLED_TRANSLATIONS)) {
      for (const [key, o] of Object.entries(overlays ?? {})) {
        const src = BUNDLED_ADVENTURES.find((a) => (a.raw as { id: string }).id === key)?.raw ?? JSON.parse(fs.readFileSync(path.join(process.cwd(), TABLE_SOURCES[key]!), 'utf8'));
        const r = checkOverlay(src, o);
        expect({ lang, key, stale: r.stale, orphan: r.orphan, broken: r.broken }).toEqual({ lang, key, stale: [], orphan: [], broken: [] });
      }
    }
    // Complete Danish files (A142 demo, A143 starter arc, A144 ch1, A145 ch2, A146 ch3, A147 ch4).
    for (const key of ['millbrook_demo', 'millbrook_disappearances', 'ch1_whispering_fen', 'ch2_salt_and_treason', 'ch3_the_gilded_lie', 'ch4_wyrmfire']) {
      const r = checkOverlay(BUNDLED_ADVENTURES.find((a) => (a.raw as { id: string }).id === key)!.raw, BUNDLED_TRANSLATIONS.da![key]);
      expect({ key, missing: r.missing }).toEqual({ key, missing: [] });
    }
  });

  it('the Danish starter arc: translated scene, buttons, and Danish free text with æøå keywords (A143)', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'millbrook_disappearances', sessionPorts: { newSeed: () => 'a143' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const labels = () => (events.filter((e) => e.type === 'suggestions').at(-1) as Extract<ServerEvent, { type: 'suggestions' }>).actions.map((a) => a.label);
    const logText = () => events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : [])).join(' ');
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(labels()).toContain('Undersøg brønden');
    expect(labels()).toContain('Gå ind på Ploven og Lygten');
    expect(logText()).toContain('Millbrook');
    expect(logText()).toContain('skodder smækker');
    await host.send({ type: 'say', text: 'jeg kigger på kridtet på brønden' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(logText()).toContain('en sort mund omkranset af syv tænder');
  });

  it('the Danish ch1: translated gate scene, buttons, and a Danish free-text check (A144)', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'ch1_whispering_fen', sessionPorts: { newSeed: () => 'a144' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const labels = () => (events.filter((e) => e.type === 'suggestions').at(-1) as Extract<ServerEvent, { type: 'suggestions' }>).actions.map((a) => a.label);
    const logText = () => events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : [])).join(' ');
    const hero = buildCharacter(toBuildInput(quickBuild('cleric', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(labels()).toContain('Underkast dig vogternes inspektion');
    expect(labels().some((l) => l.startsWith('Undersøg flygtningens sygdom (Medicine SG'))).toBe(true);
    expect(logText()).toContain('Lygtevogterne vil brænde Hollowmere');
    const rolls = events.filter((e) => e.type === 'roll').length;
    await host.send({ type: 'say', text: 'jeg ser nærmere på hans sygdom' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.filter((e) => e.type === 'roll').length).toBe(rolls + 1);
    expect(logText()).toMatch(/sporer|forbandelse/);
  });

  it('the Danish ch2: translated docks scene, buttons, and Danish free text (A145)', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'ch2_salt_and_treason', sessionPorts: { newSeed: () => 'a145' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const labels = () => (events.filter((e) => e.type === 'suggestions').at(-1) as Extract<ServerEvent, { type: 'suggestions' }>).actions.map((a) => a.label);
    const logText = () => events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : [])).join(' ');
    const hero = buildCharacter(toBuildInput(quickBuild('rogue', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(labels()).toContain('Tal med de indespærrede "pirater"');
    expect(labels()).toContain('Tag en fiskerbåd til Fennicks Hvile');
    expect(labels().some((l) => l.startsWith('Undersøg kornkasserne'))).toBe(true);
    expect(logText()).toContain('Rook Marrowby hænges ved Fort Kestrel');
    await host.send({ type: 'say', text: 'jeg snakker med fangerne' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(logText()).toContain('fiskere, der ikke kunne betale tolden');
  });

  it('the Danish ch3: translated audience scene, buttons, and Danish free text (A146)', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'ch3_the_gilded_lie', sessionPorts: { newSeed: () => 'a146' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const labels = () => (events.filter((e) => e.type === 'suggestions').at(-1) as Extract<ServerEvent, { type: 'suggestions' }>).actions.map((a) => a.label);
    const logText = () => events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : [])).join(' ');
    const hero = buildCharacter(toBuildInput(quickBuild('wizard', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(labels()).toContain('Deltag i dronningens audiens');
    expect(logText()).toContain('Highcrown, den hvide hovedstad');
    await host.send({ type: 'say', text: 'jeg deltager i audiensen' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(logText()).toContain('uden at afbryde én eneste gang');
  });

  it('the Danish ch4: translated refugee road, buttons, and a Danish free-text check (A147)', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'ch4_wyrmfire', sessionPorts: { newSeed: () => 'a147' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const labels = () => (events.filter((e) => e.type === 'suggestions').at(-1) as Extract<ServerEvent, { type: 'suggestions' }>).actions.map((a) => a.label);
    const logText = () => events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : [])).join(' ');
    const hero = buildCharacter(toBuildInput(quickBuild('paladin', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(labels().some((l) => l.startsWith('Berolig den panikslagne mængde'))).toBe(true);
    expect(labels()).toContain('Rid mod Dawnspire-borgen og krigsrådet');
    expect(logText()).toContain('Pyrraxis, vågen og sulten');
    const rolls = events.filter((e) => e.type === 'roll').length;
    await host.send({ type: 'say', text: 'berolig mængden' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.filter((e) => e.type === 'roll').length).toBe(rolls + 1);
    expect(logText()).toMatch(/begynder at lytte|for skrigene/);
  });

  it('builds the translated content once per language; languages without overlays get English', () => {
    const content = contentByLanguage(adventures, tables, BUNDLED_TRANSLATIONS);
    expect(content('en').adventures).toBe(adventures);
    expect(content('da')).toBe(content('da'));
    expect(content('da').adventures.get('millbrook_demo')!.name).toBe('Rotter i den gamle mølle');
    expect(adventures.get('millbrook_demo')!.name).toBe('Rats in the Old Mill');
    // Untranslated files stay the very same objects' content.
    expect(content('da').adventures.get('ch5_the_hungering_dark')!.name).toBe(adventures.get('ch5_the_hungering_dark')!.name);
  });

  it('a session in Danish plays the translated adventure; switching back gives English again', async () => {
    const host = createGameHost({ srd: db, adventures, flags: bundledFlagRegistry(), tables, translations: BUNDLED_TRANSLATIONS, startingAdventure: 'millbrook_demo', sessionPorts: { newSeed: () => 'a142' } });
    const events: ServerEvent[] = [];
    host.on((e) => events.push(e));
    const labels = () => (events.filter((e) => e.type === 'suggestions').at(-1) as Extract<ServerEvent, { type: 'suggestions' }>).actions.map((a) => a.label);
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(1))), db);
    await host.send({ type: 'set_language', language: 'da' });
    await host.send({ type: 'new_game', hero, mode: 'heroic' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(labels()).toContain('Tal med borgmester Hobb');
    const narration = events.flatMap((e) => (e.type === 'log' && e.entry.kind === 'narration' ? [e.entry.text] : [])).join(' ');
    expect(narration).toContain('brolagt torv');
    // Danish free text finds the Danish keywords.
    const rolls = events.filter((e) => e.type === 'roll').length;
    await host.send({ type: 'say', text: 'jeg læser opslag på tavlen' });
    await host.idle();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.filter((e) => e.type === 'roll').length).toBe(rolls + 1);
    await host.send({ type: 'set_language', language: 'en' });
    await host.send({ type: 'choose', actionId: 'talk_mayor' });
    await host.idle();
    expect(labels()).toContain('Walk to the old mill');
  });
});

describe('server loader', () => {
  it('reads data/i18n/<lang>/<key>.json and reports bad files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a142-'));
    fs.mkdirSync(path.join(dir, 'da'));
    fs.writeFileSync(path.join(dir, 'da', 'lore.json'), JSON.stringify({ strings: { name: { hash: 'h', text: 'Orrimar' } } }));
    fs.writeFileSync(path.join(dir, 'da', 'bad.json'), '{"strings": 3}');
    fs.writeFileSync(path.join(dir, 'da', 'glossary.md'), '# not an overlay');
    const r = loadTranslations(dir);
    expect(Object.keys(r.translations.da!)).toEqual(['lore']);
    expect(r.problems.map((p) => path.basename(p.file))).toEqual(['bad.json']);
    expect(loadTranslations(path.join(dir, 'missing')).translations).toEqual({});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the project overlays load from disk like the web bundle', () => {
    const r = loadTranslations(path.join(process.cwd(), 'data', 'i18n'));
    expect(r.problems).toEqual([]);
    expect(r.translations.da!.millbrook_demo).toEqual(BUNDLED_TRANSLATIONS.da!.millbrook_demo);
  });
});
