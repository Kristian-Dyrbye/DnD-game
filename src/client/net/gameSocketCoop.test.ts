/** C006: the client keeps proposals for the host and a guest's seat token. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProposalEvent } from '../../shared/protocol';
import { applyEvent, dismissProposal, joinCode, mySeat, proposals, setSeatStore } from './gameSocket';
import { seatToken, type SeatStore } from './guest';

const data = new Map<string, string>();
const store: SeatStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
const proposal = (id: number): ProposalEvent => ({ type: 'proposal', id, seat: 'guest-1', name: 'Kim', command: 'say', text: `idea ${id}` });

beforeEach(() => {
  data.clear();
  setSeatStore(store);
  proposals.value = [];
  mySeat.value = null;
  joinCode.value = null;
});

describe('proposals on the client (C006)', () => {
  it('collects the newest five, dismisses one, and clears when the story moves on', () => {
    for (let i = 1; i <= 7; i++) applyEvent(proposal(i));
    expect(proposals.value.map((p) => p.id)).toEqual([3, 4, 5, 6, 7]);
    dismissProposal(5);
    expect(proposals.value.map((p) => p.id)).toEqual([3, 4, 6, 7]);
    applyEvent({ type: 'ack', command: 'save' });
    expect(proposals.value).toHaveLength(4);
    applyEvent({ type: 'ack', command: 'choose' });
    expect(proposals.value).toEqual([]);
  });
});

describe('guest seat token (C006)', () => {
  it('stores the token from `joined` and forgets it when the seat is gone', () => {
    joinCode.value = 'AB3K9X';
    applyEvent({ type: 'joined', seat: 'guest-1', role: 'player', token: 'tok-1' });
    expect(seatToken(store, 'AB3K9X')).toBe('tok-1');
    applyEvent({ type: 'table', seats: [{ id: 'host', role: 'host' }, { id: 'guest-1', role: 'player' }], policy: 'host_decides' });
    expect(mySeat.value?.seat).toBe('guest-1');
    applyEvent({ type: 'table', seats: [{ id: 'host', role: 'host' }], policy: 'host_decides' });
    expect(mySeat.value).toBeNull();
    expect(seatToken(store, 'AB3K9X')).toBeUndefined();
  });

  it('the host’s own page stores nothing', () => {
    applyEvent({ type: 'joined', seat: 'guest-1', role: 'player', token: 'tok-1' });
    expect(data.size).toBe(0);
  });
});
