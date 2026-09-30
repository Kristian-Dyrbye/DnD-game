/**
 * Settings (spec §14): volumes, narration voice, AI model + test connection, performance presets
 * (including the 2D battle map), accessibility (text size, readable font, colour-blind helpers) and
 * gameplay. Every change is saved immediately (PUT /api/settings, deep-merged on the server; the web
 * edition stores them in localStorage, has no AI tab and picks a browser voice instead of Piper).
 */
import { useEffect, useState } from 'preact/hooks';
import { LANGUAGE_NAMES } from '../../shared/i18n';
import { applyPreset, modelFor, type Settings } from '../../shared/settings';
import { ttsPlayer } from '../audio/ttsPlayer';
import { WEB_EDITION } from '../edition';
import { loadSettings, settings, updateSettings } from './settingsState';
import { t } from './i18n';
import { LanguagePicker } from './LanguagePicker';

type Section = keyof Settings;

/** The web edition has no AI, so no AI tab. */
const TABS = (['audio', 'ai', 'performance', 'accessibility', 'gameplay'] as const).filter((t) => !(WEB_EDITION && t === 'ai'));

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
    if (WEB_EDITION) {
      // Browsers load their voice list lazily and announce it with 'voiceschanged'.
      const refresh = () => setVoices(ttsPlayer.voices());
      refresh();
      if (typeof speechSynthesis === 'undefined') return;
      speechSynthesis.addEventListener('voiceschanged', refresh);
      return () => speechSynthesis.removeEventListener('voiceschanged', refresh);
    }
    fetch('/api/llm/models').then((r) => r.json()).then((d: { models: string[] }) => setModels(d.models)).catch(() => undefined);
    fetch('/api/tts/voices').then((r) => r.json()).then((d: { voices: string[] }) => setVoices(d.voices)).catch(() => undefined);
    return undefined;
  }, []);
  const s = settings.value;
  const set = <K extends Section>(section: K, patch: Partial<Settings[K]>) => void updateSettings({ [section]: patch });
  // The model picker edits the model of the current game language (settings.llm.modelByLanguage, A150).
  const lang = s?.gameplay.language ?? 'en';
  const model = s ? modelFor(s.llm, lang) : '';
  const modelLabel = lang === 'en' ? t('settings.ai.model') : t('settings.ai.modelLang', { language: LANGUAGE_NAMES[lang] });
  const setModel = (v: string) => s && set('llm', lang === 'en' ? { model: v } : { modelByLanguage: { ...s.llm.modelByLanguage, [lang]: v } });

  const runTest = async () => {
    setTest(t('settings.ai.testing'));
    try {
      const r = (await (await fetch('/api/llm/test', { method: 'POST' })).json()) as { ok: boolean; error?: string; model?: string; latencyMs?: number; provider?: string };
      setTest(r.ok ? t('settings.ai.testOk', { provider: String(r.provider), model: String(r.model), seconds: Math.round((r.latencyMs ?? 0) / 100) / 10 }) : t('settings.ai.testFail', { error: String(r.error) }));
    } catch {
      setTest(t('settings.ai.testNoServer'));
    }
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
      <section class="journal settings">
        <header class="journal-head">
          <h2>{t('settings.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('settings.closeAria')}>
            {t('common.close')}
          </button>
        </header>
        <div class="method-tabs settings-tabs">
          {TABS.map((id) => (
            <button key={id} type="button" class={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
              {t(`settings.tab.${id}`)}
            </button>
          ))}
        </div>
        {!s ? (
          <p class="hint" style={{ padding: '1rem' }}>
            {t('common.loading')}
          </p>
        ) : (
          <div class="settings-body">
            {tab === 'audio' && (
              <>
                <Slider label={t('settings.audio.master')} value={s.audio.master} onChange={(v) => set('audio', { master: v })} />
                <Slider label={t('settings.audio.music')} value={s.audio.music} onChange={(v) => set('audio', { music: v })} />
                <Slider label={t('settings.audio.sfx')} value={s.audio.sfx} onChange={(v) => set('audio', { sfx: v })} />
                <Slider label={t('settings.audio.narration')} value={s.audio.narration} onChange={(v) => set('audio', { narration: v })} />
                {WEB_EDITION ? (
                  <>
                    <Toggle label={t('settings.tts.readAloud')} hint={t('settings.tts.hintBrowser')} value={s.tts.enabled} onChange={(v) => set('tts', { enabled: v })} />
                    {voices.length > 0 && (
                      <Choice label={t('settings.tts.voice')} value={s.tts.browserVoice} options={[{ id: '', label: t('settings.tts.browserDefault') }, ...voices.map((v) => ({ id: v, label: v }))]} onChange={(v) => set('tts', { browserVoice: v })} />
                    )}
                  </>
                ) : (
                  <>
                    <Toggle label={t('settings.tts.readAloud')} hint={t('settings.tts.hintPiper')} value={s.tts.enabled} onChange={(v) => set('tts', { enabled: v })} />
                    {voices.length > 0 && <Choice label={t('settings.tts.voice')} value={s.tts.narratorVoice} options={voices} onChange={(v) => set('tts', { narratorVoice: v })} />}
                    <Toggle label={t('settings.tts.unloadIdle')} value={s.tts.unloadWhenIdle} onChange={(v) => set('tts', { unloadWhenIdle: v })} />
                  </>
                )}
              </>
            )}
            {tab === 'ai' && (
              <>
                {models.length > 0 ? (
                  <Choice label={modelLabel} value={model} options={models.includes(model) ? models : [model, ...models]} onChange={setModel} />
                ) : (
                  <label class="setting-row">
                    <span>{modelLabel}</span>
                    <input type="text" value={model} onChange={(e) => setModel((e.target as HTMLInputElement).value)} />
                  </label>
                )}
                <Choice label={t('settings.ai.responseLength')} value={s.llm.responseLength} options={(['short', 'medium', 'long'] as const).map((id) => ({ id, label: t(`settings.ai.length.${id}`) }))} onChange={(v) => set('llm', { responseLength: v })} />
                <Slider label={t('settings.ai.temperature')} value={s.llm.temperature} min={0} max={1.5} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set('llm', { temperature: v })} />
                <Choice label={t('settings.ai.combatNarration')} value={s.llm.combatNarration} options={(['every', 'key', 'off'] as const).map((id) => ({ id, label: t(`settings.ai.combat.${id}`) }))} onChange={(v) => set('llm', { combatNarration: v })} />
                <Toggle label={t('settings.ai.unloadIdle')} hint={t('settings.ai.unloadHint')} value={s.llm.unloadWhenIdle} onChange={(v) => set('llm', { unloadWhenIdle: v })} />
                {s.llm.unloadWhenIdle && <Slider label={t('settings.ai.idleMinutes')} value={s.llm.idleMinutes} min={1} max={60} step={1} format={(v) => t('settings.ai.minutes', { n: v })} onChange={(v) => set('llm', { idleMinutes: v })} />}
                <Toggle label={t('settings.ai.useMock')} hint={t('settings.ai.useMockHint')} value={s.llm.useMock} onChange={(v) => set('llm', { useMock: v })} />
                <div class="setting-row">
                  <button type="button" onClick={() => void runTest()}>
                    {t('settings.ai.test')}
                  </button>
                  {test && <span class="small">{test}</span>}
                </div>
              </>
            )}
            {tab === 'performance' && (
              <>
                <Choice
                  label={t('settings.perf.preset')}
                  value={s.performance.preset}
                  options={(['low', 'medium', 'high', 'custom'] as const).map((id) => ({ id, label: t(`settings.perf.preset.${id}`) }))}
                  onChange={(v) => set('performance', applyPreset(s.performance, v))}
                />
                <Choice label={t('settings.perf.battleMap')} value={s.performance.gridMode} options={[{ id: '3d', label: t('settings.perf.map3d') }, { id: '2d', label: t('settings.perf.map2d') }]} onChange={(v) => set('performance', { gridMode: v, preset: 'custom' })} />
                <Choice label={t('settings.perf.shadows')} value={s.performance.shadows} options={(['off', 'low', 'high'] as const).map((id) => ({ id, label: t(`settings.perf.level.${id}`) }))} onChange={(v) => set('performance', { shadows: v, preset: 'custom' })} />
                <Choice label={t('settings.perf.textureQuality')} value={s.performance.textureQuality} options={(['low', 'medium', 'high'] as const).map((id) => ({ id, label: t(`settings.perf.level.${id}`) }))} onChange={(v) => set('performance', { textureQuality: v, preset: 'custom' })} />
                <Slider label={t('settings.perf.maxModels')} value={s.performance.maxNpcModels} min={0} max={50} step={1} format={(v) => String(v)} onChange={(v) => set('performance', { maxNpcModels: v, preset: 'custom' })} />
                <Slider label={t('settings.perf.fpsCap')} value={s.performance.fpsCap} min={15} max={240} step={15} format={(v) => t('settings.perf.fps', { n: v })} onChange={(v) => set('performance', { fpsCap: v, preset: 'custom' })} />
              </>
            )}
            {tab === 'accessibility' && (
              <>
                <Slider label={t('settings.access.textSize')} value={s.accessibility.textScale} min={0.75} max={2} step={0.05} onChange={(v) => set('accessibility', { textScale: v })} />
                <Toggle label={t('settings.access.readableFont')} hint={t('settings.access.readableFontHint')} value={s.accessibility.dyslexiaFont} onChange={(v) => set('accessibility', { dyslexiaFont: v })} />
                <Toggle label={t('settings.access.colorblind')} hint={t('settings.access.colorblindHint')} value={s.accessibility.colorblindOverlays} onChange={(v) => set('accessibility', { colorblindOverlays: v })} />
              </>
            )}
            {tab === 'gameplay' && (
              <>
                <LanguagePicker hint={t('settings.gameplay.languageHint')} />
                <Toggle label={t('settings.gameplay.objectiveHint')} hint={t('settings.gameplay.objectiveHintHint')} value={s.gameplay.objectiveHint} onChange={(v) => set('gameplay', { objectiveHint: v })} />
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
