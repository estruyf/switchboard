import type { ImageSink } from '../claude/transcript.ts';

/**
 * Transcript images kept in memory for the window to fetch as they scroll into
 * view. Least-recently-used images are dropped past the byte budget; a miss is
 * served by re-reading the transcript.
 */
export class ImageStore {
  private readonly images = new Map<string, { mediaType: string; data: string }>();
  private size = 0;

  constructor(private readonly maxChars = 64 * 1024 * 1024) {}

  /** A sink that files images under one session. */
  sink(sessionId: string): ImageSink {
    return (imageId, mediaType, data) => this.put(`${sessionId}|${imageId}`, mediaType, data);
  }

  get(sessionId: string, imageId: string): { mediaType: string; data: string } | undefined {
    const key = `${sessionId}|${imageId}`;
    const hit = this.images.get(key);
    if (hit) {
      // Refresh its place in the LRU order.
      this.images.delete(key);
      this.images.set(key, hit);
    }
    return hit;
  }

  private put(key: string, mediaType: string, data: string): void {
    if (this.images.has(key) || data.length > this.maxChars) return;
    this.images.set(key, { mediaType, data });
    this.size += data.length;
    for (const [oldest, value] of this.images) {
      if (this.size <= this.maxChars) break;
      this.images.delete(oldest);
      this.size -= value.data.length;
    }
  }
}
