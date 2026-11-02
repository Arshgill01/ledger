import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';

/**
 * Who may use the operator (streamer) surface.
 *
 * - Public: overlay, public ledger, landing page. Read-only, redacted data (see views.ts).
 * - Operator: panel data (transcript, chat, status, voters) and every mutation.
 *
 * Operators sign in with a key that lives only on the streamer's machine (data/operator.key or
 * OPERATOR_KEY). The browser gets an HttpOnly, SameSite=Strict cookie derived from the key, so the
 * key itself is never served in JS and never sent by cross-site requests. Demo mode turns the check
 * off (synthetic data, no providers) but keeps the Origin checks.
 */
export interface AccessPolicy {
  operatorRequired: boolean;
  /** Operator key; required when operatorRequired. */
  key?: string;
  /** Origin of PUBLIC_URL, accepted in addition to the request's own Host (tunnels that rewrite Host). */
  publicOrigin?: string;
}

export const COOKIE = 'ledger_operator';
const MIN_KEY_LENGTH = 24;

export function sessionValue(key: string): string {
  return createHmac('sha256', key).update('ledger-operator-session-v1').digest('base64url');
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkKey(policy: AccessPolicy, candidate: unknown): boolean {
  return !!policy.key && typeof candidate === 'string' && candidate.length > 0 && sameSecret(policy.key, candidate.trim());
}

function cookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

export function isOperator(policy: AccessPolicy, req: IncomingMessage): boolean {
  if (!policy.operatorRequired) return true;
  if (!policy.key) return false;
  const got = cookies(req).get(COOKIE);
  return !!got && sameSecret(got, sessionValue(policy.key));
}

/** HTTPS tunnels (ngrok, cloudflared) terminate TLS and set X-Forwarded-Proto. */
function isHttps(req: IncomingMessage): boolean {
  return String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
}

export function loginCookie(policy: AccessPolicy, req: IncomingMessage): string {
  if (!policy.key) throw new Error('no operator key');
  const secure = isHttps(req) ? '; Secure' : '';
  return `${COOKIE}=${sessionValue(policy.key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86_400}${secure}`;
}

export function logoutCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Browsers send Origin on every POST and every WebSocket handshake. A request with no Origin is a
 * non-browser client (curl, OBS's own fetch, tests) and still needs the operator cookie for private
 * routes. A request whose Origin is another site is refused outright: that is a page the streamer
 * happened to visit trying to drive or read the local server.
 */
export function originAllowed(policy: AccessPolicy, req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers.host) return true;
  return !!policy.publicOrigin && origin === policy.publicOrigin;
}

/** OPERATOR_KEY wins; otherwise data/operator.key is created once (mode 0600) and reused across restarts. */
export async function loadOrCreateOperatorKey(dataDir: string, envKey?: string): Promise<string> {
  if (envKey) {
    if (envKey.length < MIN_KEY_LENGTH) throw new Error(`OPERATOR_KEY must be at least ${MIN_KEY_LENGTH} characters`);
    return envKey;
  }
  const file = `${dataDir}/operator.key`;
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length >= MIN_KEY_LENGTH) {
      await chmod(file, 0o600).catch(() => {});
      return existing;
    }
  } catch {
    /* create below */
  }
  const key = randomBytes(24).toString('base64url');
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, `${key}\n`, { mode: 0o600 });
  return key;
}
