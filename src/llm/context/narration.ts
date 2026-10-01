/**
 * Narration prompt builder (spec §3 "Context management for a small model"). Produces a short
 * chat prompt: system (DM persona + region tone + output rules), then one user message with a
 * compact state summary, the rolling story summary, the last few exchanges, relevant cards, the
 * scene notes and a FIXED FACTS block the model must narrate without adding mechanics.
 * Everything is trimmed to a token budget in a fixed priority order.
 */
import type { Language } from '../../shared/i18nCore';
import { LANGUAGE_NAMES, replyLanguageRule } from '../prompts/language';
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
  /** C007: the player heroes' names when there are several (main hero first, the "you"); absent in solo play. */
  heroes?: string[];
}

export type NarrationKind = 'scene' | 'outcome' | 'combat';

export interface NarrationRequest {
  kind: NarrationKind;
  /** What the player did, in their words or the action label. */
  playerAction?: string;
  /** Name of the extra player hero who took the action (C007); absent = the main hero. */
  actor?: string;
  /** Engine-resolved facts, in order. The narrator must convey all of them and invent nothing mechanical. */
  facts: string[];
  /** Scene narration: first arrival (default), a return to a visited place, or resuming a loaded game. */
  visit?: 'first' | 'return' | 'resume';
  /** Reply language (the session's); English when unset. */
  language?: Language;
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  tokens: number;
  /** What had to be cut to fit the budget (for logs/tests). */
  dropped: string[];
}

export const DM_PERSONA =
  'You are the Dungeon Master of a solo fantasy adventure, narrating for one player. ' +
  'Write in second person ("you"), present tense, 3 to 5 sentences of vivid, concrete prose (one short paragraph, two at most).';

export const NARRATION_RULES = [
  'Describe ONLY what the FIXED FACTS and scene notes establish. Never invent items, gold, damage numbers, dice results, new exits or rewards.',
  'Never decide whether an action succeeds: the facts already say so.',
  'Do not list options or ask "what do you do?" — the game shows choices separately.',
  'Never invent written words (inscriptions, signs, letters, runes), heraldry, emblems or symbols, mounts or animals, or named people, places and objects that the prompt does not mention.',
  'The hero carries and rides only what STATE and the facts say; do not give them horses, keys, relics or other gear.',
  'Keep NPC secrets hidden unless a fact reveals them. No headings, no bullet lists, no game jargon like "DC".',
];

/**
 * Default prompt budget. The 4096-token context would fit more, but on a CPU prompt evaluation
 * dominates: ~2200 tokens took 20–75 s to the first token in the A115b playtest.
 */
export const DEFAULT_PROMPT_BUDGET = 1400;

export function buildNarrationPrompt(ctx: NarrationContext, req: NarrationRequest, budget = DEFAULT_PROMPT_BUDGET): BuiltPrompt {
  const langRule = replyLanguageRule(req.language);
  const rules = [...NARRATION_RULES, ...(langRule ? [langRule] : [])];
  const system = [persona(ctx.heroes, req.actor), ...(ctx.tone ? [ctx.tone] : []), 'Rules:', ...rules.map((r) => `- ${r}`)].join('\n');
  const dropped: string[] = [];
  // C007: the acting extra hero leads the facts (authored facts say "you"; small models follow facts best).
  const facts = req.actor && req.kind !== 'combat' ? [`${req.actor} (not "you") takes this action.`, ...req.facts] : req.facts;

  // Mandatory parts: state, scene, facts, task. Optional (trimmed in this order): recent exchanges
  // (oldest first), low-priority cards, flags, summary.
  let recent = [...ctx.recent];
  let cards = [...ctx.cards].sort((a, b) => b.priority - a.priority);
  let flags = [...ctx.flags];
  let summary = ctx.summary;

  const render = () =>
    [
      section('STATE', [...ctx.party, `Location: ${ctx.where}`, `Time: ${ctx.when}`, ...(ctx.threats.length ? [`Threats: ${ctx.threats.join('; ')}`] : [])]),
      partyCard(ctx.heroes),
      flags.length ? section('WORLD', flags) : '',
      summary ? section('STORY SO FAR', [summary]) : '',
      recent.length ? section('RECENT', recent) : '',
      cards.length ? section('NOTES', cards.map((c) => c.text)) : '',
      section('SCENE', [ctx.scene]),
      facts.length ? section('FIXED FACTS (narrate all of these, in order)', facts.map((f, i) => `${i + 1}. ${f}`)) : '',
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

/** The DM persona; with several player heroes "you" is reserved for the main hero (C007). */
function persona(heroes: readonly string[] | undefined, actor: string | undefined): string {
  if (!heroes || heroes.length < 2) return DM_PERSONA;
  const [main, ...others] = heroes;
  return (
    `You are the Dungeon Master of a fantasy adventure, narrating for a party of player heroes: ${heroes.join(', ')}. ` +
    `Write in present tense, 3 to 5 sentences of vivid, concrete prose (one short paragraph, two at most). ` +
    `Address ${main} as "you"; always call ${others.join(' and ')} by name in the third person.` +
    (actor ? ` This time ${actor} acts: tell it about ${actor} by name.` : '')
  );
}

function section(title: string, lines: string[]): string {
  return `${title}:\n${lines.join('\n')}`;
}

/**
 * C007: with several player heroes the model must know who "you" is. Mandatory (never trimmed):
 * without it a small model calls every hero "you".
 */
export function partyCard(heroes: readonly string[] | undefined): string {
  if (!heroes || heroes.length < 2) return '';
  const [main, ...others] = heroes;
  const names = others.join(' and ');
  return section('PARTY', [
    `Player heroes: ${heroes.join(', ')}.`,
    `"You" always means ${main}. Call ${names} by name, never "you". Each hero does only what the facts and the player's action say.`,
  ]);
}

/** The task line, plus a closing reminder of the reply language (small models forget the system rule). */
function task(req: NarrationRequest): string {
  const led = req.kind === 'scene' && req.actor ? ` ${req.actor} (not "you") made the move that led here${req.playerAction ? `: "${req.playerAction}"` : ''}.` : '';
  const text = taskText(req) + led;
  return req.language && req.language !== 'en' ? `${text} Write it in ${LANGUAGE_NAMES[req.language]}.` : text;
}

function taskText(req: NarrationRequest): string {
  if (req.kind === 'scene') {
    if (req.visit === 'return')
      return 'The hero RETURNS to a place they have already been (see STORY SO FAR). In 3 to 5 sentences, show what is familiar or has changed and weave in the fixed facts. Do not describe it as a first arrival.';
    if (req.visit === 'resume') return 'The story resumes where the hero already is. In 3 to 5 sentences, remind the player of the surroundings. Do not describe an arrival.';
    return 'In 3 to 5 sentences, describe the hero arriving in this scene for the first time, weaving in the fixed facts.';
  }
  if (req.kind === 'combat')
    return 'In one or two short, vivid sentences, narrate these moments of the fight. No numbers or game terms; do not add new hits, deaths or effects. Only the fighters named in these moments act or get hurt; bystanders and prisoners in the scene take no part.';
  if (req.actor)
    return `${req.actor} (a player hero, not "you"): "${req.playerAction ?? 'acts'}". In 3 to 5 sentences, narrate ${req.actor} doing it, following the fixed facts exactly; where a fact says "you" about this action, it means ${req.actor}.`;
  return `The player: "${req.playerAction ?? 'acts'}". In 3 to 5 sentences, narrate what happens, following the fixed facts exactly.`;
}
