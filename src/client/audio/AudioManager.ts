/**
 * Music + SFX manager (spec §13). Music crossfades between moods (two <audio> elements), an
 * ambience bed loops under it, and sound effects play from small pools. Volumes follow the audio
 * settings (master × channel). Browsers block sound until the first user gesture, so playback
 * starts on the first click/key. Missing files (Setup not run yet) fail silently.
 */
import manifest from '../../../assets/audio-manifest.json';
import type { Ambience, Mood } from '../../engine/world/mood';
import { channelVolume, pickVariant, type Volumes } from './audioLogic';

type Track = { file: string; loop: boolean; title: string };
const MOODS = manifest.moods as unknown as Record<string, Track[]>;
const AMBIENCE = manifest.ambience as unknown as Record<string, Track[]>;
const SFX = manifest.sfx as unknown as Record<string, string[]>;
const BASE = '/assets/audio/';
const FADE_MS = 1500;

export class AudioManager {
  private volumes: Volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private unlocked = false;
  private music: HTMLAudioElement[] = [];
  private active = 0;
  private mood: Mood | null = null;
  private lastTrack: string | undefined;
  private ambience: HTMLAudioElement | null = null;
  private ambienceName: Ambience = null;
  private lastSfx = new Map<string, string>();
  private pending: { mood: Mood; ambience: Ambience } | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly enabled = typeof Audio !== 'undefined') {
    if (!enabled) return;
    this.music = [new Audio(), new Audio()];
    const unlock = () => {
      this.unlocked = true;
      if (this.pending) this.setMood(this.pending.mood, this.pending.ambience);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Every button click gets a soft UI tick.
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('button')) this.sfx('ui_click');
    });
  }

  setVolumes(v: Volumes): void {
    this.volumes = v;
    const m = this.music[this.active];
    if (m) m.volume = channelVolume(v, 'music');
    if (this.ambience) this.ambience.volume = channelVolume(v, 'ambience');
  }

  /** Switches music mood (crossfade) and ambience bed; no-op if unchanged. */
  setMood(mood: Mood, ambience: Ambience): void {
    if (!this.enabled) return;
    if (!this.unlocked) {
      this.pending = { mood, ambience };
      return;
    }
    this.pending = null;
    if (mood !== this.mood) this.playMood(mood);
    if (ambience !== this.ambienceName) this.playAmbience(ambience);
  }

  private playMood(mood: Mood): void {
    const tracks = MOODS[mood] ?? [];
    const track = pickVariant(tracks, tracks.find((t) => t.file === this.lastTrack));
    this.mood = mood;
    if (!track) return;
    this.lastTrack = track.file;
    const from = this.music[this.active]!;
    this.active = 1 - this.active;
    const to = this.music[this.active]!;
    to.src = BASE + track.file;
    to.loop = track.loop;
    to.volume = 0;
    to.play().catch(() => undefined);
    const target = channelVolume(this.volumes, 'music');
    const start = performance.now();
    clearInterval(this.fadeTimer);
    this.fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / FADE_MS);
      to.volume = target * k;
      from.volume = Math.max(0, from.volume * (1 - k));
      if (k >= 1) {
        clearInterval(this.fadeTimer);
        from.pause();
      }
    }, 50);
  }

  private playAmbience(name: Ambience): void {
    this.ambience?.pause();
    this.ambience = null;
    this.ambienceName = name;
    const file = name ? AMBIENCE[name]?.[0]?.file : undefined;
    if (!file) return;
    const a = new Audio(BASE + file);
    a.loop = true;
    a.volume = channelVolume(this.volumes, 'ambience');
    a.play().catch(() => undefined);
    this.ambience = a;
  }

  /** Plays a sound effect by manifest key (random variant, slight pitch jitter). */
  sfx(key: string): void {
    if (!this.enabled || !this.unlocked) return;
    const variants = SFX[key];
    const file = variants && pickVariant(variants, this.lastSfx.get(key));
    if (!file) return;
    this.lastSfx.set(key, file);
    const a = new Audio(BASE + file);
    a.volume = channelVolume(this.volumes, 'sfx');
    a.playbackRate = 0.95 + Math.random() * 0.1;
    a.play().catch(() => undefined);
  }
}

export const audio = new AudioManager();
