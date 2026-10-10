/**
 * How images in the conversation are framed. `single`: one image at its own aspect ratio, inside
 * 300×200. `thumb`: two to four side by side, 84px high and cropped. `tile`: five or more, as small
 * 96×72 squares, the fifth one counting the rest.
 */
export type ImageVariant = 'single' | 'thumb' | 'tile';

export interface Size {
  width: number;
  height: number;
}

export const SINGLE_BOX: Size = { width: 300, height: 200 };
export const THUMB_HEIGHT = 84;
export const THUMB_WIDTH = { min: 64, max: 180 };
export const TILE: Size = { width: 96, height: 72 };
/** A tiny image (an icon, a 1px spacer) grows to this on its short side, so the frame and its buttons stay usable. */
export const SINGLE_MIN = 48;

/**
 * The frame an image gets, in CSS pixels. `natural` is its pixel size when known (from the engine, or
 * once loaded); without it the frame is the variant's usual size, so the placeholder doesn't jump.
 * `single` never stretches an image beyond what keeps it at least `SINGLE_MIN` on its short side.
 */
export function frameSize(variant: ImageVariant, natural: Size | null | undefined): Size {
  const known = natural && natural.width > 0 && natural.height > 0 ? natural : null;
  if (variant === 'tile') return TILE;
  if (variant === 'thumb') {
    const width = known ? Math.round((THUMB_HEIGHT * known.width) / known.height) : Math.round((THUMB_HEIGHT * 4) / 3);
    return { width: Math.min(THUMB_WIDTH.max, Math.max(THUMB_WIDTH.min, width)), height: THUMB_HEIGHT };
  }
  if (!known) return SINGLE_BOX;
  const fit = Math.min(SINGLE_BOX.width / known.width, SINGLE_BOX.height / known.height);
  // Shrink to fit; only grow a tiny image, and only as far as the minimum.
  const scale = fit < 1 ? fit : Math.min(fit, Math.max(1, SINGLE_MIN / Math.min(known.width, known.height)));
  return { width: Math.max(1, Math.round(known.width * scale)), height: Math.max(1, Math.round(known.height * scale)) };
}

/** One image's place in a message: which frame it gets and, for the last tile, how many more it stands for. */
export interface ImageSlot {
  index: number;
  variant: ImageVariant;
  /** Images after this one that aren't shown (the "+N" on the fifth tile); 0 for every other slot. */
  more: number;
}

/** The images a message shows: one large, two to four as thumbnails, or four tiles and a fifth that counts the rest. */
export function messageImageSlots(count: number): ImageSlot[] {
  if (count <= 0) return [];
  if (count === 1) return [{ index: 0, variant: 'single', more: 0 }];
  if (count <= 4) return Array.from({ length: count }, (_, index) => ({ index, variant: 'thumb', more: 0 }));
  return Array.from({ length: 5 }, (_, index) => ({ index, variant: 'tile', more: index === 4 ? count - 5 : 0 }));
}

/** "1.2 MB" or "120 KB". */
export function formatBytes(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "PNG · 1.2 MB · 2400×1260": the type, size and, when known, the pixel size of an image. */
export function imageFacts(mediaType: string, bytes: number, natural?: Size | null): string {
  const type = mediaType.replace(/^image\//, '').toUpperCase();
  return [type, formatBytes(bytes), natural ? `${natural.width}×${natural.height}` : null].filter(Boolean).join(' · ');
}

/** The next image in the lightbox, wrapping around at either end. */
export const stepIndex = (index: number, delta: number, count: number) => (count <= 0 ? 0 : (((index + delta) % count) + count) % count);
