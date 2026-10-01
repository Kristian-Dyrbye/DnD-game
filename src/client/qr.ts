/**
 * Minimal QR code encoder (C006b) for the host's join link, so a friend can scan it with a phone camera.
 * Byte mode, error correction level M, versions 1–6 (up to 106 bytes; a LAN join URL is ~40). No
 * dependency: returns a square matrix of dark modules (true) that the table panel draws as SVG.
 */

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);

/** Reed–Solomon error correction codewords for one block of data codewords. Exported for tests. */
export function rsEcc(data: readonly number[], n: number): number[] {
  // Generator polynomial ∏ (x − α^i), i < n; highest coefficient first.
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((g, j) => {
      next[j]! ^= g;
      next[j + 1]! ^= mul(g, EXP[i]!);
    });
    gen = next;
  }
  const rem = new Array<number>(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift()!;
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j]! ^= mul(gen[j + 1]!, factor);
  }
  return rem;
}

/** Level M per version 1–6: total codewords, EC codewords per block, number of (equal) blocks. */
const VERSIONS: readonly { total: number; ec: number; blocks: number }[] = [
  { total: 26, ec: 10, blocks: 1 },
  { total: 44, ec: 16, blocks: 1 },
  { total: 70, ec: 26, blocks: 1 },
  { total: 100, ec: 18, blocks: 2 },
  { total: 134, ec: 24, blocks: 2 },
  { total: 172, ec: 16, blocks: 4 },
];

/** The 15 format bits for level M and a mask (BCH code, XOR mask 0x5412). Exported for tests. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Data + EC codewords in transmission order for `bytes` at `version` (1-based). */
function codewords(bytes: Uint8Array, version: number): number[] {
  const v = VERSIONS[version - 1]!;
  const dataLen = v.total - v.ec * v.blocks;
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);
  const per = dataLen / v.blocks;
  const blocks = Array.from({ length: v.blocks }, (_, i) => data.slice(i * per, (i + 1) * per));
  const eccs = blocks.map((b) => rsEcc(b, v.ec));
  const out: number[] = [];
  for (let i = 0; i < per; i++) for (const b of blocks) out.push(b[i]!);
  for (let i = 0; i < v.ec; i++) for (const e of eccs) out.push(e[i]!);
  return out;
}

/** Penalty score of a finished matrix (ISO 18004 rules 1–4); the encoder keeps the lowest-scoring mask. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i]!);
    lines.push(m.map((row) => row[i]!));
  }
  const finderLike = /10111010000|00001011101/g;
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    score += (line.map((b) => (b ? '1' : '0')).join('').match(finderLike)?.length ?? 0) * 40;
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y]![x]) dark++;
      if (y + 1 < size && x + 1 < size) {
        const c = m[y]![x];
        if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) score += 3;
      }
    }
  }
  return score + Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
}

/** Encodes `text` (UTF-8) as a QR code: rows of modules, true = dark. Throws if it is too long for version 6. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = VERSIONS.findIndex((v) => (v.total - v.ec * v.blocks) * 8 >= 12 + bytes.length * 8) + 1;
  if (version === 0) throw new Error('Text too long for a QR code');
  const size = 17 + 4 * version;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    m[y]![x] = dark;
    fn[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // the dark module
  };
  drawFormat(0); // reserves the format areas before the data goes in

  const data = codewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (fn[y]![x]) continue;
        // Bits past the end (remainder bits) stay light.
        if (i < data.length * 8) m[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && MASKS[mask]!(x, y)) m[y]![x] = !m[y]![x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const s = penalty(m);
    if (s < bestScore) [best, bestScore] = [mask, s];
    applyMask(mask); // XOR again = undo
  }
  applyMask(best);
  drawFormat(best);
  return m;
}

/** SVG path data for the dark modules (one `h1v1h-1z` square each), offset by a 4-module quiet zone. */
export function qrPath(m: boolean[][], quiet = 4): string {
  let d = '';
  m.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x + quiet} ${y + quiet}h1v1h-1z`)));
  return d;
}
