import { Bot, Ellipsis, Pencil, Sparkles, Square, Stethoscope } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openTerminal } from '../../state/terminalsStore.ts';
import type { ActionsMenu } from '../actions/useActionsMenu.tsx';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { useOpenInEntries } from '../OpenInButton.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { RenameSessionDialog } from '../RenameSessionDialog.tsx';
import { Button } from '../ui/Button.tsx';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { AgentsDialog, useAgentRuns } from '../transcript/AgentsDialog.tsx';

const MENU_WIDTH = 260;

/**
 * The session header's "⋯" menu: opening the folder in an editor, terminal or Finder (⌘O opens the
 * default one), opening the session in Claude Code's terminal interface, the project's actions (and "Edit actions…"), the agents Claude
 * started, the Claude profile the session bills to, renaming the session, checking its transcript, and stopping its Claude Code process.
 * A dot on the button says agents are running. The project actions come from the session view's
 * single `useActionsMenu` (it also feeds the pills above the message box and renders the dialogs).
 */
export function MoreMenu({
  sessionId,
  actions,
  cwd,
  items,
  sessionOpen,
  profileId,
  title,
  onStop,
}: {
  sessionId: string;
  actions: ActionsMenu;
  cwd: string | null;
  items: readonly DisplayItem[];
  /** The session is open somewhere (here or another Claude Code window), so agents can still be running. */
  sessionOpen: boolean;
  profileId: string | null;
  /** The session's title; null while it has no transcript to keep a new one in. */
  title: string | null;
  /** Stops the Claude Code process for this session; null when it isn't running here. */
  onStop: (() => void) | null;
}) {
  const menu = useMenu();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { agents, running } = useAgentRuns(items, sessionOpen);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const closeAgents = useCallback(() => setAgentsOpen(false), []);
  const [renaming, setRenaming] = useState(false);
  const multipleProfiles = useMultipleProfiles();
  const profile = useProfile(profileId);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  const openIn = useOpenInEntries(cwd);

  // Claude Code's own terminal interface on this session, in the terminal panel: with the editors under "Open in", before Copy path.
  const claudeTui: MenuEntry = {
    label: openIn.entries.length ? 'Claude Code' : 'Open in Claude Code',
    icon: <Sparkles size={13} />,
    hint: 'Terminal',
    disabled: !client || !cwd,
    onSelect: () => void (client && cwd && openTerminal(client, sessionId, cwd, 'claude')),
    data: { 'data-open-claude-tui': true, 'data-tooltip': "This session in Claude Code's terminal interface, in the terminal panel (mods, status line and every CLI feature)" },
  };
  const copyPath = openIn.entries.findIndex((e) => typeof e === 'object' && 'data' in e && e.data?.['data-copy-path']);
  const entries: MenuEntry[] = [...openIn.entries];
  entries.splice(copyPath < 0 ? entries.length : copyPath, 0, claudeTui);
  entries.push('separator');
  entries.push(...actions.entries);
  if (actions.entries.length) entries.push('separator');
  // Like the profile badges elsewhere: only worth showing with more than one profile.
  if (multipleProfiles && profile) {
    entries.push({
      label: `Profile: ${profile.name}`,
      icon: <ProfileDot color={profile.color} />,
      hint: 'Switch…',
      onSelect: () => useSessions.getState().openSettings('profiles'),
      data: { 'data-profile-item': profile.id, 'data-tooltip': `Claude profile: ${profile.name}${profile.account?.email ? ` (${profile.account.email})` : ''}. Profiles are in Settings.` },
    });
  }
  entries.push(
    {
      label: 'Rename…',
      icon: <Pencil size={13} />,
      disabled: title === null,
      onSelect: () => setRenaming(true),
      data: { 'data-rename-session': true },
    },
    {
      label: 'Agents',
      icon: <Bot size={13} />,
      hint: running ? `${running} running` : agents.length ? `${agents.length} finished` : 'None',
      disabled: agents.length === 0,
      onSelect: () => setAgentsOpen(true),
      data: { 'data-agents-button': true },
    },
    {
      label: 'Check transcript…',
      icon: <Stethoscope size={13} />,
      disabled: !client,
      onSelect: () => usePaletteBus.getState().showDialog({ kind: 'transcript-diagnosis', sessionId, title }),
      data: { 'data-check-transcript': true, 'data-tooltip': 'Why the conversation shows the way it does: the transcript files, compactions and any error reading them' },
    },
    {
      label: 'Stop session',
      icon: <Square size={12} />,
      danger: true,
      disabled: onStop === null,
      onSelect: () => onStop?.(),
      data: { 'data-stop-session': true, 'data-tooltip': 'Stop the Claude Code process for this session. The conversation is kept; sending a message resumes it.' },
    },
  );

  const label = `More: open in, project actions, agents${running ? ` (${running} running)` : ''}, stop session`;
  const error = actions.error ?? openIn.error;
  return (
    <div className="no-drag relative flex shrink-0 items-center" data-actions-bar>
      {/* A failed action run: on the button's tooltip, and said out loud. */}
      {actions.error && (
        <span role="alert" className="sr-only">
          {actions.error}
        </span>
      )}
      {openIn.status}
      <Button
        ref={buttonRef}
        variant="quiet"
        iconOnly
        icon={<Ellipsis size={15} aria-hidden />}
        selected={menu.at !== null}
        data-more-menu
        // The project actions used to have their own ▾ button; the hook stays for tests.
        data-actions-menu
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (menu.at || !rect) menu.close();
          else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
        }}
        data-tooltip={error ?? (running ? `More · ${running === 1 ? '1 agent' : `${running} agents`} running` : 'More: open in, project actions, agents, stop session')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        className={`relative ${!menu.at && error ? 'text-error!' : ''}`}
      >
        {running > 0 && <span className="absolute top-0.5 right-0.5 size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden />}
      </Button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="More" />}
      {renaming && title !== null && <RenameSessionDialog sessionId={sessionId} title={title} onClose={() => setRenaming(false)} />}
      {agentsOpen && <AgentsDialog agents={agents} running={running} sessionId={sessionId} cwd={cwd} onClose={closeAgents} />}
    </div>
  );
}
