/**
 * Path checks shared by the engine, main and the renderer. Plain TypeScript without `node:path`, so the
 * renderer can use it, and independent of the platform it runs on, so tests on one OS cover the other.
 */

/** `C:\…` or `C:/…`: a path on a drive, as Windows writes absolute paths. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/**
 * Whether `path` looks like an absolute local path on any platform: `/…`, or a drive path (`C:\…`, `C:/…`). A
 * network path (`\\server\share`) and anything relative (`src`, `~/…`, `C:folder`) don't. For telling a folder
 * from other values in the UI; what comes in from outside is checked with `isLocalAbsolutePath`.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || DRIVE_PATH.test(path);
}

/**
 * An absolute path on `platform` itself: a drive path on Windows, `/…` elsewhere. Stricter than `isAbsolutePath`,
 * as `C:\x` on a Mac (or `/x` on Windows, which means the current drive) would be read relative to something.
 */
export function isLocalAbsolutePath(path: string, platform: string): boolean {
  return platform === 'win32' ? DRIVE_PATH.test(path) : path.startsWith('/');
}

/** The separator a path is written with: `\` for a Windows drive path, else `/`. */
export function separatorOf(path: string): '/' | '\\' {
  return DRIVE_PATH.test(path) && path.includes('\\') ? '\\' : '/';
}

/**
 * Whether `path` is the folder `dir` or inside it. Trailing separators don't count. Windows paths compare
 * without regard to case and to the kind of slash, as Windows itself does; others compare exactly.
 */
export function isSameOrInside(path: string, dir: string): boolean {
  const windows = DRIVE_PATH.test(dir);
  const norm = (p: string) => {
    const trimmed = p.replace(/[\\/]+$/, '');
    return windows ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed;
  };
  const base = norm(dir);
  const other = norm(path);
  return other === base || other.startsWith(base + (windows ? '\\' : '/'));
}

/** `~/…` (or `~\…`) with the home folder in front, in the home folder's own separator; anything else as it is. */
export function expandHome(path: string, home: string | null): string {
  if (!home || !/^~(?=[\\/]|$)/.test(path)) return path;
  const sep = separatorOf(home);
  return home + path.slice(1).replace(/[\\/]/g, sep);
}
