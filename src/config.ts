import { readFileSync } from 'node:fs';

function loadDotenv(path = '.env'): void {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch {
    /* no .env is fine */
  }
}

loadDotenv();

export type Mode = 'live' | 'demo' | 'hybrid';

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();

const hasTwitch = !!(env('TWITCH_CLIENT_ID') && env('TWITCH_CLIENT_SECRET') && env('TWITCH_CHANNEL'));
const hasOpenAI = !!env('OPENAI_API_KEY');
const extractionProvider = env('EXTRACTION_PROVIDER', 'openai');
if (extractionProvider !== 'openai' && extractionProvider !== 'deepseek') throw new Error('EXTRACTION_PROVIDER must be openai or deepseek');
const hasExtraction = extractionProvider === 'deepseek' ? !!env('DEEPSEEK_API_KEY') : hasOpenAI;

function detectMode(): Mode {
  const forced = env('RECEIPTS_MODE') as Mode | '';
  if (forced === 'demo' || forced === 'live' || forced === 'hybrid') return forced;
  if (hasTwitch && hasExtraction) return 'live';
  if (hasTwitch) return 'hybrid';
  return 'demo';
}

export const config = {
  mode: detectMode(),
  port: Number(env('PORT', '3000')),
  // Loopback by default: the panel and mic API are for the streamer's own machine. Set HOST=0.0.0.0
  // only for a two-PC setup; operator routes still require sign-in in live/hybrid mode.
  host: env('HOST', '127.0.0.1'),
  operatorKey: env('OPERATOR_KEY') || undefined,
  publicUrl: env('PUBLIC_URL', `http://localhost:${env('PORT', '3000')}`),
  dataDir: env('DATA_DIR', 'data'),
  twitch: {
    clientId: env('TWITCH_CLIENT_ID'),
    clientSecret: env('TWITCH_CLIENT_SECRET'),
    channel: env('TWITCH_CHANNEL').toLowerCase(),
    redirectUri: `${env('PUBLIC_URL', `http://localhost:${env('PORT', '3000')}`)}/auth/callback`,
    scopes: [
      'user:read:chat',
      'user:write:chat',
      'user:bot',
      'channel:bot',
      'moderator:manage:chat_messages',
      'clips:edit',
      'channel:read:subscriptions',
      'moderator:read:followers',
      'bits:read',
    ],
  },
  openai: {
    apiKey: env('OPENAI_API_KEY'),
    transcribeModel: env('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
  },
  extraction: {
    provider: extractionProvider as 'openai' | 'deepseek',
    apiKey: extractionProvider === 'deepseek' ? env('DEEPSEEK_API_KEY') : env('OPENAI_API_KEY'),
    model: extractionProvider === 'deepseek' ? env('DEEPSEEK_EXTRACT_MODEL', 'deepseek-flash') : env('OPENAI_EXTRACT_MODEL', 'gpt-4.1-mini'),
  },
  voteQuorum: Number(env('VOTE_QUORUM', '5')),
  extractionMode: (env('EXTRACTION_MODE', 'auto') === 'approval' ? 'approval' : 'auto') as 'auto' | 'approval',
  hasTwitch,
  hasOpenAI,
};
