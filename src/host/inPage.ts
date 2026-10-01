/**
 * The web edition's host: the whole game running inside the browser page with bundled content and
 * no AI (template narration, keyword intents, data buttons). Loaded lazily by the InPage transport.
 */
import { loadSrd } from '../engine/data/srdBundle';
import type { SavePort, SessionPorts } from '../engine/session/GameSession';
import { BUNDLED_TRANSLATIONS, bundledFlagRegistry, loadBundledAdventures } from './bundled';
import { createGameHost, worldTables, type GameHost } from './gameHost';
import { MemorySaves } from './memorySaves';

export interface InPageHostOptions {
  /** Save storage; defaults to in-memory slots (lost on reload). */
  saves?: SavePort;
  sessionPorts?: Partial<SessionPorts>;
  /** The join code guests on peer channels must give (C009); undefined = the table is closed. */
  joinCode?: () => string | undefined;
}

export function createInPageHost(opts: InPageHostOptions = {}): GameHost {
  const srd = loadSrd();
  const tables = worldTables();
  const flags = bundledFlagRegistry();
  const { adventures, problems } = loadBundledAdventures(srd, flags, tables.companions);
  for (const p of problems) console.warn(`Skipping invalid adventure ${p.file}: ${p.errors.join('; ')}`);
  return createGameHost({
    srd,
    adventures,
    flags,
    tables,
    translations: BUNDLED_TRANSLATIONS,
    saves: opts.saves ?? new MemorySaves(),
    ...(opts.sessionPorts && { sessionPorts: opts.sessionPorts }),
    ...(opts.joinCode && { joinCode: opts.joinCode }),
  });
}
