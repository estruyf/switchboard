import { Fragment, type ReactNode } from 'react';
import type { ClaudeProfile, Effort, PermissionMode } from '@switchboard/protocol/client';
import { MODE_CHOICES, MODE_DOT, MODE_LABEL } from '../../lib/modes.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ChoiceMenu, type Choice } from '../newSession/ChoiceMenu.tsx';
import { EFFORT_LABEL, EFFORTS, MODE_DESCRIPTION } from '../newSession/route.ts';
import { PROFILE_DOT } from '../profiles/ProfileBadge.tsx';

/** Test hooks: each chip gets `data-<name>-select` and its menu `data-menu="<name>"`. */
export interface ChipNames {
  profile: string;
  model: string;
  effort: string;
  mode: string;
}

const NEW_SESSION_NAMES: ChipNames = { profile: 'profile', model: 'model', effort: 'effort', mode: 'mode' };

export interface ComposerChipRowProps {
  /** The Claude profile. Without `onChange` it can't change (a running session keeps its profile): the menu shows it and links to Settings. */
  profile: { value: string; onChange?(id: string): void; labelFor?(profile: ClaudeProfile): string };
  model: { value: string; label: string; choices: Array<Choice<string>>; onChange(model: string): void };
  /** Null when the model has no effort setting. */
  effort: { value: Effort | ''; onChange(effort: Effort | ''): void } | null;
  mode: { value: PermissionMode; onChange(mode: PermissionMode): void };
  disabled?: boolean;
  names?: ChipNames;
  /** Shown after the chips, such as a session's background tasks. */
  children?: ReactNode;
}

const Divider = () => <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />;

/**
 * The message box's chip row, the same in a session and in New session: profile · model · effort ·
 * permission mode, compact ghost chips with thin dividers, in the card's bottom-left corner. Each opens
 * its menu above it (the box sits low in the window). The profile chip shows only with more than one
 * profile, like the profile badges elsewhere.
 */
export function ComposerChipRow({ profile, model, effort, mode, disabled, names = NEW_SESSION_NAMES, children }: ComposerChipRowProps) {
  const profiles = useProfiles((s) => s.profiles);
  const current = profiles.find((p) => p.id === profile.value);
  const fixed = !profile.onChange;
  // A mode set elsewhere (bypass, say) is listed too, so the checked one is always there.
  const modes = [...new Set([...MODE_CHOICES, mode.value])];

  const chips: Array<[key: string, chip: ReactNode]> = [];
  if (profiles.length > 1) {
    chips.push([
      'profile',
      <ChoiceMenu
        name={names.profile}
        value={profile.value}
        onChange={(id) => profile.onChange?.(id)}
        disabled={disabled && !fixed}
        title={`${fixed ? 'Claude profile this session bills to. A session keeps its profile; a new one can use another.' : 'Claude profile'}${current?.account?.email ? ` · signed in as ${current.account.email}` : ''}`}
        heading="Profile"
        placement="up"
        choices={profiles.map((p) => ({
          value: p.id,
          label: profile.labelFor?.(p) ?? p.name,
          description: p.account?.email ?? undefined,
          dot: PROFILE_DOT[p.color],
          disabled: fixed && p.id !== profile.value,
        }))}
        actions={fixed ? [{ label: 'Manage profiles…', onSelect: () => useSessions.getState().openSettings('profiles'), data: { 'data-manage-profiles': true } }] : undefined}
        width={260}
        chevron
      >
        {current && <span className={`size-2 shrink-0 rounded-full ${PROFILE_DOT[current.color]}`} aria-hidden />}
        <span className="max-w-32 truncate">{current?.name ?? 'Profile'}</span>
      </ChoiceMenu>],
    );
  }
  chips.push([
    'model',
    <ChoiceMenu name={names.model} value={model.value} onChange={model.onChange} disabled={disabled} title="Model" heading="Model" placement="up" choices={model.choices} width={260} chevron>
      <span className="max-w-40 truncate">{model.label}</span>
    </ChoiceMenu>],
  );
  if (effort) {
    chips.push([
      'effort',
      <ChoiceMenu
        name={names.effort}
        value={effort.value}
        onChange={effort.onChange}
        disabled={disabled}
        title="Effort: how hard Claude thinks"
        heading="Effort"
        placement="up"
        choices={[{ value: '' as const, label: 'Default', description: 'What Claude Code would pick' }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))]}
        width={200}
        chevron
      >
        <span className="truncate">Effort: {effort.value ? EFFORT_LABEL[effort.value].toLowerCase() : 'default'}</span>
      </ChoiceMenu>],
    );
  }
  chips.push([
    'mode',
    <ChoiceMenu
      name={names.mode}
      value={mode.value}
      onChange={mode.onChange}
      disabled={disabled}
      title="Permission mode (⇧Tab in the message box)"
      heading="Permissions"
      placement="up"
      choices={modes.map((m) => ({ value: m, label: MODE_LABEL[m], description: MODE_DESCRIPTION[m], dot: MODE_DOT[m] ?? 'bg-faint' }))}
      width={280}
      chevron
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${MODE_DOT[mode.value] ?? 'bg-faint'}`} />
      <span className="truncate">{MODE_LABEL[mode.value]}</span>
    </ChoiceMenu>],
  );

  return (
    <div className="flex min-w-0 items-center" data-composer-chips>
      {chips.map(([key, chip], i) => (
        <Fragment key={key}>
          {i > 0 && <Divider />}
          {chip}
        </Fragment>
      ))}
      {children}
    </div>
  );
}
