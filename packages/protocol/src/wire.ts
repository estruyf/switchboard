/**
 * Messages exchanged between the engine and a UI over a MessagePort.
 * Plain objects only, so they survive structured cloning.
 */

export interface RpcErrorShape {
  code: RpcErrorCode;
  message: string;
  details?: unknown;
}

export type RpcErrorCode =
  | 'METHOD_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INVALID_RESULT'
  | 'INTERNAL'
  | 'TIMEOUT'
  | 'DISCONNECTED'
  | (string & {});

export interface RequestMessage {
  kind: 'request';
  id: number;
  method: string;
  params: unknown;
}

export type ResponseMessage =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: RpcErrorShape };

export interface EventMessage {
  kind: 'event';
  name: string;
  payload: unknown;
}

export type WireMessage = RequestMessage | ResponseMessage | EventMessage;

/** A bidirectional message channel. Implementations wrap a MessagePort. */
export interface Transport {
  send(message: WireMessage): void;
  /** Registers a listener and returns a function that removes it. */
  onMessage(listener: (message: WireMessage) => void): () => void;
  close?(): void;
}

export function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'request' || kind === 'response' || kind === 'event';
}

/** Minimal shape shared by DOM `MessagePort` and Node `worker_threads` ports. */
export interface DomLikePort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  start?(): void;
  close(): void;
}

/** Wraps a DOM (renderer) or Node `worker_threads` MessagePort. */
export function messagePortTransport(port: DomLikePort): Transport {
  return {
    send: (message) => port.postMessage(message),
    onMessage(listener) {
      const handler = (event: { data: unknown }) => {
        if (isWireMessage(event.data)) listener(event.data);
      };
      port.addEventListener('message', handler);
      port.start?.();
      return () => port.removeEventListener('message', handler);
    },
    close: () => port.close(),
  };
}
