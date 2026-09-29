/**
 * Validates assets/audio-manifest.json (music moods, ambience beds and SFX).
 * Does not require the downloaded audio to exist — only checks structure,
 * licences, credits and that every mood / SFX event resolves to listed files.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = path.resolve(__dirname, '..');
const manifestRaw: unknown = JSON.parse(readFileSync(path.join(root, 'assets', 'audio-manifest.json'), 'utf8'));
const credits = readFileSync(path.join(root, 'CREDITS.md'), 'utf8');

const REQUIRED_MOODS = [
  'menu', 'town', 'tavern', 'wilderness_aurelmark', 'wilderness_gloamfen', 'wilderness_brinescatter',
  'dungeon', 'battle', 'boss', 'victory',
] as const;
const REQUIRED_SFX = [
  'dice_roll', 'dice_land', 'sword_hit', 'blunt_hit', 'arrow_shot', 'arrow_hit', 'miss_whoosh',
  'spell_fire', 'spell_ice', 'spell_lightning', 'spell_heal', 'spell_generic',
  'ui_click', 'ui_hover', 'ui_confirm', 'ui_error', 'door_open', 'door_close',
  'footstep_stone', 'footstep_grass', 'coin', 'level_up', 'page_turn',
] as const;

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const target = z.string().regex(/^(music|ambience|sfx)\/[a-z0-9_]+\.(ogg|mp3|wav)$/);

const fileSchema = z.object({
  from: z.string().min(1),
  url: z.string().url().optional(),
  target,
  bytes: z.number().int().positive(),
  sha256: sha,
});

const packSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  author: z.string().min(1),
  url: z.string().url(),
  license: z.string().regex(/^(CC0-1\.0|CC-BY-(3\.0|4\.0))$/),
  licenseUrl: z.string().url(),
  licenseQuote: z.string().min(40),
  licenseCheckedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attributionRequired: z.boolean(),
  attribution: z.string().optional(),
  covers: z.string().min(1),
  download: z.object({
    archive: z.enum(['zip', 'none']),
    url: z.string().url(),
    sha256: sha.optional(),
    bytes: z.number().int().positive(),
  }),
  files: z.array(fileSchema).min(1),
});

const track = z.object({ file: target, loop: z.boolean(), title: z.string().min(1), pack: z.string() });

const manifestSchema = z.object({
  version: z.literal(1),
  packs: z.array(packSchema).min(1),
  moods: z.record(z.string(), z.array(track)),
  ambience: z.record(z.string(), z.array(track)),
  sfx: z.record(z.string(), z.array(target)),
  totals: z.object({ packs: z.number(), files: z.number(), downloadBytes: z.number(), installedBytes: z.number() }),
}).passthrough();

const manifest = manifestSchema.parse(manifestRaw);
const allFiles = manifest.packs.flatMap((p) => p.files);
const targets = new Set(allFiles.map((f) => f.target));
const packIds = new Set(manifest.packs.map((p) => p.id));

describe('audio manifest', () => {
  it('every pack has a licence and quote; CC-BY packs carry attribution text', () => {
    for (const p of manifest.packs) {
      expect(p.license, p.id).toBeTruthy();
      expect(p.licenseQuote, p.id).toMatch(/CC0|Creative Commons|CC-BY|public domain/i);
      if (p.license.startsWith('CC-BY')) {
        expect(p.attributionRequired, p.id).toBe(true);
        expect(p.attribution?.length ?? 0, p.id).toBeGreaterThan(20);
      } else {
        expect(p.license).toBe('CC0-1.0');
      }
      if (p.attribution) expect(credits, `${p.id} attribution in CREDITS.md`).toContain(p.attribution);
    }
  });

  it('zip packs pin a sha256; file packs give every file its own url', () => {
    for (const p of manifest.packs) {
      if (p.download.archive === 'zip') expect(p.download.sha256, p.id).toBeDefined();
      else for (const f of p.files) expect(f.url, `${p.id}:${f.from}`).toBeDefined();
    }
  });

  it('has unique pack ids and unique file targets', () => {
    expect(packIds.size).toBe(manifest.packs.length);
    expect(targets.size).toBe(allFiles.length);
  });

  it('every required mood has at least one track and every exploration mood loops', () => {
    for (const mood of REQUIRED_MOODS) {
      expect(manifest.moods[mood]?.length ?? 0, mood).toBeGreaterThan(0);
      if (mood !== 'victory') expect(manifest.moods[mood]!.every((t) => t.loop), mood).toBe(true);
    }
  });

  it('every required SFX event has at least one variant', () => {
    for (const ev of REQUIRED_SFX) expect(manifest.sfx[ev]?.length ?? 0, ev).toBeGreaterThan(0);
    expect(manifest.sfx.dice_roll!.length).toBeGreaterThanOrEqual(3);
  });

  it('every mood, ambience and SFX target is listed under some pack files', () => {
    for (const [mood, list] of [...Object.entries(manifest.moods), ...Object.entries(manifest.ambience)]) {
      for (const t of list) {
        expect(targets.has(t.file), `${mood} -> ${t.file}`).toBe(true);
        expect(packIds.has(t.pack), `${mood} -> ${t.pack}`).toBe(true);
        expect(t.file.startsWith(manifest.ambience[mood] === list ? 'ambience/' : 'music/'), t.file).toBe(true);
      }
    }
    for (const [ev, list] of Object.entries(manifest.sfx)) {
      for (const t of list) {
        expect(targets.has(t), `${ev} -> ${t}`).toBe(true);
        expect(t.startsWith('sfx/'), t).toBe(true);
      }
    }
  });

  it('every pack author is credited in CREDITS.md', () => {
    expect(credits).toMatch(/^## Music and sound effects/m);
    for (const p of manifest.packs) {
      expect(credits, p.id).toContain(p.author);
      expect(credits, p.id).toContain(p.url);
    }
  });

  it('keeps the download modest for an 8 GB machine (< 80 MB)', () => {
    const download = manifest.packs.reduce((n, p) => n + p.download.bytes, 0);
    expect(download).toBeLessThan(80 * 1024 * 1024);
    expect(manifest.totals.downloadBytes).toBe(download);
    expect(manifest.totals.files).toBe(allFiles.length);
  });
});
