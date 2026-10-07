import { describe, expect, it } from 'vitest';
import { DraftStore } from './drafts.ts';

describe('DraftStore', () => {
  it('keeps a draft per session', () => {
    const store = new DraftStore<string>();
    store.set('a', { text: 'half a thought', attachments: [] });
    store.set('b', { text: '', attachments: ['image'] });
    expect(store.get('a')).toEqual({ text: 'half a thought', attachments: [] });
    expect(store.get('b')).toEqual({ text: '', attachments: ['image'] });
    expect(store.get('c')).toBeUndefined();
  });

  it('forgets a draft once the box is empty', () => {
    const store = new DraftStore<string>();
    store.set('a', { text: 'sent soon', attachments: [] });
    store.set('a', { text: '  \n', attachments: [] });
    expect(store.get('a')).toBeUndefined();
  });
});
