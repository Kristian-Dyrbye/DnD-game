import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLoad, checkSite, formatLoad, formatReport, groupOf, loadReport, manifestClosure, siteReport } from '../scripts/site-size-lib.mjs';

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

describe('title screen load report (A128)', () => {
  const manifest = {
    'index.html': { file: 'app/index.js', isEntry: true, dynamicImports: ['webEdition.ts', 'ui/App.tsx'], css: ['app/index.css'] },
    'webEdition.ts': { file: 'app/web.js', imports: ['_lib.js'], dynamicImports: ['../host/inPage.ts'] },
    'ui/App.tsx': { file: 'app/App.js', imports: ['_lib.js'], dynamicImports: ['ui/creator/Creator.tsx', 'ui/game/GameScreen.tsx'] },
    '_lib.js': { file: 'app/lib.js' },
    '_srd.js': { file: 'app/srd.js', imports: ['_lib.js'] },
    'ui/creator/Creator.tsx': { file: 'app/Creator.js', imports: ['_srd.js', '_lib.js'] },
    'ui/game/GameScreen.tsx': { file: 'app/Game.js', imports: ['_srd.js'] },
    '../host/inPage.ts': { file: 'app/inPage.js', imports: ['_srd.js'] },
  };
  const sizes: Record<string, number> = { 'app/index.js': 10, 'app/index.css': 5, 'app/web.js': 2, 'app/App.js': 20, 'app/lib.js': 30, 'app/srd.js': 3000, 'app/Creator.js': 40, 'app/Game.js': 50, 'app/inPage.js': 700 };
  const gz = (f: string) => ({ bytes: sizes[f]! * 4, gzip: sizes[f]! });

  it('first load = start modules + their static imports; lazy screens exclude what is already loaded', () => {
    expect([...manifestClosure(manifest, ['ui/App.tsx'])].sort()).toEqual(['app/App.js', 'app/lib.js']);
    const r = loadReport(manifest, gz);
    expect(r.firstLoad).toEqual({ files: 5, bytes: 67 * 4, gzip: 67 });
    expect(r.lazy.creator!.gzip).toBe(3040);
    expect(r.lazy.game!.gzip).toBe(3050);
    expect(r.lazy['game host']!.gzip).toBe(3700);
    expect(r.lazy['3D']!.files).toBe(0);
    expect(checkLoad(r)).toEqual([]);
    expect(formatLoad(r)[0]).toContain('Title screen code');
  });

  it('flags a title screen over the budget or a manifest without the start chunks', () => {
    const r = loadReport(manifest, gz);
    expect(checkLoad(r, 50)[0]).toContain('over the');
    expect(checkLoad(loadReport({}, gz))).toEqual(['no start-up chunks found in the Vite manifest']);
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
