import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log } from './lib.mjs';
const input = inputQueue();
const q = query({ prompt: input, options: baseOptions({ persistSession: false, includePartialMessages: false }) });
const t = performance.now();
input.push('/usage');
for await (const m of q) {
  if (m.type === 'assistant' && m.usage_report) { log(`usage_report after ${Math.round(performance.now() - t)}ms`); console.log(JSON.stringify({ ...m.usage_report, session: { ...m.usage_report.session, model_usage: '…' } }, null, 1)); }
  if (m.type === 'result') break;
}
q.close();
process.exit(0);
