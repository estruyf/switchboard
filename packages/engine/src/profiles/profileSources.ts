import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';

export interface ProfileSource {
  profileId: string;
  source: SessionSource;
}

/**
 * Sessions from every profile's config folder as one source. Each session is read through the
 * profile it was found in; a session not seen yet (just created) is looked up in each in turn.
 */
export class MultiProfileSource implements SessionSource {
  private readonly owners = new Map<string, string>();

  constructor(private readonly sources: () => ProfileSource[]) {}

  /** The profile a session was last found in. */
  ownerOf(sessionId: string): string | undefined {
    return this.owners.get(sessionId);
  }

  async list(): Promise<RawSessionInfo[]> {
    const lists = await Promise.all(this.sources().map(async ({ profileId, source }) => (await source.list()).map((info) => ({ ...info, profileId }))));
    const all = lists.flat();
    for (const info of all) this.owners.set(info.sessionId, info.profileId);
    return all;
  }

  async info(sessionId: string): Promise<RawSessionInfo | undefined> {
    for (const { profileId, source } of this.ordered(sessionId)) {
      const info = await source.info(sessionId).catch(() => undefined);
      if (info) {
        this.owners.set(sessionId, profileId);
        return { ...info, profileId };
      }
    }
    return undefined;
  }

  async messages(sessionId: string): Promise<RawSessionMessage[]> {
    for (const { profileId, source } of this.ordered(sessionId)) {
      const messages = await source.messages(sessionId).catch(() => []);
      if (messages.length) {
        this.owners.set(sessionId, profileId);
        return messages;
      }
    }
    return [];
  }

  async subagentMessages(sessionId: string, agentId: string): Promise<RawSessionMessage[]> {
    const { source } = this.ordered(sessionId)[0] ?? {};
    return source?.subagentMessages ? source.subagentMessages(sessionId, agentId) : [];
  }

  async fork(sessionId: string, upToMessageId: string): Promise<string> {
    const owner = this.ordered(sessionId)[0];
    if (!owner?.source.fork) throw new Error('Forking is not available');
    const forked = await owner.source.fork(sessionId, upToMessageId);
    // The copy lands in the same config folder, so it belongs to the same profile.
    this.owners.set(forked, owner.profileId);
    return forked;
  }

  /** The owning profile's source first, then the others. */
  private ordered(sessionId: string): ProfileSource[] {
    const owner = this.owners.get(sessionId);
    const all = this.sources();
    return owner ? [...all.filter((s) => s.profileId === owner), ...all.filter((s) => s.profileId !== owner)] : all;
  }
}
