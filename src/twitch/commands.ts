import type { Actor, LedgerEvent } from '../engine/types.js';
import type { ChatMessage } from './eventsub.js';

export interface CommandResult {
  events: LedgerEvent[];
  reply?: string;
}

export interface CommandContext {
  publicUrl: string;
  boardText: () => string;
  now: () => string;
}

const lastReply = new Map<string, number>();
const REPLY_COOLDOWN_MS = 10_000;

function cooled(key: string): boolean {
  const t = lastReply.get(key) ?? 0;
  if (Date.now() - t < REPLY_COOLDOWN_MS) return false;
  lastReply.set(key, Date.now());
  return true;
}

export function parseCommand(text: string): { name: string; arg: string } | undefined {
  const m = text.trim().match(/^!([a-z]+)\b\s*(.*)$/i);
  if (!m) return undefined;
  return { name: m[1].toLowerCase(), arg: m[2].trim() };
}

export function handleCommand(msg: ChatMessage, ctx: CommandContext): CommandResult | undefined {
  const cmd = parseCommand(msg.text);
  if (!cmd) return undefined;
  const actor: Actor = { userId: msg.userId, login: msg.login, isBroadcaster: msg.isBroadcaster, isMod: msg.isMod };
  const at = ctx.now();
  const num = cmd.arg.match(/^#?(\d+)/);
  const id = num ? Number(num[1]) : undefined;

  switch (cmd.name) {
    case 'owed':
    case 'ledger':
    case 'debts':
      return { events: [], reply: cooled('owed') ? ctx.boardText() : undefined };
    case 'receipts':
      return { events: [], reply: cooled('receipts') ? `Full ledger with receipts: ${ctx.publicUrl}/ledger` : undefined };
    case 'iou':
      if (!cmd.arg) return { events: [], reply: cooled('iou-usage') ? 'Usage: !iou <what the streamer owes>' : undefined };
      return { events: [{ type: 'iou.manual', text: cmd.arg, actor, at }] };
    case 'due':
      if (!id) return { events: [] };
      return { events: [{ type: 'iou.due', id, actor, at }] };
    case 'void':
      if (!id) return { events: [] };
      return { events: [{ type: 'iou.void', id, actor, at }] };
    case 'paid':
    case 'delivered':
      return { events: [{ type: 'vote', id, choice: 'paid', actor, at }] };
    case 'cap':
    case 'welched':
    case 'nope':
      return { events: [{ type: 'vote', id, choice: 'cap', actor, at }] };
    default:
      return undefined;
  }
}
