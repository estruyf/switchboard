// Q: What does /usage return through the SDK, and do rate_limit_events carry the 5h/7d numbers?
// persistSession: false so no transcript is written.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log } from './lib.mjs';
const input = inputQueue();
const q = query({ prompt: input, options: baseOptions({ persistSession: false, includePartialMessages: false }) });
input.push('/usage');
for await (const m of q) {
  if (m.type === 'rate_limit_event') log('rate_limit_event', JSON.stringify(m.rate_limit_info));
  if (m.type === 'assistant') log('assistant text:', JSON.stringify(m.message.content.map((c) => c.text).join('')).slice(0, 900));
  if (m.type === 'system' && m.subtype === 'local_command_output') log('local_command_output', JSON.stringify(m).slice(0, 400));
  if (m.type === 'result') { log('result subtype', m.subtype); break; }
}
q.close();
process.exit(0);
