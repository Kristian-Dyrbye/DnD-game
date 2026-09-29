/** Small corner indicator: AI service, narration voice and free RAM. Polls /api/status. */
import { useEffect, useState } from 'preact/hooks';
import {
  llmIndicator,
  memoryIndicator,
  ttsIndicator,
  type Indicator,
  type SystemStatus,
} from '../../shared/status';

const POLL_MS = 10_000;

export function StatusIndicator() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [s, settings] = await Promise.all([
          fetch('/api/status').then((r) => r.json() as Promise<SystemStatus>),
          fetch('/api/settings').then((r) => r.json() as Promise<{ tts: { enabled: boolean } }>),
        ]);
        if (!alive) return;
        setStatus(s);
        setTtsEnabled(settings.tts.enabled);
        setServerDown(false);
      } catch {
        if (alive) setServerDown(true);
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (serverDown) {
    return (
      <div class="status-indicator">
        <Light ind={{ light: 'error', label: 'Server offline', detail: 'The game server is not responding.' }} />
      </div>
    );
  }
  if (!status) return null;

  return (
    <div class="status-indicator">
      <Light ind={llmIndicator(status.llm)} />
      <Light ind={ttsIndicator(status.tts, ttsEnabled)} />
      <Light ind={memoryIndicator(status.memory)} />
    </div>
  );
}

function Light({ ind }: { ind: Indicator }) {
  return (
    <span class={`status-light status-${ind.light}`} title={ind.detail}>
      <span class="status-dot" aria-hidden="true" />
      {ind.label}
    </span>
  );
}
