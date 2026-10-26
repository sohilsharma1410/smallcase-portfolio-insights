// Deterministic fallback. Always correct, a little plainer than the LLM version.
// Used on quiet days (no LLM call at all), and whenever the validator rejects an LLM output.
import { inr, groupIN } from './format.js';

const signedPct = (p) => `${p > 0 ? '+' : p < 0 ? '-' : ''}${Math.abs(p).toFixed(2)}%`;

const QUIET = { '1D': 'quiet day', '1W': 'quiet week', '1M': 'quiet month', SLV: 'quiet stretch since your last visit' };

export function templateInsight(packet) {
  const t = packet.total;
  const w = packet.window.label;
  if (packet.state === 'quiet') {
    return {
      headline: `A ${QUIET[packet.window.code] || 'quiet stretch'}: your investments moved ${signedPct(t.twr_pct)} (${t.gain_inr < 0 ? '-' : '+'}${inr(t.gain_inr)}) ${w}, with no unusual moves in your holdings.`,
      bullets: [{ text: `All-time, your portfolio is ${packet.context.all_time_return_pct >= 0 ? 'up' : 'down'} ${Math.abs(packet.context.all_time_return_pct).toFixed(2)}%.`, fact_ids: ['TOTAL'] }],
    };
  }
  let headline = `Your investments ${t.gain_inr < 0 ? 'lost' : 'gained'} ${inr(t.gain_inr)} (${signedPct(t.twr_pct)}) ${w}.`;
  if (t.flows_inr > 0) headline += ` You also added ${inr(t.flows_inr)}, so your balance is ${t.change_inr >= 0 ? 'up' : 'down'} ${inr(t.change_inr)}.`;
  if (t.flows_inr < 0) headline += ` You took out ${inr(t.flows_inr)}, so your balance is ${t.change_inr >= 0 ? 'up' : 'down'} ${inr(t.change_inr)}.`;

  const ev = Object.fromEntries(packet.evidence.map((e) => [e.id, e]));
  const line = (d) => {
    const moved = d.pnl_inr < 0 ? 'cost you' : 'added';
    let s = `${d.label} ${moved} ${inr(d.pnl_inr)} across ${d.holdings_count} holding${d.holdings_count > 1 ? 's' : ''}.`;
    const idx = d.evidence.map((id) => ev[id]).find((e) => e && (e.kind === 'index_move' || e.kind === 'fx_move' || e.kind === 'data_quality'));
    if (idx) s += ` ${idx.text}.`;
    const noted = d.securities.find((x) => x.driver_note);
    if (noted) s += ` ${noted.driver_note}`;
    return { text: s.replace(/\.\./g, '.'), fact_ids: [d.id, ...d.evidence] };
  };
  const bullets = packet.drivers.slice(0, packet.held_up ? 2 : 3).map(line);
  if (packet.held_up) {
    const h = packet.held_up;
    bullets.push({ text: `${t.gain_inr < 0 ? 'Held up' : 'Lagged'}: ${h.label} ${h.pnl_inr < 0 ? 'cost' : 'added'} ${inr(h.pnl_inr)}.`, fact_ids: [h.id] });
  }
  return { headline, bullets };
}

export { groupIN };
