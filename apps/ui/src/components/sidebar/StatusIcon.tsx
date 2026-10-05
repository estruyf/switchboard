import type { RowStatus } from '../../state/sidebarRows.ts';

export const STATUS_LABEL: Record<Exclude<RowStatus, null>, string> = {
  'needs-you': 'Waiting for you',
  running: 'Claude is working',
  error: 'Last run failed',
  unread: 'New activity since you last looked',
  idle: 'Open and ready',
};

/**
 * One glance per session: a spinning ring while Claude works, a pulsing amber
 * dot when it waits for you, red when it failed, accent for unread, green when
 * open and idle. Nothing for settled, read sessions.
 */
export function StatusIcon({ status }: { status: RowStatus }) {
  if (!status) return <span className="size-3.5 shrink-0" aria-hidden />;
  const label = STATUS_LABEL[status];
  switch (status) {
    case 'running':
      return (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-accent/25 border-t-accent" title={label} aria-label={label} />
      );
    case 'needs-you':
      return (
        <span className="relative flex size-3.5 shrink-0 items-center justify-center" title={label} aria-label={label}>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-warn opacity-60" />
          <span className="relative size-2 rounded-full bg-warn" />
        </span>
      );
    case 'error':
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-error text-[9px] font-bold text-white" title={label} aria-label={label}>
          !
        </span>
      );
    case 'unread':
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center" title={label} aria-label={label}>
          <span className="size-2 rounded-full bg-accent" />
        </span>
      );
    case 'idle':
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center" title={label} aria-label={label}>
          <span className="size-2 rounded-full border-[1.5px] border-ok" />
        </span>
      );
  }
}
