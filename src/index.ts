import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import OpenAI from 'openai';
import { config } from './config.js';
import { Runtime, type EffectSink } from './runtime.js';
import { JsonStore, MemoryStore } from './engine/store.js';
import { startHttp, type HttpHandlers } from './server/http.js';
import { DemoSink, FixtureRunner, loadFixture, seededState } from './demo/fixture.js';
import { heuristicExtract } from './engine/heuristic.js';
import { extractPromises } from './engine/extract.js';
import { transcribeChunk } from './engine/transcribe.js';
import { TwitchAuth } from './twitch/auth.js';
import { Helix } from './twitch/helix.js';
import { EventSubClient, type ChatMessage } from './twitch/eventsub.js';
import { handleCommand } from './twitch/commands.js';
import type { IOU, Receipt } from './engine/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const fixture = config.mode === 'demo' ? await loadFixture(join(root, 'fixtures', 'demo-stream.json')) : undefined;
  const channel = fixture ? fixture.channel : config.twitch.channel;
  const store = fixture ? new MemoryStore() : new JsonStore(config.dataDir);
  if (fixture) await store.save(seededState(fixture));
  const rt = new Runtime(store, channel, config.mode, config.publicUrl, {
    voteQuorum: config.voteQuorum,
    extractionMode: config.extractionMode,
  });
  await rt.init();

  const openai = config.hasOpenAI ? new OpenAI({ apiKey: config.openai.apiKey }) : undefined;
  let streamContext: { title?: string; game?: string } = {};

  async function extractFrom(text: string, source: IOU['source']): Promise<void> {
    rt.pushTranscript(text);
    const openIous = rt.state.ious.filter((i) => i.state === 'OPEN' || i.state === 'DUE' || i.state === 'PENDING').map((i) => ({ id: i.id, text: i.text }));
    let promises;
    if (openai) {
      promises = await extractPromises(openai, config.openai.extractModel, { transcript: rt.transcript.recent(), openIous, context: { ...streamContext, now: new Date().toISOString() } });
    } else {
      promises = heuristicExtract(text);
    }
    if (promises.length) await rt.dispatch({ type: 'promises.extracted', promises, source, at: new Date().toISOString() });
  }

  const handlers: HttpHandlers = {
    onTranscript: (text) => extractFrom(text, config.mode === 'demo' ? 'fixture' : 'speech'),
  };

  if (openai) {
    let busy = false;
    handlers.onAudio = async (audio, mime) => {
      if (busy) return;
      busy = true;
      try {
        const text = await transcribeChunk(openai, config.openai.transcribeModel, audio, mime, rt.transcript.recent(20_000));
        if (text) await extractFrom(text, 'speech');
      } finally {
        busy = false;
      }
    };
  }

  if (fixture) {
    rt.sink = new DemoSink(rt);
    const runner = new FixtureRunner(rt, fixture);
    handlers.onDemoRestart = () => runner.start();
    handlers.onDemoChat = (login, text) => runner.chat({
      messageId: `demo-${Date.now()}`, userId: `demo_${login.toLowerCase()}`, login: login.toLowerCase(), displayName: login,
      text, isBroadcaster: false, isMod: login.toLowerCase() === 'mod',
    });
    startHttp(rt, handlers, config.port, join(root, 'public'));
    rt.log('DEMO MODE: synthetic stream, no Twitch, no OpenAI. Everything you see is scripted or typed by you.');
    runner.start();
    return;
  }

  const auth = new TwitchAuth({ ...config.twitch, dataDir: config.dataDir });
  await auth.load();
  const helix = new Helix({ clientId: config.twitch.clientId, token: () => auth.accessToken(), onUnauthorized: async () => { await auth.refresh(); } });
  handlers.authLoginUrl = () => auth.loginUrl();
  handlers.authCallback = async (code, state) => {
    await auth.handleCallback(code, state);
    await connectTwitch();
  };

  let eventsub: EventSubClient | undefined;

  async function connectTwitch(): Promise<void> {
    const tok = auth.current;
    if (!tok) {
      rt.log('Twitch: not authenticated. Open /panel and click Connect Twitch.');
      return;
    }
    const broadcaster = await helix.getUserByLogin(config.twitch.channel);
    if (!broadcaster) throw new Error(`channel ${config.twitch.channel} not found`);
    if (broadcaster.id !== tok.userId) rt.log(`Warning: token belongs to ${tok.login}, not ${config.twitch.channel}. Pinning needs the broadcaster or a mod.`);
    const ids = { broadcasterId: broadcaster.id, userId: tok.userId };

    const sink: EffectSink = {
      async say(text, opts) {
        const r = await helix.sendChat(ids.broadcasterId, ids.userId, text, opts);
        rt.pushChat({ at: new Date().toISOString(), login: tok.login, text, fromBot: true, pinned: !!opts.pin && r.sent });
        if (!r.sent) rt.log(`chat message dropped: ${r.dropReason ?? 'unknown'}`);
        return { messageId: r.messageId };
      },
      async clip(iou, purpose): Promise<Partial<Receipt> | void> {
        const created = await helix.createClip(ids.broadcasterId);
        rt.log(`clip requested for IOU #${iou.id} (${purpose}): ${created.id}`);
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          const clip = await helix.getClip(created.id).catch(() => undefined);
          if (clip) {
            return purpose === 'due'
              ? { clipId: clip.id, clipUrl: clip.url, thumbnailUrl: clip.thumbnail_url }
              : { payoffClipId: clip.id, payoffClipUrl: clip.url };
          }
        }
        rt.log(`clip ${created.id} never appeared (is the channel live?)`);
      },
    };
    rt.sink = sink;

    const onChat = async (msg: ChatMessage) => {
      rt.pushChat({ at: new Date().toISOString(), login: msg.displayName, text: msg.text });
      const result = handleCommand(msg, { publicUrl: config.publicUrl, boardText: () => rt.board(), now: () => new Date().toISOString() });
      if (!result) return;
      for (const ev of result.events) await rt.dispatch(ev);
      if (result.reply) await sink.say(result.reply, { replyTo: msg.messageId });
    };

    eventsub?.stop();
    eventsub = new EventSubClient(helix, ids, (e) => {
      const at = new Date().toISOString();
      switch (e.type) {
        case 'chat': void onChat(e.message); break;
        case 'metric': void rt.dispatch({ type: 'metric', metric: e.metric, delta: e.delta, value: e.value, at }); break;
        case 'stream.online': void rt.dispatch({ type: 'stream.online', streamId: e.streamId, at }); break;
        case 'stream.offline': void rt.dispatch({ type: 'stream.offline', at }); break;
        case 'status': rt.log(e.text); break;
      }
    });
    eventsub.start();
    rt.twitchConnected = true;
    rt.log(`Twitch connected as ${tok.login} for channel ${broadcaster.login}`);

    const poll = async () => {
      try {
        const s = await helix.getStream(ids.broadcasterId);
        if (s) {
          streamContext = { title: s.title, game: s.game_name };
          if (rt.state.streamId !== s.id) await rt.dispatch({ type: 'stream.online', streamId: s.id, at: new Date().toISOString() });
          await rt.dispatch({ type: 'metric', metric: 'viewers', value: s.viewer_count, at: new Date().toISOString() });
        }
        await rt.dispatch({ type: 'tick', at: new Date().toISOString() });
      } catch (err) {
        rt.log(`poll failed: ${(err as Error).message}`);
      }
    };
    void poll();
    setInterval(poll, 60_000);
  }

  startHttp(rt, handlers, config.port, join(root, 'public'));
  rt.log(`${config.mode.toUpperCase()} MODE for channel ${config.twitch.channel}${openai ? '' : ' (no OpenAI key: heuristic extraction + !iou only)'}`);
  await connectTwitch().catch((err) => rt.log(`Twitch connect failed: ${(err as Error).message}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
