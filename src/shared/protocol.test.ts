import { describe, expect, it } from 'vitest';
import { parseCommand } from './protocol';

describe('protocol', () => {
  it('parses valid commands', () => {
    expect(parseCommand('{"type":"ping","reqId":"1"}')).toEqual({ ok: true, command: { type: 'ping', reqId: '1' } });
    expect(parseCommand('{"type":"say","text":"hello"}')).toEqual({ ok: true, command: { type: 'say', text: 'hello' } });
  });

  it('rejects bad JSON, unknown types and bad fields with a readable error', () => {
    expect(parseCommand('nope')).toEqual({ ok: false, error: 'Invalid JSON' });
    expect(parseCommand('{"type":"fly","reqId":"r"}')).toMatchObject({ ok: false, reqId: 'r' });
    expect(parseCommand('{"type":"save","slot":"../etc"}').ok).toBe(false);
    expect(parseCommand('{"type":"say","text":""}').ok).toBe(false);
  });
});
