// Validator: deterministic checks on every LLM output before a user sees it.
// A failed check means the user gets the template instead. Checks are code, never another model.

const ADVICE = /\b(buy|buying|sell|selling|hold|should|consider|recommend|recommended|switch|exit|book profits?|invest more|add more|stay invested)\b/i;
const PREDICTION = /\b(will|expected|expect|likely|outlook|forecast|going forward|recover|rebound)\b/i;
const STRONG_CAUSAL = /\b(because|due to|driven by|caused by|as a result of)\b/i;
const ALWAYS_OK = new Set(['SIP', 'SIPs', 'NAV', 'NAVs', 'US', 'USD', 'INR', 'FD', 'FDs', 'Q1', 'Q2', 'Q3', 'Q4', 'TOTAL', 'India', 'Indian', 'I']);

function packetStrings(packet) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(packet);
  return out;
}

/** Every number that appears anywhere in the packet (as a value or inside a string). */
export function allowedNumbers(packet) {
  const nums = new Set();
  const walk = (v) => {
    if (typeof v === 'number') nums.add(Math.abs(v));
    else if (typeof v === 'string') (v.match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach((m) => nums.add(Math.abs(parseFloat(m.replace(/,/g, '')))));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(packet);
  return [...nums];
}

function numberIsGrounded(token, allowed) {
  const decimals = token.includes('.') ? token.split('.')[1].length : 0;
  const x = parseFloat(token.replace(/,/g, ''));
  return allowed.some((a) => {
    if (decimals > 0) return Math.abs(Number(a.toFixed(decimals)) - x) < 1e-9;
    if (x >= 100) return Math.abs(a - x) <= 1; // rupee rounding
    return a === x;
  });
}

export function validate(packet, output, { materiality } = {}) {
  const checks = [];
  const add = (name, pass, detail = '', spans = []) => checks.push({ name, pass, detail, spans });

  // 1. Schema
  const schemaOk = output && typeof output.headline === 'string' && Array.isArray(output.bullets) &&
    output.bullets.length >= 1 && output.bullets.length <= 3 &&
    output.bullets.every((b) => typeof b.text === 'string' && Array.isArray(b.fact_ids) && b.fact_ids.length > 0);
  add('Schema: headline + 1 to 3 bullets, each with fact_ids', schemaOk, schemaOk ? '' : 'Output does not match the JSON schema');
  if (!schemaOk) return { pass: false, checks };

  const texts = [output.headline, ...output.bullets.map((b) => b.text)];
  const all = texts.join(' \n ');

  // 2. Fact IDs exist
  const ids = new Set(['TOTAL', ...packet.drivers.map((d) => d.id), ...(packet.held_up ? [packet.held_up.id] : []), ...packet.evidence.map((e) => e.id)]);
  const badIds = output.bullets.flatMap((b) => b.fact_ids.filter((f) => !ids.has(f)));
  add('Every cited fact_id exists in the packet', badIds.length === 0, badIds.length ? `Unknown ids: ${badIds.join(', ')}` : '');

  // 3. Numbers grounded
  const allowed = allowedNumbers(packet);
  const tokens = all.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  const ungrounded = tokens.filter((t) => !numberIsGrounded(t, allowed));
  add('Every number matches the facts packet', ungrounded.length === 0, ungrounded.length ? `Not in packet: ${ungrounded.join(', ')}` : `${tokens.length} numbers checked`, ungrounded);

  // 4. No advice
  const adv = all.match(ADVICE);
  add('No advice language', !adv, adv ? `Found "${adv[0]}"` : '', adv ? [adv[0]] : []);

  // 5. No predictions
  const pred = all.match(PREDICTION);
  add('No predictions', !pred, pred ? `Found "${pred[0]}"` : '', pred ? [pred[0]] : []);

  // 6. Strong causal words need high-confidence evidence cited in the same bullet
  const evById = Object.fromEntries(packet.evidence.map((e) => [e.id, e]));
  const driverEv = Object.fromEntries([...packet.drivers, ...(packet.held_up ? [packet.held_up] : [])].map((d) => [d.id, d.evidence]));
  const weakCausal = output.bullets.filter((b) => {
    if (!STRONG_CAUSAL.test(b.text)) return false;
    const evs = b.fact_ids.flatMap((f) => (evById[f] ? [f] : driverEv[f] || []));
    return !evs.some((e) => evById[e] && evById[e].confidence === 'high' && evById[e].kind !== 'index_move');
  });
  const headCausal = STRONG_CAUSAL.test(output.headline);
  add('Strong cause words backed by high-confidence evidence', weakCausal.length === 0 && !headCausal,
    weakCausal.length || headCausal ? 'Uses "because/due to" without a high-confidence event cited' : '',
    [...weakCausal.map((b) => b.text), ...(headCausal ? [output.headline] : [])].map((t) => t.match(STRONG_CAUSAL)[0]));

  // 7. No unknown entities (catches invented causes like a central bank or a company not in the packet)
  const vocab = packetStrings(packet).join(' ');
  const vocabLower = vocab.toLowerCase();
  const unknown = [];
  for (const t of texts) {
    const words = t.split(/\s+/);
    words.forEach((raw, i) => {
      const w = raw.replace(/['’]s\b/g, '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9&]+$/g, '');
      if (!w || !/^[A-Z]/.test(w) || ALWAYS_OK.has(w)) return;
      const acronym = /^[A-Z]{2,}$/.test(w);
      const sentenceStart = i === 0 || /[.:!?]$/.test(words[i - 1]);
      if (acronym) { if (!new RegExp(`\\b${w}\\b`).test(vocab)) unknown.push(w); return; }
      if (sentenceStart) return;
      if (!vocabLower.includes(w.toLowerCase())) unknown.push(w);
    });
  }
  add('Names only entities in the packet', unknown.length === 0, unknown.length ? `Unknown: ${[...new Set(unknown)].join(', ')}` : '', [...new Set(unknown)]);

  // 8. Flows disclosed when material
  const flows = Math.abs(packet.total.flows_inr);
  const mat = materiality ?? packet.user.materiality_inr;
  if (flows >= mat) {
    const mentions = tokens.some((t) => Math.abs(parseFloat(t.replace(/,/g, '')) - flows) <= 1);
    add('Money added or withdrawn is disclosed', mentions, mentions ? '' : `Flows of ${flows} not mentioned`);
  }

  // 9. Length
  const longOnes = texts.filter((t, i) => t.length > (i === 0 ? 220 : 280));
  add('Length within limits', longOnes.length === 0, longOnes.length ? 'Too long for the card' : '');

  return { pass: checks.every((c) => c.pass), checks };
}

/**
 * Which part of the card failed? Checks the headline and each bullet on their own, so a single bad
 * sentence can be removed instead of throwing away the whole card.
 */
export function diagnose(packet, output) {
  const one = (o) => validate(packet, o, { materiality: Infinity });
  const fails = (v) => v.checks.filter((c) => !c.pass && !c.name.startsWith('Length'));
  const headline = fails(one({ headline: output.headline, bullets: [{ text: '', fact_ids: ['TOTAL'] }] }));
  const sentences = output.headline.split(/(?<=[.!?])\s+/).filter(Boolean)
    .map((text) => ({ text, fails: fails(one({ headline: text, bullets: [{ text: '', fact_ids: ['TOTAL'] }] })) }));
  const bullets = output.bullets.map((b) => fails(one({ headline: '', bullets: [b] })));
  return { headline, sentences, bullets };
}

/** Style fixes we apply silently (never change meaning). */
export function tidy(output) {
  const fix = (s) => s.replace(/\s*—\s*/g, ', ').replace(/\s*–\s*/g, ' to ').replace(/\s+/g, ' ').trim();
  return { headline: fix(output.headline), bullets: output.bullets.map((b) => ({ ...b, text: fix(b.text) })) };
}
