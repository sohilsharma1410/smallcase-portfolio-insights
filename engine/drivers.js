// Deterministic: classify each security's move, group P&L into drivers, rank, build the facts packet.
import { round, shortDate, pct } from './format.js';

const SECTOR_INDEX = {
  Banks: 'NIFTYBANK', IT: 'NIFTYIT', Auto: 'NIFTYAUTO', Pharma: 'NIFTYPHARMA', FMCG: 'NIFTYFMCG', 'Capital goods': 'NIFTYCAPG',
  'Broad market (large caps)': 'NIFTY50', 'Broad market (midcaps)': 'NIFTYMID', 'US tech': 'SP500', 'US broad market': 'SP500',
};
const SECTOR_LABEL = {
  Banks: 'Bank stocks', IT: 'IT stocks', Auto: 'Auto stocks', Pharma: 'Pharma stocks', FMCG: 'Consumer (FMCG) stocks',
  'Capital goods': 'Capital goods stocks', 'Broad market (large caps)': 'Other large-cap stocks', 'Broad market (midcaps)': 'Other midcap stocks',
  'US tech': 'US tech stocks', 'US broad market': 'US broad market', 'Currency (USD/INR)': 'Rupee vs dollar on US holdings',
  'Debt and liquid': 'Liquid fund', 'Fund-specific': 'Fund moves outside disclosed holdings',
};

export function windowReturnOfSecurity(data, sec, win) {
  const p = data.prices[sec];
  let r = 1;
  for (let i = win.startIdx + 1; i <= win.endIdx; i++) {
    const b = data.bonus[sec];
    const prev = b && b.date === data.days[i] ? p[i - 1] / b.ratio : p[i - 1];
    r *= p[i] / prev;
  }
  return r - 1;
}
export function windowReturnOfIndex(data, code, win) {
  const l = data.indices[code].levels;
  return l[win.endIdx] / l[win.startIdx] - 1;
}

/** Is this move explained by its sector or market? z-score of the residual vs the stock's own noise. */
export function classifyMove(data, sec, win) {
  const s = data.securities[sec];
  const r = windowReturnOfSecurity(data, sec, win);
  const idx = SECTOR_INDEX[s.sector];
  const ref = windowReturnOfIndex(data, idx, win);
  const expected = s.market === 'US' && s.sector === 'US tech' ? s.beta * ref : ref;
  const n = win.endIdx - win.startIdx;
  const resid = r - expected;
  const z = resid / (s.idio * Math.sqrt(n));
  const cls = Math.abs(z) > 2.5 && Math.abs(resid) > 0.02 ? 'abnormal' : 'with sector';
  return { sec, name: s.name, ret: r, expected, refIndex: data.indices[idx].name, resid, z, class: cls };
}

export function buildDrivers(data, persona, win, bridge, driverNotes) {
  const materiality = Math.max(500, 0.0005 * bridge.totals.startValue);
  const allLegs = bridge.holdings.flatMap((h) => h.legs.map((l) => ({ ...l, holdingName: h.name })));

  // Classify every security that carries P&L in this window
  const secs = [...new Set(allLegs.filter((l) => l.sec).map((l) => l.sec))];
  const classification = Object.fromEntries(secs.map((s) => [s, classifyMove(data, s, win)]));

  // Notes from the nightly Driver Research Agent, for abnormal movers with an event inside the window
  const notesFor = (sec) => Object.values(driverNotes).filter((n) => n.sec === sec && n.date > win.start && n.date <= win.end);

  // Group by sector
  const groups = new Map();
  for (const l of allLegs) {
    if (Math.abs(l.pnl) < 0.5) continue;
    const g = groups.get(l.sector) || { sector: l.sector, pnl: 0, holdings: new Set(), secs: new Map() };
    g.pnl += l.pnl;
    g.holdings.add(l.holdingName);
    if (l.sec) {
      const e = g.secs.get(l.sec) || { sec: l.sec, pnl: 0, via: new Set() };
      e.pnl += l.pnl; e.via.add(l.holdingName);
      g.secs.set(l.sec, e);
    }
    groups.set(l.sector, g);
  }

  const evidence = [];
  const addEvidence = (ev) => {
    const existing = evidence.find((e) => e.source_id === ev.source_id);
    if (existing) return existing.id;
    const id = `E${evidence.length + 1}`;
    evidence.push({ id, ...ev });
    return id;
  };

  const drivers = [...groups.values()].map((g) => {
    const evIds = [];
    const idx = SECTOR_INDEX[g.sector];
    if (idx) {
      const r = windowReturnOfIndex(data, idx, win);
      const name = data.indices[idx].name;
      evIds.push(addEvidence({
        source_id: `IDX:${idx}`, kind: 'index_move', confidence: 'high', source: 'Index data (synthetic)',
        text: `${name} ${r < 0 ? 'fell' : 'rose'} ${pct(r)} ${win.label}`,
      }));
    }
    if (g.sector === 'Currency (USD/INR)') {
      const a = data.usdinr[win.startIdx], b = data.usdinr[win.endIdx];
      evIds.push(addEvidence({
        source_id: 'FX:USDINR', kind: 'fx_move', confidence: 'high', source: 'USD/INR rate used to value US holdings (synthetic)',
        text: `The rupee ${b > a ? 'weakened' : 'strengthened'} ${pct(b / a - 1)} against the dollar, from ${a.toFixed(2)} to ${b.toFixed(2)}`,
      }));
    }
    if (g.sector.startsWith('Fund level: ')) {
      const h = bridge.holdings.find((x) => `Fund level: ${x.name}` === g.sector);
      evIds.push(addEvidence({
        source_id: `LT:${h.id}`, kind: 'data_quality', confidence: 'high', source: 'Look-through check',
        text: `Holdings disclosed as of ${shortDate(h.lookThrough.disclosure.as_of)} explain only part of this fund's move, so it is explained at fund level`,
      }));
    }
    const securities = [...g.secs.values()]
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 3)
      .map((e) => {
        const c = classification[e.sec];
        const out = { name: c.name, pnl_inr: round(e.pnl), move_pct: round(c.ret * 100, 2), held_via: [...e.via], move_type: c.class };
        if (c.class === 'abnormal') {
          const notes = notesFor(e.sec);
          if (notes.length) {
            out.driver_note = notes.map((n) => n.one_line).join(' ');
            for (const n of notes) {
              for (const sid of n.evidence_ids) {
                const raw = data.evidence.find((x) => x.id === sid);
                evIds.push(addEvidence({ source_id: sid, kind: raw.kind, confidence: n.confidence, source: raw.source, date: shortDate(raw.date), text: raw.title }));
              }
            }
          } else out.driver_note = 'Moved more than its sector. No company-specific news found in this period.';
        }
        return out;
      });
    // If one abnormal stock is most of the group's P&L, name the stock, not the sector.
    const lead = [...g.secs.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))[0];
    // Only when the group total is essentially that one stock, so "X added ₹N" stays literally true.
    const dominant = lead && Math.abs(g.pnl - lead.pnl) <= 0.1 * Math.abs(g.pnl) &&
      classification[lead.sec].class === 'abnormal';
    return {
      sector: g.sector,
      label: dominant ? classification[lead.sec].name : SECTOR_LABEL[g.sector] || g.sector.replace('Fund level: ', '') + ' (fund level)',
      pnl: g.pnl, holdings: [...g.holdings], securities, evidence: [...new Set(evIds)],
    };
  });

  const material = drivers.filter((d) => Math.abs(d.pnl) >= materiality).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const top = material.slice(0, 3);
  const totalSign = Math.sign(bridge.totals.pnl);
  const heldUpCand = material.filter((d) => Math.sign(d.pnl) !== totalSign && !top.includes(d))[0] || null;

  return { classification, drivers: material, top, heldUp: heldUpCand, evidence, materiality };
}

const ASSET_LABEL = { smallcase: 'smallcases', mf: 'Mutual funds', us_stock: 'US stocks', in_stock: 'Indian stocks', fd: 'Fixed deposits' };

export function buildFactsPacket(data, persona, win, bridge, d) {
  const t = bridge.totals;
  const anyAbnormal = Object.values(d.classification).some((c) => c.class === 'abnormal');
  const state = Math.abs(t.twr) < 0.0015 && !anyAbnormal ? 'quiet' : 'normal';
  const byAsset = {};
  for (const h of bridge.holdings) byAsset[h.type] = (byAsset[h.type] || 0) + h.pnl + h.income;

  // keep only evidence referenced by the drivers we pass on
  const used = new Set([...d.top, ...(d.heldUp ? [d.heldUp] : [])].flatMap((x) => x.evidence));
  // Renumber the evidence we pass on as E1..En, keep source_id for the audit trail
  const remap = {};
  const evidence = d.evidence.filter((e) => used.has(e.id)).map((e, i) => {
    remap[e.id] = `E${i + 1}`;
    return { ...e, id: `E${i + 1}` };
  });

  const driverOut = (x, id) => ({
    id, label: x.label, pnl_inr: round(x.pnl), holdings_count: x.holdings.length, holdings: x.holdings,
    securities: x.securities, evidence: x.evidence.filter((e) => used.has(e)).map((e) => remap[e]),
  });

  return {
    window: { code: win.effectiveCode, label: win.label, start: shortDate(win.start), end: shortDate(win.end), ...(win.note ? { note: win.note } : {}) },
    as_of: { IN: `${shortDate(win.end)} close`, MF_NAV: `${shortDate(win.end)} NAV`, US: `${shortDate(win.end)} US close` },
    state,
    total: {
      start_value: round(t.startValue), end_value: round(t.endValue), change_inr: round(t.change),
      market_pnl_inr: round(t.pnl), income_inr: round(t.income), gain_inr: round(t.pnl) + round(t.income),
      flows_inr: round(t.flows), twr_pct: round(t.twr * 100, 2),
    },
    by_asset_class: Object.entries(byAsset).map(([k, v]) => ({ label: ASSET_LABEL[k], pnl_inr: round(v) })),
    drivers: d.top.map((x, i) => driverOut(x, `F${i + 1}`)),
    held_up: d.heldUp ? driverOut(d.heldUp, 'H1') : null,
    evidence,
    context: { all_time_return_pct: round(bridge.allTimeReturn * 100, 2) },
    user: { experience: persona.experience, materiality_inr: round(d.materiality) },
  };
}
