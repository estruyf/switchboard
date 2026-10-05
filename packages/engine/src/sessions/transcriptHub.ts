import type { LogLevel, TranscriptMessage, TranscriptUpdate } from '@switchboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import { normaliseMessage } from '../claude/transcript.ts';
import { coalesce } from '../util/coalesce.ts';

interface Watcher {
  /** UUIDs this watcher has already been sent, in order; null until the initial load is sent. */
  uuids: string[] | null;
  /** A change arrived while the initial load was in flight. */
  dirty: boolean;
  emit: (update: TranscriptUpdate) => void;
}

/** Works out the smallest update that brings a watcher from `sent` to `next`. */
export function diffTranscript(sent: readonly string[], next: readonly TranscriptMessage[]): Pick<TranscriptUpdate, 'mode' | 'messages'> | null {
  const isPrefix = next.length >= sent.length && sent.every((uuid, i) => next[i]!.uuid === uuid);
  if (!isPrefix) return { mode: 'replace', messages: [...next] };
  if (next.length === sent.length) return null;
  return { mode: 'append', messages: next.slice(sent.length) };
}

/**
 * Live transcripts for open windows. Each watcher gets the full transcript
 * once, then only appended messages (or a replace after a rewind/compaction).
 */
export class TranscriptHub {
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly reloads = new Map<string, ReturnType<typeof coalesce>>();

  constructor(
    private readonly source: SessionSource,
    private readonly log: (level: LogLevel, message: string) => void,
  ) {}

  async read(sessionId: string): Promise<TranscriptMessage[]> {
    return (await this.source.messages(sessionId)).map(normaliseMessage);
  }

  /** Starts sending `transcript.updated` for a session; the first update is a full `replace`. */
  watch(sessionId: string, emit: Watcher['emit']): () => void {
    const watcher: Watcher = { uuids: null, dirty: false, emit };
    let set = this.watchers.get(sessionId);
    if (!set) this.watchers.set(sessionId, (set = new Set()));
    set.add(watcher);
    void this.push(sessionId, [watcher], true);
    return () => {
      set.delete(watcher);
      if (set.size === 0) {
        this.watchers.delete(sessionId);
        this.reloads.get(sessionId)?.stop();
        this.reloads.delete(sessionId);
      }
    };
  }

  /** Called when a transcript file changed on disk. Reloads are coalesced per session. */
  changed(sessionId: string): void {
    if (!this.watchers.has(sessionId)) return;
    let reload = this.reloads.get(sessionId);
    if (!reload) {
      reload = coalesce(() => this.push(sessionId, [...(this.watchers.get(sessionId) ?? [])], false), 100);
      this.reloads.set(sessionId, reload);
    }
    reload.trigger();
  }

  private async push(sessionId: string, targets: Watcher[], initial: boolean): Promise<void> {
    if (targets.length === 0) return;
    let messages: TranscriptMessage[];
    try {
      messages = await this.read(sessionId);
    } catch (error) {
      this.log('warn', `Reading transcript ${sessionId} failed: ${(error as Error).message}`);
      // Let later file changes deliver the whole transcript as an append.
      if (initial) for (const watcher of targets) watcher.uuids ??= [];
      return;
    }
    for (const watcher of targets) {
      if (!initial && watcher.uuids === null) {
        // Its initial load is still in flight; let that finish first, then catch up.
        watcher.dirty = true;
        continue;
      }
      const diff = initial ? { mode: 'replace' as const, messages } : diffTranscript(watcher.uuids!, messages);
      if (!diff) continue;
      watcher.uuids = messages.map((m) => m.uuid);
      watcher.emit({ sessionId, ...diff });
      if (initial && watcher.dirty) {
        watcher.dirty = false;
        this.changed(sessionId);
      }
    }
  }

  stop(): void {
    for (const reload of this.reloads.values()) reload.stop();
    this.reloads.clear();
    this.watchers.clear();
  }
}
