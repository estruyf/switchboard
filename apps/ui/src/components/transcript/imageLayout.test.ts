import { describe, expect, it } from 'vitest';
import { frameSize, imageFacts, messageImageSlots, stepIndex } from './imageLayout.ts';

const wide = { width: 2400, height: 400 };
const tall = { width: 600, height: 2400 };
const tiny = { width: 16, height: 12 };
const huge = { width: 8000, height: 6000 };

describe('frameSize', () => {
  it('fits one image inside 300×200 at its own aspect ratio', () => {
    expect(frameSize('single', wide)).toEqual({ width: 300, height: 50 });
    expect(frameSize('single', tall)).toEqual({ width: 50, height: 200 });
    expect(frameSize('single', huge)).toEqual({ width: 267, height: 200 });
    expect(frameSize('single', { width: 2400, height: 1260 })).toEqual({ width: 300, height: 158 });
  });

  it('leaves a small image at its size and grows a tiny one only to 48px on its short side', () => {
    expect(frameSize('single', { width: 120, height: 80 })).toEqual({ width: 120, height: 80 });
    expect(frameSize('single', tiny)).toEqual({ width: 64, height: 48 });
    expect(frameSize('single', { width: 1, height: 1 })).toEqual({ width: 48, height: 48 });
  });

  it('uses the whole box while the size is unknown', () => {
    expect(frameSize('single', null)).toEqual({ width: 300, height: 200 });
    expect(frameSize('single', { width: 0, height: 0 })).toEqual({ width: 300, height: 200 });
  });

  it('gives thumbnails 84px of height and a width from 64 to 180px', () => {
    expect(frameSize('thumb', wide)).toEqual({ width: 180, height: 84 });
    expect(frameSize('thumb', tall)).toEqual({ width: 64, height: 84 });
    expect(frameSize('thumb', tiny)).toEqual({ width: 112, height: 84 });
    expect(frameSize('thumb', huge)).toEqual({ width: 112, height: 84 });
    expect(frameSize('thumb', { width: 1000, height: 1000 })).toEqual({ width: 84, height: 84 });
    expect(frameSize('thumb', undefined)).toEqual({ width: 112, height: 84 });
  });

  it('gives tiles a fixed 96×72 whatever the image', () => {
    for (const size of [wide, tall, tiny, huge, null]) expect(frameSize('tile', size)).toEqual({ width: 96, height: 72 });
  });
});

describe('messageImageSlots', () => {
  it('shows one image large', () => {
    expect(messageImageSlots(1)).toEqual([{ index: 0, variant: 'single', more: 0 }]);
  });

  it('shows two to four as thumbnails', () => {
    expect(messageImageSlots(2).map((s) => s.variant)).toEqual(['thumb', 'thumb']);
    expect(messageImageSlots(4)).toHaveLength(4);
    expect(messageImageSlots(4).every((s) => s.variant === 'thumb' && s.more === 0)).toBe(true);
  });

  it('shows five or more as five tiles, the fifth counting the ones after it', () => {
    expect(messageImageSlots(5).map((s) => s.more)).toEqual([0, 0, 0, 0, 0]);
    const seven = messageImageSlots(7);
    expect(seven.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(seven.every((s) => s.variant === 'tile')).toBe(true);
    expect(seven[4]).toEqual({ index: 4, variant: 'tile', more: 2 });
    expect(messageImageSlots(8)[4]!.more).toBe(3);
  });

  it('shows nothing without images', () => {
    expect(messageImageSlots(0)).toEqual([]);
  });
});

describe('imageFacts', () => {
  it('names the type, size and pixel size', () => {
    expect(imageFacts('image/png', 1.2 * 1024 * 1024, { width: 2400, height: 1260 })).toBe('PNG · 1.2 MB · 2400×1260');
    expect(imageFacts('image/jpeg', 120 * 1024)).toBe('JPEG · 120 KB');
  });
});

describe('stepIndex', () => {
  it('wraps around at both ends', () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(1, 1, 3)).toBe(2);
  });
});
