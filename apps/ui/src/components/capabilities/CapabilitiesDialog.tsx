import { RefreshCw, RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Capabilities, McpServerInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

type Tab = 'mcp' | 'commands' | 'agents' | 'plugins';

const MCP_TONE: Record<McpServerInfo['status'], { dot: string; label: string }> = {
  connected: { dot: 'bg-ok', label: 'Connected' },
  pending: { dot: 'bg-accent-ink animate-pulse', label: 'Connecting' },
  'needs-auth': { dot: 'bg-warn', label: 'Needs sign-in' },
  failed: { dot: 'bg-error', label: 'Failed' },
  disabled: { dot: 'bg-faint', label: 'Off' },
};

function Row({ title, meta, children, detail }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; detail?: ReactNode }) {
  return (
    <div className="border-b border-border px-4 py-2 last:border-b-0">
      <div className="flex min-h-6 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-[12.5px]">{title}</div>
        {meta && <span className="shrink-0 text-[11px] text-faint">{meta}</span>}
        {children}
      </div>
      {detail && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{detail}</div>}
    </div>
  );
}

/**
 * What Claude can use in this session: MCP servers (turn on or off and reconnect when the
 * session runs here), skills and commands, agents and plugins.
 */
export function CapabilitiesDialog({ sessionId, cwd, onClose }: { sessionId: string; cwd: string; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('mcp');
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('session.capabilities', { sessionId, cwd, refresh: version > 0 }).then(
      (result) => !cancelled && (setCaps(result), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, cwd, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mcp = async (server: string, action: 'enable' | 'disable' | 'reconnect') => {
    if (!client) return;
    setBusy(server);
    try {
      await client.call('session.mcp', { sessionId, server, action });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const needle = filter.trim().toLowerCase();
  const matches = (...texts: Array<string | null | undefined>) => !needle || texts.some((t) => t?.toLowerCase().includes(needle));
  const lists = useMemo(
    () => ({
      mcp: caps?.mcp.filter((s) => matches(s.name, s.scope, ...s.tools)) ?? [],
      commands: caps?.commands.filter((c) => matches(c.name, c.description)) ?? [],
      agents: caps?.agents.filter((a) => matches(a.name, a.description)) ?? [],
      plugins: caps?.plugins.filter((p) => matches(p.name, p.scope)) ?? [],
    }),
    // `matches` only reads `needle`.
    [caps, needle],
  );
  const tabs: Array<{ id: Tab; label: string; count: number | null }> = [
    { id: 'mcp', label: 'MCP servers', count: caps?.mcp.length ?? null },
    { id: 'commands', label: 'Skills & commands', count: caps?.commands.length ?? null },
    { id: 'agents', label: 'Agents', count: caps?.agents.length ?? null },
    { id: 'plugins', label: 'Plugins', count: caps?.plugins.length ?? null },
  ];

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Tools" className="flex max-h-[76vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" data-capabilities>
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
          <h2 className="text-[13px] font-semibold">Tools</h2>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
            {caps === null ? 'Asking Claude Code…' : caps.live ? 'Live from this session' : 'For this folder (start the session here to change MCP servers)'}
          </span>
          <button type="button" title="Refresh" onClick={() => setVersion((v) => v + 1)} className="flex size-6 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text">
            <RefreshCw size={12} />
          </button>
          <button type="button" title="Close" onClick={onClose} className="flex size-6 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text">
            <X size={13} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              data-capabilities-tab={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2.5 py-1 text-[12px] ${tab === t.id ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
            >
              {t.label}
              {t.count !== null && <span className="ml-1.5 text-faint tabular-nums">{t.count}</span>}
            </button>
          ))}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            spellCheck={false}
            className="ml-auto h-7 w-36 rounded-md border border-border bg-bg px-2 text-[12px] text-text outline-none focus:border-accent-ink/60"
          />
        </div>

        {error && <p className="border-b border-border px-4 py-2 text-[12px] text-error">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto" data-capabilities-list={tab}>
          {caps === null && !error && <p className="p-4 text-[12px] text-faint">Loading…</p>}
          {caps && tab === 'mcp' && (lists.mcp.length === 0 ? <p className="p-4 text-[12px] text-faint">No MCP servers{needle ? ' match' : ' configured'}.</p> : lists.mcp.map((server) => {
            const tone = MCP_TONE[server.status];
            return (
              <Row
                key={server.name}
                title={
                  <span className="flex items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} title={tone.label} />
                    <span className="truncate font-medium">{server.name}</span>
                    {server.scope && <span className="shrink-0 rounded bg-border/60 px-1.5 text-[10.5px] text-muted">{server.scope}</span>}
                  </span>
                }
                meta={server.status === 'connected' ? `${server.tools.length} tools` : tone.label}
                detail={server.error ?? (server.tools.length ? server.tools.slice(0, 12).join(', ') + (server.tools.length > 12 ? ', …' : '') : null)}
              >
                {caps.live && (
                  <>
                    {server.status !== 'disabled' && (
                      <button type="button" title="Reconnect" disabled={busy === server.name} onClick={() => void mcp(server.name, 'reconnect')} className="flex size-6 items-center justify-center rounded text-faint hover:text-text disabled:opacity-40">
                        <RotateCw size={12} className={busy === server.name ? 'animate-spin' : ''} />
                      </button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={server.status !== 'disabled'}
                      title={server.status === 'disabled' ? 'Turn on' : 'Turn off'}
                      disabled={busy === server.name}
                      onClick={() => void mcp(server.name, server.status === 'disabled' ? 'enable' : 'disable')}
                      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${server.status === 'disabled' ? 'bg-border' : 'bg-accent'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow transition-transform ${server.status === 'disabled' ? '' : 'translate-x-3'}`} />
                    </button>
                  </>
                )}
              </Row>
            );
          }))}
          {caps && tab === 'commands' && (lists.commands.length === 0 ? <p className="p-4 text-[12px] text-faint">No skills or custom commands{needle ? ' match' : ''}.</p> : lists.commands.map((c) => (
            <Row key={c.name} title={<span className="font-mono">/{c.name}</span>} meta={c.argumentHint || undefined} detail={c.description} />
          )))}
          {caps && tab === 'agents' && (lists.agents.length === 0 ? <p className="p-4 text-[12px] text-faint">No agents{needle ? ' match' : ''}.</p> : lists.agents.map((a) => (
            <Row key={a.name} title={<span className="font-medium">{a.name}</span>} meta={a.model ?? undefined} detail={a.description} />
          )))}
          {caps && tab === 'plugins' && (lists.plugins.length === 0 ? <p className="p-4 text-[12px] text-faint">No plugins installed{needle ? ' that match' : ''}.</p> : lists.plugins.map((p) => (
            <Row key={p.name} title={<span className="font-medium">{p.name}</span>} meta={[p.version && `v${p.version}`, p.scope].filter(Boolean).join(' · ') || undefined} detail={p.path} />
          )))}
        </div>
      </div>
    </div>
  );
}
