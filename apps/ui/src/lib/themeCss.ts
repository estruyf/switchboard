import { parseColor, toHex } from '@switchboard/protocol/color';
import { THEME_TOKENS, type ThemeMode, type ThemeToken, type ThemeTokens } from '@switchboard/protocol/theme-format';
import type { ResolvedTheme } from './themeResolve.ts';

/** `color` with its alpha multiplied by `factor`. */
const fade = (color: string, factor: number) => {
  const rgba = parseColor(color);
  return rgba ? toHex({ ...rgba, a: rgba.a * factor }) : color;
};

/**
 * The shadow under menus and dialogs, built around the theme's one shadow colour: two soft layers in light
 * mode, and in dark mode a hairline and two stronger layers (a dark UI hides soft shadows). With Demo
 * Time's colours these are exactly the layers styles.css has.
 */
export function overlayShadow(mode: ThemeMode, color: string): string {
  return mode === 'light'
    ? `0 2px 6px ${fade(color, 0.4)}, 0 12px 32px -4px ${color}`
    : `0 0 0 1px ${fade(color, 0.5)}, 0 4px 10px ${fade(color, 0.5)}, 0 16px 40px -6px ${color}`;
}

/** `--sb-*` declarations for a mode. Values are validated colours (see `parseColor`), so nothing else can get into the CSS. */
function declarations(mode: ThemeMode, tokens: ThemeTokens, skip: readonly ThemeToken[] = []): string {
  const lines = THEME_TOKENS.filter((token) => !skip.includes(token)).map((token) => {
    const value = parseColor(tokens[token]) ? tokens[token] : '';
    return `  --sb-${token}: ${token === 'overlay-shadow' ? overlayShadow(mode, value) : value};`;
  });
  return `${lines.join('\n')}\n  color-scheme: ${mode};`;
}

/**
 * The style sheet for a theme, in the same structure as styles.css: light on `:root`, dark in the
 * `prefers-color-scheme: dark` query, and the dark tokens again on `.theme-dark` (the terminal panel,
 * always dark), which leaves the shadow it casts alone as styles.css does. The selectors are one step
 * more specific than styles.css's, so the theme wins wherever the two style elements end up.
 */
export function themeCss(theme: ResolvedTheme): string {
  return [
    `html:root {\n${declarations('light', theme.light.tokens)}\n}`,
    `@media (prefers-color-scheme: dark) {\n  html:root {\n${declarations('dark', theme.dark.tokens).replace(/^/gm, '  ')}\n  }\n}`,
    `:root .theme-dark {\n${declarations('dark', theme.dark.tokens, ['terminal-shadow'])}\n}`,
  ].join('\n');
}
