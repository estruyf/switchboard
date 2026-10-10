import { ListEnd, Zap } from 'lucide-react';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import type { MenuEntry } from '../Menu.tsx';
import { SplitButton } from '../ui/SplitButton.tsx';
import type { QueueAction, QueueButtonState } from './queueButton.ts';

const ITEM_DATA: Record<QueueAction, Record<`data-${string}`, boolean>> = {
  queue: { 'data-queue-message': true },
  'send-now': { 'data-send-now': true },
};

/**
 * The message box's Queue with its menu while Claude is working: the main part queues the message (↵),
 * the ▾ offers Queue and Send now (⌘⇧↵). The keys work without the menu; the message box handles them.
 */
export function QueueButton({ state, onAction }: { state: QueueButtonState; onAction(action: QueueAction): void }) {
  const entries: MenuEntry[] = state.items.map((item) => ({
    label: item.label,
    icon: item.action === 'queue' ? <ListEnd size={14} /> : <Zap size={14} />,
    hint: formatKeys(keysFor(item.shortcut)),
    disabled: item.disabled,
    onSelect: () => onAction(item.action),
    data: ITEM_DATA[item.action],
  }));
  entries.push({ note: 'Send now stops what Claude is doing, then sends your message.' });
  return (
    <SplitButton
      onClick={() => onAction('queue')}
      disabled={state.disabled}
      reason={state.reason}
      entries={entries}
      menuDisabled={state.disabled}
      menuLabel="More ways to send"
      menuWidth={260}
      data={{ 'data-composer-submit': true }}
      menuData={{ 'data-send-menu': true }}
    >
      {state.label}
    </SplitButton>
  );
}
