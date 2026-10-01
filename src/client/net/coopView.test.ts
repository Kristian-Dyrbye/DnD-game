/** C006c: co-op view rules (story buttons, party panel, battle map seats, proposals, actor chooser). */
import { describe, expect, it } from 'vitest';
import type { Encounter } from '../../engine/combat/encounter';
import type { ProposalEvent } from '../../shared/protocol';
import { bestActor, buttonCommand, mayAddHero, pageSeat, partyRights, playsCreature, proposalCommand, proposalText, seatId, shownCreature, storyMode, viewedHero } from './coopView';

const host = pageSeat(false, null);
const kim = pageSeat(true, { seat: 'guest-1', role: 'player' });
const ada = pageSeat(true, { seat: 'guest-2', role: 'spectator' });

describe('co-op view rules (C006c)', () => {
  it('knows the page seat: host pages, guest players, spectators, and guests not seated yet', () => {
    expect(host).toEqual({ role: 'host' });
    expect(seatId(host)).toBe('host');
    expect(seatId(kim)).toBe('guest-1');
    expect(pageSeat(true, null)).toEqual({ role: 'spectator', seat: '' });
  });

  it('turns guest buttons into suggestions under host_decides, spectators always', () => {
    expect(storyMode(host, 'host_decides')).toBe('act');
    expect(storyMode(kim, 'host_decides')).toBe('suggest');
    expect(storyMode(kim, undefined)).toBe('suggest');
    expect(storyMode(kim, 'anyone')).toBe('act');
    expect(storyMode(ada, 'anyone')).toBe('suggest');
  });

  it("shows a guest player their own hero, everyone else the main hero (C008b)", () => {
    const main = { id: 'hero' };
    const wren = { id: 'hero-2' };
    const corwin = { id: 'corwin' };
    const party = [corwin, wren];
    const control = { corwin: 'ai', 'hero-2': 'seat:guest-1' };
    expect(viewedHero(kim, main, party, control)).toBe(wren);
    expect(viewedHero(host, main, party, control)).toBe(main);
    expect(viewedHero(ada, main, party, control)).toBe(main);
    expect(viewedHero(pageSeat(true, { seat: 'guest-3', role: 'player' }), main, party, control)).toBe(main);
    expect(viewedHero(kim, main, party, undefined)).toBe(main);
  });

  it('gives the party panel controls to the right seat', () => {
    expect(partyRights(host, undefined, true)).toEqual({ levelUp: true, toggle: false });
    expect(partyRights(host, 'player', false)).toEqual({ levelUp: true, toggle: true });
    expect(partyRights(host, 'seat:guest-1', false)).toEqual({ levelUp: false, toggle: false });
    expect(partyRights(kim, undefined, true)).toEqual({ levelUp: false, toggle: false });
    expect(partyRights(kim, 'seat:guest-1', false)).toEqual({ levelUp: true, toggle: false });
    expect(partyRights(kim, 'ai', false)).toEqual({ levelUp: false, toggle: false });
    expect(partyRights(ada, 'seat:guest-2', false)).toEqual({ levelUp: false, toggle: false });
  });

  it('lets the host add heroes, a guest player one, a spectator none', () => {
    expect(mayAddHero(host, { 'hero-2': 'player' })).toBe(true);
    expect(mayAddHero(kim, { corwin: 'ai' })).toBe(true);
    expect(mayAddHero(kim, { 'hero-2': 'seat:guest-1' })).toBe(false);
    expect(mayAddHero(ada, {})).toBe(false);
  });

  it('enables battle actions only on this seat creatures turns', () => {
    const enc = { heroId: 'hero', controlled: ['hero', 'hero-2', 'corwin'], seats: { hero: 'host', 'hero-2': 'guest-1', corwin: 'host' } } as unknown as Encounter;
    expect(playsCreature(enc, 'hero', 'host')).toBe(true);
    expect(playsCreature(enc, 'hero-2', 'host')).toBe(false);
    expect(playsCreature(enc, 'hero-2', 'guest-1')).toBe(true);
    expect(playsCreature(enc, 'goblin-1', 'host')).toBe(false);
    expect(playsCreature(enc, 'hero', 'guest-2')).toBe(false);
    // Up now: the guest's hero → the guest sees it; the host still sees their own hero.
    expect(shownCreature(enc, 'hero-2', 'guest-1')).toBe('hero-2');
    expect(shownCreature(enc, 'hero-2', 'host')).toBe('hero');
    expect(shownCreature(enc, 'corwin', 'host')).toBe('corwin');
    expect(shownCreature(enc, 'goblin-1', 'guest-1')).toBe('hero-2');
    expect(shownCreature(enc, 'goblin-1', 'guest-2')).toBe('hero');
    // Solo fights have no seat map: everything controlled is the host's.
    const solo = { heroId: 'hero', controlled: ['hero', 'nettle'] } as unknown as Encounter;
    expect(playsCreature(solo, 'nettle', 'host')).toBe(true);
    expect(playsCreature(solo, 'nettle', 'guest-1')).toBe(false);
  });

  it('pre-selects the best bonus, keeping the default on ties', () => {
    expect(bestActor([{ id: 'hero', name: 'Mira', bonus: 3 }, { id: 'hero-2', name: 'Wren', bonus: 5 }])).toBe('hero-2');
    expect(bestActor([{ id: 'hero', name: 'Mira', bonus: 4 }, { id: 'hero-2', name: 'Wren', bonus: 4 }])).toBe('hero');
    expect(bestActor([{ id: 'hero', name: 'Mira' }, { id: 'hero-2', name: 'Wren' }])).toBe('hero');
  });

  it('builds button commands with the picked actor (only a listed one)', () => {
    const check = { id: 'gate.pick', label: 'Pick the lock', actors: [{ id: 'hero', name: 'Mira' }, { id: 'hero-2', name: 'Wren' }] };
    expect(buttonCommand(check, 'hero-2')).toEqual({ type: 'choose', actionId: 'gate.pick', actor: 'hero-2' });
    expect(buttonCommand(check, 'goblin')).toEqual({ type: 'choose', actionId: 'gate.pick' });
    expect(buttonCommand({ id: 'look', label: 'Look around' })).toEqual({ type: 'choose', actionId: 'look' });
    expect(buttonCommand({ id: 'idea-1', label: 'Ask about rats', say: 'Ask about rats' })).toEqual({ type: 'say', text: 'Ask about rats' });
  });

  it('turns a proposal back into the guest command and a label', () => {
    const base: ProposalEvent = { type: 'proposal', id: 7, seat: 'guest-1', name: 'Kim', command: 'choose' };
    expect(proposalCommand({ ...base, actionId: 'gate.pick', label: 'Pick the lock', actor: 'hero-2' })).toEqual({ type: 'choose', actionId: 'gate.pick', actor: 'hero-2' });
    expect(proposalText({ ...base, actionId: 'gate.pick', label: 'Pick the lock' })).toBe('Pick the lock');
    expect(proposalText({ ...base, actionId: 'gate.pick' })).toBe('gate.pick');
    expect(proposalCommand({ ...base, command: 'say', text: 'We sneak in' })).toEqual({ type: 'say', text: 'We sneak in' });
    expect(proposalText({ ...base, command: 'say', text: 'We sneak in' })).toBe('We sneak in');
    expect(proposalCommand({ ...base, command: 'say' })).toBeUndefined();
    expect(proposalCommand(base)).toBeUndefined();
  });
});
