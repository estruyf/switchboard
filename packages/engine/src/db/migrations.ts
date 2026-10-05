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
];
