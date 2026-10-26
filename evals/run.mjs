// npm run evals
import data from '../data/market.js';
import notes from '../data/driver_notes.js';
import cached from '../data/cached_narratives.js';
import { runEvals } from './suite.js';

const { results, passed, total } = await runEvals({ data, notes, cached });
let suite = '';
for (const r of [...results].sort((a, b) => a.suite.localeCompare(b.suite))) {
  if (r.suite !== suite) { suite = r.suite; console.log(`\n${suite}`); }
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
