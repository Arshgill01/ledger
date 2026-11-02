import type { Condition, IOU, IOUState, LedgerState, Receipt } from '../engine/types.js';
import type { Mode } from '../config.js';

/** What anyone (overlay, public ledger, !receipts link) may see. No transcript, chat, status log,
 *  voter identities, chat message ids, unapproved (PENDING) or retracted (VOID) IOUs. */
export interface PublicIOU {
  id: number;
  channel: string;
  text: string;
  quote: string;
  stake: string;
  condition: Condition;
  state: Exclude<IOUState, 'PENDING' | 'VOID'>;
  createdAt: string;
  dueAt?: string;
  settledAt?: string;
  receipt: Omit<Receipt, 'messageId'>;
  votes: { paid: number; cap: number };
}

export interface PublicSnapshot {
  mode: Mode;
  channel: string;
  live: boolean;
  ious: PublicIOU[];
}

const PUBLIC_STATES = new Set<IOUState>(['OPEN', 'DUE', 'PAID', 'WELCHED']);

/** Overlay events that are safe to broadcast publicly. `pending` and `void` stay operator-only. */
export const PUBLIC_OVERLAY_EVENTS = new Set(['stamp', 'due', 'paid', 'welched', 'progress', 'vote']);

export function publicIou(i: IOU): PublicIOU | undefined {
  if (!PUBLIC_STATES.has(i.state)) return undefined;
  const { clipId, clipUrl, thumbnailUrl, payoffClipId, payoffClipUrl } = i.receipt ?? {};
  return {
    id: i.id,
    channel: i.channel,
    text: i.text,
    quote: i.quote,
    stake: i.stake,
    condition: i.condition,
    state: i.state as PublicIOU['state'],
    createdAt: i.createdAt,
    dueAt: i.dueAt,
    settledAt: i.settledAt,
    receipt: { clipId, clipUrl, thumbnailUrl, payoffClipId, payoffClipUrl },
    votes: { paid: i.votes.paid.length, cap: i.votes.cap.length },
  };
}

export function publicSnapshot(state: LedgerState, mode: Mode): PublicSnapshot {
  return {
    mode,
    channel: state.channel,
    live: !!state.streamId,
    ious: state.ious.map(publicIou).filter((i): i is PublicIOU => !!i),
  };
}
