/**
 * Seeded, serializable pseudo-random number generator (sfc32). All game randomness goes
 * through an Rng so that tests and replays are deterministic and the state can be saved.
 */

/** Four unsigned 32-bit integers. Stored in saves. */
export type RngState = [number, number, number, number];

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state.map((n) => n >>> 0) as RngState;
  }

  /** Creates an Rng from a number or string seed. Same seed → same sequence. */
  static fromSeed(seed: number | string): Rng {
    const h = hashSeed(String(seed));
    const rng = new Rng(h);
    // Warm up so similar seeds diverge.
    for (let i = 0; i < 15; i++) rng.nextUint32();
    return rng;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Bad int range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() from empty array');
    return items[this.int(0, items.length - 1)]!;
  }

  /** Shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Normalised to unsigned 32-bit so equal generators always compare (and save) equal. */
  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(state: RngState): void {
    [this.a, this.b, this.c, this.d] = state.map((n) => n >>> 0) as RngState;
  }

  private nextUint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const result = (t + this.d) | 0;
    this.c = (this.c + result) | 0;
    return result >>> 0;
  }
}

/** cyrb128 string hash → 4×32-bit seed. */
function hashSeed(str: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
