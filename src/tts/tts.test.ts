import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PiperTts, type PiperConfig } from './piper';
import { MockTts } from './mock';
import { TtsError } from './types';
import { pcm16ToWav, wavDurationSeconds } from './wav';
import { createTtsProvider } from './provider';
import { defaultSettings } from '../shared/settings';

const VOICE_DIR = path.join('C:', 'game', 'assets', 'voices');
const PIPER = path.join('C:', 'game', 'tools', 'piper', 'piper.exe');
const NARRATOR = 'en_US-lessac-medium';

interface FakeFiles {
  [file: string]: string;
}

function fakeFs(files: FakeFiles): NonNullable<PiperConfig['fs']> {
  return {
    existsSync: ((p: string) => p in files || p === VOICE_DIR) as never,
    readdirSync: ((dir: string) =>
      Object.keys(files)
        .filter((f) => path.dirname(f) === dir)
        .map((f) => path.basename(f))) as never,
    readFileSync: ((p: string) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    }) as never,
  };
}

type Behaviour = { pcm?: Uint8Array; code?: number; stderr?: string; hang?: boolean; spawnError?: Error };

function fakeSpawn(b: Behaviour) {
  const calls: { cmd: string; args: string[]; stdin: string }[] = [];
  const spawn = (cmd: string, args: string[]) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr, kill: () => true });
    const call = { cmd, args, stdin: '' };
    calls.push(call);
    stdin.on('data', (d: Buffer) => (call.stdin += d.toString()));
    stdin.on('finish', () => {
      if (b.hang) return;
      setImmediate(() => {
        if (b.spawnError) return child.emit('error', b.spawnError);
        if (b.pcm) stdout.write(Buffer.from(b.pcm));
        if (b.stderr) stderr.write(b.stderr);
        setImmediate(() => child.emit('close', b.code ?? 0));
      });
    });
    return child;
  };
  return { spawn, calls };
}

const installed: FakeFiles = {
  [PIPER]: '',
  [path.join(VOICE_DIR, `${NARRATOR}.onnx`)]: '',
  [path.join(VOICE_DIR, `${NARRATOR}.onnx.json`)]: JSON.stringify({ audio: { sample_rate: 16000 } }),
  [path.join(VOICE_DIR, 'en_GB-alan-low.onnx')]: '',
};

function piper(b: Behaviour, files: FakeFiles = installed) {
  const s = fakeSpawn(b);
  const tts = new PiperTts({ piperPath: PIPER, voiceDir: VOICE_DIR, defaultVoice: NARRATOR, spawn: s.spawn, fs: fakeFs(files) });
  return { tts, calls: s.calls };
}

describe('PiperTts', () => {
  it('spawns piper with the voice model, sends text, and returns a WAV', async () => {
    const pcm = new Uint8Array(32000); // 1 s of 16 kHz 16-bit mono
    const { tts, calls } = piper({ pcm });
    const wav = await tts.synthesize('Hello   there,\ntraveller.');
    expect(calls[0]!.cmd).toBe(PIPER);
    expect(calls[0]!.args).toEqual(['--model', path.join(VOICE_DIR, `${NARRATOR}.onnx`), '--output_raw']);
    expect(calls[0]!.stdin).toBe('Hello there, traveller.\n');
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(wavDurationSeconds(wav)).toBeCloseTo(1);
  });

  it('lists voices and reports ready status', async () => {
    const { tts } = piper({});
    expect(await tts.listVoices()).toEqual(['en_GB-alan-low', NARRATOR]);
    expect(await tts.status()).toMatchObject({ ready: true, binaryFound: true });
  });

  it('reports not-installed status and error when piper is missing', async () => {
    const { tts } = piper({}, {});
    const s = await tts.status();
    expect(s).toMatchObject({ ready: false, binaryFound: false });
    expect(s.error).toContain('Setup.bat');
    await expect(tts.synthesize('hi')).rejects.toMatchObject({ kind: 'not_installed' });
  });

  it('rejects unknown voices', async () => {
    const { tts } = piper({});
    await expect(tts.synthesize('hi', { voice: 'nobody' })).rejects.toMatchObject({ kind: 'no_voice' });
  });

  it('reports process failures with stderr', async () => {
    const { tts } = piper({ code: 1, stderr: 'bad model' });
    const err = await tts.synthesize('hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect((err as TtsError).message).toContain('bad model');
  });

  it('reports spawn errors', async () => {
    const { tts } = piper({ spawnError: new Error('EACCES') });
    await expect(tts.synthesize('hi')).rejects.toMatchObject({ kind: 'process' });
  });

  it('times out and supports abort', async () => {
    const { tts } = piper({ hang: true });
    await expect(tts.synthesize('hi', { timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
    const ctrl = new AbortController();
    const p = tts.synthesize('hi', { signal: ctrl.signal, timeoutMs: 5000 });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('MockTts', () => {
  it('returns silent WAV sized to the text and records calls', async () => {
    const tts = new MockTts();
    const wav = await tts.synthesize('one two three four five', { voice: 'npc_female' });
    expect(wavDurationSeconds(wav)).toBeCloseTo(0.3);
    expect(tts.calls).toEqual([{ text: 'one two three four five', voice: 'npc_female' }]);
    expect((await tts.status()).ready).toBe(true);
  });

  it('can simulate failure', async () => {
    const tts = new MockTts(undefined, new TtsError('not_installed', 'x'));
    await expect(tts.synthesize('hi')).rejects.toMatchObject({ kind: 'not_installed' });
    expect((await tts.status()).ready).toBe(false);
  });
});

describe('wav + provider factory', () => {
  it('writes a correct header', () => {
    const wav = pcm16ToWav(new Uint8Array(100), 22050);
    const v = new DataView(wav.buffer);
    expect(wav.length).toBe(144);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(40, true)).toBe(100);
  });

  it('creates Piper with resolved paths, or the mock', () => {
    const s = defaultSettings();
    expect(createTtsProvider(s.tts, 'C:/game').name).toBe('piper');
    expect(createTtsProvider(s.tts, 'C:/game', true).name).toBe('mock');
  });
});
