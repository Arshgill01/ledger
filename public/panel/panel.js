(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let snap = null;

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
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
  function addStatus(text) {
    const el = document.createElement('div');
    el.textContent = text;
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
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'snapshot') applySnapshot(m);
      else if (m.type === 'state') { snap.state = m.state; renderIous(); }
      else if (m.type === 'transcript') addTranscript(m.line);
      else if (m.type === 'chat') addChat(m.line);
      else if (m.type === 'status') { addStatus(m.text); if (snap) { snap.twitchConnected = m.twitchConnected; $('pill-twitch').textContent = `twitch: ${m.twitchConnected ? 'connected' : snap.mode === 'demo' ? 'simulated' : 'not connected'}`; $('pill-twitch').classList.toggle('on', m.twitchConnected); } }
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }
  connect();

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
    dispatch({ type: 'iou.manual', text, actor: { userId: 'panel', login: snap.channel, isBroadcaster: true, isMod: true } });
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

  // Mic capture: 4s MediaRecorder chunks → /api/audio
  let rec = null, stream = null, meterTimer = null;
  $('btn-mic').onclick = async () => {
    if (rec) {
      rec.stop(); stream.getTracks().forEach((t) => t.stop()); rec = null; stream = null;
      clearInterval(meterTimer); $('meter').style.width = '0';
      $('btn-mic').textContent = 'Start mic'; $('mic-state').textContent = 'off';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      addStatus(`mic permission failed: ${err.message}`);
      return;
    }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    meterTimer = setInterval(() => { an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += Math.abs(v - 128); $('meter').style.width = `${Math.min(100, (s / buf.length) * 3)}%`; }, 100);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const startSegment = () => {
      const r = new MediaRecorder(stream, { mimeType: mime });
      const parts = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = async () => {
        const blob = new Blob(parts, { type: mime });
        if (blob.size > 2000) fetch('/api/audio', { method: 'POST', headers: { 'Content-Type': mime }, body: blob }).catch(() => {});
        if (rec) startSegment();
      };
      r.start();
      rec = r;
      setTimeout(() => r.state !== 'inactive' && r.stop(), 4000);
    };
    startSegment();
    $('btn-mic').textContent = 'Stop mic'; $('mic-state').textContent = 'listening · 4s chunks';
  };
})();
