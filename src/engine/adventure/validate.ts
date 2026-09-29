/**
 * Adventure validator: schema + referential integrity (scene/NPC/encounter/loot/ending ids, SRD
 * monster and item ids) + reachability. Used by tests for authored content, by the side-quest
 * generator (reject and regenerate) and by a future editor/importer.
 */
import type { SrdDatabase } from '../data/srd';
import { AdventureSchema, type Action, type Adventure, type Outcome, type Scene } from './schema';

export interface ValidationResult {
  ok: boolean;
  adventure?: Adventure;
  errors: string[];
  /** Non-fatal problems (unreachable scenes, undocumented flags...). */
  warnings: string[];
}

export function validateAdventure(raw: unknown, db?: SrdDatabase): ValidationResult {
  const parsed = AdventureSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`), warnings: [] };
  }
  const adv = parsed.data;
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
    outcome(e.win, `encounter ${e.id}.win`);
    outcome(e.lose, `encounter ${e.id}.lose`);
    outcome(e.flee, `encounter ${e.id}.flee`);
  }
  for (const b of adv.beats) {
    outcome(b.outcome, `beat ${b.id}`);
    for (const s of b.scenes) if (!sceneIds.has(s)) errors.push(`beat ${b.id}: unknown scene "${s}"`);
  }
  for (const n of adv.npcs) if (db && !db.monsters.has(n.statBlock)) errors.push(`npc ${n.id}: unknown stat block "${n.statBlock}"`);
  for (const l of adv.lootTables) for (const e of l.entries) if (e.itemId) item(e.itemId, `loot ${l.id}`);

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
