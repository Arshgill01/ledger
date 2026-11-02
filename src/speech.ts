import { EventEmitter } from 'node:events';

/**
 * Bounded FIFO between the panel's 4 s audio segments and transcription + extraction.
 *
 * - One segment is processed at a time, in arrival order (the panel uploads serially, so arrival
 *   order is recording order). Transcription and extraction for a segment finish before the next
 *   starts, so the transcript window the extractor sees stays in order.
 * - At most `capacity` segments wait. When full, the new segment is rejected (the HTTP route answers
 *   429) and counted in `dropped`. Nothing is dropped silently, and memory stays bounded.
 * - Segments from an older mic session are discarded when a new session starts; segments that waited
 *   longer than `maxAgeMs` are skipped. Both are counted in `stale`. Stopping the mic does not discard
 *   what was already captured; the bounded queue limits how long that tail takes to drain.
 * - A failing segment is counted in `failed` with `lastError`, and the worker moves on.
 */
export interface Segment {
  audio: Buffer;
  mime: string;
  session: string;
}

export interface SpeechStatus {
  available: boolean;
  reason?: string;
  pending: number;
  busy: boolean;
  capacity: number;
  processed: number;
  dropped: number;
  stale: number;
  failed: number;
  lastError?: string;
}

export type EnqueueResult = { accepted: true; pending: number } | { accepted: false; reason: 'full' };

interface Queued extends Segment {
  receivedAt: number;
}

export class SpeechQueue extends EventEmitter {
  private queue: Queued[] = [];
  private session?: string;
  private running = false;
  private idleWaiters: (() => void)[] = [];
  private readonly capacity: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private counts = { processed: 0, dropped: 0, stale: 0, failed: 0 };
  private lastError?: string;

  constructor(
    private readonly process: (seg: Segment) => Promise<void>,
    opts: { capacity?: number; maxAgeMs?: number; now?: () => number } = {},
  ) {
    super();
    this.capacity = opts.capacity ?? 4;
    this.maxAgeMs = opts.maxAgeMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  status(): SpeechStatus {
    return { available: true, pending: this.queue.length, busy: this.running, capacity: this.capacity, ...this.counts, lastError: this.lastError };
  }

  enqueue(seg: Segment): EnqueueResult {
    if (seg.session !== this.session) {
      const before = this.queue.length;
      this.queue = this.queue.filter((q) => q.session === seg.session);
      this.counts.stale += before - this.queue.length;
      this.session = seg.session;
    }
    if (this.queue.length >= this.capacity) {
      this.counts.dropped++;
      this.emit('dropped', seg);
      this.changed();
      return { accepted: false, reason: 'full' };
    }
    this.queue.push({ ...seg, receivedAt: this.now() });
    this.changed();
    void this.pump();
    return { accepted: true, pending: this.queue.length };
  }

  /** Resolves once nothing is queued or in flight. */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private changed(): void {
    this.emit('status', this.status());
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.changed();
    try {
      for (let seg = this.queue.shift(); seg; seg = this.queue.shift()) {
        if (seg.session !== this.session || this.now() - seg.receivedAt > this.maxAgeMs) {
          this.counts.stale++;
          this.changed();
          continue;
        }
        try {
          await this.process(seg);
          this.counts.processed++;
        } catch (err) {
          this.counts.failed++;
          this.lastError = (err as Error).message;
          this.emit('failed', err);
        }
        this.changed();
      }
    } finally {
      this.running = false;
      this.changed();
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}
