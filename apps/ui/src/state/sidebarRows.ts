import { basename } from '../lib/format.ts';
import type { LiveStatus } from '@switchboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';

export type SidebarRow =
  | { kind: 'project'; root: string; name: string; count: number; collapsed: boolean; liveCount: number; liveStatus: LiveStatus | null }
  | { kind: 'session'; data: SessionRowData }
  | { kind: 'more'; root: string; hidden: number; expanded: boolean };

export interface SidebarOptions {
  filter: string;
  collapsed: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  /** Sessions shown per project before "Show more". */
  perProject?: number;
}

const URGENCY: Record<LiveStatus, number> = { 'needs-you': 3, running: 2, idle: 1 };

/** The status a collapsed project should show: anything waiting on you beats work in progress beats idle. */
function mostUrgent(items: readonly SessionRowData[]): LiveStatus | null {
  let best: LiveStatus | null = null;
  for (const item of items) {
    const status = item.live?.status;
    if (status && (!best || URGENCY[status] > URGENCY[best])) best = status;
  }
  return best;
}

const matches = (row: SessionRowData, needle: string) =>
  row.title.toLowerCase().includes(needle) ||
  row.projectRoot.toLowerCase().includes(needle) ||
  (row.branch?.toLowerCase().includes(needle) ?? false);

/**
 * Flattens sessions into the rows the virtualised sidebar renders: projects
 * ordered by latest activity, each with its newest sessions first. A filter
 * shows every match and ignores collapsing.
 */
export function buildSidebarRows(sessions: readonly SessionRowData[], options: SidebarOptions): SidebarRow[] {
  const needle = options.filter.trim().toLowerCase();
  const perProject = options.perProject ?? 6;
  const groups = new Map<string, SessionRowData[]>();
  for (const session of sessions) {
    if (needle && !matches(session, needle)) continue;
    let group = groups.get(session.projectRoot);
    if (!group) groups.set(session.projectRoot, (group = []));
    group.push(session);
  }

  const ordered = [...groups.entries()]
    .map(([root, items]) => {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      return { root, items, latest: items[0]!.updatedAt };
    })
    .sort((a, b) => b.latest - a.latest);

  const rows: SidebarRow[] = [];
  for (const { root, items } of ordered) {
    const collapsed = !needle && options.collapsed.has(root);
    rows.push({
      kind: 'project',
      root,
      name: basename(root),
      count: items.length,
      collapsed,
      liveCount: items.filter((i) => i.live).length,
      liveStatus: mostUrgent(items),
    });
    if (collapsed) continue;

    const expanded = needle !== '' || options.expanded.has(root);
    const visible = expanded ? items : items.slice(0, perProject);
    // Keep the selected session visible even when it falls past the cut-off.
    const selected = expanded ? undefined : items.slice(perProject).find((i) => i.id === options.selectedId);
    for (const item of visible) rows.push({ kind: 'session', data: item });
    if (selected) rows.push({ kind: 'session', data: selected });
    if (!needle && items.length > perProject) {
      rows.push({ kind: 'more', root, hidden: items.length - perProject - (selected ? 1 : 0), expanded });
    }
  }
  return rows;
}
