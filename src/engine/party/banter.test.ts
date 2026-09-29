import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import { MockLlm } from '../../llm/mock';
import { banterMessages, llmBanter } from '../../llm/prompts/banter';
import type { LlmProvider } from '../../llm/types';
import type { ServerEvent } from '../../shared/protocol';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { LoreSchema } from '../world/lore';
import { BANTER_MIN_ACTIONS, banterDue, speakBanter } from './banter';
import { CompanionRosterSchema, recruitCompanion } from './companions';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const def = (id: string) => roster.companions.find((c) => c.id === id)!;
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('h'))), db);

describe('banter timing', () => {
  it('nobody talks without companions, before the cooldown, and not every time', () => {
    const s = newGameState(hero(), 'heroic', 'b');
    for (let i = 0; i < 10; i++) expect(banterDue(s, roster)).toBeUndefined();
    recruitCompanion(s, def('nettle'), db);
    s.extensions.banter = { actions: 0, lastAt: s.time };
    for (let i = 0; i < BANTER_MIN_ACTIONS - 1; i++) expect(banterDue(s, roster)).toBeUndefined();
    s.time += 60;
    let spoke = 0;
    for (let i = 0; i < 40; i++) {
      s.nextId++;
      if (banterDue(s, roster)) spoke++;
    }
    expect(spoke).toBeGreaterThan(0);
    expect(spoke).toBeLessThan(40);
  });
});

describe('banter lines', () => {
  it('uses the LLM when available, otherwise written lines; grumbles when resentful', async () => {
    const s = newGameState(hero(), 'heroic', 'b');
    recruitCompanion(s, def('rook'), db);
    const line = await speakBanter(s, def('rook'), 'A door creaks.', async () => '"Doors creak. People lie. Same thing, really."');
    expect(line).toBe('Doors creak. People lie. Same thing, really.');
    expect(s.extensions.banter).toMatchObject({ actions: 0, lastSpeaker: 'rook' });
    const fallback = await speakBanter(s, def('rook'), 'x', async () => {
      throw new Error('down');
    });
    expect(def('rook').banter).toContain(fallback);
    s.flags['world.rook_loyalty'] = 10;
    expect(def('rook').grumbles).toContain(await speakBanter(s, def('rook'), 'x'));
  });

  it('the LLM prompt carries personality, voice and mood; the mock falls back', async () => {
    const m = banterMessages('Nettle', 'Blunt.', 'Fen dialect.', 'resentful', 'A goblin died.');
    expect(m[0]!.content).toMatch(/You are Nettle.*Blunt\..*Fen dialect\..*resentful/);
    await expect(llmBanter(() => new MockLlm())(def('nettle'), 'content', 'x')).rejects.toThrow();
    const llm = new MockLlm({ script: ['Rot and roots!'] });
    const real: LlmProvider = { name: 'ollama', chat: llm.chat.bind(llm), stream: llm.stream.bind(llm), listModels: llm.listModels.bind(llm), status: llm.status.bind(llm) };
    expect(await llmBanter(() => real)(def('nettle'), 'content', 'x')).toBe('Rot and roots!');
  });

  it('companions speak up in play as dialogue lines', async () => {
    const raw = structuredClone(demo) as unknown as { chapters: { scenes: { actions: Record<string, unknown>[] }[] }[] };
    raw.chapters[0]!.scenes[0]!.actions.push({ id: 'hire', label: 'Hire', once: true, outcome: { recruit: 'corwin' } }, { id: 'wait', label: 'Wait', outcome: { minutes: 30 } });
    const adventure = validateAdventure(raw, db).adventure!;
    const port = adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, companions: roster });
    const session = new GameSession({ actions: port, newSeed: () => 'talk' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    await session.handle({ type: 'choose', actionId: 'hire' });
    for (let i = 0; i < 30; i++) await session.handle({ type: 'choose', actionId: 'wait' });
    await port.idle();
    const lines = events.filter((e) => e.type === 'log' && e.entry.kind === 'dialogue');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(15);
    const first = lines[0];
    expect(first?.type === 'log' && first.entry.speaker).toBe('Ser Corwin Ashvale');
    expect(def('corwin').banter).toContain(first?.type === 'log' ? first.entry.text : '');
  });
});
