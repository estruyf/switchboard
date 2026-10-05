// Q: Do streamed SDK message uuids match getSessionMessages() uuids? Is a uuid we set on our prompt kept?
import { query, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { baseOptions, inputQueue } from './lib.mjs';

const promptUuid = randomUUID();
const input = inputQueue();
const q = query({ prompt: input, options: baseOptions({ permissionMode: 'default', canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }) }) });
// Push a message carrying our own uuid.
input.push('Run `echo hi` with Bash, then reply DONE.');
const pushed = []; // patch: inputQueue builds the message; add uuid by mutating the last queued item is not possible, so send a raw one too
const streamed = [];
let sessionId;
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
  if (m.type === 'assistant' || m.type === 'user') streamed.push(`${m.type}:${m.uuid}${m.isReplay ? ':replay' : ''}`);
  if (m.type === 'result') break;
}
const onDisk = (await getSessionMessages(sessionId)).map((x) => `${x.type}:${x.uuid}`);
console.log('streamed:', streamed);
console.log('on disk :', onDisk);
console.log('streamed ⊆ disk:', streamed.every((s) => onDisk.includes(s.replace(':replay', ''))));
q.close?.();
process.exit(0);
