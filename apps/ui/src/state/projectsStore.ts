import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProjectInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';

const FILTER_KEY = 'ui.projectFilter';

interface ProjectsState {
  projects: Map<string, ProjectInfo>;
  /** Show only this project's sessions; null = all projects. */
  filter: string | null;
  settledOpen: boolean;
  /** Bumped to ask for a reload after icon or project changes. */
  version: number;
  setProjects(projects: ProjectInfo[]): void;
  setFilter(root: string | null): void;
  toggleSettled(): void;
  reload(): void;
}

export const useProjects = create<ProjectsState>()((set) => ({
  projects: new Map(),
  filter: null,
  settledOpen: false,
  version: 0,
  setProjects: (projects) => set({ projects: new Map(projects.map((p) => [p.root, p])) }),
  setFilter: (filter) => set({ filter }),
  toggleSettled: () => set((s) => ({ settledOpen: !s.settledOpen })),
  reload: () => set((s) => ({ version: s.version + 1 })),
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
