// fitXform() test + demo sheet (TOOLING R1). Runs web/scenes/lab_fit (no song needed), prints every case, exits 1 on
// a failed assertion, and writes one still per case plus a sheet:
//   node videos/tools/type_fit_test.mjs [outdir=review/tooling_R1/fit]
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { openScene, ROOT } from './_page.mjs';
const out = path.resolve(ROOT, process.argv[2] || 'review/tooling_R1/fit');
fs.mkdirSync(out, { recursive: true });
const S = await openScene('lab_fit', '', { noHits: true });
const T = await S.page.evaluate(() => window.fitTest), cases = await S.page.evaluate(() => window.CASES);
for (const l of T.lines) console.log(l);
const canvas = await S.page.$('#out'), files = [];
for (let k = 0; k < cases.length; k++) {
  await S.page.evaluate(kk => window.renderFrame(kk), k);
  const f = path.join(out, `case${k}.jpg`); fs.writeFileSync(f, await canvas.screenshot({ type: 'jpeg', quality: 88 })); files.push(f);
}
await S.close();
try {
  execFileSync('python3', [path.join(ROOT, 'scripts/stills_sheet.py'), path.join(out, 'fit_sheet.jpg'), '--title', 'fitXform', '--cols', '6',
    ...files.map((f, k) => `${f}@${k}@`)]);
  console.log('sheet', path.join(out, 'fit_sheet.jpg'));
} catch (e) { console.log('sheet skipped:', e.message.split('\n')[0]); }
console.log(T.pass ? 'type_fit_test PASS' : 'type_fit_test FAIL');
process.exit(T.pass ? 0 : 1);
