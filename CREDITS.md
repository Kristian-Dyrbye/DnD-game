# Credits and Licenses

## Game rules: System Reference Document 5.2.1

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

- **Changes made:** The SRD text was converted into structured JSON (`data/srd/*.json`). Mechanics were extracted into data fields, and some text was shortened or reformatted for in-game display.
- **Source text used for conversion:** the community Markdown edition [downfallx/dnd-5e-srd-markdown](https://github.com/downfallx/dnd-5e-srd-markdown) at commit `1b4b99d` (CC-BY-4.0, same SRD 5.2.1 content). It is fetched by `scripts/srd-fetch.mjs` and is not redistributed in this repository.
- This game is not affiliated with, endorsed by, or sponsored by Wizards of the Coast. Dungeons & Dragons and D&D are trademarks of Wizards of the Coast LLC.

## Web edition (GitHub Pages)

The web edition published by `.github/workflows/pages.yml` redistributes the 3D models, music and sound effects listed below: the workflow fetches them with the same scripts and verified hashes as Setup, and copies them into the site next to a copy of this file. All of them are CC0, which allows redistribution. The Piper voices are **not** part of the web edition (it uses the browser's own speech), and the SRD attribution above applies to the rules data bundled in the site.

### Code libraries in the web edition

- **PeerJS** 1.5.5 (https://github.com/peers/peerjs), MIT License, Copyright (c) 2015 Michelle Bu and Eric Zhang, http://peerjs.com. Bundled (with its small MIT dependencies) in a separate chunk that loads only when the host allows a friend to join, or on a friend's room-link page. Co-op connections are set up through the public PeerJS broker `0.peerjs.com` (see "Play with a friend in the browser" in the README for what it sees).

## 3D models

All 3D models are downloaded on the player's machine by `scripts/assets-fetch.mjs` from the authors' official distribution points (listed in `assets/manifest.json`, with the exact files, sizes and sha256 hashes). All are released under **CC0 1.0 Universal (public domain dedication)**. Attribution isn't required, but we credit the authors gladly. Licences were verified on 2026-09-29.

### KayKit Character Pack: Adventurers 1.0
- **Author:** Kay Lousberg (KayKit), https://www.kaylousberg.com
- **Source:** https://kaylousberg.com/game-assets/characters-adventurers · https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- **License:** CC0 1.0. Quote from LICENSE.txt: "License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — This content is free to use in personal, educational and commercial projects."
- **Used for:** hero, companion and NPC models (Knight, Barbarian, Mage, Rogue, Rogue Hooded), helmets/hats/capes, and weapons and shields (swords, axes, dagger, crossbows, staff, wand, shields, spellbook, quiver, arrow).

### KayKit Character Pack: Skeletons 1.0
- **Author:** Kay Lousberg (KayKit), https://www.kaylousberg.com
- **Source:** https://kaylousberg.com/game-assets/characters-skeletons · https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
- **License:** CC0 1.0. Quote from LICENSE.txt: "License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — This content is free to use in personal, educational and commercial projects."
- **Used for:** skeletons, zombies, liches and other undead stand-ins, plus skeleton weapons and shields.

### KayKit Dungeon Remastered 1.0
- **Author:** Kay Lousberg (KayKit), https://www.kaylousberg.com
- **Source:** https://kaylousberg.com/game-assets/dungeon-remastered · https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0
- **License:** CC0 1.0. Quote from LICENSE.txt: "License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — This content is free to use in personal, educational and commercial projects."
- **Used for:** battle-map floors, walls, doors, stairs, pillars, traps and props.

> **Repository copy of the Quaternius models:** Poly Pizza refuses downloads from GitHub's build servers (HTTP 403), so the 36 Quaternius files the game uses are also committed unchanged in `assets/mirror/` (CC0 allows redistribution). `scripts/assets-fetch.mjs` uses that copy after checking each file's sha256 against `assets/manifest.json`.

### Quaternius Ultimate Monsters
- **Author:** Quaternius, https://quaternius.com
- **Source:** https://quaternius.com/packs/ultimatemonsters.html · models uploaded by Quaternius at https://poly.pizza/bundle/Ultimate-Monsters-Bundle-5oyGWAmOB6
- **License:** CC0 1.0. The pack page says "License: CC0" and "free to use in personal and commercial projects", and each model is marked "Public Domain (CC0)" on Poly Pizza.
- **Used for:** monster stand-ins (slimes, dragons, ghosts, demons, imps, orcs, goblins, aberrations, fungi, fish-folk and more).

### Quaternius Ultimate Animated Animal Pack
- **Author:** Quaternius, https://quaternius.com
- **Source:** https://quaternius.com/packs/ultimateanimatedanimals.html · https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS
- **License:** CC0 1.0. The pack page says "License: CC0", and each model is marked "Public Domain (CC0)" on Poly Pizza.
- **Used for:** wolf, fox, deer, stag, horse and bull (and the beasts that use them as stand-ins).

### Quaternius Easy Enemy Pack
- **Author:** Quaternius, https://quaternius.com
- **Source:** https://quaternius.com/packs/easyenemy.html · https://poly.pizza/bundle/Animated-Enemies-a53OJwHrhh
- **License:** CC0 1.0. The pack page says "License: CC0", and each model is marked "Public Domain (CC0)" on Poly Pizza.
- **Used for:** snake, wasp, rat, spider and frog.

### Quaternius Ultimate RPG Pack
- **Author:** Quaternius, https://quaternius.com
- **Source:** https://quaternius.com/packs/ultimaterpg.html · https://poly.pizza/bundle/Ultimate-RPG-Items-Bundle-h8mhlZ0dG8
- **License:** CC0 1.0. The pack page says "License: CC0", and each model is marked "Public Domain (CC0)" on Poly Pizza.
- **Used for:** bow, spear and warhammer.

## Music and sound effects

All music, ambience and sound effects are downloaded on the player's machine by `scripts/audio-fetch.mjs` from the authors' official distribution points (listed in `assets/audio-manifest.json`, with exact URLs, sizes and sha256 hashes). Every pack is used under **CC0 1.0 Universal (public domain dedication)**; where an OpenGameArt page offers several licences, we use the CC0 option. Attribution isn't required, but we credit every author gladly. Licences were verified on the asset pages on 2026-09-29.

### Music

#### A Legend Will Rise (Orchestral) — "A Legend Will Rise"
- **Author:** CodeManu
- **Source:** https://opengameart.org/content/a-legend-will-rise-orchestral
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "No attribution required but always appreciated."
- **Used for:** music mood `menu`

#### Town Theme RPG — "Town Theme RPG"
- **Author:** cynicmusic
- **Source:** https://opengameart.org/content/town-theme-rpg
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "Now CC0 Public Domain License!"
- **Used for:** music mood `town`

#### Medieval: The Old Tower Inn — "The Old Tower Inn"
- **Author:** RandomMind
- **Source:** https://opengameart.org/content/medieval-the-old-tower-inn
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "My CC0 track available in full and loop version, you can freely use for any purpose!"
- **Used for:** music mood `tavern`

#### Unexplored Expansion — "Unexplored Expansion"
- **Author:** Bo Jingles (from TAD's "Unexplored")
- **Source:** https://opengameart.org/content/unexplored-expansion
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `wilderness_aurelmark`

#### Treasure Hunter — "Treasure Hunter"
- **Author:** TAD
- **Source:** https://opengameart.org/content/treasure-hunter
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "Simple orchestral loop."
- **Used for:** music mood `wilderness_aurelmark`

#### Dark Forest Theme — "Dark Forest Theme"
- **Author:** cynicmusic
- **Source:** https://opengameart.org/content/dark-forest-theme
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `wilderness_gloamfen`

#### CC0 - Mystery — "Mystery Exploration"
- **Author:** PolygonDan
- **Source:** https://opengameart.org/content/cc0-mystery
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "Mystery theme music. Free to use for any purpose."
- **Used for:** music mood `wilderness_gloamfen`

#### Pirate Game Tune — "Pirate Game Tune"
- **Author:** Tozan
- **Source:** https://opengameart.org/content/pirate-game-tune
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `wilderness_brinescatter`

#### Enemy Ship Approaching — "Enemy Ship Approaching"
- **Author:** yd
- **Source:** https://opengameart.org/content/enemy-ship-approaching
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "The ocean waves sound was borrowed from Freesound and is CC0."
- **Used for:** music mood `wilderness_brinescatter`

#### Cave Theme — "Cave Theme"
- **Author:** HaelDB
- **Source:** https://opengameart.org/content/cave-theme
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). The page is dual-licensed "OGA-BY 3.0 / CC0"; we use it under the CC0 option.
- **Used for:** music mood `dungeon`

#### Forgoten tomb ambience — "Forgotten Tombs"
- **Author:** kindland
- **Source:** https://opengameart.org/content/forgoten-tomb-ambience
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `dungeon`

#### Battle Theme A — "Battle Theme A"
- **Author:** cynicmusic
- **Source:** https://opengameart.org/content/battle-theme-a
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "CC0 Public Domain license is the best!"
- **Used for:** music mood `battle`

#### Battle Theme — "Battle Theme"
- **Author:** Wolfgang_
- **Source:** https://opengameart.org/content/battle-theme-0
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `battle`

#### Boss Fight — "Boss Fight"
- **Author:** Lisboa
- **Source:** https://opengameart.org/content/boss-fight-0
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "Feel free to use in your project."
- **Used for:** music mood `boss`

#### Just a random fanfare — "Just a Random Fanfare"
- **Author:** Spring Spring
- **Source:** https://opengameart.org/content/just-a-random-fanfare
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `victory`

#### Victory Fanfare Short — "Victory Fanfare Short"
- **Author:** cynicmusic
- **Source:** https://opengameart.org/content/victory-fanfare-short
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** music mood `victory`

### Ambience

#### Forest Ambience — "Forest Ambience"
- **Author:** TinyWorlds
- **Source:** https://opengameart.org/content/forest-ambience
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "It loops seamlessly and is ready to be used in your projects!"
- **Used for:** ambience `forest`

#### Swamp Environment Audio — "Swamp"
- **Author:** LokiF
- **Source:** https://opengameart.org/content/swamp-environment-audio
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** ambience `swamp`

#### Loopable Dungeon Ambience — "Dungeon Ambience"
- **Author:** JaggedStone
- **Source:** https://opengameart.org/content/loopable-dungeon-ambience
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** ambience `dungeon`

### Sound effects

#### Casino Audio (1.1)
- **Author:** Kenney Vleugels (Kenney.nl)
- **Source:** https://kenney.nl/assets/casino-audio
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). Casino Audio (1.1) by Kenney Vleugels (Kenney.nl). "License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." (License.txt inside the official zip; kenney.nl asset page lists "License: Creative Commons CC0")
- **Used for:** SFX `dice_shake`, `dice_roll`, `dice_land`

#### RPG Audio
- **Author:** Kenney Vleugels (Kenney.nl)
- **Source:** https://kenney.nl/assets/rpg-audio
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). RPG Audio by Kenney Vleugels (Kenney.nl). "License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." (License.txt inside the official zip; kenney.nl asset page lists "License: Creative Commons CC0")
- **Used for:** SFX `door_open`, `door_close`, `door_creak`, `page_turn`, `book_open`, `book_close`, `coin`, `equip`, `weapon_draw`, `lock`, `footstep_dirt`

#### Impact Sounds
- **Author:** Kenney Vleugels (Kenney.nl)
- **Source:** https://kenney.nl/assets/impact-sounds
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). Impact Sounds by Kenney Vleugels (Kenney.nl). "License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." (License.txt inside the official zip; kenney.nl asset page lists "License: Creative Commons CC0")
- **Used for:** SFX `sword_hit`, `blunt_hit`, `arrow_hit`, `shield_block`, `footstep_stone`, `footstep_grass`, `footstep_wood`, `footstep_snow`

#### Interface Sounds
- **Author:** Kenney Vleugels (Kenney.nl)
- **Source:** https://kenney.nl/assets/interface-sounds
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). Interface Sounds by Kenney Vleugels (Kenney.nl). "License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." (License.txt inside the official zip; kenney.nl asset page lists "License: Creative Commons CC0")
- **Used for:** SFX `ui_click`, `ui_confirm`, `ui_error`, `ui_back`, `ui_open`, `ui_close`, `ui_toggle`, `ui_tick`

#### UI Audio
- **Author:** Kenney Vleugels (Kenney.nl)
- **Source:** https://kenney.nl/assets/ui-audio
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). UI Audio by Kenney Vleugels (Kenney.nl). "License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." (License.txt inside the official zip; kenney.nl asset page lists "License: Creative Commons CC0")
- **Used for:** SFX `ui_hover`

#### Music Jingles
- **Author:** Kenney Vleugels (Kenney.nl)
- **Source:** https://kenney.nl/assets/music-jingles
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). Music Jingles by Kenney Vleugels (Kenney.nl). "License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ — You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." (License.txt inside the official zip; kenney.nl asset page lists "License: Creative Commons CC0")
- **Used for:** SFX `level_up`, `quest_complete`

#### 80 CC0 RPG SFX
- **Author:** rubberduck
- **Source:** https://opengameart.org/content/80-cc0-rpg-sfx
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Title: "80 CC0 RPG SFX"; description: "I created 80 sound effects for fantasy / rpg games".
- **Used for:** SFX `coin`, `sword_hit`, `spell_generic`, `spell_fire`, `gem`, `unlock`, `creature_hurt`, `creature_die`, `creature_roar`, `slime`

#### Swishes Sound Pack
- **Author:** artisticdude
- **Source:** https://opengameart.org/content/swishes-sound-pack
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "13 'swish' sound effects ... created for the FOSS RPG Summoning Wars."
- **Used for:** SFX `miss_whoosh`, `swing_heavy`

#### Battle Sound Effects
- **Author:** Ogrebane / artisticdude
- **Source:** https://opengameart.org/content/battle-sound-effects
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). The page is multi-licensed "CC-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 / GPL 2.0 / CC0"; we use it under the CC0 option.
- **Used for:** SFX `miss_whoosh`, `arrow_shot`

#### Ice spells
- **Author:** bart
- **Source:** https://opengameart.org/content/ice-spells
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "Here are some ice spell sounds I put together from this sound by Stephan at pdsounds" (pdsounds = public domain source).
- **Used for:** SFX `spell_ice`

#### Spell sounds
- **Author:** HaelDB
- **Source:** https://opengameart.org/content/spell-sounds
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). The page is dual-licensed "OGA-BY 3.0 / CC0"; we use it under the CC0 option.
- **Used for:** SFX `spell_heal`, `spell_lightning`

#### Freeze Spell
- **Author:** artisticdude
- **Source:** https://opengameart.org/content/freeze-spell-0
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/). Description: "An experimental freeze/ice spell ... created for the FOSS RPG Summoning Wars".
- **Used for:** SFX `spell_ice`

#### Magic Spell SFX
- **Author:** JaggedStone
- **Source:** https://opengameart.org/content/magic-spell-sfx
- **License:** CC0 1.0 (http://creativecommons.org/publicdomain/zero/1.0/). OpenGameArt.org asset page, "License(s): CC0" (links to http://creativecommons.org/publicdomain/zero/1.0/).
- **Used for:** SFX `spell_generic`, `spell_buff`

## Voices (Piper TTS)

Offline narration uses [Piper](https://github.com/rhasspy/piper) and the voices below.
None of these files are in the repository: `Setup.bat` runs `node scripts/voices-fetch.mjs`,
which downloads them from their official sources on the player's machine
(pinned URLs and sha256 hashes are in `assets/voices-manifest.json`).

### Piper binary

- **Piper 2023.11.14-2** (`piper_windows_amd64.zip`) by Michael Hansen / Rhasspy:
  https://github.com/rhasspy/piper/releases/tag/2023.11.14-2
  License: MIT ("Copyright (c) 2022 Michael Hansen. Permission is hereby granted, free of charge, ...").
- Bundled inside that zip, unmodified: **espeak-ng** (GPL-3.0, https://github.com/espeak-ng/espeak-ng),
  used for phonemization, and **ONNX Runtime** (MIT, https://github.com/microsoft/onnxruntime).
  The game runs `piper.exe` as a separate process and does not link to or redistribute them.

### Voice models

All voices come from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (tag `v1.0.0`)
and were created by **Bryce Beattie** (https://brycebeattie.com/files/tts/) from public-domain
[LibriVox](https://librivox.org) recordings. Model cards: "License: public domain"; the author adds
"Feel free to use these for any legal and ethical purpose."

| Voice | Role in game | Notes |
|---|---|---|
| `en_GB-cori-medium` | Narrator | UK English female; trained from scratch on ~24 h of LibriVox audio |
| `en_US-norman-medium` | Male NPCs | US English male; trained from scratch on ~15.5 h of LibriVox audio |
| `en_US-kristin-medium` | Female NPCs | US English female; trained from scratch on ~11.5 h of LibriVox audio |
| `en_US-john-medium` | Extra male NPCs | US English male; fine-tuned from Kristin on ~12.5 h of LibriVox audio |

Thanks to the LibriVox volunteer readers whose public-domain recordings made these voices possible.

Not used: `en_US-lessac-*` (Lessac Blizzard 2013 dataset is licensed for research purposes only)
and voices fine-tuned from it or trained on CC BY-NC data (ryan, hfc_male, hfc_female, joe, amy, alan, alba, ...).
