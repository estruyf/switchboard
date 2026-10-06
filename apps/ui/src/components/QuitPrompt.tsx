import { useEffect, useRef, useState } from 'react';
import { isActiveHost, useHosts } from '../state/hostsStore.ts';
import { useTerminals } from '../state/terminalsStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
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

  return (
    <ConfirmDialog
      title="Quit Switchboard?"
      body={
        <>
          {impact && <p>{impact}</p>}
          <p className={impact ? 'mt-2' : undefined}>
            Press <Kbd keys="⌘Q" /> again to quit.
          </p>
        </>
      }
      confirmLabel="Quit"
      onConfirm={async () => answer('quit')}
      onClose={() => {
        answer('cancel');
        setOpen(false);
      }}
    />
  );
}
