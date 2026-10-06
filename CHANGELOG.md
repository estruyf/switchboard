# Changelog

All notable changes to Switchboard are listed here. Each release is also on the [releases page](https://github.com/estruyf/switchboard/releases), with the `.dmg` to download.

## [0.0.3] - 2026-10-06

### Projects

- Projects are now the folders you add yourself. The sidebar filter, New session and the command palette offer only those. *Add project* suggests the folders you already have Claude Code sessions in, and starting a session in another folder offers to add it. If you're upgrading, folders where you started or continued a session in Switchboard are kept.
- A new **Projects** view (the folder icon at the bottom of the sidebar): add, remove and reorder projects, and set their icon, actions and defaults. Removing a project only takes it off Switchboard's lists; nothing on disk changes.
- Defaults per project for new sessions: model, effort, permission mode, current folder or new worktree (and its base), and a branch to check out. Change one in New session and choose *Save as project default* to keep it.

### New session

- Redesigned around the prompt. The project sits above it, with a switcher for recent folders. Model, a five-step effort dial and the permission mode are in the prompt's toolbar. Below it you choose this checkout or a new worktree, its base and branch, and see your plan usage.
- ⌘N, the sidebar button and the command palette put the cursor straight in the prompt, even when New session is already open.
- The "running here" note only counts sessions the sidebar shows, so terminal and editor sessions stay hidden when *Show sessions from other apps* is off.

### Claude profiles

- Use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login, settings, plugins and sessions. Add them in **Settings → Claude profiles**, choose the default, and link a project to a profile from its menu or the Projects view.
- With more than one profile, sessions show which account they use, New session lets you pick one for a single session, and the usage band shows that account's limits.
- *How to set up another profile* in Settings walks you through creating the folder, signing in, adding it and linking projects.

### Settings

- Settings now uses the sidebar for its sections, and closes with the × button, *Back to sessions* or Escape.
- Diagnostics moved into Settings (or "Engine diagnostics" in the command palette).
- New **General** section: choose whether Switchboard opens on the last session or on New session. It also holds the "Ask before quitting" option.

### Sessions and the message box

- Close a session with the × in its header to go to New session. A session that's working keeps running.
- Switchboard no longer reopens a session from another app at launch while those sessions are hidden from the sidebar.
- Drag files onto a session and the message box shows what will happen: images are attached, and other files and folders are mentioned as `@path`. Images over the limit are mentioned instead of being dropped.

### Look and feel

- Drag the sidebar's edge to resize it; double-click the edge to reset. Switchboard remembers the width.
- Dropdowns, checkboxes, switches and tooltips match the app's theme in light and dark mode.
- Buttons and links show the pointer cursor again.

## [0.0.2] - 2026-10-05

- The sidebar now lists only the sessions you start or continue in Switchboard. Turn on **Settings → Sidebar → Show sessions from other apps** to see your terminal, Claude desktop and editor sessions too.
- Closing or reopening Claude Code elsewhere no longer marks sessions unread or reshuffles the sidebar: a session is dated by its last message, not by when its file was last touched.
- Claude's reply is formatted as it streams in (headings, lists, code, bold), instead of as plain text until it finishes.
- With two sessions side by side, the message box, its buttons and the context meter fit inside each pane instead of sticking out.

## [0.0.1] - 2026-10-05

The first release of Switchboard, a Mac app for running and keeping track of your Claude Code sessions. It uses the Claude Code you already have installed, with your login, settings, commands and skills.

The app is signed and notarised by Apple, for Macs with Apple Silicon. You need [Claude Code](https://github.com/anthropics/claude-code) installed and signed in.

### Sessions

- Every session in one list, across all your projects, including the ones running in your terminal or in Claude desktop.
- See at a glance which sessions are working, waiting for you, finished or unread, with notifications and a Dock badge when one needs you.
- Pin sessions, filter by project, give projects an icon, and settle sessions you're done with (they come back when they need you).
- Search every conversation (⌘⇧F) and jump straight to the matching message.
- Delete sessions to the Trash.

### Working with Claude

- Start a session in any project (⌘N), in the current folder or a new worktree.
- Streaming replies, `/` commands, `@` file mentions, images, permission prompts, questions and plans.
- Each run of tool calls is one line ("Reading src/app.ts…", then "Ran 3 commands and edited 2 files"); click it to see every step.
- Undo file changes since a prompt, edit and resend a prompt, or fork from any reply.
- Change the model, permission mode and effort while a session runs; see the context window and your plan usage.
- Agents Claude starts, background ones included, show in the session header; click to watch what they're doing.

### Reviewing and finishing work

- Changes panel (⌘⇧D) with the session's git diff: stage, unstage or revert files.
- Finish a worktree: commit with Claude, merge into the base branch, open a pull request, or remove it.

### Everything in one place

- Command palette (⌘K) and two sessions side by side (⌥-click).
- Built-in terminal (⌘J) with a shell and the full Claude Code terminal interface.
- Project actions: one-click commands and prompts, shareable through `.switchboard.json`.
- Open in your editor, terminal or Finder (⌘O); file paths in the conversation open at their line.
- Tools: the session's MCP servers (turn them on or off and reconnect them), skills, agents and plugins.
- Settings (⌘,): theme (the Demo Time colours, light or dark), sidebar style, how tool activity shows, and the quit prompt.

[0.0.1]: https://github.com/estruyf/switchboard/releases/tag/v0.0.1
