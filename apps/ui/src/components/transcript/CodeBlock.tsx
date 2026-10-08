import { Check, Copy } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { highlight } from '../../lib/highlight.ts';
import { useThemes } from '../../state/themeStore.ts';
import { Button } from '../ui/Button.tsx';
import { useFlash } from '../ui/useFlash.ts';

const idle = (fn: () => void) => {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1);
  return () => clearTimeout(id);
};

/**
 * A code block: plain text right away, syntax-highlighted once the browser is
 * idle (and once it stops changing, for a block Claude is still writing). Only
 * blocks on screen exist (the transcript is virtualised). Hovering it, or tabbing to
 * it, shows a button that copies the code as it was written.
 */
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string | undefined }) {
  // Tagged with the code it was made from: while a block is still streaming, the
  // highlight lags behind and showing it would hide the newest lines.
  const [copied, flash] = useFlash(1_500);
  const [highlighted, setHighlighted] = useState<{ code: string; syntaxKey: string; html: string | null } | null>(null);
  // A new theme can bring other code colours: highlight again with them.
  const syntaxKey = useThemes((s) => s.syntaxKey);
  const html = highlighted?.code === code && highlighted.syntaxKey === syntaxKey ? highlighted.html : null;

  useEffect(() => {
    let cancelled = false;
    const cancelIdle = idle(() => {
      void highlight(code, language).then((result) => !cancelled && setHighlighted({ code, syntaxKey, html: result }));
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [code, language, syntaxKey]);

  return (
    <div className="code-block group/code relative my-2 overflow-hidden rounded-md border border-border bg-code">
      {language && <span className="absolute top-1 right-2 text-[10px] text-faint uppercase select-none group-focus-within/code:opacity-0 group-hover/code:opacity-0">{language}</span>}
      {/* Takes the language's place on hover, on the code's own background so the first line doesn't show through. Invisible rather than removed, so Tab still reaches it and it shows while it has focus. */}
      <div className="pointer-events-none absolute top-1 right-1 z-10 rounded-md bg-code opacity-0 group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100 group-hover/code:pointer-events-auto group-hover/code:opacity-100">
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={12} aria-hidden />}
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={() => void navigator.clipboard.writeText(code).then(() => flash('Copied'), () => {})}
          data-code-copy
        />
      </div>
      {html ? (
        // Shiki escapes the code; the HTML is spans with colour variables only.
        <div className="overflow-x-auto px-3 py-2 font-mono text-ui leading-relaxed select-text" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-ui leading-relaxed select-text">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});
