import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { Runtime } from '../runtime.js';
import type { EnqueueResult } from '../speech.js';
import { type AccessPolicy, checkKey, isOperator, loginCookie, logoutCookie, originAllowed } from './access.js';
import { parsePanelAction } from './actions.js';
import { PUBLIC_OVERLAY_EVENTS, publicIou, publicSnapshot } from './views.js';

export interface HttpHandlers {
  /** Queue one recorded segment. Absent when no speech backend is configured. */
  onAudio?: (audio: Buffer, mime: string, session: string) => EnqueueResult;
  onTranscript?: (text: string) => Promise<void>;
  onDemoRestart?: () => void;
  onDemoChat?: (login: string, text: string) => Promise<void>;
  authLoginUrl?: () => string;
  authCallback?: (code: string, state: string) => Promise<void>;
}

export interface HttpOptions {
  publicDir: string;
  access: AccessPolicy;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};
const JSON_LIMIT = 16 * 1024;
const AUDIO_LIMIT = 2 * 1024 * 1024; // a 4 s opus segment is ~50 KB
const AUDIO_MIN = 2000;
const MAX_TRANSCRIPT = 2000;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) throw new HttpError(413, 'body too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Requiring application/json means a cross-origin page can't send this as a "simple" request. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'expected application/json');
  const raw = (await readBody(req, JSON_LIMIT)).toString();
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

export function createHttp(rt: Runtime, handlers: HttpHandlers, opts: HttpOptions): Server {
  const { access, publicDir } = opts;
  const demo = rt.mode === 'demo';

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) rt.log(`http error: ${(err as Error).message}`);
      if (!res.headersSent) json(res, status, { error: (err as Error).message });
      else res.end();
    }
  });

  async function serveStatic(res: ServerResponse, urlPath: string): Promise<boolean> {
    let p = urlPath;
    if (p === '/') p = '/index.html';
    if (p === '/overlay' || p === '/panel' || p === '/ledger') p = `${p}/index.html`;
    if (/^\/ledger\/[^/.]+$/.test(p)) p = '/ledger/index.html';
    const file = normalize(join(publicDir, p));
    if (!file.startsWith(normalize(publicDir))) return false;
    try {
      const st = await stat(file);
      if (!st.isFile()) return false;
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(file));
      return true;
    } catch {
      return false;
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (!originAllowed(access, req)) return json(res, 403, { error: 'cross-origin request refused' });

    // ---- public ----
    if (method === 'GET' && path === '/api/public/state') return json(res, 200, publicSnapshot(rt.state, rt.mode));
    if (method === 'GET' && path === '/api/session') {
      return json(res, 200, { mode: rt.mode, channel: rt.channel, operator: isOperator(access, req), operatorRequired: access.operatorRequired });
    }
    if (method === 'POST' && path === '/api/operator/login') {
      if (!access.operatorRequired) return json(res, 200, { ok: true });
      const { key } = await readJson(req);
      if (!checkKey(access, key)) {
        await new Promise((r) => setTimeout(r, 400));
        return json(res, 401, { error: 'wrong operator key' });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(access, req) });
    }
    if (method === 'POST' && path === '/api/operator/logout') return json(res, 200, { ok: true }, { 'Set-Cookie': logoutCookie() });
    if (method === 'GET' && path === '/auth/callback') {
      // Top-level redirect from twitch.com: SameSite=Strict cookies are not sent. Protected by the OAuth state instead.
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state || !handlers.authCallback) return json(res, 400, { error: 'missing code' });
      await handlers.authCallback(code, state);
      res.writeHead(302, { Location: '/panel' });
      res.end();
      return;
    }

    // ---- operator only ----
    if (path.startsWith('/api/') || path === '/auth/login') {
      if (!isOperator(access, req)) return json(res, 401, { error: 'operator sign-in required' });

      if (method === 'GET' && path === '/api/state') return json(res, 200, rt.snapshot());

      if (method === 'POST' && path === '/api/event') {
        const parsed = parsePanelAction(await readJson(req), { demo, channel: rt.channel, at: new Date().toISOString() });
        if (!parsed.ok) return json(res, 400, { error: parsed.error });
        const effects = await rt.dispatch(parsed.event);
        return json(res, 200, { ok: true, effects: effects.length });
      }

      if (method === 'POST' && path === '/api/transcript') {
        const { text } = await readJson(req);
        if (typeof text !== 'string' || !text.trim()) return json(res, 400, { error: 'empty' });
        if (text.length > MAX_TRANSCRIPT) return json(res, 413, { error: `transcript over ${MAX_TRANSCRIPT} characters` });
        await handlers.onTranscript?.(text);
        return json(res, 200, { ok: true });
      }

      if (method === 'POST' && path === '/api/audio') {
        if (!handlers.onAudio) return json(res, 400, { error: rt.speech.reason ?? 'audio not available in this mode' });
        const session = String(req.headers['x-mic-session'] ?? '');
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) return json(res, 400, { error: 'missing X-Mic-Session' });
        const mime = String(req.headers['content-type'] ?? '');
        if (!/^audio\/[a-z0-9.+-]+/i.test(mime)) return json(res, 415, { error: 'expected audio/* content type' });
        const body = await readBody(req, AUDIO_LIMIT);
        if (body.length < AUDIO_MIN) return json(res, 400, { error: 'segment too small' });
        const r = handlers.onAudio(body, mime, session);
        if (!r.accepted) return json(res, 429, { error: 'speech backlog full; segment dropped', speech: rt.speech }, { 'Retry-After': '4' });
        return json(res, 202, { accepted: true, pending: r.pending });
      }

      if (method === 'POST' && path === '/api/demo/chat') {
        if (!handlers.onDemoChat) return json(res, 400, { error: 'only in demo mode' });
        const { login, text } = await readJson(req);
        if (typeof text !== 'string' || !text.trim() || text.length > 500) return json(res, 400, { error: 'empty' });
        const who = typeof login === 'string' && /^[A-Za-z0-9_]{1,25}$/.test(login) ? login : 'you';
        await handlers.onDemoChat(who, text.trim());
        return json(res, 200, { ok: true });
      }

      if (method === 'POST' && path === '/api/demo/restart') {
        if (!handlers.onDemoRestart) return json(res, 400, { error: 'only in demo mode' });
        handlers.onDemoRestart();
        return json(res, 200, { ok: true });
      }

      if (method === 'GET' && path === '/auth/login') {
        if (!handlers.authLoginUrl) return json(res, 400, { error: 'Twitch not configured. Fill .env and restart.' });
        res.writeHead(302, { Location: handlers.authLoginUrl() });
        res.end();
        return;
      }
      return json(res, 404, { error: 'not found' });
    }

    if (method === 'GET' && (await serveStatic(res, path))) return;
    json(res, 404, { error: 'not found' });
  }

  // ---- WebSockets: /ws is public (overlay, ledger), /ws/operator is the panel ----
  const publicWss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const operatorWss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!originAllowed(access, req)) return reject('403 Forbidden');
    if (path === '/ws') return publicWss.handleUpgrade(req, socket, head, (ws) => publicWss.emit('connection', ws, req));
    if (path === '/ws/operator') {
      if (!isOperator(access, req)) return reject('401 Unauthorized');
      return operatorWss.handleUpgrade(req, socket, head, (ws) => operatorWss.emit('connection', ws, req));
    }
    reject('404 Not Found');
  });

  const send = (wss: WebSocketServer, msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
  };
  publicWss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'snapshot', snapshot: publicSnapshot(rt.state, rt.mode) })));
  operatorWss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'snapshot', ...rt.snapshot() })));

  const listeners: [string, (...a: any[]) => void][] = [
    ['state', (state) => {
      send(operatorWss, { type: 'state', state });
      send(publicWss, { type: 'state', snapshot: publicSnapshot(state, rt.mode) });
    }],
    ['overlay', (p) => {
      send(operatorWss, { type: 'overlay', ...p });
      const iou = publicIou(p.iou);
      if (iou && PUBLIC_OVERLAY_EVENTS.has(p.event)) send(publicWss, { type: 'overlay', event: p.event, iou });
    }],
    ['transcript', (line) => send(operatorWss, { type: 'transcript', line })],
    ['chat', (line) => send(operatorWss, { type: 'chat', line })],
    ['status', (text) => send(operatorWss, { type: 'status', text, twitchConnected: rt.twitchConnected })],
    ['speech', (speech) => send(operatorWss, { type: 'speech', speech })],
  ];
  for (const [ev, fn] of listeners) rt.on(ev, fn);
  // Upgraded sockets keep server.close() waiting forever, so closing the server terminates them first.
  const closeHttp = server.close.bind(server);
  server.close = ((cb?: (err?: Error) => void) => {
    for (const [ev, fn] of listeners) rt.off(ev, fn);
    for (const wss of [publicWss, operatorWss]) {
      for (const c of wss.clients) c.terminate();
      wss.close();
    }
    return closeHttp(cb);
  }) as typeof server.close;
  return server;
}

export function startHttp(rt: Runtime, handlers: HttpHandlers, opts: HttpOptions & { port: number; host: string }): Promise<Server> {
  const server = createHttp(rt, handlers, opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      const shown = opts.host === '127.0.0.1' || opts.host === '::1' ? 'localhost' : opts.host;
      rt.log(`Ledger (${rt.mode}) on http://${shown}:${opts.port}  overlay: /overlay  panel: /panel  ledger: /ledger`);
      resolve(server);
    });
  });
}
