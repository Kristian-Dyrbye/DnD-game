import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSrd } from '../engine/data/srdBundle';
import { loadAdventures } from './adventures';

describe('loadAdventures', () => {
  it('loads every shipped adventure without problems', () => {
    const { adventures, problems } = loadAdventures(path.join(process.cwd(), 'data', 'adventures'), loadSrd());
    expect(problems).toEqual([]);
    expect(adventures.has('millbrook_demo')).toBe(true);
  });

  it('skips broken files and non-adventure JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-adv-'));
    try {
      fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
      fs.writeFileSync(path.join(dir, 'invalid.json'), JSON.stringify({ formatVersion: 1, id: 'x' }));
      fs.writeFileSync(path.join(dir, 'flags.json'), JSON.stringify({ flags: [] }));
      const { adventures, problems } = loadAdventures(dir);
      expect(adventures.size).toBe(0);
      expect(problems.map((p) => path.basename(p.file)).sort()).toEqual(['broken.json', 'invalid.json']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
