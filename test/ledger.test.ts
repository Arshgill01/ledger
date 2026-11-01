import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardText, initialState, reduce, similar } from '../src/engine/ledger.js';
import type { Actor, LedgerState } from '../src/engine/types.js';

const at = '2026-11-01T10:00:00.000Z';
const viewer = (n: string): Actor => ({ userId: `u_${n}`, login: n, isBroadcaster: false, isMod: false });
const mod: Actor = { userId: 'u_mod', login: 'modguy', isBroadcaster: false, isMod: true };

function withPromise(state = initialState('arsh'), confidence = 0.9): LedgerState {
  return reduce(state, {
    type: 'promises.extracted',
    source: 'speech',
    at,
    promises: [{
      text: 'eat the ghost pepper',
      quote: 'if we hit 50 subs tonight I will eat the ghost pepper',
      stake: 'ghost pepper',
      confidence,
      condition: { kind: 'count', metric: 'subs', target: 50, progress: 0, window: 'stream' },
    }],
  }).state;
}

test('auto mode stamps a confident promise as OPEN', () => {
  const r = reduce(initialState('arsh'), {
    type: 'promises.extracted', source: 'speech', at,
    promises: [{ text: 'sing a song', quote: 'I owe chat a song', stake: 'a song', confidence: 0.95, condition: { kind: 'none' } }],
  });
  assert.equal(r.state.ious.length, 1);
  assert.equal(r.state.ious[0].state, 'OPEN');
  assert.equal(r.state.ious[0].id, 1);
  assert.ok(r.effects.some((e) => e.type === 'overlay' && e.event === 'stamp'));
});

test('low confidence goes to PENDING, approval promotes it', () => {
  const s = withPromise(initialState('arsh'), 0.4);
  assert.equal(s.ious[0].state, 'PENDING');
  const r = reduce(s, { type: 'iou.approve', id: 1, at });
  assert.equal(r.state.ious[0].state, 'OPEN');
});

test('duplicate promises are not re-logged', () => {
  const s = withPromise();
  const r = reduce(s, {
    type: 'promises.extracted', source: 'speech', at,
    promises: [{ text: 'eat a ghost pepper', quote: 'yeah yeah the ghost pepper', stake: 'pepper', confidence: 0.9, condition: { kind: 'none' } }],
  });
  assert.equal(r.state.ious.length, 1);
  assert.ok(similar('eat the ghost pepper', 'eat a ghost pepper'));
  assert.ok(!similar('eat the ghost pepper', 'finish the boss tonight'));
});

test('metric progress moves the card and hitting the target makes it DUE with pin + clip', () => {
  let s = withPromise();
  let r = reduce(s, { type: 'metric', metric: 'subs', delta: 10, at });
  assert.equal(r.state.ious[0].state, 'OPEN');
  assert.equal((r.state.ious[0].condition as { progress: number }).progress, 10);
  assert.ok(r.effects.some((e) => e.type === 'overlay' && e.event === 'progress'));
  r = reduce(r.state, { type: 'metric', metric: 'subs', delta: 45, at });
  const iou = r.state.ious[0];
  assert.equal(iou.state, 'DUE');
  assert.equal((iou.condition as { progress: number }).progress, 50);
  assert.ok(r.effects.some((e) => e.type === 'say' && e.pin === true && /DUE/.test(e.text)));
  assert.ok(r.effects.some((e) => e.type === 'clip' && e.purpose === 'due'));
});

test('votes are one per user and quorum majority settles', () => {
  let s = withPromise();
  s = reduce(s, { type: 'settings', patch: { voteQuorum: 3 }, at }).state;
  s = reduce(s, { type: 'metric', metric: 'subs', value: 50, at }).state;
  assert.equal(s.ious[0].state, 'DUE');
  s = reduce(s, { type: 'vote', choice: 'paid', actor: viewer('a'), at }).state;
  s = reduce(s, { type: 'vote', choice: 'cap', actor: viewer('a'), at }).state; // changes mind
  assert.deepEqual(s.ious[0].votes, { paid: [], cap: ['u_a'] });
  s = reduce(s, { type: 'vote', choice: 'paid', actor: viewer('b'), at }).state;
  const r = reduce(s, { type: 'vote', choice: 'paid', actor: viewer('c'), at });
  assert.equal(r.state.ious[0].state, 'PAID');
  assert.ok(r.effects.some((e) => e.type === 'clip' && e.purpose === 'payoff'));
});

test('only mods/broadcaster can !iou, !due, !void', () => {
  let r = reduce(initialState('arsh'), { type: 'iou.manual', text: 'do a backflip', actor: viewer('x'), at });
  assert.equal(r.state.ious.length, 0);
  r = reduce(initialState('arsh'), { type: 'iou.manual', text: 'do a backflip.', actor: mod, at });
  assert.equal(r.state.ious.length, 1);
  assert.equal(r.state.ious[0].text, 'do a backflip');
  const blocked = reduce(r.state, { type: 'iou.due', id: 1, actor: viewer('x'), at });
  assert.equal(blocked.state.ious[0].state, 'OPEN');
  const due = reduce(r.state, { type: 'iou.due', id: 1, actor: mod, at });
  assert.equal(due.state.ious[0].state, 'DUE');
});

test('stream.offline calls in end-of-stream promises; stream.online resets per-stream counters', () => {
  let s = reduce(initialState('arsh'), {
    type: 'promises.extracted', source: 'speech', at,
    promises: [{ text: 'finish this boss', quote: 'I will finish this boss before I sleep', stake: 'boss', confidence: 0.9, condition: { kind: 'time', deadline: '', label: 'end of stream' } }],
  }).state;
  s = withPromise(s);
  s = reduce(s, { type: 'metric', metric: 'subs', delta: 7, at }).state;
  const off = reduce(s, { type: 'stream.offline', at });
  assert.equal(off.state.ious[0].state, 'DUE');
  const on = reduce(off.state, { type: 'stream.online', streamId: 's2', at });
  assert.equal(on.state.counters.subs, 0);
  assert.equal((on.state.ious[1].condition as { progress: number }).progress, 0);
});

test('board text lists DUE first', () => {
  let s = withPromise();
  s = reduce(s, { type: 'iou.manual', text: 'sing', actor: mod, at }).state;
  s = reduce(s, { type: 'iou.due', id: 2, actor: mod, at }).state;
  const text = boardText(s);
  assert.ok(text.startsWith('IOU #2'));
  assert.ok(/IOU #1/.test(text));
});
