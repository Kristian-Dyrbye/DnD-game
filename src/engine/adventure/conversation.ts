/**
 * Conversation trees (A129): pure lookups for NPC dialogue. An NPC's conversations are offered as
 * `talk.<npc>.<conversation>` actions wherever the NPC is present; while a talk is open, the only
 * actions are the current node's options (`dlg.<node>.<option>`) and `dlg.bye`. The runner applies
 * option checks/outcomes; the node lines are logged verbatim as dialogue.
 */
import { evalCondition, type ConditionContext } from './conditions';
import type { Adventure, Conversation, ConversationNode, ConversationOption, Npc } from './schema';

/** The open conversation (in AdventureProgress.talk). */
export interface TalkProgress {
  npc: string;
  conversation: string;
  node: string;
  /** Option ids (`dlg.…`) of once-per-talk options already picked. */
  chosen: string[];
  /** Character id of the extra hero who opened the talk (C004); absent = the hero. */
  actor?: string;
}

/** What the client's dialogue panel shows. */
export interface DialogueView {
  npcId: string;
  npc: string;
  speaker: string;
  text: string;
}

export const TALK_PREFIX = 'talk.';
export const DIALOGUE_PREFIX = 'dlg.';
export const LEAVE_TALK = 'dlg.bye';

export const talkActionId = (npcId: string, convId: string): string => `${TALK_PREFIX}${npcId}.${convId}`;
export const optionActionId = (node: ConversationNode, o: ConversationOption): string => `${DIALOGUE_PREFIX}${node.id}.${o.id}`;
/** Key in progress.done once a `once` conversation has been started. */
export const talkDoneKey = (npcId: string, convId: string): string => `talk:${npcId}.${convId}`;

/** `talk.<npc>.<conv>` → the NPC and conversation, if both exist. */
export function conversationFor(adv: Adventure, actionId: string): { npc: Npc; conv: Conversation } | undefined {
  if (!actionId.startsWith(TALK_PREFIX)) return undefined;
  const [npcId, convId] = actionId.slice(TALK_PREFIX.length).split('.', 2);
  const npc = adv.npcs.find((n) => n.id === npcId);
  const conv = npc?.conversations.find((c) => c.id === convId);
  return npc && conv ? { npc, conv } : undefined;
}

/** The node the open talk is at (undefined if the data changed under a save). */
export function talkNode(adv: Adventure, talk: TalkProgress): { npc: Npc; conv: Conversation; node: ConversationNode } | undefined {
  const npc = adv.npcs.find((n) => n.id === talk.npc);
  const conv = npc?.conversations.find((c) => c.id === talk.conversation);
  const node = conv?.nodes.find((n) => n.id === talk.node);
  return npc && conv && node ? { npc, conv, node } : undefined;
}

/** Options of the current node that are open now (condition holds, not a used once-per-talk option). */
export function openOptions(adv: Adventure, talk: TalkProgress, cc: ConditionContext): { id: string; option: ConversationOption }[] {
  const at = talkNode(adv, talk);
  if (!at) return [];
  return at.node.options
    .map((option) => ({ id: optionActionId(at.node, option), option }))
    .filter(({ id, option }) => evalCondition(option.if, cc) && !(option.once && talk.chosen.includes(id)));
}

/** The option behind a `dlg.<node>.<option>` id at the current node. */
export function optionFor(adv: Adventure, talk: TalkProgress, actionId: string): ConversationOption | undefined {
  const at = talkNode(adv, talk);
  return at?.node.options.find((o) => optionActionId(at.node, o) === actionId);
}

/** Conversations the hero can start with the NPCs present. */
export function conversationOffers(adv: Adventure, npcIds: readonly string[], cc: ConditionContext, done: readonly string[]): { id: string; label: string; conv: Conversation }[] {
  const out: { id: string; label: string; conv: Conversation }[] = [];
  for (const npcId of npcIds) {
    const npc = adv.npcs.find((n) => n.id === npcId);
    for (const conv of npc?.conversations ?? []) {
      if (!evalCondition(conv.if, cc) || (conv.once && done.includes(talkDoneKey(npcId, conv.id)))) continue;
      out.push({ id: talkActionId(npcId, conv.id), label: conv.label ?? `Talk to ${npc!.name}`, conv });
    }
  }
  return out;
}

/** Display name of whoever speaks a node. */
export function speakerOf(adv: Adventure, npc: Npc, node: ConversationNode): string {
  return (node.speaker ? adv.npcs.find((n) => n.id === node.speaker)?.name : undefined) ?? npc.name;
}

export function dialogueView(adv: Adventure, talk: TalkProgress | undefined): DialogueView | null {
  const at = talk && talkNode(adv, talk);
  if (!at) return null;
  return { npcId: at.npc.id, npc: at.npc.name, speaker: speakerOf(adv, at.npc, at.node), text: at.node.text };
}
