# Changelog

All notable changes to Switchboard are listed here. Each release is also on the [releases page](https://github.com/estruyf/switchboard/releases), with the `.dmg` to download.

## [Unreleased]

### Fixes

- **Fetch, Pull, Push and project actions show what they run.** Their terminal tab starts with the command and ends with a **Done** line (or the exit code), so a command that prints nothing, like a fetch with nothing new, no longer looks like it never ran.
- **A finished terminal tab says so.** The cursor no longer blinks as if you could type, and next to **Restart** there is a **Close** button (or press Esc).
- The right-click menu of a session no longer offers **Remove from Switchboard**, which removed the project and was easy to mistake for deleting the session. It is still in the project menus and in Projects.
- With **Show sessions from other apps** on, opening New session no longer adds a session named after the project that runs in the background for a couple of minutes.

## [0.0.7] - 2026-10-07

### New

- **Right-click a project action** above the message box, or one in its **N more** menu, to run, edit or delete it. Shift+F10 opens the same menu from the keyboard. Delete asks first.

### Safer

- **A link can't start Claude without permission prompts any more.** A `switchboard://` link with `autostart` now uses the project's own permission mode, or Ask before edits when the project has none. It never uses the mode you last picked, and never Auto, Don't ask or Bypass permissions.
- **Going back to an older version of Switchboard keeps your pins, projects, actions and profiles.** It used to start from an empty list; now the older version leaves your data alone, so it is all there when you update again.
- **Reverting a file in the Changes panel only touches that file.** File names with `[`, `*` or `?` (such as `app/[id]/page.tsx`) could also affect a similar file next to them. Reverting a staged deletion now brings the file back, and reverting a renamed file restores the original name.
- Switching branches when starting a session, and merging or removing a worktree, now wait while Claude is working in that checkout.
- While **Settings** is open, permission shortcuts (Esc, ⌘↵), project action shortcuts and ⌘⇧L no longer act on the session behind it.
- **Remove from Switchboard** in the sidebar menus asks first, as it does in Projects.

### Fixes

- **Stop** and **Restart** on a project action's terminal tab work again. The terminal was catching the clicks.
- Saving a project action closes the editor, updates its pill straight away and says **Action saved**. If the save fails, the editor stays open with the error at the top, so nothing you typed is lost.
- With two sessions side by side, a project action's shortcut or **Run** from the command palette runs it once, in the active session, not in both.
- Opening or closing a second pane keeps the message you were typing in the other one.
- Recording a shortcut for a project action no longer runs the action that already uses those keys. A shortcut Switchboard already uses (such as ⌘K or ⌘F), or one another action has, is refused with a message. ⌘⇧+ and ⌘Space can be recorded and are shown properly.
- Text you type while a message is still sending is kept.
- A file search with `@` that finishes late no longer reopens the list and replaces what you typed on Enter.
- **Approve and accept edits** only switches to Accept edits when the approval went through.
- Double-clicking **Commit**, **Push** or **Pull** runs it once.
- Clicking a notification, choosing **Settings…** or **Check for Updates…** after closing the window now opens the right place.
- Home shows "Usage unavailable" for a profile whose plan usage can't be read, instead of "Loading usage…" forever, and tries again later.
- Deleting the open session when it was the last one in the list no longer leaves it on screen.
- Closing a session means it doesn't reopen the next time Switchboard starts on your last session.
- The Changes panel shows correct diffs with git settings such as an external diff tool (difftastic), forced colour, or blank lines written without a leading space. An open diff refreshes when Claude edits it again.
- A session started on a new Claude profile shows up right away, without waiting for a refresh or a restart.
- Sessions no longer briefly disappear from, or come back to, the sidebar while it refreshes.
- Forking a session (sending to a session open elsewhere) no longer makes the original look as if it is starting, or adds your message to it.
- Sending twice quickly to a stopped session starts Claude Code once.
- Plan usage that can't be read is retried once instead of every 30 seconds.
- `@` file search in a folder that isn't a git repository no longer freezes the app or walks your Library, Desktop and Documents folders.
- If an update can't be installed, Switchboard keeps working instead of losing its connection to Claude Code. Switching the update channel during a download no longer mixes up the two versions, and automatic update checks keep running after a busy moment.
- A blank window after a crash reloads on its own.
- Your preferences survive a crash while they are being saved.
- Find in session highlights the right text after letters such as "İ".
- Typing with an input method (Japanese, Chinese, Korean) no longer picks a branch, folder or find result on the Enter that confirms the text.
- The emoji picker for a project closes when you click elsewhere and stays inside the window.
- Renaming a Claude profile keeps the keyboard focus.

## [0.0.6] - 2026-10-06

### A fresh look

- **The sidebar puts what needs you first.** Sessions are grouped into **Needs you**, **Working**, **Today**, **Yesterday** and **Earlier**. Each row has a coloured bar for its state: pink when it waits for you (with what it waits for), yellow while Claude works, and blue when it finished and you haven't read it yet. The selected row is easier to see in light mode.
- **Home** shows what needs you, what is working, each Claude profile's plan usage (5-hour and weekly, with when they reset) and what its sessions are doing, and a quick start for your projects. Open it with the house button at the top of the sidebar, ⌘⇧H or the command palette; closing a session (×) also goes there. Switchboard now opens on Home; pick another start in **Settings → General → On startup**.
- **New session** is centred and starts with your projects as tiles: the four you used last, the rest one click away, and ⌘1 to ⌘9 to pick one. Where the session runs (current checkout or a new worktree, and the branch) sits on top of the message box, with a Worktree switch. Below it, pick up a recent session in that project.
- **Permission requests stand out** with a pink frame. ⌘↵ allows, Esc denies, and you can tell Claude what to do instead. Questions show numbered answers you can pick with 1 to 9.
- **A calmer session header**: Changes and Terminal are one compact switch, the git button is the main action, and **Open in** moved into the **⋯** menu (⌘O still works). Your **project actions** are pills above the message box, with their shortcuts; all of them are still in the **⋯** menu.
- **Project actions** have a clearer editor: your actions on the left, the selected one on the right, variables you can insert with a click, and package.json scripts to add in one go.
- **Terminal** (⌘J) opens a shell straight away instead of asking what to open, and closing its last tab hides the panel. Claude Code's terminal interface moved to **⋯ → Open in → Claude Code**.
- The context meter always shows its ring and opens on a click, also for a session you haven't sent a message to yet.
- **Usage and context change colour** as they fill up: green, then orange from 60%, red from 85%. Claude's task list and background tasks are small pills above the message box.
- **The conversation has fewer boxes.** Your prompts are cards on the right; tool runs, agent reports and task lists are quiet lines that open on a click.
- **Settings uses the main area** and leaves the sidebar's session list in place, so anything waiting for you stays in view.
- **The Changes panel can be resized** by dragging its edge (or with ← →), and the diff can fill the window.
- With two sessions side by side, the one you're not working in fades back.
- The terminal is always dark, also when the app uses the light theme.
- Dialogs look and behave the same everywhere: the same title and close button, Esc closes only the dialog on top (a dropdown inside it closes first), ⌘↵ commits or saves, and a click outside closes them. Messages such as a failed action or a session open elsewhere share one style too.
- Buttons, keyboard shortcuts and usage bars look the same on every screen. Send, Stop and the permission buttons are the same height, second choices such as "Approve, ask before edits" have a visible border, and the counts on Home take the colour of their group, as in the sidebar.

### Sidebar

- **Settled** is now called **Archived**: right-click → **Archive** (or **Unarchive**). Sessions quiet for 48 hours still move there on their own. Nothing is deleted, and a session comes back when it has new activity or needs you. To remove a session for good, use **Delete session…**.
- **Select several sessions** with ⌘-click (or ⇧-click and ⇧↑ ↓ for a range). While you pick, every row shows a round checkbox you can click (or tick with Space), the picked rows share one highlight, and each group has **Select all** (⌘A picks the group you're in). A bar over the list archives or unarchives, pins and deletes them all at once (⌘⌫), with the same actions in the right-click menu. Escape clears the selection.
- Sending a message to an archived session moves it back to the main list right away, instead of waiting until Claude finishes.
- Archiving or unarchiving a session no longer makes rows overlap the **Archived** header.

### Session view

- A calmer **session header**. Under the title, one line says what the session is doing, its project and its branch; click the branch to switch (or, in a worktree, to merge or remove it). Where it was started and when it was last updated are in the title's tooltip.
- A **git button** next to **Open in**: commit (Claude writes the message, or write your own with **Commit…**), push, create a pull request, pull or fetch, without leaving the session. Its face shows the next step and the count, such as **Pull ↓2** when the branch is behind its upstream, and **Fetch** when there's nothing to do. The menu shows where the branch stands, says when you need to pull before you push, and has **Switch branch…** and **New worktree…**. ⌘⇧L pulls. Commit and pull request moved here from the **Worktree** menu, which now merges or removes.
- **Open in** shows your editor with an icon, and its menu can copy the folder's path.
- A **⋯** menu holds your project actions, the agents Claude started, the Claude profile the session uses and **Stop session**.
- The message box has one row of chips, the same in a session and in **New session**: profile · model · effort · permission mode (⇧Tab still switches it), next to **Tools**, attach and **Stop** (with its Esc key). A running session's profile chip says which account it bills to. Under the box, one quiet line has your plan usage and how full the context is; the context breakdown can compact the conversation. Effort in New session is now a chip instead of the bars.
- The **context breakdown** is easier to read: the bar has a visible outline so you can see how much is free, small categories still show up in it, and **Compact now** looks like a button.

### New session

- A prompt you start typing in **New session** is still there when you come back from a session or Settings. A **Clear** link under the message box empties it.
- **Open in** (VS Code, another editor, a terminal, Finder or GitHub) is at the top of **New session** too, to look around the project before you start.
- A simpler bar under the message box with two dropdowns: where the edits go (**Current checkout** or **New worktree**, with **Save as project default** at the end) and the branch, which you can search. For a new worktree it shows the branch it starts from, such as **From origin/main**. Your plan usage and the sessions already running in the project sit on one quiet line below it.

### Fixes

- The arrow that opens the **Open in** menu is now a proper chevron instead of a tiny glyph sitting off-centre.
- **New session** no longer counts archived sessions in "running here", so the number matches what the sidebar shows.

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
