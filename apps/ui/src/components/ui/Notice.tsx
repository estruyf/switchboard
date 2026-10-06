import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from './Button.tsx';

export type NoticeTone = 'info' | 'warn' | 'error' | 'success';

// The edge colour for info, so the box stays visible on dialogs as well as on the app's background.
const BOX: Record<NoticeTone, string> = {
  info: 'border-edge bg-card text-muted',
  warn: 'border-warn/40 bg-warn/10 text-text',
  error: 'border-error/40 bg-error/10 text-error',
  success: 'border-ok/40 bg-ok/10 text-text',
};
const ICON: Record<NoticeTone, string> = { info: 'text-muted', warn: 'text-warn', error: 'text-error', success: 'text-ok' };

interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  tone?: NoticeTone;
  /** Before the message, in the tone's colour (a class on the icon itself wins). */
  icon?: ReactNode;
  /** What you can do about it: Buttons, `size="sm"`, quiet or secondary. */
  actions?: ReactNode;
  /** Shows a close button ("Dismiss"). */
  onDismiss?(): void;
  /** No box: one truncated line inside a status row (under the message box on New session). */
  inline?: boolean;
  /** Defaults to `alert` for errors (read out at once) and `status` otherwise. */
  role?: 'alert' | 'status' | 'note';
  children: ReactNode;
}

/**
 * A message about what is going on: a failed action, a session open elsewhere, a prompt that came
 * from a link. Wraps onto more lines as needed; `inline` keeps it to one line without a box.
 */
export function Notice({ tone = 'info', icon, actions, onDismiss, inline = false, role, className = '', children, ...rest }: NoticeProps) {
  const dismiss = onDismiss && <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} onClick={onDismiss} aria-label="Dismiss" className="shrink-0" />;
  if (inline) {
    return (
      <div role={role ?? (tone === 'error' ? 'alert' : 'status')} className={`flex min-w-0 items-center gap-1.5 ${tone === 'info' ? '' : ICON[tone]} ${className}`} {...rest}>
        {icon && <span className={`flex shrink-0 ${ICON[tone]}`}>{icon}</span>}
        <span className="min-w-0 truncate">{children}</span>
        {actions}
        {dismiss}
      </div>
    );
  }
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : 'status')} className={`flex flex-wrap items-start gap-x-2 gap-y-1.5 rounded-lg border px-3 py-2 text-ui ${BOX[tone]} ${className}`} {...rest}>
      {icon && <span className={`flex shrink-0 pt-0.5 ${ICON[tone]}`}>{icon}</span>}
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {(actions || dismiss) && (
        // Buttons are taller than a line of text; the negative margin keeps a one-line notice compact.
        <div className="-my-1 flex shrink-0 items-center gap-1.5">
          {actions}
          {dismiss}
        </div>
      )}
    </div>
  );
}
