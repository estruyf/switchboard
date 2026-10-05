// Q: Does Claude Code keep the uuid we put on our own prompt?
import { query, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { baseOptions } from './lib.mjs';
const ours = randomUUID();
async function* prompt() {
  yield { type: 'user', uuid: ours, message: { role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }, parent_tool_use_id: null };
  await new Promise((r) => setTimeout(r, 15000));
}
const q = query({ prompt: prompt(), options: baseOptions() });
let sid;
for await (const m of q) { if (m.type === 'system' && m.subtype === 'init') sid = m.session_id; if (m.type === 'result') break; }
const disk = await getSessionMessages(sid);
console.log('our uuid kept on disk:', disk.some((m) => m.uuid === ours), '| first user uuid', disk.find((m) => m.type === 'user')?.uuid === ours ? '(ours)' : '(new)');
process.exit(0);
