# Changelog

All notable changes to Switchboard are listed here. Each release is also on the [releases page](https://github.com/estruyf/switchboard/releases), with the `.dmg` to download.

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
