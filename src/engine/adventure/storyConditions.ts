/**
 * Conditions caused by the story (A130): an outcome can poison, frighten or blind the hero or the
 * whole party for some minutes of game time, or end such a condition early. The condition sits on
 * the character like any other (sourceId `story`, so checks and fights see it); timed ones are
 * listed in `state.extensions.storyConditions` and end when the clock passes their end time
 * (storyConditionSystem).
 */
import type { Character } from '../core/creature';
import type { Condition } from '../rules/basics';
import type { GameState } from '../session/gameState';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

export const STORY_SOURCE = 'story';

export interface StoryConditionEntry {
  creatureId: string;
  condition: Condition;
  /** Campaign minute when it ends. */
  until: number;
}

export interface StoryConditionChange {
  condition: Condition;
  target: 'hero' | 'party';
  minutes?: number | undefined;
  remove?: boolean | undefined;
}

function entries(state: GameState): StoryConditionEntry[] {
  return (state.extensions.storyConditions as StoryConditionEntry[] | undefined) ?? [];
}

function update(state: GameState, id: string, fn: (c: Character) => Character): void {
  if (state.hero.id === id) state.hero = fn(state.hero);
  else state.companions = state.companions.map((c) => (c.id === id ? fn(c) : c));
}

const without = (condition: Condition) => (c: Character): Character => ({ ...c, conditions: c.conditions.filter((x) => !(x.condition === condition && x.sourceId === STORY_SOURCE)) });

/** Applies one outcome condition change. Returns fact lines ("Mara is poisoned for 1 hour."). */
export function applyStoryCondition(state: GameState, change: StoryConditionChange, msgs: Messages = ENGLISH_MESSAGES): string[] {
  const { m } = msgs;
  const condition = change.condition;
  const targets = change.target === 'party' ? [state.hero, ...state.companions] : [state.hero];
  const lines: string[] = [];
  let list = entries(state);
  for (const t of targets) {
    if (t.dead) continue;
    const has = t.conditions.some((x) => x.condition === change.condition && x.sourceId === STORY_SOURCE);
    list = list.filter((e) => !(e.creatureId === t.id && e.condition === change.condition));
    if (change.remove) {
      if (!has) continue;
      update(state, t.id, without(change.condition));
      lines.push(m('condition.off', { name: t.name, condition }));
      continue;
    }
    if (t.conditionImmunities.includes(change.condition)) {
      lines.push(m('condition.immune', { name: t.name, condition }));
      continue;
    }
    if (!has) update(state, t.id, (c) => ({ ...c, conditions: [...c.conditions, { condition: change.condition, sourceId: STORY_SOURCE }] }));
    if (change.minutes) list.push({ creatureId: t.id, condition: change.condition, until: state.time + change.minutes });
    lines.push(change.minutes ? m('condition.onFor', { name: t.name, condition, duration: duration(change.minutes, msgs) }) : m('condition.on', { name: t.name, condition }));
  }
  state.extensions.storyConditions = list;
  return lines;
}

/** Ends timed story conditions whose time is up. Returns one line per ended condition. */
export function expireStoryConditions(state: GameState, msgs: Messages = ENGLISH_MESSAGES): string[] {
  const list = entries(state);
  if (!list.length) return [];
  const lines: string[] = [];
  const keep: StoryConditionEntry[] = [];
  for (const e of list) {
    if (e.until > state.time) {
      keep.push(e);
      continue;
    }
    const who = state.hero.id === e.creatureId ? state.hero : state.companions.find((c) => c.id === e.creatureId);
    if (who?.conditions.some((x) => x.condition === e.condition && x.sourceId === STORY_SOURCE)) {
      update(state, e.creatureId, without(e.condition));
      lines.push(msgs.m('condition.off', { name: who.name, condition: e.condition }));
    }
  }
  state.extensions.storyConditions = keep;
  return lines;
}

/** 90 → "1 hour 30 minutes" (Danish "1 time 30 minutter"). */
export function duration(minutes: number, msgs: Messages = ENGLISH_MESSAGES): string {
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return [h && msgs.mn('time.hours', h), min && msgs.mn('time.minutes', min)].filter(Boolean).join(' ');
}
