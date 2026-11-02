import type { Actor, CountMetric, LedgerEvent, LedgerState } from '../engine/types.js';

/**
 * Turns an operator panel request into a ledger event. Only the actions the panel offers are
 * accepted; the server sets the actor and timestamp. Events that must come from Twitch or the
 * extractor (`promises.extracted`, `iou.receipt`, `vote`, `stream.online`, `tick`) are never accepted
 * from HTTP, so a browser can't fake a clip receipt or a vote. Fake metrics and stream end are
 * accepted only in demo mode, where the panel shows them as synthetic buttons.
 */
export type ParsedAction = { ok: true; event: LedgerEvent } | { ok: false; error: string };

const ID_ACTIONS = new Set(['iou.approve', 'iou.dismiss', 'iou.due', 'iou.paid', 'iou.welched', 'iou.void', 'iou.reopen']);
const METRICS = new Set<CountMetric>(['subs', 'follows', 'bits', 'raiders', 'viewers']);
const MAX_TEXT = 200;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const cleanText = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= MAX_TEXT ? t : undefined;
};

function parseSettings(patch: unknown): Partial<LedgerState['settings']> | string {
  if (!isObj(patch)) return 'settings patch must be an object';
  const out: Partial<LedgerState['settings']> = {};
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case 'voteQuorum':
        if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 50) return 'voteQuorum must be an integer 1-50';
        out.voteQuorum = v as number;
        break;
      case 'extractionMode':
        if (v !== 'auto' && v !== 'approval') return 'extractionMode must be auto or approval';
        out.extractionMode = v;
        break;
      case 'autoPin':
      case 'autoClip':
        if (typeof v !== 'boolean') return `${k} must be boolean`;
        out[k] = v;
        break;
      default:
        return `unknown setting ${k}`;
    }
  }
  return Object.keys(out).length ? out : 'empty settings patch';
}

export function parsePanelAction(body: unknown, ctx: { demo: boolean; channel: string; at: string }): ParsedAction {
  if (!isObj(body) || typeof body.type !== 'string') return { ok: false, error: 'bad event' };
  const { at } = ctx;
  const type = body.type;

  if (ID_ACTIONS.has(type)) {
    if (!isId(body.id)) return { ok: false, error: 'id must be a positive integer' };
    if (type === 'iou.approve') {
      if (body.edits === undefined) return { ok: true, event: { type, id: body.id, at } };
      if (!isObj(body.edits)) return { ok: false, error: 'edits must be an object' };
      const edits: { text?: string; stake?: string } = {};
      for (const [k, v] of Object.entries(body.edits)) {
        if (k !== 'text' && k !== 'stake') return { ok: false, error: `cannot edit ${k}` };
        const t = cleanText(v);
        if (!t) return { ok: false, error: `${k} must be 1-${MAX_TEXT} characters` };
        edits[k] = t;
      }
      return { ok: true, event: { type, id: body.id, edits, at } };
    }
    return { ok: true, event: { type, id: body.id, at } as LedgerEvent };
  }

  switch (type) {
    case 'iou.manual': {
      const text = cleanText(body.text);
      if (!text) return { ok: false, error: `text must be 1-${MAX_TEXT} characters` };
      const actor: Actor = { userId: 'panel', login: ctx.channel, isBroadcaster: true, isMod: true };
      return { ok: true, event: { type, text, actor, at } };
    }
    case 'settings': {
      const patch = parseSettings(body.patch);
      if (typeof patch === 'string') return { ok: false, error: patch };
      return { ok: true, event: { type, patch, at } };
    }
    case 'metric': {
      if (!ctx.demo) return { ok: false, error: 'metrics come from Twitch outside demo mode' };
      if (!METRICS.has(body.metric as CountMetric)) return { ok: false, error: 'unknown metric' };
      const delta = body.delta;
      const value = body.value;
      const okNum = (n: unknown) => n === undefined || (Number.isInteger(n) && Math.abs(n as number) <= 100_000);
      if (!okNum(delta) || !okNum(value) || (delta === undefined && value === undefined)) return { ok: false, error: 'delta or value must be an integer' };
      return { ok: true, event: { type, metric: body.metric as CountMetric, delta: delta as number | undefined, value: value as number | undefined, at } };
    }
    case 'stream.offline':
      if (!ctx.demo) return { ok: false, error: 'stream state comes from Twitch outside demo mode' };
      return { ok: true, event: { type, at } };
    default:
      return { ok: false, error: `event ${type} is not accepted from the panel` };
  }
}
