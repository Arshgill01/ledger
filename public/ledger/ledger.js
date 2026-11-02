(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const condText = (c) => c.kind === 'count' ? `${c.progress}/${c.target} ${c.metric}` : c.kind === 'none' ? 'no strings attached' : c.label;
  const stampWord = { OPEN: 'IOU', DUE: 'DUE', PAID: 'PAID', WELCHED: 'CAP', PENDING: 'IOU?', VOID: 'VOID' };

  function card(i) {
    const pct = i.condition.kind === 'count' ? Math.min(100, Math.round((i.condition.progress / i.condition.target) * 100)) : null;
    const d = (s) => s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const receipt = i.receipt || {};
    const thumb = receipt.thumbnailUrl ? `<a href="${esc(receipt.clipUrl || '#')}" target="_blank"><img class="thumb" src="${esc(receipt.thumbnailUrl)}" alt="receipt clip"></a>` : '';
    const links = [receipt.clipUrl && `<a href="${esc(receipt.clipUrl)}" target="_blank">condition clip</a>`, receipt.payoffClipUrl && `<a href="${esc(receipt.payoffClipUrl)}" target="_blank">payoff clip</a>`].filter(Boolean).join(' · ');
    return `<div class="receipt ${i.state.toLowerCase()}">
      <div class="head"><span class="id">IOU #${i.id}</span><span>${esc(i.channel)}</span></div>
      <div class="text">${esc(i.text)}</div>
      <div class="cond"><span>${esc(condText(i.condition))}</span>${pct !== null ? `<span>${pct}%</span>` : ''}</div>
      ${pct !== null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
      ${thumb}
      ${links ? `<div class="cond" style="margin-top:8px">${links}</div>` : ''}
      <div class="stamp">${stampWord[i.state] || i.state}</div>
      <div class="foot"><span>said ${d(i.createdAt)}</span><span>${i.settledAt ? `settled ${d(i.settledAt)}` : i.dueAt ? `due ${d(i.dueAt)}` : `“${esc(i.quote).slice(0, 40)}”`}</span></div>
    </div>`;
  }

  function render(s) {
    document.getElementById('badge').hidden = s.mode !== 'demo';
    document.getElementById('title').textContent = `${s.channel}'s Ledger`;
    const by = (st) => s.ious.filter((i) => i.state === st).sort((a, b) => b.id - a.id);
    for (const st of ['open', 'due', 'paid', 'welched']) {
      const list = by(st.toUpperCase());
      document.getElementById(`n-${st}`).textContent = list.length;
      document.getElementById(st).innerHTML = list.length ? list.map(card).join('') : `<div class="empty">${st === 'welched' ? 'Clean record. For now.' : st === 'paid' ? 'No receipts yet.' : 'Nothing here.'}</div>`;
    }
  }

  // Public, read-only feed. Reconnects so a shared link keeps updating through server restarts.
  fetch('/api/public/state').then((r) => r.json()).then(render);
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === 'snapshot' || m.type === 'state') render(m.snapshot); };
    ws.onclose = () => setTimeout(connect, 3000);
  }
  connect();
})();
