import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Runtime } from '../runtime.js';
import type { LedgerEvent } from '../engine/types.js';

export interface HttpHandlers {
  onAudio?: (audio: Buffer, mime: string) => Promise<void>;
  onTranscript?: (text: string) => Promise<void>;
  onDemoRestart?: () => void;
  onDemoChat?: (login: string, text: string) => Promise<void>;
  authLoginUrl?: () => string;
  authCallback?: (code: string, state: string) => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 15 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function startHttp(rt: Runtime, handlers: HttpHandlers, port: number, publicDir: string): void {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      rt.log(`http error: ${(err as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    }
  });

  async function serveStatic(res: ServerResponse, urlPath: string): Promise<boolean> {
    let p = urlPath.split('?')[0];
    if (p === '/' ) p = '/index.html';
    if (p === '/overlay' || p === '/panel' || p === '/ledger') p = `${p}/index.html`;
    if (/^\/ledger\/[^/.]+$/.test(p)) p = '/ledger/index.html';
    const file = normalize(join(publicDir, p));
    if (!file.startsWith(normalize(publicDir))) return false;
    try {
      const st = await stat(file);
      if (!st.isFile()) return false;
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
      return true;
    } catch {
      return false;
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/state') return json(res, 200, rt.snapshot());

    if (req.method === 'POST' && path === '/api/event') {
      const ev = JSON.parse((await readBody(req)).toString()) as LedgerEvent;
      if (!ev || typeof ev.type !== 'string') return json(res, 400, { error: 'bad event' });
      const effects = await rt.dispatch({ ...ev, at: ev.at || new Date().toISOString() } as LedgerEvent);
      return json(res, 200, { ok: true, effects: effects.length });
    }

    if (req.method === 'POST' && path === '/api/transcript') {
      const { text } = JSON.parse((await readBody(req)).toString()) as { text: string };
      if (!text?.trim()) return json(res, 400, { error: 'empty' });
      await handlers.onTranscript?.(text);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/audio') {
      if (!handlers.onAudio) return json(res, 400, { error: 'audio not available in this mode' });
      const body = await readBody(req);
      await handlers.onAudio(body, req.headers['content-type'] ?? 'audio/webm');
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/demo/chat') {
      if (!handlers.onDemoChat) return json(res, 400, { error: 'only in demo mode' });
      const { login, text } = JSON.parse((await readBody(req)).toString()) as { login?: string; text: string };
      if (!text?.trim()) return json(res, 400, { error: 'empty' });
      await handlers.onDemoChat(login || 'you', text.trim());
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && path === '/api/demo/restart') {
      handlers.onDemoRestart?.();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/auth/login') {
      if (!handlers.authLoginUrl) return json(res, 400, { error: 'Twitch not configured. Fill .env and restart.' });
      res.writeHead(302, { Location: handlers.authLoginUrl() });
      res.end();
      return;
    }

    if (req.method === 'GET' && path === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state || !handlers.authCallback) return json(res, 400, { error: 'missing code' });
      await handlers.authCallback(code, state);
      res.writeHead(302, { Location: '/panel' });
      res.end();
      return;
    }

    if (req.method === 'GET' && (await serveStatic(res, path))) return;
    json(res, 404, { error: 'not found' });
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
  };
  wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'snapshot', ...rt.snapshot() })));
  rt.on('state', (state) => broadcast({ type: 'state', state }));
  rt.on('overlay', (p) => broadcast({ type: 'overlay', ...p }));
  rt.on('transcript', (line) => broadcast({ type: 'transcript', line }));
  rt.on('chat', (line) => broadcast({ type: 'chat', line }));
  rt.on('status', (text) => broadcast({ type: 'status', text, twitchConnected: rt.twitchConnected }));

  server.listen(port, () => rt.log(`Ledger (${rt.mode}) on http://localhost:${port}  overlay: /overlay  panel: /panel  ledger: /ledger`));
}
