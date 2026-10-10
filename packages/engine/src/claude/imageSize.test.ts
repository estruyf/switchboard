import { describe, expect, it } from 'vitest';
import { imageSize } from './imageSize.ts';

const b64 = (...parts: (number[] | string | Buffer)[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.isBuffer(p) ? p : Buffer.from(p)))).toString('base64');
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16be = (n: number) => [n >> 8, n & 0xff];
const u16le = (n: number) => [n & 0xff, n >> 8];

describe('imageSize', () => {
  it('reads a PNG header', () => {
    expect(imageSize(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(2400), u32be(1260), [8, 6, 0, 0, 0]))).toEqual({ width: 2400, height: 1260 });
  });

  it('reads a GIF header', () => {
    expect(imageSize(b64('GIF89a', u16le(320), u16le(48), [0, 0, 0]))).toEqual({ width: 320, height: 48 });
  });

  it('finds the JPEG frame after other segments', () => {
    const exif = Buffer.alloc(70_000, 0x41);
    const app1 = [0xff, 0xe1, ...u16be(2 + 1000)];
    const jpeg = b64([0xff, 0xd8], [0xff, 0xe0, ...u16be(16)], Buffer.alloc(14), app1, exif.subarray(0, 1000), [0xff, 0xc4, ...u16be(4), 0, 0], [0xff, 0xc0, ...u16be(17), 8, ...u16be(900), ...u16be(1600), 3], Buffer.alloc(12));
    expect(imageSize(jpeg)).toEqual({ width: 1600, height: 900 });
    // A frame past the first 64 KB still counts.
    const app = [0xff, 0xe1, ...u16be(2 + 60_000)];
    const late = b64([0xff, 0xd8], app, exif.subarray(0, 60_000), app, exif.subarray(0, 60_000), [0xff, 0xc2, ...u16be(17), 8, ...u16be(30), ...u16be(40), 3], Buffer.alloc(12));
    expect(imageSize(late)).toEqual({ width: 40, height: 30 });
  });

  it('reads the WebP variants', () => {
    const riff = (chunk: string, body: number[]) => b64('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body, Buffer.alloc(8));
    expect(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(640), ...u16le(480)]))).toEqual({ width: 640, height: 480 });
    const bits = (99 & 0x3fff) | ((49 & 0x3fff) << 14);
    expect(imageSize(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]))).toEqual({ width: 100, height: 50 });
    expect(imageSize(riff('VP8X', [0, 0, 0, 0, 199, 0, 0, 99, 0, 0]))).toEqual({ width: 200, height: 100 });
  });

  it('gives up quietly on anything else', () => {
    expect(imageSize('')).toBeNull();
    expect(imageSize('aGVsbG8gd29ybGQ=')).toBeNull();
    expect(imageSize(b64([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
