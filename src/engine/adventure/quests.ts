/**
 * Internal quest tracking (spec §15). Quests are never shown as a log: the journal is the player's
 * own notebook. The engine still tracks quests and objectives from world flags for campaign logic,
 * LLM context, and the optional "current objective" hint (default off, toggled in settings).
 */
import type { GameState } from '../session/gameState';
import { evalCondition } from './conditions';
import { conditionContext, getProgress, type RunContext } from './runner';

export interface QuestProgress {
  status: 'active' | 'completed' | 'failed';
  startedAt: number;
  endedAt?: number;
  objectivesDone: string[];
}

export type QuestLog = Record<string, QuestProgress>;

export interface QuestChange {
  questId: string;
  change: 'started' | 'objective' | 'completed' | 'failed';
  objectiveId?: string;
}

export function questLog(state: GameState): QuestLog {
  return (state.extensions.quests as QuestLog | undefined) ?? {};
}

/** Updates quest progress from the current world state. Returns what changed (for logs/tests). */
export function trackQuests(ctx: Pick<RunContext, 'state' | 'adventure' | 'flags'>): QuestChange[] {
  const { state, adventure } = ctx;
  if (adventure.quests.length === 0) return [];
  const log: QuestLog = { ...questLog(state) };
  const cc = conditionContext(state, getProgress(state), ctx.flags);
  const changes: QuestChange[] = [];
  for (const q of adventure.quests) {
    let rec = log[q.id];
    if (!rec) {
      if (!evalCondition(q.start, cc)) continue;
      rec = log[q.id] = { status: 'active', startedAt: state.time, objectivesDone: [] };
      changes.push({ questId: q.id, change: 'started' });
    }
    if (rec.status !== 'active') continue;
    for (const o of q.objectives) {
      if (!rec.objectivesDone.includes(o.id) && evalCondition(o.done, cc)) {
        rec.objectivesDone.push(o.id);
        changes.push({ questId: q.id, change: 'objective', objectiveId: o.id });
      }
    }
    if (q.fail && evalCondition(q.fail, cc)) {
      rec.status = 'failed';
      rec.endedAt = state.time;
      changes.push({ questId: q.id, change: 'failed' });
    } else if (q.complete ? evalCondition(q.complete, cc) : q.objectives.every((o) => rec!.objectivesDone.includes(o.id))) {
      rec.status = 'completed';
      rec.endedAt = state.time;
      changes.push({ questId: q.id, change: 'completed' });
    }
  }
  state.extensions.quests = log;
  return changes;
}

/**
 * The hint text: the first open objective (whose `if` holds) of the earliest-started active quest.
 * Undefined when there is nothing to hint at.
 */
export function currentObjective(ctx: Pick<RunContext, 'state' | 'adventure' | 'flags'>): string | undefined {
  const log = questLog(ctx.state);
  const cc = conditionContext(ctx.state, getProgress(ctx.state), ctx.flags);
  const active = ctx.adventure.quests
    .filter((q) => log[q.id]?.status === 'active')
    .sort((a, b) => log[a.id]!.startedAt - log[b.id]!.startedAt);
  for (const q of active) {
    const open = q.objectives.find((o) => !log[q.id]!.objectivesDone.includes(o.id) && evalCondition(o.if, cc));
    if (open) return open.text;
  }
  return undefined;
}

/** Plain lines for the LLM prompt (what the hero is trying to do; never shown as a quest log). */
export function questContextLines(ctx: Pick<RunContext, 'state' | 'adventure' | 'flags'>): string[] {
  const log = questLog(ctx.state);
  return ctx.adventure.quests.filter((q) => log[q.id]?.status === 'active').map((q) => `The hero is pursuing: ${q.name}.`);
}
