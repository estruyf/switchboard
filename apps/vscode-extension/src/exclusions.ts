/**
 * What you keep from Claude, so the extension never sends the text of those files (a reference is fine: Claude Code
 * applies its own rules when it reads one). Pure, so it can be tested: the extension reads the settings and runs git.
 *
 * - `files.exclude` and `search.exclude` globs, relative to the workspace folder;
 * - `Read(…)` deny rules in Claude Code's settings (`~/.claude/settings.json`, `.claude/settings.json`,
 *   `.claude/settings.local.json`), which follow gitignore's patterns.
 */

/** A glob (`**`, `*`, `?`, `{a,b}`, `[abc]`) as a regular expression over a whole `/`-separated path. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` is any number of folders (none too), a trailing `**` anything at all.
        const slash = glob[i + 2] === '/';
        out += slash ? '(?:[^/]*/)*' : '.*';
        i += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      braces++;
      out += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (c === ',' && braces > 0) out += '|';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) out += '\\[';
      else {
        out += `[${glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else out += /[.+^$()|\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${out}$`);
}

/** Whether a path (relative to the workspace folder) matches one of VS Code's exclude globs that are on. */
export function excludedBy(relativePath: string, globs: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(globs).some(([glob, on]) => {
    if (on !== true) return false;
    const re = globToRegExp(glob);
    // A folder's glob (`**/node_modules`) excludes what is inside it too.
    const parts = relativePath.split('/');
    return parts.some((_, i) => re.test(parts.slice(0, i + 1).join('/')));
  });
}

/** A Claude Code settings file that was read, and where it sits. */
export interface ClaudeSettingsFile {
  /** The folder rules relative to the settings are read from: the project for `.claude/settings*.json`, home for `~/.claude/settings.json`. */
  root: string;
  json: unknown;
}

/** A `Read` deny rule, ready to match absolute paths. */
export interface ReadRule {
  /** Every read is denied (`Read` or `Read(*)` / `Read(**)`). */
  all: boolean;
  match: RegExp | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The `Read(…)` rules in `permissions.deny`, turned into matchers for absolute paths. Like gitignore: `//path` is from
 * the filesystem's root, `~/path` from home, `/path` from the settings' folder, and `path` or `./path` from the
 * workspace folder; a pattern without a `/` matches at any depth.
 */
export function readRules(files: readonly ClaudeSettingsFile[], workspace: string, home: string): ReadRule[] {
  const rules: ReadRule[] = [];
  for (const file of files) {
    const deny = isRecord(file.json) && isRecord(file.json.permissions) ? file.json.permissions.deny : undefined;
    if (!Array.isArray(deny)) continue;
    for (const entry of deny) {
      if (typeof entry !== 'string') continue;
      const rule = /^Read(?:\((.*)\))?$/.exec(entry.trim());
      if (!rule) continue;
      const pattern = rule[1]?.trim() ?? '';
      if (pattern === '' || pattern === '*' || pattern === '**') {
        rules.push({ all: true, match: null });
        continue;
      }
      // A trailing `/` only says it's a folder; what is inside a match is covered below anyway.
      const body = pattern.replace(/\/+$/, '');
      let anchored: string;
      if (body.startsWith('//')) anchored = body.slice(1);
      else if (body.startsWith('~/')) anchored = `${home}/${body.slice(2)}`;
      else if (body.startsWith('/')) anchored = `${file.root}${body}`;
      else if (body.startsWith('./')) anchored = `${workspace}/${body.slice(2)}`;
      else anchored = body.includes('/') ? `${workspace}/${body}` : `${workspace}/**/${body}`;
      // What is inside a denied folder is denied too.
      rules.push({ all: false, match: globToRegExp(`${anchored.replace(/\/+$/, '')}{,/**}`) });
    }
  }
  return rules;
}

/** Whether a `Read` deny rule keeps this file from Claude. */
export const deniedByRead = (path: string, rules: readonly ReadRule[]) => rules.some((rule) => rule.all || (rule.match?.test(path) ?? false));
