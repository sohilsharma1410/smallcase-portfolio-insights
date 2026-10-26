// Output of the nightly Driver Research Agent (scripts/research-batch.mjs), cached.
// Key: SECURITY:EVENT_DATE. One note per abnormal move, shared by every user who holds the security.
// These cached notes were produced during development by running the same research prompt with Claude.
// Run `node scripts/research-batch.mjs` with an API key to regenerate them live.
export default {
  'KAVBK:2026-10-21': {
    sec: 'KAVBK', date: '2026-10-21', driver_type: 'results', confidence: 'high', evidence_ids: ['N-KAV-1021'],
    one_line: 'Kaveri Bank fell after its Q2 results showed provisions up 38% and profit below estimates.',
    rejected: [{ id: 'N-KAV-0915', reason: 'Outside the move window' }],
  },
  'SAPTA:2026-10-20': {
    sec: 'SAPTA', date: '2026-10-20', driver_type: 'results', confidence: 'high', evidence_ids: ['N-SAP-1020'],
    one_line: 'Saptagiri Software rose after Q2 revenue beat estimates and it raised full-year guidance.',
    rejected: [],
  },
  'NIRAM:2026-10-07': {
    sec: 'NIRAM', date: '2026-10-07', driver_type: 'news', confidence: 'medium', evidence_ids: ['N-NIR-1007'],
    one_line: 'Nirmaan Infra rose on the day it announced a large metro rail order win.',
    rejected: [],
  },
  'NEBU:2026-10-21': {
    sec: 'NEBU', date: '2026-10-21', driver_type: 'results', confidence: 'high', evidence_ids: ['N-NEB-1021'],
    one_line: 'Nebula Compute rose after Q3 data-centre revenue beat estimates.',
    rejected: [],
  },
};
