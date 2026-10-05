// Q: Does `--worktree` create the worktree at process start, before any message is sent?
import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { baseOptions, inputQueue, log, SANDBOX } from './lib.mjs';

const name = `timing-${Date.now() % 100000}`;
const input = inputQueue();
const q = query({ prompt: input, options: baseOptions({ extraArgs: { worktree: name } }) });
const path = join(SANDBOX, '.claude', 'worktrees', name);
const started = performance.now();
let seen = null;
while (performance.now() - started < 8000) {
  if (existsSync(path)) { seen = Math.round(performance.now() - started); break; }
  await new Promise((r) => setTimeout(r, 50));
}
log(seen === null ? 'worktree NOT created before the first message (waited 8s)' : `worktree created ${seen}ms after start, before any message`);
q.close();
process.exit(0);
