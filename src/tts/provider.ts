/** Builds the TTS provider from settings. Relative paths resolve against the project root. */
import path from 'node:path';
import type { Settings } from '../shared/settings';
import { MockTts } from './mock';
import { PiperTts } from './piper';
import type { TtsProvider } from './types';

export function createTtsProvider(tts: Settings['tts'], rootDir: string, useMock = false): TtsProvider {
  if (useMock) return new MockTts();
  return new PiperTts({
    piperPath: path.resolve(rootDir, tts.piperPath),
    voiceDir: path.resolve(rootDir, tts.voiceDir),
    defaultVoice: tts.narratorVoice,
  });
}
