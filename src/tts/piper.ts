/**
 * Piper TTS adapter. Spawns `piper --model <voice>.onnx --output_raw` once per request,
 * writes the text to stdin and wraps the raw PCM output in a WAV header. Nothing stays in
 * memory between requests, which keeps us inside the 300 MB TTS budget.
 * `spawn` and `fs` are injectable so tests don't need Piper installed.
 */
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import nodeFs from 'node:fs';
import path from 'node:path';
import { TtsError, type SynthesizeOptions, type TtsProvider, type TtsStatus } from './types';
import { pcm16ToWav } from './wav';

type SpawnFn = (cmd: string, args: string[]) => ChildProcessWithoutNullStreams;
type FsLike = Pick<typeof nodeFs, 'existsSync' | 'readdirSync' | 'readFileSync'>;

export interface PiperConfig {
  /** Absolute path to piper(.exe). */
  piperPath: string;
  /** Absolute path to the folder holding <voice>.onnx + <voice>.onnx.json. */
  voiceDir: string;
  defaultVoice: string;
  timeoutMs?: number;
  spawn?: SpawnFn;
  fs?: FsLike;
}

const DEFAULT_SAMPLE_RATE = 22050;

export class PiperTts implements TtsProvider {
  readonly name = 'piper';
  private readonly spawnFn: SpawnFn;
  private readonly fs: FsLike;

  constructor(private readonly config: PiperConfig) {
    this.spawnFn = config.spawn ?? ((cmd, args) => nodeSpawn(cmd, args, { windowsHide: true }));
    this.fs = config.fs ?? nodeFs;
  }

  async listVoices(): Promise<string[]> {
    try {
      return this.fs
        .readdirSync(this.config.voiceDir)
        .map(String)
        .filter((f) => f.endsWith('.onnx'))
        .map((f) => f.slice(0, -'.onnx'.length))
        .sort();
    } catch {
      return [];
    }
  }

  async status(): Promise<TtsStatus> {
    const binaryFound = this.fs.existsSync(this.config.piperPath);
    const voices = await this.listVoices();
    const ready = binaryFound && voices.includes(this.config.defaultVoice);
    const error = !binaryFound
      ? `Piper not found at ${this.config.piperPath}. Run Setup.bat.`
      : !ready
        ? `Voice "${this.config.defaultVoice}" not found in ${this.config.voiceDir}.`
        : undefined;
    return { provider: this.name, ready, binaryFound, voices, ...(error && { error }) };
  }

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<Uint8Array> {
    if (!this.fs.existsSync(this.config.piperPath)) {
      throw new TtsError('not_installed', `Piper not found at ${this.config.piperPath}`);
    }
    const voice = opts.voice ?? this.config.defaultVoice;
    const model = path.join(this.config.voiceDir, `${voice}.onnx`);
    if (!this.fs.existsSync(model)) throw new TtsError('no_voice', `Voice not found: ${voice}`);
    const sampleRate = this.readSampleRate(`${model}.json`);
    const pcm = await this.run(['--model', model, '--output_raw'], text, opts);
    return pcm16ToWav(pcm, sampleRate);
  }

  private readSampleRate(configFile: string): number {
    try {
      const cfg = JSON.parse(String(this.fs.readFileSync(configFile, 'utf8'))) as { audio?: { sample_rate?: number } };
      return cfg.audio?.sample_rate ?? DEFAULT_SAMPLE_RATE;
    } catch {
      return DEFAULT_SAMPLE_RATE;
    }
  }

  private run(args: string[], text: string, opts: SynthesizeOptions): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.config.piperPath, args);
      const chunks: Buffer[] = [];
      let stderr = '';
      let settled = false;
      const finish = (err: TtsError | null, data?: Uint8Array) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        if (err) {
          child.kill();
          reject(err);
        } else resolve(data!);
      };
      const onAbort = () => finish(new TtsError('aborted', 'TTS aborted'));
      const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs ?? 30_000;
      const timer = setTimeout(() => finish(new TtsError('timeout', `Piper took longer than ${timeoutMs} ms`)), timeoutMs);
      opts.signal?.addEventListener('abort', onAbort);

      child.stdout.on('data', (d: Buffer) => chunks.push(d));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (err) => finish(new TtsError('process', `Could not start Piper: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) finish(null, new Uint8Array(Buffer.concat(chunks)));
        else finish(new TtsError('process', `Piper exited with code ${code}: ${stderr.slice(-200)}`));
      });
      child.stdin.on('error', () => {}); // process may exit before reading stdin; 'close' reports it
      child.stdin.end(text.replace(/\s+/g, ' ').trim() + '\n');
    });
  }
}
