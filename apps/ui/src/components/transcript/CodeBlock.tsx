import { Check, Copy } from 'lucide-react';
import { memo, useEffect, useState, type ReactNode } from 'react';
import { highlight } from '../../lib/highlight.ts';
import { useThemes } from '../../state/themeStore.ts';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
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
 *
 * With a `preview` (a markdown block, rendered), the block opens on the preview and a
 * Preview | Source switch sits in a header above it, next to the copy button.
 */
export const CodeBlock = memo(function CodeBlock({ code, language, preview }: { code: string; language: string | undefined; preview?: ReactNode }) {
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

  const source = html ? (
    // Shiki escapes the code; the HTML is spans with colour variables only.
    <div className="overflow-x-auto px-3 py-2 font-mono text-ui leading-relaxed select-text" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre className="overflow-x-auto px-3 py-2 font-mono text-ui leading-relaxed select-text">
      <code>{code}</code>
    </pre>
  );
  const copyButton = (
    <Button
      variant="quiet"
      size="sm"
      iconOnly
      icon={copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={12} aria-hidden />}
      aria-label={copied ? 'Copied' : preview ? 'Copy markdown' : 'Copy code'}
      onClick={() => void navigator.clipboard.writeText(code).then(() => flash('Copied'), () => {})}
      data-code-copy
    />
  );

  if (preview) return <PreviewBlock language={language} source={source} preview={preview} copyButton={copyButton} />;

  return (
    <div className="code-block group/code relative my-2 overflow-hidden rounded-md border border-border bg-code">
      {language && <span className="absolute top-1 right-2 text-[10px] text-faint uppercase select-none group-focus-within/code:opacity-0 group-hover/code:opacity-0">{language}</span>}
      {/* Takes the language's place on hover, on the code's own background so the first line doesn't show through. Invisible rather than removed, so Tab still reaches it and it shows while it has focus. */}
      <div className="pointer-events-none absolute top-1 right-1 z-10 rounded-md bg-code opacity-0 group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100 group-hover/code:pointer-events-auto group-hover/code:opacity-100">
        {copyButton}
      </div>
      {source}
    </div>
  );
});

type View = 'preview' | 'source';

const VIEWS = [
  { value: 'preview', label: 'Preview', data: { 'data-code-view': 'preview' } },
  { value: 'source', label: 'Source', data: { 'data-code-view': 'source' } },
] as const;

/**
 * A block that can be read rendered: a header with its language, the switch and the copy
 * button (always shown, so the switch is found without hovering), then the preview or the
 * highlighted source. The preview sits on the conversation's background, as prose.
 */
function PreviewBlock({ language, source, preview, copyButton }: { language: string | undefined; source: ReactNode; preview: ReactNode; copyButton: ReactNode }) {
  const [view, setView] = useState<View>('preview');
  return (
    <div className="code-block my-2 overflow-hidden rounded-md border border-border" data-code-preview-block>
      <div className="flex items-center gap-1 border-b border-border bg-code py-1 pr-1 pl-3">
        {language && <span className="mr-auto text-[10px] text-faint uppercase select-none">{language}</span>}
        <SegmentedControl<View> mode="radio" size="sm" label="Show as" value={view} onChange={setView} segments={VIEWS} className={language ? '' : 'ml-auto'} />
        {copyButton}
      </div>
      {view === 'preview' ? (
        <div className="px-3 py-1" data-code-preview>
          {preview}
        </div>
      ) : (
        <div className="bg-code">{source}</div>
      )}
    </div>
  );
}
