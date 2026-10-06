# Changelog

All notable changes to Switchboard are listed here. Each release is also on the [releases page](https://github.com/estruyf/switchboard/releases), with the `.dmg` to download.

## [Unreleased]

### Sidebar

- **Archive** sessions you don't need to see any more: right-click → **Archive**. They leave the list, Settled included, and wait under a collapsed **Archived** section. Nothing is deleted, and a session comes back on its own when it has new activity or needs you.
- **Select several sessions** with ⌘-click (or ⇧-click and ⇧↑ ↓ for a range), then archive, settle or move them back all at once from the right-click menu or the bar under the list. Escape clears the selection.

### New session

- A prompt you start typing in **New session** is still there when you come back from a session or Settings. A **Clear** link under the message box empties it.
- **Open in** (VS Code, another editor, a terminal, Finder or GitHub) is at the top of **New session** too, to look around the project before you start.

### Fixes

- The arrow that opens the **Open in** menu is now a proper chevron instead of a tiny glyph sitting off-centre.

## [0.0.5] - 2026-10-06

### Sessions

- The **Open in** menu in a session's header has a **GitHub** entry when the project is on GitHub. It opens the branch you're on when it's pushed, and the repository otherwise.
- When Claude leaves a command or agent running in the background, the session shows it: a slowly turning green ring in the sidebar, "Open, 1 background task running" in the header, and the task under the message box. Hover to see what's running.
- **Find in a conversation** (⌘F): search the session you're reading. Every match in your prompts and Claude's replies is highlighted, the count shows where you are, and ↩ / ⇧↩ (or ⌘G / ⇧⌘G) step through them. Escape closes it.

### Accessibility

- Small grey text, timestamps and hints are easier to read in both themes, and so are green and pink status text in light mode.
- You can use Switchboard with the keyboard alone. Menus work with the arrow keys and hand focus back when they close. Dialogs keep Tab inside them. ⇧F10 opens a session's menu in the sidebar. Hover-only buttons (message actions, Changes panel rows, project options) also show when you Tab to them.
- VoiceOver reads each session in the sidebar as one sentence (title, project, status, how long ago), and every icon button, status dot, usage ring and context meter is labelled. It also announces when Claude finishes, needs permission or a session starts waiting for you.
- Animations stop when *Reduce motion* is on in macOS. Spinners still turn.

### Changes

- A permission request no longer takes focus while you're typing, so pressing Enter can't approve a command by accident.
- Deleting a project action asks first.
- The terminal panel's **Claude TUI** tab is now called **Claude Code**.
- New session explains what to do before a folder is chosen, instead of showing empty controls. A disabled Send or Start session button says why when you hover it.
- Clearer wording across the app: empty states say what to do next, errors say what failed, and the action editor explains how to set a shortcut.

### Fixes

- The Claude profiles page no longer runs off the side of the window when a sign-in command is long. The command wraps and has a copy button.
- Diffs in the Changes panel scroll sideways with the line numbers kept in view, and added or removed lines are coloured across the whole width. A new button in the panel's header wraps long lines instead; Switchboard remembers your choice.
- A session that starts again (after Stop, a while idle, or restarting Switchboard) keeps its permission mode, and the model and effort you picked for it, instead of going back to your defaults.
- The model picker under a session shows the model it runs, such as Opus 5.5, instead of an extra row with the raw model id.
- Switchboard no longer closes a session that has been idle for a while when a background task is still running in it. That used to stop the task before Claude could report back.
- The permission mode picker under a session shows the same coloured dot as New session.
- A session you just started goes to the top of the sidebar, even while another session is working.
- The **Open in** menu is no longer hidden behind the conversation.

## [0.0.4] - 2026-10-06

### Updates

- Switchboard updates itself. It checks for a new release shortly after it opens and every few hours; a pill at the bottom of the sidebar offers the update, shows what's new, downloads it when you click, and restarts into it (asking first if sessions are running). **Switchboard → Check for Updates…** checks right away.
- A new **About** section in Settings shows the version you're running and the commit it was built from, links to its release notes and the changelog, and has the update settings: automatic checks on or off, and the *Stable* or *Nightly* channel. The version also shows at the bottom of the Settings sidebar, and in the About Switchboard window.
- Switchboard tells you when a newer Claude Code is out and updates it for you. It checks shortly after it opens and every few hours, following your Claude Code channel (*latest* or *stable*). A notice at the bottom of the sidebar offers the update (or dismiss it until the next version), and **Settings → About** shows the Claude Code you have, how it was installed, the update's output, and a switch to turn the checks off. New sessions use the new version right away. When Switchboard can't run the update itself, it shows the command to copy into a terminal.

### Links

- Open Switchboard from a link. `switchboard://new-session?project=payments&prompt=…` opens New session in that project with the prompt filled in. Use `cwd=/path` for any folder, or `repo=owner/name` and Switchboard finds your checkout of that GitHub repository. A link that doesn't say where opens the project list instead of guessing. By default you read the prompt and press Enter (a note under the message box says it came from a link); add `autostart=1` to start the session right away. `switchboard://session/<id>` opens a session. Links Switchboard can't use show why and change nothing. See [Links](docs/deep-links.md) for the format and examples.

### Sessions

- A session working in its project's folder (not a worktree) shows the branch checked out right now in its header, instead of the one Claude Code last recorded. Click it to switch branches: uncommitted changes come along when they don't conflict, git refuses when they do, and nothing is ever stashed or discarded. Running sessions in the sidebar show the same live branch.
- A session keeps its permission mode (such as *Auto*) when it picks up again after being stopped, idling for a while or rewinding, instead of falling back to *Default*. The mode shown also follows changes Claude Code makes on its own, such as leaving plan mode.
- A session's model dropdown shows the model's name from the list (such as *Opus*) instead of its raw id like `claude-opus-5-5`.
- The "open" count at the bottom of the sidebar now matches the sessions in the main list. It no longer counts Claude Code processes idling outside Switchboard, which are listed under *Settled*.

### Projects and profiles

- After you add a project, the Projects view opens on it so you can choose its Claude profile and defaults straight away.
- The Claude profile dropdown shows profile names in full; the account email is shortened instead.

### Actions

- A running action's terminal tab has a **Stop** button, and ⌃C in it stops the action like in any terminal. An action stopped this way shows exit code 130 instead of 0.
- **Restart** on a finished action now runs it again in the same tab. If the action was edited, the new command runs; if it comes from `.switchboard.json` and changed, it has to be approved again (run it from the actions bar) before it restarts.

### Settings

- Back up and move your settings. **Settings → Backup** (or *Export settings…* in the command palette) saves your preferences, projects with their icons, project actions and app choices to a file; *Import settings…* shows what a file would change before anything happens, merges by default or replaces, and lets you point folders that aren't on this Mac at new ones. Your current settings are backed up first, and imported shell actions ask for approval before they run.

### Look and feel

- Menus, dropdowns, popovers and dialogs stand out more from what's behind them, especially in dark mode: they have a lighter surface, a clearer border and a stronger shadow, and dialogs dim the app further.
- macOS permission prompts, such as the one for local network access, now say *Switchboard* instead of *Electron*.

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
