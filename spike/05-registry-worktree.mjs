// Q: Do SDK-run sessions register in ~/.claude/sessions while running?
// Where does `claude --worktree` put worktrees, what branch, and does
// listSessions({dir}) group worktree sessions under the main repo?
import { query, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { baseOptions, log, SANDBOX, CLAUDE_BIN } from './lib.mjs';

const regDir = join(homedir(), '.claude', 'sessions');
const registry = () => readdirSync(regDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(regDir, f), 'utf8')));

// 1. SDK session visibility in the registry
const q = query({ prompt: 'Reply with exactly: OK', options: baseOptions() });
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') {
    await new Promise((r) => setTimeout(r, 300));
    const mine = registry().find((r) => r.sessionId === m.session_id);
    log('SDK session in registry while running:', mine ? { kind: mine.kind, entrypoint: mine.entrypoint, status: mine.status } : 'NO');
  }
}

// 2. CLI --worktree
const git = (...a) => execFileSync('git', a, { cwd: SANDBOX }).toString().trim();
log('worktrees before:', git('worktree', 'list'));
const out = execFileSync(CLAUDE_BIN, ['-p', '--worktree', 'spike-wt', '--model', 'haiku', '--output-format', 'json', 'Run `pwd` and `git branch --show-current` with Bash, then reply with both outputs on one line.'], {
  cwd: SANDBOX, env: process.env, timeout: 120_000,
}).toString();
const res = JSON.parse(out);
log('claude -p --worktree result:', res.subtype, JSON.stringify(res.result).slice(0, 300));
log('worktrees after:\n' + git('worktree', 'list'));
log('branches:', git('branch', '--list').replace(/\n/g, ' '));

const sessions = await listSessions({ dir: SANDBOX });
log('listSessions({dir: sandbox}) incl. worktrees:', sessions.map((s) => `${s.sessionId.slice(0, 8)} cwd=${s.cwd?.replace(SANDBOX, '<repo>')} branch=${s.gitBranch}`));
