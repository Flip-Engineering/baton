// Issue #399 — a partial-suite verdict must not read as the acceptance verdict.
//
// A run over an explicit file subset (named files, or --changed) prints the same
// `baton suite verdict: GREEN — …` headline as the canonical suite, and the verdict
// document carries no subset flag — so a partial run reads as the acceptance verdict
// (docs/44: the canonical suite is the ONE acceptance). After the fix the runner
// derives ONE coverage value for the run, the subset headline names it, the verdict
// document carries it, and the verdict consumer refuses a subset as the acceptance.
//
// Row inventory (3 rows — red at HEAD, green after):
//   (a) a named-file run prints the SUBSET headline, writes coverage.kind subset
//       with the counts, and renders the subset sentence (live nested runner drive
//       on one tiny test file)
//   (b) the canonical-selection (full) coverage prints the byte-identical headline,
//       carries coverage.kind full, and stays the acceptance (pure seam — a live
//       full run is the whole suite, so this row drives the same helpers the
//       runner uses instead of re-running it)
//   (c) the verdict consumer treats a subset document as NOT the acceptance and
//       says so in one sentence naming the subset
//
// Suite-law hygiene: hermetic (spawns the runner on one in-repo file with a mkdtemp
// verdict path and suite parent; test.after cleanup); no clocks as controls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { computeVerdict, formatVerdict } from '../scripts/suite-verdict.mjs';
import {
  deriveSuiteCoverage,
  isSuiteAcceptanceVerdict,
  renderSuiteCoverageNote,
  renderSuiteVerdictHeadline,
} from '../src/verification-presentation.mjs';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');

const canonicalFileCount = () => readdirSync(join(IMPL, 'test'))
  .filter((name) => name.endsWith('.test.mjs')).length;

function runNamedFile(t, file) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue399-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const verdictPath = join(directory, 'verdict.json');
  const env = { ...process.env, BATON_SUITE_VERDICT_FILE: verdictPath, BATON_TEST_TMP_PARENT: directory };
  delete env.NODE_TEST_CONTEXT;
  return { directory, verdictPath, env, file };
}

function driveRunner(env, args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [RUNNER, ...args], {
      cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => resolveRun({ code: -1, stderr }));
    child.once('close', (code) => resolveRun({ code, stderr }));
  });
}

test('(a) a named-file run prints the SUBSET headline and writes coverage.kind subset', async (t) => {
  const { verdictPath, env } = runNamedFile(t, 'test/suite-verdict.test.mjs');
  const run = await driveRunner(env, ['test/suite-verdict.test.mjs']);
  assert.equal(run.code, 0, `a named-file run over a passing file is green: ${run.stderr.slice(-2000)}`);
  const canonical = canonicalFileCount();
  assert.match(run.stderr, new RegExp(`baton suite verdict \\(SUBSET 1 of ${canonical} files\\): GREEN — `, 'u'),
    'the subset headline names the subset instead of reading as the acceptance');
  const document = JSON.parse(readFileSync(verdictPath, 'utf8'));
  assert.deepEqual(document.coverage, { kind: 'subset', files: 1, canonical },
    'the verdict document carries the subset marker with the counts');
  assert.equal(isSuiteAcceptanceVerdict(document), false, 'a subset document is NOT the acceptance');
  assert.match(renderSuiteCoverageNote(document) ?? '', /1 of \d+ files.*not the .*acceptance/u,
    'the consumer renders the subset sentence naming the subset');
});

test('(b) a full (canonical-selection) verdict keeps the byte-identical headline and stays the acceptance', () => {
  const verdict = computeVerdict(
    [{ lane: 'suite', passed: [{ file: 'test/b.test.mjs', name: 'B1' }], failed: [] }],
    { rows: [] },
  );
  const headline = formatVerdict(verdict);
  const coverage = deriveSuiteCoverage({ subset: false, files: 214, canonical: 214 });
  assert.deepEqual({ ...coverage }, { kind: 'full', files: 214, canonical: 214 });
  assert.equal(renderSuiteVerdictHeadline(headline, coverage), headline,
    'a full run renders byte-identical to today');
  assert.equal(isSuiteAcceptanceVerdict({ coverage }), true, 'a full document stays the acceptance');
  assert.equal(renderSuiteCoverageNote({ coverage }), null, 'a full verdict carries no subset sentence');
});

test('(c) the verdict consumer refuses a subset document as the acceptance in one sentence', () => {
  const document = { coverage: { kind: 'subset', files: 3, canonical: 214 } };
  assert.equal(isSuiteAcceptanceVerdict(document), false);
  const note = renderSuiteCoverageNote(document);
  assert.equal(typeof note, 'string', 'the subset sentence renders');
  assert.match(note, /3 of 214 files/u, 'the sentence names the subset counts');
  assert.match(note, /not the .*acceptance/u, 'the sentence says it is not the acceptance');
  assert.equal(note.split('\n').length, 1, 'the sentence is one line');
});
