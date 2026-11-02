import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

// Block outbound fetches inside the app: synthetic input must succeed even with keys configured.
test('demo serves all surfaces and extracts typed promises without external requests', { timeout: 10000 }, async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    globalThis.fetch = async () => { throw new Error('unexpected external request in demo'); };
    await import('./src/index.ts');
  `], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), RECEIPTS_MODE: 'demo', OPENAI_API_KEY: 'synthetic-test-key', TWITCH_CLIENT_ID: 'synthetic-client', TWITCH_CLIENT_SECRET: 'synthetic-secret', TWITCH_CHANNEL: 'synthetic-channel' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (b) => { output += b; if (output.includes('overlay: /overlay')) resolve(); });
      child.stderr.on('data', (b) => { output += b; });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`demo exited ${code}: ${output}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    for (const path of ['/', '/panel', '/overlay', '/ledger', '/ledger/demo']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    const posted = await fetch(`${base}/api/transcript`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'I owe chat a song' }) });
    assert.equal(posted.status, 200, await posted.text());
    // Demo needs no operator sign-in; the public feed stays redacted.
    assert.equal((await (await fetch(`${base}/api/session`)).json()).operator, true);
    const pub = await (await fetch(`${base}/api/public/state`)).json();
    assert.equal(pub.mode, 'demo');
    assert.equal(pub.transcript, undefined);
    assert.ok(pub.ious.some((i: { text: string }) => /song/.test(i.text)));
    assert.equal((await fetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ type: 'stream.offline' }) })).status, 403);
    const snapshot = await (await fetch(`${base}/api/state`)).json();
    assert.equal(snapshot.mode, 'demo');
    assert.ok(snapshot.state.ious.some((i: { text: string }) => /song/.test(i.text)));
    assert.equal((await fetch(`${base}/api/audio`, { method: 'POST', body: 'test' })).status, 400);
    assert.equal((await fetch(`${base}/auth/login`, { redirect: 'manual' })).status, 400);
  } finally {
    const exited = once(child, 'exit');
    if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
  }
});
