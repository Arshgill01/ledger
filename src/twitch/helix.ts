export interface HelixOptions {
  clientId: string;
  token: () => Promise<string>;
  onUnauthorized?: () => Promise<void>;
}

export class HelixError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class Helix {
  constructor(private readonly opts: HelixOptions) {}

  async request<T>(method: string, path: string, params?: Record<string, string | string[] | undefined>, body?: unknown, retry = true): Promise<T> {
    const url = new URL(`https://api.twitch.tv/helix/${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      method,
      headers: {
        'Client-Id': this.opts.clientId,
        Authorization: `Bearer ${await this.opts.token()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry && this.opts.onUnauthorized) {
      await this.opts.onUnauthorized();
      return this.request(method, path, params, body, false);
    }
    if (!res.ok) throw new HelixError(res.status, `${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async getUserByLogin(login: string): Promise<{ id: string; login: string; display_name: string } | undefined> {
    const r = await this.request<{ data: { id: string; login: string; display_name: string }[] }>('GET', 'users', { login });
    return r.data[0];
  }

  async getStream(userId: string): Promise<{ id: string; viewer_count: number; title: string; game_name: string; started_at: string } | undefined> {
    const r = await this.request<{ data: { id: string; viewer_count: number; title: string; game_name: string; started_at: string }[] }>('GET', 'streams', { user_id: userId });
    return r.data[0];
  }

  async sendChat(broadcasterId: string, senderId: string, message: string, opts: { replyTo?: string; pin?: boolean } = {}): Promise<{ messageId?: string; sent: boolean; dropReason?: string }> {
    const body: Record<string, unknown> = { broadcaster_id: broadcasterId, sender_id: senderId, message: message.slice(0, 500) };
    if (opts.pin) body.pin = true;
    else if (opts.replyTo) body.reply_parent_message_id = opts.replyTo;
    const r = await this.request<{ data: { message_id: string; is_sent: boolean; drop_reason?: { message: string } }[] }>('POST', 'chat/messages', undefined, body);
    const d = r.data[0];
    return { messageId: d?.message_id, sent: !!d?.is_sent, dropReason: d?.drop_reason?.message };
  }

  async createClip(broadcasterId: string): Promise<{ id: string; edit_url: string }> {
    const r = await this.request<{ data: { id: string; edit_url: string }[] }>('POST', 'clips', { broadcaster_id: broadcasterId });
    return r.data[0];
  }

  async getClip(id: string): Promise<{ id: string; url: string; thumbnail_url: string; title: string } | undefined> {
    const r = await this.request<{ data: { id: string; url: string; thumbnail_url: string; title: string }[] }>('GET', 'clips', { id });
    return r.data[0];
  }

  async createEventSub(type: string, version: string, condition: Record<string, string>, sessionId: string): Promise<void> {
    await this.request('POST', 'eventsub/subscriptions', undefined, {
      type,
      version,
      condition,
      transport: { method: 'websocket', session_id: sessionId },
    });
  }
}
