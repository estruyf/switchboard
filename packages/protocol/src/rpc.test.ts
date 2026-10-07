import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRpcClient, RpcError, serveRpc, type ContractShape, type RpcClient } from './rpc.ts';
import { messagePortTransport, type DomLikePort } from './wire.ts';

// Node's MessagePort is a DOM-style EventTarget at runtime; its typings just use a generic Event.
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const testContract = {
  requests: {
    add: { params: z.object({ a: z.number(), b: z.number() }), result: z.object({ sum: z.number() }) },
    fail: { params: z.object({}), result: z.object({}) },
    crash: { params: z.object({}), result: z.object({}) },
    bad: { params: z.object({}), result: z.object({ n: z.number() }) },
    slow: { params: z.object({}), result: z.object({}) },
    subscribe: { params: z.object({}), result: z.object({}) },
  },
  events: {
    tick: z.object({ n: z.number() }),
  },
} as const satisfies ContractShape;

type TestContract = typeof testContract;

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function setup(timeoutMs?: number) {
  const { port1, port2 } = new MessageChannel();
  const unexpected: string[] = [];
  const disposed: string[] = [];
  const server = serveRpc(
    testContract,
    messagePortTransport(asDomPort(port1)),
    {
      add: ({ a, b }) => ({ sum: a + b }),
      fail: () => {
        throw new RpcError('NOPE', 'expected failure', { why: 'test' });
      },
      crash: () => {
        throw new Error('boom');
      },
      bad: () => ({ n: 'not a number' }) as unknown as { n: number },
      slow: () => new Promise<Record<string, never>>(() => {}),
      subscribe: (_params, context) => {
        context.emit('tick', { n: 42 });
        context.onDispose(() => disposed.push('subscription'));
        return {};
      },
    },
    { onUnexpectedError: (method) => unexpected.push(method) },
  );
  const client: RpcClient<TestContract> = createRpcClient<TestContract>(
    messagePortTransport(asDomPort(port2)),
    timeoutMs === undefined ? {} : { timeoutMs },
  );
  cleanups.push(() => {
    client.dispose();
    server.dispose();
    port1.close();
    port2.close();
  });
  return { server, client, unexpected, disposed };
}

describe('rpc', () => {
  it('round-trips a typed call', async () => {
    const { client } = setup();
    await expect(client.call('add', { a: 2, b: 3 })).resolves.toEqual({ sum: 5 });
  });

  it('runs concurrent calls independently', async () => {
    const { client } = setup();
    const results = await Promise.all([1, 2, 3].map((n) => client.call('add', { a: n, b: n })));
    expect(results.map((r) => r.sum)).toEqual([2, 4, 6]);
  });

  it('rejects invalid params before the handler runs', async () => {
    const { client } = setup();
    const call = client.call('add', { a: 1, b: 'x' } as unknown as { a: number; b: number });
    await expect(call).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('rejects unknown methods', async () => {
    const { client } = setup();
    const call = (client as unknown as RpcClient<ContractShape>).call('nope' as never, {} as never);
    await expect(call).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('does not treat Object.prototype keys as methods', async () => {
    const { client } = setup();
    const call = (client as unknown as RpcClient<ContractShape>).call('toString' as never, {} as never);
    await expect(call).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('passes RpcError codes and details through', async () => {
    const { client, unexpected } = setup();
    await expect(client.call('fail', {})).rejects.toMatchObject({ code: 'NOPE', details: { why: 'test' } });
    expect(unexpected).toEqual([]);
  });

  it('maps unexpected errors to INTERNAL and reports them', async () => {
    const { client, unexpected } = setup();
    await expect(client.call('crash', {})).rejects.toMatchObject({ code: 'INTERNAL', message: 'boom' });
    expect(unexpected).toEqual(['crash']);
  });

  it('refuses results that break the contract', async () => {
    const { client } = setup();
    await expect(client.call('bad', {})).rejects.toMatchObject({ code: 'INVALID_RESULT' });
  });

  it('times out calls that never answer', async () => {
    const { client } = setup(50);
    await expect(client.call('slow', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fails a call at once when the transport cannot send it', async () => {
    const client = createRpcClient<TestContract>({
      send: () => {
        throw new Error('port closed');
      },
      onMessage: () => () => {},
    });
    cleanups.push(() => client.dispose());
    // With the default 30 s timeout, a leaked pending entry would make this test time out instead.
    await expect(client.call('add', { a: 1, b: 2 })).rejects.toMatchObject({ code: 'DISCONNECTED', message: expect.stringContaining('port closed') });
  });

  it('rejects pending calls on dispose', async () => {
    const { client } = setup();
    const call = client.call('slow', {});
    client.dispose();
    await expect(call).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('delivers events to subscribers until they unsubscribe', async () => {
    const { client, server } = setup();
    const seen: number[] = [];
    const off = client.on('tick', ({ n }) => seen.push(n));
    server.emit('tick', { n: 1 });
    // A round trip guarantees the earlier event was delivered first (ports are ordered).
    await client.call('add', { a: 0, b: 0 });
    off();
    server.emit('tick', { n: 2 });
    await client.call('add', { a: 0, b: 0 });
    expect(seen).toEqual([1]);
  });

  it('lets handlers emit to the caller and clean up when the connection is disposed', async () => {
    const { client, server, disposed } = setup();
    const seen: number[] = [];
    client.on('tick', ({ n }) => seen.push(n));
    await client.call('subscribe', {});
    expect(seen).toEqual([42]);
    expect(disposed).toEqual([]);
    server.dispose();
    expect(disposed).toEqual(['subscription']);
  });
});
