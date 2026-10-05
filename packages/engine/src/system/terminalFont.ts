import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** `font-family = "X"` in a Ghostty config (the first one wins, like Ghostty's primary font). */
export function ghosttyFont(config: string): string | null {
  const match = /^\s*font-family\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(config);
  return match?.[1]?.trim() || null;
}

/** `"terminal.integrated.fontFamily": "X"` in VS Code's settings.json (JSON with comments, so read with a regex). */
export function vscodeTerminalFont(settings: string): string | null {
  const match = /"terminal\.integrated\.fontFamily"\s*:\s*"([^"]+)"/.exec(settings);
  return match?.[1]?.trim() || null;
}

/**
 * The font the user already uses in their terminal, so the embedded terminal
 * looks the same and prompt glyphs (Nerd Fonts, Powerline) render.
 */
export function detectTerminalFont(home = homedir()): { fontFamily: string; source: string } | null {
  for (const path of [join(home, '.config', 'ghostty', 'config'), join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')]) {
    const config = read(path);
    const font = config && ghosttyFont(config);
    if (font) return { fontFamily: font, source: 'Ghostty' };
  }
  for (const app of ['Code', 'Code - Insiders', 'Cursor']) {
    const settings = read(join(home, 'Library', 'Application Support', app, 'User', 'settings.json'));
    const font = settings && vscodeTerminalFont(settings);
    if (font) return { fontFamily: font, source: app === 'Code' ? 'VS Code' : app };
  }
  return null;
}
