import { describe, expect, it } from 'vitest';
import defeatsJson from '../../../data/tables/defeat-outcomes.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import flagsJson from '../../../data/adventures/flags.json';
import loreJson from '../../../data/world/lore.json';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession } from '../session/GameSession';
import { createDefaultRegistry } from '../systems';
import { FlagRegistry } from '../world/flags';
import { LoreSchema } from '../world/lore';
import { CombatNarrationQueue, combatMoments, pickMoments, type CombatNarrationMode } from './combatNarration';
import { DefeatTableSchema } from './defeat';
import { activeFight } from './fights';
import type { NarrationJob, Narrator } from './narration';
import { adventureActionPort } from './sessionActions';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const defeats = DefeatTableSchema.parse(defeatsJson);
const flags = FlagRegistry.fromJson(flagsJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;

const LINES = [
  'Roll for initiative!',
  'Ogre attacks Sabine with Greatclub: d20 (adv: 18, 15 → 18) + 6 (Greatclub) = 24 vs AC 17 — Critical Hit',
  'Sabine takes 29 damage — Critical! 4d8+4 bludgeoning: [5, 8, 6, 6] + 4 = 29 — falls unconscious!',
  'Sabine attacks Goblin 1 with Longsword: d20: 12 + 5 = 17 vs AC 15 — Hit',
  'Goblin 1 takes 7 damage — 1d8+3 slashing: [4] + 3 = 7 — dies!',
  'Victory!',
];

describe('combat moments', () => {
  it('turn engine lines into number-free facts; key mode keeps only the dramatic ones', () => {
    const all = combatMoments(LINES);
    expect(all.map((m) => m.fact)).toEqual([
      'Steel is drawn: the fight begins.',
      'Ogre lands a critical hit on Sabine with Greatclub.',
      'Sabine falls, unconscious.',
      'Sabine hits Goblin 1 with Longsword.',
      'Goblin 1 is slain.',
      'The last foe falls: the fight is won.',
    ]);
    expect(pickMoments(LINES, 'key')).not.toContain('Sabine hits Goblin 1 with Longsword.');
    expect(pickMoments(LINES, 'every')).toHaveLength(4); // capped, latest kept
    expect(pickMoments(LINES, 'off')).toEqual([]);
  });

  it('the queue returns at once, runs one job at a time and keeps only the newest waiting job', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const narrator: Narrator = async function* (job: NarrationJob) {
      seen.push(job.facts[0]!);
      if (seen.length === 1) await gate;
      yield job.facts.join(' ');
    };
    const q = new CombatNarrationQueue(narrator);
    const logged: string[] = [];
    const session = { reserveId: () => logged.length + 1, emit: () => undefined, addLog: (_k: string, text: string) => logged.push(text) } as unknown as GameSession;
    const job = (f: string): NarrationJob => ({ kind: 'combat', facts: [f], ctx: {} as NarrationJob['ctx'] });
    q.push(session, job('a'));
    q.push(session, job('b'));
    q.push(session, job('c')); // replaces b
    expect(logged).toEqual([]);
    release();
    await q.idle();
    expect(seen).toEqual(['a', 'c']);
    expect(logged).toEqual(['a', 'c']);
  });
});

describe('combat narration in the session', () => {
  async function fight(mode: CombatNarrationMode, narrator: Narrator) {
    const session = new GameSession({
      actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, flags, defeats, narrator, combatNarration: () => mode }),
      systems: createDefaultRegistry({ lore }),
      newSeed: () => 'fight',
      saves: {
        save: () => {
          throw new Error('no');
        },
        autosave: (m) => ({ ...m, slotId: 'auto-1', kind: 'auto', savedAt: 'now' }),
        load: () => {
          throw new Error('no');
        },
      },
    });
    const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db);
    await session.handle({ type: 'new_game', hero, mode: 'heroic' });
    for (const actionId of ['talk_mayor', 'exit.to_mill', 'exit.unlock']) await session.handle({ type: 'choose', actionId });
    return session;
  }

  it("never blocks: combat commands finish while the model is still 'thinking'", async () => {
    const jobs: string[][] = [];
    const stuck: Narrator = async function* (job) {
      if (job.kind === 'combat') {
        jobs.push(job.facts);
        await new Promise(() => undefined); // never resolves
      }
      yield* [];
    };
    const session = await fight('every', stuck);
    expect(activeFight(session.current)).toBeDefined();
    expect(jobs.length).toBeGreaterThan(0); // fight start narrated in the background
    for (let i = 0; i < 4 && activeFight(session.current); i++) await session.handle({ type: 'combat_act', action: { kind: 'end_turn' } });
    // Got here: the handler didn't wait for narration.
    expect(jobs.length).toBe(1); // still stuck on the first job; newer ones wait (at most one)
  });

  it("'off' narrates nothing", async () => {
    const jobs: string[][] = [];
    const n: Narrator = async function* (job) {
      if (job.kind === 'combat') jobs.push(job.facts);
      yield* [];
    };
    const session = await fight('off', n);
    await session.handle({ type: 'combat_act', action: { kind: 'end_turn' } });
    expect(jobs).toEqual([]);
  });
});

describe('settling the queue when a fight ends', () => {
  it('stops the running job at its last full sentence, narrates the waiting job from its facts, and logs both before the caller continues', async () => {
    const logged: string[] = [];
    const session = { reserveId: () => logged.length + 1, emit: () => undefined, addLog: (_k: string, text: string) => logged.push(text) } as unknown as GameSession;
    const job = (f: string): NarrationJob => ({ kind: 'combat', facts: [f], ctx: { msgs: undefined } as unknown as NarrationJob['ctx'] });
    let aborted = false;
    const narrator: Narrator = async function* (job: NarrationJob, signal?: AbortSignal) {
      if (job.facts[0] === 'Round two.') {
        yield 'Round two.';
        return;
      }
      yield 'The ogre swings. ';
      yield 'The club lands';
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      aborted = true;
      throw new Error('aborted');
    };
    const q = new CombatNarrationQueue(narrator);
    q.push(session, job('Ogre hits Sabine.'));
    await new Promise((r) => setTimeout(r, 0));
    q.push(session, job('Sabine falls.'));
    await q.settle();
    expect(aborted).toBe(true);
    expect(logged).toEqual(['The ogre swings.', 'Sabine falls.']);
    // The queue works again afterwards (the next fight).
    q.push(session, job('Round two.'));
    await q.idle();
    expect(logged.at(-1)).toBe('Round two.');
  });
});

describe('settling with a narrator that ignores the abort', () => {
  it('gives up after the settle timeout and drops the late output', async () => {
    const logged: string[] = [];
    const session = { reserveId: () => logged.length + 1, emit: () => undefined, addLog: (_k: string, text: string) => logged.push(text) } as unknown as GameSession;
    const job = (f: string): NarrationJob => ({ kind: 'combat', facts: [f], ctx: { msgs: undefined } as unknown as NarrationJob['ctx'] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stubborn: Narrator = async function* (j: NarrationJob) {
      if (j.facts[0] === 'Stuck.') {
        yield 'Still thinking. ';
        await gate; // ignores the signal
        yield 'Too late.';
        return;
      }
      yield j.facts.join(' ');
    };
    const q = new CombatNarrationQueue(stubborn, 50);
    q.push(session, job('Stuck.'));
    await new Promise((r) => setTimeout(r, 0));
    const started = Date.now();
    await q.settle();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(logged).toEqual([]);
    // The next fight's narration works, and the stuck job's late text never lands.
    q.push(session, job('Next fight.'));
    await q.idle();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(logged).toEqual(['Next fight.']);
  });
});
