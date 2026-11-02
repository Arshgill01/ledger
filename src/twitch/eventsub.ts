import WebSocket from 'ws';
import type { Helix } from './helix.js';

export interface ChatMessage {
  messageId: string;
  userId: string;
  login: string;
  displayName: string;
  text: string;
  isBroadcaster: boolean;
  isMod: boolean;
  sourceBroadcasterId?: string;
}

export type TwitchEvent =
  | { type: 'chat'; message: ChatMessage }
  | { type: 'metric'; metric: 'subs' | 'follows' | 'bits' | 'raiders'; delta?: number; value?: number }
  | { type: 'stream.online'; streamId: string }
  | { type: 'stream.offline' }
  | { type: 'connection'; connected: boolean }
  | { type: 'status'; text: string };

interface Frame {
  metadata: { message_type: string; subscription_type?: string; message_id?: string };
  payload: {
    session?: { id: string; reconnect_url?: string; keepalive_timeout_seconds?: number };
    subscription?: { type: string; status?: string };
    event?: Record<string, unknown>;
  };
}

const WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

export class EventSubClient {
  private ws?: WebSocket;
  private keepaliveTimer?: NodeJS.Timeout;
  private keepaliveMs = 15_000;
  private closed = false;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly sockets = new Set<WebSocket>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly helix: Helix,
    private readonly ids: { broadcasterId: string; userId: string },
    private readonly onEvent: (e: TwitchEvent) => void,
  ) {}

  start(url = WS_URL): void {
    this.stop();
    this.closed = false;
    this.connect(url, false);
  }

  stop(): void {
    this.closed = true;
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    this.ws = undefined;
    this.onEvent({ type: 'connection', connected: false });
  }

  private connect(url: string, isReconnect: boolean): void {
    const ws = new WebSocket(url);
    const old = this.ws;
    this.sockets.add(ws);
    ws.on('message', (data) => {
      if (this.closed) return;
      try {
        const frame = JSON.parse(data.toString()) as Frame;
        void this.handle(ws, frame, isReconnect, old).catch((err) => {
          this.onEvent({ type: 'status', text: `EventSub frame failed: ${(err as Error).message}` });
        });
      } catch {
        this.onEvent({ type: 'status', text: 'EventSub ignored malformed JSON' });
      }
    });
    ws.on('close', () => {
      this.sockets.delete(ws);
      if (this.ws !== ws || this.closed) return;
      if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
      for (const remaining of this.sockets) remaining.terminate();
      this.onEvent({ type: 'connection', connected: false });
      this.onEvent({ type: 'status', text: 'EventSub socket closed, reconnecting in 3s' });
      this.reconnectTimer = setTimeout(() => !this.closed && this.connect(WS_URL, false), 3000);
    });
    ws.on('error', (err) => this.onEvent({ type: 'status', text: `EventSub error: ${err.message}` }));
    this.ws = ws;
    this.bumpKeepalive();
  }

  private bumpKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      this.onEvent({ type: 'status', text: 'EventSub keepalive missed, reconnecting' });
      this.ws?.terminate();
    }, this.keepaliveMs + 5000);
  }

  private async handle(ws: WebSocket, frame: Frame, isReconnect: boolean, old?: WebSocket): Promise<void> {
    if (this.closed || !this.sockets.has(ws)) return;
    if (this.ws === ws) this.bumpKeepalive();
    const t = frame.metadata.message_type;
    if (t === 'session_welcome') {
      const session = frame.payload.session!;
      this.keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000;
      this.bumpKeepalive();
      if (isReconnect) {
        old?.close();
        this.onEvent({ type: 'connection', connected: true });
        this.onEvent({ type: 'status', text: 'EventSub reconnected' });
        return;
      }
      try {
        const ready = await this.subscribeAll(session.id);
        if (this.closed || this.ws !== ws) return;
        this.onEvent({ type: 'connection', connected: ready });
      } catch (err) {
        this.onEvent({ type: 'status', text: `EventSub subscribe failed: ${(err as Error).message}` });
      }
      return;
    }
    if (t === 'session_reconnect') {
      const url = frame.payload.session?.reconnect_url;
      if (url) this.connect(url, true);
      return;
    }
    if (t === 'revocation') {
      this.onEvent({ type: 'connection', connected: false });
      this.onEvent({ type: 'status', text: `EventSub revoked ${frame.payload.subscription?.type}: ${frame.payload.subscription?.status}` });
    }
    if (t === 'notification') {
      const id = frame.metadata.message_id;
      if (id && this.seen.has(id)) return;
      if (id) {
        this.seen.add(id);
        if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
      }
      this.notify(frame.payload.subscription!.type, frame.payload.event ?? {});
    }
  }

  private async subscribeAll(sessionId: string): Promise<boolean> {
    const b = this.ids.broadcasterId;
    const u = this.ids.userId;
    const subs: [string, string, Record<string, string>][] = [
      ['channel.chat.message', '1', { broadcaster_user_id: b, user_id: u }],
      ['channel.chat.notification', '1', { broadcaster_user_id: b, user_id: u }],
      ['channel.follow', '2', { broadcaster_user_id: b, moderator_user_id: u }],
      ['channel.cheer', '1', { broadcaster_user_id: b }],
      ['channel.raid', '1', { to_broadcaster_user_id: b }],
      ['stream.online', '1', { broadcaster_user_id: b }],
      ['stream.offline', '1', { broadcaster_user_id: b }],
    ];
    const results = await Promise.allSettled(subs.map(([type, version, condition]) => this.helix.createEventSub(type, version, condition, sessionId)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') this.onEvent({ type: 'status', text: `subscribe ${subs[i][0]} failed: ${(r.reason as Error).message}` });
    });
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    this.onEvent({ type: 'status', text: `EventSub subscriptions: ${succeeded}/${subs.length} active` });
    return results.every((r) => r.status === 'fulfilled');
  }

  private notify(type: string, ev: Record<string, unknown>): void {
    const str = (k: string) => (ev[k] as string | undefined) ?? '';
    switch (type) {
      case 'channel.chat.message': {
        const badges = (ev.badges as { set_id: string }[] | undefined) ?? [];
        const has = (id: string) => badges.some((b) => b.set_id === id);
        this.onEvent({
          type: 'chat',
          message: {
            messageId: str('message_id'),
            userId: str('chatter_user_id'),
            login: str('chatter_user_login'),
            displayName: str('chatter_user_name'),
            text: ((ev.message as { text?: string } | undefined)?.text ?? '').trim(),
            isBroadcaster: has('broadcaster') || str('chatter_user_id') === this.ids.broadcasterId,
            isMod: has('moderator'),
            sourceBroadcasterId: (ev.source_broadcaster_user_id as string | null | undefined) ?? undefined,
          },
        });
        break;
      }
      case 'channel.chat.notification': {
        const notice = str('notice_type');
        if (notice === 'sub' || notice === 'resub') this.onEvent({ type: 'metric', metric: 'subs', delta: 1 });
        else if (notice === 'sub_gift') this.onEvent({ type: 'metric', metric: 'subs', delta: 1 });
        else if (notice === 'community_sub_gift') {
          const total = (ev.community_sub_gift as { total?: number } | undefined)?.total ?? 1;
          this.onEvent({ type: 'metric', metric: 'subs', delta: total });
        }
        break;
      }
      case 'channel.follow':
        this.onEvent({ type: 'metric', metric: 'follows', delta: 1 });
        break;
      case 'channel.cheer':
        this.onEvent({ type: 'metric', metric: 'bits', delta: Number(ev.bits ?? 0) });
        break;
      case 'channel.raid':
        this.onEvent({ type: 'metric', metric: 'raiders', value: Number(ev.viewers ?? 0) });
        break;
      case 'stream.online':
        this.onEvent({ type: 'stream.online', streamId: str('id') });
        break;
      case 'stream.offline':
        this.onEvent({ type: 'stream.offline' });
        break;
    }
  }
}
