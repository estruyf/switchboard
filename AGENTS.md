# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot and others) working on Switchboard, a macOS desktop app for managing Claude Code sessions. People should start with [README.md](README.md); the design and roadmap are in [PLAN.md](PLAN.md).

## Architecture

Switchboard is an Electron app in four npm workspaces:

| Path | What it is | Rules |
|---|---|---|
| `packages/protocol` | zod contract and typed RPC over MessagePorts | The single source of truth for every request and event. Three entry points: `.` (with zod, for the engine), `./client` (types and RPC client only, no zod, for the renderer), `./bridge` (IPC channels and preferences, plain TypeScript, for main and preload). |
| `packages/engine` | Plain Node; runs in an Electron `utilityProcess` | **No Electron imports.** Owns the SQLite cache, the session index and search, Claude Code processes (through the Agent SDK), git, terminals, project actions and usage. |
| `apps/desktop` | Electron main process, preload, and the engine entry | Main does what needs Electron: windows, menus, dialogs, notifications, the Trash, preferences. The preload is sandboxed and exposes `window.switchboard`. |
| `apps/ui` | React 19 renderer, Tailwind 4, zustand | Talks to the engine only through the RPC client, and to main only through `window.switchboard`. |

The path of a feature is usually: add the request or event to `packages/protocol/src/contract.ts`, handle it in `packages/engine/src/engine.ts` (logic in a module next to it), and call it from the UI with `client.call(...)` / `client.on(...)`.

### Claude Code

- Sessions run through `@anthropic-ai/claude-agent-sdk` (pinned), using the user's own `claude` binary and login. Only `packages/engine/src/host/sessionHost.ts` and `hostManager.ts` drive `query()`; keep it that way.
- Read transcripts through the SDK (`listSessions`, `getSessionMessages`, `forkSession`, …) in `packages/engine/src/claude/sessionSource.ts`. Parse Claude Code's on-disk formats only where the SDK has no answer (the live registry in `~/.claude/sessions`, `agent-*.meta.json`, `installed_plugins.json`), and degrade quietly when a format changes.
- Short-lived helper processes (command lists, Tools, usage) never get a prompt and use `persistSession: false`. Register their ids as ephemeral so they don't show up as sessions.
- The SDK can throw asynchronously after interrupts: every session is wrapped so one failing session can't take the engine down.

## Commands

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run check        # typecheck every package + unit tests (Vitest)
npm run smoke        # build, launch the real app with a throwaway profile, drive the UI
npm run dist         # package Switchboard.app and a .dmg
```

Run `npm run check` after every change, and `npm run smoke` after UI or engine changes. Both must pass before you report work as done.

## Conventions

- **TypeScript strict, ESM, Node 24+.** Files import each other with explicit `.ts`/`.tsx` extensions. There is no formatter or linter: match the surrounding code (2-space indent, single quotes, semicolons, long lines are fine).
- **Comments** explain why, in plain sentences, at the density of the surrounding code. JSDoc on exported functions and on non-obvious fields.
- **Testable logic lives in pure modules.** Unit tests must not import modules that touch `window` or `localStorage` at load time; put pure helpers in their own file (see `toolSummary.ts`, `agentRuns.ts`, `lib/fuzzy.ts`, `lib/unifiedDiff.ts`). Tests sit next to the code (`*.test.ts`).
- **Engine tests** use real temporary directories, real git repositories and a real SQLite file, not mocks. The SDK is injected (`SdkRuntime`), so host tests fake Claude Code.
- **Schema changes** go through a new migration appended to `packages/engine/src/db/migrations.ts`. The cache is derived from `~/.claude` and may be dropped and rebuilt; `owned_sessions`, `session_flags`, `project_settings` and `project_actions` hold user choices and must survive.

### UI

- **Colours only through theme tokens** (Demo Time palette, `apps/ui/src/styles.css`): `bg`, `sidebar`, `card`, `border`, `text`, `muted`, `faint`, `ok`, `warn`, `error`, `link`, and three accents:
  - `accent` is the yellow fill (buttons, tints such as `bg-accent/15`);
  - `accent-ink` is the readable accent for text, icons, dots, spinners and borders (dark mustard in light mode);
  - `on-accent` is text on a yellow fill. Never put `text-white` on `bg-accent`.
- **Both light and dark mode** must work; the Settings smoke step switches between them.
- **Narrow panes:** the session view is an `@container`; use `@max-[860px]:` variants to compact headers and bars (two sessions side by side).
- **Form controls and tooltips** come from `apps/ui/src/components/ui/`: `Select` (not `<select>`), `Checkbox`, `Radio`/`RadioGroup`, `Switch`/`Toggle`, `Choice`. `npm run check` fails on a native `<select>`, checkbox or radio elsewhere. For a tooltip, put `data-tooltip="…"` on the element (the `TooltipLayer` shows it) instead of `title`, and give icon-only buttons an `aria-label` too.
- **Dialogs** use `role="dialog"` / `role="alertdialog"` and close on Escape. Escape in the message box stops Claude, except while a dialog, menu, listbox or popover is open; keep new overlays inside those roles.
- **Long lists are virtualised** (`@tanstack/react-virtual`): rows outside the viewport aren't in the DOM.
- **Preferences** (theme, sidebar style, tool activity, quit prompt) live in main (`apps/desktop/src/main/preferences.ts`); the preload reads them synchronously so the first paint is right. Add new ones to `Preferences` in `packages/protocol/src/bridge.ts`.

### Smoke test

`apps/desktop/src/main/index.ts` holds the smoke steps (`run…Step` functions), and `apps/desktop/scripts/smoke.ts` prints their results. Steps find elements by `data-*` attributes, so give new UI a `data-` hook when you add it. Steps must be **read-only on real data**: the app runs against the user's real `~/.claude` and projects, with a throwaway app profile. Never stage, revert, delete or send anything outside the sandbox.

### Live tests (real Claude Code, costs a little)

Opt-in and only in a throwaway git repository:

```bash
SWITCHBOARD_LIVE_CWD=/path/to/throwaway-repo npx vitest run claude.live
SWITCHBOARD_SMOKE_LIVE_CWD=/path/to/throwaway-repo npm run smoke
```

**Never point these at a real project.** The live smoke step refuses to submit unless the folder field shows the sandbox; keep that guard.

## Documentation

- `README.md` is for people using the app: what it does, how to install it, shortcuts, settings. No implementation details.
- Technical material goes in `docs/` (`development.md`, `building-and-signing.md`, `project-actions.md`) and is linked from the README.
- Update `PLAN.md` when a phase or roadmap item changes status.

## Releases

Releases are built by `.github/workflows/release.yml`, which runs when a release is published on GitHub:

1. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`, written for people using the app, and set `version` in `apps/desktop/package.json` to match.
2. Publish a GitHub release with tag `vX.Y.Z` (only when the user asks). The notes may be left empty; the workflow fills them from the CHANGELOG section.

The workflow builds with the version from the tag, signs and notarises the app, checks Gatekeeper accepts it, and attaches the `.dmg` to the release. It never attaches an unsigned build. `npm run dist:notarized` is for checking a signed build locally.

## Safety

- Commit, push, tag or publish only when the user asks.
- Never handle passwords, certificates or app-specific passwords, and never change keychain or system settings. The user runs `notarytool store-credentials` and adds CI secrets themselves.
- Deleting is always to the Trash (`shell.trashItem` in main), guarded by `apps/desktop/src/main/trashGuard.ts`: session files only, or new files inside a git repository for a revert.
