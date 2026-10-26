// GET /api/insight?persona=aditi&window=1W&mode=live|cached|template&inject=<fault>&fresh=1
// The server rebuilds the facts packet itself from persona + window, so this endpoint cannot be used
// as a free general-purpose LLM proxy. Live calls are rate limited and cached.
import data from '../data/market.js';
import notes from '../data/driver_notes.js';
import cached from '../data/cached_narratives.js';
import { runInsight } from '../engine/pipeline.js';
import { FAULT_TYPES } from '../engine/narrator.js';
import { llmConfig, narrate } from './_llm.js';

const WINDOWS = new Set(['1D', '1W', '1M', 'SLV']);
const MODES = new Set(['live', 'cached', 'template']);
const resultCache = new Map(); // key -> {at, body}
const hits = new Map(); // ip -> [timestamps]
let dayKey = '', dayCount = 0;
const MAX_PER_DAY = Number(process.env.MAX_LIVE_CALLS_PER_DAY || 500);

function allowLive(ip) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  if (dayCount >= MAX_PER_DAY) return 'Daily live-call budget reached';
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 15) return 'Too many live calls from this browser. Try again in a few minutes';
  list.push(now); hits.set(ip, list); dayCount++;
  return null;
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const personaId = q.get('persona') || 'aditi';
    const window = q.get('window') || 'SLV';
    let mode = q.get('mode') || 'live';
    const inject = q.get('inject') || null;
    const repeat = q.get('repeat') === '1';
    if (!data.personas.some((p) => p.id === personaId) || !WINDOWS.has(window) || !MODES.has(mode) || (inject && !FAULT_TYPES[inject] && inject !== 'outage')) {
      res.statusCode = 400; res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'Bad parameters' }));
    }
    const cfg = llmConfig();
    let notice = null;
    if (mode === 'live' && !cfg.live) { mode = 'cached'; notice = 'No AI key is set on this deployment, so the saved AI answer is shown. The pipeline is identical.'; }

    const key = `${personaId}:${window}:${mode}:${inject || ''}:${repeat ? 1 : 0}`;
    const hit = resultCache.get(key);
    if (mode === 'live' && !q.get('fresh') && hit && Date.now() - hit.at < 10 * 60e3) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ...hit.body, servedFrom: 'server cache (10 min)' }));
    }
    if (mode === 'live') {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
      const blocked = allowLive(ip);
      if (blocked) { mode = 'cached'; notice = `${blocked}. Showing the cached output.`; }
    }

    const result = await runInsight({ data, notes, personaId, window, mode, inject, repeat, cached, narrate });
    const body = { ...result, mode, notice, llm: { live: cfg.live, provider: cfg.provider || null, model: cfg.model } };
    if (mode === 'live') resultCache.set(key, { at: Date.now(), body });
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  } catch (e) {
    res.statusCode = 500; res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: e.message }));
  }
}
