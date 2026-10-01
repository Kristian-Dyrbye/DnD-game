import { describe, expect, it } from 'vitest';
import { formatBits, qrMatrix, qrPath, rsEcc } from './qr';

/** Level M block layout per version (as the spec tables; the decoder below must not reuse the encoder's). */
const LAYOUT: Record<number, { data: number; ec: number; blocks: number }> = {
  1: { data: 16, ec: 10, blocks: 1 },
  2: { data: 28, ec: 16, blocks: 1 },
  3: { data: 44, ec: 26, blocks: 1 },
  4: { data: 64, ec: 18, blocks: 2 },
  5: { data: 86, ec: 24, blocks: 2 },
  6: { data: 108, ec: 16, blocks: 4 },
};

/** A small independent reader: format → unmask → zigzag read → de-interleave → RS check → byte-mode text. */
function decode(m: boolean[][]): string {
  const size = m.length;
  const version = (size - 17) / 4;
  let fmt = 0;
  const firstCopy: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  firstCopy.forEach(([x, y], i) => (fmt |= (m[y]![x] ? 1 : 0) << i));
  const info = (fmt ^ 0x5412) >> 10;
  expect(info >> 3).toBe(0); // level M
  const mask = info & 7;
  const isFunction = (x: number, y: number) =>
    x === 6 || y === 6 || (x <= 8 && y <= 8) || (x >= size - 8 && y <= 8) || (x <= 8 && y >= size - 8) || (version >= 2 && Math.abs(x - (size - 7)) <= 2 && Math.abs(y - (size - 7)) <= 2);
  const flip = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask]!;
  const bits: number[] = [];
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const x of [col, col - 1]) if (!isFunction(x, y)) bits.push((m[y]![x] !== flip(x, y)) ? 1 : 0);
    }
    up = !up;
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  const lay = LAYOUT[version]!;
  const per = lay.data / lay.blocks;
  const blocks = Array.from({ length: lay.blocks }, (_, b) => Array.from({ length: per }, (_, i) => bytes[i * lay.blocks + b]!));
  const eccs = Array.from({ length: lay.blocks }, (_, b) => Array.from({ length: lay.ec }, (_, i) => bytes[lay.data + i * lay.blocks + b]!));
  blocks.forEach((blk, b) => expect(rsEcc(blk, lay.ec)).toEqual(eccs[b]));
  const data = blocks.flat();
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  const read = (from: number, len: number) => stream.slice(from, from + len).reduce((a, b) => a * 2 + b, 0);
  expect(read(0, 4)).toBe(0b0100);
  const len = read(4, 8);
  return new TextDecoder().decode(new Uint8Array(Array.from({ length: len }, (_, i) => read(12 + i * 8, 8))));
}

describe('QR encoder (C006b)', () => {
  it('computes Reed–Solomon codewords (the classic HELLO WORLD 1-M example)', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEcc(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('computes the format bits from the spec table', () => {
    expect(formatBits(0).toString(2).padStart(15, '0')).toBe('101010000010010');
    expect(formatBits(5).toString(2).padStart(15, '0')).toBe('100000011001110');
    expect(formatBits(7).toString(2).padStart(15, '0')).toBe('100101010100000');
  });

  it('draws finder patterns in three corners', () => {
    const m = qrMatrix('hi');
    expect(m).toHaveLength(21);
    for (const [ox, oy] of [[0, 0], [14, 0], [0, 14]] as const) {
      expect(m[oy]![ox]).toBe(true);
      expect(m[oy + 1]![ox + 1]).toBe(false);
      expect(m[oy + 3]![ox + 3]).toBe(true);
    }
  });

  it.each([
    'hi',
    'http://192.168.1.20:3210/?join=ABC234',
    'http://192.168.178.123:3210/?join=XY7Q2M&player=Kim',
    'x'.repeat(80),
    'æøå '.repeat(10),
  ])('round-trips %s through an independent reader', (text) => {
    expect(decode(qrMatrix(text))).toBe(text);
  });

  it('refuses text that does not fit version 6', () => {
    expect(() => qrMatrix('x'.repeat(200))).toThrow();
  });

  it('builds SVG path data with a quiet zone', () => {
    const d = qrPath(qrMatrix('hi'));
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
