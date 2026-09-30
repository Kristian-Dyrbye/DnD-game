/**
 * The game host: one GameSession wired to the adventure ActionPort, world systems, flag registry,
 * lore, companions and data tables. It has no Node imports, so the same wiring runs on the server
 * (WebSocket clients, LLM ports) and inside the browser page (web edition: no AI, template narration,
 * keyword intents, data buttons). Commands run one at a time, in order, like on the server.
 */
import { GameSession, type SavePort, type SessionPorts } from '../engine/session/GameSession';
import { adventureActionPort, type AdventurePortOptions } from '../engine/adventure/sessionActions';
import type { Adventure } from '../engine/adventure/schema';
import type { SrdDatabase } from '../engine/data/srd';
import type { FlagRegistry } from '../engine/world/flags';
import { LoreSchema, type Lore } from '../engine/world/lore';
import { TravelEventTableSchema, type TravelEventTable } from '../engine/world/travel';
import { ShopTableSchema, type ShopTable } from '../engine/world/shops';
import { SideQuestTablesSchema, type SideQuestTables } from '../engine/adventure/sidequestTables';
import { DefeatTableSchema, type DefeatTable } from '../engine/adventure/defeat';
import { CompanionRosterSchema, type CompanionRoster } from '../engine/party/companions';
import { createDefaultRegistry } from '../engine/systems';
import { regionOfState } from '../engine/adventure/runner';
import { parseCommand, type ClientCommand, type ServerEvent } from '../shared/protocol';
import loreJson from '../../data/world/lore.json';
import travelEventsJson from '../../data/tables/travel-events.json';
import shopsJson from '../../data/world/shops.json';
import sideQuestsJson from '../../data/tables/sidequests.json';
import defeatsJson from '../../data/tables/defeat-outcomes.json';
import companionsJson from '../../data/companions.json';

/** Adventure a new campaign starts with. */
export const STARTING_ADVENTURE = 'millbrook_disappearances';

/** World data tables every edition bundles (small JSON, parsed once). */
export interface WorldTables {
  lore: Lore;
  travelEvents: TravelEventTable;
  shops: ShopTable;
  sideQuests: SideQuestTables;
  defeats: DefeatTable;
  companions: CompanionRoster;
}

let tables: WorldTables | undefined;
export function worldTables(): WorldTables {
  tables ??= {
    lore: LoreSchema.parse(loreJson),
    travelEvents: TravelEventTableSchema.parse(travelEventsJson),
    shops: ShopTableSchema.parse(shopsJson),
    sideQuests: SideQuestTablesSchema.parse(sideQuestsJson),
    defeats: DefeatTableSchema.parse(defeatsJson),
    companions: CompanionRosterSchema.parse(companionsJson),
  };
  return tables;
}

/** Optional AI ports (server edition). Without them the engine's template/keyword/data fallbacks run. */
export type AiPorts = Pick<AdventurePortOptions, 'parseIntent' | 'narrator' | 'combatNarration' | 'suggester' | 'summarizer' | 'banter'>;

export interface GameHostOptions {
  srd: SrdDatabase;
  adventures: ReadonlyMap<string, Adventure>;
  flags: FlagRegistry;
  tables?: WorldTables;
  ai?: AiPorts;
  saves?: SavePort;
  /** Overrides for the game session (tests inject actions/seeds). */
  sessionPorts?: Partial<SessionPorts>;
  /** Adventure started by new_game; defaults to STARTING_ADVENTURE (or the first loaded one). */
  startingAdventure?: string;
}

export interface GameHost {
  session: GameSession;
  /** Id of the adventure new games start with (undefined when no adventure loaded). */
  defaultAdventure: string | undefined;
  /** Queues a command; resolves once it (and everything queued before it) has run. */
  send(cmd: ClientCommand): Promise<void>;
  /** Parses a raw protocol message and queues it; returns an error event for the sender if it is invalid. */
  receive(raw: string): ServerEvent | undefined;
  /** Subscribes to session events; returns the unsubscribe function. */
  on(listener: (e: ServerEvent) => void): () => void;
  /** Waits for queued commands and background suggestion/summary work (tests). */
  idle(): Promise<void>;
}

export function createGameHost(opts: GameHostOptions): GameHost {
  const t = opts.tables ?? worldTables();
  const { adventures, srd } = opts;
  const wanted = opts.startingAdventure ?? STARTING_ADVENTURE;
  const defaultAdventure = adventures.has(wanted) ? wanted : [...adventures.keys()][0];
  const actions = defaultAdventure
    ? adventureActionPort(adventures, defaultAdventure, srd, {
        ...opts.ai,
        flags: opts.flags,
        lore: t.lore,
        travelEvents: t.travelEvents,
        shops: t.shops,
        sideQuests: t.sideQuests,
        defeats: t.defeats,
        companions: t.companions,
      })
    : undefined;
  const session = new GameSession({
    systems: createDefaultRegistry({ lore: t.lore, regionOf: (state) => regionOfState(state, adventures, t.lore) }),
    ...(actions && { actions }),
    ...(opts.saves && { saves: opts.saves }),
    ...opts.sessionPorts,
  });
  let queue: Promise<void> = Promise.resolve();
  const send = (cmd: ClientCommand): Promise<void> => (queue = queue.then(() => session.handle(cmd)));
  return {
    session,
    defaultAdventure,
    send,
    receive(raw) {
      const parsed = parseCommand(raw);
      if (!parsed.ok) return { type: 'error', message: parsed.error, ...(parsed.reqId && { reqId: parsed.reqId }) };
      void send(parsed.command);
      return undefined;
    },
    on: (listener) => session.on(listener),
    async idle() {
      await queue;
      await actions?.idle();
    },
  };
}
