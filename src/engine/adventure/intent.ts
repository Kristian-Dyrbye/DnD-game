/**
 * Player intents (spec §3 "intent parsing"). Free text becomes a structured Intent — from the LLM
 * (llm/prompts/intent.ts) or, as a fallback, from the deterministic keyword parser here. The
 * engine then validates it against what is actually possible in the scene; the LLM never decides
 * what exists or whether something works.
 */
import { z } from 'zod';
import { SKILL_ABILITY, SKILLS, type Ability, type Skill } from '../rules/basics';
import { availableActions, currentScene, getProgress, npcsHere, type RunContext } from './runner';
import { conversationFor, DIALOGUE_PREFIX, optionFor, TALK_PREFIX } from './conversation';

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
  /** The point of interest the action belongs to (`<poi>.<action>` ids). */
  poi?: string;
  /** The authored check's skill / plain ability, if the action rolls one. */
  skill?: Skill;
  ability?: Ability;
  /** Companion id this action recruits (its outcome, or its check's success outcome). */
  recruits?: string;
}

/** What the player can refer to right now. Sent (compactly) to the intent prompt. */
export interface IntentContext {
  actions: IntentOption[];
  npcs: { id: string; name: string }[];
  pois: { id: string; name: string }[];
}

export function intentContext(ctx: RunContext): IntentContext {
  const scene = currentScene(ctx);
  const talk = getProgress(ctx.state)?.talk;
  const option = (id: string, label: string): IntentOption => {
    if (id.startsWith(TALK_PREFIX)) return { id, label, keywords: conversationFor(ctx.adventure, id)?.conv.keywords ?? [] };
    if (id.startsWith(DIALOGUE_PREFIX)) {
      const o = talk && optionFor(ctx.adventure, talk, id);
      return { id, label, keywords: o?.keywords ?? [], ...checkFields(o?.check) };
    }
    const [poi, sub] = id.split('.', 2);
    if (poi === 'exit') {
      const check = scene.exits.find((e) => e.id === sub)?.check;
      return { id, label, keywords: [], ...checkFields(check) };
    }
    const def = sub ? scene.pois.find((p) => p.id === poi)?.actions.find((a) => a.id === sub) : scene.actions.find((a) => a.id === id);
    const recruits = def?.outcome?.recruit ?? def?.check?.success?.recruit;
    return { id, label, keywords: def?.keywords ?? [], ...(sub && { poi }), ...checkFields(def?.check), ...(recruits && { recruits }) };
  };
  return {
    actions: availableActions(ctx).map((a) => option(a.id, a.label)),
    npcs: npcsHere(ctx).map((id) => ({ id, name: ctx.adventure.npcs.find((n) => n.id === id)?.name ?? id })),
    pois: scene.pois.map((p) => ({ id: p.id, name: p.name })),
  };
}

function checkFields(check: { skill?: Skill; ability?: Ability } | undefined): Pick<IntentOption, 'skill' | 'ability'> {
  return { ...(check?.skill && { skill: check.skill }), ...(check?.ability && { ability: check.ability }) };
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
  // "ser mig omkring": the Danish Look around button (A141d); full Danish keywords come with A150.
  [/\b(look|glance|observe|survey)\b|\bser mig\b/, 'look'],
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

function namesOf(ictx: IntentContext): Set<string> {
  return new Set([...ictx.npcs, ...ictx.pois].flatMap((x) => words(x.name)));
}

function skillVerb(text: string): { word: string; skill: Skill } | undefined {
  const lower = text.toLowerCase();
  for (const [re, skill] of SKILL_WORDS) {
    const m = re.exec(lower)?.[0];
    if (m) return { word: m.trim(), skill };
  }
  return undefined;
}

/**
 * The offered action the text names with confidence: a strong match ("talk to the mayor" →
 * talk_mayor) — unless the text uses a skill verb the action doesn't ("persuade Hobb about the
 * reward" is a Persuasion attempt, not the plain talk action).
 */
function confidentAction(text: string, ictx: IntentContext): string | undefined {
  const match = bestAction(text, ictx.actions, namesOf(ictx));
  if (!match || match.score < 2) return undefined;
  const opt = ictx.actions.find((a) => a.id === match.id)!;
  const verb = skillVerb(text);
  const vocab = `${opt.label} ${opt.keywords.join(' ')}`.toLowerCase();
  return !verb || vocab.includes(verb.word) ? match.id : undefined;
}

/** Deterministic fallback when the LLM is unavailable or its reply is unusable. */
export function keywordIntent(text: string, ictx: IntentContext): Intent {
  const lower = text.toLowerCase();
  const match = bestAction(text, ictx.actions, namesOf(ictx));
  const target = findTarget(text, ictx);
  const skill = skillVerb(text)?.skill;
  const sure = confidentAction(text, ictx);
  if (sure) return { action: 'choose_action', actionId: sure, ...(target && { target }) };
  const verb = VERB_ACTIONS.find(([re]) => re.test(lower))?.[1];
  if (verb === 'attack') return { action: 'attack', ...(target && { target }) };
  if (skill) return { action: 'skill_check', skill, ...(target && { target }), approach: text.slice(0, 160) };
  if (match) return { action: 'choose_action', actionId: match.id, ...(target && { target }) };
  if (verb) return { action: verb, ...(target && { target }), approach: text.slice(0, 160) };
  return { action: 'other', approach: text.slice(0, 160) };
}

// ---------------------------------------------------------------- mapping onto offered actions

const LOOK_LABEL = /^(examine|look|inspect|search|study|investigate|peer|check)\b/i;
/** Asking someone to come along (A123): "join me", "come with me", "ride with us", "travel together"... */
const JOIN_TEXT = /\b(join|joins|joining|recruit|accompany|come (with|along)|ride (with|along)|travel (with|together)|walk with|follow me|with (me|us) on)\b/i;
/** Generic readings a better-matching offered action should replace. */
const GENERIC: ReadonlySet<Intent['action']> = new Set(['look', 'talk', 'move', 'rest', 'use_item', 'other', 'skill_check', 'choose_action']);

/**
 * Maps an intent (usually the LLM's) onto an offered action when the words clearly mean one, so
 * "look down the well" runs the well's Examine action instead of a generic look (A120). In order:
 *  1. a valid choose_action stays;
 *  2. a confident keyword match on an offered action wins over a generic reading;
 *  3. a target point of interest: its action with the intent's skill, or for a look its
 *     examine-type action (or its only plain action);
 *  3b. a talk/other intent whose text asks someone to join ("come with me") → the offered recruit
 *     action for that companion (A123);
 *  4. a skill (the intent's, else a skill verb in the text): the offered action rolling that skill,
 *     or a plain check of the skill's ability whose label shares a word with the text.
 * Anything else is returned unchanged; validateIntent/resolveIntent handle it as before.
 */
export function refineIntent(intent: Intent, text: string, ictx: IntentContext): Intent {
  if (intent.action === 'choose_action' && ictx.actions.some((a) => a.id === intent.actionId)) return intent;
  if (!GENERIC.has(intent.action)) return intent;
  const choose = (id: string): Intent => ({ action: 'choose_action', actionId: id, ...(intent.target && { target: intent.target }) });

  const sure = confidentAction(text, ictx);
  if (sure) return choose(sure);

  const join = intent.action === 'talk' || intent.action === 'other' ? recruitAction(intent.target, text, ictx) : undefined;
  if (join) return choose(join.id);

  const skill = intent.action === 'skill_check' ? intent.skill : undefined;
  const poi = poiOf(intent.target, ictx) ?? poiOf(findTarget(text, ictx), ictx);
  const atPoi = poi ? ictx.actions.filter((a) => a.poi === poi) : [];
  if (atPoi.length) {
    const hit = skill ? atPoi.find((a) => a.skill === skill) : intent.action === 'look' || intent.action === 'other' ? lookAction(atPoi) : undefined;
    if (hit) return choose(hit.id);
  }

  const textWords = new Set(words(text).filter((w) => w.length > 3 && !namesOf(ictx).has(w)));
  const overlap = (o: IntentOption) => words(o.label).filter((w) => textWords.has(w)).length;
  for (const s of [...new Set([skill, skillVerb(text)?.skill].filter((x): x is Skill => !!x))]) {
    const exact = ictx.actions.filter((a) => a.skill === s);
    if (exact.length === 1) return choose(exact[0]!.id);
    const pick = best(exact, overlap) ?? best(ictx.actions.filter((a) => !a.skill && a.ability === SKILL_ABILITY[s]), overlap);
    if (pick) return choose(pick.id);
  }
  return intent;
}

/**
 * The offered recruit action a "come with me" line means: only when the text asks someone to join.
 * Picks the action whose companion id matches the target or the text, else the only companion on offer.
 * Several offered actions for one companion (a plain and a check version) → the first offered.
 */
function recruitAction(target: string | undefined, text: string, ictx: IntentContext): IntentOption | undefined {
  if (!JOIN_TEXT.test(text)) return undefined;
  const offers = ictx.actions.filter((a) => a.recruits);
  if (!offers.length) return undefined;
  const npcName = ictx.npcs.find((n) => n.id === target)?.name ?? '';
  // Companion ids are short names ("corwin"); NPC ids add a suffix ("corwin_npc").
  const said = new Set(words(`${target ?? ''} ${npcName} ${text}`.replace(/_/g, ' ')));
  const named = offers.find((a) => said.has(a.recruits!.toLowerCase()));
  if (named) return named;
  return new Set(offers.map((a) => a.recruits)).size === 1 ? offers[0] : undefined;
}

function poiOf(target: string | undefined, ictx: IntentContext): string | undefined {
  if (!target) return undefined;
  const t = target.toLowerCase();
  return ictx.pois.find((p) => p.id === target || p.name.toLowerCase() === t || p.name.toLowerCase().includes(t) || t.includes(p.name.toLowerCase()))?.id;
}

function lookAction(options: IntentOption[]): IntentOption | undefined {
  const plain = options.filter((a) => !a.skill && !a.ability);
  return plain.find((a) => LOOK_LABEL.test(a.label)) ?? (plain.length === 1 ? plain[0] : undefined) ?? (options.length === 1 ? options[0] : undefined);
}

/** The option with the most shared words (at least one; ties → first). */
function best(options: IntentOption[], score: (o: IntentOption) => number): IntentOption | undefined {
  let top: IntentOption | undefined;
  let topScore = 0;
  for (const o of options) {
    const s = score(o);
    if (s > topScore) [top, topScore] = [o, s];
  }
  return top;
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
