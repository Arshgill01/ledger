import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { Runtime } from '../src/runtime.js';
import { MemoryStore } from '../src/engine/store.js';
import { createHttp, type HttpHandlers } from '../src/server/http.js';
import { COOKIE, sessionValue } from '../src/server/access.js';
import type { Mode } from '../src/config.js';
import type { EnqueueResult } from '../src/speech.js';

const KEY = 'test-operator-key-0123456789abcdef';
const at = '2026-11-02T10:00:00.000Z';
const EVIL = 'https://evil.example';

async function setup(t: TestContext, mode: Mode = 'live', handlers: HttpHandlers = {}) {
  const rt = new Runtime(new MemoryStore(), 'arsh', mode, 'http://localhost:3000', { voteQuorum: 5 });
  await rt.init();
  const server = createHttp(rt, handlers, {
    publicDir: new URL('../public', import.meta.url).pathname,
    access: mode === 'demo' ? { operatorRequired: false } : { operatorRequired: true, key: KEY },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  const cookie = `${COOKIE}=${sessionValue(KEY)}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { rt, base, cookie, post };
}

/** Collects every message a WS client receives; resolves `opened` or rejects with the HTTP status. */
function wsClient(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  const messages: any[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once('error', reject);
  });
  return { ws, messages, opened };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

async function seed(rt: Runtime) {
  await rt.dispatch({ type: 'promises.extracted', source: 'speech', at, promises: [
    { text: 'eat the ghost pepper', quote: 'I will eat the ghost pepper', stake: 'ghost pepper', confidence: 0.9, condition: { kind: 'none' } },
    { text: 'sing a song', quote: 'maybe a song', stake: 'song', confidence: 0.3, condition: { kind: 'none' } },
  ] });
  await rt.dispatch({ type: 'iou.due', id: 1, at });
  await rt.dispatch({ type: 'vote', id: 1, choice: 'paid', actor: { userId: 'viewer-123', login: 'v', isBroadcaster: false, isMod: false }, at });
  rt.pushTranscript('secret mic transcript');
  rt.pushChat({ at, login: 'someone', text: 'secret chat' });
}

test('public state is redacted: no transcript, chat, status, voter ids or pending IOUs', async (t) => {
  const { rt, base } = await setup(t);
  await seed(rt);
  const res = await fetch(`${base}/api/public/state`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const secret of ['secret mic transcript', 'secret chat', 'viewer-123', 'sing a song', 'status']) assert.ok(!body.includes(secret), secret);
  const snap = JSON.parse(body);
  assert.deepEqual(snap.ious.map((i: { id: number }) => i.id), [1]);
  assert.deepEqual(snap.ious[0].votes, { paid: 1, cap: 0 });
});

test('live mode: private reads and mutations need the operator cookie', async (t) => {
  const { rt, base, cookie, post } = await setup(t);
  await seed(rt);
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await post('/api/event', { type: 'iou.paid', id: 1 })).status, 401);
  assert.equal((await post('/api/transcript', { text: 'I owe chat a song' })).status, 401);
  assert.equal((await fetch(`${base}/auth/login`, { redirect: 'manual' })).status, 401);
  assert.equal(rt.state.ious[0].state, 'DUE');

  const priv = await fetch(`${base}/api/state`, { headers: { cookie } });
  assert.equal(priv.status, 200);
  assert.ok((await priv.text()).includes('secret mic transcript'));
  assert.equal((await post('/api/event', { type: 'iou.paid', id: 1 }, { cookie })).status, 200);
  assert.equal(rt.state.ious[0].state, 'PAID');
});

test('operator sign-in: wrong key refused, right key sets an HttpOnly SameSite=Strict cookie that works', async (t) => {
  const { base, post } = await setup(t);
  assert.equal((await post('/api/operator/login', { key: 'nope' })).status, 401);
  const ok = await post('/api/operator/login', { key: KEY });
  assert.equal(ok.status, 200);
  const set = ok.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  assert.ok(!set.includes(KEY), 'cookie must not carry the raw key');
  const session = await (await fetch(`${base}/api/session`, { headers: { cookie: set.split(';')[0] } })).json();
  assert.equal(session.operator, true);
  const anon = await (await fetch(`${base}/api/session`)).json();
  assert.equal(anon.operator, false);
});

test('cross-origin browser requests are refused even with a valid cookie, and simple-request CSRF is blocked', async (t) => {
  const { rt, base, cookie, post } = await setup(t);
  await seed(rt);
  assert.equal((await post('/api/event', { type: 'iou.void', id: 1 }, { cookie, origin: EVIL })).status, 403);
  // A cross-site <form> or no-cors fetch can only send text/plain; refused before parsing.
  const simple = await fetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'text/plain', cookie }, body: JSON.stringify({ type: 'iou.void', id: 1 }) });
  assert.equal(simple.status, 415);
  assert.equal(rt.state.ious[0].state, 'DUE');
  // Same-origin browser request is fine.
  assert.equal((await post('/api/event', { type: 'iou.void', id: 1 }, { cookie, origin: base })).status, 200);
});

test('panel cannot inject Twitch/extractor-only events or forge actors', async (t) => {
  const { rt, cookie, post } = await setup(t);
  await seed(rt);
  for (const ev of [
    { type: 'iou.receipt', id: 1, receipt: { clipUrl: 'https://fake' } },
    { type: 'promises.extracted', promises: [], source: 'speech' },
    { type: 'vote', id: 1, choice: 'cap', actor: { userId: 'x', login: 'x', isBroadcaster: true, isMod: true } },
    { type: 'metric', metric: 'subs', delta: 50 },
    { type: 'stream.offline' },
    { type: 'settings', patch: { voteQuorum: 0 } },
    { type: 'settings', patch: { autoThreshold: 0 } },
    { type: 'iou.paid', id: '1' },
  ]) {
    const r = await post('/api/event', ev, { cookie });
    assert.equal(r.status, 400, JSON.stringify(ev));
  }
  assert.equal(rt.state.counters.subs, 0);
  assert.equal(rt.state.ious[0].receipt.clipUrl, undefined);

  const manual = await post('/api/event', { type: 'iou.manual', text: 'do a backflip', actor: { userId: 'evil', login: 'evil', isBroadcaster: false, isMod: false } }, { cookie });
  assert.equal(manual.status, 200);
  assert.equal(rt.state.ious.at(-1)?.text, 'do a backflip');
});

test('WebSockets: public feed is redacted; operator feed needs the cookie; foreign origins refused', async (t) => {
  const { rt, base, cookie } = await setup(t);
  const wsBase = base.replace('http', 'ws');

  await assert.rejects(wsClient(`${wsBase}/ws/operator`).opened, /status 401/);
  await assert.rejects(wsClient(`${wsBase}/ws`, { origin: EVIL }).opened, /status 403/);
  await assert.rejects(wsClient(`${wsBase}/ws/operator`, { origin: EVIL, cookie }).opened, /status 403/);

  const pub = wsClient(`${wsBase}/ws`);
  const op = wsClient(`${wsBase}/ws/operator`, { cookie, origin: base });
  await Promise.all([pub.opened, op.opened]);
  t.after(() => { pub.ws.terminate(); op.ws.terminate(); });
  await until(() => pub.messages.length > 0 && op.messages.length > 0);

  await seed(rt);
  rt.log('private status line');
  await rt.dispatch({ type: 'iou.manual', text: 'marker', actor: { userId: 'p', login: 'arsh', isBroadcaster: true, isMod: true }, at });
  await until(() => pub.messages.some((m) => m.type === 'state' && m.snapshot.ious.some((i: { text: string }) => i.text === 'marker')));
  await until(() => op.messages.some((m) => m.type === 'status' && m.text === 'private status line'));

  const pubText = JSON.stringify(pub.messages);
  for (const secret of ['secret mic transcript', 'secret chat', 'viewer-123', 'private status line', 'sing a song']) assert.ok(!pubText.includes(secret), secret);
  assert.ok(!pub.messages.some((m) => m.type === 'overlay' && m.event === 'pending'));
  assert.ok(pub.messages.some((m) => m.type === 'overlay' && m.event === 'stamp'));
  const opText = JSON.stringify(op.messages);
  for (const seen of ['secret mic transcript', 'secret chat', 'viewer-123']) assert.ok(opText.includes(seen), seen);
});

test('demo mode: panel needs no sign-in but origin checks and the event allowlist still apply', async (t) => {
  const { rt, base, post } = await setup(t, 'demo');
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await post('/api/event', { type: 'metric', metric: 'follows', delta: 1 })).status, 200);
  assert.equal(rt.state.counters.follows, 1);
  assert.equal((await post('/api/event', { type: 'metric', metric: 'follows', delta: 1 }, { origin: EVIL })).status, 403);
  assert.equal((await post('/api/event', { type: 'iou.receipt', id: 1, receipt: {} })).status, 400);
  assert.equal(rt.state.counters.follows, 1);
});

test('audio route: 202 when queued, 429 with Retry-After when the backlog is full, 400 when unavailable', async (t) => {
  let next: EnqueueResult = { accepted: true, pending: 1 };
  const got: string[] = [];
  const { base, cookie } = await setup(t, 'live', { onAudio: (_a, mime, session) => { got.push(`${mime}|${session}`); return next; } });
  const send = (headers: Record<string, string>, size = 4000) => fetch(`${base}/api/audio`, { method: 'POST', headers: { cookie, 'Content-Type': 'audio/webm;codecs=opus', ...headers }, body: Buffer.alloc(size) });

  assert.equal((await fetch(`${base}/api/audio`, { method: 'POST', headers: { 'Content-Type': 'audio/webm', 'X-Mic-Session': 's1' }, body: Buffer.alloc(4000) })).status, 401);
  assert.equal((await send({})).status, 400, 'session header required');
  assert.equal((await send({ 'X-Mic-Session': 's1' }, 100)).status, 400, 'too small');
  assert.equal((await send({ 'X-Mic-Session': 's1' }, 3 * 1024 * 1024)).status, 413);
  assert.equal((await send({ 'X-Mic-Session': 's1' })).status, 202);
  next = { accepted: false, reason: 'full' };
  const full = await send({ 'X-Mic-Session': 's1' });
  assert.equal(full.status, 429);
  assert.equal(full.headers.get('retry-after'), '4');
  assert.deepEqual(got, ['audio/webm;codecs=opus|s1', 'audio/webm;codecs=opus|s1']);
});

test('audio route reports why the mic is unavailable', async (t) => {
  const { rt, base, cookie } = await setup(t, 'hybrid');
  rt.setSpeech({ ...rt.speech, reason: 'Hybrid mode: no microphone transcription.' });
  const r = await fetch(`${base}/api/audio`, { method: 'POST', headers: { cookie, 'Content-Type': 'audio/webm', 'X-Mic-Session': 's1' }, body: Buffer.alloc(4000) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Hybrid mode/);
});
