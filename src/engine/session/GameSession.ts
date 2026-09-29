/**
 * GameSession: one running campaign. It owns the GameState and the Rng, handles validated
 * client commands, and reports everything through ServerEvents (sent over the WebSocket).
 * It is isomorphic: persistence and narration are injected as ports, so tests use in-memory
 * fakes and the server supplies SaveStore + the LLM. Scene logic (A051) and narration (A053)
 * plug in through the `actions` port.
 */
import type { ClientCommand, ServerEvent, SuggestedAction } from '../../shared/protocol';
import type { SaveMeta } from '../../shared/save';
import { totalLevel, type Character } from '../core/creature';
import { Rng } from '../core/rng';
import type { SystemRegistry } from '../systems/registry';
import { deletePage, reorderPages, savePage } from './journal';
import { GameStateSchema, LOG_LIMIT, ROLL_LIMIT, type GameState, type LogEntry, type RollRecord } from './gameState';

/** Metadata the session provides for a save; the store adds slot id, kind and timestamp. */
export interface SessionSaveMeta {
  name: string;
  characterName: string;
  level: number;
  location: string;
  mode: GameState['mode'];
  playTimeMinutes: number;
}

export interface SavePort {
  save(slot: string, meta: SessionSaveMeta, state: GameState): SaveMeta;
  autosave(meta: SessionSaveMeta, state: GameState): SaveMeta;
  /** Returns the (migrated) raw `state` of a save. Throws if missing or corrupt. */
  load(slot: string): unknown;
}

/** Handles player input once a game is running (scene runner / intent parsing / narration). */
export interface ActionPort {
  say(session: GameSession, text: string): Promise<void>;
  choose(session: GameSession, actionId: string): Promise<void>;
  /** Called after new_game and load so the scene can present itself. */
  begin?(session: GameSession): Promise<void>;
  /** World-map travel to a known lore location. */
  travel?(session: GameSession, to: string, pace: 'slow' | 'normal' | 'fast'): Promise<void>;
  /** Other game commands (inventory, shops, future systems). Throw to report an error. */
  command?(session: GameSession, cmd: ExtensionCommand): Promise<void>;
}

export interface SessionPorts {
  saves?: SavePort;
  actions?: ActionPort;
  /** Seed source for new games (tests pass a fixed one). */
  newSeed?: () => string;
  /** Engine systems (clock, weather, ...): initialised on new game/load, told when time passes. */
  systems?: SystemRegistry;
}

export const START_LOCATION = 'Millbrook';

/** Commands handled by ActionPort.command (the extension point for game systems). */
export type ExtensionCommand = Extract<ClientCommand, { type: 'equip' | 'unequip' | 'shop_open' | 'shop_buy' | 'shop_sell' | 'shop_haggle' }>;

/** A fresh campaign state for a newly created hero. */
export function newGameState(hero: Character, mode: GameState['mode'], seed: string | number): GameState {
  const rng = Rng.fromSeed(seed);
  return GameStateSchema.parse({
    campaignId: `c-${String(seed).replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'game'}`,
    mode,
    rng: rng.getState(),
    hero,
    location: { name: START_LOCATION },
    // Campaigns begin at 08:00 on day 1.
    time: 8 * 60,
  });
}

/** Placeholder until the scene runner/narrator (A051/A053) are wired in. */
const fallbackActions: ActionPort = {
  async say(session, text) {
    session.addLog('player', text);
    session.addLog('system', 'The story engine is not connected yet.');
  },
  async choose(session, actionId) {
    session.addLog('system', `Action "${actionId}" is not available yet.`);
  },
};

export class GameSession {
  private state: GameState | null = null;
  private rngInstance: Rng | null = null;
  private listeners = new Set<(e: ServerEvent) => void>();

  constructor(private readonly ports: SessionPorts = {}) {}

  /** Subscribes to events; returns an unsubscribe function. */
  on(listener: (e: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(e: ServerEvent): void {
    for (const l of this.listeners) l(e);
  }

  get running(): boolean {
    return this.state !== null;
  }

  /** Current state (throws if no game is running). The Rng state is synced in. */
  get current(): GameState {
    if (!this.state || !this.rngInstance) throw new Error('No game is running');
    this.state.rng = this.rngInstance.getState();
    return this.state;
  }

  get systems(): SystemRegistry | undefined {
    return this.ports.systems;
  }

  /** Tells systems the clock moved (from → current time) and logs what they report. */
  timePassed(from: number): void {
    for (const e of this.ports.systems?.timeAdvanced(this.current, from, this.current.time) ?? []) this.addLog('system', e.text);
  }

  get rng(): Rng {
    if (!this.rngInstance) throw new Error('No game is running');
    return this.rngInstance;
  }

  /** Replaces the running game (new game or load). Validates the state. */
  start(state: unknown): GameState {
    const parsed = GameStateSchema.parse(state);
    this.ports.systems?.init(parsed);
    this.state = parsed;
    this.rngInstance = new Rng(parsed.rng);
    return parsed;
  }

  snapshot(): ServerEvent {
    return { type: 'snapshot', state: structuredClone(this.current) };
  }

  /** Reserves an id for a log entry that is streamed first and logged when complete. */
  reserveId(): number {
    return this.current.nextId++;
  }

  addLog(kind: LogEntry['kind'], text: string, speaker?: string, id?: number): LogEntry {
    const s = this.current;
    const entry: LogEntry = { id: id ?? s.nextId++, kind, text, ...(speaker && { speaker }) };
    s.log.push(entry);
    if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
    this.emit({ type: 'log', entry });
    return entry;
  }

  addRoll(roll: Omit<RollRecord, 'id'>): RollRecord {
    const s = this.current;
    const rec: RollRecord = { id: s.nextId++, ...roll };
    s.rolls.push(rec);
    if (s.rolls.length > ROLL_LIMIT) s.rolls.splice(0, s.rolls.length - ROLL_LIMIT);
    this.emit({ type: 'roll', roll: rec });
    return rec;
  }

  suggest(actions: SuggestedAction[]): void {
    this.emit({ type: 'suggestions', actions });
  }

  saveMeta(name?: string): SessionSaveMeta {
    const s = this.current;
    return {
      name: name ?? `${s.hero.name} — ${s.location.name}`,
      characterName: s.hero.name,
      level: totalLevel(s.hero),
      location: s.location.name,
      mode: s.mode,
      playTimeMinutes: Math.round(s.playTimeMinutes),
    };
  }

  /** Autosave (scene changes, rests, before combat). No-op without a save port or game. */
  autosave(): SaveMeta | undefined {
    if (!this.ports.saves || !this.state) return undefined;
    const meta = this.ports.saves.autosave(this.saveMeta(), this.current);
    this.emit({ type: 'saved', meta });
    return meta;
  }

  /** Handles one validated command. Errors become `error` events; this never throws. */
  async handle(cmd: ClientCommand): Promise<void> {
    const reqId = cmd.reqId;
    try {
      switch (cmd.type) {
        case 'ping':
          this.emit({ type: 'pong', ...(reqId && { reqId }) });
          return;
        case 'new_game': {
          const seed = cmd.seed ?? this.ports.newSeed?.() ?? `${Date.now()}-${Math.random()}`;
          this.start(newGameState(cmd.hero, cmd.mode, seed));
          this.emit(this.snapshot());
          await this.ports.actions?.begin?.(this);
          this.emit(this.snapshot());
          this.autosave();
          return;
        }
        case 'get_state':
          if (!this.running) return this.fail('No game is running', reqId);
          this.emit(this.snapshot());
          return;
        case 'load': {
          if (!this.ports.saves) return this.fail('Saving is not available', reqId);
          this.start(this.ports.saves.load(cmd.slot));
          this.emit(this.snapshot());
          await this.ports.actions?.begin?.(this);
          return;
        }
        case 'travel':
          if (!this.running) return this.fail('No game is running', reqId);
          if (!this.ports.actions?.travel) return this.fail('Travel is not available', reqId);
          await this.ports.actions.travel(this, cmd.to, cmd.pace);
          this.emit(this.snapshot());
          this.emit({ type: 'ack', command: cmd.type, ...(reqId && { reqId }) });
          return;
        case 'equip':
        case 'unequip':
        case 'shop_open':
        case 'shop_buy':
        case 'shop_sell':
        case 'shop_haggle':
          if (!this.running) return this.fail('No game is running', reqId);
          if (!this.ports.actions?.command) return this.fail('Not available', reqId);
          await this.ports.actions.command(this, cmd);
          this.emit(this.snapshot());
          return;
        case 'journal_save':
        case 'journal_delete':
        case 'journal_reorder': {
          if (!this.running) return this.fail('No game is running', reqId);
          const j = this.current.journal;
          let savedId: string | undefined;
          if (cmd.type === 'journal_save') savedId = savePage(j, cmd.page, this.current.time);
          else if (cmd.type === 'journal_delete') deletePage(j, cmd.id);
          else reorderPages(j, cmd.ids);
          this.emit({ type: 'journal', journal: structuredClone(j), ...(savedId && { savedId }) });
          return;
        }
        case 'save': {
          if (!this.running) return this.fail('No game is running', reqId);
          if (!this.ports.saves) return this.fail('Saving is not available', reqId);
          const meta = this.ports.saves.save(cmd.slot, this.saveMeta(cmd.name), this.current);
          this.emit({ type: 'saved', meta });
          return;
        }
        case 'say':
          if (!this.running) return this.fail('No game is running', reqId);
          await (this.ports.actions ?? fallbackActions).say(this, cmd.text);
          this.emit(this.snapshot());
          this.emit({ type: 'ack', command: cmd.type, ...(reqId && { reqId }) });
          return;
        case 'choose':
          if (!this.running) return this.fail('No game is running', reqId);
          await (this.ports.actions ?? fallbackActions).choose(this, cmd.actionId);
          this.emit(this.snapshot());
          this.emit({ type: 'ack', command: cmd.type, ...(reqId && { reqId }) });
          return;
      }
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Something went wrong', reqId);
    }
  }

  private fail(message: string, reqId?: string): void {
    this.emit({ type: 'error', message, ...(reqId && { reqId }) });
  }
}
