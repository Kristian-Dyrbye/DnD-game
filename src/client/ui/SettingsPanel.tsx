/**
 * Settings (spec §14): volumes, narration voice, AI model + test connection, performance presets
 * (including the 2D battle map), accessibility (text size, readable font, colour-blind helpers) and
 * gameplay. Every change is saved immediately (PUT /api/settings, deep-merged on the server).
 */
import { useEffect, useState } from 'preact/hooks';
import { applyPreset, type Settings } from '../../shared/settings';
import { loadSettings, settings, updateSettings } from './settingsState';

type Section = keyof Settings;

function Slider({ label, value, min = 0, max = 1, step = 0.05, format = (v: number) => `${Math.round(v * 100)}%`, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label class="setting-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
      <span class="setting-value">{format(value)}</span>
    </label>
  );
}

function Toggle({ label, value, hint, onChange }: { label: string; value: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label class="setting-row">
      <span>
        {label}
        {hint && <small class="hint"> — {hint}</small>}
      </span>
      <input type="checkbox" checked={value} onChange={() => onChange(!value)} />
    </label>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[] | { id: T; label: string }[]; onChange: (v: T) => void }) {
  const opts = (options as (T | { id: T; label: string })[]).map((o) => (typeof o === 'string' ? { id: o, label: o } : o));
  return (
    <label class="setting-row">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'audio' | 'ai' | 'performance' | 'accessibility' | 'gameplay'>('audio');
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => {
    void loadSettings();
    fetch('/api/llm/models').then((r) => r.json()).then((d: { models: string[] }) => setModels(d.models)).catch(() => undefined);
    fetch('/api/tts/voices').then((r) => r.json()).then((d: { voices: string[] }) => setVoices(d.voices)).catch(() => undefined);
  }, []);
  const s = settings.value;
  const set = <K extends Section>(section: K, patch: Partial<Settings[K]>) => void updateSettings({ [section]: patch });

  const runTest = async () => {
    setTest('Testing…');
    try {
      const r = (await (await fetch('/api/llm/test', { method: 'POST' })).json()) as { ok: boolean; error?: string; model?: string; latencyMs?: number; provider?: string };
      setTest(r.ok ? `Connected: ${r.provider} / ${r.model} answered in ${Math.round((r.latencyMs ?? 0) / 100) / 10} s.` : `Not working: ${r.error}`);
    } catch {
      setTest('Could not reach the game server.');
    }
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <section class="journal settings">
        <header class="journal-head">
          <h2>Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </header>
        <div class="method-tabs settings-tabs">
          {(['audio', 'ai', 'performance', 'accessibility', 'gameplay'] as const).map((t) => (
            <button key={t} type="button" class={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
              {t === 'ai' ? 'AI' : t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {!s ? (
          <p class="hint" style={{ padding: '1rem' }}>
            Loading…
          </p>
        ) : (
          <div class="settings-body">
            {tab === 'audio' && (
              <>
                <Slider label="Master volume" value={s.audio.master} onChange={(v) => set('audio', { master: v })} />
                <Slider label="Music" value={s.audio.music} onChange={(v) => set('audio', { music: v })} />
                <Slider label="Sound effects" value={s.audio.sfx} onChange={(v) => set('audio', { sfx: v })} />
                <Slider label="Narration voice" value={s.audio.narration} onChange={(v) => set('audio', { narration: v })} />
                <Toggle label="Read the story aloud" hint="Piper voice, generated in the background" value={s.tts.enabled} onChange={(v) => set('tts', { enabled: v })} />
                {voices.length > 0 && <Choice label="Narrator voice" value={s.tts.narratorVoice} options={voices} onChange={(v) => set('tts', { narratorVoice: v })} />}
                <Toggle label="Unload the voice when idle" value={s.tts.unloadWhenIdle} onChange={(v) => set('tts', { unloadWhenIdle: v })} />
              </>
            )}
            {tab === 'ai' && (
              <>
                {models.length > 0 ? (
                  <Choice label="Model" value={s.llm.model} options={models.includes(s.llm.model) ? models : [s.llm.model, ...models]} onChange={(v) => set('llm', { model: v })} />
                ) : (
                  <label class="setting-row">
                    <span>Model</span>
                    <input type="text" value={s.llm.model} onChange={(e) => set('llm', { model: (e.target as HTMLInputElement).value })} />
                  </label>
                )}
                <Choice label="Response length" value={s.llm.responseLength} options={['short', 'medium', 'long'] as const} onChange={(v) => set('llm', { responseLength: v })} />
                <Slider label="Creativity (temperature)" value={s.llm.temperature} min={0} max={1.5} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set('llm', { temperature: v })} />
                <Choice label="Combat narration" value={s.llm.combatNarration} options={[{ id: 'every', label: 'Every action' }, { id: 'key', label: 'Key moments' }, { id: 'off', label: 'Off' }]} onChange={(v) => set('llm', { combatNarration: v })} />
                <Toggle label="Unload the AI model when idle" hint="frees memory" value={s.llm.unloadWhenIdle} onChange={(v) => set('llm', { unloadWhenIdle: v })} />
                {s.llm.unloadWhenIdle && <Slider label="Idle minutes before unloading" value={s.llm.idleMinutes} min={1} max={60} step={1} format={(v) => `${v} min`} onChange={(v) => set('llm', { idleMinutes: v })} />}
                <Toggle label="Play without the AI" hint="template narration only" value={s.llm.useMock} onChange={(v) => set('llm', { useMock: v })} />
                <div class="setting-row">
                  <button type="button" onClick={() => void runTest()}>
                    Test connection
                  </button>
                  {test && <span class="small">{test}</span>}
                </div>
              </>
            )}
            {tab === 'performance' && (
              <>
                <Choice
                  label="Preset"
                  value={s.performance.preset}
                  options={[{ id: 'low', label: 'Low (8 GB laptops)' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'custom', label: 'Custom' }]}
                  onChange={(v) => set('performance', applyPreset(s.performance, v))}
                />
                <Choice label="Battle map" value={s.performance.gridMode} options={[{ id: '3d', label: '3D models' }, { id: '2d', label: '2D tokens (lightest)' }]} onChange={(v) => set('performance', { gridMode: v, preset: 'custom' })} />
                <Choice label="Shadows" value={s.performance.shadows} options={['off', 'low', 'high'] as const} onChange={(v) => set('performance', { shadows: v, preset: 'custom' })} />
                <Choice label="Texture quality" value={s.performance.textureQuality} options={['low', 'medium', 'high'] as const} onChange={(v) => set('performance', { textureQuality: v, preset: 'custom' })} />
                <Slider label="Max creature models" value={s.performance.maxNpcModels} min={0} max={50} step={1} format={(v) => String(v)} onChange={(v) => set('performance', { maxNpcModels: v, preset: 'custom' })} />
                <Slider label="Frame rate cap" value={s.performance.fpsCap} min={15} max={240} step={15} format={(v) => `${v} fps`} onChange={(v) => set('performance', { fpsCap: v, preset: 'custom' })} />
              </>
            )}
            {tab === 'accessibility' && (
              <>
                <Slider label="Text size" value={s.accessibility.textScale} min={0.75} max={2} step={0.05} onChange={(v) => set('accessibility', { textScale: v })} />
                <Toggle label="Easy-to-read font" hint="wider letters and spacing" value={s.accessibility.dyslexiaFont} onChange={(v) => set('accessibility', { dyslexiaFont: v })} />
                <Toggle label="Colour-blind helpers" hint="adds ✓/✗ marks and patterns to colour-coded results" value={s.accessibility.colorblindOverlays} onChange={(v) => set('accessibility', { colorblindOverlays: v })} />
              </>
            )}
            {tab === 'gameplay' && <Toggle label="Current objective hint" hint="a small reminder of what to do next" value={s.gameplay.objectiveHint} onChange={(v) => set('gameplay', { objectiveHint: v })} />}
          </div>
        )}
      </section>
    </div>
  );
}
