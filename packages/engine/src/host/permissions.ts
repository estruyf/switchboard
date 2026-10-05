import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

const DESTINATION: Record<string, string> = {
  session: 'for this session',
  localSettings: 'in this project (just you)',
  projectSettings: 'in this project (shared)',
  userSettings: 'everywhere',
  cliArg: 'for this session',
};

const MODE: Record<string, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  auto: 'Auto mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
};

const rule = (r: { toolName: string; ruleContent?: string }) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName);

/**
 * Describes Claude Code's "always allow" suggestions in words, so the button
 * says exactly what it will change. Returns null when nothing is offered.
 */
export function describeSuggestions(suggestions: readonly PermissionUpdate[] | undefined): string | null {
  if (!suggestions?.length) return null;
  const parts = suggestions.flatMap((update): string[] => {
    const where = DESTINATION[update.destination] ?? '';
    switch (update.type) {
      case 'addRules':
      case 'replaceRules': {
        const verb = update.behavior === 'allow' ? 'Allow' : update.behavior === 'deny' ? 'Deny' : 'Ask for';
        return [`${verb} ${update.rules.map(rule).join(', ')} ${where}`.trim()];
      }
      case 'setMode':
        return [`Switch to ${MODE[update.mode] ?? update.mode} ${where}`.trim()];
      case 'addDirectories':
        return [`Allow access to ${update.directories.join(', ')} ${where}`.trim()];
      default:
        return [];
    }
  });
  return parts.length ? parts.join('; ') : null;
}
