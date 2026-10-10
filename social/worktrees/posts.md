# Project page and worktree clean-up

Image: [image.png](image.png) (1200×630 at 2×; alt text below).

Links:

- Switchboard: https://github.com/estruyf/switchboard
- Download: https://github.com/estruyf/switchboard/releases
- Homebrew: `brew install --cask estruyf/tap/switchboard`

Not released yet: the project page and the Worktrees tab are in the `[Unreleased]` section of the CHANGELOG (Switchboard is on 0.0.13). Post this with the release that ships them.

## Alt text

Switchboard's page for the project acme-store, on its Worktrees tab. A summary reads 5 worktrees, 3.6 GB on disk, 2 safe to remove and 1 stale, with a button to remove the 3 selected and free 1.5 GB. The table groups worktrees under Safe to remove (two merged, clean worktrees), Keep (one with 3 uncommitted files, an open pull request and a session working in it, locked) and Stale (one whose folder is gone). A dialog asks "Remove 3 worktrees?", with options to also delete their branches and keep a recovery ref, and Cancel and Remove 3 buttons.

## X (280 characters)

Running Claude Code in worktrees? They pile up fast 🌳

Switchboard now shows every worktree of a project: its sessions, uncommitted changes, merges, PRs and size on disk. It tells you which are safe to remove and clears them out in one go.

https://github.com/estruyf/switchboard

## Bluesky (300 characters)

Running Claude Code in worktrees? They pile up fast 🌳

Switchboard's new project page has a Worktrees tab: sessions, uncommitted changes, merges, PRs and size on disk for each one. It groups them into safe to remove, probably done, keep and stale, and removes what you tick.

## Mastodon (500 characters)

Running Claude Code in worktrees? They pile up fast 🌳

Switchboard now gives every project its own page. Its Worktrees tab shows, for each worktree:

• its sessions and uncommitted changes
• commits ahead, pushed, merged or its PR
• size on disk and when it was last used

It sorts them into safe to remove, probably done, keep and stale, and removes the ones you tick with git worktree remove.

https://github.com/estruyf/switchboard

#ClaudeCode #macOS #git

## LinkedIn

If you run Claude Code sessions in git worktrees, you know how fast they pile up. A week later you have a dozen folders, a few gigabytes gone, and no idea which ones still matter.

Switchboard, my macOS app for managing Claude Code sessions, now gives every project its own page, with an Overview, its Sessions, Worktrees, Actions and Settings. The Worktrees tab is the one I built it for.

For each worktree it shows:

• the sessions in it, and whether one is still working
• uncommitted changes and commits ahead of the base branch
• whether it's pushed and merged, or its pull request (with the GitHub CLI)
• its size on disk and when it was last active

It groups them into Safe to remove, Probably done, Keep (with the reason) and Stale, so you can see at a glance what can go. Tick the ones you're done with, and one confirmation shows the space you get back. Branches can go too, with a recovery ref if you want a way back.

It stays careful: a worktree with uncommitted changes, a working session or a lock is never removed, and removing always goes through git worktree remove.

Switchboard is free and open source: https://github.com/estruyf/switchboard

#ClaudeCode #git #DeveloperTools
