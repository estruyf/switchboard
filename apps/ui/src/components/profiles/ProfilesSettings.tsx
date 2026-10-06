import { Check, Copy, FolderOpen, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { PROFILE_COLORS, type ClaudeProfile, type ProfileColor } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome, tildify } from '../../lib/format.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Radio } from '../ui/Radio.tsx';
import { PROFILE_DOT } from './ProfileBadge.tsx';

const field = 'h-7 min-w-0 rounded-md border border-border bg-bg px-2 text-[12px] text-text outline-none focus:border-accent-ink/60';
const button = 'flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-text hover:bg-border/50 disabled:opacity-50';

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'work';

/** Shell-quotes a path for the sign-in command (paths with spaces are common on macOS). */
const quote = (path: string) => (/^[\w./~-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

/** The command that signs Claude Code in for one config folder. Switchboard never handles credentials itself. */
export const loginCommand = (profile: Pick<ClaudeProfile, 'configDir' | 'builtin'>) => (profile.builtin ? 'claude' : `CLAUDE_CONFIG_DIR=${quote(profile.configDir)} claude`);

function ColorPicker({ value, onChange }: { value: ProfileColor; onChange(color: ProfileColor): void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
      {PROFILE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          data-tooltip={color}
          onClick={() => onChange(color)}
          className={`flex size-5 items-center justify-center rounded-full ${value === color ? 'ring-2 ring-accent-ink/70 ring-offset-1 ring-offset-card' : ''}`}
        >
          <span className={`size-3.5 rounded-full ${PROFILE_DOT[color]}`} />
        </button>
      ))}
    </div>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-sidebar px-1.5 py-0.5 align-middle">
      <code className="min-w-0 truncate font-mono text-[11.5px] text-text">{command}</code>
      <button
        type="button"
        data-tooltip="Copy" aria-label="Copy"
        onClick={() => void navigator.clipboard.writeText(command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="shrink-0 text-faint hover:text-text"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function ProfileRow({ profile, home, onRemove }: { profile: ClaudeProfile; home: string | null; onRemove(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [name, setName] = useState(profile.name);
  const [error, setError] = useState<string | null>(null);
  const call = (promise: Promise<unknown> | undefined) => promise?.catch((e: Error) => setError(e.message));
  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) return setName(profile.name);
    if (trimmed !== profile.name) void call(client?.call('profiles.update', { id: profile.id, name: trimmed }));
  };

  return (
    <li className="grid gap-2 rounded-lg border border-border bg-card px-3 py-2.5" data-profile={profile.id}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${field} w-40 font-medium`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="Profile name"
          data-profile-name
        />
        <ColorPicker value={profile.color} onChange={(color) => void call(client?.call('profiles.update', { id: profile.id, color }))} />
        <span className="flex-1" />
        <span data-tooltip="Projects without a profile of their own use the default">
          <Radio
            checked={profile.isDefault}
            tabbable
            onSelect={() => void call(client?.call('profiles.setDefault', { id: profile.id }))}
            className="items-center text-[12px] text-muted"
            dataAttrs={{ 'data-profile-default': profile.id }}
          >
            Default
          </Radio>
        </span>
        {!profile.builtin && (
          <button type="button" onClick={onRemove} data-tooltip="Remove from Switchboard" aria-label="Remove from Switchboard" className="rounded p-1 text-faint hover:text-error" data-remove-profile>
            <X size={14} />
          </button>
        )}
      </div>
      <p className="truncate text-[12px] text-muted" data-tooltip={profile.configDir}>
        {tildify(profile.configDir, home)}
        {profile.builtin && <span className="text-faint"> · Claude Code’s own folder</span>}
        {!profile.exists && <span className="text-warn"> · folder not found</span>}
      </p>
      <p className="text-[12px] text-muted">
        {profile.account ? (
          <>
            Signed in as <span className="text-text">{profile.account.email ?? 'a claude.ai account'}</span>
            {profile.account.organization && <> · {profile.account.organization}</>}
          </>
        ) : (
          <>
            Not signed in yet. In a terminal, run <CopyCommand command={loginCommand(profile)} /> and type <code className="font-mono">/login</code>.
          </>
        )}
      </p>
      {error && <p className="text-[12px] text-error">{error}</p>}
    </li>
  );
}

function AddProfileForm({ home, onDone }: { home: string | null; onDone(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [name, setName] = useState('Work');
  const [color, setColor] = useState<ProfileColor>('blue');
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggested = home ? `${home}/.claude-${slug(name)}` : '';
  const path = (folder ?? suggested).trim().replace(/^~(?=\/)/, home ?? '~');

  const submit = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await client.call('profiles.add', { name: name.trim(), color, configDir: path });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-2.5 rounded-lg border border-dashed border-border px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-add-profile-form
    >
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${field} w-40`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" autoFocus data-new-profile-name />
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <input
          className={`${field} min-w-0 flex-1 font-mono`}
          value={folder ?? suggested}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="Config folder, e.g. ~/.claude-work"
          aria-label="Config folder"
          spellCheck={false}
          data-new-profile-folder
        />
        <button
          type="button"
          className={button}
          onClick={() => void window.switchboard?.pickFolder(path || undefined).then((picked) => picked && setFolder(picked))}
        >
          <FolderOpen size={13} /> Choose…
        </button>
      </div>
      <p className="text-[12px] text-muted">
        Claude Code keeps a separate login, settings, plugins and sessions in each folder. A new folder is created; sign in there afterwards. Use an existing one (for
        example where you already run <code className="font-mono">CLAUDE_CONFIG_DIR=… claude</code>) to see its sessions.
      </p>
      {error && <p className="text-[12px] text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !name.trim() || !path.startsWith('/')} className="h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-on-accent disabled:opacity-50" data-add-profile-submit>
          Add profile
        </button>
      </div>
    </form>
  );
}

/** Settings → Claude profiles: one Claude Code login per config folder, and which one is the default. */
export function ProfilesSettings() {
  const profiles = useProfiles((s) => s.profiles);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ClaudeProfile | null>(null);
  // The built-in folder is usually ~/.claude, which tells us where home is.
  const builtin = profiles.find((p) => p.builtin)?.configDir;
  const home = guessHome(profiles.map((p) => p.configDir)) ?? (builtin?.endsWith('/.claude') ? builtin.slice(0, -'/.claude'.length) : null);

  return (
    <div className="grid gap-2" data-profiles>
      <ul className="grid gap-2">
        {profiles.map((profile) => (
          <ProfileRow key={`${profile.id}:${profile.name}`} profile={profile} home={home} onRemove={() => setRemoving(profile)} />
        ))}
      </ul>
      {adding ? (
        <AddProfileForm home={home} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className={`${button} w-fit`} onClick={() => setAdding(true)} data-add-profile>
          <Plus size={13} /> Add profile
        </button>
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove the ${removing.name} profile?`}
          confirmLabel="Remove"
          body={
            <>
              Its sessions leave the sidebar and its projects use the default profile again. The folder {removing.configDir}, its login and its sessions stay on disk; add it
              again to get them back.
            </>
          }
          onConfirm={async () => {
            await client?.call('profiles.remove', { id: removing.id });
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
