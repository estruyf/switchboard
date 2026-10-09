import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LineDecoder, lineTransport, type TextStream } from './lineTransport.ts';
import { createRpcClient, serveRpc, type ContractShape } from './rpc.ts';

/** Two connected in-memory streams; `chunk` splits every write in two, as a socket may. */
function pipe(chunk = false) {
  const sides = [new Set<(text: string) => void>(), new Set<(text: string) => void>()] as const;
  const closed = [false, false];
  const make = (me: 0 | 1): TextStream => ({
    write(text) {
      const peer = sides[me === 0 ? 1 : 0];
      const parts = chunk && text.length > 2 ? [text.slice(0, 3), text.slice(3)] : [text];
      for (const part of parts) for (const listener of peer) listener(part);
    },
    onData(listener) {
      sides[me].add(listener);
      return () => sides[me].delete(listener);
    },
    close() {
      closed[me] = true;
    },
  });
  return { a: make(0), b: make(1), closed };
}

describe('LineDecoder', () => {
  it('splits lines however the text arrives', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(decoder.push(':2}\n\n')).toEqual(['{"b":2}']);
  });

  it('refuses a line that is too long, and everything after it', () => {
    const decoder = new LineDecoder(5);
    expect(decoder.push('123456')).toBeNull();
    expect(decoder.push('\nok\n')).toBeNull();
  });
});

const contract = {
  requests: { add: { params: z.object({ a: z.number(), b: z.number() }), result: z.object({ sum: z.number() }) } },
  events: {},
} as const satisfies ContractShape;

describe('lineTransport', () => {
  it('carries requests and responses, split across chunks', async () => {
    const { a, b } = pipe(true);
    serveRpc(contract, lineTransport(a), { add: ({ a: x, b: y }) => ({ sum: x + y }) });
    const client = createRpcClient<typeof contract>(lineTransport(b));
    await expect(client.call('add', { a: 2, b: 3 })).resolves.toEqual({ sum: 5 });
  });

  it('closes the stream on a line that is not a message', () => {
    const { a, b, closed } = pipe();
    const errors: string[] = [];
    lineTransport(a, { onProtocolError: (reason) => errors.push(reason) });
    b.write('not json\n');
    expect(closed[0]).toBe(true);
    expect(errors).toEqual(['A message was not JSON']);
  });
});
