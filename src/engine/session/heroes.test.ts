/** C002: a second player-made hero (co-op guest or duo mode): add_hero, origins, level-up per hero, shared story XP. */
import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { parseCommand } from '../../shared/protocol';
import { activeFight } from '../adventure/fights';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { totalLevel } from '../core/creature';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { CompanionRosterSchema, playerControlled } from '../party/companions';
import { LoreSchema } from '../world/lore';
import { GameSession } from './GameSession';
import { extraHeroes, GameStateSchema } from './gameState';
import { addSeat, charactersOf, ownerOf } from './table';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
/** A creator-built character: id 'hero', like every hero from the creator. */
const built = (cls: string, name: string) => ({ ...buildCharacter(toBuildInput(quickBuild(cls, db, Rng.fromSeed(name))), db), name });

function session() {
  const raw = structuredClone(demo) as unknown as { chapters: { scenes: { actions: Record<string, unknown>[] }[] }[] };
  const actions = raw.chapters[0]!.scenes[0]!.actions;
  actions.push({ id: 'hire', label: 'Hire', once: true, outcome: { recruit: 'nettle' } });
  actions.push({ id: 'reward', label: 'Reward', once: true, outcome: { xp: 300 } });
  const adventure = validateAdventure(raw, db).adventure!;
  const s = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, companions: roster }), newSeed: () => 'duo' });
  const events: ServerEvent[] = [];
  s.on((e) => events.push(e));
  const errors = () => events.filter((e): e is Extract<ServerEvent, { type: 'error' }> => e.type === 'error').map((e) => e.message);
  return { s, events, errors };
}

describe('add_hero (C002)', () => {
  it('duo mode: the host adds a second hero, played by the host, listed as a hero', async () => {
    const { s, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'add_hero', hero: built('wizard', 'Wren') });
    expect(errors()).toEqual([]);
    const second = s.current.companions[0]!;
    // The creator's id 'hero' is taken by the main hero: the session picks a free one.
    expect(second).toMatchObject({ id: 'hero-2', name: 'Wren' });
    expect(s.current.origins).toEqual({ 'hero-2': 'hero' });
    expect(extraHeroes(s.current).map((c) => c.id)).toEqual(['hero-2']);
    expect(playerControlled(s.current, 'host')).toEqual(['hero-2']);
    expect(charactersOf(s.table, s.current, 'host')).toEqual(['hero', 'hero-2']);
    expect(s.current.log.at(-1)?.text).toBe('Wren joins the party as a hero.');
    // A third hero gets the next free id.
    await s.handle({ type: 'add_hero', hero: built('rogue', 'Tam') });
    expect(s.current.companions.map((c) => c.id)).toEqual(['hero-2', 'hero-3']);
  });

  it('the protocol accepts add_hero with a character and level_up with a characterId', () => {
    expect(parseCommand(JSON.stringify({ type: 'add_hero', hero: built('cleric', 'Ola') })).ok).toBe(true);
    expect(parseCommand(JSON.stringify({ type: 'add_hero' })).ok).toBe(false);
    expect(parseCommand(JSON.stringify({ type: 'level_up', classId: 'fighter', hpMode: 'average', characterId: 'hero-2' })).ok).toBe(true);
  });

  it('a hero takes a party slot: a full party refuses another (in the session language)', async () => {
    const { s, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'choose', actionId: 'hire' });
    await s.handle({ type: 'add_hero', hero: built('wizard', 'A') });
    await s.handle({ type: 'add_hero', hero: built('wizard', 'B') });
    expect(s.current.companions).toHaveLength(3);
    s.language = 'da';
    await s.handle({ type: 'add_hero', hero: built('wizard', 'C') });
    expect(errors()).toEqual(['Gruppen er fuld: der er ikke plads til endnu en helt.']);
    expect(s.current.companions).toHaveLength(3);
  });

  it('a guest brings their own hero (even under host_decides), one per seat; spectators cannot', async () => {
    const { s, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    addSeat(s.table, 'player', 'Kim');
    addSeat(s.table, 'spectator');
    await s.handle({ type: 'add_hero', hero: built('rogue', 'Kit') }, 'guest-1');
    expect(errors()).toEqual([]);
    expect(ownerOf(s.table, s.current, 'hero-2')).toBe('guest-1');
    expect(playerControlled(s.current, 'guest-1')).toEqual(['hero-2']);
    await s.handle({ type: 'add_hero', hero: built('bard', 'Kit again') }, 'guest-1');
    await s.handle({ type: 'add_hero', hero: built('bard', 'Watcher') }, 'guest-2');
    expect(errors()).toEqual(['You already play a hero in this party.', 'Spectators can only watch']);
    expect(s.current.companions).toHaveLength(1);
  });

  it('no new heroes in the middle of a fight; a hero joins fights like a party member', async () => {
    const { s, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'add_hero', hero: built('cleric', 'Ola') });
    await s.handle({ type: 'choose', actionId: 'talk_mayor' });
    await s.handle({ type: 'choose', actionId: 'exit.to_mill' });
    await s.handle({ type: 'choose', actionId: 'exit.unlock' });
    const fight = activeFight(s.current);
    expect(fight?.enc.controlled).toEqual(['hero', 'hero-2']);
    expect(fight!.enc.state.turns.order.map((o) => o.id)).toContain('hero-2');
    await s.handle({ type: 'add_hero', hero: built('wizard', 'Late') });
    expect(errors()).toEqual(['Finish the fight first.']);
  });
});

describe('player-made heroes level up by hand (C002)', () => {
  it('story XP reaches every hero; each hero levels with its own level_up; companions still follow the main hero', async () => {
    const { s, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'choose', actionId: 'hire' });
    await s.handle({ type: 'add_hero', hero: built('fighter', 'Wren') });
    await s.handle({ type: 'choose', actionId: 'reward' });
    const xpOf = (id: string) => (id === 'hero' ? s.current.hero : s.current.companions.find((c) => c.id === id)!).xp;
    expect(xpOf('hero')).toBe(300);
    expect(xpOf('hero-2')).toBe(300);
    expect(xpOf('nettle')).toBe(0);
    // The main hero levels: the roster companion follows, the second hero does not.
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average' });
    const level = (id: string) => totalLevel(s.current.companions.find((c) => c.id === id)!);
    expect(totalLevel(s.current.hero)).toBe(2);
    expect(level('nettle')).toBe(2);
    expect(level('hero-2')).toBe(1);
    // The second hero levels on its own command, with a named line.
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average', characterId: 'hero-2' });
    expect(errors()).toEqual([]);
    expect(level('hero-2')).toBe(2);
    expect(totalLevel(s.current.hero)).toBe(2);
    expect(s.current.log.at(-1)?.text).toMatch(/^Wren: level 2! \+\d+ HP/);
  });

  it('a hero joining later starts with the main hero’s XP so they can catch up', async () => {
    const { s } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'choose', actionId: 'reward' });
    await s.handle({ type: 'add_hero', hero: built('rogue', 'Kit') });
    expect(s.current.companions[0]!.xp).toBe(300);
  });

  it('roster companions cannot be levelled by hand; seats level only their own heroes', async () => {
    const { s, errors } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'choose', actionId: 'hire' });
    await s.handle({ type: 'choose', actionId: 'reward' });
    addSeat(s.table, 'player');
    await s.handle({ type: 'add_hero', hero: built('fighter', 'Kit') }, 'guest-1');
    await s.handle({ type: 'level_up', classId: 'wizard', hpMode: 'average', characterId: 'nettle' });
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average' }, 'guest-1');
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average', characterId: 'hero-2' });
    expect(errors()).toEqual([
      'Only heroes level up by hand; companions level with the party.',
      'That character is played by someone else',
      'That character is played by someone else',
    ]);
    await s.handle({ type: 'level_up', classId: 'fighter', hpMode: 'average', characterId: 'hero-2' }, 'guest-1');
    expect(errors()).toHaveLength(3);
    expect(totalLevel(s.current.companions.find((c) => c.id === 'hero-2')!)).toBe(2);
  });

  it('origins survive a save round trip and old states default to none', async () => {
    const { s } = session();
    await s.handle({ type: 'new_game', hero: built('fighter', 'Mira'), mode: 'heroic' });
    await s.handle({ type: 'add_hero', hero: built('wizard', 'Wren') });
    const again = GameStateSchema.parse(JSON.parse(JSON.stringify(s.current)));
    expect(again.origins).toEqual({ 'hero-2': 'hero' });
    const { origins: _drop, ...old } = JSON.parse(JSON.stringify(s.current)) as Record<string, unknown>;
    expect(GameStateSchema.parse(old).origins).toEqual({});
  });
});
