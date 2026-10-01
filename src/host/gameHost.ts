/**
 * The game host: one GameSession wired to the adventure ActionPort, world systems, flag registry,
 * lore, companions and data tables. It has no Node imports, so the same wiring runs on the server
 * (WebSocket clients, LLM ports) and inside the browser page (web edition: no AI, template narration,
 * keyword intents, data buttons). Commands run one at a time, in order, like on the server.
 */
import { GameSession, type ActionPort, type SavePort, type SessionPorts } from '../engine/session/GameSession';
import { HOST_SEAT, type SeatId } from '../engine/session/table';
import { adventureActionPort, type AdventureActionPort, type AdventurePortOptions } from '../engine/adventure/sessionActions';
import type { ContentTranslations } from '../shared/contentI18n';
import { contentByLanguage, type LocalizedContent } from './translations';
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
import { MINUTES_PER_DAY } from '../engine/world/clock';
import { CAMPAIGNS, DEFAULT_CAMPAIGN, campaignOf, type Campaign } from './campaigns';

/** Adventure a new game starts with when `new_game.campaign` is not given (the default campaign's first chapter). */
export const STARTING_ADVENTURE = DEFAULT_CAMPAIGN.adventure;

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
  /** Content overlays by language (data/i18n/<lang>/*.json); missing texts stay English. */
  translations?: ContentTranslations;
}

export interface GameHost {
  session: GameSession;
  /** Id of the adventure new games start with (undefined when no adventure loaded). */
  defaultAdventure: string | undefined;
  /** Campaigns whose first chapter is loaded (what `new_game.campaign` may name). */
  campaigns: readonly Campaign[];
  /** Queues a command from `seat` (default the host); resolves once it (and everything queued before it) has run. */
  send(cmd: ClientCommand, seat?: SeatId): Promise<void>;
  /** Parses a raw protocol message from `seat` and queues it; returns an error event for the sender if it is invalid. */
  receive(raw: string, seat?: SeatId): ServerEvent | undefined;
  /** A guest seat went away or came back (C003); queued like a command so it never cuts into one. */
  setSeatAway(seat: SeatId, away: boolean): Promise<void>;
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
  // One adventure port per content language (translated adventures + tables); each command goes to
  // the port of the session's current language. Log lines keep the language they were written in.
  const content = contentByLanguage(adventures, t, opts.translations);
  const ports = new Map<LocalizedContent, AdventureActionPort>();
  const portFor = (lang: string): AdventureActionPort => {
    const c = content(lang);
    let p = ports.get(c);
    if (!p) {
      p = adventureActionPort(c.adventures, defaultAdventure!, srd, {
        ...opts.ai,
        flags: opts.flags,
        lore: c.tables.lore,
        travelEvents: c.tables.travelEvents,
        shops: c.tables.shops,
        sideQuests: c.tables.sideQuests,
        defeats: c.tables.defeats,
        companions: c.tables.companions,
      });
      ports.set(c, p);
    }
    return p;
  };
  const actions: ActionPort | undefined = defaultAdventure
    ? {
        say: (s, text) => portFor(s.language).say(s, text),
        choose: (s, id) => portFor(s.language).choose(s, id),
        begin: (s) => portFor(s.language).begin?.(s) ?? Promise.resolve(),
        refresh: (s) => portFor(s.language).refresh?.(s) ?? Promise.resolve(),
        travel: (s, to, pace) => portFor(s.language).travel?.(s, to, pace) ?? Promise.resolve(),
        command: (s, cmd) => portFor(s.language).command?.(s, cmd) ?? Promise.resolve(),
        seatsChanged: (s) => portFor(s.language).seatsChanged?.(s) ?? Promise.resolve(),
      }
    : undefined;
  const campaignFor = (adventure: string | undefined): Campaign | undefined => campaignOf(adventure ?? defaultAdventure);
  const session = new GameSession({
    systems: createDefaultRegistry({ lore: t.lore, loreFor: (lang) => content(lang).tables.lore, regionOf: (state) => regionOfState(state, adventures, t.lore) }),
    world: { freshFlags: (c) => ({ ...campaignFor(c)?.freshWorld }), yearMinutes: t.lore.calendar.daysPerYear * MINUTES_PER_DAY },
    ...(actions && { actions }),
    ...(opts.saves && { saves: opts.saves }),
    ...opts.sessionPorts,
  });
  const campaigns = CAMPAIGNS.filter((c) => adventures.has(c.adventure));
  let queue: Promise<void> = Promise.resolve();
  const run = async (cmd: ClientCommand, seat: SeatId): Promise<void> => {
    // A campaign names an installed first chapter; otherwise the game would start and then fail to find it.
    if (cmd.type === 'new_game' && cmd.campaign !== undefined && !adventures.has(cmd.campaign)) {
      session.emit({ type: 'error', message: session.msgs.m('session.noCampaign', { id: cmd.campaign }), ...(cmd.reqId && { reqId: cmd.reqId }) });
      return;
    }
    // Only campaigns written for it start in an imported world (the Seven Teeth would re-read its own finished arc.main.* flags).
    if (cmd.type === 'new_game' && cmd.worldFrom !== undefined && campaignFor(cmd.campaign)?.importsWorld === false) {
      session.emit({ type: 'error', message: session.msgs.m('session.noWorldImport'), ...(cmd.reqId && { reqId: cmd.reqId }) });
      return;
    }
    await session.handle(cmd, seat);
  };
  const send = (cmd: ClientCommand, seat: SeatId = HOST_SEAT): Promise<void> => (queue = queue.then(() => run(cmd, seat)));
  return {
    session,
    defaultAdventure,
    campaigns,
    send,
    receive(raw, seat) {
      const parsed = parseCommand(raw);
      if (!parsed.ok) return { type: 'error', message: parsed.error, ...(parsed.reqId && { reqId: parsed.reqId }) };
      void send(parsed.command, seat);
      return undefined;
    },
    setSeatAway: (seat, away) => (queue = queue.then(() => session.setSeatAway(seat, away))),
    on: (listener) => session.on(listener),
    async idle() {
      await queue;
      for (const p of ports.values()) await p.idle();
    },
  };
}
