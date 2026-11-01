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

function detectMode(): Mode {
  const forced = env('RECEIPTS_MODE') as Mode | '';
  if (forced === 'demo' || forced === 'live' || forced === 'hybrid') return forced;
  if (hasTwitch && hasOpenAI) return 'live';
  if (hasTwitch) return 'hybrid';
  return 'demo';
}

export const config = {
  mode: detectMode(),
  port: Number(env('PORT', '3000')),
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
    extractModel: env('OPENAI_EXTRACT_MODEL', 'gpt-4.1-mini'),
    transcribeModel: env('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
  },
  voteQuorum: Number(env('VOTE_QUORUM', '5')),
  extractionMode: (env('EXTRACTION_MODE', 'auto') === 'approval' ? 'approval' : 'auto') as 'auto' | 'approval',
  hasTwitch,
  hasOpenAI,
};
