/**
 * Validates assets/manifest.json (CC0 3D asset packs). Does not require the
 * downloaded models to exist — only checks structure, licences and coverage.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = path.resolve(__dirname, '..');
const manifestRaw: unknown = JSON.parse(readFileSync(path.join(root, 'assets', 'manifest.json'), 'utf8'));
const monsters = JSON.parse(readFileSync(path.join(root, 'data', 'srd', 'monsters.json'), 'utf8')) as {
  id: string;
  creatureType: string;
}[];

const CREATURE_TYPES = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey',
  'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
] as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const target = z.string().regex(/^(characters|monsters|animals|weapons|dungeon)\/[\w.-]+\.(glb|gltf|bin|png)$/);

const fileSchema = z.object({
  from: z.string().min(1),
  url: z.string().url().optional(),
  target,
  role: z.string().regex(/^[a-z0-9_]+$/).optional(),
  sidecar: z.boolean().optional(),
  bytes: z.number().int().positive(),
  sha256: sha,
});

const packSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  author: z.string().min(1),
  url: z.string().url(),
  license: z.string().regex(/CC0|public domain/i),
  licenseUrl: z.string().url(),
  licenseQuote: z.string().regex(/CC0|public domain/i),
  licenseCheckedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  covers: z.string().min(1),
  download: z.object({
    url: z.string().url(),
    manual: z.boolean(),
    instructions: z.string().optional(),
    bytes: z.number().int().nonnegative().optional(),
  }).passthrough(),
  files: z.array(fileSchema).min(1),
}).passthrough();

const placement = z.object({ role: z.string(), tint: hex.optional(), scale: z.number().positive().optional() });

const manifestSchema = z.object({
  version: z.literal(1),
  packs: z.array(packSchema).min(1),
  roles: z.record(z.string(), z.object({ file: target, node: z.string().optional(), note: z.string().optional() })),
  sizeScale: z.object({
    tiny: z.number(), small: z.number(), medium: z.number(), large: z.number(), huge: z.number(), gargantuan: z.number(),
  }),
  monsterStandIns: z.record(z.string(), placement),
  monsterRules: z.array(placement.extend({ match: z.string(), note: z.string().optional() })),
}).passthrough();

const manifest = manifestSchema.parse(manifestRaw);
const targets = new Set(manifest.packs.flatMap((p) => p.files.map((f) => f.target)));

/** Mirrors the lookup the game will use: first matching rule, else creature-type stand-in. */
function standInFor(id: string, type: string) {
  const rule = manifest.monsterRules.find((r) => new RegExp(r.match).test(id));
  return rule ?? manifest.monsterStandIns[type];
}

describe('assets manifest', () => {
  it('parses and every pack is CC0 with a quoted licence', () => {
    for (const p of manifest.packs) {
      expect(p.license).toMatch(/CC0/);
      expect(p.licenseQuote.length).toBeGreaterThan(40);
      if (p.download.manual) expect(p.download.instructions).toBeTruthy();
    }
  });

  it('has unique pack ids and unique file targets', () => {
    const ids = manifest.packs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = manifest.packs.flatMap((p) => p.files.map((f) => f.target));
    expect(new Set(all).size).toBe(all.length);
  });

  it('every role points at a file target in some pack', () => {
    for (const [role, r] of Object.entries(manifest.roles)) {
      expect(targets.has(r.file), `${role} -> ${r.file}`).toBe(true);
    }
    for (const role of ['humanoid_base', 'skeleton', 'goblin_standin', 'wolf', 'dragon', 'weapon_sword', 'weapon_axe', 'shield_round', 'helmet', 'dungeon_floor', 'dungeon_wall']) {
      expect(manifest.roles[role], role).toBeDefined();
    }
  });

  it('every SRD creature type has a stand-in and every stand-in/rule role exists', () => {
    for (const t of CREATURE_TYPES) expect(manifest.monsterStandIns[t], t).toBeDefined();
    for (const s of [...Object.values(manifest.monsterStandIns), ...manifest.monsterRules]) {
      expect(manifest.roles[s.role], s.role).toBeDefined();
    }
    for (const r of manifest.monsterRules) expect(() => new RegExp(r.match)).not.toThrow();
  });

  it('every SRD monster resolves to a model role', () => {
    expect(monsters.length).toBeGreaterThan(300);
    for (const m of monsters) {
      const s = standInFor(m.id, m.creatureType);
      expect(s, m.id).toBeDefined();
      expect(manifest.roles[s!.role], `${m.id} -> ${s!.role}`).toBeDefined();
    }
  });

  it('keeps the download small (< 150 MB total)', () => {
    const total = manifest.packs.flatMap((p) => p.files).reduce((n, f) => n + f.bytes, 0);
    expect(total).toBeLessThan(150 * 1024 * 1024);
  });
});
