// Formatting helpers shared by engine, validator, template and UI.

/** Indian digit grouping: 1234567 -> "12,34,567" */
export function groupIN(n) {
  const s = Math.round(Math.abs(n)).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}
/** "₹12,345" (no sign) */
export const inr = (n) => `₹${groupIN(n)}`;
/** "+₹12,345" / "-₹12,345" */
export const inrSigned = (n) => `${n < 0 ? '-' : '+'}₹${groupIN(n)}`;
/** "1.31%" (no sign) */
export const pct = (x, dp = 2) => `${Math.abs(x * 100).toFixed(dp)}%`;
export const pctSigned = (x, dp = 2) => `${x < 0 ? '-' : '+'}${Math.abs(x * 100).toFixed(dp)}%`;
export const round = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-21" -> "21 Oct" */
export const shortDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** Rough token estimate (chars / 4). Good enough for budgeting, not billing. */
export const estTokens = (s) => Math.ceil((typeof s === 'string' ? s : JSON.stringify(s)).length / 4);
