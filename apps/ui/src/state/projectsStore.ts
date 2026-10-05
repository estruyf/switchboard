import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProjectInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';

const FILTER_KEY = 'ui.projectFilter';

interface ProjectsState {
  projects: Map<string, ProjectInfo>;
  /** The first list has arrived. */
  loaded: boolean;
  /** Show only this project's sessions; null = all projects. */
  filter: string | null;
  settledOpen: boolean;
  /** Bumped to ask for a reload after icon or project changes. */
  version: number;
  /** The Add project dialog is open. */
  adding: boolean;
  /** The project the Projects view should scroll to and open (from a project's menu). */
  manageFocus: string | null;
  /** A folder the New session view should switch to when it opens (from the palette or the Projects view). */
  newSessionIn: string | null;
  setProjects(projects: ProjectInfo[]): void;
  setFilter(root: string | null): void;
  toggleSettled(): void;
  reload(): void;
  showAdd(open: boolean): void;
  setManageFocus(root: string | null): void;
  startIn(root: string | null): void;
}

export const useProjects = create<ProjectsState>()((set) => ({
  projects: new Map(),
  loaded: false,
  filter: null,
  settledOpen: false,
  version: 0,
  adding: false,
  manageFocus: null,
  newSessionIn: null,
  setProjects: (projects) => set({ projects: new Map(projects.map((p) => [p.root, p])), loaded: true }),
  setFilter: (filter) => set({ filter }),
  toggleSettled: () => set((s) => ({ settledOpen: !s.settledOpen })),
  reload: () => set((s) => ({ version: s.version + 1 })),
  showAdd: (adding) => set({ adding }),
  setManageFocus: (manageFocus) => set({ manageFocus }),
  startIn: (newSessionIn) => set({ newSessionIn }),
}));

/** Loads projects (with icons) whenever the set of project folders changes, and persists the filter. */
export function useProjectsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const rootsKey = useSessions((s) => [...new Set([...s.sessions.values()].map((x) => x.projectRoot))].sort().join('\n'));
  const version = useProjects((s) => s.version);
  const filter = useProjects((s) => s.filter);

  useEffect(() => {
    if (!client) return;
    void client.call('projects.list', {}).then(({ projects }) => useProjects.getState().setProjects(projects));
  }, [client, rootsKey, version]);

  useEffect(() => {
    if (!client) return;
    void client.call('appState.get', { key: FILTER_KEY }).then(({ value }) => {
      if (typeof value === 'string') useProjects.getState().setFilter(value);
    });
  }, [client]);

  useEffect(() => {
    if (client) void client.call('appState.set', { key: FILTER_KEY, value: filter });
  }, [client, filter]);
}
