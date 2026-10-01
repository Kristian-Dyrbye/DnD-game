/** C006b: table panel + join screen helpers. */
import { describe, expect, it, vi } from 'vitest';
import type { Character } from '../../engine/core/creature';
import type { Seat } from '../../engine/session/table';
import { afterJoin, controlOptions, doorState, fetchTable, lendable, seatHasCharacter } from './tableInfo';

const seats: Seat[] = [
  { id: 'host', role: 'host' },
  { id: 'guest-1', role: 'player', name: 'Kim' },
  { id: 'guest-2', role: 'spectator', name: 'Ada' },
  { id: 'guest-3', role: 'player', away: true },
];

describe('table panel helpers (C006b)', () => {
  it('reads the door: closed, needs a restart, open with links, or no network', () => {
    expect(doorState({ allowJoin: false, lan: true, urls: ['http://x/?join=A'] })).toBe('closed');
    expect(doorState({ allowJoin: true, lan: false, urls: [] })).toBe('restart');
    expect(doorState({ allowJoin: true, lan: true, urls: ['http://192.168.1.2:3210/?join=ABC234'] })).toBe('open');
    expect(doorState({ allowJoin: true, lan: true, urls: [] })).toBe('noNetwork');
  });

  it('offers AI, the host and every seated player (not spectators) for a companion', () => {
    expect(controlOptions(seats).map((o) => o.value)).toEqual(['ai', 'player', 'seat:guest-1', 'seat:guest-3']);
    expect(controlOptions([{ id: 'host', role: 'host' }]).map((o) => o.value)).toEqual(['ai', 'player']);
  });

  it('lends roster companions only, never a player-made hero', () => {
    const c = (id: string) => ({ id, name: id }) as Character;
    expect(lendable([c('corwin'), c('hero-2'), c('nettle')], { 'hero-2': 'hero', corwin: 'companion' }).map((x) => x.id)).toEqual(['corwin', 'nettle']);
  });

  it('fetches GET /api/table and fails on a refusal', async () => {
    const body = { allowJoin: true, lan: true, code: 'ABC234', urls: [], seats, policy: 'host_decides' };
    const ok = vi.fn(async () => new Response(JSON.stringify(body)));
    expect(await fetchTable(ok as unknown as typeof fetch)).toEqual(body);
    expect(ok).toHaveBeenCalledWith('/api/table');
    const refused = async () => new Response('{}', { status: 403 });
    await expect(fetchTable(refused as unknown as typeof fetch)).rejects.toThrow('403');
  });
});

describe('join screen routing (C006b)', () => {
  it('a new player builds a hero; a spectator or a returning player goes to the game', () => {
    expect(afterJoin('player', {}, 'guest-1')).toBe('creator');
    expect(afterJoin('player', undefined, 'guest-1')).toBe('creator');
    expect(afterJoin('spectator', {}, 'guest-2')).toBe('game');
    const control = { 'hero-2': 'seat:guest-1', corwin: 'ai' };
    expect(seatHasCharacter(control, 'guest-1')).toBe(true);
    expect(afterJoin('player', control, 'guest-1')).toBe('game');
    expect(afterJoin('player', control, 'guest-11')).toBe('creator');
  });
});
