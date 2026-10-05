// Shared helpers for the spike scripts.
import { execFileSync } from 'node:child_process';

export const CLAUDE_BIN = execFileSync('which', ['claude']).toString().trim();
export const SANDBOX = process.env.SPIKE_SANDBOX;
if (!SANDBOX) throw new Error('Set SPIKE_SANDBOX to a throwaway git repo');

export const t0 = performance.now();
export const ms = () => `${Math.round(performance.now() - t0)}ms`.padStart(7);
export const log = (...a) => console.log(ms(), ...a);

/** Push-based AsyncIterable for streaming-input mode. */
export function inputQueue() {
  const items = [];
  let wake;
  let done = false;
  return {
    push(text) {
      items.push({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
      });
      wake?.();
    },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length) yield items.shift();
        if (done) return;
        await new Promise((r) => (wake = r));
      }
    },
  };
}

export const baseOptions = (extra = {}) => ({
  cwd: SANDBOX,
  pathToClaudeCodeExecutable: CLAUDE_BIN,
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  settingSources: ['user', 'project', 'local'],
  model: 'haiku',
  includePartialMessages: true,
  ...extra,
});

/** One-line summary of an SDK message, without dumping content. */
export function describe(m) {
  if (m.type === 'stream_event') return `stream_event:${m.event?.type}`;
  if (m.type === 'system') return `system:${m.subtype}${m.state ? `(${m.state})` : ''}`;
  if (m.type === 'assistant') return `assistant:[${m.message.content.map((c) => c.type === 'tool_use' ? `tool_use:${c.name}` : c.type).join(',')}]`;
  if (m.type === 'user') return `user:[${Array.isArray(m.message.content) ? m.message.content.map((c) => c.type).join(',') : 'text'}]`;
  if (m.type === 'result') return `result:${m.subtype}`;
  return m.type;
}

process.on('unhandledRejection', (e) => console.log(ms(), 'UNHANDLED REJECTION:', e?.constructor?.name, String(e?.message ?? e).slice(0, 400)));
process.on('uncaughtException', (e) => console.log(ms(), 'UNCAUGHT:', e?.constructor?.name, String(e?.message ?? e).slice(0, 400)));
