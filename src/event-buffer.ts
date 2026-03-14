/**
 * Fixed-size circular (ring) buffer for browser events.
 *
 * When the buffer reaches capacity the oldest events are silently evicted,
 * keeping memory usage bounded while still giving callers access to the
 * most-recent N events in chronological order.
 */
export class EventBuffer<T = unknown> {
  private _buffer: (T | undefined)[];
  private _capacity: number;
  private _head: number; // next write index
  private _size: number;
  private _totalPushed: number;

  constructor(capacity: number = 500) {
    this._capacity = capacity;
    this._buffer = new Array(capacity);
    this._head = 0;
    this._size = 0;
    this._totalPushed = 0;
  }

  /** Append an event, evicting the oldest if at capacity. */
  push(event: T): void {
    this._buffer[this._head] = event;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) {
      this._size++;
    }
    this._totalPushed++;
  }

  /**
   * Return the last `n` events in chronological (oldest-first) order.
   * Defaults to all events when `n` is omitted.
   */
  last(n?: number): T[] {
    const count = n === undefined ? this._size : Math.min(n, this._size);
    if (count === 0) return [];

    const result: T[] = new Array(count);
    // The oldest of the `count` events starts at:
    let start = (this._head - count + this._capacity) % this._capacity;
    for (let i = 0; i < count; i++) {
      result[i] = this._buffer[(start + i) % this._capacity] as T;
    }
    return result;
  }

  /** Remove all events from the buffer. */
  clear(): void {
    this._buffer = new Array(this._capacity);
    this._head = 0;
    this._size = 0;
  }

  /**
   * Return the last `n` events AND remove them from the buffer.
   * Defaults to all events when `n` is omitted.
   */
  drain(n?: number): T[] {
    const events = this.last(n);
    this.clear();
    return events;
  }

  /** Current number of events stored. */
  get size(): number {
    return this._size;
  }

  /** Maximum number of events this buffer can hold. */
  get capacity(): number {
    return this._capacity;
  }

  /** Total number of events ever pushed (including evicted ones). */
  get totalPushed(): number {
    return this._totalPushed;
  }

  /** Return events matching `predicate` without modifying the buffer. */
  filter(predicate: (event: T) => boolean): T[] {
    return this.last().filter(predicate);
  }

  /** Snapshot of buffer statistics. */
  get stats(): { size: number; capacity: number; totalPushed: number; evicted: number } {
    return {
      size: this._size,
      capacity: this._capacity,
      totalPushed: this._totalPushed,
      evicted: this._totalPushed - this._size,
    };
  }
}
