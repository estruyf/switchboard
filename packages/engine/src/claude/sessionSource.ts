import type { RawSessionMessage } from './transcript.ts';

/** The subset of the SDK's SDKSessionInfo we use. */
export interface RawSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
  /** The Claude profile whose config folder holds the session (set by the multi-profile source). */
  profileId?: string;
}

/** Reads Claude Code sessions. The SDK implementation is the only one that touches transcript formats. */
export interface SessionSource {
  list(): Promise<RawSessionInfo[]>;
  info(sessionId: string): Promise<RawSessionInfo | undefined>;
  messages(sessionId: string): Promise<RawSessionMessage[]>;
  subagentMessages?(sessionId: string, agentId: string): Promise<RawSessionMessage[]>;
  /** Copies a session up to and including `upToMessageId` into a new one; returns its id. */
  fork?(sessionId: string, upToMessageId: string): Promise<string>;
}

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');

/** Runs an SDK call with the right config folder (see ConfigDirLane). */
export type ConfigDirScope = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Session source backed by the Claude Agent SDK. The SDK is loaded lazily so
 * importing it (about 1 MB of JS) never delays engine startup. `scope` points
 * the SDK at one profile's config folder for the duration of each call.
 */
export function sdkSessionSource(scope: ConfigDirScope = (fn) => fn()): SessionSource {
  let sdk: Promise<Sdk> | undefined;
  const load = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'));
  return {
    list: () => scope(async () => (await load()).listSessions()),
    info: (id) => scope(async () => (await load()).getSessionInfo(id)),
    messages: (id) => scope(async () => (await (await load()).getSessionMessages(id)) as RawSessionMessage[]),
    subagentMessages: (id, agentId) => scope(async () => (await (await load()).getSubagentMessages(id, agentId)) as RawSessionMessage[]),
    fork: (id, upToMessageId) => scope(async () => (await (await load()).forkSession(id, { upToMessageId })).sessionId),
  };
}
