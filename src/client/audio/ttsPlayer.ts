/**
 * Plays spoken narration one line after another. Local edition: clips the server made ready (`tts`
 * events, Piper). Web edition: the browser's own speechSynthesis reads narration/dialogue log lines
 * (A126). Never blocks the UI: if the player acts, new lines simply queue; Skip stops the current line
 * and drops the rest (client and, for Piper, server queues).
 */
import { signal } from '@preact/signals';
import { speakable } from '../../tts/queue';

export const speaking = signal(false);

/** The bits of window.speechSynthesis the player uses (injectable for tests). */
export interface SpeechEngine {
  speak(text: string, opts: { voice?: string; volume: number; onEnd: () => void }): void;
  cancel(): void;
  voices(): string[];
}

/** Wraps the browser's speechSynthesis; undefined where the browser has none. */
export function webSpeechEngine(): SpeechEngine | undefined {
  const synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return undefined;
  return {
    speak(text, opts) {
      const u = new SpeechSynthesisUtterance(text);
      u.volume = opts.volume;
      const v = opts.voice ? synth.getVoices().find((x) => x.name === opts.voice) : undefined;
      if (v) u.voice = v;
      u.onend = opts.onEnd;
      u.onerror = opts.onEnd;
      synth.speak(u);
    },
    cancel: () => synth.cancel(),
    voices: () => synth.getVoices().map((v) => v.name),
  };
}

type Line = { id: number; text?: string };

export class TtsPlayer {
  private queue: Line[] = [];
  private current: HTMLAudioElement | null = null;
  private talking = false;
  private volume = 0.9;
  private enabled = true;
  private speech: SpeechEngine | undefined;
  private voice = '';

  /** Web edition: speak log lines with the browser voice instead of server clips. */
  useSpeech(engine: SpeechEngine | undefined): void {
    this.speech = engine;
  }

  get browserVoice(): boolean {
    return this.speech !== undefined;
  }

  /** Names of the browser voices (web edition; empty otherwise or until the browser has loaded them). */
  voices(): string[] {
    return this.speech?.voices() ?? [];
  }

  setVoice(name: string): void {
    this.voice = name;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.current) this.current.volume = this.volume;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.skip(false);
  }

  /** Server clip ready (local edition). */
  ready(entryId: number): void {
    if (!this.enabled || this.speech || typeof Audio === 'undefined') return;
    this.push({ id: entryId });
  }

  /** A new story log line (web edition speaks narration and dialogue). */
  line(entry: { id: number; kind: string; text: string }): void {
    if (!this.enabled || !this.speech || (entry.kind !== 'narration' && entry.kind !== 'dialogue')) return;
    const text = speakable(entry.text);
    if (text) this.push({ id: entry.id, text });
  }

  skip(tellServer = true): void {
    this.queue = [];
    this.current?.pause();
    this.current = null;
    const wasTalking = this.talking;
    this.talking = false;
    if (wasTalking) this.speech?.cancel();
    speaking.value = false;
    if (tellServer && !this.speech) void fetch('/api/tts/skip', { method: 'POST' }).catch(() => undefined);
  }

  private push(line: Line): void {
    this.queue.push(line);
    if (this.queue.length > 6) this.queue.splice(0, this.queue.length - 6);
    if (!this.current && !this.talking) this.next();
  }

  private next(): void {
    const line = this.queue.shift();
    if (line === undefined) {
      this.current = null;
      this.talking = false;
      speaking.value = false;
      return;
    }
    speaking.value = true;
    if (this.speech) {
      this.talking = true;
      let done = false;
      const onEnd = () => {
        if (done || !this.talking) return;
        done = true;
        this.talking = false;
        this.next();
      };
      this.speech.speak(line.text ?? '', { volume: this.volume, onEnd, ...(this.voice ? { voice: this.voice } : {}) });
      return;
    }
    const a = new Audio(`/api/tts/${line.id}`);
    a.volume = this.volume;
    this.current = a;
    a.onended = () => this.next();
    a.onerror = () => this.next();
    a.play().catch(() => this.next());
  }
}

export const ttsPlayer = new TtsPlayer();
