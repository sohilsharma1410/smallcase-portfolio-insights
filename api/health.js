// GET /api/health -> which model is live (never returns the key)
import { llmConfig } from './_llm.js';
import { PROMPT_VERSION } from '../engine/narrator.js';

export default function handler(req, res) {
  const { live, provider, model, backup } = llmConfig();
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ ok: true, live, provider: live ? provider : null, model: live ? model : null, backup: live && backup ? backup.model : null, promptVersion: PROMPT_VERSION }));
}
