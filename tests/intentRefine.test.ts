/**
 * A120: LLM intents mapped onto offered actions. The raw intents below are the replies llama3.2:3b
 * gave in the A115b real-model playtest (userdata/playtest-llm-a115b.json → probes), replayed
 * against the real starter-arc scenes.
 */
import { describe, expect, it } from 'vitest';
import companionsJson from '../data/companions.json';
import flagsJson from '../data/adventures/flags.json';
import starter from '../data/adventures/starter/millbrook_disappearances.json';
import { intentMessages } from '../src/llm/prompts/intent';
import { intentContext, refineIntent, validateIntent, type Intent } from '../src/engine/adventure/intent';
import { resolveIntent } from '../src/engine/adventure/resolve';
import { getProgress, startAdventure, type RunContext } from '../src/engine/adventure/runner';
import type { Condition } from '../src/engine/adventure/schema';
import { validateAdventure } from '../src/engine/adventure/validate';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { CompanionRosterSchema } from '../src/engine/party/companions';
import { newGameState } from '../src/engine/session/GameSession';
import { FlagRegistry } from '../src/engine/world/flags';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const registry = () => FlagRegistry.fromJson(flagsJson);
const ADV = validateAdventure(structuredClone(starter), db, registry(), roster).adventure!;

/** Sets flags so a simple all/not/flag condition holds. */
function satisfy(cond: Condition | undefined, flags: Record<string, unknown>): void {
  if (!cond || typeof cond !== 'object') return;
  const c = cond as { flag?: string; all?: Condition[]; not?: unknown };
  if (c.flag && Object.keys(c).length === 1) flags[c.flag] = true;
  for (const sub of c.all ?? []) satisfy(sub, flags);
}

/** A context standing in `sceneId` with `actionId` (and whatever shares its flags) offered. */
function at(sceneId: string, actionId?: string): RunContext {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('refine'))), db);
  const c: RunContext = { state: newGameState(hero, 'heroic', 'refine'), adventure: ADV, rng: Rng.fromSeed(5), db, flags: registry(), companions: roster };
  startAdventure(c);
  getProgress(c.state)!.sceneId = sceneId;
  const scene = ADV.chapters.flatMap((ch) => ch.scenes).find((s) => s.id === sceneId)!;
  if (actionId) satisfy(scene.actions.find((a) => a.id === actionId)?.if as Condition | undefined, c.state.flags as Record<string, unknown>);
  return c;
}

/** At Widow Marrow's with Corwin met (so his recruit action is offered). */
function corwinMet(): RunContext {
  const c = at('marrows_goods_and_oath');
  c.state.flags['world.corwin_status'] = 'met';
  return c;
}

function refined(c: RunContext, llm: Intent, text: string) {
  const ictx = intentContext(c);
  return validateIntent(refineIntent(llm, text, ictx), ictx);
}

describe('refineIntent with recorded llama3.2:3b replies', () => {
  it('"look down the well" (look, target well) → the well\'s Examine action', () => {
    const v = refined(at('millbrook_arrival'), { action: 'look', target: 'well' }, 'I walk over to the old well and look down it carefully');
    expect(v.actionId).toBe('well.examine');
  });

  it('"search the ground for footprints" (survival check) → the Survival tracking action', () => {
    const v = refined(at('gallows_hill_trail'), { action: 'skill_check', skill: 'survival' }, 'I kneel and search the muddy ground for footprints');
    expect(v.actionId).toBe('track');
  });

  it('"break the chains" (the model said Deception) → the Strength check to work the chains loose', () => {
    const v = refined(at('barrow_sheaf_crypt', 'slip_chains'), { action: 'skill_check', skill: 'deception' }, 'I try to break the chains that hold the prisoners');
    expect(v.actionId).toBe('slip_chains');
  });

  it('"break the chains" at the altar → the Athletics chain-breaking action', () => {
    const v = refined(at('barrow_tithe_altar', 'free_fast'), { action: 'skill_check', skill: 'deception' }, 'I try to break the chains that hold the prisoners');
    expect(v.actionId).toBe('free_fast');
  });

  it('"relight the flame in the shrine" (the model said rest) → rekindle', () => {
    const v = refined(at('barrow_shrine_rest'), { action: 'rest', target: 'home' }, 'I relight the flame in the little shrine');
    expect(v.actionId).toBe('rekindle');
  });

  it('keeps a valid choice the model already made', () => {
    const c = at('plough_tavern_talk');
    const v = refined(c, { action: 'choose_action', actionId: 'persuade_reeve' }, 'I try to convince the reeve that he must help me find the missing people');
    expect(v.actionId).toBe('persuade_reeve');
  });

  it('leaves open-ended talk and songs alone', () => {
    expect(refined(at('plough_tavern_talk'), { action: 'talk', target: 'barkeep' }, 'I ask the barkeep what rumours she has heard lately').intent.action).toBe('talk');
    expect(refined(at('millbrook_arrival'), { action: 'talk', target: 'village' }, 'I sing a loud song to cheer up the villagers').actionId).toBeUndefined();
  });

  it('a confident keyword match beats a generic look', () => {
    const v = refined(at('millbrook_arrival'), { action: 'look' }, 'I study the wet footprints in the mud');
    expect(v.actionId).toBe('well.footprints');
  });

  it('"ask Sir Corwin to come with me" (the model said talk corwin_npc) → recruit (A123)', () => {
    const c = corwinMet();
    expect(intentContext(c).actions.find((a) => a.id === 'recruit')).toMatchObject({ recruits: 'corwin' });
    const v = refined(c, { action: 'talk', target: 'corwin_npc' }, 'I ask Sir Corwin to come with me on the road south');
    expect(v.actionId).toBe('recruit');
    expect(refined(c, { action: 'talk' }, 'Will you join me?').actionId).toBe('recruit');
  });

  it('plain talk with a recruitable NPC stays talk', () => {
    const v = refined(corwinMet(), { action: 'talk', target: 'corwin_npc' }, 'I ask Sir Corwin how he slept');
    expect(v.intent.action).toBe('talk');
    expect(v.actionId).toBeUndefined();
  });

  it('never turns an attack into another action', () => {
    expect(refined(at('millbrook_arrival'), { action: 'attack', target: 'well' }, 'I attack the well with my sword').intent.action).toBe('attack');
  });

  it('the refined intent resolves to the authored action (its check is rolled)', () => {
    const c = at('gallows_hill_trail');
    const v = refined(c, { action: 'skill_check', skill: 'survival' }, 'I search for footprints');
    const r = resolveIntent(c, v, 'I search for footprints');
    expect(r).toMatchObject({ via: 'action', actionId: 'track' });
    expect(r.result.rolls).toHaveLength(1);
  });
});

describe('intent prompt', () => {
  it("names each action's check when the label doesn't", () => {
    const ictx = intentContext(at('millbrook_arrival'));
    const text = intentMessages('x', ictx)[1]!.content;
    expect(text).toContain('well.footprints: Study the wet footprints (Investigation DC 12)\n');
    expect(ictx.actions.find((a) => a.id === 'well.footprints')).toMatchObject({ poi: 'well', skill: 'investigation' });
    const crypt = intentContext(at('barrow_sheaf_crypt', 'slip_chains'));
    expect(crypt.actions.find((a) => a.id === 'slip_chains')).toMatchObject({ ability: 'str' });
    expect(intentMessages('x', { ...crypt, actions: [{ id: 'a', label: 'Lift the gate', keywords: [], skill: 'athletics' }] })[1]!.content).toContain('a: Lift the gate [skill: athletics]');
  });
});
