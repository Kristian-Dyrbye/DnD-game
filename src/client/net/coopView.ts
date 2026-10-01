/**
 * Co-op view rules for the UI (C006c): what this page's seat may do with the story buttons, the party
 * panel and the battle map, how a proposal turns back into a command, and which hero the actor chooser
 * pre-selects. Pure (no DOM, no signals) so tests need no browser.
 */
import type { Encounter } from '../../engine/combat/encounter';
import type { TablePolicy } from '../../engine/session/table';
import type { ClientCommand, ProposalEvent, SuggestedAction } from '../../shared/protocol';

/** This page at the table: the host's own page, a guest player, or a spectator (`seat` = the guest's seat id). */
export type PageSeat = { role: 'host' } | { role: 'player' | 'spectator'; seat: string };

/** The page's seat: the host's pages are 'host'; a guest page counts as a spectator until it holds a seat. */
export function pageSeat(guest: boolean, mine: { seat: string; role: 'player' | 'spectator' } | null): PageSeat {
  if (!guest) return { role: 'host' };
  return mine ? { role: mine.role, seat: mine.seat } : { role: 'spectator', seat: '' };
}

/** Seat id used by encounters and controls ('host' for the host's page). */
export function seatId(p: PageSeat): string {
  return p.role === 'host' ? 'host' : p.seat;
}

/**
 * What the story buttons and the free-text box do for this seat: 'act' = the command runs,
 * 'suggest' = the session turns it into a proposal for the host (guests under host_decides, spectators always).
 */
export function storyMode(p: PageSeat, policy: TablePolicy | undefined): 'act' | 'suggest' {
  if (p.role === 'host') return 'act';
  if (p.role === 'spectator') return 'suggest';
  return (policy ?? 'host_decides') === 'anyone' ? 'act' : 'suggest';
}

/** What the party panel offers this seat for one character: level-up, the AI/player toggle. */
export function partyRights(p: PageSeat, control: string | undefined, isMainHero: boolean): { levelUp: boolean; toggle: boolean } {
  if (p.role === 'host') {
    const seated = !!control?.startsWith('seat:');
    return { levelUp: !seated, toggle: !isMainHero && !seated };
  }
  // A guest levels only their own hero; companions are lent by the host, so no toggles.
  return { levelUp: p.role === 'player' && control === `seat:${p.seat}`, toggle: false };
}

/** May this seat add a hero now? The host always (duo mode); a guest player once (one hero per seat). */
export function mayAddHero(p: PageSeat, control: Record<string, string> | undefined): boolean {
  if (p.role === 'host') return true;
  if (p.role === 'spectator') return false;
  return !Object.values(control ?? {}).includes(`seat:${p.seat}`);
}

/** Does this seat play creature `id` in the fight? Solo fights (no seat map) belong to the host. */
export function playsCreature(enc: Encounter, id: string, seat: string): boolean {
  const controlled = id === enc.heroId || (enc.controlled ?? []).includes(id);
  if (!controlled) return false;
  return (enc.seats?.[id] ?? 'host') === seat;
}

/** The creature the combat screen shows for this seat: the one up now if it is ours, else our first one (else the hero). */
export function shownCreature(enc: Encounter, upNow: string | undefined, seat: string): string {
  if (upNow && playsCreature(enc, upNow, seat)) return upNow;
  const ours = [enc.heroId, ...(enc.controlled ?? [])].find((id) => playsCreature(enc, id, seat));
  return ours ?? enc.heroId;
}

/** The actor the chooser pre-selects: the best bonus (ties → the listed default, which comes first). */
export function bestActor(actors: NonNullable<SuggestedAction['actors']>): string | undefined {
  let best = actors[0];
  for (const a of actors) if ((a.bonus ?? -Infinity) > (best?.bonus ?? -Infinity)) best = a;
  return best?.id;
}

/** The command a button sends (say for free-text ideas, choose with the picked actor otherwise). */
export function buttonCommand(a: SuggestedAction, actor?: string): ClientCommand {
  if (a.say) return { type: 'say', text: a.say };
  return { type: 'choose', actionId: a.id, ...(actor && a.actors?.some((x) => x.id === actor) && { actor }) };
}

/** What the host's click on a proposal sends: the same say/choose the guest asked for. */
export function proposalCommand(p: ProposalEvent): ClientCommand | undefined {
  if (p.command === 'say') return p.text ? { type: 'say', text: p.text.slice(0, 500) } : undefined;
  return p.actionId ? { type: 'choose', actionId: p.actionId, ...(p.actor && { actor: p.actor }) } : undefined;
}

/** The proposal's button text: the offered button's label, else the typed text, else the action id. */
export function proposalText(p: ProposalEvent): string {
  return p.label ?? p.text ?? p.actionId ?? '';
}
