<p align="center">
  <img src="apps/desktop/build/icon.png" alt="Switchboard app icon" width="128" height="128">
</p>

<h1 align="center">Switchboard</h1>

<p align="center">A fast Mac app for running and keeping track of your Claude Code sessions.</p>

Switchboard puts all your Claude Code sessions in one window: the ones you start in the app, and the ones running in your terminal. Start new sessions, see at a glance which ones are working or waiting for you, approve permissions, and pick up any past conversation where you left off.

It uses the Claude Code you already have installed, with your login, settings, commands and skills. Nothing extra to sign in to.

## What you can do

**Keep track of every session**
- One list of all your sessions, newest first, across every project. Sessions you haven't touched for a while move to **Settled**, out of the way.
- See at a glance which sessions are **working**, **waiting for you**, **finished** or **unread**.
- Filter by project, search by title, and pin the sessions you keep coming back to.
- Give each project an icon. Switchboard picks one up from the repo when it can (a logo or favicon).
- Sessions running in your terminal show up too, live.

**Work with Claude**
- Start a session in a folder (⌘N), either on the current branch or in a **new worktree**, just like `claude --worktree`.
- Chat as you would in the terminal. You get streaming replies, `/` commands (your own commands and skills included), `@` file mentions, and images you paste or attach.
- Approve or deny permission requests, answer Claude's questions and review plans in the conversation.
- Follow what Claude does without the noise: each run of tool calls is one line ("Reading src/app.ts…", then "Ran 3 commands and edited 2 files"), and a click shows every step, with diffs, command output, to-do lists and subagent runs.
- Images Claude reads or you attach are shown in the conversation.
- Press **Esc** to stop Claude, **⇧Tab** to switch permission mode, and keep typing while it works (messages queue up).
- Continue any past session. If it's still open in a terminal, Switchboard offers to **fork** it instead, leaving the original untouched.

**Stay on top of things**
- A notification and Dock badge when a session needs you or finishes, so you can leave it running in the background.
- Your plan usage above the message box: how much of your 5-hour and weekly limits you've used, and when they reset.

**Everything in one place**
- A built-in terminal per session (⌘J), with a tab for your shell and one for the full Claude Code terminal interface.
- **Project actions**: one-click buttons for things like *Commit*, *Test* or *Publish*, running a command or sending Claude a prompt. See [Project actions](docs/project-actions.md).
- **Open in** your editor, terminal or Finder (⌘O), and click any file path in the conversation to open it at that line.
- Delete sessions you don't need. They go to the Trash, so you can get them back.

## Requirements

- A Mac with Apple Silicon
- [Claude Code](https://github.com/anthropics/claude-code) installed and signed in (`claude` works in your terminal)

## Install

There's no download yet; you build the app from this repository, which takes a couple of minutes. You need Node 24 or later.

```bash
npm install
npm run dist
```

Then open `apps/desktop/dist/Switchboard-0.1.0-arm64.dmg` and drag Switchboard to Applications.

If macOS blocks the app the first time you open it, see [Building, signing and notarisation](docs/building-and-signing.md).

## Getting started

1. **Open Switchboard.** Your existing Claude Code sessions appear in the sidebar straight away.
2. **Pick a session** to read it, or type below it to continue.
3. **Start something new** with ⌘N: choose a folder, and whether to work in the current folder or a new worktree.
4. When a session needs you (a permission or a question), it's marked in the sidebar and you get a notification.

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| ⌘N | New session |
| ↑ ↓ | Move through sessions in the sidebar |
| ⌘⌫ | Delete the selected session (to the Trash) |
| ⌘O | Open the session's folder in your editor |
| ⌘J | Show or hide the terminal |
| ⌘, | Settings |
| Esc | Stop Claude while it's working |
| ⇧Tab | Switch permission mode |
| `/` and `@` | Commands and file mentions in the message box |
| ⌘Q | Quit (Switchboard asks first; press ⌘Q again to quit) |

Right-click a session for more: pin, settle, open its folder, copy its ID, or delete it.

## Settings

Open Settings with ⌘, or the gear at the bottom of the sidebar.

- **Theme:** Match System, Light or Dark. The colours come from the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme).
- **Sidebar:** *Large icons* (easy to spot each project), *Standard*, or *Compact* (one line per session).
- **Conversation:** *Summarised* (the default) shows each run of tool calls as one line, like Claude Code: what Claude is doing right now, or what it did, with how long it took. Click it to see the steps, and a step to see its details. *Every step* shows each tool call as its own card.
- **Quitting:** turn off the "Ask before quitting" prompt.

## Your data

Switchboard reads the session files Claude Code already keeps in `~/.claude` and runs your own `claude` to do the work, so your sessions stay in one place whether you use the terminal or the app. It doesn't send anything anywhere else. Deleting a session moves its files to the Trash.

## Documentation

- [Project actions](docs/project-actions.md): add buttons for your own commands and prompts, and share them with your team.
- [Building, signing and notarisation](docs/building-and-signing.md): packaging the app, and signing it with an Apple Developer ID.
- [Development](docs/development.md): running from source, tests, and how the code is organised.
- [Plan](PLAN.md): the roadmap and design decisions.

## Credits

Switchboard's colour theme and syntax colours come from the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme) (MIT).
