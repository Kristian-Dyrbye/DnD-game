import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSite, formatReport, groupOf, siteReport } from '../scripts/site-size-lib.mjs';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function site(files: Record<string, number>): string {
  dir = mkdtempSync(join(tmpdir(), 'site-size-'));
  for (const [rel, bytes] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, Buffer.alloc(bytes));
  }
  return dir;
}

describe('site size report', () => {
  it('groups files by app code, models, audio and other', () => {
    expect(groupOf('app/index-abc.js')).toBe('app');
    expect(groupOf('assets/models/kaykit/Knight.glb')).toBe('models');
    expect(groupOf('assets/audio/music/town.ogg')).toBe('audio');
    expect(groupOf('index.html')).toBe('other');
  });

  it('sums bytes and lists the largest files first', () => {
    const r = siteReport(site({ 'index.html': 10, 'app/a.js': 300, 'assets/models/x.glb': 500, 'assets/audio/music/y.ogg': 200 }), 2);
    expect(r.total).toBe(1010);
    expect(r.files).toBe(4);
    expect(r.groups).toEqual({ app: 300, models: 500, audio: 200, other: 10 });
    expect(r.largest).toEqual([
      { path: 'assets/models/x.glb', bytes: 500 },
      { path: 'app/a.js', bytes: 300 },
    ]);
    expect(formatReport(r)[0]).toContain('4 files');
  });

  it('flags an empty site, a too-big site and too-big files', () => {
    expect(checkSite(siteReport(site({})))).toEqual(['the site folder is empty']);
    const r = siteReport(site({ 'index.html': 10, 'app/big.js': 90 }));
    expect(checkSite(r)).toEqual([]);
    const problems = checkSite(r, { site: 50, file: 80 });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('over the');
    expect(problems[1]).toContain('app/big.js');
  });
});

describe('GitHub Pages workflow', () => {
  const wf = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

  it('checks, builds and deploys the web edition', () => {
    for (const step of [
      'npm ci',
      'node scripts/assets-fetch.mjs',
      'node scripts/audio-fetch.mjs',
      'npm run typecheck',
      'npm test',
      'npm run build:web',
      'node scripts/site-size.mjs',
      'actions/upload-pages-artifact',
      'actions/deploy-pages',
    ]) {
      expect(wf, step).toContain(step);
    }
    expect(wf).toContain('path: dist-web');
    expect(wf).toMatch(/branches:\s*\[\s*master\s*\]/);
    expect(wf).toContain('workflow_dispatch');
  });
});
