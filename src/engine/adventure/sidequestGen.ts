/**
 * Side-quest generator (spec §7.4, "woven-in" mode). Builds a complete adventure in the normal
 * format from data/tables/sidequests.json: an offer scene at the quest giver's location, the site,
 * the climax (a fight or skill checks), and a report scene with the reward. It prefers loose
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
import type { SideQuestTables } from './sidequestTables';
import type { Skill } from '../rules/basics';

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
}

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
  const fill = (text: string) =>
    text
      .replaceAll('{antagonist}', villain)
      .replaceAll('{patron}', patron)
      .replaceAll('{relative}', rng.pick(p.relatives))
      .replaceAll('{heirloom}', rng.pick(p.heirlooms))
      .replaceAll('{mystery}', rng.pick(p.mysteries))
      .replaceAll('{parcel}', rng.pick(p.parcels))
      .replaceAll('{destination}', destination)
      .replaceAll('{deadline}', 'nightfall tomorrow')
      .replaceAll('{rival}', rng.pick(p.names.filter((n) => n !== patron)))
      .replaceAll('{site}', site.name);
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
  const skill = (i: number): Skill => type.skills[i % type.skills.length]!;
  const winFacts = [`${villain} will trouble no one again.`, ...(twist.text ? [fill(twist.text)] : [])].join(' ');
  const siteScene: Record<string, unknown> = {
    id: 'site',
    name: site.name.replace(/^an? /, '').replace(/^\w/, (c) => c.toUpperCase()),
    seed: site.seed,
    actions: [] as unknown[],
    exits: [{ id: 'leave', label: 'Head back to ' + here.name, to: 'report', minutes: 120 }],
  };
  const siteActions = siteScene.actions as unknown[];
  if (complication.effect === 'ambush') siteScene.onEnter = { text: fill(complication.text), encounter: 'fight' };
  else siteScene.onEnter = { text: fill(complication.text) };
  if (type.fight) {
    siteActions.push({ id: 'confront', label: `Confront ${villain}`, if: { not: { flag: '~resolved' } }, keywords: ['fight', 'attack', 'confront'], outcome: { encounter: 'fight' } });
    if (twist.effect === 'spare_option') {
      siteActions.push({
        id: 'parley',
        label: `Try to talk ${villain} down`,
        once: true,
        if: { not: { flag: '~resolved' } },
        check: { skill: 'persuasion', dc: dc + 2, success: { text: `${villain} lays down their arms and agrees to leave.`, flags: [{ set: '~resolved' }, { set: '~spared' }] }, failure: { text: 'Talk fails. Steel is drawn.', encounter: 'fight' } },
      });
    }
  } else {
    siteActions.push({
      id: 'work',
      label: type.id === 'negotiate' ? 'Hear both sides out' : type.id === 'deliver' ? 'Press on with the delivery' : 'Search for answers',
      once: true,
      if: { not: { flag: '~resolved' } },
      check: { skill: skill(0), dc, success: { text: 'You find what you came for.', flags: [{ set: '~resolved' }] }, failure: { text: 'It is harder than it looked; you will need another way.', flags: [{ set: '~setback' }] } },
    });
    siteActions.push({
      id: 'second_try',
      label: 'Try another approach',
      once: true,
      if: { all: [{ flag: '~setback' }, { not: { flag: '~resolved' } }] },
      check: { skill: skill(1), dc, success: { text: 'The second approach works.', flags: [{ set: '~resolved' }] }, failure: { text: `${villain} gets the better of you this time.`, flags: [{ set: '~botched' }] } },
    });
    siteActions.push({ id: 'force', label: `Force the issue with ${villain}`, if: { all: [{ flag: '~botched' }, { not: { flag: '~resolved' } }] }, outcome: { encounter: 'fight' } });
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
      {
        id: 'claim',
        label: `Tell ${patron} it is done`,
        if: { flag: '~resolved' },
        outcome: {
          text: `${patron} thanks you and pays as promised.`,
          coins: gold * 100,
          xp: Math.max(25, Math.round(encounterXp / 2)),
          ...(rewardItem && { items: [{ itemId: rewardItem, quantity: 1 }] }),
          flags: [{ set: '~done' }, ...(thread ? [{ set: threadDoneFlag(thread.id) }, ...thread.writeBack.flags] : [])],
          reputation: [...(patronFaction ? [{ faction: patronFaction, delta: rep }] : []), ...(thread?.writeBack.reputation ?? [])],
          ending: 'done',
        },
      },
      { id: 'give_up', label: `Admit to ${patron} that you failed`, if: { all: [{ flag: '~botched' }, { not: { flag: '~resolved' } }] }, outcome: { text: `${patron} nods, disappointed.`, flags: [{ set: '~failed' }], ending: 'failed' } },
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
      { id: 'fight', name: villain, monsters, terrain: [], win: { text: winFacts, flags: [{ set: '~resolved' }] }, lose: { text: 'You are driven off, battered but alive.', flags: [{ set: '~botched' }], goto: 'report' }, flee: { text: 'You retreat to safety.', goto: 'report' } },
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
      { id: '~done', description: `Was paid by ${patron}.` },
      { id: '~failed', description: `Failed ${patron}.` },
      ...(thread ? [{ id: threadDoneFlag(thread.id), description: `Resolved the thread "${thread.name}".` }] : []),
    ],
    endings: [
      { id: 'done', name: 'Job done', text: `${title}: done.` },
      { id: 'failed', name: 'Job failed', text: `${title}: failed.` },
    ],
  };
  return { adventure, ...(thread && { threadId: thread.id }), questType: type.id };
}
