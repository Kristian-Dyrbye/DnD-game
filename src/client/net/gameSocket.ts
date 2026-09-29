/**
 * Client side of the game WebSocket. Keeps the latest server state in signals the UI renders
 * (game state, story log, rolls, suggested actions), reconnects with backoff, and re-requests a
 * snapshot after reconnecting. Commands sent while disconnected wait in a small outbox.
 */
import { signal } from '@preact/signals';
import type { GameState, LogEntry, RollRecord } from '../../engine/session/gameState';
import type { ClientCommand, ServerEvent, SuggestedAction } from '../../shared/protocol';
import type { ShopView } from '../../engine/world/shops';

export type Connection = 'connecting' | 'open' | 'closed';

export const connection = signal<Connection>('closed');
export const gameState = signal<GameState | null>(null);
export const storyLog = signal<LogEntry[]>([]);
export const rollHistory = signal<RollRecord[]>([]);
export const suggestions = signal<SuggestedAction[]>([]);
/** Text of the narration currently streaming in, keyed by log entry id. */
export const streaming = signal<{ entryId: number; text: string } | null>(null);
export const lastError = signal<string | null>(null);
/** Current objective text (shown only when the objective hint setting is on). */
export const objective = signal<string | null>(null);
/** The open shop's offer (server-computed prices). */
export const shopView = signal<ShopView | null>(null);
/** The journal page the server just saved (so the editor can select a new page). */
export const lastSavedPage = signal<{ id: string; at: number } | null>(null);

let ws: WebSocket | null = null;
let retry = 0;
const outbox: string[] = [];

/** Applies one server event to the signals. Exported for tests. */
export function applyEvent(e: ServerEvent): void {
  switch (e.type) {
    case 'snapshot':
      gameState.value = e.state;
      storyLog.value = e.state.log;
      rollHistory.value = e.state.rolls;
      return;
    case 'log':
      storyLog.value = [...storyLog.value, e.entry].slice(-200);
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
    case 'error':
      lastError.value = e.message;
      return;
    case 'objective':
      objective.value = e.text;
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

export function connect(): void {
  if (ws || typeof WebSocket === 'undefined') return;
  connection.value = 'connecting';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    connection.value = 'open';
    retry = 0;
    if (gameState.value) sock.send(JSON.stringify({ type: 'get_state' } satisfies ClientCommand));
    while (outbox.length) sock.send(outbox.shift()!);
  };
  sock.onmessage = (m) => {
    try {
      applyEvent(JSON.parse(String(m.data)) as ServerEvent);
    } catch {
      // Ignore malformed server messages.
    }
  };
  sock.onclose = () => {
    ws = null;
    connection.value = 'closed';
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
}

export function send(cmd: ClientCommand): void {
  const raw = JSON.stringify(cmd);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
  else {
    outbox.push(raw);
    connect();
  }
}
