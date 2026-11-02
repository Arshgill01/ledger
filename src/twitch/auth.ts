import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  login: string;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  dataDir: string;
  channel: string;
}

export class TwitchAuth {
  private tokens?: TokenSet;
  private pendingState?: string;
  private refreshing?: Promise<TokenSet>;
  constructor(private readonly cfg: AuthConfig) {}

  private get file(): string {
    return `${this.cfg.dataDir}/auth.json`;
  }

  async load(): Promise<TokenSet | undefined> {
    try {
      this.tokens = JSON.parse(await readFile(this.file, 'utf8')) as TokenSet;
    } catch {
      this.tokens = undefined;
    }
    return this.tokens;
  }

  get current(): TokenSet | undefined {
    return this.tokens;
  }

  loginUrl(): string {
    this.pendingState = randomBytes(16).toString('hex');
    const u = new URL('https://id.twitch.tv/oauth2/authorize');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', this.cfg.scopes.join(' '));
    u.searchParams.set('state', this.pendingState);
    u.searchParams.set('force_verify', 'true');
    return u.toString();
  }

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    if (!this.pendingState || state !== this.pendingState) throw new Error('OAuth state mismatch');
    this.pendingState = undefined;
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.cfg.redirectUri,
    });
    return this.exchange(body);
  }

  private async exchange(body: URLSearchParams): Promise<TokenSet> {
    const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string[] };
    const who = await validate(json.access_token);
    if (who.login.toLowerCase() !== this.cfg.channel.toLowerCase()) {
      throw new Error(`Connect Twitch as broadcaster ${this.cfg.channel}, not ${who.login}`);
    }
    this.tokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      scopes: json.scope ?? [],
      userId: who.userId,
      login: who.login,
    };
    await mkdir(this.cfg.dataDir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
    return this.tokens;
  }

  refresh(): Promise<TokenSet> {
    if (this.refreshing) return this.refreshing;
    if (!this.tokens) return Promise.reject(new Error('not authenticated'));
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
    });
    this.refreshing = this.exchange(body).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  async accessToken(): Promise<string> {
    if (!this.tokens) throw new Error('not authenticated');
    if (Date.now() > this.tokens.expiresAt - 60_000) await this.refresh();
    return this.tokens.accessToken;
  }
}

export async function validate(token: string): Promise<{ userId: string; login: string; scopes: string[] }> {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
  if (!res.ok) throw new Error(`validate failed: ${res.status}`);
  const j = (await res.json()) as { user_id: string; login: string; scopes: string[] };
  return { userId: j.user_id, login: j.login, scopes: j.scopes };
}
