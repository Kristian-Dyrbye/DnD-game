/** C006: the guest page's join code, seat token storage and first commands. */
import { describe, expect, it } from 'vitest';
import { forgetSeat, joinCodeFrom, openCommands, rememberSeat, seatName, seatToken, type SeatStore } from './guest';

function memoryStore(): SeatStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('guest page (C006)', () => {
  it('reads the join code from the query string', () => {
    expect(joinCodeFrom('?join=ab3k9x')).toBe('AB3K9X');
    expect(joinCodeFrom('?x=1&join=%20QRS234%20')).toBe('QRS234');
    expect(joinCodeFrom('')).toBeNull();
    expect(joinCodeFrom('?join=')).toBeNull();
    expect(joinCodeFrom('?join=<script>')).toBeNull();
  });

  it('keeps one seat token per table code, and forgets it', () => {
    const store = memoryStore();
    expect(seatToken(store, 'AB3K9X')).toBeUndefined();
    rememberSeat(store, 'AB3K9X', 'tok-1', 'Kim');
    expect(seatToken(store, 'AB3K9X')).toBe('tok-1');
    expect(seatToken(store, 'ZZZZZZ')).toBeUndefined();
    expect(seatName(store)).toBe('Kim');
    forgetSeat(store);
    expect(seatToken(store, 'AB3K9X')).toBeUndefined();
  });

  it('survives broken or missing storage', () => {
    const store = memoryStore();
    store.data.set('solo-dnd.seat', '{not json');
    expect(seatToken(store, 'AB3K9X')).toBeUndefined();
    const throwing: SeatStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => rememberSeat(throwing, 'AB3K9X', 't')).not.toThrow();
    expect(seatToken(throwing, 'AB3K9X')).toBeUndefined();
    expect(() => forgetSeat(undefined)).not.toThrow();
  });

  it('a guest joins on open (with its token and name), never sets the language', () => {
    const store = memoryStore();
    expect(openCommands({ code: 'AB3K9X', store, language: 'da', hasState: true })).toEqual([{ type: 'join', code: 'AB3K9X' }]);
    rememberSeat(store, 'AB3K9X', 'tok-1', 'Kim');
    expect(openCommands({ code: 'AB3K9X', store, role: 'spectator', language: 'da', hasState: true })).toEqual([{ type: 'join', code: 'AB3K9X', role: 'spectator', name: 'Kim', token: 'tok-1' }]);
    expect(openCommands({ code: 'AB3K9X', store, name: 'Sam', language: 'en', hasState: false })[0]).toMatchObject({ name: 'Sam' });
  });

  it('the host sets its language and asks for the state after a reconnect', () => {
    expect(openCommands({ code: null, language: 'da', hasState: false })).toEqual([{ type: 'set_language', language: 'da' }]);
    expect(openCommands({ code: null, language: 'en', hasState: true })).toEqual([{ type: 'set_language', language: 'en' }, { type: 'get_state' }]);
  });
});
