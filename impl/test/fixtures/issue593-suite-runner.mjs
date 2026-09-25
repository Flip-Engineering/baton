// Issue #593 fixture: a suite runner whose verdict is dictated by the sandbox it runs in. Each
// side of a comparison runs in its own sandbox, and each sandbox carries the plan for its own run
// in `.plan.json` beside the runner's working directory:
//
//   { "passed": 4, "failures": [{ "file": "test/a.test.mjs", "name": "a :: breaks" }],
//     "died": "the last words a runner that wrote no verdict leaves behind" }
//
// `died` is a run that prints those words and exits WITHOUT writing a verdict document — the
// runner that ran and did not judge. Every run appends its own argv to `.ran.json` in its working
// directory first, so a test can assert which files each side was handed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const argv = process.argv.slice(2);
const ranPath = join(cwd, '.ran.json');
let ran = [];
try { ran = JSON.parse(readFileSync(ranPath, 'utf8')); } catch { ran = []; }
ran.push(argv);
writeFileSync(ranPath, JSON.stringify(ran));

const plan = JSON.parse(readFileSync(join(cwd, '.plan.json'), 'utf8'));
if (plan.died !== undefined) {
  process.stderr.write(`${plan.died}\n`);
  process.exit(plan.exit ?? 2);
}
// `once`: this sandbox's run reports the plan's failures only on its FIRST run there, so the
// confirmation pass a gate makes over its blocking files sees a row that does not reproduce.
const failures = plan.once === true && ran.length > 1 ? []
  : (plan.failures ?? []).map((row) => ({
    key: row.key ?? `${row.file} :: ${row.name}`,
    file: row.file, name: row.name,
    failureType: row.failureType ?? null,
  }));
const document = {
  schemaVersion: 2,
  green: failures.length === 0,
  passed: plan.passed ?? 0,
  failed: failures.map((row) => row.key),
  hung: [],
  failures,
  unexpected: failures.map((row) => row.key),
  skipped: [],
  environment: null,
};
writeFileSync(process.env.BATON_SUITE_VERDICT_FILE, `${JSON.stringify(document)}\n`);
process.exit(plan.exit ?? (failures.length === 0 ? 0 : 1));
