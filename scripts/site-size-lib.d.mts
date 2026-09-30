/** Types for site-size-lib.mjs (plain ESM so the Pages workflow runs it with bare Node). */
export interface SiteFile {
  path: string;
  bytes: number;
}
export interface SiteReport {
  total: number;
  files: number;
  groups: { app: number; models: number; audio: number; other: number };
  largest: SiteFile[];
}
export const SITE_LIMIT_BYTES: number;
export const FILE_LIMIT_BYTES: number;
export function groupOf(rel: string): 'app' | 'models' | 'audio' | 'other';
export function siteReport(dir: string, top?: number): SiteReport;
export function checkSite(report: SiteReport, limits?: { site?: number; file?: number }): string[];
export function mb(n: number): string;
export function formatReport(report: SiteReport): string[];

export interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
}
export type ViteManifest = Record<string, ManifestChunk>;
export interface CodeSize {
  files: number;
  bytes: number;
  gzip: number;
}
export interface LoadReport {
  firstLoad: CodeSize;
  lazy: Record<string, CodeSize>;
}
export const FIRST_LOAD_LIMIT_GZ: number;
export const START_MODULES: string[];
export const LAZY_GROUPS: Record<string, string[]>;
export function manifestClosure(manifest: ViteManifest, keys: string[]): Set<string>;
export function loadReport(manifest: ViteManifest, gzipSize: (file: string) => { bytes: number; gzip: number }): LoadReport;
export function checkLoad(report: LoadReport, limitGz?: number): string[];
export function formatLoad(report: LoadReport): string[];
