/**
 * Schema migrations for the cache database, applied in order and tracked with
 * `PRAGMA user_version`. The cache is never the source of truth (that is
 * ~/.claude), so a migration may drop and rebuild derived tables freely.
 */
export const migrations: readonly string[] = [
  // v1: initial schema (PLAN.md §4)
  `
  CREATE TABLE projects (
    id            TEXT PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    git_root      TEXT,
    name          TEXT NOT NULL,
    last_activity INTEGER
  );

  CREATE TABLE sessions (
    id                TEXT PRIMARY KEY,
    project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title             TEXT,
    origin            TEXT NOT NULL DEFAULT 'cli' CHECK (origin IN ('app', 'cli', 'ide', 'desktop', 'sdk')),
    status            TEXT NOT NULL DEFAULT 'idle',
    model             TEXT,
    cwd               TEXT,
    created_at        INTEGER,
    updated_at        INTEGER,
    jsonl_path        TEXT,
    jsonl_offset      INTEGER NOT NULL DEFAULT 0,
    jsonl_mtime       INTEGER,
    message_count     INTEGER NOT NULL DEFAULT 0,
    cost_usd          REAL,
    parent_session_id TEXT,
    worktree_path     TEXT,
    pinned            INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_project_updated ON sessions (project_id, updated_at DESC);

  CREATE VIRTUAL TABLE messages_fts USING fts5 (
    session_id UNINDEXED,
    uuid UNINDEXED,
    role UNINDEXED,
    text,
    tokenize = 'porter unicode61'
  );

  CREATE TABLE project_actions (
    id                     TEXT NOT NULL,
    project_id             TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    icon                   TEXT,
    type                   TEXT NOT NULL CHECK (type IN ('shell', 'prompt')),
    command                TEXT NOT NULL,
    cwd_mode               TEXT NOT NULL DEFAULT 'session' CHECK (cwd_mode IN ('session', 'project-root')),
    confirm                INTEGER NOT NULL DEFAULT 0,
    shortcut               TEXT,
    run_on_worktree_create INTEGER NOT NULL DEFAULT 0,
    sort                   INTEGER NOT NULL DEFAULT 0
  );
  -- project_id NULL means a global action; COALESCE keeps ids unique per scope.
  CREATE UNIQUE INDEX project_actions_scope_id ON project_actions (COALESCE(project_id, ''), id);

  CREATE TABLE trusted_commands (
    project_id   TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    trusted_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, command_hash)
  );

  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // v2: sessions become a cache of SessionSummary JSON keyed by transcript file (Phase 2).
  // Safe to drop: everything in it is rebuilt from ~/.claude on the next scan.
  `
  DROP TABLE sessions;
  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,
    project_root TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    jsonl_path   TEXT,
    jsonl_mtime  INTEGER,
    entrypoint   TEXT,
    summary_json TEXT NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_project_updated ON sessions (project_root, updated_at DESC);
  `,

  // v3: sessions created by this app (origin badge). Kept apart from the
  // sessions cache, which may be dropped and rebuilt at any time.
  `
  CREATE TABLE owned_sessions (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  `,

  // v4: user choices for the sidebar. Like owned_sessions, never dropped on rebuilds.
  `
  CREATE TABLE session_flags (
    id         TEXT PRIMARY KEY,
    pinned     INTEGER NOT NULL DEFAULT 0,
    settled_at INTEGER,
    viewed_at  INTEGER
  );
  CREATE TABLE project_settings (
    root      TEXT PRIMARY KEY,
    icon_json TEXT,
    added_at  INTEGER
  );
  `,

  // v5: project actions are keyed by project folder; v1 pointed them at the unused projects table.
  // Nothing could be saved under v1's foreign key, so the table is recreated empty.
  `
  DROP TABLE project_actions;
  CREATE TABLE project_actions (
    id                     TEXT NOT NULL,
    project_id             TEXT,
    name                   TEXT NOT NULL,
    icon                   TEXT,
    type                   TEXT NOT NULL CHECK (type IN ('shell', 'prompt')),
    command                TEXT NOT NULL,
    cwd_mode               TEXT NOT NULL DEFAULT 'session' CHECK (cwd_mode IN ('session', 'project-root')),
    confirm                INTEGER NOT NULL DEFAULT 0,
    shortcut               TEXT,
    run_on_worktree_create INTEGER NOT NULL DEFAULT 0,
    sort                   INTEGER NOT NULL DEFAULT 0
  );
  -- project_id NULL means a global action; COALESCE keeps ids unique per scope.
  CREATE UNIQUE INDEX project_actions_scope_id ON project_actions (COALESCE(project_id, ''), id);
  `,

  // v6: full-text search over transcripts (Phase 5). Derived from ~/.claude, rebuilt as needed.
  `
  DROP TABLE IF EXISTS messages_fts;
  CREATE VIRTUAL TABLE transcript_fts USING fts5 (
    session_id UNINDEXED,
    uuid UNINDEXED,
    role UNINDEXED,
    at UNINDEXED,
    text,
    tokenize = 'porter unicode61 remove_diacritics 2'
  );
  -- What was indexed per session, so only changed transcripts are read again.
  CREATE TABLE transcript_indexed (
    session_id TEXT PRIMARY KEY,
    version    TEXT NOT NULL
  );
  `,

  // v7: a session's updated_at is now its last message, not the file's mtime. Forgetting the
  // cached mtimes makes the next scan read every transcript's tail once.
  `
  UPDATE sessions SET jsonl_mtime = NULL;
  -- Sessions started elsewhere that the user continued in Switchboard. A user choice: keep it.
  CREATE TABLE continued_sessions (
    id         TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  `,

  // v8: projects are added by hand, with their own order and defaults for new sessions (user choices: keep them).
  // Upgrading users keep the projects they worked with in Switchboard: every folder with a session started or
  // continued here. On a new install these tables are empty, so the list starts empty.
  `
  ALTER TABLE project_settings ADD COLUMN sort INTEGER;
  ALTER TABLE project_settings ADD COLUMN defaults_json TEXT;
  INSERT INTO project_settings (root, added_at)
    SELECT project_root, MAX(updated_at) FROM sessions
    WHERE project_root LIKE '/%' AND (id IN (SELECT id FROM owned_sessions) OR id IN (SELECT id FROM continued_sessions))
    GROUP BY project_root
  ON CONFLICT (root) DO UPDATE SET added_at = COALESCE(project_settings.added_at, excluded.added_at);
  `,

  // v9: Claude profiles, one login per config folder, and the profile a project uses. User choices: keep them.
  // config_dir is NULL for the built-in profile (Claude Code's own folder); the engine adds that row itself.
  `
  CREATE TABLE claude_profiles (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    config_dir TEXT UNIQUE,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE project_settings ADD COLUMN profile_id TEXT;
  `,

  // v10: actions brought in from a settings file. Imported shell actions need approval before they run,
  // like shared ones; approving or editing one clears the flag.
  `
  ALTER TABLE project_actions ADD COLUMN imported INTEGER NOT NULL DEFAULT 0;
  `,

  // v11: what each session last ran with (its permission mode, and the model and effort you picked), so a resume
  // after Stop, the idle timeout or an app restart carries on the same way. User choices: keep them.
  `
  CREATE TABLE session_settings (
    id              TEXT PRIMARY KEY,
    permission_mode TEXT,
    model           TEXT,
    effort          TEXT
  );
  `,

  // v12: archived sessions are hidden from the sidebar (Settled included) until they have new activity. A user choice: keep it.
  `
  ALTER TABLE session_flags ADD COLUMN archived_at INTEGER;
  `,
];
