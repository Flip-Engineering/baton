import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDriver } from '../src/index.mjs';
import { MockAdapter } from '../src/adapter.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
const receiptDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'baton-acceptance-'));
  git(['init', '-q'], root);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'baton-test@example.com', GIT_COMMITTER_EMAIL: 'baton-test@example.com' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Test', GIT_COMMITTER_NAME: 'Baton Test' });
  return root;
}
function commitBase(root, files = {}) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(['add', '-A'], root);
  git(['commit', '--allow-empty', '-q', '-m', 'base'], root);
}
function brief(verification) {
  return {
    goal: 'make the pinned check newly pass', constraints: [], pathScope: ['src/**'], definitionOfDone: 'check is red then green',
    verification, budget: { tokens: 100000, usd: 5, wallMin: 5 },
  };
}
async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

function familyAdapter(family, scenario) {
  const adapter = new MockAdapter({ scenario });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: null, available: null, family,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: null, serviceTier: null,
    },
  });
  return adapter;
}

test('AC0: a provider-native failed result bypasses capture/referee and preserves progress without an adoptable result', async () => {
  const root = repo();
  commitBase(root);
  const adapter = new MockAdapter({ scenario: {
    outcome: 'failed', summary: 'structured provider failure',
    edits: [{ path: 'src/partial.txt', content: 'recoverable progress\n' }],
  } });
  const driver = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac0-log-')), adapters: { mock: adapter },
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  let captureCalls = 0;
  let refereeCalls = 0;
  const capture = driver.coordinator._worktrees.capture.bind(driver.coordinator._worktrees);
  driver.coordinator._worktrees.capture = async (...args) => { captureCalls += 1; return capture(...args); };
  const referee = driver.coordinator._referee;
  driver.coordinator._referee = async (...args) => { refereeCalls += 1; return referee(...args); };

  const handle = await driver.coordinator.spawn('mock', brief({ command: 'true', expectExit: 0 }), { taskId: 'provider-failed' });
  const result = await until(async () => {
    const value = await driver.coordinator.result(handle.id);
    return value.ready ? value : null;
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.terminalCause, { kind: 'provider_failure', code: 'provider_turn_failed' });
  assert.equal(result.verdict, null);
  assert.equal(result.capturedSha, null);
  assert.equal(result.retainedResultRef, null);
  // Phase 70's non-adoptable progress checkpoint is the only capture that pins anything; the ended
  // seat's reap then reads the checkout back through the same capture (#616), which returns the
  // recorded sha and mints no second checkpoint. The trust gate never runs.
  await until(() => captureCalls === 2);
  assert.equal(refereeCalls, 0);
  assert.equal(driver.log.read(handle.id).some((event) => event.kind === 'verify.reverified'), false);

  await until(() => driver.log.read(handle.id).some((event) => event.kind === 'worktree.progress_checkpointed'));
  const stopped = await driver.coordinator.result(handle.id);
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.checkpoint?.state, 'pinned');
  assert.equal(stopped.retainedResultRef, null);
});

test('AC1: createDriver requireRedGreen proves base red and result green', async () => {
  const root = repo();
  commitBase(root);
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/new.txt', content: 'ok\n' }] } });
  const { coordinator, log } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac1-log-')), adapters: { mock: adapter },
    requireRedGreen: true, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const h = await coordinator.spawn('mock', brief({ command: 'test -f src/new.txt', expectExit: 0 }), { taskId: 'red-green' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.verdict.redGreen, true);
  assert.notEqual(result.verdict.baseExit, 0);
  assert.equal(log.read(h.id).find((event) => event.kind === 'verify.reverified')?.payload?.accept, true);
});

test('AC2: createDriver requireCoverage computes changed lines and accepts covered change', async () => {
  const root = repo();
  commitBase(root, {
    'coverage.mjs': 'console.log(JSON.stringify({files:{"src/x.js":{executedLines:[1]}}}))\n',
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac2-log-')), adapters: { mock: adapter },
    requireCoverage: true, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, coverageCommand: 'node coverage.mjs',
  }), { taskId: 'covered-change' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.verdict.coverageOfChange, true);
  assert.equal(result.verdict.uncoveredChangedLineCount, 0);
  assert.equal(result.verdict.uncoveredChangedLinesDigest, receiptDigest([]));
});

test('AC2: requireCoverage rejects a passing but uncovered change', async () => {
  const root = repo();
  commitBase(root, {
    'coverage.mjs': 'console.log(JSON.stringify({files:{"src/x.js":{executedLines:[]}}}))\n',
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac2b-log-')), adapters: { mock: adapter },
    requireCoverage: true, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, coverageCommand: 'node coverage.mjs',
  }), { taskId: 'uncovered-change' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.verdict.coverageOfChange, false);
  assert.equal(result.verdict.uncoveredChangedLineCount, 1);
  assert.equal(result.verdict.uncoveredChangedLinesDigest, receiptDigest(['src/x.js:1']));
});

test('AC3: required mutation accepts a nonzero all-killed population', async () => {
  const root = repo();
  commitBase(root, { 'mutation.mjs': 'console.log(JSON.stringify({killed:2,total:2,survived:[]}))\n' });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac3-log-')), adapters: { mock: adapter },
    requireMutation: true, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, mutationCommand: 'node mutation.mjs',
  }), { taskId: 'mutation-strong' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.verdict.mutationPassed, true);
  assert.equal(result.verdict.mutationStrength, 1);
});

test('AC3: required mutation rejects survivors and records only their closed count/digest receipt', async () => {
  const root = repo();
  commitBase(root, { 'mutation.mjs': 'console.log(JSON.stringify({killed:1,total:2,survived:["m2"]}))\n' });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac3b-log-')), adapters: { mock: adapter },
    requireMutation: true, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, mutationCommand: 'node mutation.mjs',
  }), { taskId: 'mutation-weak' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.verdict.mutationPassed, false);
  assert.equal(result.verdict.survivedMutantCount, 1);
  assert.equal(result.verdict.survivedMutantsDigest, receiptDigest(['m2']));
});

test('CK8/CK9: review task creation failure reaches no reviewer adapter and preserves parent evidence', async () => {
  const root = repo();
  commitBase(root);
  const implementer = familyAdapter('family-a', { outcome: 'completed', edits: [{ path: 'src/reviewed.txt', content: 'review me\n' }] });
  const reviewer = familyAdapter('family-b', { outcome: 'completed' });
  let reviewerSpawns = 0;
  const rawSpawn = reviewer.spawn.bind(reviewer);
  reviewer.spawn = async (...args) => { reviewerSpawns += 1; return rawSpawn(...args); };
  const driver = createDriver({ repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-review-fault-log-')), adapters: { implementer, reviewer }, watchdog: { stallMs: 60_000 } }); // valid positive stallMs; watchdog never fires in this window
  const parent = await driver.coordinator.spawn('implementer', brief({ command: 'test -f src/reviewed.txt', expectExit: 0 }), { taskId: 'review-fault-parent' });
  await until(async () => (await driver.coordinator.result(parent.id)).ready);
  const rawAppend = driver.coordination._appendFile;
  driver.coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('"review"')) throw new Error('review task disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(driver.coordinator.spawnReview(parent.id, 'reviewer', {
    kind: 'review', taskId: 'review-fault-child', verification: { command: 'true', expectExit: 0 },
  }), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(reviewerSpawns, 0);
  assert.deepEqual(driver.coordination.snapshot().tasks.map((task) => [task.id, task.status]), [['review-fault-parent', 'completed']]);
});

