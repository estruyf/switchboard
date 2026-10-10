import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  countLines,
  memoryFileText,
  memoryIndexLine,
  parseSections,
  RpcError,
  sameHeading,
  sectionBody,
  slugify,
  splitFrontmatter,
  type MemoryList,
  type SectionCopy,
  type SharePreview,
  type ShareTarget,
  type ShareWarning,
} from '@switchboard/protocol';
import { git } from '../git/gitChanges.ts';
import { ignoredPaths, isInside, listInstructionFiles, listMemoryFiles, memoryDirFor } from './folders.ts';
import { findSecrets } from './secrets.ts';
import { appendIndexLine, containsText, placeSection, removeIndexLine, restoreIndexLine, rulePathsFrontmatter, shareBody, unifiedDiff } from './textEdit.ts';

/** Where a memory file may go to the Trash: its own memory folder, or (undoing a new instruction file) the project. */
export type MemoryTrashScope = { memoryDir: string } | { instructionsRoot: string };

export interface MemoryServiceOptions {
  /** The config folders of every Claude profile, the project's own profile first. */
  configDirs(root: string): string[];
  /** The main repository a project's folder belongs to (a worktree's, or the folder itself outside git). */
  repoRoot?(root: string): string;
  trash(paths: string[], scope: MemoryTrashScope): Promise<void>;
}

export interface ShareRequest {
  root: string;
  memoryPath: string;
  target: ShareTarget;
  heading: string;
  placement: 'add' | 'replace';
}

/** What `memory.undoShare` needs to put the last share back. */
interface UndoRecord {
  token: string;
  root: string;
  targetPath: string;
  /** The target before the share; null when the share made it. */
  before: string | null;
  after: string;
  memory: { path: string; content: string; index: { path: string; line: string; at: number } | null } | null;
}

const MEMORY_INDEX = 'MEMORY.md';
/** A rule's name: folders and a file name of letters, digits, `.`, `_` and `-` (no `..`). */
const RULE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * A project's memory and instructions: reading them, sharing a memory into the instructions (with a preview and an
 * undo), and copying a section of the instructions into memory. It writes only inside the project and its memory
 * folders, and never runs a git command that changes anything.
 */
export class MemoryService {
  private last: UndoRecord | null = null;

  constructor(private readonly options: MemoryServiceOptions) {}

  /** The project's memory folders, one per profile, the project's own profile first (whether they exist or not). */
  dirs(root: string): string[] {
    const repoRoot = this.options.repoRoot?.(root) ?? root;
    return [...new Set(this.options.configDirs(root).map((configDir) => resolve(memoryDirFor(configDir, root, repoRoot))))];
  }

  async list(root: string): Promise<MemoryList> {
    const dirs = this.dirs(root);
    const memories = dirs.flatMap((dir) => listMemoryFiles(dir)).sort((a, b) => b.modified - a.modified);
    const home = dirs[0] ?? null;
    const index = home ? readText(join(home, MEMORY_INDEX)) : null;
    return { memoryDir: home, memories, instructions: await listInstructionFiles(root), indexLines: index ? countLines(index) : 0 };
  }

  /** A file inside the project or one of its memory folders, without following a link out of them. */
  read(root: string, path: string): string {
    const real = this.realOrNull(path);
    const allowed = [root, ...this.dirs(root)].map((dir) => this.realOrNull(dir)).filter((dir): dir is string => dir !== null);
    if (!real || !allowed.some((dir) => isInside(dir, real))) throw new RpcError('FORBIDDEN', 'Only memory and instruction files of this project can be read here');
    const content = readText(real);
    if (content === null) throw new RpcError('NOT_FOUND', `${basename(path)} can't be read`);
    return content;
  }

  async sharePreview(request: ShareRequest): Promise<SharePreview> {
    return (await this.plan(request)).preview;
  }

  async share(request: ShareRequest & { removeMemory: boolean; secretsChecked: boolean }): Promise<{ targetPath: string; removed: boolean; undoToken: string }> {
    const { preview, memoryContent } = await this.plan(request);
    const kinds = new Set(preview.warnings.map((w) => w.kind));
    if (kinds.has('alreadyThere')) throw new RpcError('ALREADY_THERE', `This text is in ${basename(preview.targetPath)} already`);
    if (kinds.has('secrets') && !request.secretsChecked) throw new RpcError('SECRETS', 'The text looks like it holds a secret; check it first');
    // Checked again right before writing: a folder could have been swapped for a link since the preview.
    this.assertWritable(request.root, preview.targetPath);
    mkdirSync(dirname(preview.targetPath), { recursive: true });
    writeFileSync(preview.targetPath, preview.after);
    let memory: UndoRecord['memory'] = null;
    if (request.removeMemory) {
      try {
        await this.options.trash([request.memoryPath], { memoryDir: dirname(request.memoryPath) });
      } catch (error) {
        // The share is all or nothing: put the target back.
        writeFileSync(preview.targetPath, preview.before);
        throw new RpcError('TRASH_FAILED', `Couldn't move the memory to the Trash: ${(error as Error).message}`);
      }
      const indexPath = join(dirname(request.memoryPath), MEMORY_INDEX);
      const index = readText(indexPath);
      const removed = index === null ? null : removeIndexLine(index, basename(request.memoryPath));
      if (removed) writeFileSync(indexPath, removed.text);
      memory = { path: request.memoryPath, content: memoryContent, index: removed ? { path: indexPath, line: removed.line, at: removed.at } : null };
    }
    const undoToken = randomUUID();
    this.last = { token: undoToken, root: request.root, targetPath: preview.targetPath, before: preview.exists ? preview.before : null, after: preview.after, memory };
    return { targetPath: preview.targetPath, removed: memory !== null, undoToken };
  }

  /** Puts the last share back. Returns the project it was in. */
  async undoShare(token: string): Promise<string> {
    const record = this.last;
    if (!record || record.token !== token) throw new RpcError('EXPIRED', 'Only the last share can be undone');
    const name = basename(record.targetPath);
    if (readText(record.targetPath) !== record.after) throw new RpcError('CHANGED', `${name} changed since; undo it there by hand`);
    if (record.memory && existsSync(record.memory.path)) throw new RpcError('CHANGED', `There is a new ${basename(record.memory.path)} in memory; nothing was undone`);
    this.assertWritable(record.root, record.targetPath);
    if (record.before === null) await this.options.trash([record.targetPath], { instructionsRoot: record.root });
    else writeFileSync(record.targetPath, record.before);
    if (record.memory) {
      mkdirSync(dirname(record.memory.path), { recursive: true });
      writeFileSync(record.memory.path, record.memory.content, { flag: 'wx' });
      const { index } = record.memory;
      if (index) writeFileSync(index.path, restoreIndexLine(readText(index.path) ?? '', index.line, index.at));
    }
    this.last = null;
    return record.root;
  }

  /** Adds CLAUDE.local.md to the project's .gitignore. */
  ignoreLocal(root: string): string {
    const path = join(root, '.gitignore');
    this.assertWritable(root, path);
    const current = readText(path) ?? '';
    const eol = current.includes('\r\n') ? '\r\n' : '\n';
    if (!current.split(/\r?\n/).some((line) => line.trim() === 'CLAUDE.local.md' || line.trim() === '/CLAUDE.local.md')) {
      writeFileSync(path, `${current === '' || current.endsWith('\n') ? current : current + eol}CLAUDE.local.md${eol}`);
    }
    return path;
  }

  /** Copies a section of an instruction file into a new memory (or, `dryRun`, says what it would write). */
  async createFromSection(params: { root: string; file: string; heading: string; name: string; type: string; description: string; dryRun: boolean }): Promise<SectionCopy> {
    const { instructions } = await this.list(params.root);
    if (!instructions.some((i) => i.path === params.file)) throw new RpcError('FORBIDDEN', 'Only a section of this project’s instructions can be copied');
    const text = this.read(params.root, params.file);
    const section = parseSections(text).find((s) => s.level >= 2 && s.level <= 3 && sameHeading(s.title, params.heading));
    if (!section) throw new RpcError('NOT_FOUND', `There is no section "${params.heading}" in ${basename(params.file)}`);
    const dir = this.dirs(params.root)[0];
    if (!dir) throw new RpcError('NOT_FOUND', 'No memory folder for this project');
    // A name that's taken gets -2, -3, …: an existing memory is never overwritten.
    const base = slugify(params.name);
    let name = base;
    for (let n = 2; existsSync(join(dir, `${name}.md`)) || name === 'MEMORY'; n++) name = `${base}-${n}`;
    const path = join(dir, `${name}.md`);
    const content = memoryFileText({ name, description: params.description, type: slugify(params.type), body: sectionBody(text, section) });
    const indexPath = join(dir, MEMORY_INDEX);
    const indexLine = memoryIndexLine(section.title, `${name}.md`, params.description);
    const index = appendIndexLine(readText(indexPath) ?? '', indexLine);
    if (!params.dryRun) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content, { flag: 'wx' });
      writeFileSync(indexPath, index);
    }
    return { path, name, content, indexLine, indexLines: countLines(index) };
  }

  /** The target file, what it becomes, and the warnings; everything `share` writes comes from here. */
  private async plan(request: ShareRequest): Promise<{ preview: SharePreview; memoryContent: string }> {
    const { root, memoryPath, target, heading, placement } = request;
    this.assertMemoryFile(root, memoryPath);
    const memoryContent = readText(memoryPath);
    if (memoryContent === null) throw new RpcError('NOT_FOUND', `${basename(memoryPath)} is gone`);
    const body = shareBody(splitFrontmatter(memoryContent).body);
    const targetPath = this.targetPath(root, target);
    this.assertWritable(root, targetPath);
    const current = readText(targetPath);
    const exists = current !== null;
    const before = current ?? '';
    // A new rule scoped to some paths starts with its frontmatter.
    const base = !exists && target.kind === 'rule' && target.paths?.length ? rulePathsFrontmatter(target.paths) : before;
    const placed = placeSection(base, heading, body, placement);
    const rel = relative(root, targetPath);
    const warnings: ShareWarning[] = [];
    const secrets = findSecrets(`${heading}\n${body}`);
    if (secrets.length) warnings.push({ kind: 'secrets', detail: secrets.join(', ') });
    if (containsText(before, body)) warnings.push({ kind: 'alreadyThere', detail: null });
    else if (placed.sameHeading) warnings.push({ kind: 'sameHeading', detail: heading });
    if (target.kind === 'local' && (await this.isRepo(root)) && !(await ignoredPaths(root, [targetPath])).has(targetPath)) warnings.push({ kind: 'localNotIgnored', detail: null });
    if (exists && (await this.isDirty(root, rel))) warnings.push({ kind: 'targetDirty', detail: rel });
    return {
      preview: { targetPath, exists, before, after: placed.after, diff: unifiedDiff(before, placed.after, rel, !exists), warnings },
      memoryContent,
    };
  }

  private targetPath(root: string, target: ShareTarget): string {
    if (target.kind === 'local') return join(root, 'CLAUDE.local.md');
    if (target.kind === 'claude-md') {
      const atRoot = join(root, 'CLAUDE.md');
      const inClaude = join(root, '.claude', 'CLAUDE.md');
      return existsSync(atRoot) || !existsSync(inClaude) ? atRoot : inClaude;
    }
    const file = target.file.trim().replace(/\.md$/i, '');
    if (!RULE_NAME.test(file) || file.split('/').some((part) => part === '..' || part === '.')) throw new RpcError('INVALID', 'A rule’s name can only have letters, digits, “.”, “_”, “-” and “/”');
    return join(root, '.claude', 'rules', `${file}.md`);
  }

  /** A memory file of this project: a `.md` file (not MEMORY.md) right inside one of its memory folders, not a link. */
  private assertMemoryFile(root: string, path: string): void {
    const dirs = this.dirs(root);
    const ok = resolve(path) === path && path.endsWith('.md') && basename(path) !== MEMORY_INDEX && dirs.includes(dirname(path));
    if (!ok || !lstatSync(path, { throwIfNoEntry: false })?.isFile()) throw new RpcError('FORBIDDEN', 'That isn’t one of this project’s memories');
  }

  /**
   * A file the share may write: inside the project once every folder on the way is resolved, and not itself a link.
   * Folders that don't exist yet are made later, under the deepest one that does (checked here).
   */
  private assertWritable(root: string, path: string): void {
    const realRoot = this.realOrNull(root);
    if (!realRoot || resolve(path) !== path || !isInside(root, path)) throw new RpcError('FORBIDDEN', 'Switchboard only writes inside the project');
    let existing = dirname(path);
    while (!existsSync(existing) && isInside(root, existing) && existing !== root) existing = dirname(existing);
    const real = this.realOrNull(existing);
    if (!real || !isInside(realRoot, real)) throw new RpcError('FORBIDDEN', `${relative(root, path)} leads outside the project`);
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new RpcError('FORBIDDEN', `${relative(root, path)} is a link; Switchboard doesn’t write through it`);
  }

  private realOrNull(path: string): string | null {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  }

  private async isRepo(root: string): Promise<boolean> {
    return (await git(root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')).trim() === 'true';
  }

  /** Uncommitted changes to the file (staged, unstaged or untracked). */
  private async isDirty(root: string, rel: string): Promise<boolean> {
    if (!(await this.isRepo(root))) return false;
    return (await git(root, ['status', '--porcelain', '--untracked-files=all', '--', rel]).catch(() => '')).trim() !== '';
  }
}
