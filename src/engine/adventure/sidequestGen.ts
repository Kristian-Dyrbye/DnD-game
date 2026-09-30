/**
 * Side-quest generator (spec §7.4, "woven-in" mode). Builds a complete adventure in the normal
 * format from data/tables/sidequests.json: an offer scene at the quest giver's location, the site,
 * the climax (A137: ≥ 3 approaches per quest type — fight, sneak, talk, trick, bribe, skill — then a
 * choice between ≥ 2 outcome variants such as spare/kill or return/keep), and a report scene whose
 * claim pays, shifts reputation and companion approval by that choice. It prefers loose
 * threads from world flags (escaped villains, grateful or vengeful NPCs, faction grudges, unexplored
 * places) and writes the thread's consequences back to world flags when the quest is completed.
 * Output is plain JSON; callers validate it (A109 rejects and regenerates broken quests).
 */
import type { Rng } from '../core/rng';
import type { SrdDatabase } from '../data/srd';
import type { GameState } from '../session/gameState';
import type { FlagRegistry } from '../world/flags';
import type { Lore } from '../world/lore';
import { totalLevel } from '../core/creature';
import { xpBudget } from './encounters';
import { evalCondition } from './conditions';
import type { APPROACH_KINDS, SideQuestTables } from './sidequestTables';

type ApproachKind = (typeof APPROACH_KINDS)[number];

export interface SideQuestOptions {
  tables: SideQuestTables;
  lore: Lore;
  db: SrdDatabase;
  state: GameState;
  rng: Rng;
  /** Where the quest is offered (quest board, tavern, faction contact). */
  locationId: string;
  flags?: FlagRegistry;
  /** Chance to use an open thread when one exists (default 0.75). */
  threadChance?: number;
}

export interface GeneratedQuest {
  /** Raw adventure JSON (validate before use). */
  adventure: Record<string, unknown>;
  threadId?: string;
  questType: string;
  /** Action ids of the ways to resolve the job at the site (A137). */
  approaches: string[];
  /** Outcome variant ids; each sets the local flag `~o_<id>` and has its own claim at the report. */
  outcomes: string[];
}

/** Companion approval tag earned by resolving a job this way (on success). */
const APPROACH_TAGS: Partial<Record<ApproachKind, string>> = { sneak: 'clever', trick: 'clever', talk: 'diplomacy' };
const FIGHT_FAILURE: Partial<Record<ApproachKind, string>> = {
  sneak: 'You are spotted. Steel is drawn.',
  talk: 'Talk fails. Steel is drawn.',
  trick: 'The ruse falls apart, and they come for you.',
  skill: 'It goes wrong, and they come for you.',
};

/** Local flag set by an outcome variant (read by its claim at the report). */
export const outcomeFlag = (outcomeId: string) => `~o_${outcomeId}`;

/** Flag marking a thread as resolved, so it is not offered again. */
export const threadDoneFlag = (threadId: string) => `side.threads.${threadId}`;

type Tables = SideQuestTables;
type Thread = Tables['threads'][number];

function weightedPick<T extends { weight: number }>(rng: Rng, items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let n = rng.int(1, total);
  return items.find((i) => (n -= i.weight) <= 0)!;
}

/** Threads whose creating condition holds and that were not resolved yet. */
export function openThreads(o: Pick<SideQuestOptions, 'tables' | 'state' | 'flags'>): Thread[] {
  const ctx = {
    flags: o.state.flags,
    ...(o.flags && { defaults: o.flags.defaults() }),
    timeOfDay: 'day' as const,
    reputation: {},
    level: totalLevel(o.state.hero),
    visited: new Set<string>(),
  };
  return o.tables.threads.filter((t) => !o.state.flags[threadDoneFlag(t.id)] && evalCondition(t.if, ctx));
}

/** SRD DC tier by level band (medium-ish checks for side quests). */
export function questDc(level: number): number {
  return level <= 4 ? 12 : level <= 10 ? 15 : 18;
}

export function generateSideQuest(o: SideQuestOptions): GeneratedQuest {
  const { tables, lore, db, rng, state } = o;
  const level = totalLevel(state.hero);
  const here = lore.locations.find((l) => l.id === o.locationId) ?? lore.locations[0]!;
  const region = here.regionId;

  // 1. Thread (woven-in) or a fresh random quest.
  const threads = openThreads(o);
  const local = threads.filter((t) => t.locations.includes(here.id));
  const nearby = threads.filter((t) => t.locations.some((l) => lore.locations.find((x) => x.id === l)?.regionId === region));
  const pool = local.length ? local : nearby.length ? nearby : threads;
  const thread = pool.length && rng.next() < (o.threadChance ?? 0.75) ? rng.pick(pool) : undefined;
  const type = thread ? tables.questTypes.find((q) => q.id === thread.questType)! : weightedPick(rng, tables.questTypes);

  // 2. Site and antagonist for this region and level.
  const sites = tables.sites.filter((s) => type.siteKinds.includes(s.kind) && s.regions.includes(region));
  const site = rng.pick(sites.length ? sites : tables.sites.filter((s) => type.siteKinds.includes(s.kind)));
  const foes = tables.antagonists.filter((a) => type.antagonistKinds.includes(a.kind) && a.regions.includes(region));
  const leveled = foes.filter((a) => level >= a.levels[0] && level <= a.levels[1]);
  const foe = (thread && tables.antagonists.find((a) => a.id === thread.antagonist)) || rng.pick(leveled.length ? leveled : foes.length ? foes : tables.antagonists);
  const complication = weightedPick(rng, tables.complications);
  const twist = weightedPick(rng, tables.twists);

  // 3. Words.
  const p = tables.patrons;
  const patron = rng.pick(p.names);
  const destination = lore.locations.find((l) => l.id !== here.id && l.regionId === region)?.name ?? here.name;
  const villain = thread?.villain || foe.name;
  // Picked once so the goal, choices and claims all name the same relative/heirloom/parcel.
  const words = { relative: rng.pick(p.relatives), heirloom: rng.pick(p.heirlooms), mystery: rng.pick(p.mysteries), parcel: rng.pick(p.parcels), rival: rng.pick(p.names.filter((n) => n !== patron)) };
  const fill = (text: string) =>
    text
      .replaceAll('{antagonist}', villain)
      .replaceAll('{patron}', patron)
      .replaceAll('{relative}', words.relative)
      .replaceAll('{heirloom}', words.heirloom)
      .replaceAll('{mystery}', words.mystery)
      .replaceAll('{parcel}', words.parcel)
      .replaceAll('{destination}', destination)
      .replaceAll('{deadline}', 'nightfall tomorrow')
      .replaceAll('{rival}', words.rival)
      .replaceAll('{site}', site.name)
      .replace(/^\w/, (c) => c.toUpperCase());
  const goal = fill(type.goal);
  const title = thread?.name ?? `${type.name}: ${villain}`;

  // 4. Encounter sized to a Moderate budget for the hero's level.
  const budget = db.tables ? xpBudget([level], tables.rewards.xpDifficulty, db.tables) : 100 * level;
  const leader = db.monsters.get(foe.leader);
  const monsters: { id: string; count: number }[] = [];
  let spent = 0;
  if (leader && leader.xp <= budget) {
    monsters.push({ id: leader.id, count: 1 });
    spent += leader.xp;
  }
  const minion = foe.minions.map((m) => db.monsters.get(m)).filter((m) => m !== undefined).sort((a, b) => a.xp - b.xp)[0];
  if (minion) {
    let n = 0;
    while (n < 6 && spent + minion.xp <= budget) {
      n++;
      spent += minion.xp;
    }
    if (n > 0) monsters.push({ id: minion.id, count: n });
  }
  if (monsters.length === 0) monsters.push({ id: minion?.id ?? leader?.id ?? foe.leader, count: 1 });
  const encounterXp = monsters.reduce((s, m) => s + (db.monsters.get(m.id)?.xp ?? 0) * m.count, 0);

  // 5. Reward.
  const r = tables.rewards;
  const gold = rng.int(r.goldPerLevel.min, r.goldPerLevel.max) * level;
  const rarities = r.itemRarityByLevel.find((b) => level >= b.levels[0] && level <= b.levels[1])?.rarities ?? ['common'];
  const items = [...db.magicItems.values()].filter((m) => rarities.includes(m.rarity as never) && !m.baseItem && m.category !== 'scroll');
  const rewardItem = items.length && rng.next() < r.itemChance ? rng.pick(items).id : undefined;
  const rep = rng.int(r.reputation.min, r.reputation.max);
  const patronFaction = here.factionIds[0];

  // 6. Adventure JSON.
  const n = rng.int(1000, 9999);
  const id = `sq_${(thread?.id ?? type.id).replace(/[^a-z0-9_]/g, '')}_${n}`;
  const dc = questDc(level);
  const approval = (tags: (string | undefined)[]) => tags.flatMap((t) => (t && tables.approvalTags[t]) || []);
  const open = { not: { flag: '~resolved' } };
  const winFacts = [`${villain} will trouble no one again.`, ...(twist.text ? [fill(twist.text)] : [])].join(' ');
  const siteScene: Record<string, unknown> = {
    id: 'site',
    name: site.name.replace(/^an? /, '').replace(/^\w/, (c) => c.toUpperCase()),
    seed: site.seed,
    actions: [] as unknown[],
    // Once the job is resolved, choose how it ends before heading back.
    exits: [{ id: 'leave', label: 'Head back to ' + here.name, to: 'report', minutes: 120, if: { any: [{ not: { flag: '~resolved' } }, { flag: '~decided' }] } }],
  };
  const siteActions = siteScene.actions as unknown[];
  if (complication.effect === 'ambush') siteScene.onEnter = { text: fill(complication.text), encounter: 'fight' };
  else siteScene.onEnter = { text: fill(complication.text) };

  // Approaches (A137): each resolves the job its own way. In fight jobs a failed check starts the
  // fight; in the others it is a setback, after which the issue can be forced.
  const bribeGp = tables.rewards.bribePerLevel * level;
  const approachIds: string[] = [];
  const resolvedBy = (kind: ApproachKind) => [{ set: '~resolved' }, { set: `~by_${kind}` }];
  type.approaches.forEach((a, i) => {
    const id = a.kind === 'fight' ? 'confront' : type.approaches.filter((x) => x.kind === a.kind).length > 1 ? `${a.kind}_${i}` : a.kind;
    approachIds.push(id);
    const base = { id, label: fill(a.label), if: open, ...(a.keywords.length && { keywords: a.keywords }) };
    if (a.kind === 'fight') return siteActions.push({ ...base, outcome: { encounter: 'fight' } });
    if (a.kind === 'bribe') return siteActions.push({ ...base, label: `${base.label} (${bribeGp} gp)`, outcome: { cost: bribeGp * 100, text: fill(a.success), flags: resolvedBy('bribe') } });
    // Talking a foe down is harder unless they had a good reason (spare_option twist); a ruse is a little harder.
    const checkDc = !type.fight ? dc : a.kind === 'talk' ? (twist.effect === 'spare_option' ? dc : dc + 2) : a.kind === 'trick' ? dc + 1 : dc;
    const failure = type.fight
      ? { text: FIGHT_FAILURE[a.kind] ?? FIGHT_FAILURE.skill!, encounter: 'fight' }
      : { text: 'It is harder than it looked; you will need another way.', flags: [{ set: '~setback' }] };
    return siteActions.push({
      ...base,
      once: true,
      check: { skill: a.skill!, dc: checkDc, success: { text: fill(a.success), flags: resolvedBy(a.kind), approval: approval([APPROACH_TAGS[a.kind]]) }, failure },
    });
  });
  if (!type.fight) {
    siteActions.push({ id: 'force', label: `Force the issue with ${villain}`, if: { all: [{ flag: '~setback' }, open] }, keywords: ['fight', 'attack', 'force'], outcome: { encounter: 'fight' } });
    approachIds.push('force');
  }

  // Outcome variants (A137): once resolved, the hero decides how it ends; the claim at the report follows.
  for (const o of type.outcomes) {
    siteActions.push({
      id: `decide_${o.id}`,
      label: fill(o.label),
      if: { all: [{ flag: '~resolved' }, { not: { flag: '~decided' } }] },
      outcome: { text: fill(o.text), flags: [{ set: '~decided' }, { set: outcomeFlag(o.id) }, ...(o.tags.includes('mercy') ? [{ set: '~spared' }] : [])], approval: approval(o.tags) },
    });
  }
  if (complication.effect === 'gate_check' || complication.effect === 'hazard_check') {
    const sk = complication.skill ?? 'athletics';
    siteActions.unshift({ id: 'obstacle', label: complication.effect === 'gate_check' ? 'Slip past the watch' : 'Push through the storm', once: true, check: { skill: sk, dc, success: { text: 'You get through unseen and unhurt.' }, failure: { text: 'It costs you time and a few bruises.', minutes: 30 } } });
  }

  const report = {
    id: 'report',
    name: here.name,
    locationId: here.id,
    seed: `${patron} is waiting for news.`,
    actions: [
      // One claim per outcome variant: pay, reputation and the thread's write-back follow the choice.
      ...type.outcomes.map((o, i) => {
        const coins = Math.round(gold * o.goldMul) * 100;
        const patronRep = Math.round(rep * o.repMul);
        const paidBy = o.goldMul === 0 ? `${patron} listens in silence. There is no pay for this, but you know why you chose it.` : o.repMul < 0 ? `The coin is yours; ${patron}'s trust is not.` : `${patron} thanks you and pays as promised.`;
        return {
          id: i === 0 ? 'claim' : `claim_${o.id}`,
          label: fill(o.claim),
          if: { all: [{ flag: '~resolved' }, { flag: outcomeFlag(o.id) }] },
          outcome: {
            text: paidBy,
            ...(coins > 0 && { coins }),
            xp: Math.max(25, Math.round(encounterXp / 2)),
            ...(rewardItem && o.goldMul > 0 && o.repMul > 0 && { items: [{ itemId: rewardItem, quantity: 1 }] }),
            flags: [{ set: '~done' }, ...(thread ? [{ set: threadDoneFlag(thread.id) }, ...(o.writeBack ? thread.writeBack.flags : [])] : [])],
            reputation: [...(patronFaction && patronRep !== 0 ? [{ faction: patronFaction, delta: patronRep }] : []), ...(o.writeBack ? (thread?.writeBack.reputation ?? []) : [])],
            ending: 'done',
          },
        };
      }),
      {
        id: 'give_up',
        label: `Admit to ${patron} that you failed`,
        if: { all: [type.fight ? { flag: '~botched' } : { any: [{ flag: '~botched' }, { flag: '~setback' }] }, { not: { flag: '~resolved' } }] },
        outcome: { text: `${patron} nods, disappointed.`, flags: [{ set: '~failed' }], ending: 'failed' },
      },
    ],
    exits: [{ id: 'back_to_site', label: `Return to ${site.name}`, to: 'site', minutes: 120, if: { not: { flag: '~resolved' } } }],
  };

  const adventure: Record<string, unknown> = {
    formatVersion: 1,
    id,
    name: title,
    kind: 'side_quest',
    levelRange: [level, Math.min(20, level + 1)],
    regionId: region,
    summary: goal,
    start: { chapter: 'c1', scene: 'offer' },
    chapters: [
      {
        id: 'c1',
        name: title,
        summary: goal,
        start: 'offer',
        scenes: [
          {
            id: 'offer',
            name: here.name,
            locationId: here.id,
            seed: `${patron} approaches you with a job: ${goal}.`,
            actions: [{ id: 'accept', label: 'Accept the job', once: true, keywords: ['accept', 'yes', 'job'], outcome: { text: `${patron} explains where to find ${site.name}.`, flags: [{ set: '~accepted' }] } }],
            exits: [{ id: 'go', label: `Set out for ${site.name}`, to: 'site', minutes: 120, if: { flag: '~accepted' } }],
          },
          siteScene,
          report,
        ],
      },
    ],
    encounters: [
      { id: 'fight', name: villain, monsters, terrain: [], win: { text: winFacts, flags: [{ set: '~resolved' }, { set: '~by_fight' }] }, lose: { text: 'You are driven off, battered but alive.', flags: [{ set: '~botched' }], goto: 'report' }, flee: { text: 'You retreat to safety.', goto: 'report' } },
    ],
    deadlines:
      complication.effect === 'deadline'
        ? [{ id: 'hurry', text: goal, start: { flag: '~accepted' }, met: { flag: '~resolved' }, within: complication.minutes ?? 1440, warnAt: 240, missed: { text: 'You are too late; the chance has passed.', flags: [{ set: '~botched' }] } }]
        : [],
    quests: [
      {
        id: 'job',
        name: title,
        objectives: [
          { id: 'accept', text: `Hear out ${patron}`, done: { flag: '~accepted' } },
          { id: 'resolve', text: goal, done: { flag: '~resolved' }, if: { flag: '~accepted' } },
          { id: 'report', text: `Return to ${patron} in ${here.name}`, done: { flag: '~done' }, if: { flag: '~resolved' } },
        ],
        fail: { flag: '~failed' },
      },
    ],
    flags: [
      { id: '~accepted', description: `Took ${patron}'s job.` },
      { id: '~resolved', description: `Dealt with ${villain}.` },
      { id: '~setback', description: 'Hit a setback.' },
      { id: '~botched', description: 'Botched the job.' },
      { id: '~spared', description: `Spared ${villain}.` },
      { id: '~decided', description: 'Chose how the job ends.' },
      ...[...new Set(type.approaches.map((a) => a.kind))].map((k) => ({ id: `~by_${k}`, description: `Resolved the job by ${k === 'skill' ? 'skill' : k}.` })),
      ...type.outcomes.map((o) => ({ id: outcomeFlag(o.id), description: fill(o.label) + '.' })),
      { id: '~done', description: `Was paid by ${patron}.` },
      { id: '~failed', description: `Failed ${patron}.` },
      ...(thread ? [{ id: threadDoneFlag(thread.id), description: `Resolved the thread "${thread.name}".` }] : []),
    ],
    endings: [
      { id: 'done', name: 'Job done', text: `${title}: done.` },
      { id: 'failed', name: 'Job failed', text: `${title}: failed.` },
    ],
  };
  return { adventure, ...(thread && { threadId: thread.id }), questType: type.id, approaches: approachIds, outcomes: type.outcomes.map((o) => o.id) };
}
