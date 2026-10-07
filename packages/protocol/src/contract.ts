import { z } from 'zod';
import type { ContractShape } from './rpc.ts';
import {
  EditorInfo,
  Effort,
  ImageAttachment,
  ModelOption,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ProjectInspection,
  RewindResult,
  ContextUsage,
  SessionHostInfo,
  SlashCommand,
  StreamDelta,
  WorktreeRequest,
} from './host.ts';
import {
  LiveSession,
  ProjectDefaults,
  ProjectIconChoice,
  ProjectInfo,
  SearchHit,
  SessionsChanged,
  SessionsSnapshot,
  TranscriptMessage,
  TranscriptUpdate,
} from './sessions.ts';
import { TerminalInfo, TerminalKind } from './terminal.ts';
import { UsageSnapshot } from './usage.ts';
import { ActionRunResult, ActionSuggestion, ListedAction, ProjectAction } from './actions.ts';
import { ChangesBase, GitChanges, GitSyncAction, WorktreeStatus } from './git.ts';
import { Capabilities } from './capabilities.ts';
import { ProfileColor, ProfilesSnapshot } from './profiles.ts';
import { ClaudeUpdateState } from './claudeUpdate.ts';
import { BackupSectionSchema, FolderMapping, ImportMode, ImportPreview } from './backup.ts';
import { LaterDraft, LaterItem } from './later.ts';

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
    /** True when the environment came from the cache of a previous launch (refreshed in the background). */
    cached: z.boolean(),
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
const SessionId = z.string().min(1).max(200);
const AbsolutePath = z.string().min(1).max(4096).startsWith('/');
const Prompt = z.string().max(200_000);
const ProfileId = z.string().min(1).max(100);
const ProfileName = z.string().trim().min(1).max(60);
const SettingsFilePath = AbsolutePath.regex(/\.json$/i, 'Settings files end in .json');
/** The app's preferences, which main keeps: the renderer passes them in and applies what comes back. */
const PreferencesRecord = z.record(z.string(), z.unknown());

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
    /** Sidebar data. Answers from the cache immediately; `sessions.changed` follows when the scan finishes. */
    'sessions.list': {
      params: z.object({}),
      result: SessionsSnapshot,
    },
    /** Pin a session, or archive it (moves it to "Archived") until it has new activity. */
    'sessions.setFlags': {
      params: z.object({ sessionId: SessionId, pinned: z.boolean().optional(), archived: z.boolean().optional() }),
      result: z.object({}),
    },
    /**
     * Moves a session's transcript (and its subagent transcripts) to the Trash.
     * Stops it first when it runs in this app; refuses (SESSION_BUSY_ELSEWHERE) when another window has it open.
     */
    'session.delete': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /**
     * Gives a session a title of your own, stored in its transcript like Claude Code's `/rename`,
     * so `claude --resume` shows it too. The new title arrives with `sessions.changed`.
     */
    'session.rename': { params: z.object({ sessionId: SessionId, title: z.string().trim().min(1).max(200) }), result: z.object({}) },
    /** The user is looking at this session now; clears its unread state. */
    'sessions.markViewed': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /**
     * Your projects (`added`) in your order, plus every other folder Claude Code has sessions for
     * (`added: false`), which the Add project picker offers and the sidebar uses for icons.
     */
    'projects.list': { params: z.object({}), result: z.object({ projects: z.array(ProjectInfo) }) },
    'projects.add': { params: z.object({ path: AbsolutePath }), result: z.object({}) },
    /** Removes a project from Switchboard's list. Nothing on disk changes; its sessions stay. */
    'projects.remove': { params: z.object({ root: AbsolutePath }), result: z.object({}) },
    'projects.setIcon': { params: z.object({ root: AbsolutePath, icon: ProjectIconChoice }), result: z.object({}) },
    /** Links a project to a Claude profile; null uses the default profile. */
    'projects.setProfile': { params: z.object({ root: AbsolutePath, profileId: ProfileId.nullable() }), result: z.object({}) },
    /** Replaces a project's defaults for new sessions. */
    'projects.setDefaults': { params: z.object({ root: AbsolutePath, defaults: ProjectDefaults }), result: z.object({}) },
    /** Puts your projects in this order (roots not listed keep their place after these). */
    'projects.reorder': { params: z.object({ roots: z.array(AbsolutePath).max(5000) }), result: z.object({}) },
    /**
     * A local checkout of GitHub's `owner/name`: the first of your projects, then the other folders with
     * sessions (most recently active first), with a git remote on that repository. Null when none has one.
     */
    'projects.findByRepo': { params: z.object({ repo: z.string().max(200).regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/) }), result: z.object({ root: AbsolutePath.nullable() }) },
    // --- Claude profiles (one login per config folder) --------------------------------------
    'profiles.list': { params: z.object({}), result: ProfilesSnapshot },
    /** Adds a profile for a config folder (created when missing). Sign in there with `CLAUDE_CONFIG_DIR=<folder> claude`. */
    'profiles.add': {
      params: z.object({ name: ProfileName, color: ProfileColor, configDir: AbsolutePath }),
      result: z.object({ id: z.string() }),
    },
    'profiles.update': { params: z.object({ id: ProfileId, name: ProfileName.optional(), color: ProfileColor.optional() }), result: z.object({}) },
    /** Removes a profile from Switchboard (its folder, login and sessions stay). Its projects fall back to the default. */
    'profiles.remove': { params: z.object({ id: ProfileId }), result: z.object({}) },
    'profiles.setDefault': { params: z.object({ id: ProfileId }), result: z.object({}) },
    /** Forces a full rescan of ~/.claude/projects. */
    'sessions.refresh': {
      params: z.object({}),
      result: z.object({}),
    },
    'transcript.get': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ sessionId: z.string(), messages: z.array(TranscriptMessage) }),
    },
    /** One image from a transcript, as base64. */
    'transcript.image': {
      params: z.object({ sessionId: SessionId, imageId: z.string().min(1).max(300) }),
      result: z.object({ mediaType: z.string(), data: z.string() }),
    },
    /** The transcript of the subagent a Task/Agent tool call started (null when it hasn't written one yet). */
    'transcript.subagent': {
      params: z.object({ sessionId: SessionId, toolUseId: z.string().min(1).max(200) }),
      result: z.object({ agentId: z.string().nullable(), agentType: z.string().nullable(), messages: z.array(TranscriptMessage) }),
    },
    /** Subscribes this window to `transcript.updated` for one session until unwatched or disconnected. */
    'transcript.watch': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({}),
    },
    'transcript.unwatch': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({}),
    },

    // --- Sessions run by this app ----------------------------------------------------------
    /** Running sessions and their open permission requests (for a window that just connected). */
    'hosts.list': {
      params: z.object({}),
      result: z.object({ hosts: z.array(SessionHostInfo), permissions: z.array(PermissionRequest) }),
    },
    /** Starts a new Claude Code session and sends the first message. */
    'session.create': {
      params: z.object({
        cwd: AbsolutePath,
        prompt: Prompt,
        attachments: z.array(ImageAttachment).max(20).default([]),
        model: z.string().max(200).nullable().default(null),
        permissionMode: PermissionMode.default('default'),
        effort: Effort.nullable().default(null),
        worktree: WorktreeRequest.nullable().default(null),
        /** The Claude profile to run with; null uses the project's, else the default. */
        profileId: ProfileId.nullable().default(null),
        /** Check out this branch in `cwd` first (not with a worktree). Fails when git refuses, e.g. over uncommitted changes. */
        checkoutBranch: z.string().min(1).max(250).nullable().default(null),
      }),
      result: z.object({ sessionId: z.string() }),
    },
    /**
     * Sends a message, resuming the session first when it isn't running in this app.
     * Fails with SESSION_BUSY_ELSEWHERE when another Claude Code process has it open, unless `fork` is set.
     */
    'session.send': {
      params: z.object({
        sessionId: SessionId,
        text: Prompt,
        attachments: z.array(ImageAttachment).max(20).default([]),
        fork: z.boolean().default(false),
      }),
      result: z.object({ sessionId: z.string(), messageUuid: z.string() }),
    },
    'session.interrupt': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Stops one of the session's background tasks (a shell command, subagent or workflow); Claude is told it was stopped. */
    'session.stopTask': { params: z.object({ sessionId: SessionId, taskId: z.string() }), result: z.object({}) },
    /** A new session with this one's conversation up to and including `messageUuid`. */
    'session.forkAt': { params: z.object({ sessionId: SessionId, messageUuid: z.string() }), result: z.object({ sessionId: z.string() }) },
    /**
     * Restores the files Claude changed to how they were before one of your messages
     * (`dryRun` reports what would change). The conversation itself is untouched.
     */
    'session.rewind': {
      params: z.object({ sessionId: SessionId, messageUuid: z.string(), dryRun: z.boolean().default(false) }),
      result: RewindResult,
    },
    'session.setPermissionMode': { params: z.object({ sessionId: SessionId, mode: PermissionMode }), result: z.object({}) },
    'session.setModel': { params: z.object({ sessionId: SessionId, model: z.string().max(200).nullable() }), result: z.object({}) },
    /** Changes how hard Claude thinks, for this session only (null: back to the default). */
    'session.setEffort': { params: z.object({ sessionId: SessionId, effort: Effort.nullable() }), result: z.object({}) },
    /** What fills a running session's context window, by category. */
    'session.context': { params: z.object({ sessionId: SessionId }), result: ContextUsage },
    /** Stops the Claude Code process behind a session (the transcript stays; sending resumes it). */
    'session.close': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'session.respond': { params: z.object({ requestId: z.string(), decision: PermissionDecision }), result: z.object({}) },
    /** Slash commands, skills and plugin commands available to a session (or folder, for a new one). */
    'session.commands': {
      params: z.object({ sessionId: SessionId.optional(), cwd: AbsolutePath.optional(), profileId: ProfileId.optional() }),
      result: z.object({ commands: z.array(SlashCommand) }),
    },
    /** MCP servers, agents, skills and commands, and plugins for a session (live when it runs here) or a folder. */
    'session.capabilities': {
      params: z.object({ sessionId: SessionId.optional(), cwd: AbsolutePath, refresh: z.boolean().default(false), profileId: ProfileId.optional() }),
      result: Capabilities,
    },
    /** Turns an MCP server on or off, or reconnects it, in a session running in this app. */
    'session.mcp': {
      params: z.object({ sessionId: SessionId, server: z.string().max(200), action: z.enum(['enable', 'disable', 'reconnect']) }),
      result: z.object({}),
    },
    /** Starts a Claude Code process for a folder ahead of time so the first message answers faster. */
    'session.prewarm': { params: z.object({ cwd: AbsolutePath, profileId: ProfileId.nullable().default(null) }), result: z.object({}) },
    'models.list': { params: z.object({}), result: z.object({ models: z.array(ModelOption) }) },
    /**
     * Plan usage (5-hour and weekly limits) from Claude Code's /usage report. Cached for a minute;
     * `refresh` fetches now. `usage` is null without a claude.ai plan or before the first fetch.
     */
    'usage.get': {
      /** The profile whose plan to report (default: the default profile). */
      params: z.object({ refresh: z.boolean().default(false), profileId: ProfileId.optional() }),
      result: z.object({ usage: UsageSnapshot.nullable(), error: z.string().nullable() }),
    },

    // --- Folders, files and editors -----------------------------------------------------------
    'projects.inspect': { params: z.object({ path: AbsolutePath }), result: ProjectInspection },
    /** Fuzzy file search for @-mentions (git-tracked and untracked-but-not-ignored files). */
    'files.search': {
      params: z.object({ cwd: AbsolutePath, query: z.string().max(500), limit: z.number().int().min(1).max(200).default(50) }),
      result: z.object({ files: z.array(z.string()) }),
    },
    'editors.list': { params: z.object({}), result: z.object({ editors: z.array(EditorInfo), defaultId: z.string().nullable() }) },
    /** Opens a folder or file (optionally at a line) in an editor; `editorId` defaults to the user's default. */
    'editors.open': {
      params: z.object({ path: AbsolutePath, line: z.number().int().positive().optional(), editorId: z.string().optional() }),
      result: z.object({}),
    },
    'editors.setDefault': { params: z.object({ editorId: z.string() }), result: z.object({}) },

    // --- Project actions -----------------------------------------------------------------------
    /** Merged actions for a project: yours for it, then shared (.switchboard.json), then global. */
    'actions.list': {
      params: z.object({ projectRoot: AbsolutePath }),
      result: z.object({ actions: z.array(ListedAction), sharedFile: z.string().nullable(), errors: z.array(z.string()) }),
    },
    /** Saves one of your actions; `projectRoot: null` makes it global. `previousId` renames. */
    'actions.save': {
      params: z.object({ projectRoot: AbsolutePath.nullable(), action: ProjectAction, previousId: z.string().optional() }),
      result: z.object({}),
    },
    'actions.delete': { params: z.object({ projectRoot: AbsolutePath.nullable(), id: z.string() }), result: z.object({}) },
    /** Approves a shared action's exact command (an edited command needs approval again), or an imported action of yours. */
    'actions.trust': { params: z.object({ projectRoot: AbsolutePath, id: z.string() }), result: z.object({}) },
    /** Starter actions for a project (package.json scripts, git, gh). */
    'actions.suggest': { params: z.object({ projectRoot: AbsolutePath }), result: z.object({ suggestions: z.array(ActionSuggestion) }) },
    /** Runs an action for a session: shell actions open a terminal tab, prompt actions message the session. */
    'actions.run': {
      params: z.object({ sessionId: SessionId, projectRoot: AbsolutePath, cwd: AbsolutePath, id: z.string() }),
      result: ActionRunResult,
    },

    /**
     * Full-text search over your prompts and Claude's replies in every session, best matches first.
     * `indexing` reports background progress while transcripts are still being indexed.
     */
    'search.query': {
      params: z.object({ query: z.string().max(500), limit: z.number().int().min(1).max(500).default(200) }),
      result: z.object({ hits: z.array(SearchHit), indexing: z.object({ indexed: z.number(), total: z.number() }) }),
    },

    // --- Git -----------------------------------------------------------------------------------
    /** What changed in the checkout a session works in (see ChangesBase). */
    'git.changes': { params: z.object({ cwd: AbsolutePath, base: ChangesBase }), result: GitChanges },
    'git.diff': {
      params: z.object({ cwd: AbsolutePath, base: ChangesBase, path: z.string().max(4096) }),
      result: z.object({ diff: z.string(), truncated: z.boolean() }),
    },
    /** Local branches of the repository at `cwd`, and the one checked out (null when detached or not a repo). */
    'git.branches': { params: z.object({ cwd: AbsolutePath }), result: z.object({ current: z.string().nullable(), branches: z.array(z.string()) }) },
    /**
     * Checks out a local branch in the checkout at `cwd` with `git switch`: uncommitted changes that
     * don't conflict come along, and git refuses (GIT_FAILED) when they do. Nothing is stashed or
     * discarded. Refused (SESSION_BUSY) while Claude is working in a session in this checkout.
     */
    'git.switch': { params: z.object({ cwd: AbsolutePath, branch: z.string().min(1).max(250) }), result: z.object({ current: z.string().nullable() }) },
    /** The checkout's page on github.com (at the branch when it is pushed); null when no remote is on GitHub. */
    'git.github': { params: z.object({ cwd: AbsolutePath }), result: z.object({ repo: z.string(), url: z.string() }).nullable() },
    'git.stage': { params: z.object({ cwd: AbsolutePath, paths: z.array(z.string().max(4096)).max(5000), staged: z.boolean() }), result: z.object({}) },
    /** Puts files back to HEAD. New files go to the Trash. */
    'git.revert': { params: z.object({ cwd: AbsolutePath, paths: z.array(z.string().max(4096)).min(1).max(5000) }), result: z.object({}) },

    /**
     * Fetches, pulls, pushes, or pushes and opens a pull request (`gh pr create --fill --web`) for the branch
     * checked out at `cwd`, in a terminal tab of the session so you can see the result. A branch
     * without an upstream is pushed with `-u`. Pull is refused (SESSION_BUSY) while Claude is working
     * in this checkout, and a pull request from the base branch is refused (WRONG_BRANCH).
     */
    'git.sync': { params: z.object({ sessionId: SessionId, cwd: AbsolutePath, action: GitSyncAction }), result: z.object({ terminalId: z.string() }) },
    /**
     * Commits with your message, in a terminal tab of the session so hooks and their output stay
     * visible. Commits what is staged; with nothing staged, every change (new files too) is staged
     * first. Refused (SESSION_BUSY) while Claude is working in this checkout, and NOTHING_TO_COMMIT on a clean one.
     */
    'git.commit': { params: z.object({ sessionId: SessionId, cwd: AbsolutePath, message: z.string().trim().min(1).max(20_000) }), result: z.object({ terminalId: z.string() }) },

    /** Where a session's checkout stands: ahead/behind its base and its upstream, uncommitted, pushed. */
    'worktree.status': { params: z.object({ cwd: AbsolutePath }), result: WorktreeStatus },
    /**
     * Finishes a worktree. `merge` merges its branch into the main checkout (which must be on the
     * base branch and clean), in a terminal tab. Pull requests go through `git.sync`.
     * `remove` stops the session here and removes the worktree (refused with uncommitted changes).
     */
    'worktree.finish': {
      params: z.object({ sessionId: SessionId, cwd: AbsolutePath, action: z.enum(['merge', 'remove']), deleteBranch: z.boolean().default(false) }),
      result: z.object({ terminalId: z.string().nullable() }),
    },

    // --- Terminals ---------------------------------------------------------------------------
    /**
     * Starts a terminal. `claude` runs `claude --resume <session>` (or `--fork-session` with `fork`);
     * it refuses with SESSION_RUNNING_HERE / SESSION_BUSY_ELSEWHERE when the session is open in a process already.
     */
    'terminal.open': {
      params: z.object({
        sessionId: SessionId.nullable(),
        cwd: AbsolutePath,
        kind: TerminalKind,
        cols: z.number().int().min(2).max(1000),
        rows: z.number().int().min(1).max(500),
        fork: z.boolean().default(false),
      }),
      result: TerminalInfo,
    },
    'terminal.list': { params: z.object({}), result: z.object({ terminals: z.array(TerminalInfo) }) },
    /** The font the user's own terminal uses (Ghostty, VS Code), so prompts with Nerd Font glyphs render. */
    'terminal.font': { params: z.object({}), result: z.object({ fontFamily: z.string().nullable(), source: z.string().nullable() }) },
    /** Streams this terminal's output to the caller; returns recent output to replay first. */
    'terminal.attach': { params: z.object({ id: z.string() }), result: z.object({ info: TerminalInfo, replay: z.string() }) },
    'terminal.detach': { params: z.object({ id: z.string() }), result: z.object({}) },
    'terminal.write': { params: z.object({ id: z.string(), data: z.string().max(1_000_000) }), result: z.object({}) },
    'terminal.resize': {
      params: z.object({ id: z.string(), cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(500) }),
      result: z.object({}),
    },
    /** Kills the process (if still running) and forgets the terminal. */
    'terminal.close': { params: z.object({ id: z.string() }), result: z.object({}) },
    /** Stops the running process like Ctrl+C (then terminates, then kills it); the tab stays open with the exit code. */
    'terminal.stop': { params: z.object({ id: z.string() }), result: z.object({}) },
    /**
     * Runs an exited terminal's process again in the same tab. A project action is looked up again,
     * so an edited command is used and one that is no longer approved is refused with UNTRUSTED.
     */
    'terminal.restart': { params: z.object({ id: z.string() }), result: TerminalInfo },

    // --- Later list ----------------------------------------------------------------------------
    /** Prompts saved for later, newest first; only one folder's with `cwd`. */
    'later.list': { params: z.object({ cwd: AbsolutePath.optional() }), result: z.object({ items: z.array(LaterItem) }) },
    /** Saves a prompt for later. `id` and `createdAt` put a removed item back as it was (Undo). */
    'later.add': {
      params: z.object({ draft: LaterDraft, id: z.string().min(1).max(100).optional(), createdAt: z.number().optional() }),
      result: z.object({ item: LaterItem }),
    },
    'later.remove': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({}) },

    // --- Settings backup -----------------------------------------------------------------------
    /** Writes the chosen kinds of user choices (never the cache) to a settings file. */
    'settings.export': {
      params: z.object({ path: SettingsFilePath, sections: z.array(BackupSectionSchema).min(1), preferences: PreferencesRecord, appVersion: z.string().max(100) }),
      result: z.object({ path: z.string() }),
    },
    /**
     * Reads a settings file and reports what importing it would change. With `apply`, first backs up the
     * current settings (`backupPath`), then imports; `preferences` is what the renderer should apply.
     * Imported shell actions need approval again before they run.
     */
    'settings.import': {
      params: z.object({
        path: SettingsFilePath,
        sections: z.array(BackupSectionSchema),
        mode: ImportMode.default('merge'),
        relocate: z.array(FolderMapping).max(5000).default([]),
        /** The current preferences, to compare with and to back up. */
        preferences: PreferencesRecord,
        appVersion: z.string().max(100),
        apply: z.boolean().default(false),
      }),
      result: z.object({ preview: ImportPreview, backupPath: z.string().nullable(), preferences: PreferencesRecord.nullable() }),
    },

    // --- Claude Code updates -----------------------------------------------------------------
    'claudeUpdate.get': { params: z.object({}), result: ClaudeUpdateState },
    /** Compares the installed Claude Code with the newest on its channel now. The result arrives through `claudeUpdate.changed`. */
    'claudeUpdate.check': { params: z.object({}), result: z.object({}) },
    /**
     * Runs the update command for the install method, streaming its output through `claudeUpdate.changed`, then finds
     * `claude` again so new sessions use the new version. Refused (UNSUPPORTED) when Switchboard can't run it, BUSY while running.
     */
    'claudeUpdate.update': { params: z.object({}), result: z.object({}) },
    /** Hides the notice until a newer version than the one on offer, and clears "Updated to". */
    'claudeUpdate.dismiss': { params: z.object({}), result: z.object({}) },
    /** Turns automatic checks on or off (remembered). */
    'claudeUpdate.setEnabled': { params: z.object({ enabled: z.boolean() }), result: z.object({}) },
  },
  events: {
    'engine.log': LogEntry,
    'sessions.changed': SessionsChanged,
    /** Full replacement of the live-session list whenever the registry changes. */
    'sessions.live': z.object({ live: z.array(LiveSession) }),
    'transcript.updated': TranscriptUpdate,
    'session.host': SessionHostInfo,
    /** Claude Code reported a new model list (replaces the one from `models.list`). */
    'models.changed': z.object({ models: z.array(ModelOption) }),
    'session.stream': StreamDelta,
    'session.permission': PermissionRequest,
    'session.permissionResolved': z.object({ requestId: z.string(), sessionId: z.string() }),
    /** Output for an attached terminal (batched). */
    'terminal.data': z.object({ id: z.string(), data: z.string() }),
    'usage.changed': z.object({ profileId: z.string(), usage: UsageSnapshot.nullable() }),
    /** Full list whenever profiles are added, changed or removed, or the default changes. */
    'profiles.changed': ProfilesSnapshot,
    /** Full list whenever terminals start, exit or close. */
    'terminals.changed': z.object({ terminals: z.array(TerminalInfo) }),
    'claudeUpdate.changed': ClaudeUpdateState,
    /** The whole Later list, newest first, whenever an item is added or removed. */
    'later.changed': z.object({ items: z.array(LaterItem) }),
    /** Settings were imported: reload projects and actions. */
    'settings.imported': z.object({}),
  },
} as const satisfies ContractShape;

export type Contract = typeof contract;
