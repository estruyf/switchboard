/**
 * Renderer-side entry: the RPC client and transport without the zod schemas,
 * so the UI bundle doesn't pay for runtime validation it never runs.
 */
export { createRpcClient, RpcError, type RpcClient, type ClientOptions, type EventPayload, type ParamsOf, type ResultOf } from './rpc.ts';
export { messagePortTransport, type Transport, type WireMessage } from './wire.ts';
export type * from './contract.ts';
export * from './bridge.ts';
