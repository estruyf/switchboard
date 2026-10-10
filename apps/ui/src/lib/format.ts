const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact age for sidebar rows: "now", "5m", "3h", "2d", "Sep 21", "Sep 21, 2025". */
export function shortAge(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** How long ago, for a line of text: "now", "5m ago", "3d ago", "on Sep 21". */
export function agoText(timestamp: number, now = Date.now()): string {
  const age = shortAge(timestamp, now);
  return age === 'now' ? 'now' : /^\d+[mhd]$/.test(age) ? `${age} ago` : `on ${age}`;
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
}

/** Shows paths under the home folder as `~/…`. */
export function tildify(path: string, home: string | null): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** Best-effort home folder from the paths we already know (the UI has no Node APIs). */
export function guessHome(paths: Iterable<string>): string | null {
  for (const p of paths) {
    const match = /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(p);
    if (match) return match[1]!;
  }
  return null;
}
