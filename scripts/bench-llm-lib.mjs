/**
 * Pure helpers for scripts/bench-llm.mjs (A010), kept separate so they can be unit-tested without
 * Ollama: the benchmark tasks (narration + intent JSON, shaped like the game's real prompts),
 * JSON validation of intent replies, and the scoring that picks a default model. Danish variants
 * of the tasks + a rough "is this Danish?" check for `--lang=da` (A150).
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

// Danish tasks (A150): the game's prompts keep English instructions and add the reply-language rule
// (src/llm/prompts/language.ts); facts, labels and the player's words are Danish.
const DA_RULE = 'Write your whole reply in Danish (dansk). Use natural, idiomatic Danish (not a word-for-word translation of English); address the hero as "du". Keep the names of people and places exactly as given.';

export const DA_NARRATION_TASKS = [
  {
    id: 'scene',
    messages: [
      { role: 'system', content: `You are the Dungeon Master of a grim fantasy game. Narrate in second person, 3 to 5 sentences, vivid but concise. Never invent mechanics; follow the FIXED FACTS exactly.\n- ${DA_RULE}` },
      { role: 'user', content: 'SCENE: Gadekæret i Millbrook i skumringen; skodder smækker; en hund hyler ved den gamle brønd.\nFIXED FACTS:\n- Kridtet på brøndens dæksten: en sort mund omkranset af syv tænder.\n- Våde, bare fodspor fører mod Galgebakken.\nTASK: Describe the hero arriving in this scene, weaving in the fixed facts. Write it in Danish (dansk).' },
    ],
  },
  {
    id: 'outcome',
    messages: [
      { role: 'system', content: `You are the Dungeon Master. Narrate the result in 3 to 5 sentences. Follow the FIXED FACTS exactly; no numbers.\n- ${DA_RULE}` },
      { role: 'user', content: 'The player: "Jeg beder fogeden om nøglen til gravhøjen."\nFIXED FACTS:\n- Overtalelse lykkedes.\n- Fogeden giver dig en jernnøgle og en liste over de forsvundne.\nTASK: Narrate what happens. Write it in Danish (dansk).' },
    ],
  },
  {
    id: 'combat',
    messages: [
      { role: 'system', content: `You are the Dungeon Master. In one or two short, vivid sentences, narrate these moments of the fight. No numbers or game terms.\n- ${DA_RULE}` },
      { role: 'user', content: 'FIXED FACTS:\n1. Mira rammer kultisten med sit langsværd.\n2. Kultisten falder om.\nTASK: Narrate these moments. Write it in Danish (dansk).' },
    ],
  },
];

export const DA_INTENT_TASKS = [
  { text: 'Jeg prøver at overtale vagten til at lukke os igennem', expect: ['skill_check', 'talk', 'choose_action'] },
  { text: 'Jeg klatrer over muren bag staldene', expect: ['skill_check', 'move', 'choose_action'] },
  { text: 'Jeg angriber kultisten med mit sværd', expect: ['attack'] },
  { text: 'Jeg kigger mig omkring i kapellet efter spor', expect: ['look', 'skill_check'] },
  { text: 'Vi slår lejr og sover', expect: ['rest'] },
].map((t) => ({
  ...t,
  messages: [
    { role: 'system', content: 'Convert the player text into JSON: {"action": one of choose_action|skill_check|talk|move|look|attack|use_item|cast_spell|rest|other, "skill"?, "target"?, "approach"?}. Reply with JSON only.\n- The player writes in Danish (dansk); the action labels are in that language too. Ids and enum values stay English.' },
    { role: 'user', content: `Offered actions: talk_reeve (Tal med fogeden), exit.hill (Gå til Galgebakken).\nPlayer: ${t.text}` },
  ],
}));

const DA_MARKERS = new Set(['og', 'er', 'du', 'det', 'en', 'et', 'af', 'på', 'til', 'med', 'som', 'den', 'har', 'ikke', 'din', 'dig', 'der', 'men', 'kan', 'dine', 'sig', 'fra', 'over', 'mod']);
const EN_MARKERS = new Set(['the', 'and', 'you', 'is', 'of', 'to', 'your', 'with', 'it', 'are', 'as', 'from', 'into', 'toward', 'towards']);

/** Rough language check of a reply: mostly Danish function words, few English ones. */
export function looksDanish(text) {
  const ws = String(text).toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const da = ws.filter((w) => DA_MARKERS.has(w)).length;
  const en = ws.filter((w) => EN_MARKERS.has(w)).length;
  return da >= 3 && da > en * 3;
}

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
  // Language runs (--lang=da): replies in the wrong language halve the score at worst.
  const lang = r.langTotal ? 0.5 + 0.5 * (r.langOk / r.langTotal) : 1;
  return Math.round((json * 50 + sense * 20 + speed * 20 + ttft * 10) * (fits ? 1 : 0.3) * lang * 10) / 10;
}

/** Best model by score (ties: smaller memory). */
export function pickBest(results) {
  return [...results].filter((r) => !r.error).sort((a, b) => scoreModel(b) - scoreModel(a) || (a.memoryMB ?? 0) - (b.memoryMB ?? 0))[0];
}
