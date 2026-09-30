/**
 * Collects the NarrationContext from the game: GameState + the running adventure + world lore.
 * Read-only: it never changes state. Retrieval is by relevance to the current scene (NPCs present,
 * the scene's lore location, factions tied to either).
 */
import { scarSummary } from '../../engine/character/scars';
import { timeOfDay } from '../../engine/adventure/conditions';
import { describeScene, findScene, getProgress, npcsHere } from '../../engine/adventure/runner';
import { questContextLines } from '../../engine/adventure/quests';
import type { Adventure } from '../../engine/adventure/schema';
import type { Character } from '../../engine/core/creature';
import type { SrdDatabase } from '../../engine/data/srd';
import type { GameState, LogEntry } from '../../engine/session/gameState';
import type { Lore } from '../../engine/world/lore';
import { srdName } from '../../engine/i18n/srdNames';
import type { Language } from '../../shared/i18nCore';
import { weatherEffects, type WeatherState } from '../../engine/world/weather';
import { factionCard, locationCard, npcCard, toneText, type PromptCard } from './cards';
import type { NarrationContext } from './narration';

export const RECENT_EXCHANGES = 6;
const MAX_ENTRY_CHARS = 320;
const MAX_FLAGS = 8;

/** One party line; species/class names in `lang` (the reply language) so the model doesn't mix in English. */
export function describeMember(c: Character, db?: SrdDatabase, lang: Language = 'en'): string {
  const species = srdName(lang, 'species', c.speciesId, db?.species.get(c.speciesId)?.name ?? c.speciesId);
  const classes = c.classes.map((cl) => `${srdName(lang, 'classes', cl.classId, db?.classes.get(cl.classId)?.name ?? cl.classId)} ${cl.level}`).join('/');
  const conds = [...c.conditions.map((x) => x.condition), ...(c.exhaustion ? [`exhaustion ${c.exhaustion}`] : [])];
  const hp = c.hp === 0 ? 'down (0 HP)' : c.hp < c.maxHp / 2 ? `wounded (${c.hp}/${c.maxHp} HP)` : `${c.hp}/${c.maxHp} HP`;
  const scars = scarSummary(c);
  return `${c.name}, ${species} ${classes}, ${hp}${conds.length ? `, ${conds.join(', ')}` : ''}${scars ? `; ${scars}` : ''}`;
}

export function recentLines(log: readonly LogEntry[], n = RECENT_EXCHANGES): string[] {
  const who = (e: LogEntry) => (e.kind === 'player' ? 'Player' : e.kind === 'dialogue' ? (e.speaker ?? 'NPC') : 'Narrator');
  return log
    .filter((e) => e.kind === 'player' || e.kind === 'narration' || e.kind === 'dialogue')
    .slice(-n)
    .map((e) => `${who(e)}: ${e.text.length > MAX_ENTRY_CHARS ? `${e.text.slice(0, MAX_ENTRY_CHARS)}…` : e.text}`);
}

export function gatherNarrationContext(state: GameState, lore: Lore, adventure?: Adventure, db?: SrdDatabase, lang: Language = 'en'): NarrationContext {
  const progress = getProgress(state);
  const scene = adventure && progress ? findScene(adventure, progress.sceneId) : undefined;
  const location = lore.locations.find((l) => l.id === (scene?.locationId ?? '')) ?? lore.locations.find((l) => l.name === state.location.name);
  const regionId = location?.regionId ?? adventure?.regionId;
  const region = lore.regions.find((r) => r.id === regionId);
  const reputation = (state.extensions.reputation as Record<string, number> | undefined) ?? {};
  const w = state.extensions.weather as WeatherState | undefined;
  const weather = w ? weatherEffects(w).description.toLowerCase() : undefined;

  const cards: PromptCard[] = [];
  const factionIds = new Set<string>(location?.factionIds ?? []);
  if (scene && adventure) {
    for (const id of npcsHere({ state, adventure })) {
      const npc = adventure.npcs.find((n) => n.id === id);
      if (!npc) continue;
      cards.push(npcCard(npc, true));
      npc.factions.forEach((f) => factionIds.add(f));
    }
  }
  if (location) cards.push(locationCard(location, region));
  for (const id of factionIds) {
    const f = lore.factions.find((x) => x.id === id);
    if (f) cards.push(factionCard(f, reputation[id]));
  }

  const flags = (adventure?.flags ?? [])
    .filter((f) => state.flags[f.id] !== undefined && state.flags[f.id] !== false)
    .slice(0, MAX_FLAGS)
    .map((f) => (typeof state.flags[f.id] === 'boolean' ? f.description : `${f.description} (${String(state.flags[f.id])})`));

  if (adventure) flags.push(...questContextLines({ state, adventure }));

  let sceneText = state.location.name;
  if (scene && adventure) {
    const d = describeScene({ state, adventure });
    sceneText = [`${d.name}. ${d.seed}`, ...d.pois.map((p) => `${p.name}: ${p.seed}`), ...(d.npcs.length ? [`Present: ${d.npcs.join(', ')}.`] : [])].join('\n');
  }

  return {
    ...(region && { tone: toneText(region) }),
    party: [
      describeMember(state.hero, db, lang),
      ...state.companions.map((c) => {
        const loyalty = state.flags[`world.${c.id}_loyalty`];
        return `${describeMember(c, db, lang)} (companion${typeof loyalty === 'number' ? `, loyalty ${loyalty}/100${loyalty <= 20 ? ', resentful' : loyalty >= 70 ? ', devoted' : ''}` : ''})`;
      }),
    ],
    where: [scene?.name ?? state.location.name, location && location.name !== scene?.name ? location.name : undefined, region?.name].filter(Boolean).join(', '),
    when: [timeOfDay(state.time), weather].filter(Boolean).join(', '),
    threats: [],
    flags,
    summary: state.summary,
    recent: recentLines(state.log),
    cards,
    scene: sceneText,
  };
}
