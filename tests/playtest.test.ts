/**
 * A115 — exploratory playtest: every authored adventure is played through the real session (mock
 * LLM path: template narration) by a seeded random player — random offered story actions, real grid
 * fights played by a simple attack/approach policy — for a few hundred steps and several seeds.
 * Any error event, crash or dead end (no way forward, no fight, no ending) is a finding.
 */
import { combatStep } from './helpers/combatPolicy';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import companionsJson from '../data/companions.json';
import flagsJson from '../data/adventures/flags.json';
import loreJson from '../data/world/lore.json';
import defeatsJson from '../data/tables/defeat-outcomes.json';
import { loadAdventures } from '../src/server/adventures';
import { adventureActionPort } from '../src/engine/adventure/sessionActions';
import { DefeatTableSchema } from '../src/engine/adventure/defeat';
import { activeFight } from '../src/engine/adventure/fights';
import { getProgress } from '../src/engine/adventure/runner';
import type { Adventure } from '../src/engine/adventure/schema';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { attackProfiles, checkAttack } from '../src/engine/combat/attack';
import { distanceFt } from '../src/engine/combat/grid';
import { reachableSquares } from '../src/engine/combat/movement';
import { currentId, movementLeft } from '../src/engine/combat/turns';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { autoLevelTo, CompanionRosterSchema } from '../src/engine/party/companions';
import { GameSession } from '../src/engine/session/GameSession';
import type { ServerEvent } from '../src/shared/protocol';
import { createDefaultRegistry } from '../src/engine/systems';
import { FlagRegistry } from '../src/engine/world/flags';
import { LoreSchema } from '../src/engine/world/lore';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const lore = LoreSchema.parse(loreJson);
const adventures = loadAdventures(path.join(process.cwd(), 'data', 'adventures'), db, FlagRegistry.fromJson(flagsJson), roster).adventures as Map<string, Adventure>;


interface Finding {
  adventure: string;
  seed: string;
  step: number;
  scene: string;
  problem: string;
}

async function playtest(advId: string, seed: string, steps: number): Promise<{ findings: Finding[]; endings: string[]; fights: number; scenes: Set<string> }> {
  const adv = adventures.get(advId)!;
  const session = new GameSession({
    actions: adventureActionPort(adventures, advId, db, { lore, flags: FlagRegistry.fromJson(flagsJson), companions: roster, defeats: DefeatTableSchema.parse(defeatsJson) }),
    systems: createDefaultRegistry({ lore }),
    newSeed: () => seed,
    saves: { save: () => { throw new Error('no'); }, autosave: (m) => ({ ...m, slotId: 'auto-1', kind: 'auto', savedAt: 'now' }), load: () => { throw new Error('no'); } },
  });
  const events: ServerEvent[] = [];
  session.on((e) => events.push(e));
  const classId = ['fighter', 'cleric', 'rogue', 'wizard', 'paladin', 'ranger'][Math.abs([...seed].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 6]!;
  let hero = buildCharacter(toBuildInput(quickBuild(classId, db, Rng.fromSeed(seed))), db);
  if (adv.levelRange[0] > 1) hero = autoLevelTo(hero, adv.levelRange[0], db);
  await session.handle({ type: 'new_game', hero, mode: 'heroic' });
  const rng = Rng.fromSeed(`play:${seed}`);
  const findings: Finding[] = [];
  const endings: string[] = [];
  const scenes = new Set<string>();
  let fights = 0;
  let lastErrors = 0;
  for (let step = 0; step < steps; step++) {
    const p = getProgress(session.current);
    if (!p) {
      findings.push({ adventure: advId, seed, step, scene: '?', problem: 'no adventure progress' });
      break;
    }
    if (p.ending || p.adventureId !== advId) {
      endings.push(p.ending ?? `→ ${p.adventureId}`);
      break;
    }
    scenes.add(p.sceneId);
    try {
      if (activeFight(session.current)) {
        fights++;
        await session.handle(combatStep(session, db));
      } else {
        const sug = [...events].reverse().find((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
        const real = (sug?.actions ?? []).filter((a) => !a.say && !a.id.startsWith('sq:'));
        if (!real.length) {
          findings.push({ adventure: advId, seed, step, scene: p.sceneId, problem: 'dead end: no story action offered' });
          break;
        }
        // Prefer actions not tried yet in this scene, so the walk explores instead of looping.
        const choice = rng.pick(real).id;
        await session.handle({ type: 'choose', actionId: choice });
      }
    } catch (err) {
      findings.push({ adventure: advId, seed, step, scene: p.sceneId, problem: `crash: ${(err as Error).message}` });
      break;
    }
    const errors = events.filter((e) => e.type === 'error') as Extract<ServerEvent, { type: 'error' }>[];
    if (errors.length > lastErrors) {
      for (const e of errors.slice(lastErrors)) findings.push({ adventure: advId, seed, step, scene: p.sceneId, problem: `error event: ${e.message}` });
      lastErrors = errors.length;
    }
  }
  return { findings, endings, fights, scenes };
}

const ADVENTURES = ['millbrook_disappearances', 'ch1_whispering_fen', 'ch2_salt_and_treason', 'ch3_the_gilded_lie', 'ch4_wyrmfire', 'ch5_the_hungering_dark'].filter((id) => adventures.has(id));
const SEEDS = ['p1', 'p2', 'p3'];

describe('exploratory playtest (A115)', () => {
  for (const adv of ADVENTURES) {
    it(`${adv}: random walks through the session find no errors or dead ends`, async () => {
      const all: Finding[] = [];
      const summary: string[] = [];
      for (const seed of SEEDS) {
        const r = await playtest(adv, seed, 250);
        all.push(...r.findings);
        summary.push(`${seed}: ${r.scenes.size} scenes, ${r.fights} fight steps, ${r.endings.join(',') || 'no ending yet'}`);
      }
      expect(all, `${summary.join(' | ')}\n${all.map((f) => `[${f.seed}#${f.step} ${f.scene}] ${f.problem}`).join('\n')}`).toEqual([]);
    }, 300_000);
  }
});
