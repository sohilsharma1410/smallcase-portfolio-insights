// Eval suite. Runs in Node (npm run evals) and in the browser (Under the hood > Evals).
// Release gate: every case must pass before a prompt or model change ships.
import { runInsight } from '../engine/pipeline.js';
import { resolveWindow, bridgePortfolio } from '../engine/attribution.js';
import { validate } from '../engine/validator.js';
import { templateInsight } from '../engine/template.js';
import { injectFault, FAULT_TYPES } from '../engine/narrator.js';

const WINDOWS = ['1D', '1W', '1M', 'SLV'];

export async function runEvals({ data, notes, cached }) {
  const results = [];
  const add = (suite, name, pass, detail = '') => results.push({ suite, name, pass, detail });
  const personas = data.personas.map((p) => p.id);

  // A. Value bridge reconciles to the rupee
  for (const pid of personas) for (const w of WINDOWS) {
    const p = data.personas.find((x) => x.id === pid);
    const b = bridgePortfolio(data, p, resolveWindow(data, p, w));
    const worst = Math.max(...b.holdings.map((h) => Math.abs(h.reconGap)));
    add('A. Reconciliation', `${pid} ${w}: end - start = P&L + flows + income`, worst < 1, `worst holding gap ₹${worst.toFixed(4)}`);
  }

  // B. Corporate action: a 1:1 bonus must not look like a 50% crash
  {
    const p = data.personas.find((x) => x.id === 'aditi');
    const b = bridgePortfolio(data, p, resolveWindow(data, p, '1M'));
    const h = b.holdings.find((x) => x.id === 'st-dhruv');
    add('B. Corporate actions', 'Dhruv Consumer 1:1 bonus inside the window is adjusted', Math.abs(h.pnl) < 0.1 * h.startValue && h.corporateActions.length === 1,
      `P&L ₹${Math.round(h.pnl)} on start value ₹${Math.round(h.startValue)}`);
  }

  // C. MF look-through falls back to fund level when disclosed holdings do not explain the NAV
  {
    const p = data.personas.find((x) => x.id === 'meera');
    const b1 = bridgePortfolio(data, p, resolveWindow(data, p, '1W'));
    const b2 = bridgePortfolio(data, p, resolveWindow(data, p, '1D'));
    const v1 = b1.holdings.find((x) => x.id === 'mf-vistaar'), v2 = b2.holdings.find((x) => x.id === 'mf-vistaar');
    add('C. Look-through', 'Vistaar 1W: large residual, explained at fund level', v1.lookThrough.ok === false, `residual ₹${Math.round(v1.lookThrough.residual)}`);
    add('C. Look-through', 'Vistaar 1D: small residual, explained by holdings', v2.lookThrough.ok === true, `residual ₹${Math.round(v2.lookThrough.residual)}`);
  }

  // D, E, F, G per case
  for (const pid of personas) for (const w of WINDOWS) {
    const r = await runInsight({ data, notes, personaId: pid, window: w, mode: 'template' });
    for (const dr of [...r.packet.drivers, ...(r.packet.held_up ? [r.packet.held_up] : [])]) {
      const s = dr.securities.find((x) => x.name === dr.label);
      if (s) add('I. Driver labels', `${pid} ${w}: "${dr.label}" label matches its rupee amount`, Math.abs(s.pnl_inr - dr.pnl_inr) <= 0.1 * Math.abs(dr.pnl_inr), `stock ${s.pnl_inr} vs driver ${dr.pnl_inr}`);
    }
    const tv = validate(r.packet, templateInsight(r.packet));
    add('D. Template', `${pid} ${w}: template passes the validator`, tv.pass, tv.checks.filter((c) => !c.pass).map((c) => c.detail).join('; '));
    if (r.packet.state === 'quiet') {
      const rc = await runInsight({ data, notes, personaId: pid, window: w, mode: 'cached', cached });
      add('G. Cost', `${pid} ${w}: quiet period makes no LLM call`, !rc.steps.some((s) => s.kind === 'ai'), '');
      continue;
    }
    const c = cached[`${pid}:${w}`];
    if (!c) { add('E. Cached LLM output', `${pid} ${w}: cached output exists`, false, 'missing'); continue; }
    const v = validate(r.packet, c.output);
    add('E. Cached LLM output', `${pid} ${w}: passes every check`, v.pass, v.checks.filter((x) => !x.pass).map((x) => `${x.name}: ${x.detail}`).join('; '));
    for (const f of Object.keys(FAULT_TYPES)) {
      if (f === 'hidden_flows' && Math.abs(r.packet.total.flows_inr) < r.packet.user.materiality_inr) continue;
      const bad = injectFault(c.output, f);
      const vb = validate(r.packet, bad);
      add('F. Fault injection', `${pid} ${w}: blocks "${FAULT_TYPES[f]}"`, !vb.pass, vb.checks.filter((x) => !x.pass).map((x) => x.name).join('; '));
    }
  }

  // H. SIP masking is surfaced
  {
    const r = await runInsight({ data, notes, personaId: 'rohan', window: '1W', mode: 'cached', cached });
    const text = [r.output.headline, ...r.output.bullets.map((b) => b.text)].join(' ');
    add('H. Flows vs returns', 'Rohan 1W: balance up, market down, SIP named', r.packet.total.change_inr > 0 && r.packet.total.gain_inr < 0 && /25,000/.test(text), '');
  }

  // J. Recovery: the standard summary is shown only for a clear reason
  {
    const expect = [
      ['aditi', 'SLV', 'wrong_number', false, 'ai_retry'], ['aditi', 'SLV', 'wrong_number', true, 'ai_trimmed'],
      ['aditi', 'SLV', 'invented_cause', true, 'ai_trimmed'], ['aditi', 'SLV', 'advice', true, 'ai_trimmed'],
      ['aditi', 'SLV', 'prediction', false, 'ai_retry'], ['aditi', 'SLV', 'prediction', true, 'ai_trimmed'],
      ['rohan', '1W', 'hidden_flows', true, 'template'], ['aditi', 'SLV', 'outage', false, 'template'],
    ];
    for (const [pid, w, f, rep, want] of expect) {
      const r = await runInsight({ data, notes, cached, personaId: pid, window: w, mode: 'cached', inject: f, repeat: rep });
      const ok = r.outcome === want && validate(r.packet, r.output).pass;
      add('J. Recovery', `${pid} ${w}: "${f}"${rep ? ', repeated on retry' : ''} ends as ${want}`, ok, `got ${r.outcome}${r.fallbackReason ? ` (${r.fallbackReason})` : ''}`);
    }
  }

  const passed = results.filter((x) => x.pass).length;
  return { results, passed, total: results.length };
}
