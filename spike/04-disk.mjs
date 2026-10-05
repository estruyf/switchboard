// Q: What do ~/.claude/sessions/*.json and the JSONL transcripts look like, and
// how fast is listing/scanning them? Prints shapes and counts only, never content.
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ms = (t) => `${Math.round(performance.now() - t)}ms`;
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

// --- Live session registry -------------------------------------------------
const regDir = join(CLAUDE, 'sessions');
const regFiles = readdirSync(regDir).filter((f) => f.endsWith('.json'));
const keyUnion = new Set();
const enums = { kind: new Set(), entrypoint: new Set(), status: new Set(), nameSource: new Set(), pidDomain: new Set() };
let alive = 0, dead = 0, sockets = 0;
for (const f of regFiles) {
  const r = JSON.parse(readFileSync(join(regDir, f), 'utf8'));
  Object.keys(r).forEach((k) => keyUnion.add(k));
  for (const k of Object.keys(enums)) if (r[k] !== undefined) enums[k].add(r[k]);
  try { process.kill(r.pid, 0); alive++; } catch { dead++; }
  try { if (r.messagingSocketPath && statSync(r.messagingSocketPath).isSocket()) sockets++; } catch {}
}
console.log('registry files:', regFiles.length, `(alive ${alive}, stale ${dead}, with live socket ${sockets})`);
console.log('registry keys:', [...keyUnion].join(','));
for (const [k, v] of Object.entries(enums)) console.log(`  ${k}:`, [...v].join(' | '));

// --- SDK listSessions ------------------------------------------------------
let t = performance.now();
const all = await listSessions();
console.log(`\nlistSessions() all: ${all.length} sessions in ${ms(t)}`);
console.log('  SDKSessionInfo keys:', [...new Set(all.flatMap(Object.keys))].join(','));
t = performance.now();
const one = await listSessions({ dir: process.cwd() });
console.log(`listSessions({dir}) for this folder: ${one.length} in ${ms(t)}`);

// --- Raw JSONL scan --------------------------------------------------------
t = performance.now();
const projDir = join(CLAUDE, 'projects');
let files = 0, bytes = 0, lines = 0, bad = 0, subagentFiles = 0;
const types = {};
const keysByType = {};
for (const p of readdirSync(projDir)) {
  const pd = join(projDir, p);
  for (const f of readdirSync(pd, { withFileTypes: true })) {
    if (f.isDirectory()) {
      try { subagentFiles += readdirSync(join(pd, f.name, 'subagents')).filter((x) => x.endsWith('.jsonl')).length; } catch {}
      continue;
    }
    if (!f.name.endsWith('.jsonl')) continue;
    files++;
    const text = readFileSync(join(pd, f.name), 'utf8');
    bytes += text.length;
    for (const line of text.split('\n')) {
      if (!line) continue;
      lines++;
      let rec;
      try { rec = JSON.parse(line); } catch { bad++; continue; }
      const ty = rec.type + (rec.subtype ? `:${rec.subtype}` : '');
      types[ty] = (types[ty] ?? 0) + 1;
      (keysByType[rec.type] ??= new Set());
      Object.keys(rec).forEach((k) => keysByType[rec.type].add(k));
    }
  }
}
console.log(`\nJSONL full scan: ${files} transcripts (+${subagentFiles} subagent), ${(bytes / 1e6).toFixed(1)} MB, ${lines} lines, ${bad} unparsable, in ${ms(t)}`);
console.log('record types:', Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
for (const [k, v] of Object.entries(keysByType)) console.log(`  keys[${k}]:`, [...v].join(','));
