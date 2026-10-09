import { PencilLine } from 'lucide-react';
import { openDraft, useUnsent } from '../drafts/useUnsent.ts';
import { UnsentRowContent } from '../drafts/UnsentList.tsx';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';

/** Home's Unsent: every message you typed and didn't send, newest first, each with Open (the caret lands at its end). */
export function UnsentCard({ now }: { now: number }) {
  const entries = useUnsent();
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="home-unsent" className="grid gap-1 rounded-xl border border-border bg-card p-3" data-home-unsent>
      <SectionHeader as="h2" headingId="home-unsent" count={entries.length} className="px-1 pb-1">
        <PencilLine size={12} className="shrink-0" aria-hidden />
        Unsent
      </SectionHeader>
      <ul className="grid gap-0.5">
        {entries.map((entry) => (
          <li key={entry.item.key} className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1.5" data-home-unsent-item={entry.item.key}>
            <UnsentRowContent entry={entry} now={now} />
            <Button onClick={() => openDraft(entry.item)} aria-label={`Open ${entry.title}`} className="shrink-0" data-home-unsent-open>
              Open
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
