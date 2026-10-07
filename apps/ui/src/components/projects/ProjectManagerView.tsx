import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, FolderPlus, Play, SquarePen, X, Zap } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { ProjectDefaults, ProjectInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome, shortAge, tildify } from '../../lib/format.ts';
import { addedProjects, baseOrder, moveRoot } from '../../state/projectList.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ActionEditor } from '../actions/ActionEditor.tsx';
import { useProjectActionList } from '../actions/useActions.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProfileBadge } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { RemoveProjectDialog, useProjectActions, useProjectIconEntries } from '../sidebar/ProjectMenu.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Select } from '../ui/Select.tsx';
import { useFlash } from '../ui/useFlash.ts';
import { ProjectDefaultsEditor } from './ProjectDefaultsEditor.tsx';


/** Shows a summary of the defaults a project sets, e.g. "Opus · high effort · worktree". */
function describeDefaults(d: ProjectDefaults): string {
  const parts = [
    d.model,
    d.effort && `${d.effort} effort`,
    d.permissionMode && d.permissionMode !== 'default' && d.permissionMode,
    d.workspace === 'worktree' ? `worktree${d.baseRef === 'head' ? ' from HEAD' : ''}` : d.workspace === 'current' && 'current folder',
    d.branch && `on ${d.branch}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Global defaults';
}

function activeAgo(at: number): string {
  const age = shortAge(at);
  return age === 'now' ? 'now' : /^\d+[mhd]$/.test(age) ? `${age} ago` : `on ${age}`;
}

/** Which Claude profile (account) new sessions in the project use; shown once there is more than one. */
function ProfilePicker({ project }: { project: ProjectInfo }) {
  const profiles = useProfiles((s) => s.profiles);
  const actions = useProjectActions();
  if (profiles.length < 2) return null;
  const fallback = profiles.find((p) => p.isDefault);
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 @max-[560px]:grid-cols-1 @max-[560px]:gap-1">
      <span className="text-ui text-muted">Claude profile</span>
      <span className="flex min-w-0 items-center gap-2">
        <Select
          label="Claude profile"
          className="h-7 min-w-0 rounded-md border border-border bg-bg px-2 text-ui text-text outline-none focus:border-accent-ink/60"
          value={project.profileId ?? ''}
          onChange={(value) => void actions.setProfile(project.root, value || null)}
          options={[{ value: '', label: `Default${fallback ? ` (${fallback.name})` : ''}` }, ...profiles.map((p) => ({ value: p.id, label: p.name, hint: p.account?.email ?? undefined }))]}
          menuWidth={320}
          dataAttrs={{ 'data-project-profile': true }}
        />
      </span>
    </div>
  );
}

/** The project's actions editor, opened from its row. A save closes it (`onSaved`). */
function ProjectActions({ root, onSaved, onClose }: { root: string; onSaved(): void; onClose(): void }) {
  const { actions, sharedFile, errors, reload } = useProjectActionList(root);
  return <ActionEditor projectRoot={root} actions={actions} sharedFile={sharedFile} errors={errors} onChanged={reload} onSaved={onSaved} onClose={onClose} />;
}

function ProjectRow({
  project,
  index,
  total,
  home,
  open,
  onToggle,
  onMove,
  onRemove,
  onActions,
  onIconMenu,
  status,
}: {
  project: ProjectInfo;
  index: number;
  total: number;
  home: string | null;
  open: boolean;
  onToggle(): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
  onActions(): void;
  onIconMenu(event: MouseEvent): void;
  /** A confirmation next to the Actions button, such as "Action saved". */
  status: string | null;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const reload = useProjects((s) => s.reload);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!client || !open || !project.exists) return;
    let cancelled = false;
    void client.call('projects.inspect', { path: project.root }).then((r) => !cancelled && setIsGitRepo(r.isGitRepo));
    return () => {
      cancelled = true;
    };
  }, [client, open, project.root, project.exists]);

  const save = async (defaults: ProjectDefaults) => {
    if (!client) return;
    try {
      setError(null);
      await client.call('projects.setDefaults', { root: project.root, defaults });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startHere = () => {
    useProjects.getState().startIn(project.root);
    useSessions.getState().setView('new');
  };

  return (
    <li className="rounded-lg border border-border bg-card" data-project-row={project.root}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={onIconMenu} data-tooltip="Change icon" aria-label={`Change the icon of ${project.name}`} aria-haspopup="menu" className="shrink-0 rounded-md hover:opacity-80">
          <ProjectIcon project={project} root={project.root} size={30} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="grid min-w-0 flex-1 text-left"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          data-tooltip={open ? 'Hide defaults' : 'Show defaults for new sessions'}
          data-project-toggle
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">{project.name}</span>
            <ChevronRight size={13} aria-hidden className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
            {!project.exists && (
              <span className="flex shrink-0 items-center gap-1 text-warn" data-tooltip="This folder no longer exists">
                <AlertTriangle size={11} aria-hidden /> Folder not found ·
              </span>
            )}
            <span className="truncate">{tildify(project.root, home)}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted @max-[560px]:hidden">
            <ProfileBadge profileId={project.profileId} />
            <span className="min-w-0 truncate">
              <span data-defaults-summary>{describeDefaults(project.defaults)}</span>
              {project.sessionCount > 0 && ` · ${project.sessionCount} ${project.sessionCount === 1 ? 'session' : 'sessions'}`}
              {project.lastActivity !== null && `, active ${activeAgo(project.lastActivity)}`}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {status && (
            <Notice inline tone="success" icon={<Check size={12} aria-hidden />} className="mr-1.5" data-action-status>
              {status}
            </Notice>
          )}
          {/* Names include the project: a screen reader hears "Move Website up", not five rows of "Move up". */}
          <Button
            variant="quiet"
            iconOnly
            icon={<SquarePen size={14} aria-hidden />}
            onClick={startHere}
            disabled={!project.exists}
            data-tooltip="New session in this project"
            aria-label={`New session in ${project.name}`}
          />
          <Button variant="quiet" iconOnly icon={<Zap size={14} aria-hidden />} onClick={onActions} data-tooltip="Project actions" aria-label={`Actions of ${project.name}`} data-project-actions />
          <Button
            variant="quiet"
            iconOnly
            icon={<ArrowUp size={14} aria-hidden />}
            onClick={() => onMove(-1)}
            disabled={index === 0}
            data-tooltip="Move up in the list"
            aria-label={`Move ${project.name} up`}
            data-move-up
          />
          <Button
            variant="quiet"
            iconOnly
            icon={<ArrowDown size={14} aria-hidden />}
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            data-tooltip="Move down in the list"
            aria-label={`Move ${project.name} down`}
            data-move-down
          />
          <Button
            variant="quiet"
            iconOnly
            icon={<X size={14} aria-hidden />}
            onClick={onRemove}
            data-tooltip="Remove from the project list (files stay on disk)"
            aria-label={`Remove ${project.name} from the project list`}
            className="hover:text-error!"
            data-remove-project
          />
        </div>
      </div>
      {open && (
        <div id={panelId} className="grid gap-3 border-t border-border px-3 py-3">
          <p className="text-ui text-muted">New sessions in {project.name} start with these. The New session view can still change them for one session.</p>
          <ProfilePicker project={project} />
          <ProjectDefaultsEditor root={project.root} defaults={project.defaults} isGitRepo={isGitRepo} onSave={(d) => void save(d)} />
          {error && (
            <p role="alert" className="text-ui text-error">
              Couldn't save the defaults: {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={<Play size={12} aria-hidden />} onClick={onActions}>
              Edit actions…
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Your projects: add, remove and reorder them, and set each one's defaults for new sessions. */
export function ProjectManagerView() {
  const projects = useProjects((s) => s.projects);
  const focus = useProjects((s) => s.manageFocus);
  const showAdd = useProjects((s) => s.showAdd);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const reload = useProjects((s) => s.reload);
  const icons = useProjectIconEntries();
  const list = useMemo(() => addedProjects(projects), [projects]);
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  const [openRoot, setOpenRoot] = useState<string | null>(focus);
  const [removing, setRemoving] = useState<ProjectInfo | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  /** The project whose actions were just saved, for its confirmation. */
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [actionStatus, flashAction] = useFlash();
  const [iconMenu, setIconMenu] = useState<{ root: string; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Opened from a project's menu: show that one.
  useEffect(() => {
    if (!focus) return;
    setOpenRoot(focus);
    useProjects.getState().setManageFocus(null);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-project-row="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [focus]);

  // The order last sent, until the list catches up with it: two quick clicks must not both start from the old list.
  const pendingOrder = useRef<string[] | null>(null);
  useEffect(() => {
    const shown = list.map((p) => p.root);
    if (pendingOrder.current?.join('\n') === shown.join('\n')) pendingOrder.current = null;
  }, [list]);
  const move = async (root: string, delta: -1 | 1) => {
    if (!client) return;
    const roots = moveRoot(baseOrder(pendingOrder.current, list.map((p) => p.root)), root, delta);
    pendingOrder.current = roots;
    try {
      await client.call('projects.reorder', { roots });
    } catch {
      pendingOrder.current = null;
    }
    reload();
  };

  const iconEntries: MenuEntry[] = iconMenu ? icons.entries(iconMenu.root, iconMenu).filter((e) => typeof e === 'string' || !('label' in e) || !/^(Remove|Project settings)/.test(e.label)) : [];

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-project-manager>
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="flex-1 text-title font-semibold">Projects</h1>
        <Button icon={<FolderPlus size={13} aria-hidden />} onClick={() => showAdd(true)} className="no-drag" data-manager-add>
          Add project
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-4 px-6 py-6">
          <p className="text-[12.5px] text-muted">
            Projects are the folders you work in with Switchboard. They are listed in the sidebar and the New session view, in this order. Removing one only takes it
            off these lists: nothing on disk changes, and its sessions stay in search and under sessions from other apps.
          </p>
          {list.length === 0 ? (
            <div className="grid justify-items-start gap-2 rounded-lg border border-dashed border-border px-4 py-5" data-no-projects>
              <p className="text-[13px] font-medium">No projects yet</p>
              <p className="text-ui text-muted">Add the folders you want to start Claude Code sessions in. Folders you have used Claude Code in are suggested.</p>
              <Button variant="primary" onClick={() => showAdd(true)} className="mt-1">
                Add a project
              </Button>
            </div>
          ) : (
            <ul ref={listRef} className="grid gap-2" aria-label="Your projects">
              {list.map((project, index) => (
                <ProjectRow
                  key={project.root}
                  project={project}
                  index={index}
                  total={list.length}
                  home={home}
                  open={openRoot === project.root}
                  onToggle={() => setOpenRoot((r) => (r === project.root ? null : project.root))}
                  onMove={(delta) => void move(project.root, delta)}
                  onRemove={() => setRemoving(project)}
                  onActions={() => setActionsFor(project.root)}
                  status={savedFor === project.root ? actionStatus : null}
                  onIconMenu={(e) => {
                    // From the keyboard there is no pointer position (detail 0): open under the icon instead.
                    const rect = e.currentTarget.getBoundingClientRect();
                    setIconMenu(e.detail ? { root: project.root, x: e.clientX, y: e.clientY } : { root: project.root, x: rect.left, y: rect.bottom + 4 });
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {iconMenu && <Menu x={iconMenu.x} y={iconMenu.y} entries={iconEntries} label="Project icon" onClose={() => setIconMenu(null)} />}
      {icons.overlays}
      {actionsFor && (
        <ProjectActions
          root={actionsFor}
          onSaved={() => {
            setSavedFor(actionsFor);
            setActionsFor(null);
            flashAction('Action saved');
          }}
          onClose={() => setActionsFor(null)}
        />
      )}
      {removing && <RemoveProjectDialog root={removing.root} name={removing.name} onClose={() => setRemoving(null)} />}
    </div>
  );
}
