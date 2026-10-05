// Implementation mutation control for the catalogs and models domain tests.
//
// The control copies the provider tree and this test directory into a private
// scratch directory, requires the unmutated copy to pass, then applies one
// named text mutation at a time in the copy and requires the selected test
// file to fail. A mutation whose tests still pass reports that the suite does
// not exercise the function under test.
//
// Run: node bend2/tests/context-models/mutation-control.mjs
// Exit status 0 requires every mutation to be caught and the baseline to pass.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const STAMP = process.env.BATON_MUTATION_STAMP ?? String(process.pid);
const SCRATCH = join(REPO, '.scratch', 'bend2', 'context-models-mutations', STAMP);

const MUTATIONS = [
  { name: 'zod-version-gate-removed', file: 'context/models/zod-child.mjs', find: 'if (zodManifest.version !== ADMITTED_ZOD_VERSION) {', replace: 'if (false) {', tests: ['zod-model.test.mjs'] },
  { name: 'execute-target-grant-check-removed', file: 'context/models/zod-model.mjs', find: 'if (!effects.includes(EXECUTE_TARGET_GRANT)) {', replace: 'if (false) {', tests: ['zod-model.test.mjs'] },
  { name: 'export-kind-check-removed', file: 'context/models/zod-child.mjs', find: 'if (typeof zod.ZodType !== \'function\' || !(selected instanceof zod.ZodType)) {', replace: 'if (false) {', tests: ['zod-model.test.mjs'] },
  { name: 'child-stdout-line-count-ignored', file: 'context/models/zod-model.mjs', find: 'if (lines.length !== 1) {', replace: 'if (false) {', tests: ['zod-model.test.mjs'] },
  { name: 'exclusive-artifact-creation-removed', file: 'context/models/zod-child.mjs', find: "descriptor = openSync(path, 'wx', 0o600);", replace: "descriptor = openSync(path, 'w', 0o600);", tests: ['zod-model.test.mjs'] },
  { name: 'custody-limit-blanked', file: 'context/models/zod-model.mjs', find: "export const CUSTODY_BOUNDARY = 'the driver holds", replace: "export const CUSTODY_BOUNDARY = 'x-the driver holds", tests: ['zod-model.test.mjs'] },
  { name: 'origin-identifier-quoting-removed', file: 'context/catalogs/sqlite-statement.mjs', find: 'return `"${String(name).replace(/"/g, \'""\')}"`;', replace: 'return String(name);', tests: ['sql-helpers.test.mjs'] },
  { name: 'rejoin-refusal-removed', file: 'context/catalogs/sqlite-statement.mjs', find: 'const alreadyJoined = plan.join !== undefined', replace: 'const alreadyJoined = false && plan.join !== undefined', tests: ['sql-helpers.test.mjs'] },
  { name: 'prior-unknown-preservation-removed', file: 'context/catalogs/sqlite-statement.mjs', find: 'for (const entry of [...priorUnknown, ...discovered]) {', replace: 'for (const entry of discovered) {', tests: ['sql-helpers.test.mjs'] },
  { name: 'statement-framing-gate-removed', file: 'context/catalogs/sqlite-statement.mjs', find: 'if (scan.statementCount > 1 || scan.trailingHasContent) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'text-admission-removed', file: 'context/catalogs/sqlite-statement.mjs', find: 'if (text.status !== \'admitted\') return text;', replace: 'if (false) return text;', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'nul-byte-check-removed', file: 'context/catalogs/sql-scan.mjs', find: "if (nul !== -1) return { status: 'refused', reason: 'nulByte'", replace: "if (false) return { status: 'refused', reason: 'nulByte'", tests: ['sqlite-catalog.test.mjs'] },
  { name: 'non-main-database-accepted', file: 'context/catalogs/sqlite-statement.mjs', find: 'if (access.database !== MAIN_DATABASE) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'ambiguous-rootpage-accepted', file: 'context/catalogs/sqlite-statement.mjs', find: 'if (owners.length > 1) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'foreign-schema-object-accepted', file: 'context/catalogs/sqlite-statement.mjs', find: 'if (owner.schema !== catalog.schema) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'origin-capability-probe-ignored', file: 'context/catalogs/sqlite-statement.mjs', find: 'if (capability === null || capability.available !== true) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'read-only-file-check-removed', file: 'context/catalogs/sqlite-catalog.mjs', find: 'if (!stat.isFile()) throw new RangeError', replace: 'if (false) throw new RangeError', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'data-version-folded-into-identity', file: 'context/catalogs/sqlite-catalog.mjs', find: 'if (before.catalogDigest !== after.catalogDigest) changed.push(\'catalogDigest\');', replace: 'if (before.catalogDigest !== after.catalogDigest) changed.push(\'catalogDigest\'); if (before.observations.dataVersion !== after.observations.dataVersion) changed.push(\'dataVersion\');', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'client-match-requirement-removed', file: 'context/catalogs/sql-join.mjs', find: "if (value.clientMatch !== 'matched') {", replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'client-match-presence-removed', file: 'context/catalogs/sql-join.mjs', find: 'if (value.clientMatch === undefined) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'receiver-resolution-requirement-removed', file: 'context/catalogs/sql-join.mjs', find: "if (record.receiver?.status !== 'resolved') {", replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'callee-declaration-completeness-removed', file: 'context/catalogs/sql-join.mjs', find: 'if (declarationIdentity(record.callee.declaration) === null) {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'plan-cache-key-collapsed', file: 'context/catalogs/sql-join.mjs', find: "planKey: [record.snapshotId, value.sourceBinding, record.sql.text].join('\\u0000'),", replace: 'planKey: value.sourceBinding,', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'shared-record-admission-bypassed', file: 'context/catalogs/sql-join.mjs', find: "if (fact?.kind !== 'sqlCall') {", replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'record-boundary-bypassed', file: 'context/catalogs/sql-join.mjs', find: 'if (record === null || typeof record !== \'object\') {', replace: 'if (false) {', tests: ['sqlite-catalog.test.mjs'] },
  { name: 'model-module-digest-comparison-removed', file: 'context/models/model-use-join.mjs', find: 'if (record.module.sha256 !== modelSha) {', replace: 'if (false) {', tests: ['model-use-join.test.mjs'] },
  { name: 'model-snapshot-requirement-removed', file: 'context/models/model-use-join.mjs', find: 'if (modelSnapshot === null) {', replace: 'if (false) {', tests: ['model-use-join.test.mjs'] },
  { name: 'export-resolution-requirement-removed', file: 'context/models/model-use-join.mjs', find: "if (record.resolution?.status !== 'resolved') {", replace: 'if (false) {', tests: ['model-use-join.test.mjs'] },
  { name: 'ajv-strict-mode-disabled', file: 'context/models/json-schema.mjs', find: 'strict: true,', replace: 'strict: false,', tests: ['json-schema.test.mjs'] },
  { name: 'remote-reference-admission-removed', file: 'context/models/json-schema.mjs', find: 'if (!admitted.has(target)) {', replace: 'if (false) {', tests: ['json-schema.test.mjs'] },
  { name: 'postgres-plan-grant-check-removed', file: 'context/catalogs/postgres-catalog.mjs', find: 'if (!effects.includes(PLAN_GRANT)) {', replace: 'if (false) {', tests: ['postgres-catalog.test.mjs'] },
  { name: 'postgres-snapshot-change-check-removed', file: 'context/catalogs/postgres-catalog.mjs', find: 'if (comparison.applicability !== \'current\') {', replace: 'if (false) {', tests: ['postgres-catalog.test.mjs'] },
];

function copyTree() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(join(SCRATCH, 'bend2'), { recursive: true });
  cpSync(join(REPO, 'bend2', 'context'), join(SCRATCH, 'bend2', 'context'), { recursive: true });
  cpSync(HERE, join(SCRATCH, 'bend2', 'tests', 'context-models'), { recursive: true });
}

function runTests(tests) {
  const result = spawnSync(process.execPath, ['--test', ...tests.map(test => join('bend2', 'tests', 'context-models', test))], {
    cwd: SCRATCH,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function summary(output) {
  const line = output.split('\n').filter(entry => /^# (pass|fail) /.test(entry)).join(' ');
  return line.length > 0 ? line : output.split('\n').filter(Boolean).slice(-1)[0] ?? '';
}

copyTree();
const baseline = runTests(['sql-helpers.test.mjs', 'sqlite-catalog.test.mjs', 'json-schema.test.mjs', 'zod-model.test.mjs', 'model-use-join.test.mjs', 'postgres-catalog.test.mjs']);
if (baseline.status !== 0) {
  console.error(`baseline failed: ${summary(baseline.stdout)}`);
  console.error(baseline.stderr);
  process.exit(1);
}
console.log(`baseline green: ${summary(baseline.stdout)}`);

let survived = 0;
for (const mutation of MUTATIONS) {
  copyTree();
  const target = join(SCRATCH, 'bend2', mutation.file);
  const source = readFileSync(target, 'utf8');
  if (!source.includes(mutation.find)) {
    console.error(`mutation ${mutation.name}: anchor absent from ${mutation.file}`);
    survived += 1;
    continue;
  }
  if (source.split(mutation.find).length > 2) {
    console.error(`mutation ${mutation.name}: anchor is not unique in ${mutation.file}`);
    survived += 1;
    continue;
  }
  writeFileSync(target, source.replace(mutation.find, mutation.replace));
  const result = runTests(mutation.tests);
  const caught = result.status !== 0;
  console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${mutation.name} (${mutation.tests.join(',')}) ${summary(result.stdout)}`);
  if (!caught) survived += 1;
}

rmSync(SCRATCH, { recursive: true, force: true });
if (survived > 0) {
  console.error(`${survived} mutation(s) survived; the suite does not exercise those functions`);
  process.exit(1);
}
console.log(`all ${MUTATIONS.length} mutations caught`);
