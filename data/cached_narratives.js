// Cached Narrator outputs, used when no LLM key is configured or "Cached" mode is selected.
// Provenance: written during development by Claude, from the exact system prompt (engine/narrator.js)
// and the exact facts packet for each persona and window. They go through the same validator as live output.
// Quiet windows (aditi:1D, rohan:1D, rohan:SLV) have no entry: the pipeline never calls an LLM for them.
const PROVENANCE = 'Pre-generated during development by Claude using the same prompt and facts packet. Switch to Live to call the configured model.';
const MODEL = 'claude (dev-time cache)';
const e = (output) => ({ output, model: MODEL, provenance: PROVENANCE });

export default {
  'aditi:1W': e({
    headline: 'Markets took ₹18,314 (-1.22%) off your investments this week. Your ₹10,000 SIP means your balance is down only ₹8,315.',
    bullets: [
      { text: 'Bank stocks cost you ₹19,731 across 3 holdings as Nifty Bank fell 2.97%. Kaveri Bank alone took ₹12,494 after its Q2 profit came in below estimates.', fact_ids: ['F1', 'E1', 'E2'] },
      { text: 'US tech stocks added ₹4,051. Nebula Compute rose 8.72% after its Q3 data-centre revenue beat estimates.', fact_ids: ['F2', 'E4'] },
      { text: 'Held up: Saptagiri Software, inside Meridian Flexi Cap Fund, added ₹2,153 after beating Q2 revenue estimates.', fact_ids: ['H1', 'E6'] },
    ],
  }),
  'aditi:1M': e({
    headline: 'Markets took ₹40,703 (-2.68%) off your investments this month. You added ₹15,000, so your balance is down ₹25,703.',
    bullets: [
      { text: 'Bank stocks cost you ₹26,070 across 3 holdings as Nifty Bank fell 3.35%. Kaveri Bank was the biggest drag at ₹16,775 after its Q2 profit missed estimates.', fact_ids: ['F1', 'E1', 'E2'] },
      { text: 'Your US tech smallcase lost ₹10,001, with Orchard Devices down 6.89% as the S&P 500 fell 2.95%.', fact_ids: ['F2', 'E3'] },
      { text: 'Held up: a weaker rupee added ₹3,916 to the value of your US holdings.', fact_ids: ['H1', 'E4'] },
    ],
  }),
  'aditi:SLV': e({
    headline: 'Since your last visit 11 days ago, markets took ₹29,281 (-1.94%) off your investments. Your ₹10,000 SIP softens that to a ₹19,281 drop in balance.',
    bullets: [
      { text: 'Bank stocks cost you ₹22,874 across 3 holdings as Nifty Bank fell 3.88%. Kaveri Bank fell 13.95% after its Q2 provisions rose 38%.', fact_ids: ['F1', 'E1', 'E2'] },
      { text: 'Other large-cap stocks across Meridian Flexi Cap Fund and Kesari Nifty 50 Index Fund cost ₹8,041 as the Nifty 50 fell 2.38%.', fact_ids: ['F2', 'E6'] },
      { text: 'Held up: Saptagiri Software added ₹2,106 after it beat Q2 revenue estimates.', fact_ids: ['H1', 'E5'] },
    ],
  }),
  'rohan:1W': e({
    headline: 'Your balance is up ₹21,410 this week, but that is your ₹25,000 SIP. The market itself took ₹3,590 (-1.57%) off your funds.',
    bullets: [
      { text: 'Bank stocks cost you ₹3,494 as Nifty Bank, an index of large bank stocks, fell 2.97%. Both of your funds own bank stocks.', fact_ids: ['F1', 'E1'] },
      { text: 'The biggest drag was Kaveri Bank, down 11.36% after its Q2 profit came in below estimates.', fact_ids: ['F1', 'E2'] },
    ],
  }),
  'rohan:1M': e({
    headline: 'Your balance is up ₹20,094 this month thanks to your ₹25,000 SIP. Markets took ₹4,906 (-2.15%) off your funds.',
    bullets: [
      { text: 'Bank stocks cost you ₹4,553 as Nifty Bank, an index of large bank stocks, fell 3.35%. Kaveri Bank was the biggest drag after its Q2 results.', fact_ids: ['F1', 'E1', 'E2'] },
      { text: 'Other large-cap stocks in Meridian Flexi Cap Fund cost ₹867 as the Nifty 50, an index of the 50 largest listed companies, fell 2.74%.', fact_ids: ['F2', 'E3'] },
    ],
  }),
  'meera:1D': e({
    headline: 'Your investments gained ₹16,519 (+0.62%) on the last trading day, led by your US tech stocks.',
    bullets: [
      { text: 'US tech stocks added ₹8,901, mostly from Nebula Compute, as the S&P 500 rose 0.40%.', fact_ids: ['F1', 'E1'] },
      { text: 'Nirmaan Infra added ₹4,460 as Nifty Capital Goods rose 0.14%.', fact_ids: ['F2', 'E2'] },
    ],
  }),
  'meera:1W': e({
    headline: 'Your investments gained ₹1,07,577 (+4.15%) this week. You took out ₹32,161, so your balance is up ₹75,416.',
    bullets: [
      { text: 'US tech stocks added ₹45,701. Nebula Compute jumped 8.72% because its Q3 data-centre revenue beat estimates.', fact_ids: ['F1', 'E2'] },
      { text: 'Nirmaan Infra added ₹24,335 as Nifty Capital Goods rose 1.14%.', fact_ids: ['F2', 'E4'] },
      { text: 'Vistaar Midcap Opportunities Fund added ₹20,738. Its disclosed holdings explain only part of this, so it is shown at fund level.', fact_ids: ['F3', 'E3'] },
    ],
  }),
  'meera:1M': e({
    headline: 'Your investments gained ₹83,026 (+3.18%) this month. You took out ₹32,161, so your balance is up ₹50,865.',
    bullets: [
      { text: 'Nirmaan Infra added ₹57,213, rising 11.53% after it announced a large metro rail order win.', fact_ids: ['F1', 'E5'] },
      { text: 'A weaker rupee added ₹17,284 to your US holdings as it slipped 1.35% against the dollar.', fact_ids: ['F2', 'E2'] },
      { text: 'Lagged: US tech stocks cost ₹7,908 as Orchard Devices fell 6.89% and the S&P 500 fell 2.95%.', fact_ids: ['H1', 'E1'] },
    ],
  }),
  'meera:SLV': e({
    headline: 'Since your last visit 23 days ago, your investments gained ₹1,08,370 (+4.18%). You took out ₹32,161, so your balance is up ₹76,209.',
    bullets: [
      { text: 'Nirmaan Infra added ₹66,141, rising 13.58% after its metro rail order win on 7 Oct.', fact_ids: ['F1', 'E5'] },
      { text: 'Vistaar Midcap Opportunities Fund added ₹22,517. Its disclosed holdings explain only part of the move, so it is shown at fund level.', fact_ids: ['F2', 'E3'] },
      { text: 'A weaker rupee added ₹17,415 to your US holdings.', fact_ids: ['F3', 'E2'] },
    ],
  }),
};
