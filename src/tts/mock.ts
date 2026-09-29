/** Mock TTS for tests and for playing without Piper: returns silent WAVs (~60 ms per word). */
import { TtsError, type SynthesizeOptions, type TtsProvider, type TtsStatus } from './types';
import { pcm16ToWav } from './wav';

export const MOCK_SAMPLE_RATE = 8000;

export class MockTts implements TtsProvider {
  readonly name = 'mock';
  readonly calls: { text: string; voice: string }[] = [];

  constructor(
    private readonly voices: string[] = ['narrator', 'npc_male', 'npc_female'],
    private readonly failWith?: TtsError,
  ) {}

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<Uint8Array> {
    const voice = opts.voice ?? this.voices[0] ?? 'narrator';
    this.calls.push({ text, voice });
    if (this.failWith) throw this.failWith;
    if (opts.signal?.aborted) throw new TtsError('aborted', 'TTS aborted');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const samples = Math.round(words * 0.06 * MOCK_SAMPLE_RATE);
    return pcm16ToWav(new Uint8Array(samples * 2), MOCK_SAMPLE_RATE);
  }

  async listVoices(): Promise<string[]> {
    return [...this.voices];
  }

  async status(): Promise<TtsStatus> {
    return { provider: this.name, ready: !this.failWith, binaryFound: true, voices: [...this.voices] };
  }
}
