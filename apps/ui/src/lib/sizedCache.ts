/**
 * A least-recently-used cache of strings, capped by their total length rather than their number:
 * a few huge entries (or many streamed copies of one growing code block) can't fill memory.
 */
export class SizedCache {
  private readonly entries = new Map<string, string>();
  private total = 0;

  /** `budget`: the most characters (keys and values together) it keeps. */
  constructor(private readonly budget: number) {}

  get size(): number {
    return this.entries.size;
  }

  /** Characters held now, keys included. */
  get used(): number {
    return this.total;
  }

  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Map keeps insertion order: moving the entry to the end marks it as the most recently used.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    const cost = key.length + value.length;
    this.delete(key);
    // An entry bigger than the whole budget is never kept.
    if (cost > this.budget) return;
    for (const [oldKey, oldValue] of this.entries) {
      if (this.total + cost <= this.budget) break;
      this.entries.delete(oldKey);
      this.total -= oldKey.length + oldValue.length;
    }
    this.entries.set(key, value);
    this.total += cost;
  }

  delete(key: string): void {
    const value = this.entries.get(key);
    if (value === undefined) return;
    this.entries.delete(key);
    this.total -= key.length + value.length;
  }
}
