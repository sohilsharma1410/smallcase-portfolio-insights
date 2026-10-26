// Narrator: the only LLM call in the user path. Prompt + output parsing. Provider-agnostic.
export const PROMPT_VERSION = 'narrator-v1.3';

export const SYSTEM_PROMPT = `You write the "Portfolio Pulse" card in an Indian investing app. It tells a user how their portfolio moved and what drove it.

HARD RULES
1. Use only facts in the FACTS packet. Do not calculate anything new: no sums, no differences, no new percentages. Copy rupee amounts and percentages exactly as given. You may drop a minus sign when the verb already says fell or lost.
2. Every bullet lists the fact_ids it uses: driver ids (F1, F2, F3, H1), evidence ids (E1, E2...), or TOTAL for the totals block.
3. No advice or suggestions. Never use: buy, sell, hold, should, consider, recommend, switch, exit.
4. No predictions. Never use: will, expected, likely, outlook, forecast.
5. Causes: write "because" or "due to" only when you cite evidence with confidence "high". Otherwise write "as", "alongside" or "on the day". A driver with only an index move moved with that index. Say so.
6. Name only companies, funds and indices that appear in the packet.
7. If total.flows_inr is not 0, say how much the user added or took out, so it is not mistaken for market gains.

STYLE
Plain English. Short sentences. No emojis. No em dashes. Rupees as ₹ with Indian digit grouping (₹1,02,299). Percentages with the given decimals.
Headline: one sentence, max 25 words, leads with the market gain or loss (total.gain_inr and total.twr_pct).
Bullets: 2 or 3, max 30 words each, biggest driver first. Use held_up for the last bullet if present.
If user.experience is "new", explain an index name in a few words the first time it appears.

OUTPUT
JSON only, no prose around it:
{"headline": "...", "bullets": [{"text": "...", "fact_ids": ["F1","E2"]}]}

EXAMPLE (style only, numbers are not real)
FACTS: total.gain_inr -4200, twr_pct -1.1, flows_inr 10000; F1 Bank stocks -3900, E1 "Nifty Bank fell 2.10%"
{"headline":"Markets took ₹4,200 (-1.1%) off your investments this week, but your ₹10,000 SIP means your balance still went up.","bullets":[{"text":"Bank stocks cost you ₹3,900 as Nifty Bank fell 2.10%.","fact_ids":["F1","E1"]}]}`;

export function buildUserPrompt(packet, feedback) {
  let s = `FACTS\n${JSON.stringify(packet)}`;
  if (feedback) s += `\n\nYOUR PREVIOUS ANSWER FAILED THESE CHECKS. Fix them and answer again:\n${feedback}`;
  return s;
}

/** Pull the first JSON object out of a model reply (some models wrap it in fences). */
export function parseNarratorOutput(text) {
  if (!text) throw new Error('Empty reply');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in reply');
  return JSON.parse(text.slice(start, end + 1));
}

/** Deliberately broken outputs, used by the "inject a bad output" test in the UI and by the eval suite. */
export function injectFault(output, type) {
  const o = JSON.parse(JSON.stringify(output));
  if (!o.bullets || !o.bullets.length) o.bullets = [{ text: '', fact_ids: ['TOTAL'] }];
  if (type === 'wrong_number') {
    o.bullets[0].text = o.bullets[0].text.replace(/₹[\d,]+/, '₹47,310') || o.bullets[0].text + ' That cost ₹47,310.';
    if (!/47,310/.test(o.bullets[0].text)) o.bullets[0].text += ' That cost ₹47,310.';
  } else if (type === 'invented_cause') {
    o.bullets[0].text += ' This was due to the RBI rate hike.';
  } else if (type === 'advice') {
    const b = { text: 'You should consider buying more bank funds while prices are low.', fact_ids: ['F1'] };
    if (o.bullets.length >= 3) o.bullets[o.bullets.length - 1] = b; else o.bullets.push(b);
  } else if (type === 'prediction') {
    o.headline += ' Banks will likely recover next week.';
  } else if (type === 'hidden_flows') {
    const flowWords = /(SIP|you added|took out|withdr)/i;
    o.headline = o.headline.split(/(?<=\.)\s+/).filter((s) => !flowWords.test(s)).join(' ').replace(/,? but that is[^.]*\./, '.').trim() || 'Your balance went up this week.';
    o.bullets = o.bullets.filter((b) => !flowWords.test(b.text));
    if (!o.bullets.length) o.bullets = [{ text: 'Your portfolio had a good week.', fact_ids: ['TOTAL'] }];
  }
  return o;
}
export const FAULT_TYPES = {
  wrong_number: 'Wrong number',
  invented_cause: 'Invented cause (RBI rate hike)',
  advice: 'Investment advice',
  prediction: 'Prediction',
  hidden_flows: 'Hides the SIP inflow',
};
