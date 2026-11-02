import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { EventSubClient, type TwitchEvent } from '../src/twitch/eventsub.js';
import { Helix } from '../src/twitch/helix.js';

test('EventSub transfers sockets without resubscribing and deduplicates notifications', { timeout: 5000 }, async (t) => {
  const first = new WebSocketServer({ port: 0 });
  const second = new WebSocketServer({ port: 0 });
  await Promise.all([once(first, 'listening'), once(second, 'listening')]);
  const url = (s: WebSocketServer) => {
    const address = s.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP address');
    return `ws://127.0.0.1:${address.port}`;
  };
  const helix = new Helix({ clientId: 'test', token: async () => 'test' });
  let subscriptions = 0;
  t.mock.method(helix, 'createEventSub', async () => { subscriptions++; });
  const events: TwitchEvent[] = [];
  let changed = () => {};
  const client = new EventSubClient(helix, { broadcasterId: '1', userId: '1' }, (e) => { events.push(e); changed(); });
  const until = async (predicate: () => boolean) => {
    while (!predicate()) await new Promise<void>((resolve) => { changed = resolve; });
  };
  t.after(async () => {
    client.stop();
    for (const server of [first, second]) {
      for (const ws of server.clients) ws.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  const frame = (message_type: string, payload: unknown, message_id?: string) => JSON.stringify({ metadata: { message_type, message_id }, payload });
  const connection = once(first, 'connection');
  client.start(url(first));
  const [old] = await connection;
  old.send(frame('session_welcome', { session: { id: 'first', keepalive_timeout_seconds: 10 } }));
  await until(() => events.some((e) => e.type === 'connection' && e.connected));
  assert.equal(subscriptions, 7);
  const transferred = once(second, 'connection');
  old.send(frame('session_reconnect', { session: { reconnect_url: url(second) } }));
  const [next] = await transferred;
  const closed = once(old, 'close');
  next.send(frame('session_welcome', { session: { id: 'second', keepalive_timeout_seconds: 10 } }));
  await closed;
  assert.equal(subscriptions, 7);
  next.send('broken JSON');
  const follow = frame('notification', { subscription: { type: 'channel.follow' }, event: {} }, 'same-follow');
  next.send(follow);
  next.send(follow);
  next.send(frame('revocation', { subscription: { type: 'channel.follow', status: 'authorization_revoked' } }));
  await until(() => events.some((e) => e.type === 'status' && e.text.includes('revoked')));
  assert.equal(events.filter((e) => e.type === 'metric' && e.metric === 'follows').length, 1);
  assert.ok(events.some((e) => e.type === 'status' && e.text.includes('malformed JSON')));
  assert.deepEqual(events.filter((e) => e.type === 'connection').at(-1), { type: 'connection', connected: false });
});
