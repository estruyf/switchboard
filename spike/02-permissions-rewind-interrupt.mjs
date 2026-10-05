// Q: Can the UI own permission prompts (allow/deny/AskUserQuestion)? Does
// rewindFiles restore files? How quickly does interrupt() stop a running tool?
import { query, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { baseOptions, inputQueue, log, describe, SANDBOX } from './lib.mjs';

const NOTES = join(SANDBOX, 'notes.txt');
rmSync(NOTES, { force: true });

const input = inputQueue();
let allowBash = false;
const permissionLog = [];

const q = query({
  prompt: input,
  options: baseOptions({
    permissionMode: 'default',
    enableFileCheckpointing: true,
    canUseTool: async (toolName, toolInput, opts) => {
      permissionLog.push(toolName);
      log(`canUseTool(${toolName})`, {
        inputKeys: Object.keys(toolInput),
        suggestions: opts.suggestions?.map((s) => `${s.type}->${s.destination}`),
        optionKeys: Object.keys(opts),
      });
      if (toolName === 'AskUserQuestion') {
        const answers = Object.fromEntries(toolInput.questions.map((qq) => [qq.question, qq.options.at(-1).label]));
        log('  answering AskUserQuestion with', answers);
        return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
      }
      if (toolName === 'Bash' && !allowBash) {
        return { behavior: 'deny', message: 'The user denied Bash in this spike.' };
      }
      return { behavior: 'allow', updatedInput: toolInput };
    },
  }),
});

const turns = [
  `Use the Write tool to create the file ${NOTES} containing the word hello (that exact path, not a scratchpad). Then run \`touch spike-marker.txt\` with the Bash tool. Keep replies to one line.`,
  'Use the AskUserQuestion tool to ask me one question: "Pick a colour" with options Red and Blue. Then reply with only my answer.',
  'Run this exact Bash command in the foreground (do NOT use run_in_background): sleep 30 && echo done',
];
let turn = 0;
let interruptAt = null;
const states = [];
input.push(turns[0]);

for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'session_state_changed') states.push(m.state);
  if (m.type === 'assistant' || m.type === 'result' || (m.type === 'system' && m.subtype !== 'status')) {
    if (!m.type.startsWith('stream')) log(describe(m));
  }
  if (m.type === 'assistant') {
    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (text) log('  text:', JSON.stringify(text.slice(0, 100)));
    if (turn === 2 && !interruptAt && m.message.content.some((c) => c.type === 'tool_use' && c.name === 'Bash')) {
      setTimeout(async () => {
        interruptAt = performance.now();
        log('calling interrupt()');
        await q.interrupt();
      }, 1500);
    }
  }
  if (m.type === 'result') {
    log(`  result turn ${turn + 1}:`, m.subtype, m.is_error ? '(error)' : '', 'permission_denials:', m.permission_denials?.length ?? 0);
    if (turn === 1) {
      log('notes.txt exists before rewind:', existsSync(NOTES));
      const msgs = await getSessionMessages(m.session_id, { dir: SANDBOX });
      const firstUser = msgs.find((x) => x.type === 'user');
      log('getSessionMessages:', msgs.length, 'messages; keys:', Object.keys(msgs[0]).join(','));
      const dry = await q.rewindFiles(firstUser.uuid, { dryRun: true });
      log('rewind dryRun:', dry);
      const real = await q.rewindFiles(firstUser.uuid);
      log('rewind real:', real);
      log('notes.txt exists after rewind:', existsSync(NOTES));
      allowBash = true;
    }
    if (turn === 2) {
      log(`interrupt -> result latency: ${Math.round(performance.now() - interruptAt)}ms`);
    }
    turn++;
    if (turn < turns.length) input.push(turns[turn]);
    else input.end();
  }
}
log('permission prompts seen:', permissionLog.join(', '));
log('session_state_changed sequence:', states.join(' > ') || '(none emitted)');
