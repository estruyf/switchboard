/**
 * The pixel size of a base64 image, read from its header (PNG, JPEG, GIF, WebP), so the window can
 * size an image's frame before the data arrives. Null for anything else or a header it can't read.
 */
export function imageSize(base64: string): { width: number; height: number } | null {
  try {
    // Every header but JPEG's sits in the first few bytes; JPEG's can follow a large EXIF block.
    const head = Buffer.from(base64.slice(0, 64), 'base64');
    const size = fixedHeader(head) ?? (head[0] === 0xff && head[1] === 0xd8 ? jpegSize(base64) : null);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

function fixedHeader(b: Buffer): { width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && b.toString('latin1', 0, 4) === 'GIF8') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/** Walks the JPEG markers to the first start-of-frame, which holds the size. */
function jpegSize(base64: string): { width: number; height: number } | null {
  // Most frames start in the first 64 KB; only decode the whole file when they don't.
  for (const b of [Buffer.from(base64.slice(0, 96 * 1024), 'base64'), Buffer.from(base64, 'base64')]) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      // SOF0–SOF15, leaving out DHT (C4), JPG (C8) and DAC (CC), which share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    if (b.length * 4 >= base64.length * 3 - 4) break;
  }
  return null;
}
