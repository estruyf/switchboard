// Q: What happens to the Query after interrupt()? Can the session keep going?
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log, describe } from './lib.mjs';

const input = inputQueue();
const q = query({ prompt: input, options: baseOptions({ permissionMode: 'default', canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }) }) });
input.push('Run this exact Bash command in the foreground (do NOT use run_in_background): sleep 30 && echo done');
let results = 0, tInt;
try {
  for await (const m of q) {
    if (m.type === 'assistant' && !tInt && m.message.content.some((c) => c.type === 'tool_use')) {
      setTimeout(() => { tInt = performance.now(); log('interrupt()'); q.interrupt().then((r) => log('interrupt resolved', r ?? '')); }, 1000);
    }
    if (m.type === 'user' && Array.isArray(m.message.content)) {
      const tr = m.message.content.find((c) => c.type === 'tool_result');
      if (tr) log('tool_result is_error:', tr.is_error, JSON.stringify(String(Array.isArray(tr.content) ? tr.content.map((c) => c.text).join('') : tr.content).slice(0, 120)));
    }
    if (m.type === 'result') {
      results++;
      log('result', m.subtype, 'errors:', JSON.stringify(m.errors ?? m.result ?? '').slice(0, 200));
      if (results === 1) { log('sending follow-up after interrupt'); input.push('Reply with exactly: STILL ALIVE'); }
      else input.end();
    }
    if (m.type === 'assistant') { const t = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(''); if (t) log('text:', t.slice(0, 80)); }
  }
  log('loop finished cleanly');
} catch (e) {
  log('THROWN:', e.constructor.name, String(e.message).slice(0, 400));
}
