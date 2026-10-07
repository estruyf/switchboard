import { Bookmark, X } from 'lucide-react';
import type { LaterItem } from '@switchboard/protocol/client';
import { savedAgo } from '../../state/focus.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { removeFromLater, useLater } from '../../state/laterStore.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';

/** The choices an item starts with, in a few words: "Opus · worktree · saved yesterday". */
export function useLaterMeta(): (item: LaterItem, now: number) => string {
  const models = useHosts((s) => s.models);
  return (item, now) => {
    const model = item.model ? (models.find((m) => m.value === item.model)?.displayName ?? item.model) : null;
    const route = item.workspace === 'worktree' ? 'worktree' : item.branch ? `on ${item.branch}` : 'current checkout';
    return [model, route, `saved ${savedAgo(item.createdAt, now)}`].filter(Boolean).join(' · ');
  };
}

/** "Later in <project>" in New session: the prompts parked for the picked folder, each with Use and ×. */
export function LaterSection({ cwd, projectName, now }: { cwd: string; projectName: string; now: number }) {
  const items = useLater((s) => s.items).filter((item) => item.cwd === cwd);
  const meta = useLaterMeta();
  if (items.length === 0) return null;
  return (
    <section aria-label={`Later in ${projectName}`} data-later-section>
      <SectionHeader as="h2" count={items.length} className="px-2">
        <Bookmark size={12} className="shrink-0" aria-hidden />
        Later in {projectName}
      </SectionHeader>
      <ul className="mt-1 grid">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-border/45" data-later-item={item.id}>
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-ui text-text">{item.prompt}</span>
              <span className="truncate text-meta text-faint">{meta(item, now)}</span>
            </span>
            <Button size="sm" onClick={() => useLater.getState().use(item)} aria-label={`Use “${item.prompt.slice(0, 60)}”`} data-later-use={item.id}>
              Use
            </Button>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={<X size={13} aria-hidden />}
              aria-label="Remove from Later"
              onClick={() => void removeFromLater(item).catch(() => {})}
              data-later-remove={item.id}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
