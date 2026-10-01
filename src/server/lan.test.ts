import type os from 'node:os';
import { describe, expect, it } from 'vitest';
import { guestMayCall, hostHeaderIsLocal, isLoopbackAddress, joinUrls, lanAddresses } from './lan';

describe('LAN helpers (C005)', () => {
  it('knows loopback addresses and Host headers', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ['192.168.1.20', '::ffff:10.0.0.2', undefined]) expect(isLoopbackAddress(a)).toBe(false);
    for (const h of ['localhost:3210', '127.0.0.1:3210', '[::1]:3210', undefined]) expect(hostHeaderIsLocal(h)).toBe(true);
    // A DNS-rebinding page names its own domain; a LAN guest names the PC's address.
    for (const h of ['evil.example:3210', '192.168.1.20:3210']) expect(hostHeaderIsLocal(h)).toBe(false);
  });

  it('a guest browser may read what its page needs, nothing that changes the host’s game', () => {
    for (const [m, u] of [['GET', '/api/health'], ['GET', '/api/status'], ['GET', '/api/settings'], ['GET', '/api/tts/12'], ['POST', '/api/llm/backstory']]) expect(guestMayCall(m!, u!)).toBe(true);
    for (const [m, u] of [['GET', '/api/saves'], ['PUT', '/api/settings'], ['DELETE', '/api/saves/quicksave'], ['POST', '/api/llm/test'], ['GET', '/api/table'], ['POST', '/api/tts/skip']]) expect(guestMayCall(m!, u!)).toBe(false);
  });

  it('lists IPv4 network addresses (no loopback, link-local or IPv6) as join links', () => {
    const ifs = {
      Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      Other: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
    } as unknown as ReturnType<typeof os.networkInterfaces>;
    expect(lanAddresses(ifs)).toEqual(['192.168.1.20']);
    expect(joinUrls(3210, 'ABC234', ['192.168.1.20'])).toEqual(['http://192.168.1.20:3210/?join=ABC234']);
  });
});
