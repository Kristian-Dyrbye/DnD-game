/**
 * A stand-in for the PeerJS broker + WebRTC (C009b tests): peers register under an id, `connect` makes
 * a pair of data connections, messages and events arrive asynchronously. A close flushes messages sent
 * before it (like `close({ flush: true })`). `down` makes every new peer fail with a network error.
 */
import type { PeerFactory, RtcConnection, RtcPeer } from '../../src/client/net/peerjs';

type Fn = (arg?: unknown) => void;
const later = (fn: () => void) => setTimeout(fn, 0);

class Emitter {
  private readonly fns = new Map<string, Fn[]>();
  on(event: string, fn: Fn): this {
    this.fns.set(event, [...(this.fns.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, arg?: unknown): void {
    for (const fn of this.fns.get(event) ?? []) fn(arg);
  }
}

class FakeConnection extends Emitter implements RtcConnection {
  open = false;
  other!: FakeConnection;
  private ended = false;
  send(data: string): void {
    if (!this.open) throw new Error('not open');
    later(() => this.other.emit('data', data));
  }
  close(): void {
    if (this.ended) return;
    this.ended = this.other.ended = true;
    this.open = this.other.open = false;
    later(() => {
      this.emit('close');
      this.other.emit('close');
    });
  }
}

class FakePeer extends Emitter implements RtcPeer {
  open = false;
  destroyed = false;
  disconnected = false;
  readonly conns: FakeConnection[] = [];
  constructor(
    private readonly broker: FakeBroker,
    readonly id: string,
  ) {
    super();
  }
  connect(id: string): RtcConnection {
    const mine = new FakeConnection();
    const theirs = new FakeConnection();
    mine.other = theirs;
    theirs.other = mine;
    this.conns.push(mine);
    later(() => {
      const target = this.broker.peers.get(id);
      if (!target || !target.open) return this.emit('error', { type: 'peer-unavailable' });
      target.conns.push(theirs);
      target.emit('connection', theirs);
      later(() => {
        mine.open = theirs.open = true;
        theirs.emit('open');
        mine.emit('open');
      });
    });
    return mine;
  }
  reconnect(): void {
    this.disconnected = false;
    later(() => this.emit('open'));
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    if (this.broker.peers.get(this.id) === this) this.broker.peers.delete(this.id);
    for (const c of this.conns) c.close();
  }
}

export class FakeBroker {
  readonly peers = new Map<string, FakePeer>();
  down = false;
  private n = 0;
  readonly factory: PeerFactory = (id) => {
    const peer = new FakePeer(this, id ?? `guest-peer-${++this.n}`);
    later(() => {
      if (this.down) return peer.emit('error', { type: 'network' });
      if (this.peers.has(peer.id)) return peer.emit('error', { type: 'unavailable-id' });
      this.peers.set(peer.id, peer);
      peer.open = true;
      peer.emit('open');
    });
    return peer;
  };
}
