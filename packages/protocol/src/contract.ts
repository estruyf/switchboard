import { z } from 'zod';
import type { ContractShape } from './rpc.ts';

export const ClaudeInstall = z.object({
  path: z.string(),
  /** Semver from `claude --version`, or null when the binary exists but the version could not be read. */
  version: z.string().nullable(),
});
export type ClaudeInstall = z.infer<typeof ClaudeInstall>;

export const SystemInfo = z.object({
  engineVersion: z.string(),
  startedAt: z.number(),
  versions: z.object({
    node: z.string(),
    electron: z.string().nullable(),
    sqlite: z.string(),
  }),
  paths: z.object({
    dataDir: z.string(),
    database: z.string(),
    claudeConfigDir: z.string(),
  }),
  shell: z.object({
    path: z.string(),
    /** False when the login-shell environment could not be read and process.env was used instead. */
    resolved: z.boolean(),
    durationMs: z.number(),
  }),
  /** Null when no `claude` binary was found. */
  claude: ClaudeInstall.nullable(),
});
export type SystemInfo = z.infer<typeof SystemInfo>;

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogEntry = z.object({
  level: LogLevel,
  message: z.string(),
  at: z.number(),
});
export type LogEntry = z.infer<typeof LogEntry>;

const AppStateKey = z.string().min(1).max(200);

/** Every request the UI can make and every event the engine can push. */
export const contract = {
  requests: {
    'system.info': {
      params: z.object({}),
      result: SystemInfo,
    },
    'system.ping': {
      params: z.object({ sentAt: z.number() }),
      result: z.object({ sentAt: z.number(), engineTime: z.number() }),
    },
    'appState.get': {
      params: z.object({ key: AppStateKey }),
      result: z.object({ value: z.json().nullable() }),
    },
    'appState.set': {
      params: z.object({ key: AppStateKey, value: z.json() }),
      result: z.object({}),
    },
  },
  events: {
    'engine.log': LogEntry,
  },
} as const satisfies ContractShape;

export type Contract = typeof contract;
