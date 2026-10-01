/**
 * B013 — narration context for "The Hollow Crown": every arc 2 scene sits at a lore location, so
 * the narrator gets a location card (and the region's tone), every NPC present gets an NPC card
 * with personality and voice, and every NPC of the chapter can be present somewhere (scene list or
 * schedule) — so the model never has to invent who or where it is.
 */
import { describe, expect, it } from 'vitest';
import loreJson from '../data/world/lore.json';
import companionsJson from '../data/companions.json';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { getProgress, npcsHere, startAdventure } from '../src/engine/adventure/runner';
import { allScenes } from '../src/engine/adventure/validate';
import { CompanionRosterSchema } from '../src/engine/party/companions';
import { newGameState } from '../src/engine/session/GameSession';
import { LoreSchema } from '../src/engine/world/lore';
import { bundledFlagRegistry, loadBundledAdventures } from '../src/host/bundled';
import { gatherNarrationContext } from '../src/llm/context/gather';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const { adventures } = loadBundledAdventures(db, bundledFlagRegistry(), roster);
const ARC2 = ['arc2_ch0_hollow_coin', 'arc2_ch1_faces', 'arc2_ch2_gamblers_tide', 'arc2_ch3_blightwood_mint'];
const hero = buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('b013'))), db);

describe.each(ARC2)('narration context: %s', (id) => {
  const adventure = adventures.get(id)!;

  it('is installed', () => expect(adventure).toBeDefined());

  it.each(allScenes(adventure).map((s) => s.id))('scene %s has its location, tone and present NPC cards', (sceneId) => {
    const state = newGameState(hero, 'heroic', 1);
    startAdventure({ state, adventure, rng: Rng.fromSeed(1), db });
    getProgress(state)!.sceneId = sceneId;
    const scene = allScenes(adventure).find((s) => s.id === sceneId)!;
    const c = gatherNarrationContext(state, lore, adventure, db);
    const location = lore.locations.find((l) => l.id === scene.locationId);
    expect(location, `${sceneId} → ${scene.locationId}`).toBeDefined();
    expect(c.cards.find((x) => x.kind === 'location')?.id).toBe(location!.id);
    expect(c.tone).toBeTruthy();
    for (const npcId of npcsHere({ state, adventure })) {
      const card = c.cards.find((x) => x.kind === 'npc' && x.id === npcId);
      expect(card?.text, npcId).toMatch(/Personality: \S/);
      expect(card?.text, npcId).toMatch(/Voice: \S/);
    }
  });

  it('every NPC can appear in some scene', () => {
    const listed = new Set(allScenes(adventure).flatMap((s) => s.npcs ?? []));
    for (const npc of adventure.npcs) expect(listed.has(npc.id) || (npc.schedule ?? []).length > 0, npc.id).toBe(true);
  });
});
