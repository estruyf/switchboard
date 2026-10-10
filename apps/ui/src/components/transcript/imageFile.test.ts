import { describe, expect, it } from 'vitest';
import { imageFileName, parseDataUrl } from './imageFile.ts';

describe('imageFileName', () => {
  it('names an image after its message and position, with the right extension', () => {
    expect(imageFileName('3f2a9c1e-77b0-4d1c-9a51-0c6b1f0e2d44:1:0', 'image/png')).toBe('image-3f2a9c1e-1-0.png');
    expect(imageFileName('3f2a9c1e-77b0-4d1c-9a51-0c6b1f0e2d44:2', 'image/jpeg')).toBe('image-3f2a9c1e-2.jpg');
  });

  it('leaves out parts that are not plain numbers', () => {
    expect(imageFileName('abc:2:-1', 'image/webp')).toBe('image-abc-2.webp');
  });

  it('falls back to png for an unknown type', () => {
    expect(imageFileName('', 'image/bmp')).toBe('image.png');
  });
});

describe('parseDataUrl', () => {
  it('splits a base64 data URL', () => {
    expect(parseDataUrl('data:image/gif;base64,R0lGOD==')).toEqual({ mediaType: 'image/gif', data: 'R0lGOD==' });
  });

  it('refuses anything else', () => {
    expect(parseDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseDataUrl('data:image/png,raw')).toBeNull();
  });
});
