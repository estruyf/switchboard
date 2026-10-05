// Q: Can we list commands before any message? How do local slash commands (/cost, /context) come back?
import { query, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log, describe } from './lib.mjs';

const input = inputQueue();
const q = query({ prompt: input, options: baseOptions() });
const t = performance.now();
const cmds = await q.supportedCommands();
log(`supportedCommands before any message: ${cmds.length} in ${Math.round(performance.now() - t)}ms; e.g. ${cmds.slice(0, 6).map((c) => c.name).join(' ')}`);
const init = await q.initializationResult();
log('initializationResult keys:', Object.keys(init).join(','));
log('has /cost /context /compact /clear /config:', ['cost', 'context', 'compact', 'clear', 'config', 'model'].map((n) => `${n}=${cmds.some((c) => c.name === n)}`).join(' '));

input.push('/cost');
let sid; let results = 0;
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') { sid = m.session_id; log('init terminal_slash_commands:', JSON.stringify(m.terminal_slash_commands ?? []).slice(0, 200)); continue; }
  if (m.type === 'stream_event' || (m.type === 'system' && ['status', 'commands_changed', 'hook_started', 'hook_response'].includes(m.subtype))) continue;
  const extra = m.type === 'system' && m.subtype === 'local_command_output' ? ` content=${JSON.stringify(m.content).slice(0, 120)}` : m.type === 'user' ? ` ${JSON.stringify(m.message.content).slice(0, 160)}` : m.type === 'result' ? ` result=${JSON.stringify(m.result).slice(0, 120)}` : '';
  log(describe(m), m.uuid ?? '', extra);
  if (m.type === 'result') { results++; if (results === 1) input.push('/context'); else break; }
}
const disk = await getSessionMessages(sid, { includeSystemMessages: true });
log('on disk:', disk.map((m) => `${m.type}:${JSON.stringify(m.message?.content ?? m.message).slice(0, 70)}`).join('\n   '));
q.close();
process.exit(0);
