import {
  Activity,
  Blocks,
  FileDiff,
  FolderCog,
  FolderPlus,
  Monitor,
  Moon,
  PanelLeft,
  Play,
  Search,
  Settings,
  SquarePen,
  SquareTerminal,
  StopCircle,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { shortAge } from '../../lib/format.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { inScope } from '../../state/sidebarRows.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { ACTION_ICON, formatShortcut, useProjectActionList } from '../actions/useActions.ts';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';

interface Item {
  id: string;
  group: 'Commands' | 'Project actions' | 'Projects' | 'Sessions';
  label: string;
  /** Extra words to match on. */
  keywords?: string;
  hint?: string;
  icon: ReactNode;
  run(): void;
  /** ⌥-Enter (sessions): open in the other pane. */
  runBeside?(): void;
}

const icon = (Icon: LucideIcon) => <Icon size={14} />;

/** ⌘K: every command, the current project's actions, a new session in any project, and a jump to any session, by typing a few letters. */
export function CommandPalette() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const close = useOverlay((s) => s.close);
  const view = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const projects = useProjects((s) => s.projects);
  const updatePrefs = usePreferences((s) => s.update);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const openIn = useOpenIn();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const current = view === 'session' && selectedId ? selectedId : null;
  const summary = current ? sessions.get(current) : undefined;
  const host = current ? hosts.get(current) : undefined;
  const cwd = (isActiveHost(host) ? host.cwd : null) ?? summary?.cwd ?? (current ? live.get(current)?.cwd : null) ?? null;
  const projectRoot = summary?.projectRoot ?? (current ? live.get(current)?.projectRoot : null) ?? null;
  const { actions } = useProjectActionList(current ? projectRoot : null);
  const running = isActiveHost(host) && (host.state === 'running' || host.state === 'needs-you');

  const items = useMemo<Item[]>(() => {
    const setView = useSessions.getState().setView;
    const commands: Item[] = [
      { id: 'new', group: 'Commands', label: 'New session', hint: '⌘N', icon: icon(SquarePen), run: () => setView('new') },
      { id: 'search', group: 'Commands', label: 'Search conversations', keywords: 'find text', hint: '⌘⇧F', icon: icon(Search), run: () => useOverlay.getState().show('search') },
      { id: 'settings', group: 'Commands', label: 'Settings', keywords: 'preferences', hint: '⌘,', icon: icon(Settings), run: () => setView('settings') },
      { id: 'projects', group: 'Commands', label: 'Manage projects', keywords: 'folders defaults', icon: icon(FolderCog), run: () => setView('projects') },
      { id: 'add-project', group: 'Commands', label: 'Add project…', keywords: 'folder', icon: icon(FolderPlus), run: () => useProjects.getState().showAdd(true) },
      { id: 'diagnostics', group: 'Commands', label: 'Engine diagnostics', icon: icon(Activity), run: () => setView('diagnostics') },
      { id: 'theme-system', group: 'Commands', label: 'Theme: Match System', keywords: 'appearance', icon: icon(Monitor), run: () => updatePrefs({ colorScheme: 'system' }) },
      { id: 'theme-light', group: 'Commands', label: 'Theme: Light', keywords: 'appearance', icon: icon(Sun), run: () => updatePrefs({ colorScheme: 'light' }) },
      { id: 'theme-dark', group: 'Commands', label: 'Theme: Dark', keywords: 'appearance', icon: icon(Moon), run: () => updatePrefs({ colorScheme: 'dark' }) },
      ...(['large', 'standard', 'compact'] as const).map((style) => ({
        id: `sidebar-${style}`,
        group: 'Commands' as const,
        label: `Sidebar: ${style === 'large' ? 'Large icons' : style === 'standard' ? 'Standard' : 'Compact'}`,
        icon: icon(PanelLeft),
        run: () => updatePrefs({ sidebarStyle: style }),
      })),
    ];
    if (current) {
      commands.push(
        { id: 'terminal', group: 'Commands', label: 'Toggle terminal', hint: '⌘J', icon: icon(SquareTerminal), run: () => useTerminals.getState().togglePanel() },
        { id: 'tools', group: 'Commands', label: 'Tools: MCP servers, skills, agents, plugins', keywords: 'mcp extensions', icon: icon(Blocks), run: () => setTimeout(() => useOverlay.getState().show('tools')) },
        { id: 'changes', group: 'Commands', label: 'Toggle changes', keywords: 'diff git', hint: '⌘⇧D', icon: icon(FileDiff), run: () => useOverlay.getState().toggleChanges() },
      );
      if (cwd) commands.push({ id: 'open-in', group: 'Commands', label: 'Open folder in editor', hint: '⌘O', icon: icon(SquarePen), run: () => void openIn(cwd).catch(() => {}) });
      if (running && client) commands.push({ id: 'stop', group: 'Commands', label: 'Stop Claude', keywords: 'interrupt', hint: 'esc', icon: icon(StopCircle), run: () => void client.call('session.interrupt', { sessionId: current }) });
    }
    const projectActions: Item[] = actions.map((a) => {
      const Icon = ACTION_ICON[a.icon] ?? Play;
      return { id: `action:${a.id}`, group: 'Project actions', label: `Run: ${a.name}`, keywords: a.command, hint: a.shortcut ? formatShortcut(a.shortcut) : undefined, icon: <Icon size={14} />, run: () => useOverlay.getState().requestAction(a.id) };
    });
    // Typing a project's name starts a session there.
    const projectItems: Item[] = addedProjects(projects)
      .filter((p) => p.exists)
      .map((p) => ({
        id: `project:${p.root}`,
        group: 'Projects',
        label: `New session in ${p.name}`,
        keywords: `${p.name} ${p.root}`,
        icon: <ProjectIcon project={p} root={p.root} size={14} />,
        run: () => {
          useProjects.getState().startIn(p.root);
          setView('new');
        },
      }));
    const sessionItems: Item[] = toRows(sessions, live, hosts)
      .filter((row) => inScope(row, scope))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => {
        const project = projects.get(row.projectRoot);
        return {
          id: `session:${row.id}`,
          group: 'Sessions',
          label: row.title,
          keywords: project?.name ?? row.projectRoot.split('/').pop(),
          hint: shortAge(row.updatedAt),
          icon: <ProjectIcon project={project} root={row.projectRoot} size={14} />,
          run: () => useSessions.getState().select(row.id),
          runBeside: () => useSessions.getState().openBeside(row.id),
        };
      });
    return [...commands, ...projectActions, ...projectItems, ...sessionItems];
  }, [actions, client, current, cwd, hosts, live, openIn, projects, running, scope, sessions, updatePrefs]);

  // With nothing typed: commands, actions and the 8 most recent sessions. Otherwise the best matches.
  const results = useMemo(() => {
    if (!query.trim()) return [...items.filter((i) => i.group !== 'Sessions' && i.group !== 'Projects'), ...items.filter((i) => i.group === 'Sessions').slice(0, 8)];
    return items
      .map((item) => {
        const label = fuzzyScore(query, item.label);
        const keywords = item.keywords ? fuzzyScore(query, item.keywords) : null;
        const score = Math.max(label ?? -Infinity, keywords === null ? -Infinity : keywords - 2);
        return { item, score };
      })
      .filter((r) => r.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item: Item | undefined, beside = false) => {
    if (!item) return;
    close();
    if (beside && item.runBeside) item.runBeside();
    else item.run();
  };

  return (
    <div className="no-drag fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[14vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Command palette" className="flex max-h-[60vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" data-palette>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(results.length - 1, i + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
            else if (e.key === 'Enter') (e.preventDefault(), choose(results[active], e.altKey));
          }}
          placeholder="Type a command, an action or a session (⌥↩ opens it beside)"
          spellCheck={false}
          className="h-12 shrink-0 border-b border-border bg-transparent px-4 text-[14px] text-text outline-none placeholder:text-faint"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-faint">Nothing matches.</p>}
          {results.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || results[index - 1]!.group !== item.group) && (
                <p className="px-4 pt-2 pb-1 text-[10.5px] tracking-wide text-faint uppercase">{item.group}</p>
              )}
              <button
                type="button"
                data-active={index === active}
                data-palette-item={item.id}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(item)}
                className={`flex h-8 w-full items-center gap-2.5 px-4 text-left text-[13px] ${index === active ? 'bg-accent/15 text-text' : 'text-text/85'}`}
              >
                <span className="flex w-4 shrink-0 justify-center text-muted">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.group === 'Sessions' && item.keywords && <span className="max-w-[35%] shrink-0 truncate text-[11.5px] text-faint">{item.keywords}</span>}
                {item.hint && <span className="shrink-0 text-[11px] text-faint">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
