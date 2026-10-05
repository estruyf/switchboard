// Q: Is the SDK fast enough to re-read a transcript on every change (live tail)?
import { listSessions, getSessionInfo, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
const t = () => performance.now();
let s = t(); const all = await listSessions(); console.log(`listSessions: ${all.length} in ${Math.round(t() - s)}ms`);
s = t(); const all2 = await listSessions(); console.log(`listSessions (warm): ${Math.round(t() - s)}ms`);
const big = [...all].sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0)).slice(0, 3);
for (const info of big) {
  s = t(); const one = await getSessionInfo(info.sessionId); const ti = t() - s;
  s = t(); const msgs = await getSessionMessages(info.sessionId); const tm = t() - s;
  s = t(); const page = await getSessionMessages(info.sessionId, { limit: 50, offset: Math.max(0, msgs.length - 50) }); const tp = t() - s;
  s = t(); const sys = await getSessionMessages(info.sessionId, { includeSystemMessages: true }); const tsys = t() - s;
  console.log(`${(info.fileSize / 1e6).toFixed(1)}MB: getSessionInfo ${Math.round(ti)}ms | getSessionMessages ${msgs.length} msgs ${Math.round(tm)}ms | last-50 page ${Math.round(tp)}ms | +system ${sys.length} ${Math.round(tsys)}ms | msg keys ${Object.keys(msgs[0] ?? {}).join(',')}`);
}
const entry = all.find((x) => x.cwd?.includes('/.claude/worktrees/'));
console.log('example summary fields:', Object.keys(all[0]).join(','), '| projects:', new Set(all.map((x) => x.cwd)).size, 'distinct cwds', entry ? '| has worktree session' : '');
