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
import { ENGLISH, type Translator } from '../../shared/i18n';
import { currentTranslator } from './i18n';

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
      <Light ind={tabIndicator(mb, currentTranslator())} />
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

  const tr = currentTranslator();
  if (serverDown) {
    return (
      <div class="status-indicator">
        <Light ind={{ light: 'error', label: tr.t('status.serverOffline'), detail: tr.t('status.serverOfflineDetail') }} />
      </div>
    );
  }
  if (!status) return null;

  return (
    <div class="status-indicator">
      <Light ind={llmIndicator(status.llm, tr)} />
      <Light ind={ttsIndicator(status.tts, ttsEnabled, tr)} />
      <Light ind={memoryIndicator(status.memory, tr)} />
      {tabHeapMB() !== undefined && <Light ind={tabIndicator(tabHeapMB()!, tr)} />}
    </div>
  );
}

/** Chromium exposes the tab's JS heap; the tab's budget share is well under 1.5 GB (spec §1). */
function tabHeapMB(): number | undefined {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined;
}

export function tabIndicator(mb: number, tr: Translator = ENGLISH): Indicator {
  const light = mb > 1000 ? 'error' : mb > 600 ? 'warn' : 'ok';
  return { light, label: tr.t('status.tab', { mb }), detail: light === 'ok' ? tr.t('status.tabDetail') : `${tr.t('status.tabDetail')} ${tr.t('status.tabAdvice')}` };
}

function Light({ ind }: { ind: Indicator }) {
  return (
    <span class={`status-light status-${ind.light}`} title={ind.detail}>
      <span class="status-dot" aria-hidden="true" />
      {ind.label}
    </span>
  );
}
