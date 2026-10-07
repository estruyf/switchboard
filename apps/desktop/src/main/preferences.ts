import { nativeTheme } from 'electron';
import { DEFAULT_PREFERENCES, sanitizePreferences, type ColorScheme, type Preferences } from '@switchboard/protocol/bridge';
import { readJsonFile, writeFileAtomic } from './jsonFile.ts';

/** Window background before the page paints, matching the Demo Time theme. */
export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#15181f' : '#ffffff');

/**
 * The user's preferences, saved as JSON in the app's data folder. Setting the
 * colour scheme sets nativeTheme.themeSource, which flips prefers-color-scheme in every window.
 */
export class PreferencesStore {
  #prefs: Preferences;

  /** `forcedScheme` (SWITCHBOARD_COLOR_SCHEME) overrides the saved one for this run only. */
  constructor(
    private readonly file: string,
    private readonly forcedScheme?: ColorScheme,
  ) {
    // No preferences yet, or a damaged file (kept as preferences.json.bak): the defaults.
    this.#prefs = { ...DEFAULT_PREFERENCES, ...sanitizePreferences(readJsonFile(file)) };
    nativeTheme.themeSource = forcedScheme ?? this.#prefs.colorScheme;
  }

  get(): Preferences {
    return this.forcedScheme ? { ...this.#prefs, colorScheme: this.forcedScheme } : { ...this.#prefs };
  }

  /** Applies a (validated) change; returns the new preferences. */
  update(patch: unknown): Preferences {
    this.#prefs = { ...this.#prefs, ...sanitizePreferences(patch) };
    nativeTheme.themeSource = this.#prefs.colorScheme;
    try {
      // Written in one step, so a crash mid-write can't reset every preference.
      writeFileAtomic(this.file, `${JSON.stringify(this.#prefs, null, 2)}\n`);
    } catch {
      // Still applied for this run.
    }
    return this.get();
  }
}
