// Nightly Driver Research Agent (batch). Regenerates data/driver_notes.js.
//   LLM_PROVIDER=gemini LLM_API_KEY=... node scripts/research-batch.mjs
//
// 1. Code finds abnormal single-day moves (residual vs sector index, |z| > 3).
// 2. Code runs the agent's tools: news, results and corporate actions for that security in a 3-day window.
//    (In production the agent calls these as tools, up to 4 calls. Here the same tool outputs are pre-fetched
//     so the script works with any provider without provider-specific tool-calling code.)
// 3. The LLM picks the evidence that explains the move, or says none does, and writes one line.
// 4. Code checks the note: evidence IDs exist, match the security, sit inside the window. Else it is dropped.
import { writeFileSync } from 'node:fs';
import data from '../data/market.js';
import { narrate, llmConfig } from '../api/_llm.js';
import { parseNarratorOutput } from '../engine/narrator.js';

const SECTOR_INDEX = { Banks: 'NIFTYBANK', IT: 'NIFTYIT', Auto: 'NIFTYAUTO', Pharma: 'NIFTYPHARMA', FMCG: 'NIFTYFMCG', 'Capital goods': 'NIFTYCAPG', 'US tech': 'SP500', 'US broad market': 'SP500' };
const SYSTEM = `You are a market research analyst. A stock moved much more than its sector on one day.
From the candidate evidence only, pick the item(s) that plausibly explain the move, or none.
Rules: use only the candidates given. Never invent events. Reject items outside the date window or about another company.
confidence "high" only for results or official filings on the move day; "medium" for news on the move day; otherwise do not explain.
Output JSON only: {"explained": true|false, "driver_type": "results|news|corporate_action|none", "evidence_ids": [], "confidence": "high|medium|low", "one_line": "max 25 words, past tense, no advice, no predictions", "rejected": [{"id": "", "reason": ""}]}`;

if (!llmConfig().live) { console.error('Set LLM_PROVIDER and LLM_API_KEY first.'); process.exit(1); }

const { days } = data;
const events = [];
for (const [sec, s] of Object.entries(data.securities)) {
  const lv = data.indices[SECTOR_INDEX[s.sector]].levels;
  for (let i = 1; i < days.length; i++) {
    const b = data.bonus[sec];
    const prev = b && b.date === days[i] ? data.prices[sec][i - 1] / b.ratio : data.prices[sec][i - 1];
    const r = data.prices[sec][i] / prev - 1;
    const ref = s.market === 'US' && s.sector === 'US tech' ? s.beta * (lv[i] / lv[i - 1] - 1) : lv[i] / lv[i - 1] - 1;
    const z = (r - ref) / s.idio;
    if (Math.abs(z) > 3) events.push({ sec, name: s.name, date: days[i], move_pct: +(r * 100).toFixed(2), sector_pct: +(ref * 100).toFixed(2), z: +z.toFixed(2) });
  }
}
console.log(`${events.length} abnormal moves found`);

const notes = {};
for (const ev of events) {
  const lo = days[Math.max(0, days.indexOf(ev.date) - 2)];
  // "tools": everything about this security, plus the latest items, so the agent has distractors to reject
  const candidates = data.evidence.filter((e) => e.sec === ev.sec).map((e) => ({ id: e.id, date: e.date, kind: e.kind, title: e.title }));
  const user = JSON.stringify({ move: ev, window: { from: lo, to: ev.date }, candidates });
  try {
    const r = await narrate(SYSTEM, user, { timeoutMs: 20000 });
    const out = parseNarratorOutput(r.text);
    const valid = out.explained && out.evidence_ids.length && out.evidence_ids.every((id) => {
      const e = data.evidence.find((x) => x.id === id);
      return e && e.sec === ev.sec && e.date >= lo && e.date <= ev.date;
    }) && ['high', 'medium'].includes(out.confidence);
    console.log(`${ev.sec} ${ev.date} z=${ev.z}: ${valid ? out.one_line : 'no verified explanation'}`);
    if (valid) notes[`${ev.sec}:${ev.date}`] = { sec: ev.sec, date: ev.date, driver_type: out.driver_type, confidence: out.confidence, evidence_ids: out.evidence_ids, one_line: out.one_line, rejected: out.rejected || [] };
  } catch (e) { console.log(`${ev.sec} ${ev.date}: failed (${e.message})`); }
}
writeFileSync(new URL('../data/driver_notes.js', import.meta.url),
  `// Output of the nightly Driver Research Agent (scripts/research-batch.mjs), generated ${new Date().toISOString()} with ${llmConfig().model}.\nexport default ${JSON.stringify(notes, null, 2)};\n`);
console.log(`Wrote ${Object.keys(notes).length} notes.`);
