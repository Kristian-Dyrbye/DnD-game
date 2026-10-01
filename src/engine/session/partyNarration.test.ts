/** C007: narration for a party — the acting extra hero is named in template lines, the log and the LLM prompt. */
import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import { gatherNarrationContext, recentLines } from '../../llm/context/gather';
import { buildNarrationPrompt, partyCard } from '../../llm/context/narration';
import { adventureActionPort } from '../adventure/sessionActions';
import type { NarrationJob, Narrator } from '../adventure/narration';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema } from '../party/companions';
import { LoreSchema } from '../world/lore';
import { GameSession } from './GameSession';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const adv = validateAdventure(structuredClone(demo), db).adventure!;
const built = (cls: string, name: string) => ({ ...buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(name))), db), name });

async function table(duo = true) {
  const jobs: NarrationJob[] = [];
  // Records each job and yields nothing, so the session logs the template narration.
  const narrator: Narrator = async function* (job) {
    jobs.push(job);
  };
  const s = new GameSession({ actions: adventureActionPort(new Map([[adv.id, adv]]), adv.id, db, { lore, companions: roster, narrator }), newSeed: () => 'party' });
  await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
  if (duo) await s.handle({ type: 'add_hero', hero: built('wizard', 'Wren') });
  const narration = () => s.current.log.filter((e) => e.kind === 'narration').at(-1)!.text;
  return { s, jobs, narration };
}

describe('narration for a party (C007)', () => {
  it('an action by the extra hero opens the template line with their name; the main hero is "you" as before', async () => {
    const { s, jobs, narration } = await table();
    await s.handle({ type: 'choose', actionId: 'notice_board.read', actor: 'hero-2' });
    expect(jobs.at(-1)!.actor).toBe('Wren');
    expect(narration().startsWith('Wren steps up. ')).toBe(true);
    await s.handle({ type: 'choose', actionId: 'talk_mayor', actor: 'hero' });
    expect(jobs.at(-1)!.actor).toBeUndefined();
    expect(narration()).not.toMatch(/steps up/);
  });

  it('a talk opened by the extra hero: replies are logged as their line and narrated as theirs', async () => {
    const { s, jobs } = await table();
    await s.handle({ type: 'choose', actionId: 'talk.mayor_hobb.mill_talk', actor: 'hero-2' });
    await s.handle({ type: 'choose', actionId: 'dlg.greet.sense' });
    const line = s.current.log.filter((e) => e.kind === 'player').at(-1)!;
    expect(line.speaker).toBe('Wren');
    expect(jobs.at(-1)!.actor).toBe('Wren');
    // The prompt's recent exchanges show who spoke.
    expect(recentLines(s.current.log).some((l) => l.startsWith('Wren: '))).toBe(true);
  });

  it('the template line follows the session language', async () => {
    const { s, narration } = await table();
    s.language = 'da';
    await s.handle({ type: 'choose', actionId: 'notice_board.read', actor: 'hero-2' });
    expect(narration().startsWith('Wren træder frem. ')).toBe(true);
  });

  it('solo play: no actor, no party card, companions stay companions', async () => {
    const { s, jobs } = await table(false);
    await s.handle({ type: 'choose', actionId: 'notice_board.read' });
    expect(jobs.at(-1)!.actor).toBeUndefined();
    const c = gatherNarrationContext(s.current, lore, adv, db);
    expect(c.heroes).toBeUndefined();
    const user = buildNarrationPrompt(c, { kind: 'outcome', playerAction: 'Read', facts: ['x'] }).messages[1]!.content;
    expect(user).not.toContain('PARTY:');
    expect(partyCard(['Mira'])).toBe('');
  });

  it('the prompt names both heroes: party card, "player hero" line, and the actor in the task', async () => {
    const { s } = await table();
    const c = gatherNarrationContext(s.current, lore, adv, db);
    expect(c.heroes).toEqual(['Mira', 'Wren']);
    expect(c.party.find((l) => l.startsWith('Wren,'))).toMatch(/\(player hero\)$/);
    const built = buildNarrationPrompt(c, { kind: 'outcome', playerAction: 'Read the notice board', actor: 'Wren', facts: ['You read the notice.'] });
    const system = built.messages[0]!.content;
    expect(system).toMatch(/narrating for a party of player heroes: Mira, Wren\./);
    expect(system).toMatch(/Address Mira as "you"; always call Wren by name in the third person\. This time Wren acts/);
    const story = built.messages[1]!.content;
    expect(story).toContain('1. Wren (not "you") takes this action.\n2. You read the notice.');
    expect(story).toContain('PARTY:\nPlayer heroes: Mira, Wren.');
    expect(story).toContain('"You" always means Mira. Call Wren by name, never "you".');
    const taskText = story.split('TASK:\n')[1]!;
    expect(taskText).toMatch(/^Wren \(a player hero, not "you"\): "Read the notice board"/);
    expect(taskText).toMatch(/it means Wren\./);
    // Combat moments of the second hero: the party card tells the model who is who.
    const fight = buildNarrationPrompt(c, { kind: 'combat', facts: ['Wren hits Giant Rat with Fire Bolt.'] }).messages[1]!.content;
    expect(fight).toContain('PARTY:');
    expect(fight).toContain('1. Wren hits Giant Rat with Fire Bolt.');
    // A scene reached by the second hero's move says so.
    const scene = buildNarrationPrompt(c, { kind: 'scene', actor: 'Wren', playerAction: 'Climb the wall', facts: [] }).messages[1]!.content;
    expect(scene.split('TASK:\n')[1]).toMatch(/Wren \(not "you"\) made the move that led here: "Climb the wall"\./);
  });

  it('the party card survives a tight budget', async () => {
    const { s } = await table();
    const c = gatherNarrationContext(s.current, lore, adv, db);
    const p = buildNarrationPrompt({ ...c, summary: 'long '.repeat(400) }, { kind: 'outcome', facts: ['x'] }, 600);
    expect(p.messages[1]!.content).toContain('PARTY:');
  });
});
