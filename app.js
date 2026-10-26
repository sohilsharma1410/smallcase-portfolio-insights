// Portfolio Pulse prototype UI.
// Left: the investor's phone, nothing about how the card was made. Right: how it was made, and tests for reviewers.
// Calls /api/insight (server pipeline, live model). With no server (static preview) it runs the same pipeline
// in the browser with saved AI answers.
import { inr, inrSigned, groupIN } from './engine/format.js';
import { SYSTEM_PROMPT, PROMPT_VERSION } from './engine/narrator.js';
import { FALLBACK_REASONS } from './engine/pipeline.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = (n) => (n < 0 ? 'down' : 'up');
const pcls = (n) => (n < 0 ? 'neg' : 'pos');
const signedPct = (p) => `${p > 0 ? '+' : p < 0 ? '-' : ''}${Math.abs(p).toFixed(2)}%`;
const fmt = (n) => `${n < 0 ? '-' : ''}${groupIN(n)}`;

const PERSONAS = [
  { id: 'aditi', name: 'Aditi', blurb: 'smallcases, funds, US stocks, an FD', story: 'Bank stocks fell across 3 of her holdings' },
  { id: 'rohan', name: 'Rohan', blurb: 'New investor, funds with SIPs', story: 'Balance went up while markets fell' },
  { id: 'meera', name: 'Meera', blurb: 'US stocks, a midcap fund, Indian stocks', story: 'A results-day jump and a rupee effect' },
];
const WINDOWS = [['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['SLV', 'Since last visit']];
const TYPE_LABEL = { smallcase: 'smallcase', mf: 'Mutual fund', us_stock: 'US stock', in_stock: 'Stock', fd: 'Fixed deposit' };

const OUTCOME = {
  ai: { label: 'AI card', sub: 'Passed every check on the first try', tone: 'ok' },
  ai_retry: { label: 'AI card, fixed on the second try', sub: 'The AI was told exactly which check failed and corrected it', tone: 'ok' },
  ai_trimmed: { label: 'AI card, with the bad sentence removed', sub: 'Only the sentence that kept failing was dropped. Everything left passed every check', tone: 'ok' },
  template: { label: 'Standard summary', sub: '', tone: 'neutral' },
};

const state = { persona: 'aditi', window: 'SLV', mode: 'live', tab: 'how', result: null, server: null, loading: false , test: null };
try { const t = localStorage.getItem('pp-tab2'); if (['how', 'proof'].includes(t)) state.tab = t; } catch {}

// ---------- data ----------
let localMods = null;
async function loadLocal() {
  if (!localMods) {
    const [data, notes, cached, pipe] = await Promise.all([
      import('./data/market.js'), import('./data/driver_notes.js'), import('./data/cached_narratives.js'), import('./engine/pipeline.js'),
    ]);
    localMods = { data: data.default, notes: notes.default, cached: cached.default, runInsight: pipe.runInsight };
  }
  return localMods;
}
async function checkServer() {
  try {
    const r = await fetch('./api/health', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    state.server = await r.json();
  } catch { state.server = { ok: false, live: false }; }
  if (!state.server.live) state.mode = 'cached';
}
async function fetchInsight(test) {
  const q = new URLSearchParams({ persona: state.persona, window: state.window, mode: state.mode });
  if (test) { q.set('inject', test.fault); if (test.repeat) q.set('repeat', '1'); }
  if (state.server && state.server.ok) {
    const r = await fetch(`./api/insight?${q}`, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }
  const m = await loadLocal();
  return m.runInsight({ data: m.data, notes: m.notes, cached: m.cached, personaId: state.persona, window: state.window, mode: 'cached',
    inject: test ? test.fault : null, repeat: test ? test.repeat : false });
}
async function refresh(test = null) {
  state.loading = true; state.test = test; render();
  try { state.result = await fetchInsight(test); state.error = null; }
  catch (e) { state.error = e.message; }
  state.loading = false; render();
}
function render() { renderPersonas(); renderPhone(); renderPanel(); }

// ---------- persona picker ----------
function renderPersonas() {
  $('#personas').innerHTML = PERSONAS.map((p) => `
    <button type="button" class="persona" role="radio" data-p="${p.id}" aria-checked="${state.persona === p.id}">
      <strong>${esc(p.name)}</strong><span>${esc(p.blurb)}</span><em>${esc(p.story)}</em>
    </button>`).join('');
  $('#who').textContent = PERSONAS.find((p) => p.id === state.persona).name;
}
document.addEventListener('click', (e) => {
  const p = e.target.closest('.persona');
  if (p) { state.persona = p.dataset.p; state.window = 'SLV'; closeSheet(); refresh(); return; }
  const t = e.target.closest('.tabs button');
  if (t) { state.tab = t.dataset.tab; try { localStorage.setItem('pp-tab2', state.tab); } catch {} renderPanel(); return; }
});

// ---------- phone (investor view, smallcase-style; nothing about how the card was made) ----------
const ICON = {
  pulse: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 13h4l2.5-6 4 11 3-8 1.8 3H22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  discover: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  invest: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  account: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const initials = (n) => n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function renderPhone() {
  const r = state.result;
  const s = $('#screen');
  const nav = `<nav class="p-nav" aria-label="App navigation">
      <span>${ICON.home}Home</span><span>${ICON.discover}Discover</span><span class="on">${ICON.invest}Investments</span><span>${ICON.account}Account</span></nav>`;
  if (!r) { s.innerHTML = `<div class="p-scroll"><div class="p-title">Investments</div><div class="skeleton" style="width:60%;height:28px"></div></div>${nav}`; return; }
  const t = r.packet.total;
  const returns = r.totals.endValue - r.invested;
  const types = ['smallcase', 'mf', 'us_stock', 'in_stock', 'fd'];
  s.innerHTML = `<div class="p-scroll">
    <div class="p-title">Investments</div>
    <div class="p-summary">
      <div class="p-lbl">Current value</div>
      <div class="p-value num">${inr(r.totals.endValue)}</div>
      <div class="p-split">
        <div><div class="p-lbl">Invested</div><div class="num">${inr(r.invested)}</div></div>
        <div><div class="p-lbl">Total returns</div><div class="num ${cls(returns)}">${inrSigned(returns)} (${signedPct(r.allTimeReturn * 100)})</div></div>
      </div>
    </div>

    <div class="pulse" aria-live="polite">
      <div class="pulse-head">${ICON.pulse}<span>Portfolio Pulse</span></div>
      <div class="chips" role="group" aria-label="Time period">
        ${WINDOWS.map(([k, l]) => `<button type="button" class="chip" data-w="${k}" aria-pressed="${state.window === k}">${l}</button>`).join('')}
      </div>
      ${state.loading ? `<div class="skeleton" style="width:95%"></div><div class="skeleton" style="width:75%"></div>` : `
        <p class="pulse-headline">${esc(r.output.headline)}</p>
        <div class="pulse-nums">
          <span>Market <b class="num ${cls(t.gain_inr)}">${inrSigned(t.gain_inr)}</b></span>
          ${t.flows_inr ? `<span>${t.flows_inr > 0 ? 'Added' : 'Withdrawn'} <b class="num">${inr(t.flows_inr)}</b></span>` : ''}
        </div>
        <button type="button" class="see" id="see-what-moved">See what moved ${ICON.chev}</button>`}
    </div>
    <div class="p-foot">As of ${esc(r.packet.as_of.IN)}. Explains past movement. Not investment advice.</div>

    <div class="p-sec">Your holdings</div>
    <div class="p-list">
      ${types.filter((ty) => r.holdings.some((h) => h.type === ty)).map((ty) => r.holdings.filter((h) => h.type === ty).sort((a, b) => b.value - a.value).map((h) => {
        const move = h.pnl + h.income;
        const showWhy = Math.abs(move) >= r.materiality && h.legs.length && h.type !== 'fd';
        return `<div class="hold">
          <div class="hold-logo" aria-hidden="true">${esc(initials(h.name))}</div>
          <div class="hold-main"><div class="hold-name">${esc(h.name)}</div><div class="hold-type">${esc(h.subtype || TYPE_LABEL[h.type])}${showWhy ? ` · <button type="button" class="why" data-h="${h.id}">Why?</button>` : ''}</div></div>
          <div class="hold-right"><div class="num">${inr(h.value)}</div><div class="num small ${cls(move)}">${inrSigned(move)}</div></div>
        </div>`;
      }).join('')).join('')}
    </div>
  </div>${nav}`;
}
$('#screen').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (c) { state.window = c.dataset.w; closeSheet(); refresh(); return; }
  if (e.target.closest('#see-what-moved')) return openDetail();
  const w = e.target.closest('.why');
  if (w) return openHolding(w.dataset.h);
});

function bridgeSvg(t) {
  const rows = [['Market move', t.market_pnl_inr]];
  if (t.income_inr) rows.push(['FD interest', t.income_inr]);
  if (t.flows_inr) rows.push([t.flows_inr > 0 ? 'Money you added' : 'Money you took out', t.flows_inr]);
  rows.push(['Change in balance', t.change_inr]);
  const max = Math.max(...rows.map((r) => Math.abs(r[1])), 1);
  const W = 340, mid = 196, half = 66, rowH = 30, H = rows.length * rowH + 6;
  return `<svg class="bridge-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Where the change came from">
    <line x1="${mid}" x2="${mid}" y1="0" y2="${H}" stroke="#DDE3EA" stroke-width="1"/>
    ${rows.map(([label, v], i) => {
      const w = Math.max(2, (Math.abs(v) / max) * half), y = i * rowH + 6, last = i === rows.length - 1;
      return `<text x="0" y="${y + 13}" fill="${last ? '#2F363F' : '#6B7785'}" font-size="11" font-weight="${last ? 700 : 500}">${esc(label)}</text>
        <rect x="${v < 0 ? mid - w : mid}" y="${y + 2}" width="${w}" height="16" rx="3" fill="${v < 0 ? '#D93C3C' : '#19A35B'}" fill-opacity="${last ? 1 : 0.7}"/>
        <text x="${W}" y="${y + 14}" fill="#2F363F" font-size="10.5" text-anchor="end">${v < 0 ? '-' : '+'}₹${groupIN(v)}</text>`;
    }).join('')}
  </svg>`;
}

function openDetail() {
  const r = state.result; if (!r) return;
  const p = r.packet;
  const ev = Object.fromEntries(p.evidence.map((e) => [e.id, e]));
  const driverCard = (d) => `
    <div class="driver">
      <div class="driver-top"><span>${esc(d.label)}</span><span class="num ${cls(d.pnl_inr)}">${inrSigned(d.pnl_inr)}</span></div>
      <div class="driver-sub">${d.holdings_count} holding${d.holdings_count > 1 ? 's' : ''}: ${esc(d.holdings.join(', '))}</div>
      ${d.securities.filter((x) => x.driver_note).map((x) => `<div class="note-line">${esc(x.driver_note)}</div>`).join('')}
      <div class="ev-row">${d.evidence.map((id) => ev[id]).filter(Boolean).map((e) => `<button type="button" class="ev">${esc(e.text)}${e.date ? ` · ${esc(e.date)}` : ''}</button>`).join('')}</div>
    </div>`;
  openSheet(`
    <div class="grab"></div>
    <div class="sheet-head"><div><h3 id="sheet-title">What moved your portfolio</h3><p class="sheet-sub">${esc(p.window.start)} to ${esc(p.window.end)}</p></div><button type="button" class="close" aria-label="Close" id="sheet-close">&times;</button></div>
    <ul class="summary-list">${r.output.bullets.map((b) => `<li>${esc(b.text)}</li>`).join('')}</ul>
    <h5>Where the change came from</h5>
    ${bridgeSvg(p.total)}
    ${p.drivers.length ? `<h5>Top drivers</h5>${p.drivers.map(driverCard).join('')}` : ''}
    ${p.held_up ? `<h5>${p.total.gain_inr < 0 ? 'What held up' : 'What lagged'}</h5>${driverCard(p.held_up)}` : ''}
    <div class="fb"><span>Was this helpful?</span><button type="button" data-fb="up">Yes</button><button type="button" data-fb="down">No</button><button type="button" data-fb="wrong">Looks wrong</button></div>
    <p class="disclaimer">Explains past movement. Not investment advice.</p>`);
}
function openHolding(id) {
  const r = state.result; const h = r.holdings.find((x) => x.id === id); if (!h) return;
  openSheet(`
    <div class="grab"></div>
    <div class="sheet-head"><div><h3 id="sheet-title">${esc(h.name)}</h3><p class="sheet-sub">Why it moved, ${esc(r.packet.window.label)}</p></div><button type="button" class="close" aria-label="Close" id="sheet-close">&times;</button></div>
    <div class="pulse-nums" style="margin-top:10px">
      <span>Market move <b class="num ${cls(h.pnl)}">${inrSigned(h.pnl)}</b></span>
      ${h.flows ? `<span>${h.flows > 0 ? 'Added' : 'Withdrawn'} <b class="num">${inr(h.flows)}</b></span>` : ''}
    </div>
    ${h.lookThroughOk === false ? `<div class="note-line" style="margin-top:10px">The fund's latest published holdings do not explain this move, so it is shown for the fund as a whole.</div>` : ''}
    <h5>Biggest contributors</h5>
    ${h.legs.map((l) => `<div class="driver"><div class="driver-top"><span>${esc(l.label)}${l.move != null ? ` <span class="muted-in">${l.move > 0 ? '+' : ''}${l.move}%</span>` : ''}</span><span class="num ${cls(l.pnl)}">${inrSigned(l.pnl)}</span></div>
      <div class="driver-sub">${{ 'look-through': 'Inside the fund', fx: 'Rupee vs dollar', residual: 'Fund moves not in its published holdings', 'fund-level': 'Whole fund', constituent: 'Stock in this smallcase' }[l.via] || 'Direct holding'}${l.abnormal ? ' · moved more than its sector' : ''}</div>
      ${l.note ? `<div class="note-line">${esc(l.note)}</div>` : ''}</div>`).join('')}
    <p class="disclaimer">Explains past movement. Not investment advice.</p>`);
}
function openSheet(html) { const sh = $('#sheet'); sh.innerHTML = html; sh.hidden = false; $('#sheet-backdrop').hidden = false; sh.scrollTop = 0; const c = $('#sheet-close'); if (c) c.focus(); }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; }
$('#sheet-backdrop').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
$('#sheet').addEventListener('click', (e) => {
  if (e.target.closest('#sheet-close')) return closeSheet();
  const f = e.target.closest('[data-fb]');
  if (f) return toast({ up: 'Thanks for the feedback.', down: 'Thanks. We will use this to improve.', wrong: 'Thanks. Our team will review this.' }[f.dataset.fb]);
  if (e.target.closest('.ev')) toast('Opens the news item, filing or index page.');
});
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400); }

// ---------- behind the scenes ----------
function renderPanel() {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  const body = $('#panel-body');
  if (state.error) { body.innerHTML = `<div class="banner warn">Could not load the card: ${esc(state.error)}</div>`; return; }
  if (state.tab === 'proof') { body.innerHTML = proofHtml(); return; }
  if (!state.result || state.loading) { body.innerHTML = `<p class="muted">${state.test ? 'Running your test...' : 'Building the card...'}</p>`; return; }
  body.innerHTML = howHtml();
}

function sourceLine() {
  const r = state.result;
  const live = state.server && state.server.live;
  const toggle = live ? `<div class="seg" role="radiogroup" aria-label="AI answer source">
      <button type="button" data-mode="live" aria-checked="${state.mode === 'live'}">Live AI</button>
      <button type="button" data-mode="cached" aria-checked="${state.mode === 'cached'}">Saved answer</button></div>` : '';
  const text = live && state.mode === 'live'
    ? `AI writer runs live on ${esc(state.server.model)}${state.server.backup ? `, backup ${esc(state.server.backup)}` : ''}.`
    : live ? 'Using a saved AI answer (no model call).' : 'This copy has no AI key, so it uses saved AI answers. Everything else runs for real in your browser.';
  return `<div class="source">${toggle}<span>${text}${r && r.servedFrom ? ` (${esc(r.servedFrom)})` : ''}</span></div>`;
}
document.addEventListener('click', (e) => {
  const m = e.target.closest('.source [data-mode]');
  if (m) { state.mode = m.dataset.mode; refresh(state.test); }
});

function resultBox(r) {
  const o = OUTCOME[r.outcome];
  const reason = r.outcome === 'template' ? FALLBACK_REASONS[r.fallbackReason] : o.sub;
  return `<div class="result ${o.tone}">
    <div class="result-label">What the investor got</div>
    <div class="result-main">${esc(o.label)}</div>
    <div class="result-why">${r.outcome === 'template' ? '<b>Why:</b> ' : ''}${esc(reason)}</div>
  </div>`;
}

function stepHtml(n, title, who, line, details, tone = '') {
  return `<li class="tstep ${tone}">
    <div class="tnum">${n}</div>
    <div class="tbody">
      <div class="thead"><span class="ttitle">${title}</span><span class="who ${who === 'aisaved' ? 'ai' : who}">${{ ai: 'AI', aisaved: 'AI, saved overnight', skip: 'Skipped', code: 'Code' }[who]}</span></div>
      <div class="tline">${line}</div>
      ${details ? `<details class="more"><summary>Show details</summary><div class="more-body">${details}</div></details>` : ''}
    </div></li>`;
}
function table(head, rows, right = []) {
  return `<div class="tbl-wrap"><table><thead><tr>${head.map((h, i) => `<th class="${right.includes(i) ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const money = (n) => `<span class="${pcls(n)}">${fmt(n)}</span>`;
const checksHtml = (checks) => `<ul class="checks">${checks.map((c) => `<li><span class="mark ${c.pass ? 'ok' : 'no'}">${c.pass ? '&#10003;' : '&#10007;'}</span><span>${esc(c.name)}${c.detail && !c.pass ? `<small>${esc(c.detail)}</small>` : ''}</span></li>`).join('')}</ul>`;

function howHtml() {
  const r = state.result, p = r.packet, t = p.total;
  const S = Object.fromEntries(r.steps.map((s) => [s.id, s]));
  const bridge = S.bridge;
  const classify = S.classify.rows;
  const unusual = classify.filter((c) => c.class === 'abnormal');
  const notes = S.notes.notes;
  const writes = r.steps.filter((s) => s.id.startsWith('narrate'));
  const checks = r.steps.filter((s) => s.id.startsWith('validate'));
  const nameOf = (sec) => (r.classification[sec] || {}).name || sec;

  // 2. components
  const parts = [`market move <b class="${pcls(t.gain_inr)}">${inrSigned(t.gain_inr)}</b>${t.income_inr ? ` (prices ${inrSigned(t.market_pnl_inr)}, FD interest ${inrSigned(t.income_inr)})` : ''}`];
  if (t.flows_inr) parts.push(`money ${t.flows_inr > 0 ? 'added' : 'taken out'} <b>${inrSigned(t.flows_inr)}</b>`);
  const s2 = `${parts.join(' + ')} = change in balance <b class="${pcls(t.change_inr)}">${inrSigned(t.change_inr)}</b>. ${bridge.pass ? 'Adds up to the rupee.' : '<span class="neg">Does not add up.</span>'}`;
  const s2d = `<p class="muted">Each holding is split the same way. SIPs and withdrawals are kept apart from market moves, and bonus shares are adjusted so they do not look like a price crash.</p>` +
    table(['Holding', 'Start', 'Market move', 'Added', 'End'], bridge.holdings.map((h) => [esc(h.name), fmt(h.start), money(h.pnl), fmt(h.flows), fmt(h.end)]), [1, 2, 3, 4]);

  // 3. dig deeper
  const top = p.drivers[0];
  const s3 = top ? `Grouped across holdings by what moved them. Biggest: <b>${esc(top.label)}</b> ${inrSigned(top.pnl_inr)} across ${top.holdings_count} holding${top.holdings_count > 1 ? 's' : ''}. ${unusual.length ? `${unusual.length} stock${unusual.length > 1 ? 's' : ''} moved far more than ${unusual.length > 1 ? 'their' : 'its'} sector.` : 'Nothing moved unusually.'}`
    : 'Nothing moved enough to call out.';
  const s3d = (p.drivers.length ? `<p class="muted">Moves below ₹${groupIN(p.user.materiality_inr)} are ignored for this investor (the larger of ₹500 or 0.05% of the portfolio).</p>` +
    table(['What moved', 'Amount', 'Holdings'], [...p.drivers, ...(p.held_up ? [p.held_up] : [])].map((d) => [esc(d.label), money(d.pnl_inr), d.holdings_count]), [1, 2]) : '') +
    `<p class="muted">Each stock is compared with its sector index. "Unusual" means it moved far more than its sector, so it needs its own reason.</p>` +
    table(['Stock', 'Moved', 'Sector moved', 'Verdict'], classify.map((c) => [esc(c.name), `${c.ret}%`, `${c.expected}%`, c.class === 'abnormal' ? '<b>Unusual</b>' : 'With sector']), [1, 2]);

  // 4. agent
  const s4 = notes.length ? notes.map((n) => `<b>${esc(nameOf(n.sec))}</b>: ${esc(n.one_line)}`).join('<br>') + `<div class="muted small">Researched once overnight and shared with every investor who holds it. In this prototype the notes were saved from an earlier agent run, so no model is called here while you watch.</div>`
    : unusual.length ? 'Looked for news on the unusual movers and found nothing it could verify, so the card does not give a reason.' : 'Not needed. No stock moved unusually in this period.';
  const s4d = notes.length ? notes.map((n) => `<div class="kv"><div><span>Stock</span>${esc(nameOf(n.sec))}, ${esc(n.date)}</div><div><span>Reason found</span>${esc(n.one_line)}</div><div><span>Kind / confidence</span>${esc(n.driver_type)} / ${esc(n.confidence)}</div>${(n.rejected || []).length ? `<div><span>Rejected</span>${n.rejected.map((x) => esc(`${x.id}: ${x.reason}`)).join('<br>')}</div>` : ''}</div>`).join('') : '';

  // 5. writer
  let s5, s5d = '', s5who = 'ai';
  if (!writes.length || writes[0].kind === 'skipped') { s5 = r.fallbackReason === 'quiet' ? 'Not called. A quiet period has nothing to explain, so the card uses the standard summary at zero cost.' : 'Not called.'; s5who = 'skip'; }
  else if (writes[0].kind === 'error') s5 = `<span class="neg">${esc(writes[0].summary)}</span>`;
  else {
    const m = writes[writes.length - 1].meta;
    const cost = m.cost_usd ? `$${m.cost_usd.toFixed(5)}` : m.would_cost_usd ? `about $${m.would_cost_usd.toFixed(5)} on Gemini 3.1 Flash-Lite` : '';
    s5 = `Turned about ${groupIN(m.usage.in)} tokens (instructions plus checked facts) into a headline and ${r.output.bullets.length} bullet${r.output.bullets.length > 1 ? 's' : ''}. ${m.provider === 'saved' ? `Saved answer${cost ? `; a live call would cost ${cost.replace(' on Gemini 3.1 Flash-Lite', '')} on Gemini 3.5 Flash-Lite` : ''}` : `${esc(m.model)}${m.latencyMs ? `, ${(m.latencyMs / 1000).toFixed(1)} s` : ''}${cost ? `, ${cost}` : ''}`}.${writes.length > 1 ? ' <b>Needed a second try.</b>' : ''}${m.failover ? ` ${esc(m.failover)}.` : ''}`;
    s5d = `<p class="muted">The AI never sees names or account details, and it does no maths. It only words the facts it is given. See "For reviewers" for the exact input and instructions.</p>` +
      writes.map((w, i) => `<div class="label">${writes.length > 1 ? `Try ${i + 1}: ` : ''}what the AI wrote</div><pre>${esc(prettyJson(w.raw))}</pre>`).join('');
  }
  // 6. validator
  let s6, s6d = '', s6tone = '';
  if (!checks.length) { s6 = 'Nothing to check. The standard summary is built by code from the same numbers.'; }
  else {
    const last = checks[checks.length - 1];
    const n = last.checks.length, ok = last.checks.filter((c) => c.pass).length;
    s6 = checks.length > 1 ? `First draft failed ${checks[0].checks.filter((c) => !c.pass).length} check(s). Second try: ${ok} of ${n} passed.` : `${ok} of ${n} checks passed.`;
    if (r.outcome === 'ai_trimmed') s6 += ' The sentence that kept failing was removed.';
    s6tone = last.pass || r.outcome === 'ai_trimmed' ? 'good' : 'bad';
    s6d = checks.map((c, i) => `${checks.length > 1 ? `<div class="label">Try ${i + 1}</div>` : ''}${checksHtml(c.checks)}`).join('');
  }

  return `${resultBox(r)}
    <p class="muted timing">In the app, this runs every morning before markets open, and the investor just opens a saved card. Here it runs when you click, so you can watch it.</p>
    ${sourceLine()}
    <ol class="timeline">
      ${stepHtml(1, 'Get holdings and prices', 'code', `${r.holdings.length} holdings, every transaction in the period, and closing prices for ${esc(p.window.start)} and ${esc(p.window.end)}.`, '')}
      ${stepHtml(2, 'Calculate the components of change', 'code', s2, s2d)}
      ${stepHtml(3, 'Dig deeper into each component', 'code', s3, s3d)}
      ${stepHtml(4, 'AI agent (uses tools) finds the reason', notes.length ? 'aisaved' : 'skip', s4, s4d)}
      ${stepHtml(5, 'AI writer (one call) words the card', s5who, s5, s5d)}
      ${stepHtml(6, 'Validator checks every word', 'code', s6, s6d, s6tone)}
    </ol>`;
}
const prettyJson = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

// ---------- for reviewers ----------
function proofHtml() {
  const r = state.result;
  return `<p class="lead">For anyone checking the work. Everything here runs in your browser from the same code as the app.</p>
    <div class="proof-block"><h3>Release tests</h3>
      <p class="muted">The checks every prompt or model change must pass before release: the numbers add up, bonus shares are handled, fund fallbacks work, every saved AI answer passes, every injected mistake is caught, and each mistake ends in the right outcome.</p>
      <button type="button" class="btn" id="run-evals">Run all tests</button><div id="eval-out"></div></div>
    <details class="proof-block"><summary>What the AI writer is given (facts packet)</summary>
      <p class="muted">Built by code, adds up to the rupee, no names or account details. About ${r ? Math.ceil(JSON.stringify(r.packet).length / 4) : 900} tokens.</p>
      <pre>${r ? esc(JSON.stringify(r.packet, null, 2)) : ''}</pre></details>
    <details class="proof-block"><summary>The AI writer's instructions (${esc(PROMPT_VERSION)})</summary><pre>${esc(SYSTEM_PROMPT)}</pre></details>
    <p class="muted small">All companies, funds, people, prices and news are made up by a seeded script. Index names are used only as labels. Not affiliated with smallcase.</p>`;
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#run-evals')) return;
  const out = $('#eval-out');
  out.innerHTML = '<p class="muted">Running...</p>';
  const m = await loadLocal();
  const { runEvals } = await import('./evals/suite.js');
  const { results, passed, total } = await runEvals({ data: m.data, notes: m.notes, cached: m.cached });
  const groups = {};
  results.forEach((x) => (groups[x.suite] = groups[x.suite] || []).push(x));
  out.innerHTML = `<div class="banner ${passed === total ? 'ok' : 'warn'}"><b>${passed} of ${total} passed</b></div>` +
    Object.keys(groups).sort().map((g) => { const ok = groups[g].filter((c) => c.pass).length; return `<details class="eval-group"><summary>${esc(g)} <span class="muted">${ok}/${groups[g].length}</span></summary>${checksHtml(groups[g].map((c) => ({ ...c, detail: c.pass ? '' : c.detail })))}</details>`; }).join('');
});

// ---------- boot ----------
render();
await checkServer();
refresh();
