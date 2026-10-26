// The whole insight pipeline, step by step, with a trace of every step.
// Runs on the server (api/insight.js) with a live LLM, or in the browser with cached outputs.
import { resolveWindow, bridgePortfolio } from './attribution.js';
import { buildDrivers, buildFactsPacket } from './drivers.js';
import { SYSTEM_PROMPT, PROMPT_VERSION, buildUserPrompt, parseNarratorOutput, injectFault } from './narrator.js';
import { validate, tidy, diagnose } from './validator.js';
import { templateInsight } from './template.js';
import { estTokens, round } from './format.js';

// Approximate list prices, USD per million tokens (input, output). Used only for the cost readout.
export const PRICES = {
  'gemini-3.1-flash-lite': [0.25, 1.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gemini-2.5-flash': [0.3, 2.5],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1, 5],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
};
const costUSD = (model, inTok, outTok) => {
  const p = PRICES[model] || [0.1, 0.5];
  return (inTok * p[0] + outTok * p[1]) / 1e6;
};

// The only reasons a user sees the standard summary instead of the AI card.
export const FALLBACK_REASONS = {
  quiet: 'A quiet period. Nothing unusual moved, so there is nothing for the AI to explain and no call is made.',
  headline_failed: 'Every sentence of the headline still failed a check after one retry, so there was no safe headline left.',
  nothing_left: 'Every bullet still failed after one retry, so there was nothing safe left to show.',
  whole_card: 'The card as a whole still left out money you added or took out. Without it, a SIP could read as a market gain, so the whole card is replaced.',
  outage: 'No model answered (main model and backup). In production the job is retried at 7:00 and 7:45 AM; the summary is used only if both are still down at 8:30.',
  template_mode: 'Standard summary requested.',
};

/**
 * @param {object} o
 * @param {object} o.data, o.notes        market data + cached driver notes
 * @param {string} o.personaId, o.window  '1D' | '1W' | '1M' | 'SLV'
 * @param {'live'|'cached'|'template'} o.mode
 * @param {function} [o.narrate]          async (system, user) => {text, model, usage:{in,out}, provider}
 * @param {object} [o.cached]             cached narrator outputs keyed `${persona}:${window}`
 * @param {string} [o.inject]             test fault for draft 1, or 'outage'
 * @param {boolean} [o.repeat]            test mode: the second try makes the same mistake
 */
export async function runInsight(o) {
  const t0 = Date.now();
  const steps = [];
  const step = (id, title, kind, detail) => steps.push({ id, title, kind, ms: Date.now() - t0, ...detail });
  const { data, notes } = o;
  const persona = data.personas.find((p) => p.id === o.personaId);
  if (!persona) throw new Error(`Unknown persona ${o.personaId}`);

  // 1. Data
  step('data', 'Load holdings, transactions and market data', 'code', {
    summary: `${persona.holdings.length} holdings, ${persona.transactions.length} transactions, ${data.days.length} trading days of prices, NAVs and FX`,
  });

  // 2. Window
  const win = resolveWindow(data, persona, o.window);
  step('window', 'Resolve the time window', 'code', {
    summary: `${win.start} close to ${win.end} close (${win.endIdx - win.startIdx} trading days)${win.note ? `. ${win.note}` : ''}`,
    window: win,
  });

  // 3. Value bridge
  const bridge = bridgePortfolio(data, persona, win);
  const recon = Math.abs(bridge.totals.reconGap) < 1;
  step('bridge', 'Value bridge: market P&L, flows, income', 'code', {
    summary: `Reconciles to the rupee: ${recon ? 'yes' : 'NO'} (gap ${bridge.totals.reconGap.toFixed(4)})`,
    pass: recon,
    holdings: bridge.holdings.map((h) => ({
      name: h.name, type: h.type, start: round(h.startValue), end: round(h.endValue), pnl: round(h.pnl), flows: round(h.flows), income: round(h.income),
      corporateActions: h.corporateActions,
      lookThrough: h.lookThrough ? { residual: round(h.lookThrough.residual), tolerance: round(h.lookThrough.tolerance), ok: h.lookThrough.ok, disclosure: h.lookThrough.disclosure } : null,
    })),
    totals: Object.fromEntries(Object.entries(bridge.totals).map(([k, v]) => [k, k === 'twr' ? round(v * 100, 2) : round(v, 2)])),
  });

  // 4. Drivers
  const d = buildDrivers(data, persona, win, bridge, notes);
  step('classify', 'Classify each security move', 'code', {
    summary: `${Object.keys(d.classification).length} securities checked, ${Object.values(d.classification).filter((c) => c.class === 'abnormal').length} abnormal`,
    rows: Object.values(d.classification).map((c) => ({ name: c.name, ret: round(c.ret * 100, 2), expected: round(c.expected * 100, 2), ref: c.refIndex, z: round(c.z, 2), class: c.class })),
  });
  const usedNotes = Object.values(notes).filter((n) => n.date > win.start && n.date <= win.end && d.classification[n.sec] && d.classification[n.sec].class === 'abnormal');
  step('notes', 'Driver notes from the nightly research agent', 'ai-batch', {
    summary: `${usedNotes.length} shared driver note${usedNotes.length === 1 ? '' : 's'} reused (generated once per security per day, not per user)`,
    notes: usedNotes,
  });
  step('rank', 'Group by sector across holdings, rank, filter', 'code', {
    summary: `${d.drivers.length} material drivers (threshold ₹${round(d.materiality)}); top ${d.top.length} kept${d.heldUp ? ', plus one that held up' : ''}`,
    drivers: d.drivers.map((x) => ({ label: x.label, pnl: round(x.pnl), holdings: x.holdings.length })),
  });

  // 5. Facts packet
  const packet = buildFactsPacket(data, persona, win, bridge, d);
  const userPrompt = buildUserPrompt(packet);
  step('packet', 'Build the facts packet', 'code', {
    summary: `~${estTokens(userPrompt)} tokens, no names, PAN or account data`,
    packet,
  });

  // 6. Write, check, recover
  // The standard summary (template) is shown only for a clear reason: a quiet period, a headline that still
  // fails after one retry, or no model answering at all. A single bad bullet is removed, not the whole card.
  let output = null, generatedBy = 'template', narration = null, outcome = 'template', fallbackReason = null, removed = [];
  const drafts = [];
  if (packet.state === 'quiet') {
    fallbackReason = 'quiet';
    step('narrate', 'AI writer (one call)', 'skipped', { summary: 'Quiet period: nothing unusual to explain, so no AI call and zero cost' });
  } else if (o.mode === 'template') {
    fallbackReason = 'template_mode';
    step('narrate', 'AI writer (one call)', 'skipped', { summary: 'Standard summary requested' });
  } else {
    let feedback = null;
    for (let attempt = 1; attempt <= 2 && !output; attempt++) {
      let raw, meta;
      try {
        if (o.inject === 'outage') throw new Error('Main model and backup both unavailable (simulated)');
        if (o.mode === 'live') {
          const r = await o.narrate(SYSTEM_PROMPT, buildUserPrompt(packet, feedback));
          raw = r.text;
          meta = { provider: r.provider, model: r.model, failover: r.failover, latencyMs: r.latencyMs, usage: r.usage, cost_usd: costUSD(r.model, r.usage.in, r.usage.out) };
        } else {
          const c = o.cached && o.cached[`${persona.id}:${o.window}`];
          if (!c) throw new Error('No saved output for this persona and window');
          raw = JSON.stringify(c.output);
          const usage = { in: estTokens(SYSTEM_PROMPT) + estTokens(buildUserPrompt(packet, feedback)), out: estTokens(raw), estimated: true };
          meta = { provider: 'saved', model: c.model, latencyMs: 0, usage, cost_usd: 0, would_cost_usd: costUSD('gemini-3.1-flash-lite', usage.in, usage.out), provenance: c.provenance };
        }
      } catch (e) {
        step(`narrate-${attempt}`, 'AI writer (one call)', 'error', { summary: `No answer: ${e.message}`, pass: false });
        fallbackReason = 'outage';
        narration = { error: e.message, injected: o.inject || null };
        break;
      }
      let parsed;
      try { parsed = tidy(parseNarratorOutput(raw)); }
      catch (e) { parsed = { headline: '', bullets: [] }; }
      // Test mode: the fault is put into draft 1. On the retry it is put in again only if "repeat" is on.
      const injectHere = o.inject && o.inject !== 'outage' && (attempt === 1 || o.repeat);
      const clean = parsed;
      if (injectHere) parsed = injectFault(parsed, o.inject);
      const v = validate(packet, parsed);
      const parts = v.pass ? null : diagnose(packet, parsed);
      drafts.push({ attempt, output: parsed, clean: injectHere ? clean : null, injected: injectHere ? o.inject : null, validation: v, parts, feedback });
      narration = { attempt, raw, parsed, meta, validation: v, injected: o.inject || null, repeat: Boolean(o.repeat) };
      step(`narrate-${attempt}`, attempt === 1 ? 'AI writer (one call)' : 'AI writer, second try with the failed checks as feedback', 'ai', {
        summary: `${meta.provider} / ${meta.model}${meta.usage ? `, ${meta.usage.in} in / ${meta.usage.out} out tokens` : ''}${meta.latencyMs ? `, ${meta.latencyMs} ms` : ''}${injectHere ? `, test fault added: ${o.inject}` : ''}${meta.failover ? `. ${meta.failover}` : ''}`,
        raw, meta, promptVersion: PROMPT_VERSION,
      });
      step(`validate-${attempt}`, 'Validator', 'code', { summary: v.pass ? 'All checks passed' : `${v.checks.filter((c) => !c.pass).length} check(s) failed`, pass: v.pass, checks: v.checks });
      if (v.pass) {
        output = parsed; generatedBy = 'llm'; outcome = attempt === 1 ? 'ai' : 'ai_retry';
      } else if (attempt === 1) {
        feedback = v.checks.filter((c) => !c.pass).map((c) => `- ${c.name}: ${c.detail}`).join('\n');
      } else {
        // Second try still failed. Keep the card if the bad part is a sentence that can be removed:
        // drop failing headline sentences and failing bullets, then check what is left as a whole.
        const keptHead = parts.sentences.filter((x) => x.fails.length === 0).map((x) => x.text).join(' ');
        const keep = parsed.bullets.filter((b, i) => parts.bullets[i].length === 0);
        const trimmed = { headline: keptHead, bullets: keep };
        const tv = keptHead && keep.length ? validate(packet, trimmed) : { pass: false };
        if (tv.pass) {
          removed = [
            ...parts.sentences.filter((x) => x.fails.length).map((x) => ({ text: x.text, where: 'headline', failed: x.fails.map((c) => c.name) })),
            ...parsed.bullets.map((b, i) => ({ text: b.text, where: 'bullet', failed: parts.bullets[i].map((c) => c.name) })).filter((x) => x.failed.length),
          ];
          output = trimmed; generatedBy = 'llm'; outcome = 'ai_trimmed';
          step('trim', 'Remove the sentence that still fails', 'code', { summary: `${removed.length} sentence${removed.length > 1 ? 's' : ''} removed, the rest passes every check`, pass: true });
        } else {
          fallbackReason = !keptHead ? 'headline_failed' : !keep.length ? 'nothing_left' : 'whole_card';
        }
      }
    }
  }
  if (!output) { output = templateInsight(packet); outcome = 'template'; }
  step('final', 'Serve', 'code', {
    summary: { ai: 'AI card served: passed every check first time', ai_retry: 'AI card served: fixed on the second try', ai_trimmed: 'AI card served with the failing sentence removed', template: `Standard summary served. Reason: ${FALLBACK_REASONS[fallbackReason]}` }[outcome],
    generatedBy,
  });

  return {
    persona: { id: persona.id, name: persona.name, blurb: persona.blurb, experience: persona.experience, lastViewed: persona.lastViewed },
    window: win, packet, output, generatedBy, outcome, fallbackReason, removed, drafts, narration, steps, totalMs: Date.now() - t0,
    holdings: bridge.holdings.map((h) => ({
      id: h.id, name: h.name, type: h.type, subtype: h.subtype, value: round(h.endValue), start: round(h.startValue),
      pnl: round(h.pnl), income: round(h.income), flows: round(h.flows),
      lookThroughOk: h.lookThrough ? h.lookThrough.ok : null,
      legs: h.legs.filter((l) => Math.abs(l.pnl) >= 1).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 4).map((l) => {
        const c = l.sec && d.classification[l.sec];
        const note = c && c.class === 'abnormal' ? Object.values(notes).find((n) => n.sec === l.sec && n.date > win.start && n.date <= win.end) : null;
        return { label: l.label, pnl: round(l.pnl), via: l.via, move: c ? round(c.ret * 100, 2) : null, abnormal: c ? c.class === 'abnormal' : false, note: note ? note.one_line : null };
      }),
    })),
    invested: bridge.invested, allTimeReturn: bridge.allTimeReturn, totals: bridge.totals,
    classification: d.classification, materiality: d.materiality,
  };
}
