import { MAX_LINE_BYTES } from './companionConstants.ts';
import { isWireMessage, type Transport, type WireMessage } from './wire.ts';

/**
 * A byte stream as the line transport needs it: a Unix socket in the engine or the VS Code extension
 * (`net.Socket` with `setEncoding('utf8')`), or a pair of in-memory pipes in tests.
 */
export interface TextStream {
  write(text: string): void;
  /** Registers a listener for incoming text (any chunking); returns a function that removes it. */
  onData(listener: (chunk: string) => void): () => void;
  /** Closes the stream; the other side sees it end. */
  close(): void;
}

/**
 * Splits text into lines (`\n`), however it arrives. A line longer than `maxLength` characters is refused:
 * `push` returns null and the decoder stops, since the rest of the stream can't be trusted to line up.
 */
export class LineDecoder {
  private buffer = '';
  private failed = false;

  constructor(private readonly maxLength = MAX_LINE_BYTES) {}

  push(chunk: string): string[] | null {
    if (this.failed) return null;
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > this.maxLength || lines.some((line) => line.length > this.maxLength)) {
      this.failed = true;
      this.buffer = '';
      return null;
    }
    return lines.filter((line) => line.trim() !== '');
  }
}

export interface LineTransportOptions {
  maxLineLength?: number;
  /** A line that isn't a message (bad JSON, too long). The stream is closed right after. */
  onProtocolError?(reason: string): void;
}

/**
 * The RPC transport over a text stream: one JSON message per line. Anything that isn't a message closes the
 * stream, so a confused or hostile peer can't keep it busy.
 */
export function lineTransport(stream: TextStream, options: LineTransportOptions = {}): Transport {
  const listeners = new Set<(message: WireMessage) => void>();
  const decoder = new LineDecoder(options.maxLineLength);
  const fail = (reason: string) => {
    options.onProtocolError?.(reason);
    stream.close();
  };
  stream.onData((chunk) => {
    const lines = decoder.push(chunk);
    if (!lines) return fail('A message was too long');
    for (const line of lines) {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return fail('A message was not JSON');
      }
      if (!isWireMessage(message)) return fail('A message had no kind');
      for (const listener of listeners) listener(message);
    }
  });
  return {
    send: (message) => stream.write(`${JSON.stringify(message)}\n`),
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => stream.close(),
  };
}
