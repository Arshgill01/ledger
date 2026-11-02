import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwitchAuth } from '../src/twitch/auth.js';

test('OAuth rejects another broadcaster before saving, and concurrent refreshes share one request', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-auth-'));
  let login = 'someoneelse';
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    if (String(url).endsWith('/token')) {
      exchanges++;
      return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: [] });
    }
    return Response.json({ user_id: '1', login, scopes: [] });
  });
  const auth = new TwitchAuth({ clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://localhost:3000/auth/callback', scopes: [], channel: 'arsh', dataDir: dir });
  try {
    let state = new URL(auth.loginUrl()).searchParams.get('state')!;
    await assert.rejects(auth.handleCallback('code', state), /Connect Twitch as broadcaster arsh/);
    assert.equal(auth.current, undefined);
    await assert.rejects(readFile(join(dir, 'auth.json')), { code: 'ENOENT' });
    login = 'arsh';
    state = new URL(auth.loginUrl()).searchParams.get('state')!;
    const connected = await auth.handleCallback('code', state);
    exchanges = 0;
    await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);
    assert.equal(exchanges, 1);
    assert.equal(connected.login, 'arsh');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
