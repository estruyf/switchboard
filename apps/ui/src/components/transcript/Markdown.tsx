import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock.tsx';

const components: Components = {
  a: ({ href, children }) => (
    // The main process opens http(s) links in the browser and blocks everything else.
    <a href={href} target="_blank" rel="noreferrer" className="text-link underline decoration-link/40 underline-offset-2">
      {children}
    </a>
  ),
  // Fenced blocks render through CodeBlock (highlighted when idle); `pre` is just a pass-through.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? '');
    const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1];
    if (language || text.includes('\n')) return <CodeBlock code={text.replace(/\n$/, '')} language={language} />;
    return <code className="rounded bg-border/60 px-1 py-px font-mono text-[0.9em]">{children}</code>;
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-collapse text-[12px] [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
        {children}
      </table>
    </div>
  ),
};

/** Assistant prose. Memoised: finished messages never change, so they render once. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown text-[13.5px] leading-relaxed select-text [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
