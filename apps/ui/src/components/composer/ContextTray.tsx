import { FileText, Folder, ScrollText, SquareTerminal, TextQuote, TextSelect, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ContextItem } from '@switchboard/protocol/client';
import { chipLabel, type ContextChip } from './contextItems.ts';

const TEXT_ICON: Record<Extract<ContextItem, { kind: 'text' }>['source'], LucideIcon> = {
  selection: TextQuote,
  problems: TriangleAlert,
  terminal: SquareTerminal,
  output: ScrollText,
};

const iconFor = (item: ContextItem): LucideIcon => (item.kind === 'text' ? TEXT_ICON[item.source] : item.directory ? Folder : item.range ? TextSelect : FileText);

/**
 * The context tray: files, lines and text added to the message, as removable chips above it. Nothing goes to Claude
 * until you send; files go as references (Claude reads them), text as it is.
 */
export function ContextTray({ chips, cwd, onRemove, className = '' }: { chips: readonly ContextChip[]; cwd: string | null; onRemove(id: string): void; className?: string }) {
  if (chips.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Context" data-context-tray>
      {chips.map((chip) => {
        const { label, detail } = chipLabel(chip, cwd);
        const Icon = iconFor(chip);
        return (
          <li
            key={chip.id}
            className="flex h-6 max-w-72 min-w-0 items-center gap-1 rounded-md border border-border bg-border/30 pl-1.5 text-ui text-text"
            data-context-chip={chip.kind === 'file' ? (chip.directory ? 'folder' : 'file') : chip.source}
            data-tooltip={detail}
          >
            <Icon size={12} className="shrink-0 text-muted" aria-hidden />
            <span className={`min-w-0 truncate ${chip.kind === 'file' ? 'font-mono' : ''}`}>{label}</span>
            <button
              type="button"
              onClick={() => onRemove(chip.id)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border/50 hover:text-text"
              aria-label={`Remove ${label}`}
              data-tooltip="Remove"
              data-context-chip-remove
            >
              <X size={11} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
