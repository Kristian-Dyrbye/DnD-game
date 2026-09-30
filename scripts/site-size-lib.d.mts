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
