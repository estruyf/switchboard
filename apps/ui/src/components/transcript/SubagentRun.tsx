import { useEffect, useMemo, useState } from 'react';
import type { TranscriptMessage } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { buildDisplayItems } from './displayItems.ts';
import { TranscriptItem } from './TranscriptItem.tsx';

/**
 * The subagent's own conversation, loaded from its transcript file when the
 * Task card is opened. Refreshes every 2 s while the subagent is still running.
 */
export function SubagentRun({ sessionId, toolUseId, running, cwd }: { sessionId: string; toolUseId: string; running: boolean; cwd: string | null }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const load = () =>
      client
        .call('transcript.subagent', { sessionId, toolUseId })
        .then((r) => !cancelled && setMessages(r.messages))
        .catch(() => !cancelled && setMessages([]));
    void load();
    const timer = running ? setInterval(load, 2_000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [client, sessionId, toolUseId, running]);

  const items = useMemo(() => buildDisplayItems(messages ?? []), [messages]);
  if (messages === null) return <p className="py-1 text-[12px] text-faint">Loading the subagent’s work…</p>;
  if (items.length === 0) return <p className="py-1 text-[12px] text-faint">{running ? 'The subagent is starting…' : 'No transcript was saved for this subagent.'}</p>;
  return (
    <div className="grid max-h-[420px] gap-2 overflow-y-auto border-l-2 border-accent-ink/30 py-1 pl-3" data-subagent-run>
      {items.map((item) => (
        <TranscriptItem key={item.key} item={item} cwd={cwd} sessionId={sessionId} />
      ))}
    </div>
  );
}
