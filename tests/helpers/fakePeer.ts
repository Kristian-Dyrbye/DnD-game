/**
 * A stand-in for a WebRTC data channel pair (C009 tests): two connected PeerChannel ends whose messages
 * arrive asynchronously, like the real thing. `close()` on either end closes both.
 */
import type { PeerChannel } from '../../src/client/net/peer';

type Handlers = Parameters<PeerChannel['on']>[0];

export function peerPair(): { guest: PeerChannel; host: PeerChannel } {
  let open = false;
  let closed = false;
  const handlers: [Handlers | undefined, Handlers | undefined] = [undefined, undefined];
  const later = (fn: () => void) => setTimeout(fn, 0);
  const end = (me: 0 | 1): PeerChannel => ({
    send(data) {
      if (!open || closed) throw new Error('channel not open');
      // Sent before a close still arrives (a data channel's close lets queued messages go out first).
      later(() => handlers[me === 0 ? 1 : 0]?.message(data));
    },
    close() {
      if (closed) return;
      closed = true;
      open = false;
      later(() => {
        handlers[0]?.close();
        handlers[1]?.close();
      });
    },
    isOpen: () => open && !closed,
    on(h) {
      handlers[me] = h;
    },
  });
  later(() => {
    if (closed) return;
    open = true;
    handlers[1]?.open();
    handlers[0]?.open();
  });
  return { guest: end(0), host: end(1) };
}
