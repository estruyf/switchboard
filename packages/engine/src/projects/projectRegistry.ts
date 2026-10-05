import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { RpcError, type ProjectIcon, type ProjectIconChoice, type ProjectInfo } from '@switchboard/protocol';
import { detectIconPath, iconDataUrl, MAX_ICON_BYTES } from './projectIcons.ts';

type StoredIcon = { kind: 'emoji'; value: string } | { kind: 'file'; path: string } | { kind: 'none' };

/**
 * Projects the user sees: every folder with sessions plus folders added by
 * hand, each with an icon (custom, detected, or none → the UI draws a letter).
 */
export class ProjectRegistry {
  private readonly detected = new Map<string, { at: number; path: string | null }>();
  private readonly statements;

  constructor(
    private readonly db: DatabaseSync,
    private readonly iconDir: string,
  ) {
    this.statements = {
      all: db.prepare('SELECT root, icon_json, added_at FROM project_settings'),
      get: db.prepare('SELECT icon_json, added_at FROM project_settings WHERE root = ?'),
      upsertIcon: db.prepare(
        'INSERT INTO project_settings (root, icon_json) VALUES (?, ?) ON CONFLICT (root) DO UPDATE SET icon_json = excluded.icon_json',
      ),
      add: db.prepare('INSERT INTO project_settings (root, added_at) VALUES (?, ?) ON CONFLICT (root) DO UPDATE SET added_at = excluded.added_at'),
      unadd: db.prepare('UPDATE project_settings SET added_at = NULL WHERE root = ?'),
    };
  }

  /** Folders added by hand (they show up even without sessions). */
  addedRoots(): string[] {
    return (this.statements.all.all() as Array<{ root: string; added_at: number | null }>).filter((r) => r.added_at !== null).map((r) => r.root);
  }

  list(sessionRoots: Iterable<string>): ProjectInfo[] {
    const added = new Set(this.addedRoots());
    const roots = new Set([...sessionRoots, ...added]);
    return [...roots].filter((r) => r.startsWith('/')).map((root) => this.describe(root, added.has(root)));
  }

  add(path: string): void {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new RpcError('NOT_FOUND', `Not a folder: ${path}`);
    this.statements.add.run(path, Date.now());
  }

  remove(root: string): void {
    this.statements.unadd.run(root);
  }

  setIcon(root: string, choice: ProjectIconChoice): void {
    let stored: StoredIcon | null;
    switch (choice.kind) {
      case 'auto':
        stored = null;
        break;
      case 'none':
        stored = { kind: 'none' };
        break;
      case 'emoji':
        stored = { kind: 'emoji', value: choice.value };
        break;
      case 'file': {
        const stat = statSync(choice.path, { throwIfNoEntry: false });
        if (!stat?.isFile()) throw new RpcError('NOT_FOUND', `Not a file: ${choice.path}`);
        if (stat.size > MAX_ICON_BYTES) throw new RpcError('TOO_LARGE', 'Icons must be 200 KB or smaller');
        // Copy it in, so the icon survives the original being moved or deleted.
        mkdirSync(this.iconDir, { recursive: true });
        const target = join(this.iconDir, `${createHash('sha1').update(root).digest('hex').slice(0, 16)}${extname(choice.path).toLowerCase()}`);
        copyFileSync(choice.path, target);
        if (!iconDataUrl(target)) throw new RpcError('UNSUPPORTED', 'Use an SVG, PNG, ICO, JPEG, WebP or GIF image');
        stored = { kind: 'file', path: target };
        break;
      }
    }
    this.statements.upsertIcon.run(root, stored ? JSON.stringify(stored) : null);
  }

  private describe(root: string, added: boolean): ProjectInfo {
    const row = this.statements.get.get(root) as { icon_json: string | null } | undefined;
    const stored = row?.icon_json ? (JSON.parse(row.icon_json) as StoredIcon) : null;
    let icon: ProjectIcon | null = null;
    let iconSource: ProjectInfo['iconSource'] = null;
    if (stored?.kind === 'emoji') {
      icon = { kind: 'emoji', value: stored.value };
      iconSource = 'custom';
    } else if (stored?.kind === 'file') {
      icon = iconDataUrl(stored.path);
      iconSource = icon ? 'custom' : null;
    } else if (!stored) {
      const path = this.detect(root);
      icon = path ? iconDataUrl(path) : null;
      iconSource = icon ? 'detected' : null;
    }
    return { root, name: basename(root) || root, icon, iconSource, added, exists: existsSync(root) };
  }

  /** Detection is a handful of stat calls; cache it briefly so listing stays instant. */
  private detect(root: string): string | null {
    const hit = this.detected.get(root);
    if (hit && Date.now() - hit.at < 60_000) return hit.path;
    const path = existsSync(root) ? detectIconPath(root) : null;
    this.detected.set(root, { at: Date.now(), path });
    return path;
  }
}
