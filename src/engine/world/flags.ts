/**
 * World flags (spec §7.2 "linked-campaign design"). Flags live in `state.flags` under namespaces:
 *   arc.<arcId>.<name>   state of one campaign arc (arc.starter.*, arc.main.*)
 *   world.<name>         facts any later arc may read (companions, outlaw status, ...)
 *   side.<questId>.<name> side quests;  adv.<adventureId>.<name> anything else (tests, demos)
 * Adventures may write `~name` as shorthand for their own namespace; it is resolved at load time,
 * so the runner and later arcs only ever see absolute ids. A FlagRegistry (data/adventures/
 * flags.json + each adventure's `flags` docs) supplies types, allowed values, bounds and defaults.
 */
import { z } from 'zod';

export type FlagValue = boolean | number | string;
export type Flags = Record<string, FlagValue>;

export const FLAG_NAMESPACES = ['arc', 'world', 'side', 'adv'] as const;

export const FlagDefSchema = z.object({
  id: z.string(),
  type: z.enum(['boolean', 'string', 'number']).default('boolean'),
  default: z.union([z.boolean(), z.number(), z.string()]).optional(),
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  description: z.string().default(''),
  setBy: z.array(z.string()).default([]),
  readBy: z.array(z.string()).default([]),
});
export type FlagDef = z.infer<typeof FlagDefSchema>;

/** Local namespace prefix for an adventure (arc → arc.<arcId>., side quest → side.<id>., else adv.<id>.). */
export function localNamespace(adv: { id: string; arcId?: string | undefined; kind?: string | undefined }): string {
  if (adv.arcId) return `arc.${adv.arcId}.`;
  if (adv.kind === 'side_quest') return `side.${adv.id}.`;
  return `adv.${adv.id}.`;
}

export function resolveFlagName(name: string, adv: Parameters<typeof localNamespace>[0]): string {
  return name.startsWith('~') ? `${localNamespace(adv)}${name.slice(1)}` : name;
}

export function isNamespaced(id: string): boolean {
  const ns = id.split('.')[0];
  return (FLAG_NAMESPACES as readonly string[]).includes(ns ?? '') && id.split('.').length >= 2;
}

/**
 * Returns a deep copy of an adventure-like object with every `~name` flag reference resolved:
 * condition `flag`, writes `set`/`inc`/`clear`, and `flags[].id` docs.
 */
export function resolveAdventureFlags<T extends { id: string; arcId?: string | undefined; kind?: string | undefined }>(adv: T): T {
  const fix = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => fix(x, key));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && (k === 'flag' || k === 'set' || k === 'inc' || k === 'clear' || (k === 'id' && key === 'flags'))) out[k] = resolveFlagName(x, adv);
        else out[k] = fix(x, k);
      }
      return out;
    }
    return v;
  };
  return fix(adv) as T;
}

export class FlagRegistry {
  private readonly defs = new Map<string, FlagDef>();

  static fromJson(json: unknown): FlagRegistry {
    const reg = new FlagRegistry();
    const list = (json as { flags?: unknown[] } | undefined)?.flags ?? [];
    for (const raw of list) reg.add(FlagDefSchema.parse(raw));
    return reg;
  }

  add(def: FlagDef): this {
    const existing = this.defs.get(def.id);
    // Registry entries win over adventure docs (which only carry a description).
    if (!existing || (existing.type === 'boolean' && existing.default === undefined && !existing.values)) this.defs.set(def.id, def);
    return this;
  }

  /** Adds an adventure's documented flags (boolean unless already known). */
  addDocs(docs: { id: string; description: string }[]): this {
    for (const d of docs) if (!this.defs.has(d.id)) this.defs.set(d.id, FlagDefSchema.parse({ id: d.id, description: d.description }));
    return this;
  }

  get(id: string): FlagDef | undefined {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get size(): number {
    return this.defs.size;
  }

  /** Default values for flags that declare one (conditions read these for unset flags). */
  defaults(): Flags {
    const out: Flags = {};
    for (const d of this.defs.values()) if (d.default !== undefined) out[d.id] = d.default;
    return out;
  }

  /** Why a write is invalid, or undefined if fine. Unknown flags are allowed (documented elsewhere). */
  checkValue(id: string, value: FlagValue): string | undefined {
    const d = this.defs.get(id);
    if (!d) return undefined;
    if (typeof value !== d.type) return `flag ${id} is ${d.type}, got ${typeof value}`;
    if (d.type === 'string' && d.values && !d.values.includes(value as string)) return `flag ${id} must be one of ${d.values.join(', ')}`;
    return undefined;
  }

  /** Clamps numbers to the declared bounds. */
  clamp(id: string, value: FlagValue): FlagValue {
    const d = this.defs.get(id);
    if (!d || typeof value !== 'number') return value;
    return Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, value));
  }
}

/** Reads a flag, falling back to the registry default. */
export function readFlag(flags: Flags, id: string, registry?: FlagRegistry): FlagValue | undefined {
  return flags[id] ?? registry?.get(id)?.default;
}
