/**
 * Friendly, throttled notices for failures the player should know about but that must not stop
 * the game (spec §17): the AI storyteller or the narration voice being unavailable. Each kind is
 * shown at most once per `intervalMs`, as a system line in the story log.
 */
import type { GameSession } from '../engine/session/GameSession';
import { LlmError } from '../llm/types';
import { TtsError } from '../tts/types';

export type NoticeKind = 'llm' | 'tts';

export function llmNoticeText(err: unknown): string {
  const kind = err instanceof LlmError ? err.kind : undefined;
  if (kind === 'unreachable') return 'The AI storyteller (Ollama) is not running, so the story uses simple narration for now. Start Ollama (Start Game.bat does it) or turn on "Play without the AI" in Settings.';
  if (kind === 'timeout') return 'The AI storyteller is taking too long, so simple narration was used. A smaller model or the Low preset may help (Settings → AI).';
  if (kind === 'http' && /not found|pull/i.test(String((err as Error).message))) return 'The AI model is not installed. Run Setup.bat (or `ollama pull` the model named in Settings → AI).';
  return 'The AI storyteller had a problem, so simple narration was used. Settings → AI → Test connection can help find out why.';
}

export function ttsNoticeText(err: unknown): string {
  const kind = err instanceof TtsError ? err.kind : undefined;
  if (kind === 'not_installed') return 'The narration voice (Piper) is not installed. Run Setup.bat, or turn the voice off in Settings.';
  if (kind === 'no_voice') return 'The chosen narration voice is missing. Run Setup.bat or pick another voice in Settings.';
  return 'The narration voice could not speak that line. The story continues in text.';
}

export class Notices {
  private last = new Map<NoticeKind, number>();

  constructor(
    private readonly session: GameSession,
    private readonly intervalMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  report(kind: NoticeKind, err: unknown): void {
    const t = this.now();
    if (t - (this.last.get(kind) ?? -Infinity) < this.intervalMs) return;
    if (!this.session.running) return;
    this.last.set(kind, t);
    this.session.addLog('system', kind === 'llm' ? llmNoticeText(err) : ttsNoticeText(err));
  }

  /** Clears the throttle for a kind (e.g. after it works again). */
  recovered(kind: NoticeKind): void {
    this.last.delete(kind);
  }
}
