/**
 * B008 — "The Hollow Crown" smoke test: one level-1 hero plays the whole campaign, chapter 0 to an
 * ending, in both editions (the server with the mock LLM and TTS, and the browser's in-page host with
 * no AI at all) and both languages. Real seeded dice and grid fights; the story policy is
 * tests/helpers/arc2Policy.ts, and the hero levels up whenever the XP allows (as a player would).
 * The run must chain through all four chapters into an ending without a single error event.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { combatStep } from './helpers/combatPolicy';
import { arc2Player, autoLevelUp } from './helpers/arc2Policy';
import { buildApp } from '../src/server/app';
import { InPageTransport } from '../src/client/net/transport';
import { createInPageHost } from '../src/host/inPage';
import type { GameHost } from '../src/host/gameHost';
import type { ClientCommand, ServerEvent } from '../src/shared/protocol';
import { MockLlm } from '../src/llm/mock';
import { MockTts } from '../src/tts/mock';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { totalLevel } from '../src/engine/core/creature';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { activeFight } from '../src/engine/adventure/fights';
import { getProgress } from '../src/engine/adventure/runner';
import type { GameSession } from '../src/engine/session/GameSession';

const db = loadSrd();
const CHAPTERS = ['arc2_ch0_hollow_coin', 'arc2_ch1_faces', 'arc2_ch2_gamblers_tide', 'arc2_ch3_blightwood_mint'];
const ENDINGS = ['ending_false_coin', 'ending_true_weight', 'ending_hollow_king', 'ending_stranger', 'ending_thousand_faces'];
/** Per language: the chapter separator names (ch1–ch3) and line heads of the other language that must not show. */
const LANGS = {
  en: { chapters: ['Faces in the Ledger', "The Gambler's Tide", 'The Blightwood Mint'], foreign: /\bSG \d/ },
  da: { chapters: ['Ansigter i hovedbogen', 'Spillerens tidevand', 'Visneskovens møntværk'], foreign: /\bDC \d|\b(Success|Failure)\b/ },
} as const;

interface Table {
  session: GameSession;
  events: ServerEvent[];
  send(cmd: ClientCommand): Promise<void>;
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

/** The desktop edition: the whole server with the mock AI. */
async function serverTable(seed: string): Promise<Table> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-arc2-smoke-'));
  const app = (await buildApp({ userDataDir: dir, savesDir: dir, services: { llm: new MockLlm(), tts: new MockTts() }, sessionPorts: { newSeed: () => seed } })) as FastifyInstance & { session: GameSession };
  await app.ready();
  cleanup = async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const events: ServerEvent[] = [];
  app.session.on((e) => events.push(e));
  return { session: app.session, events, send: (cmd) => app.session.handle(cmd) };
}

/** The web edition: the in-page host behind the InPage transport (JSON copies, like the UI gets). */
async function pageTable(seed: string): Promise<Table> {
  let host: GameHost | undefined;
  const transport = new InPageTransport(async () => (host = createInPageHost({ sessionPorts: { newSeed: () => seed } })));
  const events: ServerEvent[] = [];
  transport.connect({ onEvent: (e) => events.push(e), onStatus: () => undefined });
  const send = async (cmd: ClientCommand) => {
    transport.send(cmd);
    while (!host) await new Promise((r) => setTimeout(r, 5));
    await transport.idle();
  };
  return { get session() { return host!.session; }, events, send };
}

const RUNS = [
  { edition: 'server', language: 'en', open: serverTable },
  { edition: 'server', language: 'da', open: serverTable },
  { edition: 'in-page', language: 'en', open: pageTable },
  { edition: 'in-page', language: 'da', open: pageTable },
] as const;

describe('Hollow Crown smoke test (B008)', () => {
  it.each(RUNS)('plays chapter 0 to an ending ($edition, $language) with no errors', async ({ edition, language, open }) => {
    const table = await open(`arc2-smoke-${edition}-${language}`);
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('arc2-smoke'))), db);
    await table.send({ type: 'set_language', language });
    await table.send({ type: 'new_game', hero, mode: 'heroic', campaign: 'arc2_ch0_hollow_coin' });
    const { session, events } = table;
    const player = arc2Player();
    const seen: string[] = [];
    const trail: string[] = [];
    let fights = 0;
    for (let step = 0; step < 1600; step++) {
      const p = getProgress(session.current)!;
      if (p.ending) break;
      if (seen.at(-1) !== p.adventureId) seen.push(p.adventureId);
      if (activeFight(session.current)) {
        fights++;
        await table.send(combatStep(session, db));
        // A stalled fight (foes out of reach on both sides) shows as a runaway round count.
        const round = activeFight(session.current)?.enc.state.turns.round ?? 0;
        if (round > 60) throw new Error(`fight stalled in ${p.adventureId}/${p.sceneId}: ${activeFight(session.current)!.enc.log.slice(-6).join(' | ')}`);
        continue;
      }
      const level = autoLevelUp(session.current.hero, db);
      if (level) {
        await table.send(level);
        continue;
      }
      const offered = ([...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions')?.actions ?? []).map((a) => a.id);
      const choice = player.next(p.adventureId, p.sceneId, session.current.hero, session.current.flags, offered);
      if (!choice) throw new Error(`stuck in ${p.adventureId}/${p.sceneId}; offered: ${offered.join(', ')}; last: ${session.current.log.at(-1)?.text}`);
      trail.push(`${p.sceneId}:${choice}`);
      await table.send({ type: 'choose', actionId: choice });
    }

    const errors = events.filter((e) => e.type === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    const end = getProgress(session.current)!;
    expect(seen).toEqual(CHAPTERS);
    expect(ENDINGS, `${end.adventureId}/${end.sceneId} after ${trail.length} choices (…${trail.slice(-12).join(', ')}): ${session.current.log.slice(-6).map((l) => l.text).join(' | ')}`).toContain(end.ending);
    expect(fights).toBeGreaterThan(0);
    expect(session.current.campaign).toBe('arc2_ch0_hollow_coin');
    // The hero grew with the story: level 5 at the end (DESIGN_ARC2 §2).
    expect(totalLevel(session.current.hero)).toBe(5);
    expect(session.current.flags['world.brannoc_status']).toBeDefined();
    // The run spoke the table's language: chapter separators and no other language's roll words.
    const lines = events.flatMap((e) => (e.type === 'log' ? [e.entry.text] : []));
    for (const name of LANGS[language].chapters) expect(lines).toContain(`— ${name} —`);
    expect(lines.filter((l) => LANGS[language].foreign.test(l)).slice(0, 3)).toEqual([]);
  }, 300_000);
});
