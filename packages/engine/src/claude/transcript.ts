import type { TranscriptBlock, TranscriptMessage } from '@switchboard/protocol';

/** The subset of the SDK's SessionMessage we rely on (plus `timestamp`, present at runtime). */
export interface RawSessionMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  message: unknown;
  parent_tool_use_id: string | null;
  timestamp?: string;
}

export const LIMITS = {
  /** Assistant/user prose is kept almost whole. */
  text: 200_000,
  /** Tool output is the bulk of large transcripts; the viewer only needs a preview. */
  toolResult: 8_000,
  /** Per string inside a tool input (e.g. the content of a Write). */
  toolInputString: 4_000,
} as const;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

/** Deep-copies a JSON value, shortening long strings. */
export function clipJson(value: unknown, maxString: number): { value: Json; truncated: boolean } {
  let truncated = false;
  const walk = (v: unknown, depth: number): Json => {
    if (typeof v === 'string') {
      if (v.length <= maxString) return v;
      truncated = true;
      return v.slice(0, maxString);
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean' || v === null) return v;
    if (depth > 20) {
      truncated = true;
      return null;
    }
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    if (typeof v === 'object') {
      const out: { [key: string]: Json } = {};
      for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
        if (item !== undefined) out[key] = walk(item, depth + 1);
      }
      return out;
    }
    return null;
  };
  return { value: walk(value, 0), truncated };
}

type RawBlock = { type?: unknown; [key: string]: unknown };

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: RawBlock) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : part?.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function normaliseBlock(block: RawBlock): TranscriptBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: clip(String(block.text ?? ''), LIMITS.text).text };
    case 'thinking':
      return { type: 'thinking', text: clip(String(block.thinking ?? ''), LIMITS.text).text };
    case 'redacted_thinking':
      return { type: 'thinking', text: '' };
    case 'tool_use':
    case 'server_tool_use':
    case 'mcp_tool_use': {
      const { value, truncated } = clipJson(block.input ?? {}, LIMITS.toolInputString);
      return { type: 'tool_use', id: String(block.id ?? ''), name: String(block.name ?? 'unknown'), input: value, truncated };
    }
    case 'tool_result':
    case 'mcp_tool_result': {
      const { text, truncated } = clip(toolResultText(block.content), LIMITS.toolResult);
      return { type: 'tool_result', toolUseId: String(block.tool_use_id ?? ''), isError: block.is_error === true, text, truncated };
    }
    case 'image': {
      const source = block.source as { media_type?: unknown } | undefined;
      return { type: 'image', mediaType: typeof source?.media_type === 'string' ? source.media_type : null };
    }
    default:
      return { type: 'unknown', kind: typeof block.type === 'string' ? block.type : 'unknown' };
  }
}

function contentBlocks(message: unknown): TranscriptBlock[] {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content ? [{ type: 'text', text: clip(content, LIMITS.text).text }] : [];
  if (Array.isArray(content)) return content.filter((b) => b && typeof b === 'object').map((b) => normaliseBlock(b as RawBlock));
  return [];
}

/** Converts an SDK session message into the renderer-friendly, size-bounded shape. */
export function normaliseMessage(raw: RawSessionMessage): TranscriptMessage {
  const timestamp = raw.timestamp ? Date.parse(raw.timestamp) : NaN;
  const model = (raw.message as { model?: unknown } | null)?.model;
  let blocks = contentBlocks(raw.message);
  if (raw.type === 'system' && blocks.length === 0) {
    const subtype = (raw.message as { subtype?: unknown } | null)?.subtype;
    blocks = [{ type: 'unknown', kind: typeof subtype === 'string' ? subtype : 'system' }];
  }
  return {
    uuid: raw.uuid,
    role: raw.type,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    parentToolUseId: raw.parent_tool_use_id ?? null,
    model: typeof model === 'string' ? model : null,
    blocks,
  };
}
