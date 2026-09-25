// The suite verdict (issue #260, #580): a run is green when no test failed and no file hung; the
// verdict names every failure with its file, test name and failure type, so a landing gate can
// compare the change's failures with the target's own. No list of expected failures exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_LEVEL_FAILURE_TYPES, computeVerdict, createProgressDeadline, environmentPrerequisites,
  failureIdentity, formatEnvironment, formatVerdict, isHang, rowKey, verdictDocument,
} from '../scripts/suite-verdict.mjs';

const row = (file, name, extra = {}) => ({ file, name, nesting: 0, ...extra });

test('a run with no failure and no hang is green', () => {
  const verdict = computeVerdict([{ lane: 'suite', passed: [row('test/a.test.mjs', 'one'), row('test/a.test.mjs', 'two')], failed: [] }]);
  assert.equal(verdict.green, true);
  assert.equal(verdict.passed, 2);
  assert.match(formatVerdict(verdict), /baton suite verdict: GREEN — 2 passed, 0 failed, 0 hung/u);
});

test('any failure makes the run red and is named with its file, name and failure type', () => {
  const verdict = computeVerdict([{
    lane: 'suite',
    passed: [row('test/a.test.mjs', 'one')],
    failed: [row('test/a.test.mjs', 'two', { failureType: 'testCodeFailure', message: 'boom\nmore' })],
  }]);
  assert.equal(verdict.green, false);
  assert.deepEqual(verdict.failed.map((entry) => [entry.key, entry.file, entry.name, entry.failureType]),
    [[rowKey('test/a.test.mjs', 'two'), 'test/a.test.mjs', 'two', 'testCodeFailure']]);
  assert.match(formatVerdict(verdict), /RED — 1 passed, 1 failed, 0 hung/u);
  assert.match(formatVerdict(verdict), /failed: test\/a\.test\.mjs :: two — boom$/mu);
});

test('a hang is reported apart from failures and makes the run red', () => {
  const verdict = computeVerdict([{
    lane: 'suite', passed: [],
    failed: [row('test/b.test.mjs', '(file hung: no test event for 600000 ms after start)', { failureType: 'fileHung' })],
  }]);
  assert.equal(verdict.green, false);
  assert.equal(verdict.failed.length, 0);
  assert.equal(verdict.hung.length, 1);
  assert.equal(isHang({ failureType: 'testTimeoutFailure' }), true);
  assert.match(formatVerdict(verdict), /hung \(fileHung\): test\/b\.test\.mjs :: \(file hung/u);
});

test('a test cancelled by a dangling await is a failure, and the headline counts it', () => {
  const verdict = computeVerdict([{
    lane: 'suite', passed: [],
    failed: [row('test/c.test.mjs', 'late', { failureType: 'cancelledByParent' })],
  }]);
  assert.equal(verdict.failed.length, 1);
  assert.equal(verdict.cancelled, 1);
  assert.match(formatVerdict(verdict), /1 of the failures cancelled by a dangling await/u);
});

test('the verdict document lists every failure for comparison, and unexpected names them all', () => {
  const verdict = computeVerdict([{
    lane: 'suite', passed: [row('test/a.test.mjs', 'one')],
    failed: [
      row('test/a.test.mjs', 'two', { failureType: 'testCodeFailure' }),
      row('test/d.test.mjs', '(file hung: no test event for 5 ms after start)', { failureType: 'fileHung' }),
    ],
    skipped: [{ file: 'test/helper.mjs', reason: 'not a test file' }],
  }]);
  const document = verdictDocument(verdict);
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.green, false);
  assert.deepEqual(document.failures.map((entry) => [entry.file, entry.failureType]),
    [['test/a.test.mjs', 'testCodeFailure'], ['test/d.test.mjs', 'fileHung']]);
  // A reader older than #580 blocks on every listed key rather than reading "no failures".
  assert.deepEqual(document.unexpected, document.failures.map((entry) => entry.key));
  assert.deepEqual(document.skipped, [{ file: 'test/helper.mjs', reason: 'not a test file' }]);
  assert.equal(Object.hasOwn(document, 'expectedRed'), false);
});

test('a failure identity is its file, its test, its kind and its code', () => {
  assert.deepEqual([...FILE_LEVEL_FAILURE_TYPES].sort(), ['fileCrashed', 'fileHung', 'fixtureLeak']);
  const hungA = { key: 'test/x.test.mjs :: (file hung: no test event for 10 ms after start)', file: 'test/x.test.mjs', name: '(file hung: no test event for 10 ms after start)', failureType: 'fileHung' };
  const hungB = { ...hungA, key: 'test/x.test.mjs :: (file hung: no test event for 99 ms after a)', name: '(file hung: no test event for 99 ms after a)' };
  assert.equal(failureIdentity(hungA), failureIdentity(hungB), 'two runs of one hung file are the same failure');
  const testFailure = { key: 'test/x.test.mjs :: adds', file: 'test/x.test.mjs', name: 'adds', failureType: 'testCodeFailure' };
  assert.equal(failureIdentity(testFailure), 'test/x.test.mjs :: adds :: assertion :: testCodeFailure');
  assert.notEqual(failureIdentity(testFailure), failureIdentity({ ...testFailure, failureType: 'testTimeoutFailure' }),
    'the same file and test failing with a different kind is a different failure');
  assert.equal(failureIdentity({ key: 'no file', file: null, name: 'adds', failureType: 'testCodeFailure' }), null,
    'a failure that names no file has no identity');
});

const FIXTURE_ROUTES = [
  { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low' },
  { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'low' },
  { harness: 'codex', model: 'gpt-6-sol', effort: 'low' },
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

test('the prerequisite set derives from the route registry and the one readiness derivation', () => {
  const environment = fixtureEnvironment();
  const byId = Object.fromEntries(environment.prerequisites.map((entry) => [entry.id, entry]));
  assert.deepEqual(environment.present, ['omp/deepseek/deepseek-flash']);
  assert.deepEqual(environment.absent, ['omp/zai/glm-5.3-flash']);
  assert.deepEqual(environment.declared, ['codex/gpt-6-sol', 'claude-code:kimi/kimi-k3[1m]']);
  assert.equal(byId['omp/zai/glm-5.3-flash'].missing, 'repository glm_key.json', 'the blocked route names the key file it declares');
  assert.equal(byId['omp/zai/glm-5.3-flash'].code, 'authentication_required');
  assert.match(formatEnvironment(environment), /omp\/zai\/glm-5\.3-flash ABSENT — repository glm_key\.json \(authentication_required\)/u);
  assert.match(formatEnvironment(environment), /codex\/gpt-6-sol declared — the codex readiness contract/u);
  const noKey = environmentPrerequisites({
    routes: [{ harness: 'omp', model: 'unknown/model', effort: 'low' }],
    routeReadiness: () => ({ state: 'blocked', code: 'route_unavailable' }),
    providerKeyFile: () => null,
    readinessContract: () => 'n/a',
  });
  assert.equal(noKey.prerequisites[0].missing, 'route_unavailable');
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
