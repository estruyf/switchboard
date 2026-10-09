import { describe, expect, it } from 'vitest';
import { dropMessage, dropVerdict, mergeAttachments, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, planDrop, type DroppedFile } from './images.ts';

const can = { attached: 0, canMention: true };
const cannot = { attached: 0, canMention: false };

describe('dropVerdict', () => {
  it('ignores drags without files', () => {
    expect(dropVerdict({ files: false, types: [] }, can)).toBeNull();
  });

  it('attaches images and mentions the other files', () => {
    expect(dropVerdict({ files: true, types: ['image/png', 'text/plain', 'image/webp'] }, can)).toEqual({ kind: 'ok', attach: 2, mention: 1, full: false });
  });

  it('mentions files and folders (no type) that are not images', () => {
    const verdict = dropVerdict({ files: true, types: ['application/pdf', ''] }, can);
    expect(verdict).toEqual({ kind: 'ok', attach: 0, mention: 2, full: false });
    expect(dropMessage(verdict!)).toBe('Drop to add 2 files');
  });

  it('refuses a drag where every file would be skipped when mentions are not possible', () => {
    expect(dropVerdict({ files: true, types: ['image/svg+xml', 'application/pdf'] }, cannot)).toEqual({ kind: 'unsupported' });
  });

  it('lets the drop decide when the types are unknown', () => {
    expect(dropVerdict({ files: true, types: [] }, can)).toEqual({ kind: 'ok', attach: 0, mention: 0, full: false });
  });

  it('mentions images past the limit, or says the message is full when it cannot', () => {
    const verdict = dropVerdict({ files: true, types: ['image/png'] }, { attached: MAX_ATTACHMENTS, canMention: true });
    expect(verdict).toEqual({ kind: 'ok', attach: 0, mention: 1, full: true });
    expect(dropMessage(verdict!)).toBe(`${MAX_ATTACHMENTS} images attached already: drop to add it as a file`);
    expect(dropVerdict({ files: true, types: ['image/png'] }, { attached: MAX_ATTACHMENTS, canMention: false })).toEqual({ kind: 'full' });
  });

  it('shows why the composer is disabled first', () => {
    const verdict = dropVerdict({ files: true, types: ['application/pdf'] }, { ...can, disabledReason: 'Choose a folder first' });
    expect(verdict).toEqual({ kind: 'disabled', reason: 'Choose a folder first' });
    expect(dropMessage(verdict!)).toBe('Choose a folder first');
  });

  it('describes a mixed drop', () => {
    expect(dropMessage({ kind: 'ok', attach: 1, mention: 3, full: false })).toBe('Drop to attach 1 image and add 3 files');
  });
});

describe('planDrop', () => {
  const file = (type: string, path: string, extra: Partial<DroppedFile> = {}): DroppedFile => ({ type, size: 10, path, directory: false, ...extra });

  it('attaches images, mentions the rest, skips what has no path', () => {
    const plan = planDrop([file('image/png', '/a.png'), file('text/plain', '/notes.txt'), file('application/pdf', ''), file('', '/src', { directory: true })], 0);
    expect(plan.attach).toEqual([0]);
    expect(plan.mention.map((f) => f.path)).toEqual(['/notes.txt', '/src']);
    expect(plan.skipped).toBe(1);
  });

  it('mentions images that are too big or past the limit', () => {
    const plan = planDrop([file('image/png', '/big.png', { size: MAX_IMAGE_BYTES + 1 }), file('image/png', '/one.png'), file('image/png', '/two.png')], MAX_ATTACHMENTS - 1);
    expect(plan.attach).toEqual([1]);
    expect(plan.mention.map((f) => f.path)).toEqual(['/big.png', '/two.png']);
  });
});

describe('mergeAttachments', () => {
  it('adds everything when there is room', () => {
    expect(mergeAttachments([1], [2, 3], 2)).toEqual({ next: [1, 2, 3], notice: null });
  });

  it('mentions skipped files', () => {
    expect(mergeAttachments([], [1], 3).notice).toMatch(/^Some files were skipped/);
  });

  it('keeps the first images up to the limit and says how many were left out', () => {
    const current = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => i);
    const { next, notice } = mergeAttachments(current, [100, 101, 102], 3);
    expect(next).toHaveLength(MAX_ATTACHMENTS);
    expect(next.at(-1)).toBe(100);
    expect(notice).toBe(`2 images were left out: ${MAX_ATTACHMENTS} at most per message.`);
  });
});
