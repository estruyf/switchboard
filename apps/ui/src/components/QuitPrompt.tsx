import { useEffect, useRef, useState } from 'react';
import { isActiveHost, useHosts } from '../state/hostsStore.ts';
import { useTerminals } from '../state/terminalsStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { openUnsentList } from './drafts/UnsentList.tsx';
import { useUnsent } from './drafts/useUnsent.ts';
import { quitSummary } from '../state/drafts.ts';
import { Kbd } from './ui/Kbd.tsx';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What quitting would stop, in one sentence (or null when nothing is open). Restarting to update asks with it too. */
export function useQuitImpact(): string | null {
  const hosts = useHosts((s) => s.hosts);
  const terminals = useTerminals((s) => s.terminals.size);
  const open = [...hosts.values()].filter(isActiveHost);
  const working = open.filter((h) => h.state === 'running' || h.state === 'starting' || h.state === 'needs-you').length;
  const parts: string[] = [];
  if (working > 0) parts.push(`${plural(working, 'session is', 'sessions are')} still working and will stop`);
  else if (open.length > 0) parts.push(`${plural(open.length, 'open session', 'open sessions')} will close (you can resume ${open.length === 1 ? 'it' : 'them'} later)`);
  if (terminals > 0) parts.push(`${plural(terminals, 'terminal tab', 'terminal tabs')} will close`);
  if (parts.length === 0) return null;
  const sentence = parts.join(', and ');
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`;
}

/** Asks before quitting when ⌘Q is pressed. Main quits straight away on a second ⌘Q. */
export function QuitPrompt() {
  const [open, setOpen] = useState(false);
  const answered = useRef(false);
  const impact = useQuitImpact();
  const unsent = useUnsent().length;
  const summary = quitSummary(impact, unsent);

  useEffect(
    () =>
      window.switchboard?.onQuitRequested(() => {
        answered.current = false;
        setOpen(true);
      }),
    [],
  );

  if (!open) return null;
  const answer = (value: 'quit' | 'cancel') => {
    if (answered.current) return;
    answered.current = true;
    window.switchboard?.answerQuit(value);
  };

  const cancel = () => {
    answer('cancel');
    setOpen(false);
  };
  return (
    <ConfirmDialog
      title="Quit Switchboard?"
      body={
        <>
          {summary.length > 0 && <p data-quit-unsent={unsent || undefined}>{summary.join(' ')}</p>}
          <p className={summary.length > 0 ? 'mt-2' : undefined}>
            Press <Kbd shortcut="quit" /> again to quit.
          </p>
        </>
      }
      confirmLabel="Quit"
      // Show unsent stays in the app and opens the list; Escape just stays.
      secondary={
        unsent > 0
          ? {
              label: 'Show unsent',
              data: { 'data-quit-show-unsent': true },
              onSelect: () => {
                cancel();
                requestAnimationFrame(openUnsentList);
              },
            }
          : undefined
      }
      onConfirm={async () => answer('quit')}
      onClose={cancel}
    />
  );
}
