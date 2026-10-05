import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';

/** Fallbacks after the user's own terminal font: system monospace, then common Nerd Fonts for prompt glyphs. */
const FALLBACK_FONTS = '"SF Mono", ui-monospace, Menlo, "Symbols Nerd Font Mono", "MesloLGS NF", "Hack Nerd Font Mono", "JetBrainsMono Nerd Font Mono", monospace';

let userFont: Promise<string | null> | undefined;

/** The Demo Time theme's terminal colours (github.com/estruyf/vscode-demo-time-theme). */
const ANSI = {
  dark: {
    black: '#15181f', red: '#ff6b6b', green: '#51cf66', yellow: '#ffd43b', blue: '#74c0fc', magenta: '#d0bfff', cyan: '#66d9ef', white: '#d9dbe1',
    brightBlack: '#6b7280', brightRed: '#ed217c', brightGreen: '#7ee787', brightYellow: '#e6be36', brightBlue: '#8bb3ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#ffffff',
  },
  light: {
    black: '#24292e', red: '#d73a49', green: '#00b8a2', yellow: '#a08000', blue: '#005cc5', magenta: '#6f42c1', cyan: '#17a2b8', white: '#6a737d',
    brightBlack: '#505869', brightRed: '#b73545', brightGreen: '#00b8a2', brightYellow: '#916c00', brightBlue: '#005cc5', brightMagenta: '#6f42c1', brightCyan: '#0891b2', brightWhite: '#9ba4b7',
  },
} satisfies Record<string, ITheme>;

/** Terminal colours: the panel's background and text from the app's tokens, ANSI from the theme. */
function themeFromCss(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    background: v('--sb-sidebar'),
    foreground: v('--sb-text'),
    cursor: v('--sb-accent-ink'),
    cursorAccent: v('--sb-sidebar'),
    selectionBackground: dark ? '#ffd43b40' : '#ffd43b66',
    ...(dark ? ANSI.dark : ANSI.light),
  };
}

/**
 * One terminal view. Attaching replays the terminal's recent output, so
 * switching tabs or sessions (or an engine reconnect) never loses history.
 */
export function XTerm({ id, active }: { id: string; active: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !client) return;
    const term = new Terminal({
      fontFamily: FALLBACK_FONTS,
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')));
    term.open(host);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // The DOM renderer is fine; WebGL is just faster.
    }
    termRef.current = term;
    fitRef.current = fit;

    // Use the font from the user's own terminal when we can find it (asked once per window).
    userFont ??= client.call('terminal.font', {}).then((r) => r.fontFamily, () => null);
    void userFont.then((font) => {
      if (!font || termRef.current !== term) return;
      term.options.fontFamily = `"${font.replace(/"/g, '')}", ${FALLBACK_FONTS}`;
      fit.fit();
    });

    // App shortcuts (⌘J, ⌘N, ⌘O…) must reach the window instead of the shell.
    term.attachCustomKeyEventHandler((event) => !(event.metaKey && !['c', 'v', 'a', 'k'].includes(event.key.toLowerCase())));

    let disposed = false;
    const offData = client.on('terminal.data', (message) => {
      if (message.id === id) term.write(message.data);
    });
    void client
      .call('terminal.attach', { id })
      .then(({ replay }) => {
        if (disposed) return;
        term.write(replay);
        fit.fit();
        void client.call('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(() => {});
      })
      .catch((error: Error) => term.write(`\r\n\x1b[31m${error.message}\x1b[0m\r\n`));
    const input = term.onData((data) => void client.call('terminal.write', { id, data }).catch(() => {}));

    // Follow the panel's size; tell the process its new dimensions (debounced while dragging).
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (!host.offsetParent) return;
      fit.fit();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => void client.call('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(() => {}), 80);
    });
    observer.observe(host);

    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const retheme = () => (term.options.theme = themeFromCss());
    scheme.addEventListener('change', retheme);

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      scheme.removeEventListener('change', retheme);
      input.dispose();
      offData();
      void client.call('terminal.detach', { id }).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [client, id]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
  }, [active]);

  return <div ref={hostRef} className="h-full w-full px-2 pt-1" data-terminal={id} />;
}
