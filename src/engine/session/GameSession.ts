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
import type { Language } from '../../shared/i18nCore';
import { messages, type Messages } from '../i18n';
import { MINUTES_PER_DAY } from '../world/clock';
import { deletePage, reorderPages, savePage } from './journal';
import { allows, HOST_SEAT, seatOf, soloTable, type SeatId, type Table } from './table';
import { GameStateSchema, LOG_LIMIT, ROLL_LIMIT, type GameState, type LogEntry, type RollRecord } from './gameState';

/** Metadata the session provides for a save; the store adds slot id, kind and timestamp. */
export interface SessionSaveMeta {
  name: string;
  characterName: string;
  level: number;
  location: string;
  mode: GameState['mode'];
  playTimeMinutes: number;
  /** First-chapter adventure id of the campaign (B001). */
  campaign?: string;
  /** Final ending the story reached (B002). */
  ending?: string;
  /** Data URL of the hero picture (save browser). */
  thumbnail?: string;
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
  /** Offers the current buttons again without acting (after a language switch). */
  refresh?(session: GameSession): Promise<void>;
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
  /** World rules for new games (B002); the host fills them from its campaign table and calendar. */
  world?: WorldRules;
}

export interface WorldRules {
  /** Flags a new world of `campaign` starts with (under any imported world's own flags). */
  freshFlags?(campaign: string | undefined): GameState['flags'];
  /** Minutes in a calendar year: an imported world moves on one year (default 360 days). */
  yearMinutes?: number;
}

/** Flag namespaces a new hero inherits from a finished save's world. */
const WORLD_PREFIXES = ['world.', 'arc.main.'];
const DEFAULT_YEAR_MINUTES = 360 * MINUTES_PER_DAY;

export const START_LOCATION = 'Millbrook';

/** Commands handled by ActionPort.command (the extension point for game systems). */
export type ExtensionCommand = Extract<ClientCommand, { type: 'equip' | 'unequip' | 'shop_open' | 'shop_buy' | 'shop_sell' | 'shop_haggle' | 'combat_act' | 'combat_flee' | 'level_up' | 'companion_control' | 'repair' }>;

/** Parts of the old state a new Hardcore hero inherits: the world, not the character. */
export function continueWorld(old: GameState, fresh: GameState): GameState {
  const { combat: _combat, ...extensions } = old.extensions;
  // The world keeps its campaign too (the story in progress continues with the new hero).
  const campaign = old.campaign ?? fresh.campaign;
  return { ...fresh, campaignId: old.campaignId, ...(campaign && { campaign }), time: old.time, flags: old.flags, extensions, location: old.location, journal: old.journal, summary: old.summary, summaryUpTo: old.summaryUpTo, log: old.log, nextId: old.nextId, rolls: old.rolls };
}

/** The final ending a state's story reached (main adventure ended with no next chapter), if any. */
export function finishedEnding(state: GameState): string | undefined {
  const p = state.extensions.adventure as { ending?: string } | undefined;
  return p?.ending;
}

/**
 * "New hero, same world" (B002): a fresh campaign state that inherits a finished save's world — its
 * world.* and arc.main.* flags and faction reputation — one year later at 08:00. Everything personal
 * (hero, party, journal, log, map knowledge, story progress) starts fresh.
 */
export function importWorld(old: GameState, fresh: GameState, yearMinutes = DEFAULT_YEAR_MINUTES): GameState {
  const flags = Object.fromEntries(Object.entries(old.flags).filter(([k]) => WORLD_PREFIXES.some((p) => k.startsWith(p))));
  const day = Math.floor(old.time / MINUTES_PER_DAY);
  const extensions: GameState['extensions'] = {
    ...fresh.extensions,
    worldFrom: { campaignId: old.campaignId, ...(old.campaign && { campaign: old.campaign }), ending: finishedEnding(old), hero: old.hero.name },
  };
  if (old.extensions.reputation !== undefined) extensions.reputation = structuredClone(old.extensions.reputation);
  return { ...fresh, time: day * MINUTES_PER_DAY + yearMinutes + (fresh.time % MINUTES_PER_DAY), flags: { ...fresh.flags, ...flags }, extensions };
}

/** A fresh campaign state for a newly created hero. `campaign` = first-chapter adventure id (default: the host's starter). */
export function newGameState(hero: Character, mode: GameState['mode'], seed: string | number, campaign?: string): GameState {
  const rng = Rng.fromSeed(seed);
  return GameStateSchema.parse({
    campaignId: `c-${String(seed).replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'game'}`,
    mode,
    ...(campaign && { campaign }),
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
    session.addLog('system', session.msgs.m('session.noEngine'));
  },
  async choose(session, actionId) {
    session.addLog('system', session.msgs.m('session.noAction', { id: actionId }));
  },
};

export class GameSession {
  private state: GameState | null = null;
  /** Latest picture of the hero from the client (save browser thumbnail, spec §9/§12). */
  private thumbnail: string | undefined;
  private rngInstance: Rng | null = null;
  private listeners = new Set<(e: ServerEvent) => void>();
  /** Language of the lines the engine writes from now on (the player's setting; old lines stay as written). */
  language: Language = 'en';
  /** Who sits at the game and what they may send (co-op, C001). Session memory only, never saved. */
  table: Table = soloTable();

  constructor(private readonly ports: SessionPorts = {}) {}

  /** Subscribes to events; returns an unsubscribe function. */
  on(listener: (e: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(e: ServerEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Engine texts in the session's language. */
  get msgs(): Messages {
    return messages(this.language);
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
    for (const e of this.ports.systems?.timeAdvanced(this.current, from, this.current.time, this.msgs) ?? []) this.addLog('system', e.text);
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
      ...(s.campaign && { campaign: s.campaign }),
      ...(finishedEnding(s) !== undefined && { ending: finishedEnding(s) }),
      ...(this.thumbnail && { thumbnail: this.thumbnail }),
    };
  }

  /** Autosave (scene changes, rests, before combat). No-op without a save port or game. */
  autosave(): SaveMeta | undefined {
    if (!this.ports.saves || !this.state) return undefined;
    const meta = this.ports.saves.autosave(this.saveMeta(), this.current);
    this.emit({ type: 'saved', meta });
    return meta;
  }

  /**
   * Handles one validated command sent from `seat` (default the host: solo play). The table policy
   * decides first; refusals and errors become `error` events; this never throws.
   */
  async handle(cmd: ClientCommand, seat: SeatId = HOST_SEAT): Promise<void> {
    const reqId = cmd.reqId;
    const verdict = allows(this.table, cmd, seat, this.state ?? undefined);
    if (!verdict.ok) return this.fail(this.msgs.m(verdict.key), reqId);
    if (cmd.type === 'companion_control' && cmd.control.startsWith('seat:') && !seatOf(this.table, cmd.control.slice(5))) return this.fail(this.msgs.m('table.noSeat'), reqId);
    try {
      switch (cmd.type) {
        case 'ping':
          this.emit({ type: 'pong', ...(reqId && { reqId }) });
          return;
        case 'thumbnail':
          this.thumbnail = cmd.data;
          return;
        case 'set_language': {
          const changed = this.language !== cmd.language;
          this.language = cmd.language;
          // Buttons on screen were offered in the old language: offer them again in the new one.
          if (changed && this.running) await this.ports.actions?.refresh?.(this);
          return;
        }
        case 'new_game': {
          this.thumbnail = undefined;
          const seed = cmd.seed ?? this.ports.newSeed?.() ?? `${Date.now()}-${Math.random()}`;
          const fresh = newGameState(cmd.hero, cmd.mode, seed, cmd.campaign);
          fresh.flags = { ...this.ports.world?.freshFlags?.(cmd.campaign) };
          let state = fresh;
          if (cmd.worldFrom) state = this.worldOf(cmd.worldFrom, fresh);
          else if (cmd.continueWorld && this.state) state = continueWorld(this.current, fresh);
          this.start(state);
          this.emit(this.snapshot());
          await this.ports.actions?.begin?.(this);
          this.emit(this.snapshot());
          this.autosave();
          return;
        }
        case 'get_state':
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          this.emit(this.snapshot());
          return;
        case 'load': {
          if (!this.ports.saves) return this.fail(this.msgs.m('session.noSaving'), reqId);
          this.start(this.ports.saves.load(cmd.slot));
          this.emit(this.snapshot());
          await this.ports.actions?.begin?.(this);
          return;
        }
        case 'travel':
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          if (!this.ports.actions?.travel) return this.fail(this.msgs.m('session.noTravel'), reqId);
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
        case 'combat_act':
        case 'combat_flee':
        case 'level_up':
        case 'companion_control':
        case 'repair':
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          if (!this.ports.actions?.command) return this.fail(this.msgs.m('session.notAvailable'), reqId);
          await this.ports.actions.command(this, cmd);
          this.emit(this.snapshot());
          return;
        case 'journal_save':
        case 'journal_delete':
        case 'journal_reorder': {
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          const j = this.current.journal;
          let savedId: string | undefined;
          if (cmd.type === 'journal_save') savedId = savePage(j, cmd.page, this.current.time);
          else if (cmd.type === 'journal_delete') deletePage(j, cmd.id);
          else reorderPages(j, cmd.ids);
          this.emit({ type: 'journal', journal: structuredClone(j), ...(savedId && { savedId }) });
          return;
        }
        case 'save': {
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          if (!this.ports.saves) return this.fail(this.msgs.m('session.noSaving'), reqId);
          const meta = this.ports.saves.save(cmd.slot, this.saveMeta(cmd.name), this.current);
          this.emit({ type: 'saved', meta });
          return;
        }
        case 'say':
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          await (this.ports.actions ?? fallbackActions).say(this, cmd.text);
          this.emit(this.snapshot());
          this.emit({ type: 'ack', command: cmd.type, ...(reqId && { reqId }) });
          return;
        case 'choose':
          if (!this.running) return this.fail(this.msgs.m('session.noGame'), reqId);
          await (this.ports.actions ?? fallbackActions).choose(this, cmd.actionId);
          this.emit(this.snapshot());
          this.emit({ type: 'ack', command: cmd.type, ...(reqId && { reqId }) });
          return;
      }
    } catch (err) {
      this.fail(err instanceof Error ? err.message : this.msgs.m('session.failed'), reqId);
    }
  }

  /** A new game in the world of the finished save in `slot` (throws a player-facing error otherwise). */
  private worldOf(slot: string, fresh: GameState): GameState {
    if (!this.ports.saves) throw new Error(this.msgs.m('session.noSaving'));
    const old = GameStateSchema.parse(this.ports.saves.load(slot));
    if (finishedEnding(old) === undefined) throw new Error(this.msgs.m('session.worldNotFinished'));
    return importWorld(old, fresh, this.ports.world?.yearMinutes);
  }

  private fail(message: string, reqId?: string): void {
    this.emit({ type: 'error', message, ...(reqId && { reqId }) });
  }
}
