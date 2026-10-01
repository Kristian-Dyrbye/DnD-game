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
import { ENGLISH_MESSAGES, type Messages } from '../i18n';

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
  /** Language of the generated glue text (pass tables/lore in the same language). Default English. */
  msgs?: Messages;
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
const FIGHT_FAILURE = { sneak: 'sq.fail.sneak', talk: 'sq.fail.talk', trick: 'sq.fail.trick', skill: 'sq.fail.skill' } as const;

/** Upper-cases the first letter (any script). */
const cap = (s: string) => s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());

/**
 * Fills `{name}` placeholders; a value that starts the text or a sentence is capitalised, so
 * "{antagonist} pays well." reads "A pirate crew pays well." ({unknown} placeholders stay as they are).
 */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  const out = text.replace(/\{(\w+)\}/g, (whole, key: string, offset: number, src: string) => {
    const v = values[key];
    if (v === undefined) return whole;
    return /(^|[.!?]["”»]?\s+)$/u.test(src.slice(0, offset)) ? cap(v) : v;
  });
  return cap(out);
}

/** English keywords plus the language's own (players mix languages). */
const keywordList = (msgs: Messages, key: 'sq.kw.force' | 'sq.kw.accept') =>
  [...new Set([...ENGLISH_MESSAGES.m(key).split(','), ...msgs.m(key).split(',')])];

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
  const msgs = o.msgs ?? ENGLISH_MESSAGES;
  const { m } = msgs;
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
  const values = { ...words, antagonist: villain, patron, destination, deadline: m('sq.deadline'), site: site.name };
  const fill = (text: string) => fillPlaceholders(text, values);
  const goal = fill(type.goal);
  const title = thread?.name ?? m('sq.title', { type: type.name, villain });

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
  const winFacts = [cap(m('sq.win', { villain })), ...(twist.text ? [fill(twist.text)] : [])].join(' ');
  const siteScene: Record<string, unknown> = {
    id: 'site',
    name: cap(site.name.replace(/^an? /, '')),
    seed: site.seed,
    actions: [] as unknown[],
    // Once the job is resolved, choose how it ends before heading back.
    exits: [{ id: 'leave', label: m('sq.headBack', { place: here.name }), to: 'report', minutes: 120, if: { any: [{ not: { flag: '~resolved' } }, { flag: '~decided' }] } }],
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
    if (a.kind === 'bribe') return siteActions.push({ ...base, label: m('sq.bribe', { label: base.label, price: msgs.coins(bribeGp * 100) }), outcome: { cost: bribeGp * 100, text: fill(a.success), flags: resolvedBy('bribe') } });
    // Talking a foe down is harder unless they had a good reason (spare_option twist); a ruse is a little harder.
    const checkDc = !type.fight ? dc : a.kind === 'talk' ? (twist.effect === 'spare_option' ? dc : dc + 2) : a.kind === 'trick' ? dc + 1 : dc;
    const failure = type.fight
      ? { text: m(a.kind in FIGHT_FAILURE ? FIGHT_FAILURE[a.kind as keyof typeof FIGHT_FAILURE] : FIGHT_FAILURE.skill), encounter: 'fight' }
      : { text: m('sq.setback'), flags: [{ set: '~setback' }] };
    return siteActions.push({
      ...base,
      once: true,
      check: { skill: a.skill!, dc: checkDc, success: { text: fill(a.success), flags: resolvedBy(a.kind), approval: approval([APPROACH_TAGS[a.kind]]) }, failure },
    });
  });
  if (!type.fight) {
    siteActions.push({ id: 'force', label: m('sq.force', { villain }), if: { all: [{ flag: '~setback' }, open] }, keywords: keywordList(msgs, 'sq.kw.force'), outcome: { encounter: 'fight' } });
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
    siteActions.unshift({ id: 'obstacle', label: m(complication.effect === 'gate_check' ? 'sq.gate' : 'sq.hazard'), once: true, check: { skill: sk, dc, success: { text: m('sq.obstacle.ok') }, failure: { text: m('sq.obstacle.fail'), minutes: 30 } } });
  }

  const report = {
    id: 'report',
    name: here.name,
    locationId: here.id,
    seed: m('sq.waiting', { patron }),
    actions: [
      // One claim per outcome variant: pay, reputation and the thread's write-back follow the choice.
      ...type.outcomes.map((o, i) => {
        const coins = Math.round(gold * o.goldMul) * 100;
        const patronRep = Math.round(rep * o.repMul);
        const paidBy = m(o.goldMul === 0 ? 'sq.paid.none' : o.repMul < 0 ? 'sq.paid.distrust' : 'sq.paid.ok', { patron });
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
        label: m('sq.giveUp', { patron }),
        if: { all: [type.fight ? { flag: '~botched' } : { any: [{ flag: '~botched' }, { flag: '~setback' }] }, { not: { flag: '~resolved' } }] },
        outcome: { text: m('sq.giveUp.text', { patron }), flags: [{ set: '~failed' }], ending: 'failed' },
      },
    ],
    exits: [{ id: 'back_to_site', label: m('sq.returnTo', { site: site.name }), to: 'site', minutes: 120, if: { not: { flag: '~resolved' } } }],
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
            seed: m('sq.offerSeed', { patron, goal }),
            actions: [{ id: 'accept', label: m('sq.accept'), once: true, keywords: keywordList(msgs, 'sq.kw.accept'), outcome: { text: m('sq.explains', { patron, site: site.name }), flags: [{ set: '~accepted' }] } }],
            exits: [{ id: 'go', label: m('sq.setOut', { site: site.name }), to: 'site', minutes: 120, if: { flag: '~accepted' } }],
          },
          siteScene,
          report,
        ],
      },
    ],
    encounters: [
      { id: 'fight', name: cap(villain), monsters, terrain: [], win: { text: winFacts, flags: [{ set: '~resolved' }, { set: '~by_fight' }] }, lose: { text: m('sq.lose'), flags: [{ set: '~botched' }], goto: 'report' }, flee: { text: m('sq.flee'), goto: 'report' } },
    ],
    deadlines:
      complication.effect === 'deadline'
        ? [{ id: 'hurry', text: goal, start: { flag: '~accepted' }, met: { flag: '~resolved' }, within: complication.minutes ?? 1440, warnAt: 240, missed: { text: m('sq.missed'), flags: [{ set: '~botched' }] } }]
        : [],
    quests: [
      {
        id: 'job',
        name: title,
        objectives: [
          { id: 'accept', text: m('sq.obj.hear', { patron }), done: { flag: '~accepted' } },
          { id: 'resolve', text: goal, done: { flag: '~resolved' }, if: { flag: '~accepted' } },
          { id: 'report', text: m('sq.obj.report', { patron, place: here.name }), done: { flag: '~done' }, if: { flag: '~resolved' } },
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
      { id: 'done', name: m('sq.end.done'), text: m('sq.end.doneText', { title }) },
      { id: 'failed', name: m('sq.end.failed'), text: m('sq.end.failedText', { title }) },
    ],
  };
  return { adventure, ...(thread && { threadId: thread.id }), questType: type.id, approaches: approachIds, outcomes: type.outcomes.map((o) => o.id) };
}
