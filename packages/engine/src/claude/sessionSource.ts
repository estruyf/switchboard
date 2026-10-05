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
}

/** Reads Claude Code sessions. The SDK implementation is the only one that touches transcript formats. */
export interface SessionSource {
  list(): Promise<RawSessionInfo[]>;
  info(sessionId: string): Promise<RawSessionInfo | undefined>;
  messages(sessionId: string): Promise<RawSessionMessage[]>;
}

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');

/**
 * Session source backed by the Claude Agent SDK. The SDK is loaded lazily so
 * importing it (about 1 MB of JS) never delays engine startup.
 */
export function sdkSessionSource(): SessionSource {
  let sdk: Promise<Sdk> | undefined;
  const load = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'));
  return {
    list: async () => (await load()).listSessions(),
    info: async (id) => (await load()).getSessionInfo(id),
    messages: async (id) => (await (await load()).getSessionMessages(id)) as RawSessionMessage[],
  };
}
