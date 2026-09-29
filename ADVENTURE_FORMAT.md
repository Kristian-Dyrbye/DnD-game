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
| `flags` | `{ id, description }[]` | Lists the flags this adventure reads or writes, for editors and reviewers. |
| `endings` | `{ id, name, text }[]` | An outcome with `ending` finishes the adventure. |
| `improvisedDifficulty` | `very_easy` … `nearly_impossible` | The DC tier for checks the player improvises in free text (SRD table). Defaults to `medium` (DC 15). A scene can override it. |

## Chapters and scenes

A chapter has `id`, `name`, `summary`, `start` (a scene id) and `scenes`.

A scene has these fields:

- `id`, `name`.
- `locationId`: optional. A location id from `data/world/lore.json`.
- `seed`: the description seed for the narrator.
- `variants`: `[{ if, seed }]`. Extra seed text used when the condition holds. This is how earlier choices visibly change a place.
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
| `flags` | `[{ "set": "f", "value": true }, { "inc": "f", "by": 1 }, { "clear": "f" }]` |
| `items` | `[{ "itemId": "rope", "quantity": 1 }]`. Item ids are SRD gear, weapon, armor or magic item ids. |
| `coins` | Copper pieces (`1000` = 10 gp). |
| `loot` | Rolls a loot table by id. |
| `xp` | Added to the hero. |
| `reputation` | `[{ "faction": "id", "delta": 1 }]` |
| `minutes` | Time passes. |
| `encounter` | Starts an encounter by id. |
| `goto` | Moves to a scene. This is applied last. |
| `ending` | Finishes the adventure. |

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
{ "level": { "gte": 3 } }
{ "visited": "scene_id" }
```

A flag that has never been set is simply unset, so later arcs can safely read flags from arcs the player never finished.

**Flag naming:**

- `arc.<arcId>.<name>` for arc state.
- `world.<name>` for facts every arc may read.
- `side.<questId>.<name>` for side quests.

The flag system is finalised in A078.

## NPCs

```json
{ "id": "mayor_hobb", "name": "Mayor Hobb", "statBlock": "commoner",
  "personality": "...", "secrets": ["..."], "voice": "Fussy, breathless...",
  "ttsVoice": "optional-voice-id", "factions": ["millbrook_folk"], "attitude": "friendly" }
```

- `statBlock` is an SRD monster id.
- Secrets are passed to the LLM only as guidance, never as mechanics.

## Encounters

```json
{ "id": "cellar_rats", "name": "Cellar rats", "monsters": [{ "id": "giant_rat", "count": 2 }],
  "map": "optional-map-id", "terrain": ["barrels (half cover)"],
  "scaling": { "target": "moderate", "pool": ["rat"] }, "canFlee": true,
  "win": { ... }, "lose": { ... }, "flee": { ... } }
```

In Heroic mode, `lose` is the **defeat outcome** (captured, robbed, rescued...). Until tactical combat is built (A068), encounters are resolved automatically as wins.

## Beats

```json
{ "id": "rat_return", "text": "...", "trigger": { "flag": "demo.rats_cleared" },
  "scenes": ["millbrook_square"], "outcome": { ... }, "required": true }
```

- A beat fires **once**, the first time its trigger holds while the hero is in one of its `scenes`.
- An empty `scenes` list means anywhere.
- Beats are checked after every action and every scene entry.

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
