import { memo, useEffect, useState } from 'react';
import { highlight } from '../../lib/highlight.ts';

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
 * idle. Only blocks on screen exist (the transcript is virtualised).
 */
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string | undefined }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cancelIdle = idle(() => {
      void highlight(code, language).then((result) => !cancelled && setHtml(result));
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [code, language]);

  return (
    <div className="code-block group relative my-2 overflow-hidden rounded-md border border-border bg-sidebar">
      {language && <span className="absolute top-1 right-2 text-[10px] text-faint uppercase select-none">{language}</span>}
      {html ? (
        // Shiki escapes the code; the HTML is spans with colour variables only.
        <div className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed select-text" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed select-text">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});
