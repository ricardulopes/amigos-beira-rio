// Execução dos testes no Node (opcional): node tests/run-node.mjs
import { runAll } from './harness.js';
import './rules.test.js';
import './operations.test.js';
import './draw.test.js';
import './domain.test.js';
import './admin.test.js';
import './vests.test.js';
import './cloud.test.js';
import './isolation.test.js';

const results = await runAll();
let fails = 0;
for (const r of results) {
  if (!r.ok) fails++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} [${r.suite}] ${r.name}${r.ok ? '' : `\n     ${r.error}`}`);
}
console.log(`\n${results.length - fails}/${results.length} testes passaram`);
process.exit(fails ? 1 : 0);
