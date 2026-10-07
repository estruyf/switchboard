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

- Sessions run through `@anthropic-ai/claude-agent-sdk` (pinned), using the user's own `claude` binary and login. Only `packages/engine/src/host/sessionHost.ts` and `hostManager.ts` drive `query()`, plus one documented exception: `usageMonitor.ts`, whose helper sends `/usage` (see below). Keep it that way.
- Read transcripts through the SDK (`listSessions`, `getSessionMessages`, `forkSession`, …) in `packages/engine/src/claude/sessionSource.ts`. Parse Claude Code's on-disk formats only where the SDK has no answer (the live registry in `~/.claude/sessions`, `agent-*.meta.json`, `installed_plugins.json`), and degrade quietly when a format changes.
- Short-lived helper processes (command lists, Tools) never get a prompt. The usage helper is the one exception: it sends the local `/usage` command, which uses no tokens. All of them use `persistSession: false` and register their ids as ephemeral so they don't show up as sessions.
- The SDK can throw asynchronously after interrupts: every session is wrapped so one failing session can't take the engine down.
- **Claude profiles** (`packages/engine/src/profiles/`): each is a config folder with its own login. Anything that starts Claude Code gets the profile's environment (`envFor` in `engine.ts`); never set `CLAUDE_CONFIG_DIR` for the built-in profile. The SDK's transcript readers only read `process.env.CLAUDE_CONFIG_DIR`, so they go through `ConfigDirLane`; don't call them around it.

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

- **Colours only through theme tokens** (Demo Time palette, `apps/ui/src/styles.css`): `bg`, `sidebar`, `card`, `border`, `edge` (a border that stays visible on dialogs and popovers, for fields, chips and cards inside them), `text`, `muted`, `faint`, `ok`, `warn`, `error`, `link`, and three accents:
  - `accent` is the yellow fill (buttons, tints such as `bg-accent/15`);
  - `accent-ink` is the readable accent for text, icons, dots, spinners and borders (dark mustard in light mode);
  - `on-accent` is text on a yellow fill. Never put `text-white` on `bg-accent`.
  - `profile-<colour>` (yellow, blue, green, purple, red, orange, gray) tells Claude profiles apart; use it through `PROFILE_DOT` / `PROFILE_TEXT` in `components/profiles/ProfileBadge.tsx`.
- **Both light and dark mode** must work; the Settings smoke step switches between them.
- **Narrow panes:** the session view is an `@container`; use `@max-[860px]:` variants to compact headers and bars (two sessions side by side).
- **Form controls and tooltips** come from `apps/ui/src/components/ui/`: `Select` (not `<select>`), `Checkbox`, `Radio`/`RadioGroup`, `Switch`/`Toggle`, `Choice`. `npm run check` fails on a native `<select>`, checkbox or radio elsewhere. For a tooltip, put `data-tooltip="…"` on the element (the `TooltipLayer` shows it) instead of `title`, and give icon-only buttons an `aria-label` too.
- **Dialogs** use `role="dialog"` / `role="alertdialog"` and close on Escape. Escape in the message box stops Claude, except while a dialog, menu, listbox or popover is open; keep new overlays inside those roles.
- **Long lists are virtualised** (`@tanstack/react-virtual`): rows outside the viewport aren't in the DOM.
- **Preferences** (theme, sidebar style, tool activity, quit prompt) live in main (`apps/desktop/src/main/preferences.ts`); the preload reads them synchronously so the first paint is right. Add new ones to `Preferences` in `packages/protocol/src/bridge.ts`.

### Design system

Every screen follows the same few rules. New UI uses them; don't invent new sizes, colours or patterns for a single spot.

**Type scale.** Four sizes (plus one hero size), as Tailwind tokens from `styles.css`. Use these instead of `text-[12.5px]`-style arbitrary values:

| Token | Size | For |
|---|---|---|
| `text-meta` | 11px | ages, branches, counts, usage, hints under a control |
| `text-ui` | 12px | buttons, chips, menus, list rows, form fields |
| `text-body` | 13.5px | messages in the conversation, the message box, session titles in the sidebar |
| `text-title` | 15px | view and dialog titles (`font-semibold`) |
| `text-hero` | 20px | only the single heading of a focused view (Home, New session) |

Monospace (`font-mono`) is for paths, commands, branches in menus and diffs, at `text-ui` or `text-meta`.

**Status colours.** Each colour means one thing, everywhere: the sidebar, headers, cards and notifications.

| State | Token | Shape |
|---|---|---|
| Needs you (a permission or a question) | `warn` (pink) | 3px rail on the row, pulsing dot, pink frame on the card |
| Working | `accent-ink` (yellow) | rail, spinner or the three working dots |
| Running in the background | `ok` (green) | slow spinner |
| Finished, unread | `unread` (blue) | rail and dot, bold title |
| Failed | `error` | `!` badge |
| Idle | `faint` | no rail |

With more than one Claude profile, the rail on a session row shows the profile's colour instead (`PROFILE_DOT`), on every row; the status then shows through the age's colour, the bold title and the group. Yellow is never used for "unread". Green, orange (`caution`) and red (`error`) are only for levels: use `levelOf()` and `LEVEL_FILL` / `LEVEL_TEXT` / `LEVEL_COLOR` from `lib/levels.ts` (green under 60%, orange to 85%, red from 85%) for usage bars, the context ring and anything else that fills up.

**Selection and hover.** A selected row is `bg-selected` (a neutral fill) plus its status rail; hover is `hover:bg-border/45`. Don't use `bg-accent/15` for selection: it vanishes on the light sidebar. A yellow tint is fine for a pressed toggle or a highlighted menu option.

**Buttons.** One primary action per area, as a yellow fill (`bg-accent text-on-accent font-semibold`, 28px high in toolbars, 30-32px in cards and the message box). A secondary action next to it (Cancel, Close, Choose…) is the `btn-secondary` utility: a bordered button that stays visible on dialogs and popovers. Never a bare text link, and not `border border-border`, which disappears on overlay surfaces. Toolbar icons and inline controls are quiet: `text-muted`, `hover:bg-border/50 hover:text-text`. Related toggles sit together in one segmented control (see Changes | Terminal in the session header). Put actions people use less often in the `⋯` menu rather than adding another icon. Things people run all the time stay one click away: project actions are pills above the message box (the first three, then "N more"; icon only in a narrow pane), and every action is also in the `⋯` menu.

**Keyboard first.** Every primary action has a shortcut, and the button shows it in a `<kbd>` (`⌘↵`, `Esc`, `⌘1`). Choices in a list can be picked with number keys.

**Components.** Use `Button`, `Kbd`, `Pill` and `Meter` from `components/ui/` instead of writing these class strings by hand; `npm run check` fails on `btn-secondary` or a raw `<kbd>` elsewhere. `Button` variants: `primary` for the one yellow action in an area, `secondary` (the default) for Cancel, Close and Choose…, `quiet` for toolbar icons and inline controls (`selected` for an open panel or the current view), `danger` for deleting or reverting (`filled` only for the confirm button of a destructive dialog). Sizes are `sm` (24px), `md` (28px, toolbars and dialogs) and `lg` (32px, cards, the message box, a view's main action). Pass `kbd="⌘↵"` to show the shortcut and announce it, and `iconOnly` with an `aria-label` for an icon button (the label becomes its tooltip). `Kbd` shows a shortcut on its own, as glyphs or a stored `cmd+enter`; its `on-accent` tone is for inside a yellow button and `plain` drops the keycap. `Pill` is the small rounded chip above the message box (project actions, the task strip, background tasks with `tone="ok"`, `dashed` for "Add action"), and `CountBadge` is the count next to a group heading. `Meter` draws anything that fills up, as a bar or a ring, in the level colours; give it a `label` unless the control around it already says the number. `Dialog` is the shell of every modal: scrim, panel on the overlay surface, header with `title`, optional `subtitle` and a close button, a scrolling body, and a footer (`footer` on the right for Cancel and the primary action, `footerStart` on the left for Delete or a status line). Widths are `sm` (420px, confirmations), `md` (560px) and `lg` (900px); `placement="top"` keeps dialogs whose height changes as you type from jumping, `flush` drops the body padding for lists and panes, and `bare` drops the header for a search field (the `title` still names the dialog). It closes on Escape and on a click on the scrim (`dismissable={false}` to stop that), calls `onSubmit` on ⌘↵, and only the dialog on top reacts; a child that takes Escape itself (a shortcut recorder, a dropdown) marks the key handled with `preventDefault()`. Use `ConfirmDialog` for a yes or no question. `SegmentedControl` puts related choices in one track: `mode="radio"` for one value (arrow keys move and choose, one Tab stop), `mode="toggle"` for independent switches such as Changes | Terminal; each segment takes `label`, `icon`/`iconOnly`, `badge`, `dot`, `tooltip`, `kbd` and `data` hooks. Choices that need a description under them stay `RadioGroup` cards. `Notice` is a message box: `tone` `info`, `warn`, `error` (announced at once) or `success`, with an `icon`, `actions` (small Buttons) and `onDismiss`; `inline` makes it one quiet line without a box. Plain errors under a field stay text. `SectionHeader` is the small capitals over a group of rows, with `tone` (`neutral`, `needs-you`, `working`), a `count`, an `action` (Select all) and `toggle` for a collapsible group; `as="h2"` or `"h3"` when a section points at it with `aria-labelledby`. `className` is for layout (`ml-auto`, `w-full`, `min-w-0`); to change a component's look, change the component. `npm run check` also fails on a hand-written dialog scrim (`bg-scrim`) or `role="radiogroup"` outside `components/ui/`.

**Surfaces and borders.** Cards (`rounded-xl border border-border bg-card`) are for things that need a decision or hold input: your prompt, a plan, a permission or question card, the message box. Tool runs, agent reports and to-do lists in the conversation are a quiet timeline without borders. Floating things (menus, popovers, dialogs, sheets) use the `overlay` utility.

**Layout.** Group lists by what needs attention first (Needs you, Working), then by time (Today, Yesterday, Earlier). Centre focused views (New session, Home) in the window with a `max-w-3xl` column. Side panels that show content (Changes, terminal) can be resized by dragging, and from the keyboard. The terminal panel is always dark (`theme-dark` on its root, which swaps every token to the dark theme), in light mode too.

**Copy.** Plain, short sentences. Say what something does ("Allow", "Start session"), not how. No em dashes.

The design mockups these rules come from are in the Switchboard UI suggestions canvas; when a new view needs a pattern that isn't here, add it to this section in the same change.

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
- Keep `CHANGELOG.md` up to date: when a change is visible to people using the app, add a line to the `## [Unreleased]` section at the top (create it if it's missing), written for them, not about the implementation. At release time that section becomes `## [X.Y.Z] - YYYY-MM-DD` (see Releases).

## Releases

Releases are built by `.github/workflows/release.yml`, which runs when a release is published on GitHub:

1. Rename the `## [Unreleased]` section of `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` (or add that section, written for people using the app), and set `version` in `apps/desktop/package.json` to match.
2. Publish a GitHub release with tag `vX.Y.Z` (only when the user asks). The notes may be left empty; the workflow fills them from the CHANGELOG section.

The workflow builds with the version from the tag, signs and notarises the app, checks Gatekeeper accepts it, and attaches the `.dmg` to the release. It never attaches an unsigned build. `npm run dist:notarized` is for checking a signed build locally.

## Safety

- Commit, push, tag or publish only when the user asks.
- Never handle passwords, certificates or app-specific passwords, and never change keychain or system settings. The user runs `notarytool store-credentials` and adds CI secrets themselves.
- Deleting is always to the Trash (`shell.trashItem` in main), guarded by `apps/desktop/src/main/trashGuard.ts`: session files only, or new files inside a git repository for a revert.
