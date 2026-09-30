/**
 * A124: the in-browser game host. Drives new_game → choose → say → save → load through the
 * InPage transport (no server, no LLM), and checks the bundled adventure list matches the folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InPageTransport, type Connection } from '../src/client/net/transport';
import { createInPageHost } from '../src/host/inPage';
import { MemorySaves } from '../src/host/memorySaves';
import { BUNDLED_ADVENTURES, BUNDLED_TRANSLATIONS } from '../src/host/bundled';
import { STARTING_ADVENTURE } from '../src/host/gameHost';
import type { GameHost } from '../src/host/gameHost';
import type { ServerEvent } from '../src/shared/protocol';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';

type Of<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>;

describe('in-page game host', () => {
  it('plays new_game → choose → say → save → load without a server', async () => {
    const saves = new MemorySaves();
    let host: GameHost | undefined;
    const transport = new InPageTransport(async () => (host = createInPageHost({ saves, sessionPorts: { newSeed: () => 'inpage-test' } })));
    const events: ServerEvent[] = [];
    const statuses: Connection[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s) });
    const of = <T extends ServerEvent['type']>(t: T) => events.filter((e): e is Of<T> => e.type === t);

    const db = loadSrd();
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed(1))), db);
    // Sent before the host finished loading: waits in the outbox.
    transport.send({ type: 'new_game', hero, mode: 'heroic' });
    await vi_until(() => host !== undefined);
    await transport.idle();
    expect(statuses).toEqual(['connecting', 'open']);
    expect(host!.defaultAdventure).toBe(STARTING_ADVENTURE);
    expect(of('error')).toEqual([]);
    const snap = of('snapshot').at(-1)!;
    expect(snap.state.hero.name).toBe(hero.name);
    expect(of('saved').some((e) => e.meta.kind === 'auto')).toBe(true);
    // Template narration (no LLM) and data buttons.
    expect(of('log').some((e) => e.entry.kind === 'narration')).toBe(true);
    const buttons = of('suggestions').at(-1)!.actions.filter((a) => !a.say);
    expect(buttons.length).toBeGreaterThan(0);

    const logBefore = of('log').length;
    transport.send({ type: 'choose', actionId: buttons[0]!.id });
    await transport.idle();
    expect(of('error')).toEqual([]);
    expect(of('log').length).toBeGreaterThan(logBefore);

    // Free text goes through the keyword intent parser.
    const logAfterChoose = of('log').length;
    transport.send({ type: 'say', text: 'I look around' });
    await transport.idle();
    expect(of('error')).toEqual([]);
    expect(of('log').length).toBeGreaterThan(logAfterChoose);

    transport.send({ type: 'save', slot: 'slot-1', name: 'Web save' });
    await transport.idle();
    const saved = of('saved').at(-1)!;
    expect(saved.meta).toMatchObject({ slotId: 'slot-1', kind: 'manual', name: 'Web save', characterName: hero.name });
    expect(saves.list().map((e) => (e.ok ? e.meta.slotId : e.slotId))).toContain('slot-1');

    const time = of('snapshot').at(-1)!.state.time;
    transport.send({ type: 'load', slot: 'slot-1' });
    await transport.idle();
    expect(of('error')).toEqual([]);
    expect(of('snapshot').at(-1)!.state.time).toBe(time);
  });

  it('events are JSON copies, not the live game state', async () => {
    let host: GameHost | undefined;
    const transport = new InPageTransport(async () => (host = createInPageHost({ sessionPorts: { newSeed: () => 'copy-test' } })));
    const events: ServerEvent[] = [];
    transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
    const db = loadSrd();
    transport.send({ type: 'new_game', hero: buildCharacter(toBuildInput(quickBuild('wizard', db, Rng.fromSeed(2))), db), mode: 'heroic' });
    await vi_until(() => host !== undefined);
    await transport.idle();
    const snap = events.filter((e): e is Of<'snapshot'> => e.type === 'snapshot').at(-1)!;
    expect(snap.state).not.toBe(host!.session.current);
    expect(snap.state).toEqual(JSON.parse(JSON.stringify(host!.session.current)));
  });

  it('invalid commands come back as error events', async () => {
    const host = createInPageHost();
    expect(host.receive('{"type":"nope"}')).toMatchObject({ type: 'error' });
    expect(host.receive('not json')).toMatchObject({ type: 'error' });
  });

  it('bundles every adventure file under data/adventures', () => {
    const root = path.join(process.cwd(), 'data', 'adventures');
    const onDisk: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json') && 'formatVersion' in JSON.parse(fs.readFileSync(full, 'utf8'))) onDisk.push(path.relative(root, full).split(path.sep).join('/'));
      }
    };
    walk(root);
    expect(BUNDLED_ADVENTURES.map((a) => a.file).sort()).toEqual(onDisk.sort());
  });

  it('bundles every content translation under data/i18n (A142)', () => {
    const root = path.join(process.cwd(), 'data', 'i18n');
    const onDisk: string[] = [];
    for (const lang of fs.readdirSync(root, { withFileTypes: true })) {
      if (!lang.isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(root, lang.name))) if (f.endsWith('.json')) onDisk.push(`${lang.name}/${f.slice(0, -5)}`);
    }
    const bundled = Object.entries(BUNDLED_TRANSLATIONS).flatMap(([lang, o]) => Object.keys(o ?? {}).map((k) => `${lang}/${k}`));
    expect(bundled.sort()).toEqual(onDisk.sort());
  });
});

async function vi_until(cond: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
