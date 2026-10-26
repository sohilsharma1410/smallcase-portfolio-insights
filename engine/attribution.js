// Deterministic value bridge and look-through.
// Every rupee is computed here. Nothing in this file calls an LLM.
//
// Conventions
// - Prices are closes. A transaction on day d executes at day d's close, after day d's P&L.
// - Market P&L for day d = units held at the start of day d x price change on day d.
// - Corporate actions (bonus) are applied at the open of the ex-date: units scale up, prior price scales down.
// - US P&L in INR is split into a price effect and a currency effect.
// - FD interest is income, not market P&L.
// - Identity checked for every holding:  end - start = market P&L + flows + income  (to within Rs 1)

const WINDOW_LABELS = { '1D': 'on the last trading day', '1W': 'over the past week', '1M': 'over the past month' };

export function resolveWindow(data, persona, code) {
  const { days } = data;
  const endIdx = days.length - 1;
  const end = days[endIdx];
  let startIdx;
  let label = WINDOW_LABELS[code];
  let note = null;
  let effectiveCode = code;
  const back = (calDays) => {
    const t = new Date(`${end}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - calDays);
    const target = t.toISOString().slice(0, 10);
    let i = endIdx;
    while (i > 0 && days[i] > target) i--;
    return i;
  };
  if (code === '1D') startIdx = endIdx - 1;
  else if (code === '1W') startIdx = back(7);
  else if (code === '1M') startIdx = back(30);
  else if (code === 'SLV') {
    let i = endIdx;
    while (i > 0 && days[i] > persona.lastViewed) i--;
    const tradingDaysAway = endIdx - i;
    if (tradingDaysAway < 2) {
      startIdx = endIdx - 1;
      effectiveCode = '1D';
      label = WINDOW_LABELS['1D'];
      note = `Last visit was ${tradingDaysAway === 0 ? 'today' : '1 trading day ago'}, so this shows the last trading day.`;
    } else {
      startIdx = i;
      const calDays = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${persona.lastViewed}T00:00:00Z`)) / 864e5);
      label = `since your last visit ${calDays} days ago`;
    }
  } else throw new Error(`Unknown window ${code}`);
  return { code, effectiveCode, label, startIdx, endIdx, start: days[startIdx], end, note };
}

const calendarDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

function bonusOn(data, sec, day) {
  const b = data.bonus[sec];
  return b && b.date === day ? b.ratio : 1;
}
function indexReturn(data, code, i) {
  const l = data.indices[code].levels;
  return l[i] / l[i - 1] - 1;
}
function secDayReturn(data, sec, i) {
  const p = data.prices[sec];
  const ratio = bonusOn(data, sec, data.days[i]);
  return p[i] / (p[i - 1] / ratio) - 1;
}
const sectorOf = (data, sec) => data.securities[sec].sector;

const PROXY_SECTOR = {
  NIFTY50: 'Broad market (large caps)',
  NIFTYBANK: 'Banks',
  NIFTYMID: 'Broad market (midcaps)',
};

/**
 * Run one holding through every day up to endIdx.
 * Returns the window bridge plus the legs (pieces of P&L tagged by sector and security).
 */
export function bridgeHolding(data, holding, transactions, win) {
  const { days, prices, usdinr, navs } = data;
  const { startIdx, endIdx } = win;
  const txns = transactions.filter((t) => t.holding === holding.id);

  // position state
  const pos = {};
  if (holding.type === 'smallcase') holding.constituents.forEach((c) => (pos[c.sec] = c.units));
  else if (holding.type === 'mf') pos[holding.fund] = holding.units;
  else if (holding.type === 'in_stock' || holding.type === 'us_stock') pos[holding.sec] = holding.units;

  const legs = new Map(); // key -> {key,label,sector,sec,pnl,...}
  const addLeg = (key, fields, amount) => {
    if (!legs.has(key)) legs.set(key, { key, pnl: 0, ...fields });
    legs.get(key).pnl += amount;
  };

  const valueAt = (i) => {
    if (holding.type === 'fd') {
      if (days[i] < holding.booked) return 0;
      return holding.principal * (1 + (holding.rate * calendarDays(holding.booked, days[i])) / 365);
    }
    let v = 0;
    for (const [id, u] of Object.entries(pos)) {
      if (holding.type === 'mf') v += u * navs[id][i];
      else if (data.securities[id].market === 'US') v += u * prices[id][i] * usdinr[i];
      else v += u * prices[id][i];
    }
    return v;
  };

  let startValue = 0, pnl = 0, flows = 0, income = 0;
  const daily = []; // {day, sov (start-of-day value), pnl, income}
  const lookThrough = { pieces: 0, residual: 0, checked: holding.type === 'mf' };
  const corporateActions = [];

  for (let i = 0; i <= endIdx; i++) {
    const inWindow = i > startIdx;
    const sov = valueAt(Math.max(i - 1, 0)); // value at previous close, after its transactions
    let dayPnl = 0, dayIncome = 0;

    if (i > 0) {
      if (holding.type === 'fd') {
        dayIncome = valueAt(i) - valueAt(i - 1);
      } else if (holding.type === 'mf') {
        const f = data.funds[holding.fund];
        const u = pos[holding.fund];
        const navPrev = navs[holding.fund][i - 1];
        dayPnl = u * (navs[holding.fund][i] - navPrev);
        if (inWindow) {
          const base = u * navPrev;
          let explained = 0;
          for (const h of f.holdings) {
            let amt = 0, fields;
            if (h.sec) {
              amt = base * h.w * secDayReturn(data, h.sec, i);
              fields = { label: data.securities[h.sec].name, sector: sectorOf(data, h.sec), sec: h.sec, via: 'look-through' };
              addLeg(`lt:${h.sec}`, fields, amt);
            } else if (h.proxy) {
              amt = base * h.w * indexReturn(data, h.proxy, i);
              fields = { label: h.label, sector: PROXY_SECTOR[h.proxy], proxy: h.proxy, via: 'look-through' };
              addLeg(`lt:proxy:${h.proxy}`, fields, amt);
            } else if (h.debt) {
              amt = dayPnl; // a liquid fund is fully its debt book
              addLeg('lt:debt', { label: h.label, sector: 'Debt and liquid', via: 'look-through' }, amt);
            }
            explained += amt;
          }
          const resid = dayPnl - explained;
          addLeg('lt:residual', { label: 'Not explained by disclosed holdings', sector: 'Fund-specific', via: 'residual' }, resid);
          lookThrough.pieces += explained;
          lookThrough.residual += resid;
        }
      } else {
        for (const [sec, u0] of Object.entries(pos)) {
          const ratio = bonusOn(data, sec, days[i]);
          let u = u0;
          let prev = prices[sec][i - 1];
          if (ratio !== 1) {
            u = u0 * ratio;
            prev = prev / ratio;
            pos[sec] = u;
            if (inWindow) corporateActions.push({ sec, day: days[i], ratio });
          }
          const s = data.securities[sec];
          if (s.market === 'US') {
            const priceEffect = u * (prices[sec][i] - prev) * usdinr[i - 1];
            const fxEffect = u * prices[sec][i] * (usdinr[i] - usdinr[i - 1]);
            dayPnl += priceEffect + fxEffect;
            if (inWindow) {
              addLeg(`sec:${sec}`, { label: s.name, sector: s.sector, sec, via: holding.type === 'smallcase' ? 'constituent' : 'direct' }, priceEffect);
              addLeg('fx', { label: 'USD/INR on US holdings', sector: 'Currency (USD/INR)', via: 'fx' }, fxEffect);
            }
          } else {
            const d = u * (prices[sec][i] - prev);
            dayPnl += d;
            if (inWindow) addLeg(`sec:${sec}`, { label: s.name, sector: s.sector, sec, via: holding.type === 'smallcase' ? 'constituent' : 'direct' }, d);
          }
        }
      }
    }

    if (inWindow) {
      pnl += dayPnl;
      income += dayIncome;
      daily.push({ day: days[i], sov, pnl: dayPnl, income: dayIncome });
    }

    // transactions at today's close
    for (const t of txns.filter((x) => x.date === days[i])) {
      let amount = 0;
      if (holding.type === 'mf') {
        const nav = navs[holding.fund][i];
        if (t.type === 'sip' || t.type === 'buy') { pos[holding.fund] += t.amount / nav; amount = t.amount; }
        if (t.type === 'redeem') { pos[holding.fund] -= t.units; amount = -t.units * nav; }
      } else {
        const sec = holding.sec;
        const px = data.securities[sec].market === 'US' ? prices[sec][i] * usdinr[i] : prices[sec][i];
        if (t.type === 'buy') { pos[sec] += t.units; amount = t.units * px; }
        if (t.type === 'sell') { pos[sec] -= t.units; amount = -t.units * px; }
      }
      if (inWindow) flows += amount;
    }

    if (i === startIdx) startValue = valueAt(i);
  }

  const endValue = valueAt(endIdx);
  const reconGap = endValue - startValue - (pnl + flows + income);

  // Look-through quality gate: if disclosed holdings do not explain the NAV move, do not pretend they do.
  let ltOk = true;
  if (holding.type === 'mf') {
    const tolerance = Math.max(0.005 * startValue, 0.3 * Math.abs(pnl));
    ltOk = Math.abs(lookThrough.residual) <= tolerance;
    lookThrough.tolerance = tolerance;
    lookThrough.ok = ltOk;
    lookThrough.disclosure = data.funds[holding.fund].disclosure;
  }
  let legList = [...legs.values()];
  if (holding.type === 'mf' && !ltOk) {
    legList = [{ key: `fund:${holding.id}`, label: `${holding.name} (fund level)`, sector: `Fund level: ${holding.name}`, via: 'fund-level', pnl }];
  }
  legList.forEach((l) => (l.holding = holding.id));

  return {
    id: holding.id, name: holding.name, type: holding.type, subtype: holding.subtype || null,
    startValue, endValue, pnl, flows, income, reconGap, daily, legs: legList,
    lookThrough: holding.type === 'mf' ? lookThrough : null, corporateActions,
  };
}

export function bridgePortfolio(data, persona, win) {
  const holdings = persona.holdings.map((h) => bridgeHolding(data, h, persona.transactions, win));
  const sum = (k) => holdings.reduce((a, h) => a + h[k], 0);
  // Time-weighted return: chain daily portfolio returns so flows do not distort the %.
  const byDay = new Map();
  for (const h of holdings) for (const d of h.daily) {
    const e = byDay.get(d.day) || { sov: 0, gain: 0 };
    e.sov += d.sov; e.gain += d.pnl + d.income;
    byDay.set(d.day, e);
  }
  let twr = 1;
  for (const e of byDay.values()) if (e.sov > 0) twr *= 1 + e.gain / e.sov;
  const totals = {
    startValue: sum('startValue'), endValue: sum('endValue'), pnl: sum('pnl'), flows: sum('flows'), income: sum('income'),
    reconGap: sum('reconGap'), twr: twr - 1,
  };
  totals.change = totals.endValue - totals.startValue;
  const invested = persona.holdings.reduce((a, h) => a + h.invested, 0);
  return { holdings, totals, invested, allTimeReturn: (totals.endValue - invested) / invested };
}
