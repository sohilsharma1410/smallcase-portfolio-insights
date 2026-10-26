// GET /api/health -> which model is live (never returns the key)
import { llmConfig, narrate } from './_llm.js';
import { PROMPT_VERSION } from '../engine/narrator.js';

let lastProbe = 0;

// GET /api/health?probe=1 makes one tiny model call and reports the real error or speed, to diagnose a live setup.
export default async function handler(req, res) {
  const { live, provider, model, backup } = llmConfig();
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const probe = new URL(req.url, 'http://x').searchParams.get('probe');
  if (probe === 'deep') {
    // Raw Gemini calls in parallel, so one slow variant cannot hide the others. Never returns the key.
    if (!live || provider !== 'gemini') return res.end(JSON.stringify({ probe: 'skipped', reason: 'Deep probe is for Gemini only' }));
    if (Date.now() - lastProbe < 15000) return res.end(JSON.stringify({ probe: 'skipped', reason: 'Wait 15 seconds between probes' }));
    lastProbe = Date.now();
    const key = process.env.LLM_API_KEY;
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    const timed = async (name, url, init) => {
      const t0 = Date.now(), ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 11000);
      try {
        const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key } });
        const j = await r.json().catch(() => ({}));
        return { name, status: r.status, ms: Date.now() - t0, error: j.error?.message?.slice(0, 160), reply: j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').slice(0, 40), thoughtTokens: j.usageMetadata?.thoughtsTokenCount, finish: j.candidates?.[0]?.finishReason, models: j.models ? j.models.map((m) => m.name.replace('models/', '')).filter((n) => /flash|lite/.test(n)).slice(0, 25) : undefined };
      } catch (e) { return { name, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'No answer within 11 s' : e.message }; }
      finally { clearTimeout(timer); }
    };
    const gen = (model, gc) => ({ method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word ok' }] }], generationConfig: { maxOutputTokens: 200, ...gc } }) });
    const gurl = (m) => `${base}/models/${m}:generateContent`;
    const results = await Promise.all([
      timed('list models the key can use', `${base}/models?pageSize=100`, { method: 'GET' }),
      timed('3.5-flash-lite, thinking minimal', gurl('gemini-3.5-flash-lite'), gen('x', { thinkingConfig: { thinkingLevel: 'minimal' } })),
      timed('3.5-flash-lite, no thinking setting', gurl('gemini-3.5-flash-lite'), gen('x', {})),
      timed('3.5-flash-lite, thinking low', gurl('gemini-3.5-flash-lite'), gen('x', { thinkingConfig: { thinkingLevel: 'low' } })),
    ]);
    return res.end(JSON.stringify({ probe: 'deep', results }));
  }
  if (probe) {
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
