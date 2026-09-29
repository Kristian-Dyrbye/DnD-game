import { describe, expect, it } from 'vitest';
import loreJson from '../../../../data/world/lore.json';
import { LoreSchema } from '../../../engine/world/lore';
import { MAP_HEIGHT, MAP_WIDTH } from '../../../engine/world/lore';
import { labelsOverlap, placeLabels, regionPath, terrainGlyphs } from './mapArt';

const lore = LoreSchema.parse(loreJson);

describe('world map art', () => {
  it('region outlines are closed, deterministic and stay near their bounds', () => {
    for (const r of lore.regions) {
      const d = regionPath(r.mapBounds, r.id);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
      expect(regionPath(r.mapBounds, r.id)).toBe(d);
      const nums = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      const b = r.mapBounds;
      for (const [x, y] of nums) {
        expect(x).toBeGreaterThan(b.x - b.width * 0.15);
        expect(x).toBeLessThan(b.x + b.width * 1.15);
        expect(y).toBeGreaterThan(b.y - b.height * 0.15);
        expect(y).toBeLessThan(b.y + b.height * 1.15);
      }
    }
    expect(regionPath(lore.regions[0]!.mapBounds, 'a')).not.toBe(regionPath(lore.regions[0]!.mapBounds, 'b'));
  });

  it('terrain glyphs keep clear of places', () => {
    const r = lore.regions[0]!;
    const places = lore.locations.filter((l) => l.regionId === r.id).map((l) => l.mapPos);
    for (const g of terrainGlyphs(r.mapBounds, r.tone, r.id, places)) for (const p of places) expect(Math.hypot(p.x - g.x, p.y - g.y)).toBeGreaterThanOrEqual(40);
  });

  it('labels of all known places are placed without overlapping each other', () => {
    const labels = lore.locations.map((l) => ({ id: l.id, text: l.name, x: l.mapPos.x, y: l.mapPos.y }));
    const out = placeLabels(labels, { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT });
    let clashes = 0;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (labelsOverlap(out[i]!, labels[i]!.text, out[j]!, labels[j]!.text)) clashes++;
    expect(clashes).toBe(0);
  });
});
