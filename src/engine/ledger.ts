import type { Actor, Condition, CountMetric, Effect, IOU, LedgerEvent, LedgerState, ReduceResult } from './types.js';

const METRICS: CountMetric[] = ['subs', 'follows', 'bits', 'raiders', 'viewers'];

export function initialState(channel: string): LedgerState {
  return {
    channel,
    nextId: 1,
    ious: [],
    counters: { subs: 0, follows: 0, bits: 0, raiders: 0, viewers: 0 },
    settings: { voteQuorum: 5, extractionMode: 'auto', autoPin: true, autoClip: true, autoThreshold: 0.7 },
  };
}

export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case 'count':
      return `${c.progress}/${c.target} ${c.metric}`;
    case 'time':
      return c.label;
    case 'event':
      return c.label;
    case 'none':
      return 'no condition';
  }
}

export function iouLine(iou: IOU, publicUrl?: string): string {
  const cond = iou.condition.kind === 'none' ? '' : ` (${describeCondition(iou.condition)})`;
  const tail = publicUrl ? ` ${publicUrl}` : '';
  return `IOU #${iou.id}: "${iou.text}"${cond} [${iou.state}]${tail}`;
}

function canModerate(actor?: Actor): boolean {
  return !!actor && (actor.isBroadcaster || actor.isMod);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 2));
}

export function similar(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return normalize(a) === normalize(b);
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size) >= 0.6;
}

function conditionMet(c: Condition, counters: LedgerState['counters'], now: string): boolean {
  if (c.kind === 'count') return c.progress >= c.target;
  if (c.kind === 'time') return !!c.deadline && new Date(c.deadline).getTime() <= new Date(now).getTime();
  return false;
}

function withProgress(c: Condition, counters: LedgerState['counters']): Condition {
  if (c.kind !== 'count') return c;
  return { ...c, progress: Math.min(c.target, Math.max(c.progress, counters[c.metric])) };
}

function dueText(iou: IOU): string {
  const why = iou.condition.kind === 'count'
    ? `${iou.condition.target} ${iou.condition.metric} hit`
    : iou.condition.kind === 'time'
      ? iou.condition.label
      : iou.condition.kind === 'event'
        ? iou.condition.label
        : 'called in';
  return `📜 IOU #${iou.id} is DUE: @${iou.channel} owes chat "${iou.text}" (${why}). Vote !paid or !cap`;
}

export function reduce(state: LedgerState, event: LedgerEvent): ReduceResult {
  const effects: Effect[] = [];
  let s: LedgerState = { ...state, ious: [...state.ious], counters: { ...state.counters }, settings: { ...state.settings } };

  const find = (id?: number): IOU | undefined => s.ious.find((i) => i.id === id);
  const replace = (iou: IOU) => {
    s.ious = s.ious.map((i) => (i.id === iou.id ? iou : i));
  };
  const makeDue = (iou: IOU, at: string): IOU => {
    const due: IOU = { ...iou, state: 'DUE', dueAt: at, votes: { paid: [], cap: [] } };
    replace(due);
    effects.push({ type: 'overlay', event: 'due', iou: due });
    effects.push({ type: 'say', text: dueText(due), pin: s.settings.autoPin });
    if (s.settings.autoClip) effects.push({ type: 'clip', iouId: due.id, purpose: 'due' });
    return due;
  };
  const settle = (iou: IOU, state: 'PAID' | 'WELCHED', at: string) => {
    const done: IOU = { ...iou, state, settledAt: at };
    replace(done);
    effects.push({ type: 'overlay', event: state === 'PAID' ? 'paid' : 'welched', iou: done });
    effects.push({
      type: 'say',
      text: state === 'PAID'
        ? `✅ IOU #${done.id} PAID. @${done.channel} delivered: "${done.text}". Receipt incoming.`
        : `❌ IOU #${done.id} WELCHED. @${done.channel} did not deliver "${done.text}". Chat remembers.`,
    });
    if (state === 'PAID' && s.settings.autoClip) effects.push({ type: 'clip', iouId: done.id, purpose: 'payoff' });
  };

  switch (event.type) {
    case 'promises.extracted': {
      for (const p of event.promises) {
        const live = s.ious.filter((i) => i.state === 'OPEN' || i.state === 'DUE' || i.state === 'PENDING');
        if (live.some((i) => similar(i.text, p.text))) continue;
        const auto = s.settings.extractionMode === 'auto' && p.confidence >= s.settings.autoThreshold;
        const iou: IOU = {
          id: s.nextId,
          channel: s.channel,
          text: p.text,
          quote: p.quote,
          stake: p.stake,
          condition: withProgress(p.condition, s.counters),
          state: auto ? 'OPEN' : 'PENDING',
          confidence: p.confidence,
          createdAt: event.at,
          streamId: s.streamId,
          receipt: {},
          votes: { paid: [], cap: [] },
          source: event.source,
        };
        s.nextId++;
        s.ious.push(iou);
        if (auto) {
          effects.push({ type: 'overlay', event: 'stamp', iou });
          if (conditionMet(iou.condition, s.counters, event.at)) makeDue(iou, event.at);
        } else {
          effects.push({ type: 'overlay', event: 'pending', iou });
        }
      }
      break;
    }
    case 'iou.manual': {
      if (!canModerate(event.actor)) {
        effects.push({ type: 'say', text: `@${event.actor.login} only the broadcaster or mods can log an IOU.` });
        break;
      }
      const text = event.text.trim().replace(/[.!]+$/, '');
      if (!text) break;
      const iou: IOU = {
        id: s.nextId,
        channel: s.channel,
        text,
        quote: text,
        stake: text.length > 32 ? text.slice(0, 29) + '…' : text,
        condition: { kind: 'none' },
        state: 'OPEN',
        confidence: 1,
        createdAt: event.at,
        streamId: s.streamId,
        receipt: {},
        votes: { paid: [], cap: [] },
        source: 'chat',
      };
      s.nextId++;
      s.ious.push(iou);
      effects.push({ type: 'overlay', event: 'stamp', iou });
      effects.push({ type: 'say', text: `📜 Logged IOU #${iou.id}: "${iou.text}". !owed to see the board.` });
      break;
    }
    case 'iou.approve': {
      const iou = find(event.id);
      if (!iou || iou.state !== 'PENDING') break;
      const next: IOU = { ...iou, ...event.edits, state: 'OPEN' };
      next.condition = withProgress(next.condition, s.counters);
      replace(next);
      effects.push({ type: 'overlay', event: 'stamp', iou: next });
      if (conditionMet(next.condition, s.counters, event.at)) makeDue(next, event.at);
      break;
    }
    case 'iou.dismiss': {
      const iou = find(event.id);
      if (!iou || iou.state !== 'PENDING') break;
      s.ious = s.ious.filter((i) => i.id !== event.id);
      break;
    }
    case 'iou.due': {
      const iou = find(event.id);
      if (!iou || iou.state !== 'OPEN') break;
      if (event.actor && !canModerate(event.actor)) break;
      makeDue(iou, event.at);
      break;
    }
    case 'iou.paid': {
      const iou = find(event.id);
      if (!iou || (iou.state !== 'DUE' && iou.state !== 'OPEN' && iou.state !== 'WELCHED')) break;
      if (event.actor && !canModerate(event.actor)) break;
      settle(iou, 'PAID', event.at);
      break;
    }
    case 'iou.welched': {
      const iou = find(event.id);
      if (!iou || iou.state !== 'DUE') break;
      settle(iou, 'WELCHED', event.at);
      break;
    }
    case 'iou.void': {
      const iou = find(event.id);
      if (!iou || iou.state === 'PAID' || iou.state === 'VOID') break;
      if (event.actor && !canModerate(event.actor)) break;
      const v: IOU = { ...iou, state: 'VOID', settledAt: event.at };
      replace(v);
      effects.push({ type: 'overlay', event: 'void', iou: v });
      break;
    }
    case 'iou.reopen': {
      const iou = find(event.id);
      if (!iou || iou.state !== 'WELCHED') break;
      makeDue(iou, event.at);
      break;
    }
    case 'iou.receipt': {
      const iou = find(event.id);
      if (!iou) break;
      replace({ ...iou, receipt: { ...iou.receipt, ...event.receipt } });
      break;
    }
    case 'vote': {
      const due = s.ious.filter((i) => i.state === 'DUE');
      const target = event.id ? find(event.id) : due.length === 1 ? due[0] : undefined;
      if (!target || target.state !== 'DUE') {
        if (due.length > 1 && !event.id) {
          effects.push({ type: 'say', text: `@${event.actor.login} which one? ${due.map((d) => `#${d.id}`).join(' ')} are due. Use !${event.choice} <number>.` });
        }
        break;
      }
      const uid = event.actor.userId;
      const votes = {
        paid: target.votes.paid.filter((u) => u !== uid),
        cap: target.votes.cap.filter((u) => u !== uid),
      };
      votes[event.choice].push(uid);
      const voted: IOU = { ...target, votes };
      replace(voted);
      effects.push({ type: 'overlay', event: 'vote', iou: voted });
      const total = votes.paid.length + votes.cap.length;
      if (total >= s.settings.voteQuorum) {
        if (votes.paid.length > votes.cap.length) settle(voted, 'PAID', event.at);
        else if (votes.cap.length > votes.paid.length) settle(voted, 'WELCHED', event.at);
      }
      break;
    }
    case 'metric': {
      if (!METRICS.includes(event.metric)) break;
      const current = s.counters[event.metric];
      const value = event.value !== undefined ? event.value : current + (event.delta ?? 0);
      s.counters[event.metric] = event.metric === 'raiders' ? Math.max(current, value) : value;
      for (const iou of s.ious) {
        if (iou.state !== 'OPEN' || iou.condition.kind !== 'count' || iou.condition.metric !== event.metric) continue;
        const next: IOU = { ...iou, condition: withProgress(iou.condition, s.counters) };
        if (next.condition.kind === 'count' && next.condition.progress === (iou.condition as { progress: number }).progress) continue;
        replace(next);
        if (conditionMet(next.condition, s.counters, event.at)) makeDue(next, event.at);
        else effects.push({ type: 'overlay', event: 'progress', iou: next });
      }
      break;
    }
    case 'stream.online': {
      s.streamId = event.streamId;
      s.streamStartedAt = event.at;
      for (const m of METRICS) s.counters[m] = 0;
      s.ious = s.ious.map((i) => {
        if (i.state !== 'OPEN' || i.condition.kind !== 'count' || i.condition.window !== 'stream') return i;
        return { ...i, condition: { ...i.condition, progress: 0 } };
      });
      break;
    }
    case 'stream.offline': {
      for (const iou of s.ious) {
        if (iou.state !== 'OPEN' || iou.condition.kind !== 'time') continue;
        if (/end of stream|before (i|we) (sleep|log off|end)|tonight|this stream/i.test(iou.condition.label)) makeDue(iou, event.at);
      }
      s.streamId = undefined;
      break;
    }
    case 'tick': {
      for (const iou of s.ious) {
        if (iou.state === 'OPEN' && conditionMet(iou.condition, s.counters, event.at)) makeDue(iou, event.at);
      }
      break;
    }
    case 'settings': {
      s.settings = { ...s.settings, ...event.patch };
      break;
    }
  }
  return { state: s, effects };
}

export function boardText(state: LedgerState, publicUrl?: string): string {
  const live = state.ious.filter((i) => i.state === 'DUE' || i.state === 'OPEN').sort((a, b) => (a.state === 'DUE' ? -1 : 1) - (b.state === 'DUE' ? -1 : 1) || a.id - b.id);
  if (live.length === 0) return `@${state.channel} owes chat nothing. Suspicious.`;
  const shown = live.slice(0, 3).map((i) => iouLine(i));
  const more = live.length > 3 ? ` …and ${live.length - 3} more${publicUrl ? ` at ${publicUrl}` : ''}` : '';
  return `${shown.join(' | ')}${more}`;
}
