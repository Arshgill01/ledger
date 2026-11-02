import { EventEmitter } from 'node:events';
import { boardText, reduce } from './engine/ledger.js';
import type { Store } from './engine/store.js';
import type { Effect, IOU, LedgerEvent, LedgerState, Receipt } from './engine/types.js';
import { TranscriptWindow } from './engine/transcribe.js';
import type { Mode } from './config.js';
import type { SpeechStatus } from './speech.js';

export interface EffectSink {
  say(text: string, opts: { pin?: boolean; replyTo?: string }): Promise<{ messageId?: string } | void>;
  clip(iou: IOU, purpose: 'due' | 'payoff'): Promise<Partial<Receipt> | void>;
}

export interface ChatLine {
  at: string;
  login: string;
  text: string;
  fromBot?: boolean;
  pinned?: boolean;
}

export class Runtime extends EventEmitter {
  state!: LedgerState;
  sink?: EffectSink;
  readonly transcript = new TranscriptWindow();
  readonly chat: ChatLine[] = [];
  readonly status: string[] = [];
  twitchConnected = false;
  speech: SpeechStatus = { available: false, reason: 'Microphone transcription is not configured.', pending: 0, busy: false, capacity: 0, processed: 0, dropped: 0, stale: 0, failed: 0 };
  private dispatchQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: Store,
    readonly channel: string,
    readonly mode: Mode,
    readonly publicUrl: string,
    private readonly settings: Partial<LedgerState['settings']>,
  ) {
    super();
  }

  async init(): Promise<void> {
    this.state = await this.store.load(this.channel);
    this.state = { ...this.state, settings: { ...this.state.settings, ...this.settings } };
  }

  /** Operator-only view: includes mic transcript, chat, status log and voter ids. Public views come from server/views.ts. */
  snapshot() {
    return {
      mode: this.mode,
      channel: this.channel,
      publicUrl: this.publicUrl,
      twitchConnected: this.twitchConnected,
      state: this.state,
      transcript: this.transcript.all().slice(-30),
      chat: this.chat.slice(-60),
      status: this.status.slice(-20),
      speech: this.speech,
    };
  }

  setSpeech(status: SpeechStatus): void {
    this.speech = status;
    this.emit('speech', status);
  }

  log(text: string): void {
    this.status.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
    if (this.status.length > 200) this.status.shift();
    this.emit('status', text);
    console.log(`[ledger] ${text}`);
  }

  pushChat(line: ChatLine): void {
    this.chat.push(line);
    if (this.chat.length > 300) this.chat.shift();
    this.emit('chat', line);
  }

  pushTranscript(text: string, at = new Date().toISOString()): void {
    if (!text.trim()) return;
    this.transcript.push(text, at);
    this.emit('transcript', { at, text });
  }

  board(): string {
    return boardText(this.state, this.publicUrl);
  }

  dispatch(event: LedgerEvent): Promise<Effect[]> {
    const pending = this.dispatchQueue.then(() => this.apply(event));
    this.dispatchQueue = pending.catch(() => {});
    return pending;
  }

  private async apply(event: LedgerEvent): Promise<Effect[]> {
    const { state, effects } = reduce(this.state, event);
    await this.store.save(state);
    this.state = state;
    this.emit('state', state);
    for (const e of effects) void this.execute(e);
    return effects;
  }

  private async execute(e: Effect): Promise<void> {
    try {
      switch (e.type) {
        case 'overlay':
          this.emit('overlay', { event: e.event, iou: e.iou });
          break;
        case 'log':
          this.log(e.text);
          break;
        case 'say': {
          if (!this.sink) return;
          const res = await this.sink.say(e.text, { pin: e.pin, replyTo: e.replyTo });
          if (e.pin && res && res.messageId && e.iouId !== undefined) {
            await this.dispatch({ type: 'iou.receipt', id: e.iouId, receipt: { messageId: res.messageId }, at: new Date().toISOString() });
          }
          break;
        }
        case 'clip': {
          if (!this.sink) return;
          const iou = this.state.ious.find((i) => i.id === e.iouId);
          if (!iou) return;
          const receipt = await this.sink.clip(iou, e.purpose);
          if (receipt) await this.dispatch({ type: 'iou.receipt', id: e.iouId, receipt, at: new Date().toISOString() });
          break;
        }
      }
    } catch (err) {
      this.log(`effect ${e.type} failed: ${(err as Error).message}`);
    }
  }
}
