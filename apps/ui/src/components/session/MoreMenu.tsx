import { Bot, Ellipsis, Square } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useActionsMenu } from '../actions/useActionsMenu.tsx';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { AgentsDialog, useAgentRuns } from '../transcript/AgentsDialog.tsx';

const MENU_WIDTH = 260;

/**
 * The session header's "⋯" menu: the project's actions (and "Edit actions…"), the agents Claude
 * started, the Claude profile the session bills to, and stopping the session's Claude Code process.
 * A dot on the button says agents are running.
 */
export function MoreMenu({
  sessionId,
  projectRoot,
  cwd,
  items,
  sessionOpen,
  profileId,
  onStop,
}: {
  sessionId: string;
  projectRoot: string | null;
  cwd: string | null;
  items: readonly DisplayItem[];
  /** The session is open somewhere (here or another Claude Code window), so agents can still be running. */
  sessionOpen: boolean;
  profileId: string | null;
  /** Stops the Claude Code process for this session; null when it isn't running here. */
  onStop: (() => void) | null;
}) {
  const menu = useMenu();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const actions = useActionsMenu({ sessionId, projectRoot, cwd });
  const { agents, running } = useAgentRuns(items, sessionOpen);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const closeAgents = useCallback(() => setAgentsOpen(false), []);
  const multipleProfiles = useMultipleProfiles();
  const profile = useProfile(profileId);

  const entries: MenuEntry[] = [...actions.entries];
  if (entries.length) entries.push('separator');
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
      label: 'Agents',
      icon: <Bot size={13} />,
      hint: running ? `${running} running` : agents.length ? `${agents.length} finished` : 'None',
      disabled: agents.length === 0,
      onSelect: () => setAgentsOpen(true),
      data: { 'data-agents-button': true },
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

  const label = `More: project actions, agents${running ? ` (${running} running)` : ''}, stop session`;
  return (
    <div className="no-drag relative flex shrink-0" data-actions-bar>
      {/* A failed action run: on the button's tooltip, and said out loud. */}
      {actions.error && (
        <span role="alert" className="sr-only">
          {actions.error}
        </span>
      )}
      <button
        ref={buttonRef}
        type="button"
        data-more-menu
        // The project actions used to have their own ▾ button; the hook stays for tests.
        data-actions-menu
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (menu.at || !rect) menu.close();
          else menu.openAt(rect.right - MENU_WIDTH, rect.bottom + 4);
        }}
        data-tooltip={actions.error ?? (running ? `More · ${running === 1 ? '1 agent' : `${running} agents`} running` : 'More: project actions, agents, stop session')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={menu.at !== null}
        className={`relative flex size-7 items-center justify-center rounded-md hover:bg-border/50 hover:text-text ${menu.at ? 'bg-border/50 text-text' : actions.error ? 'text-error' : 'text-muted'}`}
      >
        <Ellipsis size={15} aria-hidden />
        {running > 0 && <span className="absolute top-0.5 right-0.5 size-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden />}
      </button>
      {menu.at && <Menu x={menu.at.x} y={menu.at.y} width={MENU_WIDTH} entries={entries} onClose={menu.close} label="More" />}
      {actions.overlays}
      {agentsOpen && <AgentsDialog agents={agents} running={running} sessionId={sessionId} cwd={cwd} onClose={closeAgents} />}
    </div>
  );
}
