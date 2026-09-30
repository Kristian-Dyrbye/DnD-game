/**
 * Action resolution pipeline (spec §3/§8): validated intent → which check and DC (adventure data
 * first, SRD DC guidance for improvised attempts) → seeded roll → state change → fixed facts for
 * the narrator. The LLM never decides success; it only narrates the facts produced here.
 */
import { SKILL_NAMES, type Skill } from '../rules/basics';
import { skillCheck } from '../rules/checks';
import type { ValidatedIntent } from './intent';
import { availableActions, currentScene, getProgress, npcsHere, perform, type RunContext, type StepResult } from './runner';
import type { Check, DifficultyTier } from './schema';
import { TIME_COSTS } from '../world/clock';
import { ENGLISH_MESSAGES } from '../i18n';

/** Used when the SRD rules tables aren't loaded (tests without a db). */
const DC_FALLBACK: Record<DifficultyTier, number> = { very_easy: 5, easy: 10, medium: 15, hard: 20, very_hard: 25, nearly_impossible: 30 };

export interface Resolution {
  result: StepResult;
  /** Which path resolved it (for logs/tests). */
  via: 'action' | 'improvised_check' | 'already_tried' | 'look' | 'talk' | 'move' | 'refused' | 'nothing';
  /** Offered action that was performed, if any. */
  actionId?: string;
  /** What the narrator should treat as the player's action. */
  playerAction: string;
}

const empty = (): StepResult => ({ facts: [], rolls: [], entered: [], items: [], coins: 0, xp: 0 });

export function improvisedDc(ctx: RunContext): number {
  const tier = currentScene(ctx).improvisedDifficulty ?? ctx.adventure.improvisedDifficulty;
  return ctx.db?.tables?.dcByDifficulty[tier] ?? DC_FALLBACK[tier];
}

export function resolveIntent(ctx: RunContext, v: ValidatedIntent, text: string): Resolution {
  const { intent } = v;
  const run = (actionId: string, via: Resolution['via'] = 'action'): Resolution => ({ result: perform(ctx, actionId), via, actionId, playerAction: text });
  if (v.actionId) return run(v.actionId);

  const offered = availableActions(ctx);
  const scene = currentScene(ctx);
  const npcName = (id?: string) => ctx.adventure.npcs.find((n) => n.id === id)?.name;
  const facts = (via: Resolution['via'], ...f: string[]): Resolution => ({ result: { ...empty(), facts: f }, via, playerAction: text });
  const { m } = ctx.msgs ?? ENGLISH_MESSAGES;

  switch (intent.action) {
    case 'skill_check': {
      const skill = intent.skill!;
      // Prefer an authored check with this skill (the adventure's DC and consequences).
      const authored = offered.find((a) => checkOf(ctx, a.id)?.skill === skill && (!v.targetId || a.id.startsWith(`${v.targetId}.`) || a.id === v.targetId));
      if (authored) return run(authored.id);
      return improvise(ctx, skill, v.targetId, text);
    }
    case 'look':
      ctx.state.time += TIME_COSTS.quick_action;
      return facts('look', m('resolve.look'));
    case 'talk': {
      const here = npcsHere(ctx);
      const who = (v.targetId && here.includes(v.targetId) ? npcName(v.targetId) : undefined) ?? (here.length === 1 ? npcName(here[0]) : undefined);
      if (!who) return facts('nothing', m(here.length ? 'resolve.whoTalk' : 'resolve.nobody'));
      const npc = ctx.adventure.npcs.find((n) => n.name === who)!;
      // An authored conversation with them opens the dialogue.
      const talk = offered.find((a) => a.kind === 'talk' && a.id.startsWith(`talk.${npc.id}.`));
      if (talk) return run(talk.id);
      ctx.state.time += TIME_COSTS.explore_action;
      return facts('talk', m('resolve.talk', { name: who, attitude: npc.attitude }));
    }
    case 'move': {
      const exits = offered.filter((a) => a.kind === 'exit');
      return facts('move', exits.length ? m('resolve.exits', { list: exits.map((e) => e.label.toLowerCase()).join('; ') }) : m('resolve.noExits'));
    }
    case 'attack': {
      const fight = offered.find((a) => actionDef(ctx, a.id)?.outcome?.encounter);
      if (fight) return run(fight.id);
      const who = npcName(v.targetId);
      return facts('refused', who ? m('resolve.noAttack', { name: who }) : m('resolve.nothingToFight'));
    }
    case 'rest':
      return facts('refused', m('resolve.noRest'));
    case 'use_item':
    case 'cast_spell':
      return facts('nothing', m('resolve.useNothing'));
    default:
      return facts('nothing', m('resolve.nothing'));
  }
}

/** One improvised attempt per skill + target per scene visit: no rerolling until it works. */
function improvise(ctx: RunContext, skill: Skill, targetId: string | undefined, text: string): Resolution {
  const { m } = ctx.msgs ?? ENGLISH_MESSAGES;
  const p = getProgress(ctx.state)!;
  const key = `${p.sceneId}/improv:${skill}:${targetId ?? '-'}:${p.entries ?? 0}`;
  if (p.done.includes(key)) {
    return { result: { ...empty(), facts: [m('resolve.alreadyTried', { skill: SKILL_NAMES[skill] })] }, via: 'already_tried', playerAction: text };
  }
  p.done.push(key);
  ctx.state.time += TIME_COSTS.quick_action;
  const dc = improvisedDc(ctx);
  const roll = skillCheck(ctx.state.hero, skill, { rng: ctx.rng, dc, ...(ctx.msgs && { msgs: ctx.msgs }) });
  const what = SKILL_NAMES[skill];
  const fact = m(roll.success ? 'resolve.improvSuccess' : 'resolve.improvFail', { skill: what });
  return { result: { ...empty(), rolls: [roll], facts: [fact] }, via: 'improvised_check', playerAction: text };
}

/** The authored check behind an offered action or gated exit. */
function checkOf(ctx: RunContext, id: string): Check | undefined {
  if (id.startsWith('exit.')) return currentScene(ctx).exits.find((e) => `exit.${e.id}` === id)?.check;
  return actionDef(ctx, id)?.check;
}

function actionDef(ctx: RunContext, id: string) {
  const scene = currentScene(ctx);
  if (id.startsWith('exit.')) return undefined;
  const [poi, sub] = id.includes('.') ? id.split('.', 2) : [undefined, id];
  return poi ? scene.pois.find((p) => p.id === poi)?.actions.find((a) => a.id === sub) : scene.actions.find((a) => a.id === id);
}
