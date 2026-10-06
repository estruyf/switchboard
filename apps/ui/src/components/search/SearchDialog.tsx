import { Search } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SearchHit } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { shortAge } from '../../lib/format.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { useModalFocus } from '../ui/useModalFocus.ts';

const MARK = /\u0002([\s\S]*?)\u0003/g;
const HITS_PER_SESSION = 4;

/** A snippet with the matched words highlighted. */
function Snippet({ text }: { text: string }) {
  const parts: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hit: false });
    parts.push({ text: match[1]!, hit: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return (
    <span className="line-clamp-2 text-[12.5px] text-muted">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-accent/35 px-px text-text">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text.replace(/\s+/g, ' ')}</Fragment>
        ),
      )}
    </span>
  );
}

/** ⌘⇧F: search every conversation; Enter opens the session at the matching message. */
export function SearchDialog() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const close = useOverlay((s) => s.close);
  const sessions = useSessions((s) => s.sessions);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const projects = useProjects((s) => s.projects);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [indexing, setIndexing] = useState<{ indexed: number; total: number } | null>(null);
  const [active, setActive] = useState(0);
  /** The query the shown hits answer, so "no matches" waits for the engine instead of flashing while you type. */
  const [answered, setAnswered] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  useModalFocus(dialogRef);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // While the index is still being built (or hasn't started), ask again so results fill in.
    const ask = (first: boolean) => {
      client.call('search.query', { query }).then((result) => {
        if (cancelled) return;
        setHits(result.hits);
        setIndexing(result.indexing);
        setAnswered(query);
        if (first) setActive(0);
        const building = result.indexing.total === 0 || result.indexing.indexed < result.indexing.total;
        if (building && query.trim()) timer = setTimeout(() => ask(false), 1_000);
      }, () => {});
    };
    timer = setTimeout(() => ask(true), 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query]);

  // Best match first, grouped by session in the order their best match appears.
  const groups = useMemo(() => {
    const bySession = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      // Same sessions as the sidebar: with "Switchboard sessions only", others aren't searched either.
      if (scope === 'switchboard' && !sessions.get(hit.sessionId)?.inApp) continue;
      const list = bySession.get(hit.sessionId) ?? [];
      list.push(hit);
      bySession.set(hit.sessionId, list);
    }
    return [...bySession.entries()].map(([sessionId, list]) => ({ sessionId, hits: list.slice(0, HITS_PER_SESSION), more: Math.max(0, list.length - HITS_PER_SESSION) }));
  }, [hits, scope, sessions]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  const open = (hit: SearchHit) => {
    useOverlay.getState().focus({ sessionId: hit.sessionId, messageUuid: hit.messageUuid });
    useSessions.getState().select(hit.sessionId);
    close();
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const typed = query.trim();
  const stillIndexing = indexing !== null && (indexing.total === 0 || indexing.indexed < indexing.total);
  const sessionCount = groups.length;
  // Read out once the results settle; empty while nothing is typed, so opening the dialog stays quiet.
  const pending = answered !== query;
  const announcement = !typed || pending
    ? ''
    : flat.length === 0
      ? stillIndexing
        ? 'No matches yet, still indexing'
        : 'No matches'
      : `${flat.length} ${flat.length === 1 ? 'match' : 'matches'} in ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`;

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-start justify-center bg-scrim pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search conversations" className="flex max-h-[70vh] w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-xl border overlay" data-search>
        <label className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-faint" aria-hidden />
          {/* A combobox: focus stays in the field while ↑ ↓ move the highlighted match. */}
          <input
            autoFocus
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat[active] ? optionId(active) : undefined}
            aria-label="Search all conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(flat.length - 1, i + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
              else if (e.key === 'Enter' && flat[active]) open(flat[active]!);
            }}
            placeholder="Search all conversations"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
          />
          <Kbd keys="Esc" aria-hidden />
        </label>

        {typed === '' ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted">Search your prompts and Claude's replies in every session. Pick a match to jump to that message.</p>
        ) : groups.length === 0 && !pending ? (
          <div className="grid gap-1 px-4 py-6 text-center text-[12px]">
            <p className="text-text">{stillIndexing ? `Nothing for “${typed}” yet.` : `No conversations mention “${typed}”.`}</p>
            <p className="text-muted">{stillIndexing ? 'Still indexing; matches appear as sessions are read.' : 'Try another word, or fewer words.'}</p>
          </div>
        ) : null}
        <div ref={listRef} id={listId} role="listbox" aria-label="Matches" className={`min-h-0 flex-1 overflow-y-auto ${groups.length && typed ? 'py-1' : ''}`}>
          {typed !== '' &&
            groups.map((group) => {
              const summary = sessions.get(group.sessionId);
              const root = summary?.projectRoot ?? '';
              const project = projects.get(root);
              const headingId = `${listId}-${group.sessionId}`;
              return (
                <div key={group.sessionId} role="group" aria-labelledby={headingId} className="py-1" data-search-group>
                  <div id={headingId} className="flex items-center gap-2 px-4 pt-1.5 pb-1 text-[11.5px] text-muted">
                    {root && <ProjectIcon project={project} root={root} size={14} />}
                    <span className="min-w-0 truncate font-medium text-text/85">{summary?.title ?? 'Session'}</span>
                    <span className="shrink-0">· {project?.name ?? root.split('/').pop()}</span>
                    {summary && <span className="shrink-0">· {shortAge(summary.updatedAt)}</span>}
                    {group.more > 0 && <span className="ml-auto shrink-0">+{group.more} more</span>}
                  </div>
                  {group.hits.map((hit) => {
                    const index = flat.indexOf(hit);
                    return (
                      <div
                        key={hit.messageUuid}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === active}
                        data-active={index === active}
                        data-search-hit
                        onMouseMove={() => setActive(index)}
                        onClick={() => open(hit)}
                        className={`flex w-full cursor-default items-start gap-2.5 px-4 py-1.5 text-left ${index === active ? 'bg-accent/15' : ''}`}
                      >
                        <span className={`mt-px w-11 shrink-0 text-[11px] font-medium tracking-wide uppercase ${hit.role === 'user' ? 'text-accent-ink' : 'text-muted'}`}>
                          {hit.role === 'user' ? 'You' : 'Claude'}
                          <span className="sr-only">:</span>
                        </span>
                        <Snippet text={hit.snippet} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </div>

        {stillIndexing && typed !== '' && (
          <p className="shrink-0 border-t border-border px-4 py-1.5 text-[11px] text-muted">
            {indexing.total === 0 ? 'Preparing the search index…' : `Indexing ${indexing.indexed} of ${indexing.total} sessions; results will fill in.`}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>
  );
}
