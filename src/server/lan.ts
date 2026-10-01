/**
 * LAN co-op helpers (C005): which requests come from this PC, which REST calls a guest's browser on
 * the LAN may make, and the join links the console prints. The game listens on the LAN only when
 * Settings → Table → "Allow a friend to join" is on (main.ts); everything else stays local-only.
 */
import os from 'node:os';
import type { FastifyRequest } from 'fastify';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
}

/** Host header names this machine by a loopback name (a DNS-rebinding page names its own domain). */
export function hostHeaderIsLocal(host: string | undefined): boolean {
  if (!host) return true;
  try {
    return LOOPBACK_NAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** The request comes from this PC (the host's own browser, or a tool running here). */
export function isLocalRequest(req: FastifyRequest): boolean {
  // In-process injections (app.injectWS in tests) have no network socket at all.
  const socket = req.socket as FastifyRequest['socket'] | undefined;
  return (socket === undefined || isLoopbackAddress(socket.remoteAddress)) && hostHeaderIsLocal(req.headers.host);
}

/** REST calls a guest's browser needs: health/status, reading settings, spoken lines, a backstory idea. */
export function guestMayCall(method: string, url: string): boolean {
  const pathname = url.split('?')[0] ?? '';
  if (method === 'GET') return ['/api/health', '/api/status', '/api/settings'].includes(pathname) || /^\/api\/tts\/\d+$/.test(pathname);
  return method === 'POST' && pathname === '/api/llm/backstory';
}

/** IPv4 addresses of this PC on its networks (Wi-Fi, Ethernet), loopback and link-local left out. */
export function lanAddresses(interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

/** Links a friend opens to join: `http://<lan-ip>:<port>/?join=<code>`. */
export function joinUrls(port: number, code: string, addresses: string[] = lanAddresses()): string[] {
  return addresses.map((ip) => `http://${ip}:${port}/?join=${code}`);
}
