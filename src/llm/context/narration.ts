/**
 * Narration prompt builder (spec §3 "Context management for a small model"). Produces a short
 * chat prompt: system (DM persona + region tone + output rules), then one user message with a
 * compact state summary, the rolling story summary, the last few exchanges, relevant cards, the
 * scene notes and a FIXED FACTS block the model must narrate without adding mechanics.
 * Everything is trimmed to a token budget in a fixed priority order.
 */
import type { ChatMessage } from '../types';
import { estimateTokens, type PromptCard } from './cards';

export interface NarrationContext {
  /** Region tone text (toneText), if known. */
  tone?: string;
  /** One-line facts about the party and world: "Mira, human fighter 1, 9/11 HP, poisoned". */
  party: string[];
  where: string;
  /** e.g. "dusk, light rain". */
  when: string;
  threats: string[];
  /** Relevant world flags as plain sentences ("The mayor owes the hero a favour."). */
  flags: string[];
  /** Rolling story summary. */
  summary: string;
  /** Recent exchanges, oldest first: "Player: ..." / "Narrator: ...". */
  recent: string[];
  cards: PromptCard[];
  /** Scene description seed + visible points of interest. */
  scene: string;
}

export type NarrationKind = 'scene' | 'outcome' | 'combat';

export interface NarrationRequest {
  kind: NarrationKind;
  /** What the player did, in their words or the action label. */
  playerAction?: string;
  /** Engine-resolved facts, in order. The narrator must convey all of them and invent nothing mechanical. */
  facts: string[];
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  tokens: number;
  /** What had to be cut to fit the budget (for logs/tests). */
  dropped: string[];
}

export const DM_PERSONA =
  'You are the Dungeon Master of a solo fantasy adventure, narrating for one player. ' +
  'Write in second person ("you"), present tense, 2 to 4 short paragraphs of vivid, concrete prose.';

export const NARRATION_RULES = [
  'Describe ONLY what the FIXED FACTS and scene notes establish. Never invent items, gold, damage numbers, dice results, new exits or rewards.',
  'Never decide whether an action succeeds: the facts already say so.',
  'Do not list options or ask "what do you do?" — the game shows choices separately.',
  'Keep NPC secrets hidden unless a fact reveals them. No headings, no bullet lists, no game jargon like "DC".',
];

/** Default prompt budget, sized for a 4096-token context with room for the reply. */
export const DEFAULT_PROMPT_BUDGET = 2200;

export function buildNarrationPrompt(ctx: NarrationContext, req: NarrationRequest, budget = DEFAULT_PROMPT_BUDGET): BuiltPrompt {
  const system = [DM_PERSONA, ...(ctx.tone ? [ctx.tone] : []), 'Rules:', ...NARRATION_RULES.map((r) => `- ${r}`)].join('\n');
  const dropped: string[] = [];

  // Mandatory parts: state, scene, facts, task. Optional (trimmed in this order): recent exchanges
  // (oldest first), low-priority cards, flags, summary.
  let recent = [...ctx.recent];
  let cards = [...ctx.cards].sort((a, b) => b.priority - a.priority);
  let flags = [...ctx.flags];
  let summary = ctx.summary;

  const render = () =>
    [
      section('STATE', [...ctx.party, `Location: ${ctx.where}`, `Time: ${ctx.when}`, ...(ctx.threats.length ? [`Threats: ${ctx.threats.join('; ')}`] : [])]),
      flags.length ? section('WORLD', flags) : '',
      summary ? section('STORY SO FAR', [summary]) : '',
      recent.length ? section('RECENT', recent) : '',
      cards.length ? section('NOTES', cards.map((c) => c.text)) : '',
      section('SCENE', [ctx.scene]),
      req.facts.length ? section('FIXED FACTS (narrate all of these, in order)', req.facts.map((f, i) => `${i + 1}. ${f}`)) : '',
      section('TASK', [task(req)]),
    ]
      .filter(Boolean)
      .join('\n\n');

  const total = () => estimateTokens(system) + estimateTokens(render());
  while (total() > budget) {
    if (recent.length > 2) {
      recent = recent.slice(1);
      dropped.push('recent');
    } else if (cards.length > 0 && cards.at(-1)!.priority < 90) {
      dropped.push(`card:${cards.at(-1)!.id}`);
      cards = cards.slice(0, -1);
    } else if (flags.length > 0) {
      flags = flags.slice(0, -1);
      dropped.push('flag');
    } else if (summary.length > 200) {
      summary = `…${summary.slice(-Math.floor(summary.length / 2))}`;
      dropped.push('summary');
    } else if (recent.length > 0) {
      recent = recent.slice(1);
      dropped.push('recent');
    } else if (cards.length > 0) {
      dropped.push(`card:${cards.at(-1)!.id}`);
      cards = cards.slice(0, -1);
    } else break; // Only mandatory parts left.
  }

  const user = render();
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tokens: estimateTokens(system) + estimateTokens(user),
    dropped,
  };
}

function section(title: string, lines: string[]): string {
  return `${title}:\n${lines.join('\n')}`;
}

function task(req: NarrationRequest): string {
  if (req.kind === 'scene') return 'Describe the hero arriving in this scene, weaving in the fixed facts.';
  if (req.kind === 'combat') return 'In one or two short, vivid sentences, narrate these moments of the fight. No numbers or game terms; do not add new hits, deaths or effects.';
  return `The player: "${req.playerAction ?? 'acts'}". Narrate what happens, following the fixed facts exactly.`;
}
