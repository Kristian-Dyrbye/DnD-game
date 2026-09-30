/**
 * Side-quest availability (spec §7.4): quests are offered from quest boards and taverns (lore
 * location tags), faction contacts (a faction present here that thinks well of the hero) and
 * travel events. Offers are generated with generateValidSideQuest (seeded per location and day),
 * last a few days, and one can be active at a time. Accepting one suspends the main adventure's
 * progress; when the side quest ends, the main adventure resumes where it was. Side quests write
 * back to world flags through their own outcomes (A108).
 */
import { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import { ENGLISH_MESSAGES, type Messages } from '../i18n';
import type { GameState } from '../session/gameState';
import { MINUTES_PER_DAY } from '../world/clock';
import { getReputation, tierAtLeast } from '../world/factions';
import type { FlagRegistry } from '../world/flags';
import type { Lore } from '../world/lore';
import type { AdventureProgress } from './runner';
import type { Adventure } from './schema';
import { generateValidSideQuest } from './sidequestCheck';
import type { SideQuestTables } from './sidequestTables';

export type OfferSource = 'board' | 'tavern' | 'contact' | 'road';

export interface SideQuestOffer {
  id: string;
  source: OfferSource;
  /** Who/where offers it ("the quest board", "a Lantern Wardens contact"). */
  sourceLabel: string;
  locationId: string;
  offeredAt: number;
  expiresAt: number;
  adventure: Adventure;
  threadId?: string;
}

export interface SideQuestState {
  offers: SideQuestOffer[];
  /** Location + day keys already checked, so boards don't refill on every visit. */
  checked: string[];
  active?: { adventure: Adventure; source: OfferSource; suspended: AdventureProgress | undefined; suspendedLocation: GameState['location'] };
  completed: { id: string; name: string; ending: string; at: number }[];
}

export interface SideQuestDeps {
  tables: SideQuestTables;
  lore: Lore;
  db: SrdDatabase;
  flags?: FlagRegistry;
}

export const OFFER_DAYS = 3;

export function sideQuestState(state: GameState): SideQuestState {
  const s = state.extensions.sideQuests as SideQuestState | undefined;
  if (s) return s;
  const fresh: SideQuestState = { offers: [], checked: [], completed: [] };
  state.extensions.sideQuests = fresh;
  return fresh;
}

/** Where quests can be offered at a location right now. */
export function offerSources(state: GameState, deps: SideQuestDeps, locationId: string, { m }: Messages = ENGLISH_MESSAGES): { source: OfferSource; label: string }[] {
  const loc = deps.lore.locations.find((l) => l.id === locationId);
  if (!loc) return [];
  const out: { source: OfferSource; label: string }[] = [];
  if (loc.tags.includes('quest_board')) out.push({ source: 'board', label: m('job.source.board') });
  if (loc.tags.includes('tavern')) out.push({ source: 'tavern', label: m('job.source.tavern') });
  for (const fid of loc.factionIds) {
    const f = deps.lore.factions.find((x) => x.id === fid);
    if (f && tierAtLeast(getReputation(state, fid, deps.lore), 'friendly')) out.push({ source: 'contact', label: m('job.source.contact', { faction: f.name.replace(/^The /, 'the ') }) });
  }
  return out;
}

function makeOffer(state: GameState, deps: SideQuestDeps, locationId: string, source: OfferSource, label: string, seed: string): SideQuestOffer | undefined {
  const res = generateValidSideQuest({ ...deps, state, locationId, rng: Rng.fromSeed(seed), ...(deps.flags && { flags: deps.flags }) });
  if (!res) return undefined;
  return {
    id: res.adventure.id,
    source,
    sourceLabel: label,
    locationId,
    offeredAt: state.time,
    expiresAt: state.time + OFFER_DAYS * MINUTES_PER_DAY,
    adventure: res.adventure,
    ...(res.threadId && { threadId: res.threadId }),
  };
}

/**
 * Checks the local sources once per location per day and adds up to one offer per source.
 * Returns the new offers. Expired offers are dropped.
 */
export function refreshOffers(state: GameState, deps: SideQuestDeps, locationId: string, msgs: Messages = ENGLISH_MESSAGES): SideQuestOffer[] {
  const sq = sideQuestState(state);
  sq.offers = sq.offers.filter((o) => o.expiresAt > state.time);
  const day = Math.floor(state.time / MINUTES_PER_DAY);
  const key = `${locationId}:${day}`;
  if (sq.checked.includes(key)) return [];
  sq.checked = [...sq.checked.slice(-40), key];
  const added: SideQuestOffer[] = [];
  for (const src of offerSources(state, deps, locationId, msgs)) {
    if (sq.offers.some((o) => o.locationId === locationId && o.source === src.source)) continue;
    const offer = makeOffer(state, deps, locationId, src.source, src.label, `${state.campaignId}:sq:${key}:${src.source}`);
    if (offer && !sq.offers.some((o) => o.threadId && o.threadId === offer.threadId)) {
      sq.offers.push(offer);
      added.push(offer);
    }
  }
  return added;
}

/** A stranger met on the road asks for help at the destination (travel "discovery" events). */
export function roadOffer(state: GameState, deps: SideQuestDeps, locationId: string, { m }: Messages = ENGLISH_MESSAGES): SideQuestOffer | undefined {
  const sq = sideQuestState(state);
  const offer = makeOffer(state, deps, locationId, 'road', m('job.source.road'), `${state.campaignId}:sq:road:${state.time}`);
  if (offer) sq.offers.push(offer);
  return offer;
}

export function offersAt(state: GameState, locationId: string): SideQuestOffer[] {
  const sq = sideQuestState(state);
  return sq.offers.filter((o) => o.locationId === locationId && o.expiresAt > state.time);
}

/** Accepts an offer: the main adventure's progress is suspended and the side quest starts. */
export function acceptOffer(state: GameState, offerId: string, { m }: Messages = ENGLISH_MESSAGES): Adventure {
  const sq = sideQuestState(state);
  if (sq.active) throw new Error(m('job.busy'));
  const offer = sq.offers.find((o) => o.id === offerId);
  if (!offer) throw new Error(m('job.gone'));
  sq.offers = sq.offers.filter((o) => o.id !== offerId);
  sq.active = { adventure: offer.adventure, source: offer.source, suspended: state.extensions.adventure as AdventureProgress | undefined, suspendedLocation: state.location };
  delete state.extensions.adventure;
  return offer.adventure;
}

/** Ends the active side quest (after its ending) and resumes the suspended adventure. */
export function finishActive(state: GameState): { name: string; ending: string } | undefined {
  const sq = sideQuestState(state);
  const active = sq.active;
  const p = state.extensions.adventure as AdventureProgress | undefined;
  if (!active || !p?.ending) return undefined;
  sq.completed.push({ id: active.adventure.id, name: active.adventure.name, ending: p.ending, at: state.time });
  if (active.suspended) state.extensions.adventure = active.suspended;
  else delete state.extensions.adventure;
  state.location = active.suspendedLocation;
  delete sq.active;
  return { name: active.adventure.name, ending: p.ending };
}

/** The generated adventure behind an id, if it is the active side quest. */
export function activeSideQuest(state: GameState, adventureId: string): Adventure | undefined {
  const a = (state.extensions.sideQuests as SideQuestState | undefined)?.active?.adventure;
  return a?.id === adventureId ? a : undefined;
}
