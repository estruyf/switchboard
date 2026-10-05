# Switchboard

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
```

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron main process, preload, and the engine utilityProcess entry |
| `apps/ui` | React 19 renderer |
| `packages/engine` | The engine: plain Node, no Electron imports. Cache DB, shell env, `claude` detection |
| `packages/protocol` | zod contract + typed RPC over MessagePorts, shared by engine and UI |
| `spike/` | Phase 0 throwaway experiments against the Agent SDK |

`@switchboard/protocol` has three entry points: `.` (everything, including zod schemas; used by the engine), `./client` (RPC client only, so the renderer bundle stays free of zod), and `./bridge` (IPC constants for main and preload).
