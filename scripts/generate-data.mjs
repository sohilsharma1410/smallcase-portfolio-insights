// Generates the synthetic market data used by the prototype.
// Deterministic: same seed, same numbers. Every company, fund and news item is fictional.
// Run: node scripts/generate-data.mjs  ->  writes data/market.js
import { writeFileSync } from 'node:fs';

const SEED = 20261023;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const normal = (mu, sd) => {
  const u = Math.max(rand(), 1e-9), v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// ---- Calendar: weekdays from 2026-08-31 to 2026-10-23. India closed on 2026-10-02.
const days = [];
for (let d = new Date('2026-08-31T00:00:00Z'); d <= new Date('2026-10-23T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  const wd = d.getUTCDay();
  if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
}
const IN_HOLIDAYS = ['2026-10-02'];
const inOpen = (day) => !IN_HOLIDAYS.includes(day);

// ---- Factor paths (daily returns). Last week is scripted so the scenario has a clear story.
const scripted = (map, mu, sd) => days.map((d, i) => (i === 0 ? 0 : d in map ? map[d] : normal(mu, sd)));
const MKT = scripted({ '2026-10-19': -0.004, '2026-10-20': 0.002, '2026-10-21': -0.006, '2026-10-22': -0.003, '2026-10-23': -0.001 }, 0.0005, 0.006);
const SECTOR_EXCESS = {
  Banks: scripted({ '2026-10-19': -0.003, '2026-10-20': -0.002, '2026-10-21': -0.009, '2026-10-22': -0.005, '2026-10-23': 0.001 }, 0, 0.003),
  IT: scripted({ '2026-10-19': 0.002, '2026-10-20': 0.011, '2026-10-21': 0.002, '2026-10-22': 0.001, '2026-10-23': 0.0 }, 0, 0.003),
  Auto: scripted({}, 0, 0.003),
  Pharma: scripted({}, 0, 0.002),
  FMCG: scripted({}, 0, 0.002),
  'Capital goods': scripted({}, 0.0004, 0.004),
};
const MID_EXCESS = scripted({}, 0.0002, 0.003);
const US_MKT = scripted({ '2026-10-19': 0.004, '2026-10-20': 0.003, '2026-10-21': 0.005, '2026-10-22': -0.002, '2026-10-23': 0.004 }, 0.0005, 0.007);
const FX_RET = scripted({ '2026-10-19': 0.0012, '2026-10-20': 0.0011, '2026-10-21': 0.0015, '2026-10-22': 0.0009, '2026-10-23': 0.0008 }, 0.0001, 0.0015);

// India holiday: IN factors do not move that day (the move rolls into nothing; prices carry forward)
days.forEach((d, i) => {
  if (!inOpen(d)) { MKT[i] = 0; MID_EXCESS[i] = 0; Object.values(SECTOR_EXCESS).forEach((s) => (s[i] = 0)); }
});

const level = (rets, base) => { let v = base; return rets.map((r) => (v = v * (1 + r))); };
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

// ---- Securities
const IN_STOCKS = [
  { id: 'INDBK', name: 'Indus Private Bank', sector: 'Banks', beta: 1.1, base: 1650, idio: 0.006 },
  { id: 'KAVBK', name: 'Kaveri Bank', sector: 'Banks', beta: 1.2, base: 980, idio: 0.007 },
  { id: 'CSTBK', name: 'Coastal Small Finance Bank', sector: 'Banks', beta: 1.3, base: 420, idio: 0.008 },
  { id: 'SAPTA', name: 'Saptagiri Software', sector: 'IT', beta: 0.9, base: 1520, idio: 0.006 },
  { id: 'NIRAM', name: 'Nirmaan Infra', sector: 'Capital goods', beta: 1.2, base: 3400, idio: 0.008 },
  { id: 'AROGY', name: 'Arogya Pharma', sector: 'Pharma', beta: 0.7, base: 1250, idio: 0.006 },
  { id: 'VAAHN', name: 'Vaahan Motors', sector: 'Auto', beta: 1.0, base: 7800, idio: 0.007 },
  { id: 'DHRUV', name: 'Dhruv Consumer', sector: 'FMCG', beta: 0.6, base: 2600, idio: 0.005 },
];
const IN_EVENTS = { // idiosyncratic shocks on top of factors
  'KAVBK:2026-10-21': -0.064,
  'SAPTA:2026-10-20': 0.052,
  'NIRAM:2026-10-07': 0.061,
};
const BONUS = { DHRUV: { date: '2026-10-14', ratio: 2 } }; // 1:1 bonus, unadjusted price halves on ex-date

const prices = {};
for (const s of IN_STOCKS) {
  let p = s.base;
  prices[s.id] = days.map((d, i) => {
    if (i > 0 && inOpen(d)) {
      const r = s.beta * MKT[i] + SECTOR_EXCESS[s.sector][i] + normal(0, s.idio) + (IN_EVENTS[`${s.id}:${d}`] || 0);
      p = p * (1 + r);
      if (BONUS[s.id] && BONUS[s.id].date === d) p = p / BONUS[s.id].ratio;
    }
    return round(p);
  });
}

const US_STOCKS = [
  { id: 'NEBU', name: 'Nebula Compute', sector: 'US tech', beta: 1.3, base: 182, idio: 0.009 },
  { id: 'ORCHD', name: 'Orchard Devices', sector: 'US tech', beta: 1.0, base: 228, idio: 0.007 },
  { id: 'SPXE', name: 'Summit US Total Market ETF', sector: 'US broad market', beta: 1.0, base: 56, idio: 0.001 },
];
const US_EVENTS = { 'NEBU:2026-10-21': 0.058 };
for (const s of US_STOCKS) {
  let p = s.base;
  prices[s.id] = days.map((d, i) => {
    if (i > 0) p = p * (1 + s.beta * US_MKT[i] + normal(0, s.idio) + (US_EVENTS[`${s.id}:${d}`] || 0));
    return round(p);
  });
}

// ---- Indices (levels)
const NIFTY50 = level(MKT, 25000);
const sectorIndex = (name, base) => level(MKT.map((m, i) => m + SECTOR_EXCESS[name][i]), base);
const indices = {
  NIFTY50: { name: 'Nifty 50', levels: NIFTY50.map((x) => round(x)) },
  NIFTYBANK: { name: 'Nifty Bank', sector: 'Banks', levels: sectorIndex('Banks', 55000).map((x) => round(x)) },
  NIFTYIT: { name: 'Nifty IT', sector: 'IT', levels: sectorIndex('IT', 36000).map((x) => round(x)) },
  NIFTYAUTO: { name: 'Nifty Auto', sector: 'Auto', levels: sectorIndex('Auto', 24000).map((x) => round(x)) },
  NIFTYPHARMA: { name: 'Nifty Pharma', sector: 'Pharma', levels: sectorIndex('Pharma', 22000).map((x) => round(x)) },
  NIFTYFMCG: { name: 'Nifty FMCG', sector: 'FMCG', levels: sectorIndex('FMCG', 56000).map((x) => round(x)) },
  NIFTYCAPG: { name: 'Nifty Capital Goods', sector: 'Capital goods', levels: sectorIndex('Capital goods', 9000).map((x) => round(x)) },
  NIFTYMID: { name: 'Nifty Midcap 150', levels: level(MKT.map((m, i) => 1.1 * m + MID_EXCESS[i]), 21000).map((x) => round(x)) },
  SP500: { name: 'S&P 500', sector: 'US broad market', levels: level(US_MKT, 6800).map((x) => round(x)) },
};
const USDINR = level(FX_RET, 88.0).map((x) => round(x, 4));

// ---- Mutual funds. Disclosed holdings as of 2026-09-30 (published 2026-10-10).
const dayRet = (id, i) => {
  if (i === 0) return 0;
  const p = prices[id], d = days[i];
  let prev = p[i - 1];
  if (BONUS[id] && BONUS[id].date === d) prev = prev / BONUS[id].ratio;
  return p[i] / prev - 1;
};
const idxRet = (code, i) => (i === 0 ? 0 : indices[code].levels[i] / indices[code].levels[i - 1] - 1);

const FUNDS = [
  {
    id: 'MERIDIAN', name: 'Meridian Flexi Cap Fund', category: 'Flexi cap', base: 58.2,
    disclosure: { as_of: '2026-09-30', published: '2026-10-10' },
    holdings: [
      { sec: 'INDBK', w: 0.09 }, { sec: 'KAVBK', w: 0.07 }, { sec: 'SAPTA', w: 0.08 }, { sec: 'VAAHN', w: 0.06 },
      { sec: 'DHRUV', w: 0.05 }, { sec: 'AROGY', w: 0.05 }, { sec: 'NIRAM', w: 0.06 },
      { proxy: 'NIFTY50', w: 0.46, label: 'Other large-cap stocks' }, { cash: true, w: 0.08 },
    ],
    activeNoise: 0.0008,
  },
  {
    id: 'SAHYADRI', name: 'Sahyadri Banking & Financial Services Fund', category: 'Sectoral: banking', base: 41.7,
    disclosure: { as_of: '2026-09-30', published: '2026-10-10' },
    holdings: [
      { sec: 'INDBK', w: 0.22 }, { sec: 'KAVBK', w: 0.18 }, { sec: 'CSTBK', w: 0.06 },
      { proxy: 'NIFTYBANK', w: 0.49, label: 'Other bank and finance stocks' }, { cash: true, w: 0.05 },
    ],
    activeNoise: 0.0006,
  },
  {
    id: 'KESARI', name: 'Kesari Nifty 50 Index Fund', category: 'Index fund', base: 24.9,
    disclosure: { as_of: '2026-09-30', published: '2026-10-10' },
    holdings: [{ proxy: 'NIFTY50', w: 1.0, label: 'Nifty 50 stocks' }],
    activeNoise: 0.0001,
  },
  {
    id: 'VISTAAR', name: 'Vistaar Midcap Opportunities Fund', category: 'Mid cap', base: 112.4,
    disclosure: { as_of: '2026-09-30', published: '2026-10-10' },
    holdings: [
      { sec: 'NIRAM', w: 0.1 }, { sec: 'VAAHN', w: 0.1 }, { sec: 'AROGY', w: 0.1 },
      { proxy: 'NIFTYMID', w: 0.62, label: 'Other midcap stocks' }, { cash: true, w: 0.08 },
    ],
    activeNoise: 0.0012,
    // The manager changed the portfolio after the last disclosure. Look-through will not explain this.
    unexplained: { '2026-10-20': 0.009, '2026-10-21': 0.011, '2026-10-22': 0.008 },
  },
  {
    id: 'TARANG', name: 'Tarang Liquid Fund', category: 'Liquid', base: 3180.5,
    disclosure: { as_of: '2026-09-30', published: '2026-10-10' },
    holdings: [{ debt: true, w: 1.0, label: 'Treasury bills and money market' }],
    dailyAccrual: 0.00018,
  },
];
const navs = {};
for (const f of FUNDS) {
  let nav = f.base;
  navs[f.id] = days.map((d, i) => {
    if (i > 0 && inOpen(d)) {
      let r = 0;
      for (const h of f.holdings) {
        if (h.sec) r += h.w * dayRet(h.sec, i);
        else if (h.proxy) r += h.w * idxRet(h.proxy, i);
        else if (h.debt) r += h.w * f.dailyAccrual;
      }
      r += normal(0, f.activeNoise || 0) + ((f.unexplained && f.unexplained[d]) || 0);
      nav = nav * (1 + r);
    }
    return round(nav, 4);
  });
}

// ---- Evidence store (synthetic newswire, results, corporate actions). Includes distractors.
const EVIDENCE = [
  { id: 'N-KAV-1021', sec: 'KAVBK', date: '2026-10-21', kind: 'results', title: 'Kaveri Bank Q2: provisions rise 38% year on year, net profit below estimates', source: 'Synthetic newswire (illustrative)' },
  { id: 'N-KAV-0915', sec: 'KAVBK', date: '2026-09-15', kind: 'news', title: 'Kaveri Bank opens 40 new branches in Karnataka', source: 'Synthetic newswire (illustrative)' },
  { id: 'N-SAP-1020', sec: 'SAPTA', date: '2026-10-20', kind: 'results', title: 'Saptagiri Software Q2 revenue beats estimates, raises full-year guidance', source: 'Synthetic newswire (illustrative)' },
  { id: 'N-NIR-1007', sec: 'NIRAM', date: '2026-10-07', kind: 'news', title: 'Nirmaan Infra wins a large metro rail order', source: 'Synthetic newswire (illustrative)' },
  { id: 'N-NEB-1021', sec: 'NEBU', date: '2026-10-21', kind: 'results', title: 'Nebula Compute Q3 data-centre revenue beats estimates', source: 'Synthetic newswire (illustrative)' },
  { id: 'CA-DHR-1014', sec: 'DHRUV', date: '2026-10-14', kind: 'corporate_action', title: 'Dhruv Consumer 1:1 bonus issue, ex-date 14 Oct 2026', source: 'Synthetic exchange filing (illustrative)' },
  { id: 'N-AROGY-1022', sec: 'AROGY', date: '2026-10-22', kind: 'news', title: 'Arogya Pharma to present at an investor conference next month', source: 'Synthetic newswire (illustrative)' },
];

// ---- Personas (synthetic users)
const PERSONAS = [
  {
    id: 'aditi', name: 'Aditi', blurb: 'Multi-asset investor, 4 years on smallcase', experience: 'experienced', lastViewed: '2026-10-12',
    holdings: [
      { id: 'sc-bank', type: 'smallcase', name: 'Bharat Banking Leaders', subtype: 'Equity smallcase', invested: 145000,
        constituents: [{ sec: 'INDBK', units: 40 }, { sec: 'KAVBK', units: 60 }, { sec: 'CSTBK', units: 120 }] },
      { id: 'sc-ustech', type: 'smallcase', name: 'Global Tech Titans', subtype: 'US smallcase', invested: 310000,
        constituents: [{ sec: 'NEBU', units: 6 }, { sec: 'ORCHD', units: 10 }] },
      { id: 'mf-meridian', type: 'mf', name: 'Meridian Flexi Cap Fund', fund: 'MERIDIAN', units: 8000, invested: 395000 },
      { id: 'mf-sahyadri', type: 'mf', name: 'Sahyadri Banking & Financial Services Fund', fund: 'SAHYADRI', units: 3000, invested: 112000 },
      { id: 'mf-kesari', type: 'mf', name: 'Kesari Nifty 50 Index Fund', fund: 'KESARI', units: 5000, invested: 104000 },
      { id: 'st-dhruv', type: 'in_stock', name: 'Dhruv Consumer', sec: 'DHRUV', units: 50, invested: 118000 },
      { id: 'fd-shivalik', type: 'fd', name: 'Shivalik SFB Fixed Deposit', principal: 200000, rate: 0.076, booked: '2026-03-01', invested: 200000 },
    ],
    transactions: [
      { date: '2026-10-05', holding: 'mf-kesari', type: 'sip', amount: 5000 },
      { date: '2026-10-20', holding: 'mf-meridian', type: 'sip', amount: 10000 },
    ],
  },
  {
    id: 'rohan', name: 'Rohan', blurb: 'New SIP investor, 5 months in', experience: 'new', lastViewed: '2026-10-22',
    holdings: [
      { id: 'mf-sahyadri', type: 'mf', name: 'Sahyadri Banking & Financial Services Fund', fund: 'SAHYADRI', units: 1500, invested: 61000 },
      { id: 'mf-meridian', type: 'mf', name: 'Meridian Flexi Cap Fund', fund: 'MERIDIAN', units: 1200, invested: 68000 },
      { id: 'mf-tarang', type: 'mf', name: 'Tarang Liquid Fund', fund: 'TARANG', units: 30, invested: 94000 },
    ],
    transactions: [{ date: '2026-10-21', holding: 'mf-sahyadri', type: 'sip', amount: 25000 }],
  },
  {
    id: 'meera', name: 'Meera', blurb: 'US stocks and midcaps, checks in monthly', experience: 'experienced', lastViewed: '2026-09-30',
    holdings: [
      { id: 'us-nebu', type: 'us_stock', name: 'Nebula Compute', sec: 'NEBU', units: 40, invested: 520000 },
      { id: 'us-orchd', type: 'us_stock', name: 'Orchard Devices', sec: 'ORCHD', units: 25, invested: 470000 },
      { id: 'us-spxe', type: 'us_stock', name: 'Summit US Total Market ETF', sec: 'SPXE', units: 30, invested: 135000 },
      { id: 'mf-vistaar', type: 'mf', name: 'Vistaar Midcap Opportunities Fund', fund: 'VISTAAR', units: 6000, invested: 540000 },
      { id: 'st-sapta', type: 'in_stock', name: 'Saptagiri Software', sec: 'SAPTA', units: 80, invested: 104000 },
      { id: 'st-niram', type: 'in_stock', name: 'Nirmaan Infra', sec: 'NIRAM', units: 150, invested: 420000 },
    ],
    transactions: [{ date: '2026-10-21', holding: 'st-sapta', type: 'sell', units: 20 }],
  },
];

const out = {
  meta: {
    generated_by: 'scripts/generate-data.mjs', seed: SEED, as_of: days[days.length - 1],
    note: 'Synthetic data. All companies, funds, people and news items are fictional. Index names are used only as labels.',
  },
  days, inHolidays: IN_HOLIDAYS,
  securities: Object.fromEntries([...IN_STOCKS.map((s) => [s.id, { ...s, market: 'IN', currency: 'INR' }]), ...US_STOCKS.map((s) => [s.id, { ...s, market: 'US', currency: 'USD' }])]),
  prices, bonus: BONUS, indices, usdinr: USDINR,
  funds: Object.fromEntries(FUNDS.map((f) => [f.id, { id: f.id, name: f.name, category: f.category, disclosure: f.disclosure, holdings: f.holdings }])),
  navs, evidence: EVIDENCE, personas: PERSONAS,
};
writeFileSync(new URL('../data/market.js', import.meta.url), `// AUTO-GENERATED by scripts/generate-data.mjs. Synthetic, fictional data.\nexport default ${JSON.stringify(out)};\n`);
console.log('days', days.length, 'from', days[0], 'to', days[days.length - 1]);
