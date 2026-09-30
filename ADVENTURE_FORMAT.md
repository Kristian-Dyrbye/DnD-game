# Adventure Format (v1)

This is how to write adventures for Solo D&D. Authored arcs and generated side quests use the same format, so one engine plays both.

- **Schema (source of truth):** `src/engine/adventure/schema.ts` (zod).
- **Validator:** `validateAdventure(json, db)` in `src/engine/adventure/validate.ts`.
- **Runner:** `src/engine/adventure/runner.ts`.
- **Where files go:** put adventures anywhere under `data/adventures/` as `.json`. The server loads every file that has a `formatVersion`. Invalid files are skipped and logged.
- **Example:** `data/adventures/demo/millbrook_demo.json` is small and covers every feature.

**Core idea:** the data is the skeleton. It says where the hero can be, what they can try, the DCs, and what changes. The LLM only narrates: it describes seeds and fixed facts and voices NPCs. It never decides outcomes, and it never invents loot or rewards.

## Top level

| Field | Type | Notes |
|---|---|---|
| `formatVersion` | `1` | Required. |
| `id` | id | Lowercase `snake_case`. Unique across all adventures. |
| `name`, `summary` | text | |
| `arcId` | string? | Campaign arc. The arc's flags use the `arc.<arcId>.` prefix. |
| `kind` | `starter` \| `arc` \| `side_quest` \| `test` | Defaults to `arc`. |
| `levelRange` | `[min, max]` | |
| `regionId` | string? | Lore region. It sets the narrator's tone. |
| `start` | `{ chapter, scene }` | Where a new playthrough begins. |
| `chapters` | Chapter[] | At least one. |
| `npcs`, `encounters`, `beats`, `lootTables` | arrays | Scenes and outcomes refer to these by id. |
| `flags` | `{ id, description, type?, default?, values?, min?, max? }[]` | Lists the flags this adventure reads or writes. A local flag may declare a `type` (`number`, `string` or `boolean`), a `default`, allowed `values` and `min`/`max` bounds; the runner uses them (defaults, clamping) and the validator checks writes against them. |
| `endings` | `{ id, name, text, next? }[]` | An outcome with `ending` finishes the adventure. `next` names the adventure id that starts straight away — this is how the campaign chains the starter arc into chapter 1, chapter 1 into chapter 2, and so on. |
| `improvisedDifficulty` | `very_easy` … `nearly_impossible` | The DC tier for checks the player improvises in free text (SRD table). Defaults to `medium` (DC 15). A scene can override it. |

## Chapters and scenes

A chapter has `id`, `name`, `summary`, `start` (a scene id) and `scenes`.

A scene has these fields:

- `id`, `name`.
- `locationId`: optional. A location id from `data/world/lore.json`.
- `seed`: the description seed for the narrator.
- `variants`: `[{ if, seed }]`. Extra seed text used when the condition holds. This is how earlier choices visibly change a place.
- `revisitSeed`: optional, a string or a list of strings. Replaces `seed` when the party comes back to a scene it has seen (one entry is picked per return), so the no-AI template narration doesn't repeat the first-arrival text. Variants still apply.
- `npcs`: NPC ids present in the scene.
- `pois`: points of interest, `{ id, name, seed, if?, actions[] }`.
- `actions`: things to do in the scene (see below).
- `exits`: `{ id, label, to, if?, check?, minutes }`. A gated exit with a failed `check` keeps the hero in place and applies `check.failure`.
- `onEnter`: an outcome applied on the **first** visit only.
- `mood`: a music hint.
- `improvisedDifficulty`: an optional DC tier for improvised checks in this scene.

### Action ids

The runner and the suggested-action buttons use these ids:

- Scene action: `<actionId>`.
- POI action: `<poiId>.<actionId>`.
- Exit: `exit.<exitId>`.
- Conversations: `talk.<npcId>.<conversationId>`, `dlg.<nodeId>.<optionId>`, `dlg.bye` (see Conversations).

## Actions

```json
{ "id": "read", "label": "Study the notices", "once": true, "if": { "flag": "x" },
  "keywords": ["notice", "board"],
  "check": { "skill": "investigation", "dc": 10, "success": { ... }, "failure": { ... } },
  "outcome": { ... } }
```

- `if` hides the action unless the condition holds.
- `once` removes the action after it has been used (tracked per scene).
- `check` rolls with the hero's real modifiers. It needs exactly one of the following:
  - `skill`, optionally with an `ability` override (for example Intimidation with Strength).
  - A plain `ability`.
  - `save`.
- `dc` is always set in the data (1–30).
- `advantageIf` / `disadvantageIf`: `[{ if, source }]`.
- `group: true` makes it a **group check** (SRD): the hero and every conscious companion roll, and the check succeeds if at least half of them succeed (sneaking past as a party, crossing a rope bridge). The button reads "Group Stealth DC 13".
- `outcome` is applied after the check. On an action without a check, it is the whole result.
- `keywords` let free text match the action until intent parsing lands.

## Free text and improvised checks

Free text goes through the intent parser. The engine then decides what happens:

1. If the text matches an offered action or exit, that action is performed.
2. If the text describes a skill attempt ("I persuade...", "I force..."), the engine uses an offered action or exit whose check uses that skill.
3. Otherwise the attempt is **improvised**. It rolls against the scene's `improvisedDifficulty` DC and produces a fact only, never flags or loot.
4. Each skill and target combination can be improvised once per scene entry.

To make an approach matter mechanically, author it as an action with a `check`.

## Outcomes

Every field is optional:

| Field | Effect |
|---|---|
| `text` | A **fixed fact** that the narrator must convey. |
| `texts` | `["…", "…"]`: variants of a fact; one is picked (seeded by campaign and time, the dice are not touched) and told after `text`. Use it on outcomes the player can see more than once. |
| `conditions` | `[{ "condition": "poisoned", "target": "hero" \| "party", "minutes"?: 60, "remove"?: false }]`: SRD conditions from the story (bad ale, a terrifying vision). With `minutes` they end on their own when that much game time passes (a system line says so); without, they last until an outcome with `"remove": true` ends them. They count in checks and fights like any condition. |
| `companionReturns` | `{ "id": "rook", "loyalty"?: 40 }`: a companion who waited, left or betrayed the party comes back (never the dead). Their kept sheet rejoins, levelled to the hero; loyalty rises to at least `loyalty`. If the party is full they wait. |
| `flags` | `[{ "set": "f", "value": true }, { "inc": "f", "by": 1 }, { "clear": "f" }]` |
| `items` | `[{ "itemId": "rope", "quantity": 1 }]`. Item ids are SRD gear, weapon, armor or magic item ids. |
| `coins` | Copper pieces (`1000` = 10 gp). |
| `loot` | Rolls a loot table by id. |
| `xp` | Added to the hero. |
| `reputation` | `[{ "faction": "id", "delta": 1 }]`. Faction ids come from lore. Half of the change ripples to allied factions, and the opposite half to hostile ones. |
| `minutes` | Time passes. |
| `encounter` | Starts an encounter by id. |
| `recruit` | A companion id from `data/companions.json` joins the party. If the party already has 3 companions, they wait instead. |
| `companionLeaves` | `{ "id": "corwin", "status": "waiting" \| "left" \| "betrayed" \| "dead" }` |
| `approval` | `[{ "companion": "nettle", "delta": 10 }]`: ±5 for minor choices, ±10 significant, ±20 defining. Only companions in the party react. Loyalty is kept in `world.<id>_loyalty` (0–100). Author leave or betray points as actions or beats with `{ "flag": "world.<id>_loyalty", "lte": 20 }`. |
| `goto` | Moves to a scene. This is applied last. |
| `ending` | Finishes the adventure. |
| `revealRoom` | `{ "map": "keep", "room": "vault" }`: lifts the fog from a room (a map found, a view from a balcony). Fights also reveal their room. |
| `rest` | `"short"` or `"long"`: the party rests here (use it only in safe places). A short rest spends Hit Dice automatically (1 hour); a long rest restores HP, Hit Dice, spell slots and daily resources (8 hours). |
| `tip` | A one-line tutorial tip, shown as a system line the first time this outcome happens in a campaign (the starter arc teaches with these). |
| `removeItems` | `[{ "itemId": "lance", "quantity": 1 }]`: takes items from the hero (as many as they carry). Pair it with an `item` condition. |
| `cost` | Copper paid (`500` = 5 gp). If the hero can't pay, the player is told so and nothing else in the outcome happens. Gate the action with a `coins` condition to hide it instead. |
| `damage` | `{ "dice": "2d6", "type": "fire", "target": "hero" \| "party", "save"?: { "ability": "dex", "dc": 13, "half": true } }`. One roll is shared by all targets; a successful save halves it (or negates it with `half: false`). Heroic mode never drops a character below 1 HP; in Hardcore a character can drop to 0 HP (unconscious and stable). |
| `scar` | `{ "description": "rope burn from the gallows", "location"?: "neck", "damageType"?: "fire" }`: a permanent scar on the hero, logged with the scene and adventure as its origin. Without `location`, a plausible spot for the damage type is picked. Locations: left/right_cheek, brow, jaw, neck, chest, back, left/right_shoulder, left/right_arm, left/right_hand, left/right_leg. Fights also leave scars on their own (critical hits taken, dropping to 0 HP). |
| `exhaustion` | Exhaustion levels gained by the whole party (negative values remove levels). |

Recruit, approval, companionLeaves and companionReturns take effect in the same step, so a beat triggered by the new status or loyalty fires straight away.

## Conditions

Conditions can be nested freely:

```json
{ "flag": "arc.a1.mayor_saved" }                    // truthy
{ "flag": "arc.a1.bribe", "eq": "silver_ring" }
{ "flag": "arc.a1.deaths", "gte": 2, "lte": 5 }
{ "flag": "world.dragon_slain", "exists": false }
{ "all": [ ... ] }  { "any": [ ... ] }  { "not": { ... } }
{ "timeOfDay": ["dusk", "night"] }                   // dawn 5–7, day 7–18, dusk 18–20, night
{ "weather": ["rain", "storm"] }
{ "reputation": { "faction": "harbor_guild", "gte": 10 } }
{ "reputation": { "faction": "crown_of_aurelmark", "tier": "friendly" } }   // at least Friendly
{ "level": { "gte": 3 } }
{ "visited": "scene_id" }
{ "hours": { "from": 6, "to": 14 } }                   // hour window [from, to); 18 → 2 wraps midnight
{ "coins": { "gte": 500 } }                          // the hero carries at least 5 gp
{ "item": "dragon_slayer" }                          // the hero carries this item
{ "since": { "flag": "~bribed", "gteHours": 2 } }       // 2+ hours since the flag was last set by an outcome (false if never)
{ "count": { "flags": ["~clue_a", "~clue_b", "~clue_c"], "min": 2 } }   // at least 2 of these are truthy ("max" too)
```

A flag that has never been set is simply unset, so later arcs can safely read flags from arcs the player never finished.

**Flag naming.** Every flag belongs to a namespace:

- `arc.<arcId>.<name>`: arc state, for example `arc.starter.reeve_attitude`.
- `world.<name>`: facts every later arc may read, for example `world.queen_alive`.
- `side.<questId>.<name>`: side quests.
- `adv.<adventureId>.<name>`: tests and demos.

Inside an adventure, you can write `~name` for the adventure's own namespace:

- `arc.<arcId>.` when the adventure has an `arcId`.
- `side.<id>.` for a side quest.
- `adv.<id>.` otherwise.

The loader resolves `~name` to the full id, so saves and later arcs only ever see absolute ids. Any adventure can read any flag, and that is how later arcs react to earlier ones.

**Flag registry.** `data/adventures/flags.json` declares campaign flags with a `type` (`boolean`, `string` or `number`), a `default`, allowed `values` for strings, and `min`/`max` for numbers.

- An unset flag reads as its default in conditions.
- `inc` starts counting from the default.
- Numbers are clamped to their bounds.
- The validator rejects writes of the wrong type or value.
- The validator warns about flags that aren't namespaced or aren't documented. A flag counts as documented if it is in the registry or in the adventure's own `flags` list.

## NPCs

```json
{ "id": "mayor_hobb", "name": "Mayor Hobb", "statBlock": "commoner",
  "personality": "...", "secrets": ["..."], "voice": "Fussy, breathless...",
  "ttsVoice": "optional-voice-id", "factions": ["millbrook_folk"], "attitude": "friendly" }
```

- `statBlock` is an SRD monster id.
- `schedule` is optional: `[{ "scene": "market", "from": 6, "to": 14, "if"?: condition }]`. An NPC with a schedule appears only where and when an entry matches, and scene `npcs` lists are ignored for them. Use it for shopkeepers and night-only visitors.
- Secrets are passed to the LLM only as guidance, never as mechanics.
- `conversations` is optional: dialogue trees with this NPC (see below).

### Conversations

A conversation is a small tree of NPC lines and player replies. It works the same with and without the AI: every reply is an authored button, and the NPC lines are logged word for word as dialogue (the local edition voices them with TTS).

```json
"conversations": [{
  "id": "mill_talk", "label": "Ask Mayor Hobb about the old mill",
  "if": { "not": { "flag": "~rats_cleared" } }, "once": false, "keywords": ["ask", "miller"],
  "start": "greet",
  "nodes": [
    { "id": "greet", "text": "Friend! What can I tell you?", "options": [
      { "id": "miller", "label": "\"What happened to the miller?\"", "once": true, "next": "miller" },
      { "id": "press", "label": "\"Your grain drew those rats, didn't it?\"", "if": { "flag": "~hobb_nervous" },
        "check": { "skill": "intimidation", "dc": 13, "success": { "coins": 500 }, "failure": { "text": "He turns red." } },
        "next": "confess", "nextOnFail": "bluster" },
      { "id": "leave", "label": "\"I'll see what I can do.\"" } ] },
    { "id": "miller", "text": "Aldo? Gone a week now.", "options": [ { "id": "back", "label": "\"Tell me more.\"", "next": "greet" } ] },
    { "id": "confess", "speaker": "mayor_hobb", "text": "All right, all right!", "options": [] },
    { "id": "bluster", "text": "How dare you!" } ]
}]
```

- The conversation is offered as a button (`label`, default "Talk to <name>") wherever the NPC is present (scene `npcs` or `schedule`) and its `if` holds. `once: true` offers it only until it has been started once in this adventure. Free text such as "I talk to the mayor" also opens it.
- While a conversation is open, the only buttons are the current node's options plus "End the conversation". Other scene actions and exits come back when it ends.
- Option fields: `label` (what the hero says or does, logged as the hero's line), `if`, `once` (hidden after it was picked, until the conversation starts again), `check` (with `success`/`failure` outcomes, as for actions), `outcome` (applied after the check), `next` (the node that follows; none = the conversation ends), `nextOnFail` (the node after a failed check; default `next`), `keywords` (free-text matching).
- Node fields: `text` (the line), `speaker` (an NPC id of this adventure; default the conversation's NPC), `options`. A node with no open options ends the conversation after its line.
- An option whose outcome changes scene (`goto`), starts a fight or ends the adventure also ends the conversation.
- Time: starting a conversation takes 10 minutes, each reply 5.
- Action ids: `talk.<npcId>.<conversationId>` starts it; `dlg.<nodeId>.<optionId>` picks a reply; `dlg.bye` leaves.
- The validator checks the start node, every `next`/`nextOnFail`, speakers and the outcomes inside options, and warns about nodes that can't be reached from the start. Conversation gotos and endings count for scene reachability, and the solver can play through conversations.

## Encounters

```json
{ "id": "cellar_rats", "name": "Cellar rats", "monsters": [{ "id": "giant_rat", "count": 2 }],
  "map": "optional-map-id", "terrain": ["barrels (half cover)"],
  "scaling": { "target": "moderate", "pool": ["rat"] }, "bosses": [], "allies": [], "canFlee": true,
  "win": { ... }, "lose": { ... }, "flee": { ... } }
```

- Author the group for a party of four. The game scales it to the real party: the cheapest non-boss monsters are removed while the fight is above the High XP budget, and `scaling.pool` monsters are added while it is below Low.
- `allies`: `[{ "id": "guard", "count": 2 }]` — friendly stat blocks that fight on the party's side, run by the companion AI.
- Any monster or ally group may carry an `if` condition: it only joins when the condition holds, so one encounter can cover several situations instead of variants. The same monster may appear in several groups (e.g. `{ "id": "spy", "count": 1 }` plus `{ "id": "spy", "count": 1, "if": { "not": { "flag": "~pip_scouted" } } }` = one fewer spy once the flag is set); the groups that join are summed before the fight.
- `statOverrides`: `{ "young_red_dragon": { "name": "Pyrraxis", "hpPercent": 60, "ac": 19 } }` — per monster id, a new name, HP (absolute `hp` or `hpPercent` of the stat block) and AC.
- `bosses` lists monster ids that are never removed. When it is empty, the single most expensive monster type counts as the boss.
- In Heroic mode, `lose` is the **defeat outcome** (captured, robbed, rescued...).

## Maps (dungeons and buildings)

Rooms, doors and fog of war on the same grid as combat (spec §11.1):

```json
"maps": [{ "id": "old_mill", "name": "The Old Mill", "width": 10, "height": 13,
  "rooms": [
    { "id": "mill_floor", "name": "Mill floor", "x": 1, "y": 1, "w": 7, "h": 5, "blocking": [{ "x": 4, "y": 2 }] },
    { "id": "cellar", "name": "Cellar", "x": 1, "y": 7, "w": 8, "h": 5, "difficult": [{ "x": 5, "y": 10 }] }
  ],
  "doors": [{ "x": 4, "y": 5, "side": "S", "locked": false }] }]
```

- Rooms are rectangles of 5-ft squares and must not overlap. Squares outside every room are solid rock. Where two rooms touch, the edge is a wall unless a door is listed there.
- A door sits on one `side` of square (`x`, `y`) and must join two rooms. Locked doors start closed.
- Give a scene `"map": { "id": "old_mill", "room": "mill_floor" }`. Entering the scene reveals the room; the other rooms stay under fog of war, and the player sees the map beside the story.
- A fight in a mapped scene uses the same map. The party starts at the door it came through and the foes at the far side of the room. An encounter can name a different `map` and `room`.

## Beats

```json
{ "id": "rat_return", "text": "...", "trigger": { "flag": "demo.rats_cleared" },
  "scenes": ["millbrook_square"], "outcome": { ... }, "required": true }
```

- A beat fires **once**, the first time its trigger holds while the hero is in one of its `scenes`.
- An empty `scenes` list means anywhere.
- Beats are checked after every action and every scene entry. The list is re-checked (up to 5 passes) until no more beats fire, so a beat triggered by another beat's outcome fires in the same step, whatever the order.

## Deadlines

```json
{ "id": "letter", "text": "Deliver the letter before nightfall",
  "start": { "flag": "~job_taken" }, "met": { "flag": "~delivered" },
  "within": 480, "warnAt": 60, "warning": "optional custom warning",
  "missed": { "text": "The letter is too late...", "flags": [...], "reputation": [...] } }
```

- **Starting:** a deadline starts the first time `start` holds. With no `start`, it starts at the beginning of the adventure.
- **Meeting:** it is met as soon as `met` holds. `met` is checked before `missed`, and a scene counts as visited as soon as the hero arrives, so tie `met` to a flag set by an action rather than to `visited` (a late arrival would otherwise count as met).
- **Missing:** if `within` minutes pass first, the `missed` outcome is applied, which is the consequence.
- **Warning:** a single warning fact is added when `warnAt` minutes or fewer remain.
- **When it is checked:** after every action, exit and beat.

For day-only or night-only content, put a `timeOfDay` or `hours` condition on actions, exits, POIs or beats.

## Quests (internal)

```json
{ "id": "rat_problem", "name": "The rats in the old mill", "start"?: condition,
  "objectives": [ { "id": "enter", "text": "Get into the old mill's cellar", "done": { "visited": "mill_cellar" }, "if"?: condition } ],
  "complete"?: condition, "fail"?: condition }
```

The player never sees quests as a log, because the journal is the player's own notebook. The engine tracks quests from flags so it can:

- give the LLM context ("The hero is pursuing: ...");
- show the optional **current objective** hint, which is off by default and toggled from the game menu. The hint shows the first open objective whose `if` holds, from the earliest active quest.

A quest completes when `complete` holds. If `complete` is not set, it completes when every objective is done. It fails when `fail` holds.

## Loot tables

```json
{ "id": "miller_box", "rolls": 1,
  "entries": [{ "weight": 3, "itemId": "potion_of_healing", "quantity": 1, "coins": "2d6", "coinUnit": "sp" }] }
```

- `rolls` is a number or dice notation.
- Each roll picks one entry by weight.
- An entry can give an item, coins, or both.

## Validation

`validateAdventure` rejects an adventure that has any of these:

- Schema errors.
- Duplicate ids.
- A start scene that doesn't exist.
- Exits or `goto`s to unknown scenes.
- Unknown NPC, encounter, loot or ending ids.
- Unknown SRD monster or item ids, when given the SRD database.
- No reachable ending, when endings are declared.

Scenes that can't be reached from the start produce **warnings**.

The side-quest generator (A108) regenerates any quest that fails validation.

## Versioning

- `formatVersion` changes only on breaking changes.
- Adding an optional field does not bump it.
- When it does bump, add a converter next to the schema and keep old files loading.
