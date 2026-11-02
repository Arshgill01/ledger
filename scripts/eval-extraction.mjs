// Explicit paid command; ordinary npm test never calls a model.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import '../src/config.ts';
import { extractPromises, SYSTEM, PROMISE_SCHEMA } from '../src/engine/extract.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const cases = JSON.parse(await readFile('fixtures/extraction-eval.json', 'utf8'));
const sourcePaths = ['src/config.ts', 'src/engine/extract.ts', 'scripts/eval-extraction.mjs', 'fixtures/extraction-eval.json'];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (p) => [p, hash(await readFile(p))])));
const model = 'deepseek-flash';
const dir = process.argv[3];
if (!dir || !['--prepare', '--run'].includes(process.argv[2])) throw new Error('Use --prepare data/evals/UNIQUE or --run data/evals/UNIQUE');
const manifestPath = join(dir, 'manifest.json');
if (process.argv[2] === '--prepare') {
  await mkdir(dir, { recursive: false });
  const manifest = {
    version: 'experiment-v1',
    question: 'Can DeepSeek Flash extract Ledger promises while rejecting quoted, sarcastic, hypothetical and duplicate commitments?',
    source_revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    source_hashes: sourceHashes,
    cases: cases.map((c) => ({ id: c.id, content_hash: hash(JSON.stringify(c)), category: c.category })),
    arms: [{ name: 'deepseek', model_id: model, role: 'extraction', prompt_hash: hash(SYSTEM), schema_hash: hash(JSON.stringify(PROMISE_SCHEMA)), cache_namespace: `${dir}/deepseek/r1` }],
    decoding: { temperature: 0.1, max_output_tokens: 1024, reasoning: 'none', retries: 0, timeout_ms: 30000 },
    repetitions: 1, max_fresh_calls: cases.length,
    estimated_cost: { currency: 'USD', upper_bound: 0.25, pricing: 'Peak cache-miss $0.30/M input, $1.20/M output; conservative estimate ignores cache discounts', max_request_bytes: 20000 },
    cache_policy: { local_reuse: false, provider_cache: 'Record usage; no claim of independent uncached computation' },
    promotion_rules: ['Every case passes exact count and condition checks', 'Positive cases have confidence >= 0.7, expected text and a verbatim grounded quote', 'All earlier stages pass before expansion; one fresh call per case'],
    rejection_rules: ['Stop on first error, malformed output, false commitment, duplicate or wrong condition', 'No automatic retries or repairs; preserve all raw responses', 'Do not claim broad accuracy or microphone/stream latency from this synthetic text set'],
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(`Prepared ${manifestPath}; no provider requests made.`);
  process.exit(0);
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.deepEqual(manifest.source_hashes, sourceHashes, 'Source changed: prepare a new experiment');
assert.equal(manifest.arms[0].prompt_hash, hash(SYSTEM));
assert.equal(manifest.arms[0].schema_hash, hash(JSON.stringify(PROMISE_SCHEMA)));
assert.deepEqual(manifest.cases.map((c) => c.content_hash), cases.map((c) => hash(JSON.stringify(c))));
assert.ok(process.env.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY missing');
assert.equal(manifest.max_fresh_calls, cases.length);
assert.ok((21000 * 0.30 + 1024 * 1.20) / 1e6 * cases.length < manifest.estimated_cost.upper_bound);
await writeFile(join(dir, 'started.json'), JSON.stringify({ at: new Date().toISOString() }), { flag: 'wx' });
let calls = 0, inputTokens = 0, outputTokens = 0;
let current;
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com', maxRetries: 0, timeout: 30000,
  fetch: async (url, options) => {
    assert.equal(String(url), 'https://api.deepseek.com/responses');
    assert.ok(++calls <= manifest.max_fresh_calls);
    assert.ok(Buffer.byteLength(options.body) <= manifest.estimated_cost.max_request_bytes);
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, model);
    assert.equal(payload.max_output_tokens, 1024);
    await writeFile(join(dir, `${current.id}.request.json`), JSON.stringify(payload, null, 2), { flag: 'wx' });
    const response = await fetch(url, options);
    const raw = await response.clone().text();
    await writeFile(join(dir, `${current.id}.response.json`), raw, { flag: 'wx' });
    const usage = JSON.parse(raw).usage;
    inputTokens += usage?.input_tokens ?? 0;
    outputTokens += usage?.output_tokens ?? 0;
    return response;
  },
});
const results = [];
let status = 'passed';
for (current of cases) {
  const start = performance.now();
  try {
    const predictions = await extractPromises(client, model, { transcript: current.transcript, openIous: current.openIous ?? [], context: { now: '2026-11-02T12:00:00Z' } }, 'deepseek');
    // Save predictions before scoring, including outputs that fail the gate.
    await writeFile(join(dir, `${current.id}.predictions.json`), JSON.stringify(predictions, null, 2), { flag: 'wx' });
    const expected = current.expected;
    assert.equal(predictions.length, expected.count, 'promise count');
    if (expected.count) {
      const p = predictions[0];
      assert.equal(p.condition.kind, expected.kind, 'condition kind');
      if (expected.metric) assert.equal(p.condition.metric, expected.metric, 'metric');
      if (expected.target) assert.equal(p.condition.target, expected.target, 'target');
      assert.ok(p.confidence >= 0.7, 'confidence below automatic logging threshold');
      assert.ok(p.text.toLowerCase().includes(expected.text), 'promise meaning');
      assert.ok(p.quote && current.transcript.includes(p.quote), 'quote not verbatim grounded');
    }
    results.push({ id: current.id, stage: current.category, passed: true, latency_ms: Math.round(performance.now() - start) });
    console.log(`PASS ${current.id}`);
  } catch (err) {
    status = 'failed';
    results.push({ id: current.id, stage: current.category, passed: false, error: err.message.slice(0, 1000), latency_ms: Math.round(performance.now() - start) });
    console.log(`FAIL ${current.id}: ${err.message.slice(0, 300)}`);
    break;
  }
}
const summary = { status, calls, cached_local_calls: 0, input_tokens: inputTokens, output_tokens: outputTokens, peak_cost_upper_estimate_usd: (inputTokens * 0.30 + outputTokens * 1.20) / 1e6, results };
await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx' });
console.log(JSON.stringify(summary));
if (status !== 'passed') process.exitCode = 1;
