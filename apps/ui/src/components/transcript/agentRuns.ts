import type { DisplayItem } from './displayItems.ts';
import type { ToolItem } from './ToolDetails.tsx';

const isAgent = (item: DisplayItem): item is ToolItem => item.kind === 'tool' && !item.subagent && (item.name === 'Agent' || item.name === 'Task');

export interface AgentRun {
  item: ToolItem;
  running: boolean;
  /** Launched in the background (the call returns at once; the agent reports back later). */
  background: boolean;
}

/**
 * Every agent in a session and whether it's still working. A foreground agent runs until its
 * call returns; a background one until its report comes back. Nothing runs in a closed session.
 */
export function agentRuns(items: readonly DisplayItem[], sessionOpen: boolean): AgentRun[] {
  // Finished: reported back by agent id (hand-backs) or by the call's id (task notifications).
  const reported = new Set(items.flatMap((i) => (i.kind === 'agent-report' ? [i.agentId, ...(i.toolUseId ? [i.toolUseId] : [])] : [])));
  return items.filter(isAgent).map((item) => {
    const launched = item.result && /Async agent launched/.test(item.result.text);
    const agentId = launched ? /agentId: (\w+)/.exec(item.result!.text)?.[1] : undefined;
    const working = item.result === null || (launched === true && !reported.has(item.id) && !(agentId && reported.has(agentId)));
    return { item, background: !!launched, running: sessionOpen && working };
  });
}
