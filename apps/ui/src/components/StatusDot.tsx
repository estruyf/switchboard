import type { LiveSession } from '@switchboard/protocol/client';

const label: Record<LiveSession['status'], string> = {
  running: 'Claude is working',
  'needs-you': 'Waiting for you',
  idle: 'Open, idle',
};

/** Live state of a session: pulsing while working, amber when it needs you, green when open and idle. */
export function StatusDot({ live, className = '' }: { live: LiveSession | null; className?: string }) {
  if (!live) return <span className={`inline-block size-2 shrink-0 ${className}`} aria-hidden />;
  const tone = live.status === 'running' ? 'bg-accent animate-pulse' : live.status === 'needs-you' ? 'bg-warn' : 'bg-ok';
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${tone} ${className}`}
      title={`${label[live.status]} (${live.rawStatus})`}
      aria-label={label[live.status]}
    />
  );
}

export const liveLabel = (live: LiveSession) => label[live.status];
