import { describe, expect, it } from 'vitest';
import { JOIN_CODE_ALPHABET, newJoinCode, sameCode, SeatTokens } from './joinDesk';

describe('join codes and seat tokens (C005)', () => {
  it('codes are 6 characters from an alphabet without look-alikes, and differ between calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => newJoinCode()));
    for (const c of codes) expect(c).toMatch(new RegExp(`^[${JOIN_CODE_ALPHABET}]{6}$`));
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(codes.size).toBeGreaterThan(45);
  });

  it('typed codes match without case or spaces', () => {
    expect(sameCode(' abc234 ', 'ABC234')).toBe(true);
    expect(sameCode('ABC235', 'ABC234')).toBe(false);
  });

  it('a seat has one live token: a new one replaces the old, forget drops it', () => {
    const tokens = new SeatTokens();
    const first = tokens.issue('guest-1');
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(tokens.seatOf(first)).toBe('guest-1');
    const second = tokens.issue('guest-1');
    expect(tokens.seatOf(first)).toBeUndefined();
    expect(tokens.seatOf(second)).toBe('guest-1');
    expect(tokens.seatOf(undefined)).toBeUndefined();
    tokens.forget('guest-1');
    expect(tokens.seatOf(second)).toBeUndefined();
  });
});
