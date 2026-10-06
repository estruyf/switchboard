import { useState } from 'react';
import { Check, FolderCog, FolderOpen, FolderPlus, Image, Layers, RotateCcw, Smile, Type, X } from 'lucide-react';
import type { ProjectIconChoice } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';

const SUGGESTED = ['🚀', '🧪', '📦', '🛠️', '🌐', '📱', '🎨', '📝', '🤖', '⚡️', '🔥', '🧩', '📊', '🎬', '🚲', '☁️'];

/** Project actions shared by the filter dropdown and session context menus. */
export function useProjectActions() {
  const connection = useEngineConnection();
  const reload = useProjects((s) => s.reload);
  const client = connection.status === 'connected' ? connection.client : null;
  const setIcon = async (root: string, icon: ProjectIconChoice) => {
    if (!client) return;
    await client.call('projects.setIcon', { root, icon });
    reload();
  };
  return {
    setIcon,
    chooseImage: async (root: string) => {
      const path = await window.switchboard?.pickImage(root);
      if (path) await setIcon(root, { kind: 'file', path });
    },
    add: async (path: string) => {
      if (!client) throw new Error('Not connected to the engine');
      await client.call('projects.add', { path });
      reload();
    },
    /** The system folder dialog, then adds what was picked. Resolves to the folder, or null when cancelled. */
    chooseAndAdd: async () => {
      const path = await window.switchboard?.pickFolder();
      if (!path || !client) return null;
      await client.call('projects.add', { path });
      reload();
      return path;
    },
    /** Links a project to a Claude profile (null: the default). */
    setProfile: async (root: string, profileId: string | null) => {
      if (!client) return;
      await client.call('projects.setProfile', { root, profileId });
      reload();
    },
    remove: async (root: string) => {
      if (!client) return;
      await client.call('projects.remove', { root });
      reload();
    },
  };
}

/** Picks an emoji for a project. */
function EmojiPicker({ x, y, root, onClose }: { x: number; y: number; root: string; onClose(): void }) {
  const { setIcon } = useProjectActions();
  const [value, setValue] = useState('');
  const apply = (emoji: string) => {
    if (emoji.trim()) void setIcon(root, { kind: 'emoji', value: emoji.trim() });
    onClose();
  };
  return (
    <div style={{ left: x, top: y }} className="no-drag fixed z-50 w-56 rounded-lg border overlay p-2" onMouseDown={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-8 gap-0.5">
        {SUGGESTED.map((emoji) => (
          <button key={emoji} type="button" onClick={() => apply(emoji)} className="rounded py-0.5 text-[15px] hover:bg-accent/15">
            {emoji}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          apply(value);
        }}
      >
        <input
          autoFocus
          value={value}
          maxLength={16}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Or type any emoji (⌃⌘Space)"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-[12px] outline-none focus:border-accent-ink/60"
        />
        <button type="button" onClick={onClose} className="rounded px-1.5 text-faint hover:text-text" aria-label="Cancel">
          <X size={13} />
        </button>
      </form>
    </div>
  );
}

/** Opens the Projects view, scrolled to one project when given. */
export function manage(root: string | null = null): void {
  useProjects.getState().setManageFocus(root);
  useSessions.getState().setView('projects');
}

/** Menu entries to change a project's icon or remove it; renders the emoji picker when chosen. */
export function useProjectIconEntries() {
  const actions = useProjectActions();
  const projects = useProjects((s) => s.projects);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = profiles.find((p) => p.isDefault);
  const openIn = useOpenIn();
  const [emojiFor, setEmojiFor] = useState<{ root: string; x: number; y: number } | null>(null);

  const entries = (root: string, at: { x: number; y: number }): MenuEntry[] => {
    const project = projects.get(root);
    const linked = project?.profileId ?? null;
    // Which account new sessions here use; only worth asking once there is more than one.
    const profileEntries: MenuEntry[] =
      profiles.length > 1 && root.startsWith('/')
        ? [
            { heading: 'Claude profile' },
            {
              label: `Default${defaultProfile ? ` (${defaultProfile.name})` : ''}`,
              hint: linked === null ? '✓' : undefined,
              onSelect: () => void actions.setProfile(root, null),
            },
            ...profiles.map(
              (p): MenuEntry => ({ label: p.name, icon: <ProfileDot color={p.color} />, hint: linked === p.id ? '✓' : undefined, onSelect: () => void actions.setProfile(root, p.id) }),
            ),
            'separator',
          ]
        : [];
    return [
      ...profileEntries,
      { heading: 'Project icon' },
      { label: 'Choose image…', icon: <Image size={13} />, onSelect: () => void actions.chooseImage(root) },
      { label: 'Use emoji…', icon: <Smile size={13} />, onSelect: () => setEmojiFor({ root, ...at }) },
      { label: 'Use letter', icon: <Type size={13} />, onSelect: () => void actions.setIcon(root, { kind: 'none' }) },
      {
        label: 'Detect automatically',
        icon: <RotateCcw size={13} />,
        hint: project?.iconSource === 'detected' ? 'current' : undefined,
        onSelect: () => void actions.setIcon(root, { kind: 'auto' }),
      },
      'separator',
      { label: 'Open folder in editor', icon: <FolderOpen size={13} />, disabled: !project?.exists, onSelect: () => void openIn(root).catch(() => {}) },
      ...(project?.added
        ? ([
            { label: 'Project settings…', icon: <FolderCog size={13} />, onSelect: () => manage(root) },
            { label: 'Remove from Switchboard', icon: <X size={13} />, danger: true, onSelect: () => void actions.remove(root) },
          ] satisfies MenuEntry[])
        : root.startsWith('/')
          ? [{ label: 'Add to projects', icon: <FolderPlus size={13} />, disabled: !project?.exists, onSelect: () => void actions.add(root) } satisfies MenuEntry]
          : []),
    ];
  };

  const picker = emojiFor ? <EmojiPicker {...emojiFor} onClose={() => setEmojiFor(null)} /> : null;
  return { entries, picker };
}

/** "All projects ▾": filter the list to one of your projects, add one, or manage them. */
export function ProjectFilter({ counts }: { counts: Map<string, { total: number; active: number }> }) {
  const projects = useProjects((s) => s.projects);
  const filter = useProjects((s) => s.filter);
  const setFilter = useProjects((s) => s.setFilter);
  const icons = useProjectIconEntries();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [submenu, setSubmenu] = useState<{ root: string; x: number; y: number } | null>(null);

  const showAdd = useProjects((s) => s.showAdd);
  const sorted = addedProjects(projects);
  const current = filter ? projects.get(filter) : undefined;

  return (
    <div className="flex items-center gap-1 px-3 pb-2">
      <button
        type="button"
        data-project-filter
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen((current) => (current ? null : { x: rect.left, y: rect.bottom + 4 }));
        }}
        className="no-drag flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-[12px] text-muted hover:bg-border/50 hover:text-text"
      >
        {filter ? <ProjectIcon project={current} root={filter} /> : <Layers size={14} className="shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{filter ? (current?.name ?? filter) : 'All projects'}</span>
        <span className="text-[9px] text-faint">▼</span>
      </button>
      <button
        type="button"
        data-tooltip="Add a project" aria-label="Add a project"
        data-add-project
        onClick={() => showAdd(true)}
        className="no-drag flex size-7 items-center justify-center rounded-md text-muted hover:bg-border/50 hover:text-text"
      >
        <FolderPlus size={15} />
      </button>

      {open && (
        <div
          style={{ left: open.x, top: open.y }}
          className="no-drag fixed z-40 max-h-[60vh] w-64 overflow-y-auto rounded-lg border overlay py-1"
        >
          <DismissLayer onDismiss={() => setOpen(null)} />
          <FilterRow selected={!filter} onSelect={() => (setFilter(null), setOpen(null))} icon={<Layers size={14} />} label="All projects" />
          <div className="my-1 border-t border-border" />
          {sorted.map((project) => (
            <FilterRow
              key={project.root}
              selected={filter === project.root}
              onSelect={() => (setFilter(project.root), setOpen(null))}
              onMore={(x, y) => setSubmenu({ root: project.root, x, y })}
              icon={<ProjectIcon project={project} root={project.root} />}
              label={project.name}
              title={project.root}
              count={counts.get(project.root)?.total ?? 0}
            />
          ))}
          {sorted.length === 0 && <p className="px-3 py-1.5 text-[12px] text-faint">No projects yet.</p>}
          <div className="my-1 border-t border-border" />
          <FilterRow selected={false} onSelect={() => (setOpen(null), showAdd(true))} icon={<FolderPlus size={14} />} label="Add project…" />
          <FilterRow selected={false} onSelect={() => (setOpen(null), manage())} icon={<FolderCog size={14} />} label="Manage projects…" />
        </div>
      )}
      {submenu && <Menu x={submenu.x} y={submenu.y} entries={icons.entries(submenu.root, submenu)} onClose={() => setSubmenu(null)} />}
      {icons.picker}
    </div>
  );
}

/** Closes the dropdown on outside clicks without stealing clicks inside it. */
function DismissLayer({ onDismiss }: { onDismiss(): void }) {
  return <div className="fixed inset-0 -z-10" onMouseDown={onDismiss} />;
}

function FilterRow(props: { selected: boolean; onSelect(): void; onMore?(x: number, y: number): void; icon: React.ReactNode; label: string; title?: string; count?: number }) {
  return (
    <div className="group flex items-center pr-1 hover:bg-accent/10" data-tooltip={props.title}>
      <button type="button" onClick={props.onSelect} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[12px]">
        {props.icon}
        <span className="min-w-0 flex-1 truncate">{props.label}</span>
        {props.count !== undefined && <span className="text-[11px] text-faint tabular-nums">{props.count}</span>}
        <span className="w-3">{props.selected && <Check size={12} className="text-accent-ink" />}</span>
      </button>
      {props.onMore && (
        <button
          type="button"
          onClick={(e) => props.onMore!(e.clientX, e.clientY)}
          className="rounded px-1 text-[13px] text-faint opacity-0 group-hover:opacity-100 hover:text-text"
          aria-label="Project options"
          data-tooltip="Icon and options"
        >
          ⋯
        </button>
      )}
    </div>
  );
}
