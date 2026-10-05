// Q: Does the SDK use the existing `claude` login? Does streaming input work
// across turns? What do init + introspection calls return, and how fast?
import { query } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, inputQueue, log, describe, CLAUDE_BIN } from './lib.mjs';

log('claude binary:', CLAUDE_BIN);
const input = inputQueue();
const q = query({ prompt: input, options: baseOptions() });

input.push('Reply with exactly: ONE');
let turn = 0;
let firstToken = null;
const counts = {};

for await (const m of q) {
  const d = describe(m);
  counts[d] = (counts[d] ?? 0) + 1;
  if (m.type === 'system' && m.subtype === 'init') {
    log('init', {
      apiKeySource: m.apiKeySource,
      claude_code_version: m.claude_code_version,
      model: m.model,
      permissionMode: m.permissionMode,
      tools: m.tools?.length,
      slash_commands: m.slash_commands?.length,
      skills: m.skills?.length,
      agents: m.agents?.length,
      plugins: m.plugins?.map((p) => p.name),
      mcp_servers: m.mcp_servers?.map((s) => `${s.name}:${s.status}`),
      output_style: m.output_style,
      session_id: m.session_id,
    });
    log('init keys:', Object.keys(m).join(','));
  }
  if (m.type === 'stream_event' && !firstToken && m.event?.type === 'content_block_delta') {
    firstToken = performance.now();
    log('first token delta');
  }
  if (m.type === 'system' && m.subtype === 'session_state_changed') log('state ->', m.state);
  if (m.type === 'assistant') {
    const text = m.message.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (text) log('assistant text:', JSON.stringify(text.slice(0, 80)));
  }
  if (m.type === 'result') {
    turn++;
    log(`result turn ${turn}:`, { subtype: m.subtype, cost: m.total_cost_usd, duration_ms: m.duration_ms, num_turns: m.num_turns });
    if (turn === 1) {
      // Introspection while the session is idle.
      const [cmds, models, agents, mcp, ctx, acct] = await Promise.all([
        q.supportedCommands(), q.supportedModels(), q.supportedAgents(),
        q.mcpServerStatus(), q.getContextUsage(), q.accountInfo(),
      ]);
      log('supportedCommands:', cmds.length, 'e.g.', cmds.slice(0, 8).map((c) => c.name).join(' '));
      log('command keys:', Object.keys(cmds[0] ?? {}).join(','));
      log('supportedModels:', models.map((x) => x.value).join(' '));
      log('supportedAgents:', agents.length, agents.slice(0, 5).map((a) => a.name).join(' '));
      log('mcpServerStatus:', mcp.map((s) => `${s.name}:${s.status}`).join(' ') || '(none)');
      log('contextUsage keys:', Object.keys(ctx).join(','));
      log('accountInfo keys:', Object.keys(acct).join(','), '| subscriptionType:', acct.subscriptionType ?? '?', '| tokenSource:', acct.tokenSource ?? '?', '| apiKeySource:', acct.apiKeySource ?? '?');
      input.push('Reply with exactly: TWO');
    } else {
      input.end();
    }
  }
}
log('message type counts:', counts);
