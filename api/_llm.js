// Provider-agnostic LLM gateway. One function, three providers, chosen by env vars.
//   LLM_PROVIDER = gemini | openai | anthropic
//   LLM_API_KEY  = the provider key (server-side only, never sent to the browser)
//   LLM_MODEL    = optional override
//   LLM_BACKUP_PROVIDER / LLM_BACKUP_API_KEY / LLM_BACKUP_MODEL = optional backup from a different company
//   (the PM note's choice: Gemini 2.5 Flash-Lite primary, Claude Haiku 5.5 backup). Used if the primary errors or times out.
const DEFAULT_MODEL = { gemini: 'gemini-3.5-flash-lite', openai: 'gpt-4.1-mini', anthropic: 'claude-haiku-5-5' };

export function llmConfig() {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  const key = process.env.LLM_API_KEY || '';
  const live = Boolean(key && DEFAULT_MODEL[provider]);
  const bp = (process.env.LLM_BACKUP_PROVIDER || '').toLowerCase();
  const bkey = process.env.LLM_BACKUP_API_KEY || '';
  const backup = bkey && DEFAULT_MODEL[bp] ? { provider: bp, model: process.env.LLM_BACKUP_MODEL || DEFAULT_MODEL[bp], key: bkey } : null;
  return { live, provider, model: process.env.LLM_MODEL || DEFAULT_MODEL[provider] || null, key, backup };
}

export async function narrate(system, user, { timeoutMs = Number(process.env.NARRATOR_TIMEOUT_MS || 10000) } = {}) {
  const { live, provider, model, key, backup } = llmConfig();
  if (!live) throw new Error('No LLM configured');
  try {
    return await callProvider({ provider, model, key }, system, user, timeoutMs);
  } catch (e) {
    if (!backup) throw e;
    const r = await callProvider(backup, system, user, timeoutMs);
    return { ...r, failover: `Primary ${model} failed (${e.message}); answered by backup` };
  }
}

async function callProvider({ provider, model, key }, system, user, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    let text, usage;
    if (provider === 'gemini') {
      // Gemini 2.5 can switch thinking off. Gemini 3.x always thinks, so use the lowest level and leave room for it.
      const generationConfig = { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: 'application/json' };
      if (model.startsWith('gemini-2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      else if (model.startsWith('gemini-3')) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
      const call = (gc) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: gc }),
      });
      let r = await call(generationConfig);
      if (r.status === 400 && generationConfig.thinkingConfig) { // thinking setting not accepted by this model: retry without it
        const { thinkingConfig, ...plain } = generationConfig;
        r = await call(plain);
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `Gemini HTTP ${r.status}`);
      text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      usage = { in: j.usageMetadata?.promptTokenCount || 0, out: j.usageMetadata?.candidatesTokenCount || 0 };
    } else if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `OpenAI HTTP ${r.status}`);
      text = j.choices?.[0]?.message?.content || '';
      usage = { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 };
    } else if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 500, temperature: 0.2, system, messages: [{ role: 'user', content: user }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `Anthropic HTTP ${r.status}`);
      text = (j.content || []).map((c) => c.text || '').join('');
      usage = { in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 };
    }
    return { text, usage, provider, model, latencyMs: Date.now() - t0 };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timed out after ${timeoutMs} ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
