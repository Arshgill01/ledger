(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let snap = null;

  // Every operator request reports failures in the status feed instead of failing silently.
  async function post(url, body) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { showSignIn(); return j; }
      if (!r.ok) addStatus(`⚠ ${url} failed (${r.status}): ${j.error || r.statusText}`, true);
      return j;
    } catch (err) {
      addStatus(`⚠ ${url} failed: ${err.message}`, true);
      return {};
    }
  }
  const dispatch = (event) => post('/api/event', event);

  function condText(c) {
    if (c.kind === 'count') return `${c.progress}/${c.target} ${c.metric}`;
    if (c.kind === 'time' || c.kind === 'event') return c.label;
    return 'unconditional';
  }

  function renderIous() {
    const s = snap.state;
    const order = { DUE: 0, PENDING: 1, OPEN: 2, WELCHED: 3, PAID: 4, VOID: 5 };
    const list = [...s.ious].sort((a, b) => order[a.state] - order[b.state] || b.id - a.id);
    $('ious').innerHTML = list.length ? list.map((i) => {
      const acts = [];
      if (i.state === 'PENDING') acts.push(`<button class="small primary" data-act="approve" data-id="${i.id}">Approve</button><button class="small" data-act="dismiss" data-id="${i.id}">Dismiss</button>`);
      if (i.state === 'OPEN') acts.push(`<button class="small" data-act="due" data-id="${i.id}">Call it in</button><button class="small" data-act="paid" data-id="${i.id}">Mark paid</button><button class="small danger" data-act="void" data-id="${i.id}">Void</button>`);
      if (i.state === 'DUE') acts.push(`<button class="small primary" data-act="paid" data-id="${i.id}">Paid ✓</button><button class="small" data-act="welched" data-id="${i.id}">Welched</button><button class="small danger" data-act="void" data-id="${i.id}">Void</button>`);
      if (i.state === 'WELCHED') acts.push(`<button class="small" data-act="reopen" data-id="${i.id}">Reopen</button><button class="small" data-act="paid" data-id="${i.id}">Paid after all</button>`);
      const votes = i.state === 'DUE' ? ` · votes paid ${i.votes.paid.length} / cap ${i.votes.cap.length} (quorum ${s.settings.voteQuorum})` : '';
      const clip = i.receipt && i.receipt.clipUrl ? ` · <a href="${esc(i.receipt.clipUrl)}" target="_blank">receipt clip</a>` : '';
      return `<div class="iou ${i.state.toLowerCase()}"><div class="t"><span class="state ${i.state}">${i.state}</span>#${i.id} ${esc(i.text)}</div>
        <div class="m">${esc(condText(i.condition))}${votes}${clip} · conf ${Math.round(i.confidence * 100)}% · ${esc(i.source)}<br><i>“${esc(i.quote)}”</i></div>
        <div class="row">${acts.join('')}</div></div>`;
    }).join('') : '<div class="hint">Nothing on the books. Say a promise.</div>';
    for (const k of ['subs', 'follows', 'bits', 'raiders']) $(`c-${k}`).textContent = s.counters[k];
    $('quorum').value = s.settings.voteQuorum;
    $('autopin').checked = s.settings.autoPin;
    $('autoclip').checked = s.settings.autoClip;
    $('sel-mode').value = s.settings.extractionMode;
    $('pill-stream').textContent = s.streamId ? 'stream: live' : 'stream: offline';
    $('pill-stream').classList.toggle('on', !!s.streamId);
  }

  function addTranscript(line) {
    const el = document.createElement('div');
    el.textContent = `${new Date(line.at).toLocaleTimeString()}  ${line.text}`;
    el.className = 'live';
    $('transcript').appendChild(el);
    $('transcript').scrollTop = 1e9;
  }
  function addChat(line) {
    const el = document.createElement('div');
    el.className = (line.fromBot ? 'bot ' : '') + (line.pinned ? 'pinned' : '');
    el.innerHTML = `<b>${esc(line.login)}</b>: ${esc(line.text)}`;
    $('chat').appendChild(el);
    $('chat').scrollTop = 1e9;
  }
  function addStatus(text, error) {
    const el = document.createElement('div');
    el.textContent = text;
    if (error) el.className = 'err';
    $('status').appendChild(el);
    $('status').scrollTop = 1e9;
  }

  function applySnapshot(m) {
    snap = m;
    document.body.classList.toggle('demo', m.mode === 'demo');
    $('badge').hidden = m.mode !== 'demo';
    $('pill-mode').textContent = `mode: ${m.mode}`;
    $('pill-twitch').textContent = `twitch: ${m.twitchConnected ? 'connected' : m.mode === 'demo' ? 'simulated' : 'not connected'}`;
    $('pill-twitch').classList.toggle('on', m.twitchConnected);
    if (m.twitchConnected) $('btn-connect').textContent = 'Reconnect Twitch';
    $('transcript').innerHTML = ''; m.transcript.forEach(addTranscript);
    $('chat').innerHTML = ''; m.chat.forEach(addChat);
    $('status').innerHTML = ''; m.status.forEach(addStatus);
    renderIous();
    renderSpeech(m.speech);
  }

  // ---- operator sign-in. The key never lives in this file; it is pasted once and exchanged for an HttpOnly cookie.
  function showSignIn() {
    $('signin').hidden = false;
    $('app').hidden = true;
    $('key').focus();
  }
  async function checkSession() {
    try {
      const s = await fetch('/api/session').then((r) => r.json());
      if (!s.operator) { showSignIn(); return false; }
      $('signin').hidden = true;
      $('app').hidden = false;
      return true;
    } catch {
      return false;
    }
  }
  $('signin-form').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/operator/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: $('key').value }) });
    if (!r.ok) { $('signin-err').textContent = (await r.json().catch(() => ({}))).error || `sign-in failed (${r.status})`; return; }
    $('key').value = '';
    $('signin-err').textContent = '';
    if (await checkSession()) connect();
  };

  let ws = null;
  function connect() {
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/operator`);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'snapshot') applySnapshot(m);
      else if (m.type === 'speech') { if (snap) snap.speech = m.speech; renderSpeech(m.speech); }
      else if (m.type === 'state') { snap.state = m.state; renderIous(); }
      else if (m.type === 'transcript') addTranscript(m.line);
      else if (m.type === 'chat') addChat(m.line);
      else if (m.type === 'status') { addStatus(m.text); if (snap) { snap.twitchConnected = m.twitchConnected; $('pill-twitch').textContent = `twitch: ${m.twitchConnected ? 'connected' : snap.mode === 'demo' ? 'simulated' : 'not connected'}`; $('pill-twitch').classList.toggle('on', m.twitchConnected); } }
    };
    ws.onclose = () => setTimeout(async () => { if (await checkSession()) connect(); }, 1500);
  }
  checkSession().then((ok) => ok && connect());

  $('ious').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id);
    const map = { approve: 'iou.approve', dismiss: 'iou.dismiss', due: 'iou.due', paid: 'iou.paid', welched: 'iou.welched', void: 'iou.void', reopen: 'iou.reopen' };
    dispatch({ type: map[b.dataset.act], id });
  });
  $('btn-manual').onclick = () => {
    const text = $('manual').value.trim();
    if (!text) return;
    dispatch({ type: 'iou.manual', text });
    $('manual').value = '';
  };
  $('say').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = $('say').value.trim();
      if (!text) return;
      post('/api/transcript', { text });
      $('say').value = '';
    }
  });
  $('sel-mode').onchange = () => dispatch({ type: 'settings', patch: { extractionMode: $('sel-mode').value } });
  $('quorum').onchange = () => dispatch({ type: 'settings', patch: { voteQuorum: Number($('quorum').value) } });
  $('autopin').onchange = () => dispatch({ type: 'settings', patch: { autoPin: $('autopin').checked } });
  $('autoclip').onchange = () => dispatch({ type: 'settings', patch: { autoClip: $('autoclip').checked } });
  $('btn-restart').onclick = () => post('/api/demo/restart', {});
  document.querySelectorAll('button[data-metric]').forEach((b) => {
    b.onclick = () => dispatch({ type: 'metric', metric: b.dataset.metric, delta: b.dataset.delta ? Number(b.dataset.delta) : undefined, value: b.dataset.value ? Number(b.dataset.value) : undefined });
  });
  $('btn-offline').onclick = () => dispatch({ type: 'stream.offline' });
  $('btn-fake-chat').onclick = () => {
    const text = $('fake-chat').value.trim();
    if (!text) return;
    post('/api/demo/chat', { login: 'you', text });
    $('fake-chat').value = '';
  };
  $('fake-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-fake-chat').onclick(); });

  // ---- Mic capture: 4 s MediaRecorder segments → /api/audio.
  // Uploads go one at a time (keeps recording order) through a small bounded queue. The server queues
  // and answers 202 quickly; 429 means its backlog is full and the segment was dropped. Every failure
  // is shown, never swallowed.
  const MAX_WAITING_UPLOADS = 3;
  const mic = { session: null, stream: null, ctx: null, meterTimer: null, rec: null, mime: '', uploads: [], uploading: false, lost: 0, seenFailed: Infinity };

  function micState(text) { $('mic-state').textContent = text; }
  // Warnings stay visible (with time) until the next mic start, so a drop isn't missed.
  function micError(text) {
    $('mic-err').textContent = text ? `${new Date().toLocaleTimeString()} ${text}` : '';
    $('mic-err').hidden = !text;
    if (text) addStatus(`⚠ mic: ${text}`, true);
  }
  function renderSpeech(sp) {
    if (!sp) return;
    const btn = $('btn-mic');
    if (!sp.available) {
      btn.disabled = true;
      btn.title = sp.reason || 'Microphone transcription is not configured';
      if (!mic.session) micState(sp.reason || 'unavailable');
      return;
    }
    btn.disabled = false;
    btn.title = '';
    if (mic.session) {
      // sp.dropped counts server-side (429) drops; mic.lost counts segments the browser couldn't even upload.
      micState(`listening · server queue ${sp.pending}/${sp.capacity}${sp.busy ? ' · transcribing' : ''} · done ${sp.processed} · dropped ${sp.dropped + mic.lost} · failed ${sp.failed}`);
    }
    if (sp.failed > mic.seenFailed) {
      mic.seenFailed = sp.failed;
      micError(`transcription/extraction failed: ${sp.lastError}`);
    }
  }

  function queueUpload(blob, session) {
    if (mic.uploads.length >= MAX_WAITING_UPLOADS) {
      mic.lost++;
      micError('uploads are backed up (network?): dropped a 4 s segment');
      return;
    }
    mic.uploads.push({ blob, session });
    void pumpUploads();
  }
  async function pumpUploads() {
    if (mic.uploading) return;
    mic.uploading = true;
    while (mic.uploads.length) {
      const { blob, session } = mic.uploads.shift();
      try {
        const r = await fetch('/api/audio', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Mic-Session': session }, body: blob });
        const j = await r.json().catch(() => ({}));
        if (r.status === 429) micError('speech backend is behind: a 4 s segment was dropped');
        else if (r.status === 401) { showSignIn(); stopMic(); }
        else if (!r.ok) { mic.lost++; micError(`audio upload failed (${r.status}): ${j.error || r.statusText}`); }
      } catch (err) {
        mic.lost++;
        micError(`audio upload failed: ${err.message}`);
      }
    }
    mic.uploading = false;
  }

  function stopMic() {
    if (!mic.session) return;
    mic.session = null; // the in-flight segment still uploads (it is real speech); no new segment starts
    if (mic.rec && mic.rec.state !== 'inactive') mic.rec.stop();
    mic.rec = null;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.stream = null;
    clearInterval(mic.meterTimer);
    mic.ctx.close().catch(() => {});
    mic.ctx = null;
    $('meter').style.width = '0';
    $('btn-mic').textContent = 'Start mic';
    micState('off');
  }

  function startSegment(session) {
    if (mic.session !== session) return;
    let r;
    try {
      r = new MediaRecorder(mic.stream, { mimeType: mic.mime });
    } catch (err) {
      micError(`recorder failed: ${err.message}`);
      stopMic();
      return;
    }
    const parts = [];
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    r.onerror = (e) => micError(`recorder error: ${e.error ? e.error.message : 'unknown'}`);
    r.onstop = () => {
      const blob = new Blob(parts, { type: mic.mime });
      if (blob.size > 2000) queueUpload(blob, session);
      startSegment(session); // no-op once this session was stopped or replaced
    };
    r.start();
    mic.rec = r;
    setTimeout(() => { if (r.state !== 'inactive') r.stop(); }, 4000);
  }

  $('btn-mic').onclick = async () => {
    if (mic.session) { stopMic(); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime) { micError('this browser cannot record audio segments (MediaRecorder unsupported)'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      micError(`mic permission failed: ${err.message}`);
      return;
    }
    const session = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    Object.assign(mic, { session, stream, mime, lost: 0, seenFailed: snap && snap.speech ? snap.speech.failed : 0 });
    micError('');
    mic.ctx = new AudioContext();
    const an = mic.ctx.createAnalyser(); an.fftSize = 512;
    mic.ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    mic.meterTimer = setInterval(() => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += Math.abs(v - 128); $('meter').style.width = `${Math.min(100, (s / buf.length) * 3)}%`; }, 100);
    startSegment(session);
    $('btn-mic').textContent = 'Stop mic';
    micState('listening · 4 s segments');
  };
})();
