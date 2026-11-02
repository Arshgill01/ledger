export type IOUState = 'PENDING' | 'OPEN' | 'DUE' | 'PAID' | 'WELCHED' | 'VOID';

export type CountMetric = 'subs' | 'follows' | 'bits' | 'raiders' | 'viewers';

export type Condition =
  | { kind: 'count'; metric: CountMetric; target: number; progress: number; window: 'stream' | 'forever' }
  | { kind: 'time'; deadline: string; label: string }
  | { kind: 'event'; label: string }
  | { kind: 'none' };

export interface Receipt {
  clipId?: string;
  clipUrl?: string;
  thumbnailUrl?: string;
  messageId?: string;
  payoffClipId?: string;
  payoffClipUrl?: string;
}

export interface IOU {
  id: number;
  channel: string;
  text: string;
  quote: string;
  stake: string;
  condition: Condition;
  state: IOUState;
  confidence: number;
  createdAt: string;
  dueAt?: string;
  settledAt?: string;
  streamId?: string;
  receipt: Receipt;
  votes: { paid: string[]; cap: string[] };
  source: 'speech' | 'chat' | 'manual' | 'fixture';
}

export interface LedgerState {
  channel: string;
  nextId: number;
  ious: IOU[];
  streamId?: string;
  streamStartedAt?: string;
  counters: Record<CountMetric, number>;
  settings: { voteQuorum: number; extractionMode: 'auto' | 'approval'; autoPin: boolean; autoClip: boolean; autoThreshold: number };
}

export interface ExtractedPromise {
  text: string;
  quote: string;
  stake: string;
  condition: Condition;
  confidence: number;
}

export type Actor = { userId: string; login: string; isBroadcaster: boolean; isMod: boolean };

export type LedgerEvent =
  | { type: 'promises.extracted'; promises: ExtractedPromise[]; source: IOU['source']; at: string }
  | { type: 'iou.manual'; text: string; actor: Actor; at: string }
  | { type: 'iou.approve'; id: number; edits?: Partial<Pick<IOU, 'text' | 'stake' | 'condition'>>; at: string }
  | { type: 'iou.dismiss'; id: number; at: string }
  | { type: 'iou.due'; id: number; actor?: Actor; at: string }
  | { type: 'iou.paid'; id: number; actor?: Actor; at: string }
  | { type: 'iou.welched'; id: number; at: string }
  | { type: 'iou.void'; id: number; actor?: Actor; at: string }
  | { type: 'iou.reopen'; id: number; at: string }
  | { type: 'iou.receipt'; id: number; receipt: Partial<Receipt>; at: string }
  | { type: 'vote'; id?: number; choice: 'paid' | 'cap'; actor: Actor; at: string }
  | { type: 'metric'; metric: CountMetric; delta?: number; value?: number; at: string }
  | { type: 'stream.online'; streamId: string; at: string }
  | { type: 'stream.offline'; at: string }
  | { type: 'tick'; at: string }
  | { type: 'settings'; patch: Partial<LedgerState['settings']>; at: string };

export type Effect =
  | { type: 'say'; text: string; replyTo?: string; pin?: boolean; iouId?: number }
  | { type: 'clip'; iouId: number; purpose: 'due' | 'payoff' }
  | { type: 'overlay'; event: 'stamp' | 'due' | 'paid' | 'welched' | 'void' | 'progress' | 'vote' | 'pending'; iou: IOU }
  | { type: 'log'; text: string };

export interface ReduceResult {
  state: LedgerState;
  effects: Effect[];
}
