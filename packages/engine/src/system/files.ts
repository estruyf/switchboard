import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_FILES = 50_000;
const CACHE_MS = 30_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.turbo', '.cache', 'coverage', '.venv', '__pycache__']);

function gitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 5000 },
      (error, stdout) => resolve(error ? null : stdout.split('\0').filter(Boolean).slice(0, MAX_FILES)),
    );
  });
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 8 || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(relative(root, full));
      }
    }
  };
  visit(root, 0);
  return out;
}

/**
 * Scores `path` against `query` as a subsequence match. Higher is better;
 * null means no match. Basename hits, consecutive runs and segment starts win.
 */
export function fuzzyScore(path: string, query: string): number | null {
  if (!query) return 0;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (base === q) return 1000;
  if (base.startsWith(q)) return 800 - base.length;
  if (p.includes(q)) return 600 - p.length;
  let score = 0;
  let pi = 0;
  let run = 0;
  for (const ch of q) {
    const found = p.indexOf(ch, pi);
    if (found === -1) return null;
    run = found === pi ? run + 1 : 0;
    score += 1 + run * 2 + (found === 0 || p[found - 1] === '/' || p[found - 1] === '-' || p[found - 1] === '_' ? 3 : 0);
    pi = found + 1;
  }
  return score - p.length * 0.01;
}

/** File lists per folder for @-mentions; git-aware, cached briefly so typing stays instant. */
export class FileIndex {
  private readonly cache = new Map<string, { at: number; files: Promise<string[]> }>();

  private list(cwd: string): Promise<string[]> {
    const hit = this.cache.get(cwd);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
    const files = gitFiles(cwd).then((git) => git ?? walk(cwd));
    this.cache.set(cwd, { at: Date.now(), files });
    return files;
  }

  async search(cwd: string, query: string, limit: number): Promise<string[]> {
    const files = await this.list(cwd);
    const scored: Array<{ path: string; score: number }> = [];
    for (const path of files) {
      const score = fuzzyScore(path, query.trim());
      if (score !== null) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return scored.slice(0, limit).map((s) => s.path);
  }
}
