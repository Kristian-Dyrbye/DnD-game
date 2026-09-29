/**
 * Adventure validator: schema + referential integrity (scene/NPC/encounter/loot/ending ids, SRD
 * monster and item ids) + reachability. Used by tests for authored content, by the side-quest
 * generator (reject and regenerate) and by a future editor/importer.
 */
import { checkDungeonMap } from '../world/dungeon';
import type { CompanionRoster } from '../party/companions';
import type { SrdDatabase } from '../data/srd';
import { FlagRegistry, isNamespaced, resolveAdventureFlags, type FlagValue } from '../world/flags';
import { AdventureSchema, type Action, type Adventure, type Outcome, type Scene } from './schema';

export interface ValidationResult {
  ok: boolean;
  adventure?: Adventure;
  errors: string[];
  /** Non-fatal problems (unreachable scenes, undocumented flags...). */
  warnings: string[];
}

export function validateAdventure(raw: unknown, db?: SrdDatabase, registry?: FlagRegistry, companions?: CompanionRoster): ValidationResult {
  const parsed = AdventureSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`), warnings: [] };
  }
  // `~name` flags → this adventure's namespace, so everything downstream sees absolute ids.
  const adv = resolveAdventureFlags(parsed.data);
  const errors: string[] = [];
  const warnings: string[] = [];

  const dupes = (what: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`Duplicate ${what} id "${id}"`);
      seen.add(id);
    }
    return seen;
  };
  const scenes = allScenes(adv);
  const sceneIds = dupes('scene', scenes.map((s) => s.id));
  dupes('chapter', adv.chapters.map((c) => c.id));
  const npcIds = dupes('npc', adv.npcs.map((n) => n.id));
  const encounterIds = dupes('encounter', adv.encounters.map((e) => e.id));
  const lootIds = dupes('loot table', adv.lootTables.map((l) => l.id));
  const endingIds = dupes('ending', adv.endings.map((e) => e.id));
  dupes('beat', adv.beats.map((b) => b.id));
  dupes('deadline', adv.deadlines.map((d) => d.id));
  dupes('quest', adv.quests.map((q) => q.id));
  for (const q of adv.quests) dupes(`objective in quest ${q.id}`, q.objectives.map((o) => o.id));

  const startChapter = adv.chapters.find((c) => c.id === adv.start.chapter);
  if (!startChapter) errors.push(`start.chapter "${adv.start.chapter}" does not exist`);
  else if (!startChapter.scenes.some((s) => s.id === adv.start.scene)) errors.push(`start.scene "${adv.start.scene}" is not in chapter "${startChapter.id}"`);
  for (const ch of adv.chapters) if (!ch.scenes.some((s) => s.id === ch.start)) errors.push(`chapter "${ch.id}" start scene "${ch.start}" is not in the chapter`);

  const item = (id: string, where: string) => {
    if (db && !db.item(id) && !db.magicItems.has(id)) errors.push(`${where}: unknown item "${id}"`);
  };
  const outcome = (o: Outcome | undefined, where: string) => {
    if (!o) return;
    if (o.goto && !sceneIds.has(o.goto)) errors.push(`${where}: goto unknown scene "${o.goto}"`);
    if (o.loot && !lootIds.has(o.loot)) errors.push(`${where}: unknown loot table "${o.loot}"`);
    if (o.encounter && !encounterIds.has(o.encounter)) errors.push(`${where}: unknown encounter "${o.encounter}"`);
    if (o.ending && !endingIds.has(o.ending)) errors.push(`${where}: unknown ending "${o.ending}"`);
    for (const it of o.items) item(it.itemId, where);
    if (companions) {
      const known = (id: string) => companions.companions.some((c) => c.id === id);
      if (o.recruit && !known(o.recruit)) errors.push(`${where}: recruit names unknown companion "${o.recruit}"`);
      for (const a of o.approval) if (!known(a.companion)) errors.push(`${where}: approval names unknown companion "${a.companion}"`);
      if (o.companionLeaves && !known(o.companionLeaves.id)) errors.push(`${where}: companionLeaves names unknown companion "${o.companionLeaves.id}"`);
    }
  };
  const action = (a: Action, where: string) => {
    if (!a.check && !a.outcome) warnings.push(`${where}: action "${a.id}" has no check or outcome`);
    outcome(a.outcome, `${where}.${a.id}`);
    outcome(a.check?.success, `${where}.${a.id}.success`);
    outcome(a.check?.failure, `${where}.${a.id}.failure`);
  };

  for (const s of scenes) {
    const where = `scene ${s.id}`;
    dupes(`action in ${where}`, [...s.actions.map((a) => a.id), ...s.pois.flatMap((p) => p.actions.map((a) => `${p.id}.${a.id}`)), ...s.exits.map((e) => `exit.${e.id}`)]);
    for (const n of s.npcs) if (!npcIds.has(n)) errors.push(`${where}: unknown npc "${n}"`);
    for (const e of s.exits) {
      if (!sceneIds.has(e.to)) errors.push(`${where}: exit "${e.id}" leads to unknown scene "${e.to}"`);
      outcome(e.check?.failure, `${where}.exit.${e.id}.failure`);
    }
    for (const a of s.actions) action(a, where);
    for (const p of s.pois) for (const a of p.actions) action(a, `${where}.${p.id}`);
    outcome(s.onEnter, `${where}.onEnter`);
  }
  for (const e of adv.encounters) {
    for (const m of e.monsters) if (db && !db.monsters.has(m.id)) errors.push(`encounter ${e.id}: unknown monster "${m.id}"`);
    for (const m of e.scaling?.pool ?? []) if (db && !db.monsters.has(m)) errors.push(`encounter ${e.id}: unknown scaling monster "${m}"`);
    for (const m of e.allies) if (db && !db.monsters.has(m.id)) errors.push(`encounter ${e.id}: unknown ally "${m.id}"`);
    for (const b of e.bosses) if (!e.monsters.some((m) => m.id === b)) errors.push(`encounter ${e.id}: boss "${b}" is not one of its monsters`);
    outcome(e.win, `encounter ${e.id}.win`);
    outcome(e.lose, `encounter ${e.id}.lose`);
    outcome(e.flee, `encounter ${e.id}.flee`);
  }
  for (const b of adv.beats) {
    outcome(b.outcome, `beat ${b.id}`);
    for (const s of b.scenes) if (!sceneIds.has(s)) errors.push(`beat ${b.id}: unknown scene "${s}"`);
  }
  // Maps: sound geometry; scenes and encounters name existing maps and rooms.
  for (const m of adv.maps) errors.push(...checkDungeonMap(m));
  const room = (mapId: string | undefined, roomId: string | undefined, where: string) => {
    if (!mapId) return;
    const m = adv.maps.find((x) => x.id === mapId);
    if (!m) errors.push(`${where}: unknown map "${mapId}"`);
    else if (roomId && !m.rooms.some((r) => r.id === roomId)) errors.push(`${where}: map ${mapId} has no room "${roomId}"`);
  };
  for (const s of scenes) room(s.map?.id, s.map?.room, `scene ${s.id}`);
  for (const e of adv.encounters) if (e.map && adv.maps.length) room(e.map, e.room, `encounter ${e.id}`);
  for (const n of adv.npcs) if (db && !db.monsters.has(n.statBlock)) errors.push(`npc ${n.id}: unknown stat block "${n.statBlock}"`);
  for (const n of adv.npcs) for (const e of n.schedule) if (!sceneIds.has(e.scene)) errors.push(`npc ${n.id}: schedule names unknown scene "${e.scene}"`);
  for (const d of adv.deadlines) outcome(d.missed, `deadline ${d.id}.missed`);
  for (const l of adv.lootTables) for (const e of l.entries) if (e.itemId) item(e.itemId, `loot ${l.id}`);

  // Flags: namespaced, documented (registry or this adventure's docs), and writes of the right type.
  const documented = new Set(adv.flags.map((f) => f.id));
  const { reads, writes } = flagRefs(adv);
  for (const id of new Set([...reads, ...writes.map((w) => w.id)])) {
    if (!isNamespaced(id)) warnings.push(`flag "${id}" is not namespaced (use arc.<arc>., world., side.<quest>. or ~name)`);
    else if (!documented.has(id) && !registry?.has(id)) warnings.push(`flag "${id}" is not documented`);
  }
  for (const w of writes) {
    const problem = w.value !== undefined ? registry?.checkValue(w.id, w.value) : undefined;
    if (problem) errors.push(problem);
  }

  // Reachability from the start scene through exits and gotos (ignoring conditions).
  const reach = new Set<string>();
  const queue = [adv.start.scene];
  const byId = new Map(scenes.map((s) => [s.id, s]));
  while (queue.length) {
    const id = queue.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    const s = byId.get(id);
    if (!s) continue;
    for (const t of sceneTargets(s, adv)) queue.push(t);
  }
  for (const s of scenes) if (!reach.has(s.id)) warnings.push(`scene "${s.id}" is unreachable from the start`);
  if (adv.endings.length && !scenes.some((s) => reach.has(s.id) && sceneOutcomes(s).some((o) => o.ending)) && !adv.encounters.some((e) => [e.win, e.lose, e.flee].some((o) => o.ending)) && !adv.beats.some((b) => b.outcome.ending)) {
    errors.push('no reachable ending');
  }

  return { ok: errors.length === 0, ...(errors.length === 0 && { adventure: adv }), errors, warnings };
}

export function allScenes(adv: Adventure): Scene[] {
  return adv.chapters.flatMap((c) => c.scenes);
}

function sceneOutcomes(s: Scene): Outcome[] {
  const fromAction = (a: Action) => [a.outcome, a.check?.success, a.check?.failure].filter((o): o is Outcome => !!o);
  return [...(s.onEnter ? [s.onEnter] : []), ...s.actions.flatMap(fromAction), ...s.pois.flatMap((p) => p.actions.flatMap(fromAction)), ...s.exits.flatMap((e) => (e.check ? [e.check.failure] : []))];
}

function sceneTargets(s: Scene, adv: Adventure): string[] {
  const out = s.exits.map((e) => e.to);
  const outcomes = sceneOutcomes(s);
  for (const o of outcomes) {
    if (o.goto) out.push(o.goto);
    const enc = o.encounter ? adv.encounters.find((e) => e.id === o.encounter) : undefined;
    for (const eo of enc ? [enc.win, enc.lose, enc.flee] : []) if (eo.goto) out.push(eo.goto);
  }
  for (const b of adv.beats) if (b.outcome.goto && (b.scenes.length === 0 || b.scenes.includes(s.id))) out.push(b.outcome.goto);
  return out;
}

/** Every flag an adventure reads (conditions) and writes (outcome `flags`). */
export function flagRefs(adv: Adventure): { reads: Set<string>; writes: { id: string; value?: FlagValue }[] } {
  const reads = new Set<string>();
  const writes: { id: string; value?: FlagValue }[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.flag === 'string') reads.add(o.flag);
    if (typeof o.set === 'string') writes.push({ id: o.set, value: o.value as FlagValue });
    if (typeof o.inc === 'string') writes.push({ id: o.inc, value: 0 });
    if (typeof o.clear === 'string') writes.push({ id: o.clear });
    for (const [k, x] of Object.entries(o)) if (k !== 'flags' || Array.isArray(x)) walk(x);
  };
  walk(adv.chapters);
  walk(adv.encounters);
  walk(adv.beats);
  walk(adv.deadlines);
  walk(adv.quests);
  walk(adv.npcs);
  return { reads, writes };
}
