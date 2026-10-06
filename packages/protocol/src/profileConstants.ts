/** Colours a profile can have; the UI maps each to a theme token. Kept free of zod for the renderer. */
export const PROFILE_COLORS = ['yellow', 'blue', 'green', 'purple', 'red', 'orange', 'gray'] as const;

/** The built-in profile: Claude Code's own config folder ($CLAUDE_CONFIG_DIR or ~/.claude). */
export const BUILTIN_PROFILE_ID = 'default';
