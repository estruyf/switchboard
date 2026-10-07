import { Kbd } from '../ui/Kbd.tsx';

/** One hint in the footer: keys to press (`⌘↵`, `↑ ↓`), or a prefix character to type (`>`). */
export interface FooterKey {
  keys: string;
  label: string;
  /** A prefix typed into the field, shown as the character in the accent rather than as a key. */
  prefix?: boolean;
}

/** The palette's last row: the keys for the step you are on. */
export function PaletteFooter({ keys }: { keys: FooterKey[] }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-4 overflow-hidden border-t border-edge px-4 text-meta whitespace-nowrap text-muted" data-palette-footer>
      {keys.map(({ keys: k, label, prefix }) => (
        <span key={`${k}${label}`} className="flex items-center gap-1.5">
          {prefix ? (
            <span aria-hidden className="font-mono font-semibold text-accent-ink">
              {k}
            </span>
          ) : (
            k.split(' ').map((part) => <Kbd key={part} keys={part} />)
          )}
          {label}
        </span>
      ))}
    </div>
  );
}
