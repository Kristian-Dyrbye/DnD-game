# The Seven Teeth of Vashkul — a solo D&D adventure with a local AI Dungeon Master

A single-player Dungeons & Dragons game (SRD 5.2.1 rules) that runs entirely on your own Windows PC. The code resolves every rule, every roll and every fight; a small local language model (via Ollama) only narrates what already happened, voices NPCs and suggests ideas. No internet connection or account is needed once it is set up.

- **Build a hero** from the full SRD 5.2.1: 12 classes with subclasses, species, backgrounds, origin feats, three ways to set ability scores, spells, equipment, a 3D look, and an optional AI-written backstory. Quick Build gets you playing in a minute.
- **Play a campaign**: a starter arc in the village of Millbrook, then a five-chapter main arc across three regions with different tones, four companions with loyalty, factions, reputation, shops, a day/night clock, weather, a world map with travel, and procedurally generated side quests woven into the story.
- **Fight on a tactical grid** (3D or 2D): initiative, action economy, opportunity attacks, cover and line of sight, area templates, spell zones, grapple/shove/ready, weapon masteries, enemy AI with morale, and companions you can control or leave to the AI.
- **See the consequences**: wounds that fade as you heal, permanent scars logged with their origin, armor that dents and needs repair, and equipment shown on the 3D model.
- **Listen**: music and sound effects by mood, and optional offline narration voices (Piper).
- **Play on in any condition**: if the AI or the voice isn't available, the game says so once and continues with written narration.

## Requirements

- Windows 10 or 11, 8 GB RAM (the game keeps the AI model under about 3 GB).
- [Node.js](https://nodejs.org) 20 or newer (tested with Node 26).
- [Ollama](https://ollama.com/download) for the AI narrator (optional: without it the game uses written narration).
- About 4 GB of disk space for the AI model, plus about 100 MB for 3D models, audio and voices.

## Getting started

1. **Run `Setup.bat`** once. It checks Node, installs the packages, builds the game, offers to install Ollama (via winget) and pulls the default model (`llama3.2:3b`), and downloads the free 3D models, audio and narration voices.
2. **Run `Start Game.bat`**. It starts Ollama if needed, starts the game server and opens the game in your browser (http://127.0.0.1:3210).
3. Click **New Game**, build a hero (or use Quick Build), and play.

Your saves are in `saves/`, your settings in `userdata/settings.json`.

## How to play

- **Story**: read the narration, then click a suggested action or type what you want to do in your own words ("I ask the Reeve about the missing children", "I climb the wall"). The game decides what's possible and rolls the dice; the roll and its math appear in the dice tray.
- **Combat**: click squares to move, pick an attack, spell or action, then click a target; End turn when done. Toggle the 3D/2D map in the top corner; drag to rotate, wheel to zoom, right-drag to pan.
- **Menu bar**: Map (travel), Journal (your own notes), Character (3D model, stats, scars), Inventory (equip, repair armor), shops at your location, Hint (current objective, off by default), Voice, Quick save, Save / Load, Settings.
- **Difficulty**: Heroic (default) turns defeats into setbacks; Hardcore makes death final, but a new hero can continue in the same world.

## Settings worth knowing

- **AI**: model name, response length, combat narration (every action / key moments / off), a *Test connection* button, and *Play without the AI*.
- **Performance**: presets (low = 2D map, no shadows), texture quality, frame cap, how many 3D models to show.
- **Accessibility**: text size, a more readable font, colour-blind helpers.

## Swapping the AI model

The default model is `llama3.2:3b`; the fallback is `qwen3:4b-instruct`. (Use the `-instruct` tag of Qwen3: plain `qwen3:4b` is now a thinking-only model that is far too slow for narration.) Any Ollama model works: pull it (`ollama pull <name>`) and set it in Settings → AI. Small 3–4B instruction models give the best balance on 8 GB machines; larger models narrate better but use more memory.

To compare models on your own PC, run `node scripts/bench-llm.mjs` (add `--pull` to download the candidates first, or name models to test). It measures JSON reliability, speed and memory with the game's real prompt shapes and recommends a default; results go to `userdata/bench-llm.json`.

## For developers

```bash
npm install
npm run dev:server   # game server (tsx watch) on :3210
npm run dev          # Vite dev server with hot reload, proxies to the game server
npm test             # Vitest (no Ollama or Piper needed: tests use mocks)
npm run typecheck
npm run build        # production client in dist/client (served by the game server)
```

Test shortcuts in the browser: `#creator`, `#quickbuild-<class>`, `#play-<class>` (start at once), `#play-<class>+map`, `#play-<class>+scars`, `#combat-<class>` (combat sandbox), `#load` (save browser).

- **Architecture**: see [ARCHITECTURE.md](ARCHITECTURE.md). The rules engine (`src/engine`) is pure TypeScript shared by server and client; the server owns the game session; the client only renders.
- **Writing adventures**: see [ADVENTURE_FORMAT.md](ADVENTURE_FORMAT.md). Adventures are JSON files in `data/adventures/`, validated at load time.
- **SRD data**: `npm run srd:fetch` then `npm run srd:import` rebuild `data/srd/*.json` from the SRD 5.2.1 Markdown source.

## Troubleshooting

- *"The AI storyteller (Ollama) is not running"*: start Ollama (Start Game.bat does it) or turn on *Play without the AI* in Settings.
- *"The narration voice (Piper) is not installed"*: run Setup.bat again, or turn the voice off.
- *3D models not found*: run Setup.bat (it downloads the model packs); the game shows simple stand-ins meanwhile.
- *The game is slow*: choose the *low* performance preset (2D map, no shadows).

## Credits and license notes

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

3D models, music, sound effects and voices are CC0 or public-domain assets listed with their sources and licenses in [CREDITS.md](CREDITS.md). The world of Orrimar, its characters and the campaign are original to this game.
