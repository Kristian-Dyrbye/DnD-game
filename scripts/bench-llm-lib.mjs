/**
 * Pure helpers for scripts/bench-llm.mjs (A010), kept separate so they can be unit-tested without
 * Ollama: the benchmark tasks (narration + intent JSON, shaped like the game's real prompts),
 * JSON validation of intent replies, and the scoring that picks a default model.
 */

/** Intent JSON schema (same fields as src/engine/adventure/intent.ts IntentSchema). */
export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['choose_action', 'skill_check', 'talk', 'move', 'look', 'attack', 'use_item', 'cast_spell', 'rest', 'other'] },
    actionId: { type: 'string' },
    skill: { type: 'string' },
    target: { type: 'string' },
    approach: { type: 'string' },
  },
  required: ['action'],
};

const ACTIONS = new Set(INTENT_SCHEMA.properties.action.enum);

export const NARRATION_TASKS = [
  {
    id: 'scene',
    messages: [
      { role: 'system', content: 'You are the Dungeon Master of a grim fantasy game. Narrate in second person, 2 short paragraphs, vivid but concise. Never invent mechanics; follow the FIXED FACTS exactly.' },
      { role: 'user', content: 'SCENE: Millbrook green at dusk; shutters slam; a dog howls at the old well.\nFIXED FACTS:\n- Chalked on the well capstone: a black mouth ringed with seven teeth.\n- Wet barefoot prints lead toward Gallows Hill.\nTASK: Describe the hero arriving in this scene, weaving in the fixed facts.' },
    ],
  },
  {
    id: 'outcome',
    messages: [
      { role: 'system', content: 'You are the Dungeon Master. Narrate the result in 2-4 sentences. Follow the FIXED FACTS exactly; no numbers.' },
      { role: 'user', content: 'The player: "I ask the Reeve for the barrow key."\nFIXED FACTS:\n- Persuasion succeeded.\n- The Reeve hands over an iron key and a list of the missing.\nTASK: Narrate what happens.' },
    ],
  },
];

export const INTENT_TASKS = [
  { text: 'I try to talk the guard into letting us pass', expect: ['skill_check', 'talk', 'choose_action'] },
  { text: 'I climb the wall behind the stables', expect: ['skill_check', 'move', 'choose_action'] },
  { text: 'I attack the cultist with my sword', expect: ['attack'] },
  { text: 'I look around the chapel for clues', expect: ['look', 'skill_check'] },
  { text: 'We make camp and sleep', expect: ['rest'] },
].map((t) => ({
  ...t,
  messages: [
    { role: 'system', content: 'Convert the player text into JSON: {"action": one of choose_action|skill_check|talk|move|look|attack|use_item|cast_spell|rest|other, "skill"?, "target"?, "approach"?}. Reply with JSON only.' },
    { role: 'user', content: `Offered actions: talk_reeve (Ask the Reeve), exit.hill (Go to Gallows Hill).\nPlayer: ${t.text}` },
  ],
}));

/** Is this reply a valid intent (parses, known action)? Returns the action or null. */
export function parseIntentReply(text) {
  try {
    const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return obj && typeof obj.action === 'string' && ACTIONS.has(obj.action) ? obj.action : null;
  } catch {
    return null;
  }
}

/**
 * Score a model: JSON validity matters most (a broken intent falls back to keywords), then sensible
 * intents, then speed (tokens/s, time to first token), and memory must fit the 3 GB budget.
 */
export function scoreModel(r) {
  if (r.error) return -1;
  const fits = r.memoryMB === undefined || r.memoryMB <= 3200;
  const json = r.jsonValid / Math.max(1, r.jsonTotal);
  const sense = r.intentSensible / Math.max(1, r.jsonTotal);
  const speed = Math.min(1, r.tokensPerSecond / 25);
  const ttft = r.firstTokenMs ? Math.max(0, 1 - r.firstTokenMs / 8000) : 0;
  return Math.round((json * 50 + sense * 20 + speed * 20 + ttft * 10) * (fits ? 1 : 0.3) * 10) / 10;
}

/** Best model by score (ties: smaller memory). */
export function pickBest(results) {
  return [...results].filter((r) => !r.error).sort((a, b) => scoreModel(b) - scoreModel(a) || (a.memoryMB ?? 0) - (b.memoryMB ?? 0))[0];
}
