import type { HighlighterCore } from 'shiki/core';

/** Fence names → Shiki grammar, loaded only when first needed. */
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  astro: () => import('shiki/langs/astro.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
};

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  console: 'shellscript',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  rs: 'rust',
  dockerfile: 'docker',
  kt: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  rb: 'ruby',
  gql: 'graphql',
  svg: 'xml',
};

/** The Shiki grammar for a fence or file extension, or null when we don't highlight it. */
export function grammarFor(language: string | undefined): string | null {
  if (!language) return null;
  const name = language.toLowerCase();
  const resolved = ALIASES[name] ?? name;
  return resolved in GRAMMARS ? resolved : null;
}

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();
const cache = new Map<string, string>();
const MAX_CODE = 50_000;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ]);
    return createHighlighterCore({ themes: [light.default, dark.default], langs: [], engine: createJavaScriptRegexEngine() });
  })();
  return highlighter;
}

/**
 * Highlighted HTML for a code block (both themes as CSS variables), or null
 * when the language isn't supported. Shiki and each grammar load on first use.
 */
export async function highlight(code: string, language: string | undefined): Promise<string | null> {
  const grammar = grammarFor(language);
  if (!grammar || code.length > MAX_CODE) return null;
  const key = `${grammar}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const shiki = await getHighlighter();
  if (!loaded.has(grammar)) {
    const module = (await GRAMMARS[grammar]!()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] };
    await shiki.loadLanguage(module.default);
    loaded.add(grammar);
  }
  const html = shiki.codeToHtml(code, { lang: grammar, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
  if (cache.size > 500) cache.clear();
  cache.set(key, html);
  return html;
}

/** Language from a file path, for diffs and file contents. */
export function languageFromPath(path: string): string | undefined {
  const ext = /\.([a-z0-9+]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (/(^|\/)Dockerfile$/.test(path)) return 'docker';
  return ext;
}
