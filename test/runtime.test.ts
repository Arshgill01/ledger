import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { JsonStore } from '../src/engine/store.js';

const at = '2026-11-02T10:00:00.000Z';

test('concurrent events persist and broadcast in order without losing progress', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-runtime-'));
  try {
    const store = new JsonStore(dir);
    const rt = new Runtime(store, 'arsh', 'hybrid', 'http://localhost:3000', {});
    await rt.init();
    const seen: number[] = [];
    rt.on('state', (s) => seen.push(s.counters.follows));
    await Promise.all(Array.from({ length: 30 }, () => rt.dispatch({ type: 'metric', metric: 'follows', delta: 1, at })));
    assert.deepEqual(seen, Array.from({ length: 30 }, (_, i) => i + 1));
    assert.equal((await store.load('arsh')).counters.follows, 30);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed save does not publish state or poison later dispatches', async () => {
  const store = new JsonStore('unused');
  let fail = true;
  store.save = async () => { if (fail) throw new Error('disk full'); };
  const rt = new Runtime(store, 'arsh', 'demo', 'http://localhost:3000', {});
  await rt.init();
  await assert.rejects(rt.dispatch({ type: 'metric', metric: 'follows', delta: 1, at }), /disk full/);
  assert.equal(rt.state.counters.follows, 0);
  fail = false;
  await rt.dispatch({ type: 'metric', metric: 'follows', delta: 1, at });
  assert.equal(rt.state.counters.follows, 1);
});
