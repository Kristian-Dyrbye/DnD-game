/**
 * Retrieval cards: small, self-contained text snippets about NPCs, locations, factions and the
 * current region's tone. Only cards relevant to the current scene go into a prompt, and each
 * card is short so a small model's context stays focused.
 */
import type { Npc } from '../../engine/adventure/schema';
import type { Faction, Location, Region } from '../../engine/world/lore';

export type CardKind = 'npc' | 'location' | 'faction';

export interface PromptCard {
  kind: CardKind;
  id: string;
  text: string;
  /** Higher = kept first when the token budget is tight. */
  priority: number;
}

/** Rough token estimate for small models (~4 characters per token, rounded up). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function npcCard(npc: Npc, present: boolean): PromptCard {
  const lines = [
    `NPC ${npc.name} (${npc.attitude}${npc.factions.length ? `; ${npc.factions.join(', ')}` : ''}).`,
    `Personality: ${npc.personality}`,
    `Voice: ${npc.voice}`,
    // Secrets steer behaviour; the narrator must not blurt them out.
    ...(npc.secrets.length ? [`Secrets (hint at, never reveal unless the facts say so): ${npc.secrets.join(' ')}`] : []),
  ];
  return { kind: 'npc', id: npc.id, text: lines.join('\n'), priority: present ? 90 : 40 };
}

export function locationCard(loc: Location, region?: Region): PromptCard {
  return {
    kind: 'location',
    id: loc.id,
    text: `Location ${loc.name}${region ? ` (${region.name})` : ''}: ${loc.summary}`,
    priority: 70,
  };
}

export function factionCard(f: Faction, reputation?: number): PromptCard {
  const rep = reputation === undefined ? '' : ` Standing with the hero: ${reputation}.`;
  return { kind: 'faction', id: f.id, text: `Faction ${f.name}: ${f.summary}${rep}`, priority: 50 };
}

/** Tone lines injected into the system prompt so prose shifts by region. */
export function toneText(region: Region): string {
  const t = region.toneProfile;
  return [
    `Region: ${region.name} (${region.tone.replace(/_/g, ' ')}). ${t.style}`,
    `Favour words like: ${t.vocabulary.join(', ')}.`,
    `Themes: ${t.themes.join('; ')}.`,
    `Avoid: ${t.avoid.join('; ')}.`,
  ].join('\n');
}
