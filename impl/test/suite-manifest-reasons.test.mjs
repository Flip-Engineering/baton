// 2026-09-14 audit S-G2/S-G3/S-I6 and R-1: the expected-red manifest is a reasoned document —
// every row says WHY it is expected not to pass — the `-red` convention is written down and
// enforced in both directions, and the runner's verdict carries the environment dimension the
// deployment readiness derivation resolves. The last test drives the real runner end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadExpectedRed, manifestRows, reasonClassOf } from '../scripts/suite-verdict.mjs';

const IMPL = resolve(import.meta.dirname, '..');
const MANIFEST = join(IMPL, 'scripts', 'expected-red-tests.json');
const CONVENTION_DOC = resolve(IMPL, '..', 'docs', '42-suite-legitimacy.md');

const manifest = loadExpectedRed(MANIFEST);

test('S-G2/S-I6: every committed row carries a classifiable reason, and the manifest is canonical', () => {
  assert.ok(manifest.rows.length > 100, 'the manifest is the suite\'s expected-red ledger');
  const keys = new Set();
  for (const row of manifest.rows) {
    assert.equal(reasonClassOf(row.reason), reasonClassOf(row.reason) ?? null);
    assert.notEqual(reasonClassOf(row.reason), null, `${row.key}: reason "${row.reason}" is not in the vocabulary`);
    assert.ok(row.key.includes(' :: '), `${row.key}: a row key is "file :: name"`);
    assert.ok(!keys.has(row.key), `${row.key}: listed once`);
    keys.add(row.key);
  }
  // The committed bytes are the canonical rendering: sorted, deduplicated, stable.
  const canonical = `${JSON.stringify({ schemaVersion: 2, ...manifestRows(manifest) }, null, 2)}\n`;
  assert.equal(readFileSync(MANIFEST, 'utf8'), canonical, 'the committed manifest is canonically sorted');
});

test('S-N1: the swarm slice is represented in the manifest, with tracked reasons', () => {
  const swarmRows = manifest.rows.filter((row) => /swarm/iu.test(row.key));
  assert.ok(swarmRows.length > 0, 'the swarm slice\'s known gaps are listed, not only documented elsewhere');
  for (const row of swarmRows) {
    assert.notEqual(reasonClassOf(row.reason), null, `${row.key}: a swarm row is attributed`);
    assert.notEqual(row.reason, 'unattributed', `${row.key}: a swarm row names the item that tracks it`);
  }
  assert.ok(manifest.rows.some((row) => row.key.startsWith('test/swarm-gap-red.test.mjs :: ')),
    'the swarm gap suite is the swarm slice\'s red-first representation');
});

test('S-G3: every -red file is either a live red spec or a declared converged one', () => {
  const testDirectory = join(IMPL, 'test');
  const redFiles = readdirSync(testDirectory).filter((name) => name.endsWith('-red.test.mjs')).sort();
  assert.ok(redFiles.length > 0, 'the convention names a real set of files');
  const listed = new Set(manifest.rows.map((row) => row.key.split(' :: ')[0]).filter((file) => file.endsWith('-red.test.mjs')));
  const convergedFiles = new Set(manifest.converged.map((entry) => entry.file));
  for (const name of redFiles) {
    const file = `test/${name}`;
    assert.ok(listed.has(file) || convergedFiles.has(file),
      `${file}: a -red file is either listed in rows or declared converged — the manifest, never the filename, is the authority`);
  }
  // A converged declaration is not a resting place: it must name a real -red file that carries no
  // live rows, and it must carry a reason of its own.
  for (const entry of manifest.converged) {
    assert.ok(entry.file.endsWith('-red.test.mjs'), `${entry.file}: only a -red file converges`);
    assert.ok(redFiles.includes(entry.file.replace(/^test\//u, '')), `${entry.file}: the declared file exists`);
    assert.equal(listed.has(entry.file), false, `${entry.file}: a file with live rows is not also converged`);
    assert.notEqual(reasonClassOf(entry.reason), null, `${entry.file}: a converged declaration carries a reason`);
  }
});

test('S-G3: the convention is written down — what -red means and when it is removed', () => {
  const doc = readFileSync(CONVENTION_DOC, 'utf8');
  assert.match(doc, /`-red\.test\.mjs` marks a red-first spec/u, 'the doc defines the suffix');
  assert.match(doc, /the manifest is the single authority on what is still expected red/u, 'the doc names the authority');
  assert.match(doc, /converged/u, 'the doc defines a converged red-first spec');
  assert.match(doc, /The suffix is \*\*removed\*\* only when the file or the contract it pins is retired/u,
    'the doc states when the suffix is removed');
});

test('S-G2/S-I6: the runner reads the reasoned manifest and writes only rows that carry a reason', () => {
  const runner = readFileSync(join(IMPL, 'scripts', 'run-suite.mjs'), 'utf8');
  assert.match(runner, /planExpectedRedRewrite\(/u, 'the rewrite is planned against the prior manifest');
  assert.match(runner, /--expected-red-reason/u, 'the flag that declares a new row\'s reason');
  assert.match(runner, /refuses to record \$\{plan\.newKeys\.length\} row\(s\) with no reason/u,
    'a rewrite that meets an unattributed row refuses, naming it');
  assert.match(runner, /the manifest field is "reason"/u, 'the refusal names the field it needs');
  // The rewrite passes the planned rows (prior reasons preserved) — never a bare failure list.
  assert.match(runner, /writeExpectedRed\(manifestPath, \{ rows: plan\.kept, converged: plan\.converged \}\)/u);
});

test('R-1: the verdict line and the verdict JSON carry the environment this run observed', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-suite-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const verdictPath = join(directory, 'verdict.json');
  const child = spawn(process.execPath, [join(IMPL, 'scripts', 'run-suite.mjs'), 'test/suite-verdict.test.mjs'], {
    cwd: IMPL,
    env: { ...process.env, BATON_SUITE_VERDICT_FILE: verdictPath, BATON_TEST_TMP_PARENT: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', () => {});
  const code = await new Promise((resolveClose) => {
    child.once('error', () => resolveClose(null));
    child.once('close', (exitCode) => resolveClose(exitCode));
  });
  assert.equal(code, 0, `an explicit-file run over a passing file is green: ${stderr.slice(-2000)}`);
  assert.match(stderr, /baton suite verdict: (GREEN|GREEN except environment) — /u, 'the verdict line leads with the environment-aware headline');
  assert.match(stderr, /baton suite environment: .+present|baton suite environment: .+ABSENT|baton suite environment: .+declared/u,
    'the verdict names the machine-local prerequisites present, absent or declared');
  // A partial run judges only the rows it executed, so the by-class line appears when at least one
  // expected-red row failed in this run; the JSON below carries the same counts either way.
  const document = JSON.parse(readFileSync(verdictPath, 'utf8'));
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.green, true);
  assert.ok(document.environment, 'the JSON carries the environment dimension');
  assert.ok(Array.isArray(document.environment.prerequisites) && document.environment.prerequisites.length > 0,
    'the JSON names every prerequisite it observed');
  assert.equal(typeof document.expectedRedByClass, 'object');
  assert.deepEqual(Object.keys(document.expectedRedByClass).sort(),
    ['audit', 'credential', 'design', 'environment', 'issue', 'unattributed']);
});
