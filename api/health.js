// GET /api/health -> which model is live (never returns the key)
import { llmConfig, narrate } from './_llm.js';
import { PROMPT_VERSION } from '../engine/narrator.js';

let lastProbe = 0;

// GET /api/health?probe=1 makes one tiny model call and reports the real error or speed, to diagnose a live setup.
export default async function handler(req, res) {
  const { live, provider, model, backup } = llmConfig();
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (new URL(req.url, 'http://x').searchParams.get('probe')) {
    if (!live) return res.end(JSON.stringify({ probe: 'skipped', reason: 'No LLM_PROVIDER / LLM_API_KEY set' }));
    if (Date.now() - lastProbe < 15000) return res.end(JSON.stringify({ probe: 'skipped', reason: 'Wait 15 seconds between probes' }));
    lastProbe = Date.now();
    const t0 = Date.now();
    try {
      const r = await narrate('Reply with the JSON {"ok": true} and nothing else.', 'ping', { timeoutMs: 14000 });
      return res.end(JSON.stringify({ probe: 'ok', model: r.model, ms: Date.now() - t0, tokens: r.usage, reply: r.text.slice(0, 80) }));
    } catch (e) {
      return res.end(JSON.stringify({ probe: 'failed', model, ms: Date.now() - t0, error: e.message }));
    }
  }
  res.end(JSON.stringify({ ok: true, live, provider: live ? provider : null, model: live ? model : null, backup: live && backup ? backup.model : null, promptVersion: PROMPT_VERSION }));
}
