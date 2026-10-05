// Q: Can an SDK session create its worktree the Claude Code way via extraArgs { worktree }?
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { baseOptions, log, SANDBOX } from './lib.mjs';

const q = query({ prompt: 'Run `pwd` with Bash and reply with only its output.', options: baseOptions({ extraArgs: { worktree: 'spike-sdk' }, permissionMode: 'default', canUseTool: async (_t, i) => ({ behavior: 'allow', updatedInput: i }) }) });
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') log('init cwd:', m.cwd.replace(SANDBOX, '<repo>'));
  if (m.type === 'result') log('result:', m.subtype, JSON.stringify(m.result).replaceAll(SANDBOX, '<repo>').slice(0, 200));
}
log('worktrees:', execFileSync('git', ['worktree', 'list'], { cwd: SANDBOX }).toString().replaceAll(SANDBOX, '<repo>'));
