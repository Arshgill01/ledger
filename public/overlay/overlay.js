(() => {
  const q = new URLSearchParams(location.search);
  const MAX = Number(q.get('max') || 5);
  const board = document.getElementById('board');
  const stage = document.getElementById('stage');
  const badge = document.getElementById('badge');
  const cards = new Map();
  let state = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function condText(c) {
    if (!c) return '';
    if (c.kind === 'count') return `${c.progress}/${c.target} ${c.metric}`;
    if (c.kind === 'time' || c.kind === 'event') return c.label;
    return 'no strings attached';
  }

  function render(iou) {
    const cls = `receipt ${iou.state.toLowerCase()}`;
    const stampWord = { OPEN: 'IOU', DUE: 'DUE', PAID: 'PAID', WELCHED: 'CAP', PENDING: 'IOU?', VOID: 'VOID' }[iou.state] || iou.state;
    const pct = iou.condition.kind === 'count' ? Math.min(100, Math.round((iou.condition.progress / iou.condition.target) * 100)) : null;
    const votes = iou.state === 'DUE' ? `<div class="votes"><span>!paid <b>${iou.votes.paid}</b></span><span>!cap <b>${iou.votes.cap}</b></span></div>` : '';
    const thumb = iou.state === 'PAID' && iou.receipt && iou.receipt.thumbnailUrl ? `<img class="thumb" src="${esc(iou.receipt.thumbnailUrl)}" alt="receipt clip">` : '';
    const when = new Date(iou.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<div class="head"><span class="id">IOU #${iou.id}</span><span>${esc(iou.channel)}</span></div>
      <div class="text">${esc(iou.text)}</div>
      <div class="cond"><span>${esc(condText(iou.condition))}</span>${pct !== null ? `<span>${pct}%</span>` : ''}</div>
      ${pct !== null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
      ${votes}${thumb}
      <div class="stamp">${stampWord}</div>
      <div class="foot"><span>logged ${when}</span><span>${iou.state === 'DUE' ? 'vote !paid / !cap' : iou.state === 'OPEN' ? '!owed' : iou.state.toLowerCase()}</span></div>`;
  }

  function sync() {
    if (!state) return;
    const live = state.ious.filter((i) => i.state === 'DUE' || i.state === 'OPEN' || (i.state === 'PAID' && Date.now() - new Date(i.settledAt).getTime() < 15000) || (i.state === 'WELCHED' && Date.now() - new Date(i.settledAt).getTime() < 15000));
    live.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    const shown = live.slice(0, MAX);
    const ids = new Set(shown.map((i) => i.id));
    for (const [id, el] of cards) {
      if (!ids.has(id) && !el.classList.contains('leaving')) {
        el.classList.add('leaving');
        setTimeout(() => { el.remove(); cards.delete(id); }, 500);
      }
    }
    for (const iou of shown) {
      let el = cards.get(iou.id);
      if (!el) {
        el = document.createElement('div');
        cards.set(iou.id, el);
        board.appendChild(el);
      }
      el.className = `receipt ${iou.state.toLowerCase()}`;
      el.innerHTML = render(iou);
    }
    // keep DOM order == sort order
    shown.forEach((iou) => board.appendChild(cards.get(iou.id)));
  }
  function rank(i) { return i.state === 'DUE' ? 0 : i.state === 'OPEN' ? 1 : 2; }

  function slam(kind, iou) {
    const el = document.createElement('div');
    el.className = `stamp-big ${kind}`;
    const word = { stamp: `IOU #${iou.id}`, due: `IOU #${iou.id} DUE`, paid: `PAID`, welched: `CAP` }[kind] || kind.toUpperCase();
    const sub = kind === 'paid' ? `IOU #${iou.id}: ${iou.text}` : kind === 'welched' ? `IOU #${iou.id} welched. Chat remembers.` : iou.text;
    el.innerHTML = `${esc(word)}<small>${esc(sub)}</small>`;
    stage.innerHTML = '';
    stage.appendChild(el);
    setTimeout(() => el.remove(), 2700);
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      // Public feed (/ws): redacted snapshot with vote counts, no transcript/chat/voter ids.
      if (msg.type === 'snapshot') { state = msg.snapshot; badge.hidden = msg.snapshot.mode !== 'demo'; sync(); }
      if (msg.type === 'state') { state = msg.snapshot; sync(); }
      if (msg.type === 'overlay' && ['stamp', 'due', 'paid', 'welched'].includes(msg.event)) slam(msg.event, msg.iou);
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }
  connect();
  setInterval(sync, 3000);
})();
