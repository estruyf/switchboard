import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, sanitizePreferences } from './bridge.ts';

describe('sidebarCollapsed preference', () => {
  it('collapses to the minimal rail by default', () => {
    expect(DEFAULT_PREFERENCES.sidebarCollapsed).toBe('minimal');
  });

  it('keeps minimal and closed, and drops anything else', () => {
    expect(sanitizePreferences({ sidebarCollapsed: 'closed' })).toEqual({ sidebarCollapsed: 'closed' });
    expect(sanitizePreferences({ sidebarCollapsed: 'minimal' })).toEqual({ sidebarCollapsed: 'minimal' });
    expect(sanitizePreferences({ sidebarCollapsed: 'hidden' })).toEqual({});
    expect(sanitizePreferences({ sidebarCollapsed: 1 })).toEqual({});
  });
});
