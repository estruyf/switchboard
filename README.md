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
- The **branch** a session's folder has checked out shows in its header, read live from git (so it's right after you or Claude switch in a terminal). Click it to switch to another local branch. Switching uses `git switch`: uncommitted changes that don't conflict come along, and when they would be overwritten git refuses and you stay where you are. Nothing is ever stashed or thrown away. It waits while Claude is working in this folder, and asks first when other sessions work in the same folder.
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
- **Links** that open Switchboard: `switchboard://new-session?project=payments&prompt=…` (or `cwd=/path`, or `repo=owner/name`) opens New session with the project and prompt filled in, and `switchboard://session/<id>` opens a session. Put them in runbooks, alerts, READMEs or Raycast and Alfred scripts. By default you read the prompt and press Enter; add `autostart=1` to start right away. See [Links](docs/deep-links.md).
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

### Updates

Switchboard checks for a new release shortly after it opens and every few hours. When there is one, a pill at the bottom of the sidebar says *Update available*: click it to download the update (the page icon next to it shows what's new), then *Restart to update*. If sessions are running, Switchboard asks before it restarts. You can also choose **Switchboard → Check for Updates…** at any time.

In **Settings → About** you can turn automatic checks off and pick a channel: *Stable* (published releases, the default) or *Nightly* (pre-release builds, when there are any). Nothing downloads until you click. Builds you make yourself with `npm run dist` update like a release; development builds don't update.

#### Claude Code

Switchboard also checks whether the Claude Code it runs is up to date: shortly after it opens, every few hours, and when you choose **Check for Updates** under Claude Code in **Settings → About** (or *Check for Claude Code updates…* in the command palette). It compares your version with the newest on the channel you follow: the `autoUpdatesChannel` in your Claude Code settings (*latest* or *stable*), or, for Homebrew, the cask you installed (`claude-code` is stable, `claude-code@latest` is latest).

When a newer version is out, the bottom of the sidebar says so. Click it to update, or dismiss it until the next version. Switchboard runs the update for how you installed Claude Code (`claude update` for the native installer, `brew upgrade --cask …` for Homebrew, `npm install -g …` for npm) and shows its output in Settings → About. New sessions use the new version straight away; sessions already running keep theirs until they restart. If Switchboard can't tell how Claude Code was installed, it shows the command to run in a terminal instead, with a copy button.

To stop the checks, turn off *Check for Claude Code updates automatically* in Settings → About. If you turned off Claude Code's own updater (`DISABLE_AUTOUPDATER`), Settings still shows a newer version, but the sidebar doesn't.

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

- **General:** what Switchboard shows when it opens: *The last session* (the default; only if the sidebar lists it, so not a session from another app while those are hidden) or *New session*. You can also turn off the "Ask before quitting" prompt.

- **Theme:** Match System, Light or Dark. The colours come from the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme).
- **Sidebar:** *Large icons* (easy to spot each project), *Standard*, or *Compact* (one line per session). *Show sessions from other apps* also lists sessions from the terminal, Claude desktop and your editor (off by default), and notifies you when a terminal session is waiting.
- **Conversation:** *Summarised* (the default) shows each run of tool calls as one line, like Claude Code: what Claude is doing right now, or what it did, with how long it took. Click it to see the steps, and a step to see its details. *Every step* shows each tool call as its own card.
- **Claude profiles:** use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login, settings, plugins and sessions (`~/.claude` is the first). Add one, sign in there once in a terminal with the command Settings shows (`CLAUDE_CONFIG_DIR=~/.claude-work claude`, then `/login`), and pick the default. *How to set up another profile* under the list walks through it step by step. Link a project to a profile from its menu or the Projects view; New session shows the profile a folder uses and lets you pick another for one session. With more than one profile, sessions show which account they use, and the usage band shows that account's limits.
- **Backup:** export your settings to a file and import them again. See [Back up and move your settings](#back-up-and-move-your-settings).
- **Diagnostics:** whether the engine is connected, which Claude Code it found, version numbers and the engine's recent log. Useful when something doesn't work.
- **About:** the version you're running (and the commit it was built from, handy for bug reports), links to its release notes and the changelog, and the update controls: *Check for Updates*, automatic checks on or off, and the channel. The version also shows at the bottom of the Settings sidebar. Below them, the Claude Code that Switchboard runs: its version, path and how it was installed, the newest version, and an *Update* button when there is one.

## Back up and move your settings

To move to a new Mac, restore your setup after a reset, or share a set of actions with someone, use **Settings → Backup** (or *Export settings…* and *Import settings…* in the command palette).

- **Export** saves the parts you tick to one `.json` file: preferences, projects (in your order, with their icons and defaults), project actions (global and per project, with shortcuts and worktree setup), and app choices such as your default editor. Pinned and settled sessions are left out unless you tick them; they're only useful on the same Mac, or when you copy `~/.claude` too. Your sessions themselves are never in the file.
- **Import** shows what the file would add, change or skip before anything happens. *Merge* (the default) adds what's missing and keeps your own values; *Replace* makes your projects, actions and preferences match the file. A project folder that doesn't exist on this Mac (a different user name, say) can be pointed at another folder, or skipped.
- Imported shell actions ask for your approval the first time they run, even if you approved them on the other Mac, so a settings file can't run a command you haven't seen.
- Before importing, Switchboard saves your current settings in the `backups` folder of its app data. To undo an import, import that file with *Replace*.

## Your data

Switchboard reads the session files Claude Code already keeps in `~/.claude` (and in the folders of any other Claude profiles you add) and runs your own `claude` to do the work, so your sessions stay in one place whether you use the terminal or the app. Apart from asking GitHub whether there's a new Switchboard release (which you can turn off in Settings → About), it doesn't send anything anywhere else, and it never handles your Claude login: you sign in with Claude Code itself. Deleting a session moves its files to the Trash.

## Documentation

- [Project actions](docs/project-actions.md): add buttons for your own commands and prompts, and share them with your team.
- [Links](docs/deep-links.md): open Switchboard from a `switchboard://` URL, with examples for the shell, READMEs, Raycast, Alfred and alerts.
- [Building, signing and notarisation](docs/building-and-signing.md): packaging the app, and signing it with an Apple Developer ID.
- [Development](docs/development.md): running from source, tests, and how the code is organised.
- [Changelog](CHANGELOG.md): what's new in each release.
- [Plan](PLAN.md): the roadmap and design decisions.

## Credits

Switchboard's colour theme and syntax colours come from the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme) (MIT).
