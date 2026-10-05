// Q: Does CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS give us running/requires_action/idle?
// How much does startup() pre-warming save on time-to-first-token?
import { query, startup } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, log } from './lib.mjs';

const env = { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
const opts = baseOptions({ env, permissionMode: 'default', canUseTool: async (_t, i) => { log('  (permission prompt)'); return { behavior: 'allow', updatedInput: i }; } });

async function run(label, q) {
  const start = performance.now();
  let first, states = [];
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'session_state_changed') states.push(m.state);
    if (!first && m.type === 'stream_event' && m.event?.type === 'content_block_delta') first = performance.now() - start;
  }
  log(`${label}: first delta after ${Math.round(first)}ms | states: ${states.join(' > ')}`);
}

const prompt = 'Use Bash to run `touch state-test.txt`, then reply OK.';
await run('cold query()', query({ prompt, options: opts }));
const tw = performance.now();
const warm = await startup({ options: opts });
log(`startup() pre-warm took ${Math.round(performance.now() - tw)}ms (paid before the user hits Enter)`);
await run('warm query()', warm.query(prompt));
