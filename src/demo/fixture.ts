import { readFile } from 'node:fs/promises';
import type { Runtime } from '../runtime.js';
import type { ChatMessage } from '../twitch/eventsub.js';
import type { ExtractedPromise, IOU, LedgerState, Receipt } from '../engine/types.js';
import { initialState } from '../engine/ledger.js';
import { handleCommand } from '../twitch/commands.js';

export type FixtureStep =
  | { at: number; type: 'transcript'; text: string }
  | { at: number; type: 'promises'; promises: ExtractedPromise[] }
  | { at: number; type: 'chat'; login: string; text: string; mod?: boolean }
  | { at: number; type: 'metric'; metric: 'subs' | 'follows' | 'bits' | 'raiders' | 'viewers'; delta?: number; value?: number }
  | { at: number; type: 'stream.online' | 'stream.offline' }
  | { at: number; type: 'status'; text: string };

export interface Fixture {
  name: string;
  channel: string;
  seed?: { note?: string; ious: IOU[] };
  steps: FixtureStep[];
}

/** State the demo starts from: the seed IOUs, dated a week ago, so the carry-over story is visible on first load. */
export function seededState(fixture: Fixture): LedgerState {
  const base = initialState(fixture.channel);
  const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const ious = (fixture.seed?.ious ?? []).map((i) => ({ ...i, createdAt: i.createdAt === '__LAST_WEEK__' ? lastWeek : i.createdAt }));
  return { ...base, ious, nextId: Math.max(0, ...ious.map((i) => i.id)) + 1 };
}

export async function loadFixture(path: string): Promise<Fixture> {
  return JSON.parse(await readFile(path, 'utf8')) as Fixture;
}

export class DemoSink {
  constructor(private readonly rt: Runtime) {}
  async say(text: string, opts: { pin?: boolean; replyTo?: string }) {
    const messageId = `demo-${Date.now()}`;
    this.rt.pushChat({ at: new Date().toISOString(), login: 'LedgerBot', text, fromBot: true, pinned: !!opts.pin });
    return { messageId };
  }
  async clip(iou: IOU, purpose: 'due' | 'payoff'): Promise<Partial<Receipt>> {
    await new Promise((r) => setTimeout(r, 1500));
    const id = `DemoClip${iou.id}${purpose === 'payoff' ? 'Payoff' : ''}`;
    this.rt.log(`DEMO: pretend clip created for IOU #${iou.id} (${purpose})`);
    return purpose === 'due'
      ? { clipId: id, clipUrl: `${this.rt.publicUrl}/ledger#demo-clip-${id}`, thumbnailUrl: '/img/demo-clip.svg' }
      : { payoffClipId: id, payoffClipUrl: `${this.rt.publicUrl}/ledger#demo-clip-${id}` };
  }
}

export class FixtureRunner {
  private timers: NodeJS.Timeout[] = [];
  private startedAt = 0;
  running = false;

  constructor(private readonly rt: Runtime, private readonly fixture: Fixture, private readonly speed = 1) {}

  start(): void {
    this.stop();
    this.running = true;
    this.startedAt = Date.now();
    this.rt.log(`DEMO: playing fixture "${this.fixture.name}" (${this.fixture.steps.length} steps)`);
    for (const step of this.fixture.steps) {
      this.timers.push(setTimeout(() => void this.run(step), (step.at * 1000) / this.speed));
    }
    const last = Math.max(...this.fixture.steps.map((s) => s.at));
    this.timers.push(setTimeout(() => { this.running = false; this.rt.log('DEMO: fixture finished. Restart from the panel or type a promise yourself.'); }, (last * 1000) / this.speed + 500));
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.running = false;
  }

  elapsed(): number {
    return this.running ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  async chat(msg: ChatMessage): Promise<void> {
    this.rt.pushChat({ at: new Date().toISOString(), login: msg.displayName, text: msg.text });
    const result = handleCommand(msg, { publicUrl: this.rt.publicUrl, boardText: () => this.rt.board(), now: () => new Date().toISOString() });
    if (!result) return;
    for (const ev of result.events) await this.rt.dispatch(ev);
    if (result.reply && this.rt.sink) await this.rt.sink.say(result.reply, { replyTo: msg.messageId });
  }

  private async run(step: FixtureStep): Promise<void> {
    const at = new Date().toISOString();
    switch (step.type) {
      case 'transcript':
        this.rt.pushTranscript(step.text, at);
        break;
      case 'promises':
        await this.rt.dispatch({ type: 'promises.extracted', promises: step.promises, source: 'fixture', at });
        break;
      case 'chat':
        await this.chat({
          messageId: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: `demo_${step.login.toLowerCase()}`,
          login: step.login.toLowerCase(),
          displayName: step.login,
          text: step.text,
          isBroadcaster: false,
          isMod: !!step.mod,
        });
        break;
      case 'metric':
        await this.rt.dispatch({ type: 'metric', metric: step.metric, delta: step.delta, value: step.value, at });
        break;
      case 'stream.online':
        await this.rt.dispatch({ type: 'stream.online', streamId: `demo-${Date.now()}`, at });
        break;
      case 'stream.offline':
        await this.rt.dispatch({ type: 'stream.offline', at });
        break;
      case 'status':
        this.rt.log(`DEMO: ${step.text}`);
        break;
    }
  }
}
