import type { ImageRef, TranscriptMessage } from '@switchboard/protocol/client';

export interface ToolResultView {
  text: string;
  isError: boolean;
  truncated: boolean;
  images: ImageRef[];
}

export type DisplayItem =
  | { kind: 'user'; key: string; text: string; images: ImageRef[]; subagent: boolean }
  | { kind: 'command'; key: string; name: string; args: string }
  | { kind: 'text'; key: string; text: string; subagent: boolean }
  | { kind: 'thinking'; key: string; text: string }
  | {
      kind: 'tool';
      key: string;
      id: string;
      name: string;
      input: unknown;
      inputTruncated: boolean;
      result: ToolResultView | null;
      subagent: boolean;
    }
  | { kind: 'notice'; key: string; text: string };

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? null;

const NOTICE_LABELS: Record<string, string> = {
  compact_boundary: 'Conversation compacted',
  informational: 'Information',
};

/** Recognises the markup Claude Code writes into user turns (slash commands, command output, interrupts). */
function userTextItem(text: string, key: string, subagent: boolean, images: ImageRef[]): DisplayItem | null {
  const name = tag(text, 'command-name');
  if (name) return { kind: 'command', key, name: name.startsWith('/') ? name : `/${name}`, args: tag(text, 'command-args') ?? '' };
  const stdout = tag(text, 'local-command-stdout');
  if (stdout !== null) return stdout ? { kind: 'notice', key, text: stdout } : null;
  if (/^\[Request interrupted by user/.test(text)) return { kind: 'notice', key, text: 'Interrupted by you' };
  const cleaned = text.replace(SYSTEM_REMINDER, '').trim();
  if (!cleaned && images.length === 0) return null;
  return { kind: 'user', key, text: cleaned, images, subagent };
}

/**
 * Turns transcript messages into the items the viewer renders: tool calls are
 * paired with their results (matched by id), and user turns that only carry
 * tool results disappear into those cards.
 */
export function buildDisplayItems(messages: readonly TranscriptMessage[]): DisplayItem[] {
  const results = new Map<string, ToolResultView>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_result') results.set(block.toolUseId, { text: block.text, isError: block.isError, truncated: block.truncated, images: block.images ?? [] });
    }
  }

  const items: DisplayItem[] = [];
  for (const message of messages) {
    const subagent = message.parentToolUseId !== null;
    if (message.role === 'user') {
      const texts = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []));
      const images = message.blocks.flatMap((b) => (b.type === 'image' && b.ref ? [b.ref] : []));
      if (texts.length === 0 && images.length === 0) continue;
      const item = userTextItem(texts.join('\n\n'), message.uuid, subagent, images);
      if (item) items.push(item);
      continue;
    }

    if (message.role === 'system') {
      for (const [i, block] of message.blocks.entries()) {
        const key = `${message.uuid}:${i}`;
        if (block.type === 'text') items.push({ kind: 'notice', key, text: block.text });
        else if (block.type === 'unknown') items.push({ kind: 'notice', key, text: NOTICE_LABELS[block.kind] ?? block.kind.replace(/_/g, ' ') });
      }
      continue;
    }

    for (const [i, block] of message.blocks.entries()) {
      const key = `${message.uuid}:${i}`;
      switch (block.type) {
        case 'text':
          if (block.text.trim()) items.push({ kind: 'text', key, text: block.text, subagent });
          break;
        case 'thinking':
          if (block.text.trim()) items.push({ kind: 'thinking', key, text: block.text });
          break;
        case 'tool_use':
          items.push({
            kind: 'tool',
            key,
            id: block.id,
            name: block.name,
            input: block.input,
            inputTruncated: block.truncated,
            result: results.get(block.id) ?? null,
            subagent,
          });
          break;
        default:
          break;
      }
    }
  }
  return items;
}
