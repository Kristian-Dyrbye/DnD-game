/**
 * Text-to-speech provider contract. Providers turn text into a complete WAV file.
 * Callers treat TTS as optional: a failure means "no audio", never a game error.
 */

export interface SynthesizeOptions {
  /** Voice id (Piper: the .onnx file name without extension). Defaults to the narrator voice. */
  voice?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TtsStatus {
  provider: string;
  ready: boolean;
  binaryFound: boolean;
  voices: string[];
  error?: string;
}

export interface TtsProvider {
  readonly name: string;
  /** Returns WAV bytes. Throws TtsError on failure. */
  synthesize(text: string, opts?: SynthesizeOptions): Promise<Uint8Array>;
  listVoices(): Promise<string[]>;
  status(): Promise<TtsStatus>;
}

export class TtsError extends Error {
  constructor(
    readonly kind: 'not_installed' | 'no_voice' | 'process' | 'timeout' | 'aborted',
    message: string,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}
