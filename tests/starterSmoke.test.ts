/**
 * A106 — starter arc smoke test: the whole server (buildApp) with the mock LLM and TTS, real seeded
 * dice and real grid fights. A small policy picks the next story action by the state of the flags
 * (so failed checks just take the other branch) and plays the hero's combat turns (attack whoever is
 * in reach, else walk toward the nearest foe). The run must reach a starter ending and chain into
 * chapter 1 without a single error event.
 */
import { combatStep } from './helpers/combatPolicy';
import { nextStarterChoice } from './helpers/starterPolicy';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import type { ServerEvent } from '../src/shared/protocol';
import { MockLlm } from '../src/llm/mock';
import { MockTts } from '../src/tts/mock';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { activeFight } from '../src/engine/adventure/fights';
import { getProgress } from '../src/engine/adventure/runner';
import type { GameSession } from '../src/engine/session/GameSession';

const db = loadSrd();
let app: (FastifyInstance & { session: GameSession }) | undefined;
let dir = '';
afterEach(async () => {
  await app?.close();
  app = undefined;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('starter arc smoke test (A106)', () => {
  it('plays the key path end to end through the server with the mock LLM and reaches chapter 1', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-smoke-'));
    app = (await buildApp({ userDataDir: dir, savesDir: dir, services: { llm: new MockLlm(), tts: new MockTts() }, sessionPorts: { newSeed: () => 'smoke-1' } })) as FastifyInstance & { session: GameSession };
    await app.ready();
    const session = app.session;
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('smoke'))), db);
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });

    let offered: string[] = [];
    const lastSuggestions = () => [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    let fights = 0;
    for (let step = 0; step < 400; step++) {
      const p = getProgress(session.current)!;
      if (p.adventureId !== 'millbrook_disappearances') break;
      if (activeFight(session.current)) {
        fights++;
        await session.handle(combatStep(session, db));
        continue;
      }
      offered = (lastSuggestions()?.actions ?? []).map((a) => a.id);
      const choice = nextStarterChoice(p.sceneId, session.current.flags, offered);
      if (!choice) throw new Error(`stuck in ${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      await session.handle({ type: 'choose', actionId: choice });
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    expect(fights).toBeGreaterThan(0); // real grid fights happened
    expect(session.current.flags['arc.main.tooth_want_holder']).toBe('player');
    expect(session.current.companions.map((c) => c.id)).toEqual(['corwin']);
    // The ending chained straight into chapter 1.
    expect(getProgress(session.current)!.adventureId).toBe('ch1_whispering_fen');
    expect(session.current.log.some((l) => l.text === '— The Whispering Fen —')).toBe(true);
  }, 120_000);
});
