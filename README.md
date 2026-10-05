<p align="center">
  <img src="apps/desktop/build/icon.png" alt="Switchboard app icon" width="128" height="128">
</p>

<h1 align="center">Switchboard</h1>

A fast desktop app for managing Claude Code sessions. See [PLAN.md](PLAN.md) for the full plan and [spike/FINDINGS.md](spike/FINDINGS.md) for what the Phase 0 spike verified.

## Requirements

- macOS, Node 24+, npm 11+
- Claude Code installed and signed in (`claude` on your PATH)

## Commands

```bash
npm install
npm run dev        # Electron + Vite dev server with hot reload
npm run check      # typecheck every package + unit tests
npm run smoke      # build, launch, kill the engine once, verify it recovers
npm run build      # production bundles in apps/desktop/out
npm run icon -w @switchboard/desktop   # regenerate the app icon from its SVG
```

Tests that call the real Claude Code (a few cents of Haiku each) are opt-in and need a throwaway git repo:

```bash
SWITCHBOARD_LIVE_CWD=/path/to/throwaway-repo npx vitest run claude.live
SWITCHBOARD_SMOKE_LIVE_CWD=/path/to/throwaway-repo npm run smoke
```

The live smoke step drives the real window: it starts a session in that folder, approves a permission prompt and waits for the reply. It refuses to submit if the folder field shows anything else.

## App icon

The icon is a patch panel with two cables hanging between its jacks. Its source is [`apps/desktop/build/icon.svg`](apps/desktop/build/icon.svg); edit that, then run `npm run icon -w @switchboard/desktop` to regenerate:

| File | Used for |
|---|---|
| `apps/desktop/build/icon.png` | 1024×1024; the Dock icon while developing, and the About panel |
| `apps/desktop/build/icon.icns` | Every macOS size, for the packaged app |
| `apps/ui/src/assets/app-icon.png` | 64×64, without the macOS margin, for the sidebar header |

The SVG is rendered with Electron (Chromium), and the `.icns` is built with macOS's `sips` and `iconutil`, so nothing extra needs installing.

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron main process, preload, and the engine utilityProcess entry |
| `apps/ui` | React 19 renderer |
| `packages/engine` | The engine: plain Node, no Electron imports. Cache DB, shell env, `claude` detection |
| `packages/protocol` | zod contract + typed RPC over MessagePorts, shared by engine and UI |
| `spike/` | Phase 0 throwaway experiments against the Agent SDK |

`@switchboard/protocol` has three entry points: `.` (everything, including zod schemas; used by the engine), `./client` (RPC client only, so the renderer bundle stays free of zod), and `./bridge` (IPC constants for main and preload).
