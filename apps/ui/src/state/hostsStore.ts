import { create } from 'zustand';
import type {
  EditorInfo,
  HostState,
  LiveSession,
  LiveStatus,
  ModelOption,
  PermissionRequest,
  SessionHostInfo,
  StreamDelta,
} from '@switchboard/protocol/client';

export interface StreamingBlock {
  kind: 'text' | 'thinking' | 'tool';
  text: string;
}

interface HostsState {
  hosts: Map<string, SessionHostInfo>;
  /** Open permission prompts, oldest first. */
  permissions: Map<string, PermissionRequest>;
  /** The block Claude is writing right now, per session. */
  streaming: Map<string, StreamingBlock>;
  models: ModelOption[];
  editors: EditorInfo[];
  defaultEditorId: string | null;

  reset(hosts: SessionHostInfo[], permissions: PermissionRequest[]): void;
  upsertHost(info: SessionHostInfo): void;
  applyStream(delta: StreamDelta): void;
  addPermission(request: PermissionRequest): void;
  removePermission(requestId: string): void;
  setModels(models: ModelOption[]): void;
  setEditors(editors: EditorInfo[], defaultId: string | null): void;
}

export const useHosts = create<HostsState>()((set) => ({
  hosts: new Map(),
  permissions: new Map(),
  streaming: new Map(),
  models: [],
  editors: [],
  defaultEditorId: null,

  reset: (hosts, permissions) =>
    set({
      hosts: new Map(hosts.map((h) => [h.sessionId, h])),
      permissions: new Map(permissions.map((p) => [p.requestId, p])),
      streaming: new Map(),
    }),
  upsertHost: (info) =>
    set((state) => {
      const hosts = new Map(state.hosts).set(info.sessionId, info);
      if (info.state === 'idle' || info.state === 'closed' || info.state === 'error') {
        const streaming = new Map(state.streaming);
        streaming.delete(info.sessionId);
        return { hosts, streaming };
      }
      return { hosts };
    }),
  applyStream: (delta) =>
    set((state) => {
      const streaming = new Map(state.streaming);
      const current = streaming.get(delta.sessionId);
      if (delta.kind === 'clear') streaming.delete(delta.sessionId);
      else if (delta.kind === 'tool') streaming.set(delta.sessionId, { kind: 'tool', text: delta.text });
      else if (current?.kind === delta.kind) streaming.set(delta.sessionId, { kind: delta.kind, text: current.text + delta.text });
      else streaming.set(delta.sessionId, { kind: delta.kind, text: delta.text });
      return { streaming };
    }),
  addPermission: (request) => set((state) => ({ permissions: new Map(state.permissions).set(request.requestId, request) })),
  removePermission: (requestId) =>
    set((state) => {
      const permissions = new Map(state.permissions);
      permissions.delete(requestId);
      return { permissions };
    }),
  setModels: (models) => set({ models }),
  setEditors: (editors, defaultEditorId) => set({ editors, defaultEditorId }),
}));

const HOST_TO_LIVE: Partial<Record<HostState, LiveStatus>> = { running: 'running', starting: 'running', 'needs-you': 'needs-you', idle: 'idle' };

/** Shapes a running host like a registry entry, so the sidebar and dots treat both the same. */
export function hostAsLive(host: SessionHostInfo): LiveSession | null {
  const status = HOST_TO_LIVE[host.state];
  if (!status) return null;
  return {
    sessionId: host.sessionId,
    pid: 0,
    cwd: host.cwd,
    projectRoot: host.cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, ''),
    status,
    rawStatus: host.state,
    name: null,
    origin: 'app',
    startedAt: host.startedAt,
    // Not `Date.now()`: every working session would tie at "now" and the sidebar would keep the
    // older one on top. Later activity comes from the transcript's own updatedAt.
    updatedAt: host.startedAt,
    profileId: host.profileId,
  };
}

export const isActiveHost = (host: SessionHostInfo | undefined): host is SessionHostInfo =>
  !!host && host.state !== 'closed' && host.state !== 'error';
