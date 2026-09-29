/**
 * Player intents (spec §3 "intent parsing"). Free text becomes a structured Intent — from the LLM
 * (llm/prompts/intent.ts) or, as a fallback, from the deterministic keyword parser here. The
 * engine then validates it against what is actually possible in the scene; the LLM never decides
 * what exists or whether something works.
 */
import { z } from 'zod';
import { SKILLS, type Skill } from '../rules/basics';
import { availableActions, currentScene, type RunContext } from './runner';

export const INTENT_ACTIONS = ['choose_action', 'skill_check', 'talk', 'move', 'look', 'attack', 'use_item', 'cast_spell', 'rest', 'other'] as const;

export const IntentSchema = z.object({
  action: z.enum(INTENT_ACTIONS),
  /** Id of an offered action/exit when the text clearly matches one. */
  actionId: z.string().optional(),
  skill: z.enum(SKILLS as [Skill, ...Skill[]]).optional(),
  /** NPC, point of interest or exit the player means (id or name). */
  target: z.string().optional(),
  /** How they do it, in a few words ("bribe with a silver ring"). */
  approach: z.string().max(160).optional(),
  /** Item or spell named by the player. */
  item: z.string().optional(),
  spell: z.string().optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

export interface IntentOption {
  id: string;
  label: string;
  keywords: string[];
}

/** What the player can refer to right now. Sent (compactly) to the intent prompt. */
export interface IntentContext {
  actions: IntentOption[];
  npcs: { id: string; name: string }[];
  pois: { id: string; name: string }[];
}

export function intentContext(ctx: RunContext): IntentContext {
  const scene = currentScene(ctx);
  const keywordsOf = (id: string): string[] => {
    const [poi, sub] = id.split('.', 2);
    const def = sub && poi !== 'exit' ? scene.pois.find((p) => p.id === poi)?.actions.find((a) => a.id === sub) : scene.actions.find((a) => a.id === id);
    return def?.keywords ?? [];
  };
  return {
    actions: availableActions(ctx).map((a) => ({ id: a.id, label: a.label, keywords: keywordsOf(a.id) })),
    npcs: scene.npcs.map((id) => ({ id, name: ctx.adventure.npcs.find((n) => n.id === id)?.name ?? id })),
    pois: scene.pois.map((p) => ({ id: p.id, name: p.name })),
  };
}

// ---------------------------------------------------------------- keyword fallback parser

const STOP = new Set(['the', 'a', 'an', 'to', 'at', 'of', 'and', 'with', 'my', 'i', 'on', 'in', 'into', 'for', 'up', 'try', 'about', 'some', 'this', 'that', 'it']);

/** Verbs → skill for checks the player describes without a matching action. */
const SKILL_WORDS: [RegExp, Skill][] = [
  [/\b(persuade|convince|charm|plead|negotiate|haggle|bargain)\w*/, 'persuasion'],
  [/\b(lie|lying|bluff|deceive|trick|pretend|disguise|feint)\w*/, 'deception'],
  [/\b(threaten|intimidate|menace|scare|glare)\w*/, 'intimidation'],
  [/\b(sneak|hide|creep|tiptoe|stealth)\w*/, 'stealth'],
  [/\b(climb|jump|leap|swim|force|shove|push|break|lift|bash)\w*/, 'athletics'],
  [/\b(balance|tumble|dodge|flip|squeeze)\w*/, 'acrobatics'],
  [/\b(pick ?pocket|steal|pilfer|palm|lockpick|pick the lock)\w*/, 'sleight_of_hand'],
  [/\b(search|investigate|examine|inspect|study|analy[sz]e)\w*/, 'investigation'],
  [/\b(listen|spot|watch|scan|notice|keep watch)\w*/, 'perception'],
  [/\b(track|forage|hunt|navigate)\w*/, 'survival'],
  [/\b(heal|bandage|treat|diagnose|first aid)\w*/, 'medicine'],
  [/\b(read (his|her|their) (face|intent)|sense motive|gauge|is (he|she|they) lying)\w*/, 'insight'],
  [/\b(calm|soothe|tame) (the )?(horse|dog|beast|animal)\w*/, 'animal_handling'],
  [/\b(perform|sing|dance|play (a|the) (song|lute|tune))\w*/, 'performance'],
  [/\b(recall|remember|legend|history)\w*/, 'history'],
  [/\b(arcane|magic|rune|sigil|glyph)\w*/, 'arcana'],
  [/\b(pray|holy|divine|god|temple|ritual)\w*/, 'religion'],
];

const VERB_ACTIONS: [RegExp, Intent['action']][] = [
  [/\b(attack|hit|stab|strike|slash|shoot|fight|kill|punch)\b/, 'attack'],
  [/\b(talk|speak|ask|say|tell|greet|chat|question)\b/, 'talk'],
  [/\b(go|walk|head|leave|enter|return|travel|move|run)\b/, 'move'],
  [/\b(look|glance|observe|survey)\b/, 'look'],
  [/\b(rest|sleep|camp|nap)\b/, 'rest'],
  [/\b(cast)\b/, 'cast_spell'],
  [/\b(drink|use|eat|light|apply|read the scroll)\b/, 'use_item'],
];

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !STOP.has(w));
}

/**
 * Score of the best-matching offered action (keywords count double). Words that only name a
 * person or thing present are ignored: they say *who*, not *what* ("persuade Hobb" ≠ "talk to Hobb").
 */
function bestAction(text: string, options: IntentOption[], names: ReadonlySet<string>): { id: string; score: number } | undefined {
  const ws = new Set(words(text).filter((w) => !names.has(w)));
  let best: { id: string; score: number } | undefined;
  for (const o of options) {
    const kw = o.keywords.filter((k) => ws.has(k.toLowerCase())).length * 2;
    const label = words(o.label).filter((w) => w.length > 3 && ws.has(w)).length;
    const score = kw + label;
    if (score > 0 && (!best || score > best.score)) best = { id: o.id, score };
  }
  return best;
}

function findTarget(text: string, ictx: IntentContext): string | undefined {
  const t = text.toLowerCase();
  for (const n of ictx.npcs) if (n.name.toLowerCase().split(/\s+/).some((part) => part.length > 2 && t.includes(part))) return n.id;
  for (const p of ictx.pois) if (p.name.toLowerCase().split(/\s+/).some((part) => part.length > 3 && t.includes(part))) return p.id;
  return undefined;
}

/** Deterministic fallback when the LLM is unavailable or its reply is unusable. */
export function keywordIntent(text: string, ictx: IntentContext): Intent {
  const lower = text.toLowerCase();
  const names = new Set([...ictx.npcs, ...ictx.pois].flatMap((x) => words(x.name)));
  const match = bestAction(text, ictx.actions, names);
  const target = findTarget(text, ictx);
  const skillHit = SKILL_WORDS.map(([re, sk]) => [re.exec(lower)?.[0], sk] as const).find(([m]) => m);
  const skill = skillHit?.[1];
  // A strong match on an offered action wins ("talk to the mayor" → talk_mayor) — unless the text
  // uses a skill verb the action doesn't ("persuade Hobb about the reward" is a Persuasion attempt).
  if (match && match.score >= 2) {
    const opt = ictx.actions.find((a) => a.id === match.id)!;
    const vocab = `${opt.label} ${opt.keywords.join(' ')}`.toLowerCase();
    if (!skillHit || vocab.includes(skillHit[0]!.trim())) return { action: 'choose_action', actionId: match.id, ...(target && { target }) };
  }
  const verb = VERB_ACTIONS.find(([re]) => re.test(lower))?.[1];
  if (verb === 'attack') return { action: 'attack', ...(target && { target }) };
  if (skill) return { action: 'skill_check', skill, ...(target && { target }), approach: text.slice(0, 160) };
  if (match) return { action: 'choose_action', actionId: match.id, ...(target && { target }) };
  if (verb) return { action: verb, ...(target && { target }), approach: text.slice(0, 160) };
  return { action: 'other', approach: text.slice(0, 160) };
}

// ---------------------------------------------------------------- engine validation

export interface ValidatedIntent {
  intent: Intent;
  /** Set when a choose_action intent points at a real, currently available action. */
  actionId?: string;
  /** Resolved NPC/POI id, if the target exists here. */
  targetId?: string;
  /** Why the intent was changed (for logs). */
  notes: string[];
}

/** Keeps only what is real: unknown action ids, targets or skills are dropped, never trusted. */
export function validateIntent(raw: Intent, ictx: IntentContext): ValidatedIntent {
  const notes: string[] = [];
  const intent: Intent = { ...raw };
  let actionId: string | undefined;
  if (intent.actionId) {
    if (ictx.actions.some((a) => a.id === intent.actionId)) actionId = intent.actionId;
    else {
      notes.push(`unknown action "${intent.actionId}"`);
      delete intent.actionId;
    }
  }
  if (intent.action === 'choose_action' && !actionId) {
    intent.action = 'other';
    notes.push('choose_action without a valid action');
  }
  let targetId: string | undefined;
  if (intent.target) {
    const t = intent.target.toLowerCase();
    targetId = [...ictx.npcs, ...ictx.pois].find((x) => x.id === intent.target || x.name.toLowerCase() === t || x.name.toLowerCase().includes(t) || t.includes(x.name.toLowerCase()))?.id;
    if (!targetId) notes.push(`target "${intent.target}" is not here`);
  }
  if (intent.action === 'skill_check' && !intent.skill) {
    intent.action = 'other';
    notes.push('skill_check without a skill');
  }
  return { intent, ...(actionId && { actionId }), ...(targetId && { targetId }), notes };
}
