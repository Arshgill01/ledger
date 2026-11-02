import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpeechQueue, type Segment } from '../src/speech.js';
import { loadOrCreateOperatorKey } from '../src/server/access.js';

const seg = (n: number, session = 's1'): Segment => ({ audio: Buffer.from(String(n)), mime: 'audio/webm', session });

/** A processor whose calls stay pending until released, to model slow transcription + extraction. */
function gate() {
  const order: string[] = [];
  const releases: (() => void)[] = [];
  let active = 0;
  let maxActive = 0;
  const process = (s: Segment) => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(`${s.session}:${s.audio}`);
    return new Promise<void>((r) => releases.push(() => { active--; r(); }));
  };
  const release = async () => {
    while (!releases.length) await new Promise((r) => setImmediate(r));
    releases.shift()!();
    await new Promise((r) => setImmediate(r));
  };
  return { order, process, release, maxActive: () => maxActive };
}

test('slow processing runs serially in arrival order without losing accepted segments', async () => {
  const g = gate();
  const q = new SpeechQueue(g.process, { capacity: 4 });
  for (let i = 1; i <= 4; i++) assert.equal(q.enqueue(seg(i)).accepted, true);
  for (let i = 0; i < 4; i++) await g.release();
  await q.idle();
  assert.deepEqual(g.order, ['s1:1', 's1:2', 's1:3', 's1:4']);
  assert.equal(g.maxActive(), 1);
  assert.equal(q.status().processed, 4);
  assert.equal(q.status().dropped, 0);
});

test('overflow rejects the newest segment, counts it, and keeps memory bounded', async () => {
  const g = gate();
  const q = new SpeechQueue(g.process, { capacity: 2 });
  const dropped: Segment[] = [];
  q.on('dropped', (s) => dropped.push(s));
  assert.equal(q.enqueue(seg(1)).accepted, true); // in flight
  await new Promise((r) => setImmediate(r));
  assert.equal(q.enqueue(seg(2)).accepted, true);
  assert.equal(q.enqueue(seg(3)).accepted, true);
  assert.deepEqual(q.enqueue(seg(4)), { accepted: false, reason: 'full' });
  assert.equal(q.status().pending, 2);
  assert.equal(q.status().dropped, 1);
  assert.equal(String(dropped[0].audio), '4');
  for (let i = 0; i < 3; i++) await g.release();
  await q.idle();
  assert.deepEqual(g.order, ['s1:1', 's1:2', 's1:3']);
  // Capacity frees up again once drained.
  assert.equal(q.enqueue(seg(5)).accepted, true);
  await g.release();
  await q.idle();
});

test('a failing segment is reported and the worker recovers for the next one', async () => {
  const seen: string[] = [];
  const failures: Error[] = [];
  const q = new SpeechQueue(async (s) => {
    seen.push(String(s.audio));
    if (String(s.audio) === '2') throw new Error('provider 500');
  });
  q.on('failed', (e) => failures.push(e));
  q.enqueue(seg(1));
  q.enqueue(seg(2));
  q.enqueue(seg(3));
  await q.idle();
  assert.deepEqual(seen, ['1', '2', '3']);
  const st = q.status();
  assert.equal(st.processed, 2);
  assert.equal(st.failed, 1);
  assert.equal(st.lastError, 'provider 500');
  assert.equal(failures.length, 1);
});

test('a new mic session discards queued segments from the previous one', async () => {
  const g = gate();
  const q = new SpeechQueue(g.process, { capacity: 4 });
  q.enqueue(seg(1, 'old'));
  await new Promise((r) => setImmediate(r));
  q.enqueue(seg(2, 'old'));
  q.enqueue(seg(3, 'old'));
  q.enqueue(seg(1, 'new'));
  assert.equal(q.status().stale, 2);
  await g.release();
  await g.release();
  await q.idle();
  assert.deepEqual(g.order, ['old:1', 'new:1']);
});

test('segments that waited longer than maxAgeMs are skipped as stale', async () => {
  let now = 0;
  const g = gate();
  const q = new SpeechQueue(g.process, { maxAgeMs: 30_000, now: () => now });
  q.enqueue(seg(1));
  await new Promise((r) => setImmediate(r));
  q.enqueue(seg(2));
  now = 31_000;
  await g.release();
  await q.idle();
  assert.deepEqual(g.order, ['s1:1']);
  assert.equal(q.status().stale, 1);
});

test('status events report queue depth for the panel', async () => {
  const g = gate();
  const q = new SpeechQueue(g.process, { capacity: 3 });
  const pending: number[] = [];
  q.on('status', (s) => pending.push(s.pending));
  q.enqueue(seg(1)); // goes in flight immediately
  q.enqueue(seg(2));
  q.enqueue(seg(3));
  for (let i = 0; i < 3; i++) await g.release();
  await q.idle();
  assert.ok(pending.includes(2));
  assert.equal(pending.at(-1), 0);
  assert.equal(q.status().busy, false);
});

test('operator key is created once with mode 0600, reused, and OPERATOR_KEY must be long', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-key-'));
  try {
    const a = await loadOrCreateOperatorKey(dir);
    const b = await loadOrCreateOperatorKey(dir);
    assert.equal(a, b);
    assert.ok(a.length >= 24);
    assert.equal((await stat(join(dir, 'operator.key'))).mode & 0o777, 0o600);
    assert.equal((await readFile(join(dir, 'operator.key'), 'utf8')).trim(), a);
    assert.equal(await loadOrCreateOperatorKey(dir, 'x'.repeat(32)), 'x'.repeat(32));
    await assert.rejects(loadOrCreateOperatorKey(dir, 'short'), /at least 24/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
