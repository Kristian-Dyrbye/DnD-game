import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import { templateBackstory } from '../../llm/prompts/backstory';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { messages } from '../i18n';
import { GameSession } from '../session/GameSession';
import { keywordIntent } from './intent';
import { templateNarration } from './narration';
import { availableActions, checkLabel, describeScene, perform, startAdventure, type RunContext } from './runner';
import { CheckSchema } from './schema';
import { dataSuggestions } from './suggestions';
import { linesSince, templateSummary } from './summary';
import { validateAdventure } from './validate';

const db = loadSrd();
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const da = messages('da');

function ctx(lang: 'en' | 'da'): RunContext {
  const s = new GameSession();
  s.start({ campaignId: 'c', mode: 'heroic', rng: Rng.fromSeed(1).getState(), hero: buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('f'))), db), location: { name: 'x' } });
  const c: RunContext = { state: s.current, adventure, rng: Rng.fromSeed(1), db, msgs: messages(lang) };
  startAdventure(c);
  return c;
}

describe('fallback templates in the session language (A141d)', () => {
  it('template narration glue', () => {
    const c = ctx('da');
    expect(templateNarration({ kind: 'outcome', facts: [], ctx: c })).toBe('Der sker ikke meget.');
    const npcs = describeScene(c).npcs;
    const scene = templateNarration({ kind: 'scene', facts: [], ctx: c });
    if (npcs.length) expect(scene).toContain(`Her er: ${npcs.join(', ')}.`);
    expect(scene).not.toContain('Here:');
    expect(templateNarration({ kind: 'outcome', facts: [], ctx: ctx('en') })).toBe('Nothing much happens.');
  });

  it('check labels', () => {
    expect(checkLabel(CheckSchema.parse({ skill: 'stealth', dc: 12, group: true }), da)).toBe('Gruppeprøve: Snigen SG 12');
    expect(checkLabel(CheckSchema.parse({ save: 'con', dc: 13 }), da)).toBe('Kon-redningsslag SG 13');
    expect(checkLabel(CheckSchema.parse({ ability: 'str', dc: 10 }), da)).toBe('Sty-prøve SG 10');
    expect(checkLabel(CheckSchema.parse({ save: 'con', dc: 13 }))).toBe('Con save DC 13');
    expect(checkLabel(CheckSchema.parse({ ability: 'str', dc: 10 }))).toBe('Str check DC 10');
  });

  it('offered actions carry Danish check labels and the Danish way out of a talk', () => {
    const c = ctx('da');
    const offered = availableActions(c);
    for (const a of offered) if (a.check) expect(a.check).toMatch(/ SG \d+$/);
    const talk = offered.find((a) => a.kind === 'talk');
    expect(talk).toBeDefined();
    perform(c, talk!.id);
    expect(availableActions(c).at(-1)?.label).toBe('Afslut samtalen');
  });

  it('Look around button, and its Danish text still means look', () => {
    const [look] = dataSuggestions([], da);
    expect(look).toEqual({ id: 'say:look', label: 'Se dig omkring', say: 'Jeg ser mig grundigt omkring.' });
    expect(dataSuggestions([])[0]?.label).toBe('Look around');
    expect(keywordIntent(look!.say!, { actions: [], npcs: [], pois: [] } as never).action).toBe('look');
  });

  it('summary labels', () => {
    const c = ctx('da');
    c.state.summaryUpTo = c.state.log.at(-1)?.id ?? 0;
    c.state.log.push({ id: 900, kind: 'player', text: 'Jeg vinker.', at: 0 } as never, { id: 901, kind: 'dialogue', text: 'Hej!', at: 0 } as never);
    expect(linesSince(c.state, da).lines).toEqual(['Helten: Jeg vinker.', 'Nogen: Hej!']);
    expect(templateSummary('', ['Helten: Jeg vinker. Så går jeg.'])).toBe('Helten: Jeg vinker.');
  });

  it('template backstory', () => {
    const summary = { name: '', species: 'Elf', className: 'Wizard', background: 'Sage' };
    const text = templateBackstory({ ...summary, language: 'da' });
    expect(text).toMatch(/^Du er en vandringsmand, en elf wizard, opvokset i en lille by/);
    expect(text).toContain('støvede bøger');
    expect(templateBackstory(summary)).toMatch(/^You are a wanderer, a elf wizard raised in a small town/);
    expect(templateBackstory({ ...summary, language: 'xx' as never })).toMatch(/^You are/);
  });
});
