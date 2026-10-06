<p align="center">
  <img src="apps/desktop/build/icon.png" alt="Switchboard app icon" width="128" height="128">
</p>

<h1 align="center">Switchboard</h1>

<p align="center">A fast Mac app for running and keeping track of your Claude Code sessions.</p>

Switchboard puts all your Claude Code sessions in one window: the ones you start in the app, and the ones running in your terminal. Start new sessions, see at a glance which ones are working or waiting for you, approve permissions, and pick up any past conversation where you left off.

It uses the Claude Code you already have installed, with your login, settings, commands and skills. Nothing extra to sign in to.

## What you can do

**Keep track of every session**
- One list of all your sessions, newest first, across every project. Sessions you haven't touched for a while move to **Settled**, out of the way. You can settle one yourself too, even while it works: it comes back when it needs you or has finished.
- See at a glance which sessions are **working**, **waiting for you**, **finished** or **unread**.
- Filter by one of your projects, filter by title, and pin the sessions you keep coming back to.
- **Search every conversation** (⌘⇧F): your prompts and Claude's replies across all sessions, with the matching words highlighted. Pick a result to jump straight to that message.
- Give each project an icon. Switchboard picks one up from the repo when it can (a logo or favicon).
- Sessions running in your terminal show up too, live.

**Work with Claude**
- Start a session in a folder (⌘N): pick a project by typing a few letters, then work on the current branch (or check out another one first) or in a **new worktree**, just like `claude --worktree`.
- **Projects** are the folders you choose to work in. Add them from the folders you've used Claude Code in, or any folder, then reorder or remove them in the **Projects** view (the folder icon at the bottom of the sidebar). Give a project its own defaults for new sessions: model, effort, permission mode, worktree or current folder, and a branch. The New session view starts from them; change something there for one session, or click *Save as project default*.
- Chat as you would in the terminal. You get streaming replies, `/` commands (your own commands and skills included), `@` file mentions, and images you paste, drop or attach. Drag files anywhere over a session and the message box shows what a drop does: images are attached, other files and folders are added as `@` mentions.
- Approve or deny permission requests, answer Claude's questions and review plans in the conversation.
- Follow what Claude does without the noise: each run of tool calls is one line ("Reading src/app.ts…", then "Ran 3 commands and edited 2 files"), and a click shows every step, with diffs, command output, to-do lists and subagent runs.
- Images Claude reads or you attach are shown in the conversation.
- Press **Esc** to stop Claude, **⇧Tab** to switch permission mode, and keep typing while it works (messages queue up).
- Change the model, permission mode and **effort** while a session runs, and see how full the **context window** is. Click it for what fills it, like `/context`.
- **Agents** Claude starts, background ones included, show as "1 agent" in the session header; click it to watch what each one is doing.
- Continue any past session. If it's still open in a terminal, Switchboard offers to **fork** it instead, leaving the original untouched.
- Hover over a message to go back in time:
  - **Undo file changes** since one of your prompts. You see which files would change first.
  - **Edit and resend** a prompt, in a new session.
  - **Fork** from any of Claude's replies.

**Stay on top of things**
- A notification and Dock badge when a session needs you or finishes, so you can leave it running in the background.
- Your plan usage above the message box: how much of your 5-hour and weekly limits you've used, and when they reset.

**Review and finish the work**
- A **Changes** panel (⌘⇧D) with the session's git diff: what's uncommitted, or the whole branch compared with `main`. Stage, unstage or revert files, and open any diff inline. Reverted new files go to the Trash.
- **Finish a worktree** from its **Worktree** menu:
  - Commit with Claude.
  - Merge into the base branch, or push and open a pull request.
  - Remove the worktree, optionally with its branch. Switchboard warns you before you lose commits that aren't merged or pushed.

**Everything in one place**
- A **command palette** (⌘K) for every command, your project actions, and jumping to any session by typing a few letters.
- **Two sessions side by side**: ⌥-click a session (or choose *Open beside*) to open it next to the current one.
- **Close a session** with the × in its header to go to New session. A session that is working keeps running; pick it in the sidebar to open it again.
- **Tools** (below the message box): the session's MCP servers, with their status and tools (turn them on or off, or reconnect, while the session runs in Switchboard), plus its skills, commands, agents and plugins.
- A built-in terminal per session (⌘J), with a tab for your shell and one for the full Claude Code terminal interface.
- **Project actions**: one-click buttons for things like *Commit*, *Test* or *Publish*, running a command or sending Claude a prompt. See [Project actions](docs/project-actions.md).
- **Open in** your editor, terminal or Finder (⌘O), and click any file path in the conversation to open it at that line.
- Delete sessions you don't need. They go to the Trash, so you can get them back.

## Requirements

- A Mac with Apple Silicon
- [Claude Code](https://github.com/anthropics/claude-code) installed and signed in (`claude` works in your terminal)

## Install

Download the `.dmg` from the [latest release](https://github.com/estruyf/switchboard/releases/latest), open it and drag Switchboard to Applications.

Or build it from this repository, which takes a couple of minutes. You need Node 24 or later.

```bash
npm install
npm run dist
```

Then open `apps/desktop/dist/Switchboard-<version>-arm64.dmg` and drag Switchboard to Applications.

If macOS blocks the app the first time you open it, see [Building, signing and notarisation](docs/building-and-signing.md).

## Getting started

1. **Open Switchboard.** The sidebar lists the sessions you start or continue in Switchboard. To see your sessions from the terminal, Claude desktop and your editor too, turn on *Show sessions from other apps* in Settings.
2. **Pick a session** to read it, or type below it to continue.
3. **Start something new** with ⌘N: pick the project, write what Claude should work on, and choose where it runs: this checkout or a new worktree. Model, effort and permission mode sit right under the prompt.
4. When a session needs you (a permission or a question), it's marked in the sidebar and you get a notification.

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| ⌘N | New session |
| ⌘K | Command palette (⌥↩ opens a session beside the current one) |
| ⌘⇧F | Search all conversations |
| ↑ ↓ | Move through sessions in the sidebar |
| ⌘⌫ | Delete the selected session (to the Trash) |
| ⌘O | Open the session's folder in your editor |
| ⌘J | Show or hide the terminal |
| ⌘⇧D | Show or hide the Changes panel |
| ⌥-click | Open a session beside the current one |
| ⌘\\ | Close the other pane |
| ⌘, | Settings |
| Esc | Stop Claude while it's working |
| ⇧Tab | Switch permission mode |
| `/` and `@` | Commands and file mentions in the message box |
| ⌘Q | Quit (Switchboard asks first; press ⌘Q again to quit) |

Right-click a session for more: open it beside, pin, settle, open its folder, copy its ID, or delete it.

Drag the sidebar's right edge to make it wider or narrower; double-click the edge to reset it. Switchboard remembers the width.

## Settings

Open Settings with ⌘, or the gear at the bottom of the sidebar. While it is open, the sidebar lists its sections; close it with the × button, *Back to sessions* or Escape.

- **Theme:** Match System, Light or Dark. The colours come from the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme).
- **Sidebar:** *Large icons* (easy to spot each project), *Standard*, or *Compact* (one line per session). *Show sessions from other apps* also lists sessions from the terminal, Claude desktop and your editor (off by default), and notifies you when a terminal session is waiting.
- **Conversation:** *Summarised* (the default) shows each run of tool calls as one line, like Claude Code: what Claude is doing right now, or what it did, with how long it took. Click it to see the steps, and a step to see its details. *Every step* shows each tool call as its own card.
- **Claude profiles:** use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login, settings, plugins and sessions (`~/.claude` is the first). Add one, sign in there once in a terminal with the command Settings shows (`CLAUDE_CONFIG_DIR=~/.claude-work claude`, then `/login`), and pick the default. *How to set up another profile* under the list walks through it step by step. Link a project to a profile from its menu or the Projects view; New session shows the profile a folder uses and lets you pick another for one session. With more than one profile, sessions show which account they use, and the usage band shows that account's limits.
- **Quitting:** turn off the "Ask before quitting" prompt.
- **Diagnostics:** whether the engine is connected, which Claude Code it found, version numbers and the engine's recent log. Useful when something doesn't work.

## Your data

Switchboard reads the session files Claude Code already keeps in `~/.claude` (and in the folders of any other Claude profiles you add) and runs your own `claude` to do the work, so your sessions stay in one place whether you use the terminal or the app. It doesn't send anything anywhere else, and never handles your Claude login: you sign in with Claude Code itself. Deleting a session moves its files to the Trash.

## Documentation

- [Project actions](docs/project-actions.md): add buttons for your own commands and prompts, and share them with your team.
- [Building, signing and notarisation](docs/building-and-signing.md): packaging the app, and signing it with an Apple Developer ID.
- [Development](docs/development.md): running from source, tests, and how the code is organised.
- [Changelog](CHANGELOG.md): what's new in each release.
- [Plan](PLAN.md): the roadmap and design decisions.

## Credits

Switchboard's colour theme and syntax colours come from the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme) (MIT).
