/** Types for check-deps-lib.mjs (so TypeScript tests can import it). */
export declare const MIN_NODE_MAJOR: number;
export declare const GAME_PORT: number;
export declare const OLLAMA_URL: string;
export declare const DEFAULT_MODEL: string;
export declare function nodeMajor(version: string): number;
export declare function nodeIsSupported(version: string): boolean;
export declare function configuredModel(settingsText: string): string;
export declare function modelInstalled(tagsJson: { models?: { name: string }[] } | null, model: string): boolean;
export declare function line(status: 'ok' | 'warn' | 'fail' | 'info', text: string): string;
export interface StartChecks {
  nodeVersion: string;
  nodeOk: boolean;
  gameAlreadyRunning: boolean;
  depsInstalled: boolean;
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  modelInstalled: boolean;
  model: string;
}
export declare function startDecision(c: StartChecks): { exitCode: number; messages: string[] };
