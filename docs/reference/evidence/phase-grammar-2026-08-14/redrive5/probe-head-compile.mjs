import { compileWavefile } from '../../../../../impl/src/workflow-dsl.mjs';
import { readFileSync } from 'node:fs';
const text = readFileSync(new URL('./demo-two-phase.wavefile', import.meta.url), 'utf8');
try {
  const out = compileWavefile(text, { repoRoot: process.cwd() });
  console.log('COMPILED schemaVersion=' + out.schemaVersion);
} catch (e) {
  console.log('REFUSED code=' + e.code);
  console.log('line=' + e.line + ' field=' + JSON.stringify(e.field) + ' expected=' + JSON.stringify(e.expected));
  console.log('message=' + e.message);
}
