/**
 * Validates assets/voices-manifest.json (Piper binary + TTS voices). Needs no downloads:
 * checks structure, licences, voice roles and that the settings default narrator is listed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defaultSettings } from '../src/shared/settings';

const root = path.resolve(__dirname, '..');
const raw: unknown = JSON.parse(readFileSync(path.join(root, 'assets', 'voices-manifest.json'), 'utf8'));

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const hfUrl = z.string().url().startsWith('https://huggingface.co/rhasspy/piper-voices/resolve/');

const voiceSchema = z.object({
  id: z.string().regex(/^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)$/),
  role: z.enum(['narrator', 'npc_male', 'npc_female', 'extra']),
  language: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/),
  gender: z.enum(['male', 'female']),
  quality: z.enum(['x_low', 'low', 'medium', 'high']),
  url: hfUrl,
  bytes: z.number().int().positive(),
  sha256: sha,
  configUrl: hfUrl,
  configBytes: z.number().int().positive(),
  configSha256: sha,
  modelCard: z.string().url(),
  license: z.string().min(2),
  licenseQuote: z.string().min(20),
  datasetCredit: z.string().min(10),
});

const manifestSchema = z.object({
  version: z.literal(1),
  piper: z.object({
    version: z.string().min(1),
    url: z.string().url().startsWith('https://github.com/rhasspy/piper/releases/download/'),
    bytes: z.number().int().positive(),
    sha256: sha,
    exe: z.literal('piper/piper.exe'),
    license: z.string().min(2),
    licenseQuote: z.string().min(20),
  }).passthrough(),
  voices: z.array(voiceSchema).min(3),
}).passthrough();

const manifest = manifestSchema.parse(raw);
const { voices } = manifest;
const byRole = (role: string) => voices.filter((v) => v.role === role);

/** Licences we accept for voice datasets (no non-commercial / research-only terms). */
const OK_LICENSES = /^(public-domain|CC0-1\.0|CC-BY-4\.0|MIT)$/;

describe('voices manifest', () => {
  it('pins an MIT Piper binary with a licence quote', () => {
    expect(manifest.piper.license).toBe('MIT');
    expect(manifest.piper.licenseQuote).toMatch(/MIT License/);
  });

  it('every voice has an acceptable licence, a quote and a dataset credit', () => {
    for (const v of voices) {
      expect(v.license, v.id).toMatch(OK_LICENSES);
      expect(v.licenseQuote, v.id).toMatch(/public domain|CC0|Creative Commons|CC BY|MIT/i);
      expect(v.licenseQuote, v.id).not.toMatch(/non-?commercial|\bNC\b|research/i);
      expect(v.datasetCredit.length, v.id).toBeGreaterThan(10);
    }
  });

  it('urls match the voice id and the id is unique', () => {
    expect(new Set(voices.map((v) => v.id)).size).toBe(voices.length);
    for (const v of voices) {
      expect(v.url.endsWith(`/${v.id}.onnx`), v.id).toBe(true);
      expect(v.configUrl).toBe(`${v.url}.json`);
      expect(v.id.startsWith(`${v.language}-`), v.id).toBe(true);
      expect(v.id.endsWith(`-${v.quality}`), v.id).toBe(true);
    }
  });

  it('has exactly one narrator and at least one male and one female NPC voice', () => {
    expect(byRole('narrator')).toHaveLength(1);
    expect(byRole('npc_male').length).toBeGreaterThanOrEqual(1);
    expect(byRole('npc_female').length).toBeGreaterThanOrEqual(1);
    for (const v of byRole('npc_male')) expect(v.gender, v.id).toBe('male');
    for (const v of byRole('npc_female')) expect(v.gender, v.id).toBe('female');
  });

  it('does not ship the research-only lessac voice', () => {
    for (const v of voices) expect(v.id, v.id).not.toMatch(/lessac/);
  });

  // The old default 'en_US-lessac-medium' has a research-only dataset license, so it isn't shipped.
  it('the default narratorVoice setting is the manifest narrator', () => {
    expect(defaultSettings().tts.narratorVoice).toBe(byRole('narrator')[0]!.id);
  });

  it('keeps the download modest for an 8 GB machine (< 300 MB)', () => {
    const total = manifest.piper.bytes + voices.reduce((n, v) => n + v.bytes + v.configBytes, 0);
    expect(total).toBeLessThan(300 * 1024 * 1024);
  });
});
