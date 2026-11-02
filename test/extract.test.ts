import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { extractPromises } from '../src/engine/extract.js';

const promise = { text: 'eat a pepper', quote: "If we hit 10 follows I'll eat a pepper", stake: 'pepper', confidence: 0.95, condition_kind: 'count', metric: 'follows', target: 10, deadline: '', label: '' };
const input = { transcript: promise.quote, openIous: [], context: { now: '2026-11-02T00:00:00Z' } };

for (const provider of ['deepseek', 'openai'] as const) {
  test(`${provider} uses bounded structured extraction and preserves the condition`, async () => {
    const client = new OpenAI({
      apiKey: 'offline-test-key', baseURL: 'https://offline.invalid', maxRetries: 0,
      fetch: async (url, opts) => {
        const body = JSON.parse(String(opts?.body));
        assert.equal(body.temperature, 0.1);
        assert.ok(String(opts?.body).includes('OPEN IOUs'));
        if (provider === 'deepseek') {
          assert.equal(String(url), 'https://offline.invalid/responses');
          assert.deepEqual(body.reasoning, { effort: 'none' });
          assert.equal(body.max_output_tokens, 1024);
          assert.equal(body.text.format.type, 'json_schema');
          return Response.json({ object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ promises: [promise] }), annotations: [] }] }] });
        }
        assert.equal(body.max_completion_tokens, 1024);
        assert.equal(body.response_format.type, 'json_schema');
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ promises: [promise] }) } }] });
      },
    });
    const result = await extractPromises(client, 'test-model', input, provider);
    assert.equal(result[0].text, promise.text);
    assert.deepEqual(result[0].condition, { kind: 'count', metric: 'follows', target: 10, progress: 0, window: 'stream' });
  });
}

test('extractor rejects incomplete or malformed responses instead of treating them as no promises', async () => {
  for (const response of [
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"promises":[{"text":12}]}', annotations: [] }] }] },
  ]) {
    const client = new OpenAI({ apiKey: 'offline-test-key', fetch: async () => Response.json(response) });
    await assert.rejects(extractPromises(client, 'test-model', input, 'deepseek'));
  }
});

test('empty transcript makes no provider request', async () => {
  const client = new OpenAI({ apiKey: 'offline-test-key', fetch: async () => { throw new Error('unexpected request'); } });
  assert.deepEqual(await extractPromises(client, 'test-model', { transcript: ' ', openIous: [] }, 'deepseek'), []);
});
