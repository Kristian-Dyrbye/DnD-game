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
