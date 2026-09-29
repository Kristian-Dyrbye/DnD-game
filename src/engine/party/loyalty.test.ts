import { describe, expect, it } from 'vitest';
import companionsJson from '../../../data/companions.json';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import flagsJson from '../../../data/adventures/flags.json';
import loreJson from '../../../data/world/lore.json';
import type { ServerEvent } from '../../shared/protocol';
import { adventureActionPort } from '../adventure/sessionActions';
import { validateAdventure } from '../adventure/validate';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { FlagRegistry } from '../world/flags';
import { LoreSchema } from '../world/lore';
import { gatherNarrationContext } from '../../llm/context/gather';
import { changeApproval, CompanionRosterSchema, loyaltyOf, recruitCompanion, shortName } from './companions';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const roster = CompanionRosterSchema.parse(companionsJson);
const flags = FlagRegistry.fromJson(flagsJson);
const def = (id: string) => roster.companions.find((c) => c.id === id)!;
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('h'))), db);

describe('loyalty', () => {
  it('only companions in the party react; loyalty is clamped 0–100 with a warning at the low mark', () => {
    const s = newGameState(hero(), 'heroic', 1);
    expect(changeApproval(s, def('corwin'), 10)).toBeUndefined();
    recruitCompanion(s, def('corwin'), db);
    expect(changeApproval(s, def('corwin'), 10)).toBe('Corwin approves. (+10)');
    expect(loyaltyOf(s, def('corwin'))).toBe(60);
    expect(changeApproval(s, def('corwin'), -20)).toBe('Corwin strongly disapproves. (-20)');
    expect(changeApproval(s, def('corwin'), -25)).toBe('Corwin strongly disapproves. (-25) Their patience is wearing thin.');
    changeApproval(s, def('corwin'), -50);
    expect(loyaltyOf(s, def('corwin'))).toBe(0);
    expect(shortName('Rook Marrowby')).toBe('Rook');
    expect(shortName('Nettle')).toBe('Nettle');
  });

  it('LLM context mentions companions and their mood', () => {
    const s = newGameState(hero(), 'heroic', 1);
    recruitCompanion(s, def('nettle'), db);
    s.flags['world.nettle_loyalty'] = 15;
    const ctx = gatherNarrationContext(s, lore, undefined, db);
    expect(ctx.party[1]).toMatch(/^Nettle, Halfling Druid 1, .*\(companion, loyalty 15\/100, resentful\)$/);
  });

  it('authored choices shift approval, and an authored leave point fires at low loyalty', async () => {
    const raw = structuredClone(demo) as unknown as { chapters: { scenes: { id: string; actions: Record<string, unknown>[] }[] }[] };
    const square = raw.chapters[0]!.scenes[0]!;
    square.actions.push(
      { id: 'hire', label: 'Hire the knight', once: true, outcome: { recruit: 'corwin' } },
      { id: 'kick_beggar', label: 'Kick the beggar', outcome: { text: 'You kick the beggar.', approval: [{ companion: 'corwin', delta: -20 }] } },
      {
        id: 'corwin_leaves',
        label: 'Corwin wants a word',
        once: true,
        if: { all: [{ flag: 'world.corwin_status', eq: 'in_party' }, { flag: 'world.corwin_loyalty', lte: 20 }] },
        outcome: { text: 'Corwin unbuckles his sword belt. "I cannot follow you any further."', companionLeaves: { id: 'corwin', status: 'left' } },
      },
    );
    const adventure = validateAdventure(raw, db, flags).adventure!;
    const session = new GameSession({ actions: adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, { lore, flags, companions: roster }), newSeed: () => 'l' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    await session.handle({ type: 'choose', actionId: 'hire' });
    const ids = () => {
      const e = events.filter((x) => x.type === 'suggestions').at(-1);
      return e?.type === 'suggestions' ? e.actions.map((a) => a.id) : [];
    };
    expect(ids()).not.toContain('corwin_leaves');
    await session.handle({ type: 'choose', actionId: 'kick_beggar' });
    expect(events.some((e) => e.type === 'log' && e.entry.text === 'Corwin strongly disapproves. (-20)')).toBe(true);
    await session.handle({ type: 'choose', actionId: 'kick_beggar' });
    expect(ids()).toContain('corwin_leaves');
    await session.handle({ type: 'choose', actionId: 'corwin_leaves' });
    expect(session.current.companions).toEqual([]);
    expect(session.current.flags['world.corwin_status']).toBe('left');
  });
});
