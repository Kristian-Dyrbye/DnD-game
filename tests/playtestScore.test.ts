/**
 * A122: the real-model playtest scores probes by the action the game ends up on (refined intent),
 * not the raw LLM reply. Replies below are what llama3.2:3b answered in the A119 GPU playtest.
 */
import { describe, expect, it } from 'vitest';
import companionsJson from '../data/companions.json';
import flagsJson from '../data/adventures/flags.json';
import starter from '../data/adventures/starter/millbrook_disappearances.json';
import { scoreProbe } from '../scripts/playtest-score';
import { intentContext } from '../src/engine/adventure/intent';
import { getProgress, startAdventure, type RunContext } from '../src/engine/adventure/runner';
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

function ictxAt(sceneId: string) {
  const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('score'))), db);
  const c: RunContext = { state: newGameState(hero, 'heroic', 'score'), adventure: ADV, rng: Rng.fromSeed(5), db, flags: registry(), companions: roster };
  startAdventure(c);
  getProgress(c.state)!.sceneId = sceneId;
  return intentContext(c);
}

describe('scoreProbe', () => {
  it('scores the refined action while keeping the raw verdict', () => {
    const s = scoreProbe('{"action":"look","target":"well"}', 'I walk over to the old well and look down it carefully', ictxAt('millbrook_arrival'), ['well.examine']);
    expect(s.raw).toEqual({ action: 'look', target: 'well' });
    expect(s.rawUnderstood).toBe(false);
    expect(s.actionId).toBe('well.examine');
    expect(s.understood).toBe(true);
    expect(s.refined).toMatchObject({ action: 'choose_action', actionId: 'well.examine' });
  });

  it('counts a raw reply that already names an expected action', () => {
    const s = scoreProbe('{"action":"choose_action","actionId":"well.examine"}', 'look into the well', ictxAt('millbrook_arrival'), ['well.examine']);
    expect(s.rawUnderstood).toBe(true);
    expect(s.understood).toBe(true);
  });

  it('falls back to the keyword parser when there is no usable reply, like the game', () => {
    const none = scoreProbe(undefined, 'I walk over to the old well and look down it carefully', ictxAt('millbrook_arrival'), ['well.examine']);
    expect(none.raw).toBeNull();
    expect(none.rawUnderstood).toBe(false);
    const junk = scoreProbe('not json', 'I walk over to the old well and look down it carefully', ictxAt('millbrook_arrival'), ['well.examine']);
    expect(junk.raw).toBe('not json');
    expect(junk.refined.action).toBeDefined();
  });

  it('gives null verdicts for probes that expect nothing', () => {
    const s = scoreProbe('{"action":"talk","target":"village"}', 'I sing a loud song to cheer up the villagers', ictxAt('millbrook_arrival'), []);
    expect(s.understood).toBeNull();
    expect(s.rawUnderstood).toBeNull();
  });
});
