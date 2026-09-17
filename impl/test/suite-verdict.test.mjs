// The suite verdict decision procedure (issue #260, 2026-09-14 audit S-G2/S-I6/R-1): expected red
// must fail AND must carry a reason, unlisted failures are regressions, hangs are never expected,
// stale expectations refuse, the progress deadline re-arms on every event, and the environment
// dimension names the machine-local prerequisites the run observed — reporting the rows that
// depend on them as environment-red, apart from code rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeVerdict, createProgressDeadline, environmentPrerequisites, formatEnvironment,
  formatVerdict, isHang, loadExpectedRed, manifestRows, planExpectedRedRewrite, reasonClassOf,
  rowKey, verdictDocument, writeExpectedRed,
} from '../scripts/suite-verdict.mjs';

const row = (file, name, extra = {}) => ({ file, name, nesting: 0, ...extra });
const listed = (file, name, reason) => ({ key: rowKey(file, name), reason });

test('a run whose only failures are the listed red-first specs is green', () => {
  const manifest = { rows: [listed('test/a-red.test.mjs', 'A1 RED', '#260')] };
  const verdict = computeVerdict([{ lane: 'parallel', passed: [row('test/b.test.mjs', 'B1')], failed: [row('test/a-red.test.mjs', 'A1 RED', { failureType: 'testCodeFailure', message: 'stage: missing' })] }], manifest);
  assert.equal(verdict.green, true);
  assert.deepEqual(verdict.expectedRed.map((entry) => entry.key), ['test/a-red.test.mjs :: A1 RED']);
  assert.deepEqual(verdict.expectedRedByClass, { issue: 1, audit: 0, credential: 0, environment: 0, design: 0, unattributed: 0 });
  assert.deepEqual(verdict.environmentRed, []);
  assert.equal(verdict.passed, 1);
});

test('an unlisted failure is an unexpected failure and the verdict is red', () => {
  const verdict = computeVerdict([{ lane: 'parallel', passed: [], failed: [row('test/b.test.mjs', 'B1', { failureType: 'testCodeFailure', message: 'boom\nmore' })] }], { rows: [] });
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.unexpected, [{ key: 'test/b.test.mjs :: B1', message: 'boom\nmore' }]);
  assert.match(formatVerdict(verdict), /unexpected failure: test\/b\.test\.mjs :: B1 — boom/u);
});

test('a listed expectation that passes, or never runs, is stale and refuses', () => {
  const manifest = { rows: [listed('test/a-red.test.mjs', 'A1 RED', '#260'), listed('test/gone.test.mjs', 'G1', 'design')] };
  const verdict = computeVerdict([{ lane: 'parallel', passed: [row('test/a-red.test.mjs', 'A1 RED')], failed: [] }], manifest);
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.stale, ['test/a-red.test.mjs :: A1 RED']);
  assert.deepEqual(verdict.unseen, ['test/gone.test.mjs :: G1']);
});

test('a test cancelled by a dangling await earlier in its file is a listable red, counted as cancelled', () => {
  const key = rowKey('test/c.test.mjs', 'C2');
  const failure = { failureType: 'cancelledByParent', message: 'Promise resolution is still pending but the event loop has already resolved' };
  assert.equal(isHang(failure), false);
  const manifest = { rows: [{ key, reason: 'S-I6' }] };
  const listedRun = computeVerdict([{ lane: 'suite', passed: [], failed: [row('test/c.test.mjs', 'C2', failure)] }], manifest);
  assert.equal(listedRun.green, true);
  assert.equal(listedRun.cancelled, 1);
  const unlisted = computeVerdict([{ lane: 'suite', passed: [], failed: [row('test/c.test.mjs', 'C2', failure)] }], { rows: [] });
  assert.equal(unlisted.green, false);
  assert.equal(unlisted.unexpected.length, 1);
});

test('hangs are never expected red, even when listed', () => {
  const key = rowKey('test/h.test.mjs', 'H1');
  for (const failure of [
    { failureType: 'fileHung', message: 'hung' },
    { failureType: 'testTimeoutFailure', message: 'test timed out after 1000ms' },
  ]) {
    assert.equal(isHang(failure), true, failure.failureType);
    const verdict = computeVerdict([{ lane: 'serial', passed: [], failed: [row('test/h.test.mjs', 'H1', failure)] }], { rows: [{ key, reason: '#260' }] });
    assert.equal(verdict.green, false);
    assert.equal(verdict.hung.length, 1);
    assert.deepEqual(verdict.expectedRed, []);
  }
});

test('a stalled lane refuses and suppresses the unseen-row judgement it could not make', () => {
  const manifest = { rows: [listed('test/late.test.mjs', 'L1', '#260')] };
  const verdict = computeVerdict([{ lane: 'serial', passed: [], failed: [], stalled: { lastEvent: 'S9', idleMs: 600_000 } }], manifest);
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.stalled, [{ lane: 'serial', lastEvent: 'S9', idleMs: 600_000 }]);
  assert.deepEqual(verdict.unseen, []);
  assert.match(formatVerdict(verdict), /stalled lane serial: no test event for 600000 ms after S9/u);
});

// ── the reasoned manifest shape (S-G2/S-I6) ─────────────────────────────────────────────────────
test('the reason vocabulary is closed: issue, audit item, or a named class', () => {
  assert.equal(reasonClassOf('#263'), 'issue');
  assert.equal(reasonClassOf('#1'), 'issue');
  assert.equal(reasonClassOf('S-G5'), 'audit');
  assert.equal(reasonClassOf('A-G10'), 'audit');
  assert.equal(reasonClassOf('R-1'), 'audit');
  assert.equal(reasonClassOf('G-24'), 'audit');
  for (const klass of ['credential', 'environment', 'design', 'unattributed']) assert.equal(reasonClassOf(klass), klass);
  for (const bad of ['', 'because', '#0', '#-3', 'S-G', null, undefined, 7]) assert.equal(reasonClassOf(bad), null, String(bad));
});

test('the manifest round-trips reasoned rows and refuses a row with no reason, naming the field', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-verdict-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'expected-red-tests.json');
  assert.deepEqual(loadExpectedRed(path), { schemaVersion: 2, rows: [], converged: [] });
  const written = writeExpectedRed(path, {
    rows: [
      { key: rowKey('test/z.test.mjs', 'Z'), reason: '#260' },
      { key: rowKey('test/a.test.mjs', 'A'), reason: 'design' },
      { key: rowKey('test/z.test.mjs', 'Z'), reason: '#260' },
    ],
    converged: [{ file: 'test/converged-red.test.mjs', reason: '#42' }],
  });
  assert.deepEqual(written.rows.map((entry) => entry.key), ['test/a.test.mjs :: A', 'test/z.test.mjs :: Z']);
  assert.deepEqual(loadExpectedRed(path).rows, written.rows);
  assert.deepEqual(loadExpectedRed(path).converged, [{ file: 'test/converged-red.test.mjs', reason: '#42' }]);
  writeFileSync(path, JSON.stringify({ schemaVersion: 2, rows: [{ key: 'test/a.test.mjs :: A' }] }));
  assert.throws(() => loadExpectedRed(path), { code: 'suite_manifest_invalid', message: /reason/u });
  writeFileSync(path, JSON.stringify({ schemaVersion: 2, rows: [{ key: 'test/a.test.mjs :: A', reason: 'because' }] }));
  assert.throws(() => loadExpectedRed(path), { code: 'suite_manifest_invalid', message: /credential \| environment \| design \| unattributed/u });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, rows: ['test/a.test.mjs :: A'] }));
  assert.throws(() => loadExpectedRed(path), { code: 'suite_manifest_invalid', message: /schemaVersion: 2/u });
});

test('a rewrite keeps every reason that stays red and refuses a row it has no reason for', () => {
  const prior = {
    rows: [listed('test/a.test.mjs', 'A1', '#263'), listed('test/b.test.mjs', 'B1', 'credential')],
    converged: [{ file: 'test/c-red.test.mjs', reason: '#42' }],
  };
  const failures = [row('test/a.test.mjs', 'A1'), row('test/new.test.mjs', 'N1')];
  const refused = planExpectedRedRewrite({ failures, prior });
  assert.equal(refused.refused, true);
  assert.deepEqual(refused.newKeys, ['test/new.test.mjs :: N1']);
  const planned = planExpectedRedRewrite({ failures, prior, defaultReason: '#284' });
  assert.equal(planned.refused, false);
  assert.deepEqual(planned.kept, [
    { key: 'test/a.test.mjs :: A1', reason: '#263' },
    { key: 'test/new.test.mjs :: N1', reason: '#284' },
  ]);
  assert.deepEqual(planned.dropped, ['test/b.test.mjs :: B1'], 'a row that went green is dropped, never carried');
  assert.deepEqual(planned.converged, prior.converged, 'converged red-first files are preserved by a rewrite');
  // An invalid declared reason is not a reason: the rewrite still refuses.
  assert.equal(planExpectedRedRewrite({ failures, prior, defaultReason: 'because' }).refused, true);
});

test('a planned rewrite round-trips through the committed file with every reason intact', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-rewrite-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'expected-red-tests.json');
  const prior = writeExpectedRed(path, {
    rows: [{ key: 'test/a.test.mjs :: A1', reason: '#263' }, { key: 'test/gone.test.mjs :: G1', reason: 'design' }],
    converged: [{ file: 'test/c-red.test.mjs', reason: '#42' }],
  });
  const plan = planExpectedRedRewrite({
    failures: [row('test/a.test.mjs', 'A1'), row('test/new.test.mjs', 'N1')],
    prior: loadExpectedRed(path),
    defaultReason: 'S-G5',
  });
  assert.equal(plan.refused, false);
  const written = writeExpectedRed(path, { rows: plan.kept, converged: plan.converged });
  assert.deepEqual(written.rows, [
    { key: 'test/a.test.mjs :: A1', reason: '#263' },
    { key: 'test/new.test.mjs :: N1', reason: 'S-G5' },
  ]);
  assert.deepEqual(loadExpectedRed(path).rows, written.rows);
  assert.deepEqual(loadExpectedRed(path).converged, prior.converged);
  assert.equal(plan.dropped.length, 1, 'the now-green row was dropped');
});

// ── the environment dimension (R-1) ─────────────────────────────────────────────────────────────
const FIXTURE_ROUTES = [
  { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low' },
  { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'low' },
  { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' },
  { harness: 'claude-code', provider: 'kimi', model: 'kimi-k3[1m]', effort: 'max' },
];
const FIXTURE_READINESS = {
  'deepseek/deepseek-flash': { state: 'ready' },
  'zai/glm-5.3-flash': { state: 'blocked', code: 'authentication_required' },
};
const fixtureEnvironment = () => environmentPrerequisites({
  routes: FIXTURE_ROUTES,
  routeReadiness: (route) => FIXTURE_READINESS[route.model] ?? { state: 'blocked', code: 'omp_agent_unconfigured' },
  providerKeyFile: (model) => ({ 'deepseek/deepseek-flash': 'deepseek_key.json', 'zai/glm-5.3-flash': 'glm_key.json' }[model] ?? null),
  readinessContract: (route) => `the ${route.harness} readiness contract`,
});


test('a manifest row without a classifiable reason refuses the verdict, never reading as "no rows"', () => {
  const summaries = [{ lane: 'suite', passed: [], failed: [row('test/b.test.mjs', 'B1', { failureType: 'testCodeFailure', message: 'x' })] }];
  // The pre-v2 string shape (and any hand-built row missing the field) must fail loudly: silently
  // ignoring it would report the row's failure as an unexpected regression.
  assert.throws(() => computeVerdict(summaries, { rows: ['test/b.test.mjs :: B1'] }), { code: 'suite_manifest_invalid' });
  assert.throws(() => computeVerdict(summaries, { rows: [{ key: 'test/b.test.mjs :: B1' }] }), { code: 'suite_manifest_invalid' });
  const verdict = computeVerdict(summaries, { rows: [{ key: 'test/b.test.mjs :: B1', reason: '#260' }] });
  assert.equal(verdict.green, true);
});
test('the prerequisite set derives from the route registry and the one readiness derivation', () => {
  const environment = fixtureEnvironment();
  const byId = Object.fromEntries(environment.prerequisites.map((entry) => [entry.id, entry]));
  assert.deepEqual(environment.present, ['omp/deepseek/deepseek-flash']);
  assert.deepEqual(environment.absent, ['omp/zai/glm-5.3-flash']);
  assert.deepEqual(environment.declared, ['codex/gpt-5.6-sol', 'claude-code:kimi/kimi-k3[1m]']);
  assert.equal(byId['omp/zai/glm-5.3-flash'].missing, 'repository glm_key.json', 'the blocked route names the key file it declares');
  assert.equal(byId['omp/zai/glm-5.3-flash'].code, 'authentication_required');
  assert.match(formatEnvironment(environment), /omp\/zai\/glm-5\.3-flash ABSENT — repository glm_key\.json \(authentication_required\)/u);
  assert.match(formatEnvironment(environment), /codex\/gpt-5\.6-sol declared — the codex readiness contract/u);
  // A route whose provider declares no key file reports the derivation's own code, never a guess.
  const noKey = environmentPrerequisites({
    routes: [{ harness: 'omp', model: 'unknown/model', effort: 'low' }],
    routeReadiness: () => ({ state: 'blocked', code: 'route_unavailable' }),
    providerKeyFile: () => null,
    readinessContract: () => 'n/a',
  });
  assert.equal(noKey.prerequisites[0].missing, 'route_unavailable');
});

test('environment-classed rows are reported as environment-red, apart from code rows', () => {
  const manifest = {
    rows: [
      listed('test/a-red.test.mjs', 'A1 RED', '#263'),
      listed('test/cred.test.mjs', 'C1', 'credential'),
      listed('test/env.test.mjs', 'E1', 'environment'),
    ],
  };
  const summaries = [{ lane: 'suite', passed: [], failed: [
    row('test/a-red.test.mjs', 'A1 RED', { failureType: 'testCodeFailure', message: 'x' }),
    row('test/cred.test.mjs', 'C1', { failureType: 'testCodeFailure', message: 'x' }),
    row('test/env.test.mjs', 'E1', { failureType: 'testCodeFailure', message: 'x' }),
  ] }];
  const verdict = computeVerdict(summaries, manifest, { environment: fixtureEnvironment() });
  assert.equal(verdict.green, true);
  assert.deepEqual(verdict.expectedRedByClass, { issue: 1, audit: 0, credential: 1, environment: 1, design: 0, unattributed: 0 });
  assert.deepEqual(verdict.codeRed.map((entry) => entry.key), ['test/a-red.test.mjs :: A1 RED']);
  assert.deepEqual(verdict.environmentRed.map((entry) => entry.key), ['test/cred.test.mjs :: C1', 'test/env.test.mjs :: E1']);
  const line = formatVerdict(verdict);
  assert.match(line, /baton suite verdict: GREEN except environment/u);
  assert.match(line, /baton suite environment: /u);
  assert.match(line, /expected red by reason class: issue=1, credential=1, environment=1/u);
  assert.match(line, /environment red \(expected, credential, failed\): test\/cred\.test\.mjs :: C1 — reason credential/u);
  // The machine-readable form carries the same facts.
  const document = verdictDocument(verdict);
  assert.deepEqual(document.environmentRed.map((entry) => entry.reason), ['credential', 'environment']);
  assert.deepEqual(document.environment.absent, ['omp/zai/glm-5.3-flash']);
  assert.equal(document.expectedRedByClass.issue, 1);
});

test('an environment row is judged against the run’s prerequisites, in both directions', () => {
  const manifest = { rows: [listed('test/cred.test.mjs', 'C1', 'credential')] };
  const pass = [{ lane: 'suite', passed: [row('test/cred.test.mjs', 'C1')], failed: [] }];
  const fail = [{ lane: 'suite', passed: [], failed: [row('test/cred.test.mjs', 'C1', { failureType: 'testCodeFailure', message: 'no provider credential' })] }];
  // Every declared prerequisite present: the machine CAN run the row, so it must pass — a failure
  // is an unexpected failure like any other, and a pass is simply fine (never "stale").
  const canRun = { absent: [], present: ['omp/x'], declared: [] };
  assert.deepEqual(computeVerdict(pass, manifest, { environment: canRun }).stale, []);
  assert.equal(computeVerdict(pass, manifest, { environment: canRun }).green, true);
  const canRunFailure = computeVerdict(fail, manifest, { environment: canRun });
  assert.equal(canRunFailure.green, false);
  assert.deepEqual(canRunFailure.unexpected.map((entry) => entry.key), ['test/cred.test.mjs :: C1']);
  assert.equal(canRunFailure.unexpected[0].environmentPrerequisite, 'present');
  // An absent prerequisite: the row is environment-red either way. A failure is expected (not
  // code red, not unexpected) and a pass is not evidence the spec went green.
  const absent = computeVerdict(fail, manifest, { environment: fixtureEnvironment() });
  assert.equal(absent.green, true);
  assert.deepEqual(absent.unexpected, []);
  assert.deepEqual(absent.environmentRed.map((entry) => entry.key), ['test/cred.test.mjs :: C1']);
  assert.match(formatVerdict(absent), /baton suite verdict: GREEN except environment/u);
  const absentPass = computeVerdict(pass, manifest, { environment: fixtureEnvironment() });
  assert.deepEqual(absentPass.stale, [], 'a pass without the prerequisite is not evidence the spec went green');
  assert.deepEqual(absentPass.environmentRed.map((entry) => entry.key), ['test/cred.test.mjs :: C1']);
  assert.match(formatVerdict(absentPass), /unjudged — the prerequisite is absent/u);
});

test('an attributed environment row is judged against its own prerequisite only (#327)', () => {
  const attributed = (name, prerequisite) => ({
    key: rowKey('test/cred.test.mjs', name), reason: 'credential', prerequisite,
  });
  const manifest = {
    rows: [
      attributed('present-needing', 'omp/deepseek/deepseek-flash'),
      attributed('absent-needing', 'omp/zai/glm-5.3-flash'),
      attributed('declared-needing', 'codex/gpt-5.6-sol'),
    ],
  };
  const fail = (name) => row('test/cred.test.mjs', name, { failureType: 'testCodeFailure', message: 'no provider credential' });
  // The fixture run observes glm absent while deepseek is present: an unrelated absent
  // prerequisite must not excuse the row that needs the present one.
  const verdict = computeVerdict(
    [{ lane: 'suite', passed: [], failed: [fail('present-needing'), fail('absent-needing'), fail('declared-needing')] }],
    manifest,
    { environment: fixtureEnvironment() },
  );
  assert.equal(verdict.green, false, 'the row whose own prerequisite is present fails unexpectedly');
  assert.deepEqual(verdict.unexpected.map((entry) => entry.key), ['test/cred.test.mjs :: present-needing']);
  assert.deepEqual(
    verdict.environmentRed.map((entry) => entry.key),
    ['test/cred.test.mjs :: absent-needing', 'test/cred.test.mjs :: declared-needing'],
    'absent excuses its own row; declared leaves its row unjudged',
  );
  const byKey = Object.fromEntries(verdict.environmentRed.map((entry) => [entry.key, entry]));
  assert.equal(byKey['test/cred.test.mjs :: absent-needing'].prerequisiteState, 'absent');
  assert.equal(byKey['test/cred.test.mjs :: declared-needing'].prerequisiteState, 'declared');
  const line = formatVerdict(verdict);
  assert.match(line, /reason credential, prerequisite omp\/zai\/glm-5\.3-flash \(absent\)/u);
  assert.match(line, /reason credential, prerequisite codex\/gpt-5\.6-sol \(declared\)/u);
  // A pass on a declared prerequisite is unjudged, never stale.
  const passVerdict = computeVerdict(
    [{ lane: 'suite', passed: [row('test/cred.test.mjs', 'declared-needing')], failed: [] }],
    { rows: [attributed('declared-needing', 'codex/gpt-5.6-sol')] },
    { environment: fixtureEnvironment() },
  );
  assert.deepEqual(passVerdict.stale, []);
  assert.deepEqual(passVerdict.environmentRed.map((entry) => entry.key), ['test/cred.test.mjs :: declared-needing']);
  assert.match(formatVerdict(passVerdict), /unjudged — the prerequisite is declared \(never evaluated\)/u);
  // A prerequisite this run never observed is declared-like, never an excuse to demand a pass.
  const unknownVerdict = computeVerdict(
    [{ lane: 'suite', passed: [], failed: [fail('present-needing')] }],
    { rows: [attributed('present-needing', 'omp/nope/nothing')] },
    { environment: fixtureEnvironment() },
  );
  assert.equal(unknownVerdict.green, true);
  assert.deepEqual(unknownVerdict.environmentRed.map((entry) => entry.key), ['test/cred.test.mjs :: present-needing']);
  // Without an observed environment an attributed row falls back to the global rule.
  const noEnvironment = computeVerdict(
    [{ lane: 'suite', passed: [], failed: [fail('present-needing')] }],
    { rows: [attributed('present-needing', 'omp/deepseek/deepseek-flash')] },
  );
  assert.equal(noEnvironment.green, false);
  assert.deepEqual(noEnvironment.unexpected.map((entry) => entry.key), ['test/cred.test.mjs :: present-needing']);
});

test('a rewrite keeps each row’s prerequisite and attributes new environment-class rows', () => {
  const prior = {
    rows: [
      { key: rowKey('test/keep.test.mjs', 'K1'), reason: 'credential', prerequisite: 'codex/gpt-5.6-sol' },
      listed('test/bare.test.mjs', 'B1', 'credential'),
    ],
    converged: [],
  };
  const failures = [row('test/keep.test.mjs', 'K1'), row('test/new.test.mjs', 'N1')];
  const planned = planExpectedRedRewrite({
    failures, prior, defaultReason: 'credential', defaultPrerequisite: 'omp/zai/glm-5.3-flash',
  });
  assert.equal(planned.refused, false);
  assert.deepEqual(planned.kept, [
    { key: 'test/keep.test.mjs :: K1', reason: 'credential', prerequisite: 'codex/gpt-5.6-sol' },
    { key: 'test/new.test.mjs :: N1', reason: 'credential', prerequisite: 'omp/zai/glm-5.3-flash' },
  ]);
  // A code reason never takes a prerequisite, even when the flag is passed.
  const issuePlanned = planExpectedRedRewrite({
    failures, prior, defaultReason: '#327', defaultPrerequisite: 'omp/zai/glm-5.3-flash',
  });
  assert.deepEqual(issuePlanned.kept.find((entry) => entry.key === 'test/new.test.mjs :: N1'), {
    key: 'test/new.test.mjs :: N1', reason: '#327',
  });
});

test('the manifest round-trips row prerequisites and refuses an empty one', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-verdict-prereq-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'expected-red-tests.json');
  const written = writeExpectedRed(path, {
    rows: [{ key: rowKey('test/a.test.mjs', 'A'), reason: 'credential', prerequisite: 'codex/gpt-5.6-sol' }],
    converged: [],
  });
  assert.deepEqual(written.rows, [
    { key: 'test/a.test.mjs :: A', reason: 'credential', prerequisite: 'codex/gpt-5.6-sol' },
  ]);
  assert.deepEqual(loadExpectedRed(path).rows, written.rows);
  writeFileSync(path, JSON.stringify({
    schemaVersion: 2,
    rows: [{ key: 'test/a.test.mjs :: A', reason: 'credential', prerequisite: '   ' }],
  }));
  assert.throws(() => loadExpectedRed(path), { code: 'suite_manifest_invalid', message: /prerequisite/u });
  assert.throws(
    () => computeVerdict(
      [{ lane: 'suite', passed: [], failed: [] }],
      { rows: [{ key: 'test/a.test.mjs :: A', reason: 'credential', prerequisite: '' }] },
    ),
    { code: 'suite_manifest_invalid', message: /prerequisite/u },
  );
  const document = verdictDocument(computeVerdict(
    [{ lane: 'suite', passed: [], failed: [row('test/a.test.mjs', 'A', { failureType: 'testCodeFailure', message: 'x' })] }],
    { rows: written.rows },
    { environment: fixtureEnvironment() },
  ));
  assert.deepEqual(document.environmentRed, [{
    key: 'test/a.test.mjs :: A', reason: 'credential', class: 'credential',
    prerequisite: 'codex/gpt-5.6-sol', prerequisiteState: 'declared',
  }]);
});

test('manifestRows sorts both sections so the committed file is byte-stable', () => {
  const { rows, converged } = manifestRows({
    rows: [listed('test/z.test.mjs', 'Z', '#1'), listed('test/a.test.mjs', 'A', '#2')],
    converged: [{ file: 'test/z-red.test.mjs', reason: 'design' }, { file: 'test/a-red.test.mjs', reason: 'design' }],
  });
  assert.deepEqual(rows.map((entry) => entry.key), ['test/a.test.mjs :: A', 'test/z.test.mjs :: Z']);
  assert.deepEqual(converged.map((entry) => entry.file), ['test/a-red.test.mjs', 'test/z-red.test.mjs']);
});

test('the committed manifest describes this suite: reasoned rows, attributed live reds', () => {
  const manifest = loadExpectedRed(new URL('../scripts/expected-red-tests.json', import.meta.url));
  assert.ok(manifest.rows.length > 0, 'the manifest carries the red-first rows');
  for (const entry of manifest.rows) assert.notEqual(reasonClassOf(entry.reason), null, `${entry.key} carries a reason`);
  const raw = JSON.parse(readFileSync(new URL('../scripts/expected-red-tests.json', import.meta.url), 'utf8'));
  assert.equal(raw.schemaVersion, 2);
});

test('the progress deadline re-arms on every observed event', () => {
  let clock = 0;
  const deadline = createProgressDeadline({ timeoutMs: 100, now: () => clock });
  clock = 90; assert.equal(deadline.expired(), false);
  deadline.observe();
  clock = 189; assert.equal(deadline.expired(), false);
  clock = 190; assert.equal(deadline.expired(), true);
  assert.equal(deadline.idleMs(), 100);
  assert.throws(() => createProgressDeadline({ timeoutMs: 0 }), TypeError);
});
