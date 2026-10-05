import { describe, expect, it } from 'vitest';
import { isTrashableSessionPath } from './trashGuard.ts';

const config = '/Users/me/.claude';
const id = '11111111-2222-4333-8444-555555555555';

describe('isTrashableSessionPath', () => {
  it('allows a transcript and its subagent folder inside the projects folder', () => {
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app/${id}.jsonl`, config)).toBe(true);
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app/${id}`, config)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/settings.json`, config)).toBe(false);
    expect(isTrashableSessionPath(`/Users/me/app/${id}.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/projects/../../${id}.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/projects/x/notes.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`relative/${id}.jsonl`, config)).toBe(false);
  });
});
