/**
 * Validates the campaign design bible's world-flag registry (data/adventures/flags.json)
 * against the world lore, the SRD monster and magic-item lists, and DESIGN.md itself:
 * every flag named in the bible is registered and vice versa (Build Prompt §7.2).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = path.resolve(__dirname, '..');
const readJson = (...p: string[]): unknown => JSON.parse(readFileSync(path.join(root, ...p), 'utf8'));

const lore = readJson('data', 'world', 'lore.json') as {
  regions: { id: string }[];
  factions: { id: string }[];
  locations: { id: string }[];
};
const monsterIds = new Set((readJson('data', 'srd', 'monsters.json') as { id: string }[]).map((m) => m.id));
const itemIds = new Set((readJson('data', 'srd', 'magic-items.json') as { id: string }[]).map((m) => m.id));
const locationIds = new Set(lore.locations.map((l) => l.id));
const factionIds = new Set(lore.factions.map((f) => f.id));
const regionIds = new Set(lore.regions.map((r) => r.id));
const design = readFileSync(path.join(root, 'data', 'adventures', 'DESIGN.md'), 'utf8');

const SnakeId = z.string().regex(/^[a-z][a-z0-9_]*$/);
const FLAG_ID = /^(arc\.(starter|main)|world)\.[a-z][a-z0-9_]*$/;

const FlagSchema = z
  .object({
    id: z.string().regex(FLAG_ID),
    type: z.enum(['boolean', 'number', 'string']),
    default: z.union([z.boolean(), z.number(), z.string()]),
    values: z.array(SnakeId).min(2).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    setBy: z.array(SnakeId).min(1),
    readBy: z.array(SnakeId).min(1),
    description: z.string().min(10),
  })
  .strict();

const RegistrySchema = z
  .object({
    $comment: z.string(),
    specialIds: z.array(SnakeId).min(1),
    chapters: z
      .array(
        z
          .object({
            id: SnakeId,
            title: z.string().min(1),
            regionIds: z.array(SnakeId).min(1),
            levelRange: z.tuple([z.number().int().min(1), z.number().int().max(20)]),
          })
          .strict(),
      )
      .min(6),
    scenes: z.array(z.object({ id: SnakeId, chapter: SnakeId, locationId: SnakeId }).strict()).min(1),
    locationsUsed: z.array(SnakeId).min(1),
    factionsUsed: z.array(SnakeId).min(1),
    monstersUsed: z.array(SnakeId).min(1),
    itemsUsed: z.array(SnakeId),
    flags: z.array(FlagSchema).min(1),
  })
  .strict();

type Registry = z.infer<typeof RegistrySchema>;
const parsed = RegistrySchema.safeParse(readJson('data', 'adventures', 'flags.json'));
const reg = (parsed.success ? parsed.data : { chapters: [], scenes: [], flags: [] }) as Registry;

const dupes = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i);

describe('data/adventures/flags.json (campaign design registry)', () => {
  it('matches the registry schema', () => {
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('has unique flag, scene and chapter ids', () => {
    expect(dupes(reg.flags.map((f) => f.id))).toEqual([]);
    expect(dupes(reg.scenes.map((s) => s.id))).toEqual([]);
    expect(dupes(reg.chapters.map((c) => c.id))).toEqual([]);
  });

  it('uses the three flag namespaces', () => {
    for (const ns of ['arc.starter.', 'arc.main.', 'world.']) {
      expect(reg.flags.some((f) => f.id.startsWith(ns)), ns).toBe(true);
    }
  });

  it('has defaults, values and ranges consistent with each flag type', () => {
    for (const f of reg.flags) {
      expect(typeof f.default, f.id).toBe(f.type);
      if (f.type === 'string') {
        expect(f.values, `${f.id} needs values`).toBeDefined();
        expect(f.values, f.id).toContain(f.default);
        expect(dupes(f.values ?? []), f.id).toEqual([]);
      } else {
        expect(f.values, `${f.id} must not have values`).toBeUndefined();
      }
      if (f.type !== 'number') {
        expect(f.min, f.id).toBeUndefined();
        expect(f.max, f.id).toBeUndefined();
      } else if (f.min !== undefined && f.max !== undefined) {
        expect(f.min, f.id).toBeLessThanOrEqual(f.max);
        expect(f.default as number, f.id).toBeGreaterThanOrEqual(f.min);
        expect(f.default as number, f.id).toBeLessThanOrEqual(f.max);
      }
    }
  });

  it('references only declared scenes, chapters or special ids in setBy/readBy', () => {
    const known = new Set([...reg.scenes.map((s) => s.id), ...reg.chapters.map((c) => c.id), ...reg.specialIds]);
    const bad: string[] = [];
    for (const f of reg.flags) {
      for (const ref of [...f.setBy, ...f.readBy]) if (!known.has(ref)) bad.push(`${f.id} -> ${ref}`);
    }
    expect(bad).toEqual([]);
  });

  it('puts every scene in a declared chapter at an existing lore location', () => {
    const chapterIds = new Set(reg.chapters.map((c) => c.id));
    for (const s of reg.scenes) {
      expect(chapterIds.has(s.chapter), s.id).toBe(true);
      expect(locationIds.has(s.locationId), `${s.id} @ ${s.locationId}`).toBe(true);
    }
    for (const c of reg.chapters) {
      for (const r of c.regionIds) expect(regionIds.has(r), `${c.id} region ${r}`).toBe(true);
      expect(c.levelRange[0]).toBeLessThanOrEqual(c.levelRange[1]);
    }
    // The arc must visit all three regions.
    expect(new Set(reg.chapters.flatMap((c) => c.regionIds)).size).toBe(regionIds.size);
  });

  it('references only lore location and faction ids', () => {
    for (const id of reg.locationsUsed) expect(locationIds.has(id), `location ${id}`).toBe(true);
    for (const id of reg.factionsUsed) expect(factionIds.has(id), `faction ${id}`).toBe(true);
    for (const s of reg.scenes) expect(reg.locationsUsed, s.id).toContain(s.locationId);
    for (const f of reg.flags) {
      for (const m of f.description.matchAll(/\b(loc|fac):([a-z0-9_]+)/g)) {
        const [, kind, id] = m;
        if (kind === 'loc') expect(locationIds.has(id!), `${f.id}: loc:${id}`).toBe(true);
        else expect(factionIds.has(id!), `${f.id}: fac:${id}`).toBe(true);
      }
    }
  });

  it('lists only real SRD monsters and magic items', () => {
    for (const id of reg.monstersUsed) expect(monsterIds.has(id), `monster ${id}`).toBe(true);
    for (const id of reg.itemsUsed) expect(itemIds.has(id), `item ${id}`).toBe(true);
  });
});

describe('data/adventures/DESIGN.md consistency with flags.json', () => {
  it('mentions every registered flag, and registers every flag it mentions', () => {
    const mentioned = new Set([...design.matchAll(/\b(?:arc\.(?:starter|main)|world)\.[a-z0-9_]+/g)].map((m) => m[0]));
    const registered = new Set(reg.flags.map((f) => f.id));
    expect([...mentioned].filter((id) => !registered.has(id)).sort()).toEqual([]);
    expect([...registered].filter((id) => !mentioned.has(id)).sort()).toEqual([]);
  });

  it('mentions every scene id and chapter id', () => {
    for (const id of [...reg.scenes.map((s) => s.id), ...reg.chapters.map((c) => c.id)]) {
      expect(design.includes(`\`${id}\``), id).toBe(true);
    }
  });

  it('lists exactly the monsters used in its encounter lines (`id` ×n)', () => {
    const tokens = [...design.matchAll(/`([a-z0-9_]+)` ×/g)].map((m) => m[1]!);
    const monsters = new Set(tokens.filter((t) => !itemIds.has(t)));
    for (const t of monsters) expect(monsterIds.has(t), `unknown monster ${t}`).toBe(true);
    expect([...monsters].sort()).toEqual([...reg.monstersUsed].sort());
  });

  it('keeps every chapter scene count within the design limits', () => {
    const count = (ch: string): number => reg.scenes.filter((s) => s.chapter === ch).length;
    const starter = count('starter');
    expect(starter).toBeGreaterThanOrEqual(5);
    expect(starter).toBeLessThanOrEqual(7);
    for (const c of reg.chapters.filter((x) => x.id !== 'starter')) {
      expect(count(c.id), c.id).toBeGreaterThanOrEqual(4);
      expect(count(c.id), c.id).toBeLessThanOrEqual(8);
    }
  });
});
