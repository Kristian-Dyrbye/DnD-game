import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import loreJson from '../../../data/world/lore.json';
import { gatherNarrationContext } from '../../llm/context/gather';
import { MockLlm } from '../../llm/mock';
import { suggestIdeas, suggestMessages } from '../../llm/prompts/suggest';
import type { LlmProvider } from '../../llm/types';
import type { ServerEvent, SuggestedAction } from '../../shared/protocol';
import { buildCharacter } from '../character/builder';
import { toBuildInput } from '../character/creator';
import { quickBuild } from '../character/quickBuild';
import { Rng } from '../core/rng';
import { loadSrd } from '../data/srdBundle';
import { GameSession, newGameState } from '../session/GameSession';
import { LoreSchema } from '../world/lore';
import type { AvailableAction } from './runner';
import { availableActions, startAdventure } from './runner';
import { adventureActionPort } from './sessionActions';
import { dataSuggestions, mergeSuggestions, MAX_SUGGESTIONS } from './suggestions';
import { validateAdventure } from './validate';

const db = loadSrd();
const lore = LoreSchema.parse(loreJson);
const adventure = validateAdventure(structuredClone(demo), db).adventure!;
const hero = () => buildCharacter(toBuildInput(quickBuild('ranger', db, Rng.fromSeed('r'))), db);

const offered: AvailableAction[] = [
  { id: 'exit.to_mill', label: 'Walk to the old mill', kind: 'exit' },
  { id: 'talk_mayor', label: 'Speak with Mayor Hobb', kind: 'action' },
  { id: 'notice_board.read', label: 'Study the notices', kind: 'poi', check: 'Investigation DC 10' },
];

describe('dataSuggestions', () => {
  it('lists actions before exits, shows check labels, and pads short lists with Look around', () => {
    expect(dataSuggestions(offered).map((s) => s.label)).toEqual(['Speak with Mayor Hobb', 'Study the notices (Investigation DC 10)', 'Walk to the old mill']);
    const short = dataSuggestions([offered[0]!]);
    expect(short).toEqual([
      { id: 'exit.to_mill', label: 'Walk to the old mill' },
      { id: 'say:look', label: 'Look around', say: 'I look around carefully.' },
    ]);
  });
});

describe('mergeSuggestions', () => {
  it('puts ideas first, maps real ids to buttons, keeps omitted offered actions, drops junk', () => {
    const merged = mergeSuggestions(offered, [
      { label: 'Ask the baker about the miller' },
      { label: 'Talk to Hobb', actionId: 'talk_mayor' },
      { label: 'Open the dragon vault', actionId: 'dragon_vault' },
      { label: 'ask the baker about the miller' },
      { label: 'x'.repeat(80) },
    ]);
    const ids = merged.map((s: SuggestedAction) => s.id);
    expect(merged[0]).toEqual({ id: 'say:0', label: 'Ask the baker about the miller', say: 'Ask the baker about the miller' });
    expect(merged[1]).toEqual({ id: 'talk_mayor', label: 'Speak with Mayor Hobb' });
    expect(merged[2]).toEqual({ id: 'say:1', label: 'Open the dragon vault', say: 'Open the dragon vault' });
    expect(ids).toContain('exit.to_mill');
    expect(ids).toContain('notice_board.read');
    expect(ids.filter((i) => i === 'talk_mayor')).toHaveLength(1);
    expect(merged.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });
});

describe('suggestIdeas (LLM)', () => {
  const ctxInfo = () => {
    const ctx = { state: newGameState(hero(), 'heroic', 1), adventure, rng: Rng.fromSeed(1), db };
    startAdventure(ctx);
    return { info: gatherNarrationContext(ctx.state, lore, adventure, db), offered: availableActions(ctx) };
  };
  const real = (llm: MockLlm): LlmProvider => ({ name: 'ollama', chat: llm.chat.bind(llm), stream: llm.stream.bind(llm), listModels: llm.listModels.bind(llm), status: llm.status.bind(llm) });

  it('parses valid JSON ideas', async () => {
    const { info, offered: o } = ctxInfo();
    const llm = new MockLlm({ script: ['{"suggestions":[{"label":"Buy a warm loaf","actionId":""},{"label":"Read the notices","actionId":"notice_board.read"}]}'] });
    expect(await suggestIdeas(real(llm), info, o)).toEqual([{ label: 'Buy a warm loaf' }, { label: 'Read the notices', actionId: 'notice_board.read' }]);
    expect(llm.calls[0]!.opts.task).toBe('suggest');
    expect(suggestMessages(info, o)[1]!.content).toContain('talk_mayor: Speak with Mayor Hobb');
  });

  it('returns [] for the mock provider and when the model fails twice', async () => {
    const { info, offered: o } = ctxInfo();
    expect(await suggestIdeas(new MockLlm(), info, o)).toEqual([]);
    const llm = new MockLlm({ script: ['nope', '{"suggestions":[]}'] });
    expect(await suggestIdeas(real(llm), info, o)).toEqual([]);
  });
});

describe('suggestions in the session', () => {
  it('shows data buttons at once, then LLM ideas; stale ideas are dropped', async () => {
    let release: (ideas: { label: string; actionId?: string }[]) => void = () => undefined;
    const port = adventureActionPort(new Map([[adventure.id, adventure]]), adventure.id, db, {
      suggester: () => new Promise((r) => (release = r)),
    });
    const session = new GameSession({ actions: port, newSeed: () => 's' });
    const events: ServerEvent[] = [];
    session.on((e) => events.push(e));
    await session.handle({ type: 'new_game', hero: hero(), mode: 'heroic' });
    const sugg = () => events.filter((e): e is Extract<ServerEvent, { type: 'suggestions' }> => e.type === 'suggestions');
    expect(sugg()).toHaveLength(1);
    release([{ label: 'Buy a warm loaf' }]);
    await port.idle();
    expect(sugg()).toHaveLength(2);
    expect(sugg()[1]!.actions[0]).toEqual({ id: 'say:0', label: 'Buy a warm loaf', say: 'Buy a warm loaf' });

    // The player acts before the next ideas arrive → they are not shown.
    await session.handle({ type: 'choose', actionId: 'talk_mayor' });
    const pending = release;
    await session.handle({ type: 'choose', actionId: 'exit.to_mill' });
    const before = sugg().length;
    pending([{ label: 'Old idea' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(sugg().length).toBe(before);
  });
});
