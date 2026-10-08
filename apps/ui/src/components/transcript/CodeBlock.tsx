import { memo, useEffect, useState } from 'react';
import { highlight } from '../../lib/highlight.ts';
import { useThemes } from '../../state/themeStore.ts';

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
 * blocks on screen exist (the transcript is virtualised).
 */
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string | undefined }) {
  // Tagged with the code it was made from: while a block is still streaming, the
  // highlight lags behind and showing it would hide the newest lines.
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
    <div className="code-block group relative my-2 overflow-hidden rounded-md border border-border bg-code">
      {language && <span className="absolute top-1 right-2 text-[10px] text-faint uppercase select-none">{language}</span>}
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
