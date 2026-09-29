# Build Prompt: Solo D&D 5e (SRD 5.2) Browser Game with Local AI Dungeon Master

## How to use this document

You are building a complete, locally run, single-player D&D-style RPG. Read this entire document before writing any code. Then:

1. Propose an architecture, folder structure, and phased build plan (see "Build Phases" at the end), and wait for my approval before starting.
2. Build one phase at a time. At the end of each phase, give me a short summary, tell me how to run and test it, and list any known issues.
3. Keep a `PROGRESS.md` file in the repo that tracks completed phases, open issues, and decisions made, so work can resume across sessions.
4. If a requirement below is ambiguous or conflicts with another, ask me before deciding. Ask one question at a time, as a numbered multiple-choice list.

---

## 1. Target Environment and Hard Constraints

- **OS:** Windows 10/11.
- **RAM:** 8 GB total. The game, local LLM, text-to-speech, browser, and OS must all fit. Treat memory as a first-class constraint.
- **Form:** A browser app served locally. No cloud services and no API keys; everything runs offline after the first-time setup.
- **Launch:** A single `Start Game.bat` that checks dependencies, starts the local AI service and game server, and opens the default browser to the game. Also provide `Setup.bat` for first-time installation (installing or checking Ollama, pulling the model, downloading the TTS voice and asset packs), with clear, friendly console messages.
- **Target memory budget (approximate):** LLM ≤ 3 GB, TTS ≤ 300 MB, game server and browser tab ≤ 1.5 GB. Add a Settings → Performance panel (see §14).

---

## 2. Suggested Tech Stack (you may propose alternatives, with reasons)

- **Frontend:** TypeScript + Vite, a lightweight UI framework (e.g., Svelte, Preact, or React), and three.js for all 3D.
- **Backend:** A small local Node.js (TypeScript) server that serves the app, proxies requests to Ollama and the TTS engine, and reads and writes saves.
- **Local LLM:** Ollama for Windows, running a 3–4B parameter instruction-tuned model at 4-bit quantization. Research and choose the best current small model for creative narration and reliable JSON output. Make the model name configurable in settings, and document how to swap it.
- **TTS:** Piper (offline neural TTS) or a comparably lightweight offline engine, with a few voices (narrator, plus male and female NPC variants if feasible).
- **Storage:** Save files as versioned JSON (or SQLite) in a `saves/` folder, with a migration system so old saves survive updates.
- **Rules data:** Structured JSON derived from SRD 5.2.

---

## 3. Core Architecture Principle: Code Owns the Rules, the LLM Only Narrates

Small models are good at prose and bad at bookkeeping. Therefore:

- **The game engine (deterministic code)** handles every mechanic: dice, ability checks, saves, attacks, damage, HP, conditions, spell slots, resources, inventory, gold, XP, leveling, time, weather, faction reputation, prices, quest flags, and world state.
- **The LLM** handles only:
  1. Narrating scenes and outcomes that the engine has already resolved.
  2. Voicing NPCs and companions in dialogue.
  3. **Intent parsing:** converting free-text player input into a structured action (e.g., `{ "action": "skill_check", "skill": "persuasion", "target": "guard_captain", "approach": "bribe with silver ring" }`). The engine validates the action, decides the DC and outcome, and sends the result back to the LLM to narrate.
  4. Suggesting 3–5 contextual action buttons per scene.
  5. Filling in flavor within procedurally generated adventures.
- **All LLM calls that feed the engine must use structured JSON output** (use Ollama's JSON or schema mode), with validation, one automatic retry, and a safe fallback if parsing still fails. The game must never crash or stall because of a bad model response.
- **The LLM must never invent mechanical facts** (e.g., "you find a +3 sword"). Loot, rewards, and consequences come from the engine or the adventure data, and the prompt passes them to the model as fixed facts it must describe.

### Context management for a small model

- Keep prompts short. Send only: a system prompt (DM persona, tone of the current region, output rules), a compact state summary (location, party, active threats, relevant flags), the last few exchanges, and relevant adventure notes for the current scene.
- Maintain a rolling **story summary** that the LLM condenses periodically (e.g., after each scene) and the engine stores. Use it in place of a long transcript.
- Keep a small **retrieval layer**: NPC cards, location cards, and faction cards are pulled into the prompt only when relevant.
- Stream narration to the UI token by token so it feels responsive.

---

## 4. Rules: Full D&D 5e SRD 5.2

- Implement the **System Reference Document 5.2** (the 2024 revision), released under **CC-BY-4.0**. Include the required attribution in the About screen and in the README.
- Use **only SRD 5.2 content** plus original content. Do not include non-SRD Wizards of the Coast intellectual property (named settings, characters, or monsters and spells not in the SRD).
- **Scope:**
  - All SRD species, classes, subclasses, and backgrounds, with background-granted ability score increases and origin feats, as in the 2024 rules.
  - **Levels 1–20.**
  - All SRD spells, with correct slots, concentration, ritual casting, components (tracked abstractly), and upcasting.
  - **Weapon mastery.**
  - All conditions, exhaustion (2024 version), resting rules, and death saving throws.
  - **Feats:** origin feats and general feats at ability score improvement levels, plus epic boons if they're in the SRD.
  - **Multiclassing**, using the SRD rules (prerequisites, proficiencies gained, and multiclass spellcasting slot table).
  - The SRD monster stat blocks and magic items.
- Store the rules as data, not hard-coded logic, wherever practical (e.g., `data/srd/spells.json`), with an effect system for common patterns (damage, healing, conditions, saves, area shapes, durations).
- Write **unit tests** for the rules engine (attack resolution, advantage/disadvantage, crits, saves, concentration checks, spell slot math, multiclass slots, leveling, death saves).

---

## 5. Character Creation

A guided, step-by-step creator with a live 3D preview of the character:

1. Choose a class (with a clear summary and a "recommended for beginners" tag on simple classes).
2. Choose a background (showing its ability score options and origin feat).
3. Choose a species.
4. Generate ability scores, with the player choosing the method each time:
   - **Standard array** (15, 14, 13, 12, 10, 8)
   - **Point buy** (27 points, with the standard cost table)
   - **Roll 4d6, drop the lowest** (animated rolls, assigned by the player)
5. Choose skills, equipment (starting package or gold), and spells if applicable.
6. Customize appearance on the 3D model (see §12): body, face, hair, skin tone, colors.
7. Enter a name, personality traits, and a short backstory. The LLM may suggest a backstory on request, and the backstory is stored for use in narration.
8. Choose a difficulty mode for the campaign (see §9).

Also allow a **Quick Build** option that auto-fills sensible choices for a chosen class.

---

## 6. Party and Companions

- The player can **go solo or recruit up to 3 companions** met through the story.
- **Each companion can be toggled** between AI-controlled (the engine chooses tactics and the LLM voices them) and player-controlled in combat. The toggle can be changed at any time outside combat.
- Companions have full character sheets, level up alongside the hero, and have personalities, goals, and **loyalty/approval** that shifts with the player's choices. Very low loyalty can cause a companion to leave or betray the party at authored story points.
- Companions speak up with occasional banter and opinions on decisions, briefly, and not every turn.
- **Encounters scale to party size and level**, using the SRD encounter-building guidance, so solo play is fair.
- AI combat tactics should be sensible and role-aware: healers heal, casters keep distance, melee characters protect allies. Tactics are deterministic code, not LLM decisions.

---

## 7. Adventures and Campaign Structure

### 7.1 The world

Create **one original continent** with distinct regions, each with its own tone:

- A **classic high-fantasy** region (kingdoms, knights, dragons, ancient ruins).
- A **dark fantasy** region (grim, horror-tinged, morally gray, scarce resources).
- A **swashbuckling** coastal/island region (pirates, treasure, lighter and humorous).

Each region gets a tone profile that is injected into the narrator's system prompt so the prose style shifts by region. Write a `world/lore.json` with regions, history, major factions, gods (original or SRD-compatible), and key locations.

### 7.2 Hand-authored content (first build)

1. **Starter arc (1–2 sessions, about level 1–2).** Teaches the systems step by step: exploration, dialogue, skill checks, grid combat, resting, shops, companions, and the world map. It ends with a hook into the main campaign.
2. **One full campaign arc (4–5 chapters, about level 2–10).** It has a strong villain, multiple factions, meaningful branching, and at least two distinct endings. It should visit more than one region, so the arc shows off the tonal variety.

**Linked-campaign design:** Choices made in the starter arc and in each chapter (NPCs saved or killed, factions helped, villains spared, items obtained) are stored as **world flags** and **must visibly change later chapters**, including different NPC reactions, altered encounters, opened or closed paths, and different endings. Build the system so future arcs can read flags from earlier arcs.

### 7.3 Adventure data format

Define a clear, documented schema (JSON or YAML) for authored adventures, containing:

- Chapters → scenes/locations, each with a description seed, points of interest, exits, and conditions (flags, time of day, weather, reputation).
- NPCs (with a stat block reference, personality, secrets, voice notes for the LLM, and faction ties).
- Encounters (a monster list, grid map reference, terrain, win/lose/flee outcomes, and scaling rules).
- Key story beats that must happen, and the conditions that trigger them.
- Skill-check gates, with DCs set in data.
- Loot tables and fixed rewards.
- Flag reads and writes.

The LLM narrates within this skeleton and improvises only within guardrails: it can handle unexpected player actions, but the engine decides whether the action is possible and what it changes.

Write an `ADVENTURE_FORMAT.md` so I can write or convert more adventures later.

### 7.4 Procedural side-quest generator ("woven-in" mode)

- Generates side quests from templates and random tables: quest type, location type, antagonist, complication, twist, and reward.
- **Woven into the campaign:** The generator reads current world flags and prefers to pull in loose threads (an escaped villain, a grateful or vengeful NPC, a faction with a grudge, an unexplored location). The outcomes of side quests **write back to world flags** and can affect the main story in small, pre-defined ways (reputation changes, an ally who returns later, an item that helps in a chapter).
- The generator produces a valid adventure in the same schema as the authored content, so one engine runs both.
- Side quests are available between main chapters from quest boards, taverns, faction contacts, and random travel events.
- Include a validator that rejects broken or unwinnable generated quests and regenerates them.

---

## 8. Gameplay Loop and Input

- **Main screen layout:** A story log (narration and dialogue, streaming) is the central panel. Surrounding it are a character/party panel, the 3D model view, a minimap or world map button, a dice tray, and the input area.
- **Input:** 3–5 **suggested action buttons** per scene, plus a **free-text box** for anything else. Free text goes through intent parsing (§3).
- **Dice:** Rolls are **automatic**, with a visible 3D or animated dice roll, and **always show the math** (e.g., `d20: 14 + 5 (Persuasion) = 19 vs DC 15 — Success`). Show advantage and disadvantage as two dice. Keep a scrollable roll history.
- **Checks:** The engine decides which check applies and its DC, guided by adventure data and SRD guidance. The player sees the check type before rolling where appropriate.

---

## 9. Difficulty, Death, and Saving

- The player chooses a difficulty mode **per campaign**:
  - **Heroic (forgiving):** Death saves still apply, but failing them means **defeat, not death**. The story branches: you're captured, robbed, rescued, or you wake somewhere with consequences. The engine must provide authored and generated "defeat outcomes."
  - **Hardcore:** Standard 5e death. If the hero dies, the player can create a new hero who continues in the **same world, with world flags intact**.
- **Saving:** **Autosave** at scene changes, rests, and before combat, plus **multiple manual save slots in every mode, including Hardcore**. Show a save browser with a timestamp, location, level, and a thumbnail of the 3D character.

---

## 10. Combat: Tactical Grid

- **A square-grid battle map** with 5-foot squares, rendered in three.js with 3D models (§12), a movable and zoomable camera, and a **2D top-down token fallback** (§14).
- Initiative order is displayed as a turn tracker.
- Movement shows reachable squares for the current speed, including difficult terrain, and opportunity attacks are triggered correctly.
- The action economy is tracked visibly: action, bonus action, reaction, movement, and free object interaction.
- Range and line of sight are handled, including cover (half and three-quarters), and ranged attacks at long range or while adjacent to enemies get disadvantage.
- **Area-of-effect templates:** cone, cube, sphere/radius, line, and cylinder. Show them as a preview overlay before confirming, with affected creatures highlighted.
- Grapple, shove, dodge, disengage, dash, help, hide, ready, and the 2024 SRD versions of these actions are supported.
- Weapon mastery properties apply in combat.
- Enemy AI is deterministic and based on stat blocks, with simple tactical behaviors (focus on weak targets, use abilities, flee when morale breaks where appropriate).
- The LLM narrates attacks and kills briefly and asynchronously, so combat never waits on narration. Let the player set narration frequency: every action, key moments only, or off.
- Include a combat log with all rolls.

---

## 11. Exploration and World Systems

### 11.1 Maps

- **World/region map:** A clickable, illustrated overland map of the continent. Locations are revealed as they're discovered, with travel routes, travel time (by pace), and random travel events (weather- and region-dependent).
- **Dungeon and building maps:** Room-by-room maps with **fog of war** that reveal as you explore, **reusing the grid engine**. They transition seamlessly into combat on the same map.

### 11.2 Factions and reputation

- Multiple factions (guilds, cults, kingdoms, pirate crews, etc.), each with a reputation score toward the player and named tiers (Hostile → Revered).
- Reputation changes through quests, dialogue choices, and actions, and it gates quests, allies, prices, safe houses, and faction-specific rewards.
- Factions can be allied with or opposed to each other, so helping one can hurt another.

### 11.3 Day/night cycle

- An in-game clock advances with travel, exploration, rests, and downtime.
- Shops and NPCs have schedules. Some encounters and events are night-only or day-only.
- Some quests have deadlines, with consequences for missing them.
- The time of day changes visuals (lighting on 3D scenes and the map tint) and the narration.

### 11.4 Weather

- Weather is region- and season-aware: clear, rain, fog, storms, snow, and heat.
- It has mechanical effects: travel speed, visibility (lightly or heavily obscured areas), ranged-attack penalties in strong wind, and fire and cold interactions where sensible.
- It's reflected in narration, audio ambience, and map visuals.

### 11.5 Dynamic shops

- Prices are based on region, supply and demand, faction reputation, and a Persuasion haggling option.
- Merchants have limited stock that restocks over in-game time.
- Selling loot affects supply (don't let players flood one shop).
- Shops use SRD equipment and magic items with rarity-appropriate availability.

---

## 12. 3D Character Models, Equipment, and Scars

- Use **low-poly stylized** 3D models built from **free CC0-licensed modular character kits**. Research current options, such as the Quaternius and KayKit asset packs, and verify each asset's license is CC0 before use. Keep a `CREDITS.md` listing every asset and its license.
- **3D models are used for everyone:** the hero, companions, key NPCs, and monsters on the battle grid. Where a kit lacks a monster, use a reasonable stand-in or tinted variant, and note gaps in `PROGRESS.md`.
- **Equipment appears on the model:** Armor, helmets, shields, cloaks, and weapons attach to the model, so changing gear updates the model immediately. Map SRD items to visual parts, with sensible fallbacks.
- **Damage and scars:**
  - **Temporary wounds:** Cuts, bruises, and blood appear as texture or decal overlays that scale with missing HP, and they **fade on healing and rests**.
  - **Permanent scars:** Created by dramatic moments, such as critical hits taken, dropping to 0 HP, and authored story events. Each scar is placed on a plausible body location and **logged with its origin** (e.g., "Left cheek: claw of the Ashfang Wyvern, Chapter 2"), viewable by hovering over or clicking the scar on the character screen. Scars persist forever and appear in narration occasionally.
  - **Armor wear:** Dents, scratches, and tears accumulate on equipped armor and are cleared by repairing it (a gold or time cost at a smith or during downtime).
- The character screen has a rotatable 3D view of the character.
- Include a **gear/scar preview** in the save browser thumbnail.

---

## 13. Audio

- **Ambient music:** Looping tracks by mood (town, tavern, wilderness per region, dungeon, battle, boss, victory), using **CC0 or otherwise freely licensed** audio, with crossfading.
- **Sound effects:** Dice rolls, weapon hits, spells, UI clicks, doors, and footsteps.
- **Narration voice:** Offline TTS (e.g., Piper) reads narration aloud, with a distinct narrator voice and a few voices for NPCs if feasible. Narration is **fully toggleable** and has its own volume slider, plus a skip button. Audio generation happens in the background and never blocks gameplay.
- All audio credits go in `CREDITS.md`.

---

## 14. Settings and Performance

A settings panel including:

- Volumes (master, music, SFX, narration) and TTS on/off.
- **Performance presets** (Low / Medium / High), including a **2D token mode for the battle grid**, lower shadow and texture quality, fewer 3D NPC models on screen, and a frame-rate cap.
- LLM settings: model name, response length, narration frequency in combat, and a "test connection" button.
- Text size, a dyslexia-friendly font option, and colorblind-safe highlighting for grid and AoE overlays.
- An option to **unload the LLM or TTS from memory when idle**, with a note about reload delays.

Show a small RAM/status indicator (AI service connected, model loaded, TTS ready).

---

## 15. Journal

- The in-game journal is **a personal notes notebook only**: free-form pages the player writes and organizes themselves, saved with the game.
- There is **no automatic quest log shown to the player**. However, the engine must still track quests, flags, and discoveries internally for campaign logic and LLM context.
- Include a small, unobtrusive "current objective" hint that the player can toggle off, to avoid getting lost. (Ask me whether you want this; default off.)

---

## 16. Future Expansions (do not build now, but architect for them)

Structure the code (e.g., with a modular systems or plugin architecture and clean data schemas) so these can be added later without major refactoring:

1. **Crafting:** Brewing potions, scribing scrolls, and forging or upgrading gear from gathered materials during downtime.
2. **Home base:** A claimable stronghold (tower, tavern, ship) that can be upgraded, with storage, resting, and companion housing.
3. **More campaign arcs** that read world flags from earlier arcs.
4. **An adventure editor and importer**, for writing adventures in-game or converting free adventures from text into the adventure schema.

Document the extension points in `ARCHITECTURE.md`.

---

## 17. Quality, Testing, and Documentation

- Unit tests for the rules engine, the procedural generator's validator, save/load (including migrations), and flag logic.
- An automated "playthrough smoke test" that runs the starter arc's key path with a mocked LLM.
- A mock LLM mode, so the whole game can be developed and tested without Ollama running.
- Graceful error handling: If Ollama or TTS is down, show a clear message and let the game continue with template-based fallback narration.
- Docs: `README.md` (setup and play), `ARCHITECTURE.md`, `ADVENTURE_FORMAT.md`, `CREDITS.md` (SRD 5.2 CC-BY-4.0 attribution plus all asset licenses), and `PROGRESS.md`.

---

## 18. Build Phases (suggested order)

1. **Foundation:** Project setup, `.bat` launchers, the local server, Ollama and TTS connection checks, the mock LLM, and the save system.
2. **Rules engine:** SRD 5.2 data import, dice, checks, combat math, spells, conditions, leveling, feats, multiclassing, and tests.
3. **Character creation:** All three ability score methods, plus a basic 3D model with appearance customization.
4. **Narration loop:** The story UI, intent parsing, suggested actions, free text, streaming narration, and context/summary management.
5. **Grid combat:** A 2D token mode first, then 3D models, AoE templates, enemy AI, and companion AI.
6. **Exploration:** The world map, fog-of-war dungeon maps, the time/day-night cycle, weather, and travel events.
7. **World systems:** Factions and reputation, dynamic shops, and the flag system.
8. **Companions:** Recruitment, loyalty, banter, and the AI/player control toggle.
9. **3D equipment, wounds, scars, and armor wear.**
10. **Audio:** Music, SFX, and TTS narration.
11. **Content:** The starter arc, then the full campaign arc with linked flags and multiple endings.
12. **Procedural side quests:** Woven-in thread pulling, the validator, and write-back.
13. **Polish:** Settings, performance presets, accessibility, docs, and a full playtest pass.

Start by giving me your proposed architecture and plan for Phase 1.
