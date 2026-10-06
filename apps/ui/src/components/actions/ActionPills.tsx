import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import type { ListedAction } from '@switchboard/protocol/client';
import { Menu, useMenu, type MenuEntry } from '../Menu.tsx';
import { splitActionPills } from './actionPills.ts';
import { Pill } from '../ui/Pill.tsx';
import { ACTION_ICON, formatShortcut } from './useActions.ts';
import type { ActionsMenu } from './useActionsMenu.tsx';

const MENU_WIDTH = 240;

/** What an action runs, for its tooltip. */
const whatItRuns = (action: ListedAction) => `${action.type === 'prompt' ? 'Ask Claude: ' : ''}${action.command}`;

/**
 * The project's actions as small pills above the message box, one click away: up to three, then
 * "N more ▾" for the rest. With none yet, an "Add action" pill opens the editor. The same actions
 * are in the session header's ⋯ menu. In a narrow pane the pills show only their icon.
 */
export function ActionPills({ actions: menu }: { actions: ActionsMenu }) {
  const more = useMenu();
  const { openEditor } = menu;
  // A session without a known project folder can't keep actions.
  if (!openEditor) return null;
  const { pills, more: rest } = splitActionPills(menu.actions);

  const moreEntries: MenuEntry[] = [
    ...rest.map((a) => {
      const Icon = ACTION_ICON[a.icon];
      return {
        label: a.name,
        icon: <Icon size={13} />,
        ...(a.shortcut ? { hint: formatShortcut(a.shortcut) } : {}),
        onSelect: () => menu.run(a),
        data: { 'data-action': a.id, 'data-tooltip': whatItRuns(a) },
      } satisfies MenuEntry;
    }),
    'separator',
    { label: 'Edit actions…', icon: <Settings2 size={13} />, onSelect: openEditor, data: { 'data-edit-actions': true } },
  ];

  return (
    <div role="group" aria-label="Project actions" className="flex min-w-0 flex-wrap items-center gap-1.5" data-action-pills>
      {/* Not `data-add-action`: the editor's own Add button has that hook. */}
      {pills.length === 0 && (
        <Pill dashed icon={<Plus size={12} aria-hidden />} onClick={openEditor} data-tooltip="Add a command or prompt you run often" data-add-action-pill>
          Add action
        </Pill>
      )}
      {pills.map((action) => {
        const Icon = ACTION_ICON[action.icon];
        const shortcut = action.shortcut ? formatShortcut(action.shortcut) : null;
        return (
          <Pill
            key={action.id}
            icon={<Icon size={12} className="shrink-0" aria-hidden />}
            kbd={action.shortcut ?? undefined}
            onClick={() => menu.run(action)}
            data-action-pill={action.id}
            data-tooltip={`${whatItRuns(action)}${shortcut ? ` (${shortcut})` : ''}`}
            aria-label={action.name}
            // In a narrow pane only the icon shows.
            className="max-w-44 @max-[860px]:px-2"
          >
            <span className="truncate @max-[860px]:sr-only">{action.name}</span>
          </Pill>
        );
      })}
      {rest.length > 0 ? (
        <Pill
          tone="muted"
          selected={more.at !== null}
          onClick={(e) => (more.at ? more.close() : more.openAbove(e.currentTarget))}
          data-more-actions
          aria-haspopup="menu"
          aria-expanded={more.at !== null}
          aria-label={`${rest.length} more project actions`}
        >
          {rest.length} more
          <ChevronDown size={11} aria-hidden />
        </Pill>
      ) : (
        pills.length > 0 && (
          <Pill dashed onClick={openEditor} data-tooltip="Edit project actions" aria-label="Edit project actions" className="px-1.5!" data-edit-action-pills>
            <Plus size={12} aria-hidden />
          </Pill>
        )
      )}
      {more.at && <Menu x={more.at.x} y={more.at.y} width={MENU_WIDTH} above entries={moreEntries} onClose={more.close} label="More project actions" />}
    </div>
  );
}
