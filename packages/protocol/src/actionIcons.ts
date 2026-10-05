/** Icons the action editor offers (names map to icons in the UI). Kept free of zod for the renderer. */
export const ACTION_ICONS = ['play', 'rocket', 'git-commit', 'git-pull-request', 'upload', 'flask', 'package', 'terminal', 'sparkles', 'wrench', 'globe', 'bug', 'check'] as const;
export type ActionIcon = (typeof ACTION_ICONS)[number];
