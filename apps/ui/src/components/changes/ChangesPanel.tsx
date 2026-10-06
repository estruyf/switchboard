import { ChevronRight, ExternalLink, RefreshCw, Undo2, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import type { ChangedFile, ChangesBase, GitChanges } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';

const STATUS: Record<ChangedFile['status'], { letter: string; tone: string; label: string }> = {
  added: { letter: 'A', tone: 'text-ok', label: 'Added' },
  untracked: { letter: 'U', tone: 'text-ok', label: 'New, not tracked yet' },
  modified: { letter: 'M', tone: 'text-accent-ink', label: 'Modified' },
  renamed: { letter: 'R', tone: 'text-link', label: 'Renamed' },
  deleted: { letter: 'D', tone: 'text-error', label: 'Deleted' },
  conflicted: { letter: '!', tone: 'text-warn', label: 'Conflict' },
};

/** One file's diff, loaded when it's opened. */
const FileDiff = memo(function FileDiff({ cwd, base, path, version }: { cwd: string; base: ChangesBase; path: string; version: string }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ diff: string; truncated: boolean } | { error: string } | null>(null);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('git.diff', { cwd, base, path }).then(
      (result) => !cancelled && setState(result),
      (error: Error) => !cancelled && setState({ error: error.message }),
    );
    return () => {
      cancelled = true;
    };
    // `version` changes when the file's counts do, so an open diff follows new edits.
  }, [client, cwd, base, path, version]);
  const rows = useMemo(() => (state && 'diff' in state ? parseUnifiedDiff(state.diff) : []), [state]);

  if (!state) return <p className="px-3 py-2 text-[11.5px] text-faint">Loading…</p>;
  if ('error' in state) return <p className="px-3 py-2 text-[11.5px] text-error">{state.error}</p>;
  if (rows.length === 0) return <p className="px-3 py-2 text-[11.5px] text-faint">No line changes (mode or empty file).</p>;
  return (
    <div className="overflow-x-auto border-t border-border font-mono text-[11px] leading-[1.55] select-text" data-file-diff>
      {rows.map((row, i) =>
        row.kind === 'hunk' ? (
          <div key={i} className="bg-border/30 px-3 text-faint">
            @@ {row.text}
          </div>
        ) : row.kind === 'note' ? (
          <div key={i} className="px-3 text-faint italic">
            {row.text}
          </div>
        ) : (
          <div key={i} className={`flex whitespace-pre ${row.kind === 'add' ? 'bg-ok/12' : row.kind === 'del' ? 'bg-error/12 text-text/80' : 'text-muted'}`}>
            <span className="w-9 shrink-0 pr-1.5 text-right text-faint/70 select-none">{row.newLine ?? row.oldLine}</span>
            <span className={`w-4 shrink-0 text-center select-none ${row.kind === 'add' ? 'text-ok' : row.kind === 'del' ? 'text-error' : 'text-faint'}`}>
              {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
            </span>
            <span className="pr-3">{row.text || ' '}</span>
          </div>
        ),
      )}
      {state.truncated && <div className="px-3 py-1 text-faint">… diff shortened</div>}
    </div>
  );
});

/**
 * The session's changes in git: uncommitted work (stage, unstage, revert), or the
 * whole branch compared with where it left its base branch (what a merge or PR contains).
 */
export function ChangesPanel({
  cwd,
  changes,
  base,
  onBase,
  onRefresh,
  onClose,
}: {
  cwd: string;
  changes: GitChanges | null;
  base: ChangesBase;
  onBase(base: ChangesBase): void;
  onRefresh(): void;
  onClose(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reverting, setReverting] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const files = changes?.files ?? [];
  const added = files.reduce((n, f) => n + f.additions, 0);
  const removed = files.reduce((n, f) => n + f.deletions, 0);
  const editable = base === 'uncommitted';
  const allStaged = files.length > 0 && files.every((f) => f.staged);

  const run = (call: Promise<unknown>) =>
    void call.then(
      () => (setError(null), onRefresh()),
      (e: Error) => setError(e.message),
    );
  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <aside className="flex w-[440px] max-w-[45vw] shrink-0 flex-col border-l border-border bg-bg" data-changes-panel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex rounded-md border border-border p-0.5 text-[11.5px]" role="radiogroup" aria-label="Compare">
          {(['uncommitted', 'branch'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={base === value}
              data-changes-base={value}
              onClick={() => onBase(value)}
              className={`rounded px-2 py-0.5 ${base === value ? 'bg-accent/15 text-text' : 'text-muted hover:text-text'}`}
              data-tooltip={value === 'branch' ? `Everything since this branch left ${changes?.baseBranch ?? 'its base'}` : 'Changes not committed yet'}
            >
              {value === 'uncommitted' ? 'Uncommitted' : `vs ${changes?.baseBranch ?? 'base'}`}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
          {files.length} {files.length === 1 ? 'file' : 'files'} <span className="text-ok">+{added}</span> <span className="text-error">−{removed}</span>
        </span>
        <button type="button" onClick={onRefresh} data-tooltip="Refresh" aria-label="Refresh" className="flex size-6 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text">
          <RefreshCw size={12} />
        </button>
        <button type="button" onClick={onClose} data-tooltip="Close (⌘⇧D)" aria-label="Close (⌘⇧D)" className="flex size-6 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text">
          <X size={13} />
        </button>
      </div>

      {(error ?? changes?.error) && <p className="border-b border-border px-3 py-2 text-[11.5px] text-error">{error ?? changes?.error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {changes === null ? (
          <p className="p-4 text-[12px] text-faint">Loading…</p>
        ) : files.length === 0 ? (
          <p className="p-4 text-[12px] text-faint">{base === 'uncommitted' ? 'No uncommitted changes.' : `Nothing on ${changes.branch ?? 'this branch'} that isn't on ${changes.baseBranch ?? 'its base'}.`}</p>
        ) : (
          files.map((file) => {
            const status = STATUS[file.status];
            const slash = file.path.lastIndexOf('/');
            const isOpen = open.has(file.path);
            return (
              <div key={file.path} className="border-b border-border" data-changed-file={file.path}>
                <div className="group flex h-8 items-center gap-2 pr-2 pl-1.5 text-[12px] hover:bg-border/30">
                  {editable && (
                    <Checkbox
                      checked={file.staged}
                      label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
                      tooltip={file.staged ? 'Staged: click to unstage' : 'Stage'}
                      onChange={(staged) => client && run(client.call('git.stage', { cwd, paths: [file.path], staged }))}
                      className="ml-0.5 shrink-0 p-0.5"
                      dataAttrs={{ 'data-stage-file': file.path }}
                    />
                  )}
                  <button type="button" data-file-toggle onClick={() => toggle(file.path)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <span className={`w-3 shrink-0 text-center font-mono text-[11px] font-semibold ${status.tone}`} data-tooltip={status.label}>
                      {status.letter}
                    </span>
                    <span className="min-w-0 truncate">
                      {slash >= 0 && <span className="text-faint">{file.path.slice(0, slash + 1)}</span>}
                      <span className="text-text">{file.path.slice(slash + 1)}</span>
                    </span>
                  </button>
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
                    {file.additions > 0 && <span className="text-ok">+{file.additions}</span>} {file.deletions > 0 && <span className="text-error">−{file.deletions}</span>}
                  </span>
                  <span className="hidden shrink-0 items-center group-hover:flex">
                    {file.status !== 'deleted' && changes.root && (
                      <button type="button" data-tooltip="Open in editor" aria-label="Open in editor" onClick={() => void openIn(`${changes.root}/${file.path}`).catch(() => {})} className="flex size-6 items-center justify-center rounded text-faint hover:text-text">
                        <ExternalLink size={12} />
                      </button>
                    )}
                    {editable && (
                      <button type="button" data-tooltip="Revert this file" aria-label="Revert this file" onClick={() => setReverting([file.path])} className="flex size-6 items-center justify-center rounded text-faint hover:text-error">
                        <Undo2 size={12} />
                      </button>
                    )}
                  </span>
                </div>
                {isOpen && <FileDiff cwd={cwd} base={base} path={file.path} version={`${file.additions}:${file.deletions}:${file.staged}`} />}
              </div>
            );
          })
        )}
      </div>

      {editable && files.length > 0 && client && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-[12px]">
          <button
            type="button"
            onClick={() => run(client.call('git.stage', { cwd, paths: files.map((f) => f.path), staged: !allStaged }))}
            className="rounded-md border border-border px-2.5 py-0.5 text-muted hover:bg-border/50 hover:text-text"
          >
            {allStaged ? 'Unstage all' : 'Stage all'}
          </button>
          <span className="flex-1" />
          <button type="button" onClick={() => setReverting(files.map((f) => f.path))} className="rounded-md px-2.5 py-0.5 text-error hover:bg-error/10">
            Revert all…
          </button>
        </div>
      )}

      {reverting && client && (
        <ConfirmDialog
          title={reverting.length === 1 ? `Revert ${reverting[0]}?` : `Revert ${reverting.length} files?`}
          danger
          confirmLabel="Revert"
          body={
            <p>
              {reverting.length === 1 ? 'Its' : 'Their'} uncommitted changes are lost. New files go to the Trash, so you can get them back from there.
            </p>
          }
          onConfirm={async () => {
            await client.call('git.revert', { cwd, paths: reverting });
            onRefresh();
          }}
          onClose={() => setReverting(null)}
        />
      )}
    </aside>
  );
}
