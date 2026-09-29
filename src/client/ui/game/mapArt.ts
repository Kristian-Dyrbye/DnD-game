/**
 * World-map art helpers (spec §11.1 "illustrated overland map"), pure so they're testable:
 * - `regionPath`: an organic coastline around a region's bounds (seeded, smooth closed Bézier path);
 * - `terrainGlyphs`: seeded trees / reeds / waves scattered inside a region by its tone;
 * - `placeLabels`: greedy label placement that avoids other labels and place markers.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rand(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A closed, smooth, irregular outline inside `b` (seeded by `seed`): points on the ellipse-ish
 * rounded rectangle, pushed in and out by a few low-frequency waves, joined with Catmull-Rom curves.
 */
export function regionPath(b: Box, seed: string, points = 36): string {
  const r = rand(seed);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const waves = [0, 1, 2].map(() => ({ f: 2 + Math.floor(r() * 4), p: r() * Math.PI * 2, a: 0.03 + r() * 0.05 }));
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    // Superellipse (squarish) so regions still fill their boxes.
    const c = Math.cos(t);
    const s = Math.sin(t);
    const sq = (v: number) => Math.sign(v) * Math.abs(v) ** 0.55;
    const k = 0.9 + waves.reduce((acc, w) => acc + w.a * Math.sin(w.f * t + w.p), 0) + (r() - 0.5) * 0.04;
    pts.push([cx + (sq(c) * b.width * k) / 2, cy + (sq(s) * b.height * k) / 2]);
  }
  // Catmull-Rom → cubic Bézier.
  const at = (i: number) => pts[(i + pts.length) % pts.length]!;
  let d = `M${at(0)[0].toFixed(1)},${at(0)[1].toFixed(1)}`;
  for (let i = 0; i < pts.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]!.toFixed(1)},${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)},${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

export type Glyph = { kind: 'tree' | 'reed' | 'wave' | 'hill'; x: number; y: number; s: number };

/** Decorative terrain inside a region (by tone), keeping away from places so icons stay readable. */
export function terrainGlyphs(b: Box, tone: string, seed: string, avoid: readonly { x: number; y: number }[], count = 26): Glyph[] {
  const r = rand(`${seed}:glyphs`);
  const kinds: Glyph['kind'][] = tone === 'dark_fantasy' ? ['reed', 'tree', 'reed'] : tone === 'swashbuckling' ? ['wave', 'hill', 'tree'] : ['tree', 'hill', 'tree'];
  const out: Glyph[] = [];
  for (let tries = 0; out.length < count && tries < count * 8; tries++) {
    // Stay well inside the (irregular) outline: the middle 76% of the box.
    const x = b.x + b.width * (0.12 + r() * 0.76);
    const y = b.y + b.height * (0.14 + r() * 0.72);
    if (avoid.some((p) => Math.hypot(p.x - x, p.y - y) < 40)) continue;
    if (out.some((g) => Math.hypot(g.x - x, g.y - y) < 22)) continue;
    out.push({ kind: kinds[Math.floor(r() * kinds.length)]!, x, y, s: 0.8 + r() * 0.5 });
  }
  return out;
}

export interface LabelIn {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface LabelOut {
  id: string;
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
}

/** Rough text box for a label (map units; ~15 px font). */
const boxOf = (l: LabelOut, text: string): Box => {
  const w = text.length * 8.2;
  const h = 16;
  const x = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
  return { x, y: l.y - h + 4, width: w, height: h };
};

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Place each label next to its point: right, left, above, below, then the diagonals — the first spot
 * that overlaps no placed label and no other marker wins (else the least crowded one).
 */
export function placeLabels(labels: readonly LabelIn[], bounds: Box): LabelOut[] {
  const placed: { out: LabelOut; box: Box }[] = [];
  const markers: Box[] = labels.map((l) => ({ x: l.x - 10, y: l.y - 10, width: 20, height: 20 }));
  const inside = (b: Box) => b.x >= bounds.x && b.y >= bounds.y && b.x + b.width <= bounds.x + bounds.width && b.y + b.height <= bounds.y + bounds.height;
  const out: LabelOut[] = [];
  for (const [i, l] of labels.entries()) {
    const options: LabelOut[] = [
      { id: l.id, x: l.x + 14, y: l.y + 5, anchor: 'start' },
      { id: l.id, x: l.x - 14, y: l.y + 5, anchor: 'end' },
      { id: l.id, x: l.x, y: l.y - 16, anchor: 'middle' },
      { id: l.id, x: l.x, y: l.y + 26, anchor: 'middle' },
      { id: l.id, x: l.x + 12, y: l.y - 12, anchor: 'start' },
      { id: l.id, x: l.x - 12, y: l.y - 12, anchor: 'end' },
      { id: l.id, x: l.x + 12, y: l.y + 22, anchor: 'start' },
      { id: l.id, x: l.x - 12, y: l.y + 22, anchor: 'end' },
    ];
    const cost = (o: LabelOut) => {
      const b = boxOf(o, l.text);
      return placed.filter((p) => overlaps(p.box, b)).length * 10 + markers.filter((m, j) => j !== i && overlaps(m, b)).length * 5 + (inside(b) ? 0 : 3);
    };
    let best = options[0]!;
    let bestCost = Infinity;
    for (const o of options) {
      const c = cost(o);
      if (c < bestCost) {
        best = o;
        bestCost = c;
      }
      if (c === 0) break;
    }
    placed.push({ out: best, box: boxOf(best, l.text) });
    out.push(best);
  }
  return out;
}

/** Whether two placed labels overlap (tests). */
export function labelsOverlap(a: LabelOut, at: string, b: LabelOut, bt: string): boolean {
  return overlaps(boxOf(a, at), boxOf(b, bt));
}
