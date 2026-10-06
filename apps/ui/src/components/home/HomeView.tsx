import { useMemo } from 'react';
import { basename, shortAge } from '../../lib/format.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { inScope, waitingLabel } from '../../state/sidebarRows.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { activityByProject, latestBranches, recentFirst } from '../newSession/projectTiles.ts';
import { WorkingDots } from '../transcript/ActivityGroup.tsx';
import { homeSessions, homeSummary, profileActivity, profileActivityLine, projectMeta } from './homeModel.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { ProfileUsageCard } from '../UsageBand.tsx';

const newSession = () => useSessions.getState().openNewSession();
const open = (id: string) => useSessions.getState().select(id);
/** New session, preset to a project (the view picks the folder up from the projects store). */
const startIn = (root: string) => {
  useProjects.getState().startIn(root);
  useSessions.getState().openNewSession();
};

function Onboarding() {
  return (
    <div className="grid max-w-sm justify-items-center gap-1.5 text-center" data-onboarding>
      <h1 className="text-title font-semibold">Add your first project</h1>
      <p className="text-ui text-muted">Projects are the folders you start Claude Code sessions in. Pick from the folders you have used Claude Code in, or choose any folder.</p>
      <button type="button" onClick={() => useProjects.getState().showAdd(true)} className="mt-2 h-8 rounded-md bg-accent px-3 text-ui font-semibold text-on-accent" data-onboarding-add>
        Add a project
      </button>
    </div>
  );
}

/** "project · branch" under a card's title. */
function where(row: SessionRowData, name: string) {
  return row.branch ? `${name} · ${row.branch}` : name;
}

/**
 * What the window shows when no session is open: what needs you, what is working, and a quick start
 * in your most recent projects. Without projects it asks you to add the first one.
 */
export function HomeView() {
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const permissions = useHosts((s) => s.permissions);
  const projects = useProjects((s) => s.projects);
  const loaded = useProjects((s) => s.loaded);

  const rows = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const { needs, working } = useMemo(() => homeSessions(rows), [rows]);
  const activity = useMemo(() => activityByProject(rows), [rows]);
  const branches = useMemo(() => latestBranches(sessions.values()), [sessions]);
  const yours = useMemo(() => addedProjects(projects).filter((p) => p.exists), [projects]);
  const tiles = useMemo(
    () => recentFirst(yours.map((p) => p.root), (root) => Math.max(projects.get(root)?.lastActivity ?? 0, activity.get(root)?.lastActivity ?? 0) || null).slice(0, 4),
    [yours, projects, activity],
  );
  // The oldest open request per session: what it waits for.
  const asks = useMemo(() => {
    const bySession = new Map<string, { toolName: string; title: string | null }>();
    for (const p of permissions.values()) if (!bySession.has(p.sessionId)) bySession.set(p.sessionId, p);
    return bySession;
  }, [permissions]);
  // Every Claude profile with its plan usage and what its sessions are doing; the default one first.
  const profiles = useProfiles((s) => s.profiles);
  const profileOrder = useMemo(() => [...profiles].filter((p) => p.exists).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)), [profiles]);
  const perProfile = useMemo(() => profileActivity(rows), [rows]);
  const nameOf = (root: string) => projects.get(root)?.name ?? basename(root);
  const now = Date.now();

  if (loaded && addedProjects(projects).length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="drag h-13 shrink-0" />
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <Onboarding />
        </div>
      </div>
    );
  }

  const heading = (label: string, count: number, tone: string, id: string) => (
    <h2 id={id} className={`flex items-center gap-2 text-meta font-semibold tracking-wide uppercase ${tone}`}>
      {label}
      <span className="rounded-full bg-border/60 px-1.5 text-meta font-semibold tabular-nums">{count}</span>
    </h2>
  );

  return (
    // A container, so the columns stack when the window (or the space beside the sidebar) is narrow.
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="drag h-13 shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-7 px-6 pb-12" data-home>
          <header className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              {/* The view's hero heading, a little larger than text-title. */}
              <h1 className="text-hero leading-tight font-semibold">Home</h1>
              <p className="mt-1 text-ui text-muted" data-home-summary>
                {homeSummary(needs.length, working.length)}
              </p>
            </div>
            <button type="button" onClick={newSession} className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-accent px-3 text-ui font-semibold text-on-accent" data-empty-new-session>
              New session
              <kbd className="font-sans text-meta font-normal opacity-60">⌘N</kbd>
            </button>
          </header>

          {(needs.length > 0 || working.length > 0) && (
            <div className="grid grid-cols-2 items-start gap-4 @max-[640px]:grid-cols-1">
              <section aria-labelledby="home-needs" className="grid gap-2">
                {heading('Needs you', needs.length, 'text-warn', 'home-needs')}
                {needs.length === 0 && <p className="text-ui text-muted">Nothing is waiting for you.</p>}
                {needs.map((row) => {
                  const ask = asks.get(row.id);
                  return (
                    <article key={row.id} className="grid gap-1 rounded-xl border border-warn/55 bg-card p-3 ring-4 ring-warn/10" data-home-needs={row.id}>
                      <div className="flex items-center justify-between gap-2 text-meta">
                        <span className="min-w-0 truncate text-muted">{where(row, nameOf(row.projectRoot))}</span>
                        <span className="shrink-0 text-warn tabular-nums">{shortAge(row.updatedAt, now)}</span>
                      </div>
                      <p className="truncate text-body font-semibold">{row.title || 'Untitled session'}</p>
                      <p className="truncate text-ui text-warn">{waitingLabel(ask?.toolName ?? null)}</p>
                      {ask?.title && <p className="truncate text-ui text-muted">{ask.title}</p>}
                      <div className="mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => open(row.id)}
                          aria-label={`Open ${row.title || 'Untitled session'}`}
                          className="h-7 rounded-md border border-border px-3 text-ui text-text hover:bg-border/50"
                          data-home-open
                        >
                          Open
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
              <section aria-labelledby="home-working" className="grid gap-2">
                {heading('Working', working.length, 'text-accent-ink', 'home-working')}
                {working.length === 0 && <p className="text-ui text-muted">Claude isn't working on anything.</p>}
                {working.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => open(row.id)}
                    className="grid gap-1 rounded-xl border border-border bg-card p-3 text-left hover:bg-border/45"
                    data-home-working={row.id}
                  >
                    <span className="truncate text-body font-semibold">{row.title || 'Untitled session'}</span>
                    <span className="truncate text-meta text-muted">{where(row, nameOf(row.projectRoot))}</span>
                    <span className="flex min-w-0 items-center gap-2 text-ui text-accent-ink">
                      <WorkingDots />
                      <span className="truncate">{row.live?.background?.[0] ?? 'Claude is working'}</span>
                      <span className="ml-auto shrink-0 text-meta text-faint tabular-nums">{shortAge(row.updatedAt, now)}</span>
                    </span>
                  </button>
                ))}
              </section>
            </div>
          )}

          {tiles.length > 0 && (
            <section aria-labelledby="home-start" className="grid gap-2">
              <h2 id="home-start" className="text-meta font-semibold tracking-wide text-faint uppercase">
                Start in a project
              </h2>
              <div className="grid grid-cols-4 gap-2 @max-[640px]:grid-cols-2">
                {tiles.map((root) => (
                  <button
                    key={root}
                    type="button"
                    onClick={() => startIn(root)}
                    aria-label={`New session in ${nameOf(root)}`}
                    className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-left hover:bg-border/45"
                    data-home-project={root}
                  >
                    <ProjectIcon project={projects.get(root)} root={root} size={24} />
                    <span className="truncate text-ui font-semibold text-text">{nameOf(root)}</span>
                    <span className="truncate font-mono text-meta text-muted">{projectMeta(branches.get(root), activity.get(root)?.open ?? 0)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {profileOrder.length > 0 && (
            <section aria-labelledby="home-profiles" className="grid gap-2" data-home-profiles>
              <h2 id="home-profiles" className="text-meta font-semibold tracking-wide text-faint uppercase">
                {profileOrder.length > 1 ? 'Profiles' : 'Usage'}
              </h2>
              <div className="grid grid-cols-2 gap-2 @max-[640px]:grid-cols-1">
                {profileOrder.map((profile) => (
                  <ProfileUsageCard key={profile.id} profileId={profile.id} activity={profileActivityLine(perProfile.get(profile.id))} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
