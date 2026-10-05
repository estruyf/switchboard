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

/** Terminal colours from the app's theme tokens, so it matches light and dark mode. */
function themeFromCss(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    background: v('--sb-sidebar'),
    foreground: v('--sb-text'),
    cursor: v('--sb-accent'),
    cursorAccent: v('--sb-sidebar'),
    selectionBackground: dark ? '#ffffff30' : '#00000025',
    black: dark ? '#3a3a40' : '#1c1c1e',
    brightBlack: v('--sb-faint'),
    red: v('--sb-error'),
    green: v('--sb-ok'),
    yellow: v('--sb-warn'),
    blue: dark ? '#74a7ff' : '#2f6fe0',
    magenta: dark ? '#d18cff' : '#9b46d6',
    cyan: dark ? '#5ed4e0' : '#0f8f9f',
    white: dark ? '#e6e6ea' : '#6c6c72',
    brightWhite: dark ? '#ffffff' : '#1c1c1e',
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
