/**
 * AI in Danish (A150): every LLM prompt asks for the reply in the session language (English prompts
 * unchanged), the language reaches the prompts from the session, and the keyword fallback parser
 * understands Danish free text in a Danish session (checked on the Danish starter arc).
 */
import { describe, expect, it } from 'vitest';
import companionsJson from '../data/companions.json';
import flagsJson from '../data/adventures/flags.json';
import starter from '../data/adventures/starter/millbrook_disappearances.json';
import { intentContext, keywordIntent, refineIntent, validateIntent } from '../src/engine/adventure/intent';
import { getProgress, startAdventure, type RunContext } from '../src/engine/adventure/runner';
import { updateSummary } from '../src/engine/adventure/summary';
import { validateAdventure } from '../src/engine/adventure/validate';
import { buildCharacter } from '../src/engine/character/builder';
import { toBuildInput } from '../src/engine/character/creator';
import { quickBuild } from '../src/engine/character/quickBuild';
import { Rng } from '../src/engine/core/rng';
import { loadSrd } from '../src/engine/data/srdBundle';
import { messages } from '../src/engine/i18n';
import { speakBanter } from '../src/engine/party/banter';
import { CompanionRosterSchema } from '../src/engine/party/companions';
import { newGameState } from '../src/engine/session/GameSession';
import { FlagRegistry } from '../src/engine/world/flags';
import { BUNDLED_TRANSLATIONS } from '../src/host/bundled';
import { describeMember } from '../src/llm/context/gather';
import { buildNarrationPrompt, type NarrationContext } from '../src/llm/context/narration';
import { backstoryMessages } from '../src/llm/prompts/backstory';
import { banterMessages } from '../src/llm/prompts/banter';
import { intentMessages } from '../src/llm/prompts/intent';
import { suggestMessages } from '../src/llm/prompts/suggest';
import { summaryMessages } from '../src/llm/prompts/summary';
import { applyOverlay } from '../src/shared/contentI18n';
import type { Language } from '../src/shared/i18nCore';

const db = loadSrd();
const roster = CompanionRosterSchema.parse(companionsJson);
const registry = () => FlagRegistry.fromJson(flagsJson);
const EN = validateAdventure(structuredClone(starter), db, registry(), roster).adventure!;
const DA = applyOverlay(EN, BUNDLED_TRANSLATIONS.da!.millbrook_disappearances);
const hero = () => buildCharacter(toBuildInput(quickBuild('fighter', db, Rng.fromSeed('a150'))), db);

/** A Danish (or English) session standing in `sceneId` of the starter arc. */
function at(sceneId: string, lang: Language = 'da'): RunContext {
  const c: RunContext = { state: newGameState(hero(), 'heroic', 'a150'), adventure: lang === 'da' ? DA : EN, rng: Rng.fromSeed(5), db, flags: registry(), companions: roster, msgs: messages(lang) };
  startAdventure(c);
  getProgress(c.state)!.sceneId = sceneId;
  return c;
}

/** What the game makes of free text without the LLM: keyword parse → refine → validate (as sessionActions.say). */
function understood(c: RunContext, text: string) {
  const ictx = intentContext(c);
  return validateIntent(refineIntent(keywordIntent(text, ictx), text, ictx), ictx);
}

describe('Danish keyword intents (no LLM)', () => {
  it('the intent context carries the session language (English stays unmarked)', () => {
    expect(intentContext(at('millbrook_arrival')).lang).toBe('da');
    expect(intentContext(at('millbrook_arrival', 'en')).lang).toBeUndefined();
  });

  it('Danish keywords and skill verbs pick the offered actions', () => {
    expect(understood(at('millbrook_arrival'), 'Jeg ser nærmere på kridtet').actionId).toBe('well.examine');
    expect(understood(at('gallows_hill_trail'), 'Jeg følger sporene op ad bakken').actionId).toBe('track');
    expect(understood(at('plough_tavern_talk'), 'Jeg prøver at overtale fogeden til at hjælpe os').actionId).toBe('persuade_reeve');
    expect(understood(at('plough_tavern_talk'), 'Jeg truer ham, til han giver mig nøglen').actionId).toBe('intimidate_reeve');
    expect(understood(at('plough_tavern_talk'), 'Lyver hun, når hun taler om møllen?').actionId).toBe('insight_oda');
  });

  it('asking Corwin to come along recruits him; a plain question stays talk', () => {
    const c = at('marrows_goods_and_oath');
    c.state.flags['world.corwin_status'] = 'met';
    expect(understood(c, 'Jeg spørger Ser Corwin, om han vil drage med mig sydpå').actionId).toBe('recruit');
    expect(understood(c, 'Vil du slutte dig til mig?').actionId).toBe('recruit');
    const plain = understood(c, 'Jeg spørger Ser Corwin, hvordan han har sovet');
    expect(plain.intent.action).toBe('talk');
    expect(plain.actionId).toBeUndefined();
  });

  it('Danish verbs map to intent types, with æ/ø/å and "slår lejr" as camping', () => {
    const ictx = intentContext(at('gallows_hill_trail'));
    const action = (text: string) => keywordIntent(text, ictx).action;
    expect(action('Jeg angriber kultisten')).toBe('attack');
    expect(action('Vi slår lejr og sover')).toBe('rest');
    expect(action('Jeg ser mig omkring')).toBe('look');
    expect(action('Jeg drikker min eliksir')).toBe('use_item');
    expect(action('Jeg løber væk')).toBe('move');
    expect(keywordIntent('Jeg går tilbage', ictx)).toMatchObject({ action: 'choose_action', actionId: 'exit.back' }); // "Vend tilbage til landsbyen"
    expect(action('Jeg sniger mig forbi')).toBe('skill_check');
    expect(keywordIntent('Jeg sniger mig forbi', ictx).skill).toBe('stealth');
    expect(keywordIntent('Jeg klatrer op på muren', ictx).skill).toBe('athletics');
    expect(keywordIntent('Jeg beder en bøn til Solenne', ictx).skill).toBe('religion');
    // "beder … om" is asking, not praying.
    expect(keywordIntent('Jeg beder dem om at gå', ictx).skill).toBeUndefined();
  });

  it('an English session keeps the English lists only', () => {
    const ictx = intentContext(at('gallows_hill_trail', 'en'));
    expect(keywordIntent('Jeg angriber kultisten', ictx).action).toBe('other');
    expect(keywordIntent('I attack the cultist', ictx).action).toBe('attack');
  });

  it('English words still work in a Danish session', () => {
    expect(keywordIntent('I attack the cultist', intentContext(at('gallows_hill_trail'))).action).toBe('attack');
  });
});

const ctx = (): NarrationContext => ({ party: ['Mira, human fighter 1, 11/11 HP'], where: 'Millbrook', when: 'morning', threats: [], flags: [], summary: '', recent: [], cards: [], scene: 'The village green.' });

describe('prompts ask for the session language', () => {
  it('narration: a Danish rule in the system prompt and a reminder in the task; English unchanged', () => {
    const en = buildNarrationPrompt(ctx(), { kind: 'scene', facts: ['A dog barks.'] });
    const enSame = buildNarrationPrompt(ctx(), { kind: 'scene', facts: ['A dog barks.'], language: 'en' });
    expect(enSame.messages).toEqual(en.messages);
    expect(JSON.stringify(en.messages)).not.toContain('Danish');
    const da = buildNarrationPrompt(ctx(), { kind: 'combat', facts: ['Mira rammer kultisten.'], language: 'da' });
    expect(da.messages[0]!.content).toContain('Write your whole reply in Danish (dansk)');
    expect(da.messages[0]!.content).toContain('"du"');
    expect(da.messages[1]!.content.split('TASK:\n')[1]).toMatch(/Write it in Danish \(dansk\)\.$/);
  });

  it('suggestions, summary, banter, backstory and intent prompts', () => {
    const offered = [{ id: 'listen', label: 'Lyt til landsbyen', kind: 'action' as const }];
    expect(suggestMessages(ctx(), offered, 'da')[0]!.content).toContain('Write every "label" in Danish (dansk). JSON keys, ids and enum values stay exactly as given');
    expect(suggestMessages(ctx(), offered)[0]!.content).not.toContain('Danish');
    expect(summaryMessages('', ['x'], 'da')[0]!.content).toContain('in Danish (dansk)');
    expect(summaryMessages('', ['x'])[0]!.content).not.toContain('Danish');
    expect(banterMessages('Nettle', 'Blunt.', 'Gruff.', 'content', 'x', 'da')[0]!.content).toContain('in Danish (dansk)');
    expect(banterMessages('Nettle', 'Blunt.', 'Gruff.', 'content', 'x')[0]!.content).not.toContain('Danish');
    const summary = { name: 'Mira', species: 'Human', className: 'Fighter', background: 'Soldier' };
    expect(backstoryMessages({ ...summary, language: 'da' })[0]!.content).toContain('in Danish (dansk)');
    expect(backstoryMessages(summary)[0]!.content).not.toContain('Danish');
    expect(intentMessages('Jeg kigger', intentContext(at('millbrook_arrival')))[0]!.content).toContain('The player writes in Danish (dansk)');
    expect(intentMessages('I look', intentContext(at('millbrook_arrival', 'en')))[0]!.content).not.toContain('Danish');
  });

  it('party lines name species and classes in the reply language', () => {
    const h = hero();
    expect(describeMember(h, db, 'da')).toContain('Kriger 1');
    expect(describeMember(h, db)).toContain('Fighter 1');
  });
});

describe('the session language reaches the AI ports', () => {
  it('the summarizer gets the session language', async () => {
    const c = at('millbrook_arrival');
    c.state.log.push({ id: 99, kind: 'narration', text: 'Du ankommer.', at: 0 } as never);
    const seen: (Language | undefined)[] = [];
    await updateSummary(c.state, async (_prev, _lines, lang) => (seen.push(lang), 'Helten ankom til Millbrook og så sig omkring.'), messages('da'));
    expect(seen).toEqual(['da']);
    expect(c.state.summary).toBe('Helten ankom til Millbrook og så sig omkring.');
  });

  it('the banter generator gets the session language', async () => {
    const c = at('millbrook_arrival');
    const seen: (Language | undefined)[] = [];
    const line = await speakBanter(c.state, roster.companions[0]!, 'x', async (_d, _m, _c, lang) => (seen.push(lang), 'Rødder og råd!'), 'da');
    expect(seen).toEqual(['da']);
    expect(line).toBe('Rødder og råd!');
  });
});
