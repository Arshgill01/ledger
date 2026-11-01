import OpenAI from 'openai';
import type { Condition, ExtractedPromise, IOU } from './types.js';

export const PROMISE_SCHEMA = {
  name: 'promises',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['promises'],
    properties: {
      promises: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'quote', 'stake', 'confidence', 'condition_kind', 'metric', 'target', 'deadline', 'label'],
          properties: {
            text: { type: 'string', description: 'The promise, first person, present tense, no trailing punctuation. e.g. "eat the ghost pepper"' },
            quote: { type: 'string', description: 'Verbatim transcript fragment that contains the promise' },
            stake: { type: 'string', description: '1-4 word noun phrase for an overlay card, e.g. "ghost pepper"' },
            confidence: { type: 'number', description: '0-1, how sure you are this is a genuine commitment by the streamer' },
            condition_kind: { type: 'string', enum: ['count', 'time', 'event', 'none'] },
            metric: { type: 'string', enum: ['subs', 'follows', 'bits', 'raiders', 'viewers', ''], description: 'Only for count conditions, else empty string' },
            target: { type: 'integer', description: 'Only for count conditions, else 0' },
            deadline: { type: 'string', description: 'ISO-8601 for time conditions with an absolute date; empty string otherwise' },
            label: { type: 'string', description: 'Short human label for time/event conditions: "end of stream", "by Friday", "if I die to this boss". Empty for count/none' },
          },
        },
      },
    },
  },
} as const;

const SYSTEM = `You extract promises a Twitch streamer makes to their chat from a live transcript of the streamer's microphone.

A promise is a commitment by the streamer about their own future behaviour, usually with a stake and often with a condition:
- "if we hit 50 subs tonight I'll eat the ghost pepper"  -> count condition (subs, 50)
- "I owe chat a song" -> no condition
- "I will finish this boss before I sleep" -> time condition, label "end of stream"
- "if I die here I'm doing 20 pushups" -> event condition, label "if I die here"
- "if 10 people follow I'll change my name to Bob for a week" -> count condition (follows, 10)

Not promises: reading chat messages aloud, hypotheticals about other people, questions, obvious sarcasm or quoting someone else, things already in the OPEN list (same meaning counts as duplicate; emit nothing for those).
Use "subs" for subscriptions, "follows" for followers, "bits" for bits/cheers, "raiders" for raid size, "viewers" for concurrent viewers.
Be conservative: confidence >= 0.8 only when the streamer clearly commits. Mentions like "maybe" or "I might" are <= 0.5.
Return an empty array when there is nothing new.`;

export interface ExtractInput {
  transcript: string;
  openIous: Pick<IOU, 'id' | 'text'>[];
  context?: { title?: string; game?: string; now?: string };
}

type Raw = {
  text: string; quote: string; stake: string; confidence: number;
  condition_kind: 'count' | 'time' | 'event' | 'none'; metric: string; target: number; deadline: string; label: string;
};

export function toCondition(r: Raw): Condition {
  switch (r.condition_kind) {
    case 'count': {
      const metric = (['subs', 'follows', 'bits', 'raiders', 'viewers'].includes(r.metric) ? r.metric : 'subs') as Extract<Condition, { kind: 'count' }>['metric'];
      return { kind: 'count', metric, target: Math.max(1, r.target || 1), progress: 0, window: 'stream' };
    }
    case 'time':
      return { kind: 'time', deadline: r.deadline || '', label: r.label || 'end of stream' };
    case 'event':
      return { kind: 'event', label: r.label || 'when it happens' };
    default:
      return { kind: 'none' };
  }
}

export async function extractPromises(client: OpenAI, model: string, input: ExtractInput): Promise<ExtractedPromise[]> {
  if (!input.transcript.trim()) return [];
  const open = input.openIous.length ? input.openIous.map((i) => `#${i.id} ${i.text}`).join('\n') : '(none)';
  const ctx = [input.context?.title && `Stream title: ${input.context.title}`, input.context?.game && `Category: ${input.context.game}`, `Now: ${input.context?.now ?? new Date().toISOString()}`].filter(Boolean).join('\n');
  const res = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${ctx}\n\nOPEN IOUs (do not repeat):\n${open}\n\nTRANSCRIPT (most recent last):\n${input.transcript}` },
    ],
    response_format: { type: 'json_schema', json_schema: PROMISE_SCHEMA as unknown as OpenAI.ResponseFormatJSONSchema['json_schema'] },
  });
  const content = res.choices[0]?.message?.content ?? '{"promises":[]}';
  let parsed: { promises: Raw[] };
  try {
    parsed = JSON.parse(content) as { promises: Raw[] };
  } catch {
    return [];
  }
  return (parsed.promises ?? [])
    .filter((p) => p.text && p.text.trim().length > 2)
    .map((p) => ({
      text: p.text.trim().replace(/[.!]+$/, ''),
      quote: p.quote || p.text,
      stake: p.stake || p.text.slice(0, 24),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      condition: toCondition(p),
    }));
}
