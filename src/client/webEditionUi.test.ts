import { describe, expect, it } from 'vitest';
import { TtsPlayer, type SpeechEngine } from './audio/ttsPlayer';
import { assetUrl, WEB_EDITION } from './edition';

function fakeSpeech() {
  const spoken: { text: string; voice?: string; volume: number }[] = [];
  const ends: (() => void)[] = [];
  let cancels = 0;
  const engine: SpeechEngine = {
    speak(text, opts) {
      spoken.push({ text, volume: opts.volume, ...(opts.voice ? { voice: opts.voice } : {}) });
      ends.push(opts.onEnd);
    },
    cancel() {
      cancels++;
      ends.at(-1)?.(); // browsers fire onend/onerror for a cancelled utterance
    },
    voices: () => ['Voice A', 'Voice B'],
  };
  return { engine, spoken, ends, cancels: () => cancels };
}

describe('asset URLs', () => {
  it('maps /assets paths onto the build base', () => {
    expect(assetUrl('/assets/models/characters/Knight.glb', '/')).toBe('/assets/models/characters/Knight.glb');
    expect(assetUrl('/assets/audio/', './')).toBe('./assets/audio/');
    expect(assetUrl('/assets/models/monsters/Goblin.glb', '/DnD-game/')).toBe('/DnD-game/assets/models/monsters/Goblin.glb');
    expect(assetUrl('/assets/x.glb', '/DnD-game')).toBe('/DnD-game/assets/x.glb');
    expect(assetUrl('/api/tts/3', './')).toBe('/api/tts/3');
  });

  it('tests run as the local edition', () => {
    expect(WEB_EDITION).toBe(false);
  });
});

describe('browser voice (web edition)', () => {
  it('speaks narration and dialogue lines in order, one at a time', () => {
    const p = new TtsPlayer();
    const s = fakeSpeech();
    p.useSpeech(s.engine);
    p.setVoice('Voice B');
    p.setVolume(0.5);
    p.line({ id: 1, kind: 'narration', text: 'The **well** is [quietly] dark.' });
    p.line({ id: 2, kind: 'system', text: 'Autosaved.' });
    p.line({ id: 3, kind: 'dialogue', text: 'Reeve: Welcome.' });
    expect(s.spoken).toEqual([{ text: 'The well is dark.', volume: 0.5, voice: 'Voice B' }]);
    s.ends[0]!();
    expect(s.spoken.map((x) => x.text)).toEqual(['The well is dark.', 'Reeve: Welcome.']);
    expect(p.voices()).toEqual(['Voice A', 'Voice B']);
  });

  it('ignores server clips, and skip cancels speech and drops the queue', () => {
    const p = new TtsPlayer();
    const s = fakeSpeech();
    p.useSpeech(s.engine);
    p.ready(7);
    expect(s.spoken).toHaveLength(0);
    p.line({ id: 1, kind: 'narration', text: 'One.' });
    p.line({ id: 2, kind: 'narration', text: 'Two.' });
    p.skip();
    expect(s.cancels()).toBe(1);
    expect(s.spoken.map((x) => x.text)).toEqual(['One.']);
    p.line({ id: 3, kind: 'narration', text: 'Three.' });
    expect(s.spoken.map((x) => x.text)).toEqual(['One.', 'Three.']);
  });

  it('stays silent when voice is off, and the local edition never speaks log lines', () => {
    const p = new TtsPlayer();
    const s = fakeSpeech();
    p.useSpeech(s.engine);
    p.setEnabled(false);
    p.line({ id: 1, kind: 'narration', text: 'Hush.' });
    expect(s.spoken).toHaveLength(0);
    const local = new TtsPlayer();
    local.line({ id: 1, kind: 'narration', text: 'Server voices this.' });
    expect(local.browserVoice).toBe(false);
  });
});
