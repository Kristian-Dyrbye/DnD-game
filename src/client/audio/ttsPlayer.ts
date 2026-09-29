/**
 * Plays spoken narration clips one after another as the server makes them ready (`tts` events).
 * Never blocks the UI: if the player acts, new lines simply queue; Skip stops the current clip and
 * drops the rest (client and server queues).
 */
import { signal } from '@preact/signals';

export const speaking = signal(false);

class TtsPlayer {
  private queue: number[] = [];
  private current: HTMLAudioElement | null = null;
  private volume = 0.9;
  private enabled = true;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.current) this.current.volume = this.volume;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.skip(false);
  }

  ready(entryId: number): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    this.queue.push(entryId);
    if (this.queue.length > 6) this.queue.splice(0, this.queue.length - 6);
    if (!this.current) this.next();
  }

  skip(tellServer = true): void {
    this.queue = [];
    this.current?.pause();
    this.current = null;
    speaking.value = false;
    if (tellServer) void fetch('/api/tts/skip', { method: 'POST' }).catch(() => undefined);
  }

  private next(): void {
    const id = this.queue.shift();
    if (id === undefined) {
      this.current = null;
      speaking.value = false;
      return;
    }
    const a = new Audio(`/api/tts/${id}`);
    a.volume = this.volume;
    this.current = a;
    speaking.value = true;
    a.onended = () => this.next();
    a.onerror = () => this.next();
    a.play().catch(() => this.next());
  }
}

export const ttsPlayer = new TtsPlayer();
