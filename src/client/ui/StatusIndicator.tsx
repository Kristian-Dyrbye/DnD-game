/** Small corner indicator: AI service, narration voice and free RAM. Polls /api/status (web edition: tab memory only). */
import { useEffect, useState } from 'preact/hooks';
import { WEB_EDITION } from '../edition';
import {
  llmIndicator,
  memoryIndicator,
  ttsIndicator,
  type Indicator,
  type SystemStatus,
} from '../../shared/status';

const POLL_MS = 10_000;

export function StatusIndicator() {
  return WEB_EDITION ? <WebStatus /> : <ServerStatus />;
}

/** Web edition: no server, AI or Piper to watch; only the tab's own memory (Chromium). */
function WebStatus() {
  const [mb, setMb] = useState(tabHeapMB());
  useEffect(() => {
    const id = setInterval(() => setMb(tabHeapMB()), POLL_MS);
    return () => clearInterval(id);
  }, []);
  if (mb === undefined) return null;
  return (
    <div class="status-indicator">
      <Light ind={tabIndicator(mb)} />
    </div>
  );
}

function ServerStatus() {
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
      {tabHeapMB() !== undefined && <Light ind={tabIndicator(tabHeapMB()!)} />}
    </div>
  );
}

/** Chromium exposes the tab's JS heap; the tab's budget share is well under 1.5 GB (spec §1). */
function tabHeapMB(): number | undefined {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined;
}

export function tabIndicator(mb: number): Indicator {
  const light = mb > 1000 ? 'error' : mb > 600 ? 'warn' : 'ok';
  return { light, label: `Game ${mb} MB`, detail: `Browser tab memory (JavaScript heap). Budget: under 1 GB.${light !== 'ok' ? ' Try the Low performance preset or 2D battle map.' : ''}` };
}

function Light({ ind }: { ind: Indicator }) {
  return (
    <span class={`status-light status-${ind.light}`} title={ind.detail}>
      <span class="status-dot" aria-hidden="true" />
      {ind.label}
    </span>
  );
}
