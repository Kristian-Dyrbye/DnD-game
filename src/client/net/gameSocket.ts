/**
 * Client side of the game channel (WebSocket or in-page host, see transport.ts). Keeps the latest server state in signals the UI renders
 * (game state, story log, rolls, suggested actions), and re-requests a snapshot after a reconnect.
 */
import type { DungeonView } from '../../engine/world/dungeon';
import type { DialogueView } from '../../engine/adventure/conversation';
import { effect, signal } from '@preact/signals';
import { language } from '../ui/i18n';
import type { GameState, LogEntry, RollRecord } from '../../engine/session/gameState';
import type { ClientCommand, ServerEvent, SuggestedAction } from '../../shared/protocol';
import type { ShopView } from '../../engine/world/shops';
import type { Encounter } from '../../engine/combat/encounter';
import { audio } from '../audio/AudioManager';
import { sfxForEvent } from '../audio/audioLogic';
import { ttsPlayer } from '../audio/ttsPlayer';
import { WebSocketTransport, type Connection, type Transport } from './transport';

export type { Connection } from './transport';

export const connection = signal<Connection>('closed');
export const gameState = signal<GameState | null>(null);
export const storyLog = signal<LogEntry[]>([]);
export const rollHistory = signal<RollRecord[]>([]);
export const suggestions = signal<SuggestedAction[]>([]);
/** The open conversation (its line; the options are the suggestions meanwhile). */
export const dialogue = signal<DialogueView | null>(null);
/** Text of the narration currently streaming in, keyed by log entry id. */
export const streaming = signal<{ entryId: number; text: string } | null>(null);
export const lastError = signal<string | null>(null);
/** Current objective text (shown only when the objective hint setting is on). */
export const objective = signal<string | null>(null);
/** Map of the current dungeon/building scene with fog (A076). */
export const dungeon = signal<DungeonView | null>(null);
/** The running fight (server state) and whether fleeing is allowed. */
export const fight = signal<{ encounter: Encounter; canFlee: boolean } | null>(null);
/** Co-op: the guest seat's creature the fight waits for (cleared by every `combat` event; C006 shows it). */
export const waitingFor = signal<Extract<ServerEvent, { type: 'waiting' }> | null>(null);
/** Hardcore: name of the hero who just died (shows the "continue this world" screen). */
export const heroFallen = signal<string | null>(null);
/** The open shop's offer (server-computed prices). */
export const shopView = signal<ShopView | null>(null);
/** The journal page the server just saved (so the editor can select a new page). */
export const lastSavedPage = signal<{ id: string; at: number } | null>(null);

/** Applies one server event to the signals. Exported for tests. */
export function applyEvent(e: ServerEvent): void {
  const fx = sfxForEvent(e);
  if (fx) audio.sfx(fx);
  switch (e.type) {
    case 'mood':
      audio.setMood(e.mood, e.ambience);
      return;
    case 'combat':
      fight.value = e.encounter ? { encounter: e.encounter, canFlee: e.canFlee ?? true } : null;
      waitingFor.value = null;
      return;
    case 'waiting':
      waitingFor.value = e;
      return;
    case 'hero_fallen':
      heroFallen.value = e.name;
      return;
    case 'tts':
      ttsPlayer.ready(e.entryId);
      return;
    case 'snapshot':
      gameState.value = e.state;
      if (!e.state.extensions.combat) fight.value = null;
      storyLog.value = e.state.log;
      rollHistory.value = e.state.rolls;
      return;
    case 'log':
      storyLog.value = [...storyLog.value, e.entry].slice(-200);
      ttsPlayer.line(e.entry);
      if (streaming.value?.entryId === e.entry.id) streaming.value = null;
      return;
    case 'narration':
      if (e.phase === 'start') streaming.value = { entryId: e.entryId, text: '' };
      else if (e.phase === 'chunk' && streaming.value?.entryId === e.entryId) streaming.value = { entryId: e.entryId, text: streaming.value.text + e.text };
      return;
    case 'roll':
      rollHistory.value = [...rollHistory.value, e.roll].slice(-50);
      return;
    case 'suggestions':
      suggestions.value = e.actions;
      return;
    case 'dialogue':
      dialogue.value = e.view;
      return;
    case 'error':
      lastError.value = e.message;
      return;
    case 'objective':
      objective.value = e.text;
      return;
    case 'dungeon':
      dungeon.value = e.view;
      return;
    case 'shop':
      shopView.value = e.shop;
      return;
    case 'journal':
      if (gameState.value) gameState.value = { ...gameState.value, journal: e.journal };
      if (e.savedId) lastSavedPage.value = { id: e.savedId, at: Date.now() };
      return;
    default:
      return;
  }
}

let transport: Transport = new WebSocketTransport();

/** Picks how the client reaches the game (WebSocket to the server, or the in-page host). Call before connect(). */
export function setTransport(t: Transport): void {
  transport = t;
}

export function connect(): void {
  transport.connect({
    onEvent: applyEvent,
    onStatus: (s) => (connection.value = s),
    // The engine writes its lines in the player's language; after a reconnect, ask for a fresh snapshot.
    onOpen: () => [{ type: 'set_language', language: language.peek() }, ...(gameState.value ? [{ type: 'get_state' } as const] : [])],
  });
}

// A language switch while connected reaches the engine at once (new lines only; old ones stay).
effect(() => {
  const lang = language.value;
  if (connection.peek() === 'open') transport.send({ type: 'set_language', language: lang });
});

/** Sends a command, connecting first if needed (commands wait in the transport's outbox until open). */
export function send(cmd: ClientCommand): void {
  connect();
  transport.send(cmd);
}
