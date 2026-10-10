/**
 * The VS Code companion's entry: the RPC client, the line transport and the companion contract's types, without
 * the zod schemas (the engine validates what the extension sends).
 */
export { createRpcClient, RpcError, type RpcClient, type ParamsOf, type ResultOf, type EventPayload } from './rpc.ts';
export { lineTransport, LineDecoder, type TextStream } from './lineTransport.ts';
export type { Transport, WireMessage } from './wire.ts';
export type * from './companion.ts';
export type * from './context.ts';
export type { PermissionDecision, PermissionRequest } from './host.ts';
export * from './companionConstants.ts';
