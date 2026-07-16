import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDriver, IntegrationError, PublicationError } from '../src/index.mjs';
import { MockAdapter } from '../src/adapter.mjs';

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'baton-acceptance-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'baton-test@example.com'], root);
  git(['config', 'user.name', 'Baton Test'], root);
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

async function completedTask(root, taskId = 'integrate-me') {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/integrated.txt', content: 'accepted\n' }] } });
  const logDir = mkdtempSync(join(tmpdir(), 'baton-ac5-log-'));
  const driver = createDriver({
    repoRoot: root, logDir, adapters: { mock: adapter },
    watchdog: { stallMs: 0 },
  });
  const handle = await driver.coordinator.spawn('mock', brief({ command: 'test -f src/integrated.txt', expectExit: 0 }), { taskId });
  await until(async () => (await driver.coordinator.result(handle.id)).ready);
  assert.equal((await driver.coordinator.result(handle.id)).status, 'completed');
  return { ...driver, handle, logDir };
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

async function integratedPublicationTask({ now, approvalTimeoutMs = 1000 } = {}) {
  const root = repo();
  commitBase(root);
  const calls = [];
  const logDir = mkdtempSync(join(tmpdir(), 'baton-ac6-log-'));
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/publish.txt', content: 'publish me\n' }] } });
  const driver = createDriver({
    repoRoot: root, logDir, adapters: { mock: adapter }, now, approvalTimeoutMs,
    publisher: async (target) => { calls.push(target); return { transport: 'test-publisher' }; },
    watchdog: { stallMs: 0 },
  });
  const handle = await driver.coordinator.spawn('mock', brief({ command: 'test -f src/publish.txt', expectExit: 0 }), { taskId: 'publish-task' });
  await until(async () => (await driver.coordinator.result(handle.id)).ready);
  await driver.coordinator.integrate(handle.id);
  return { ...driver, root, logDir, handle, calls };
}

const closeForReplay = async (coordinator, coordination) => {
  for (const worker of coordinator._workers.values()) {
    if (worker.localAuthority === true && !['dead', 'exited', 'pending'].includes(worker.status)) await coordinator.kill(worker.id, 'test-replay-handoff');
  }
  coordinator.closeAuthority(); coordination.releaseWriterLease();
};

test('AC1: createDriver requireRedGreen proves base red and result green', async () => {
  const root = repo();
  commitBase(root);
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/new.txt', content: 'ok\n' }] } });
  const { coordinator, log } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac1-log-')), adapters: { mock: adapter },
    requireRedGreen: true, watchdog: { stallMs: 0 },
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
    requireCoverage: true, watchdog: { stallMs: 0 },
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, coverageCommand: 'node coverage.mjs',
  }), { taskId: 'covered-change' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.verdict.coverageOfChange, true);
  assert.deepEqual(result.verdict.uncoveredChangedLines, []);
});

test('AC2: requireCoverage rejects a passing but uncovered change', async () => {
  const root = repo();
  commitBase(root, {
    'coverage.mjs': 'console.log(JSON.stringify({files:{"src/x.js":{executedLines:[]}}}))\n',
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac2b-log-')), adapters: { mock: adapter },
    requireCoverage: true, watchdog: { stallMs: 0 },
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, coverageCommand: 'node coverage.mjs',
  }), { taskId: 'uncovered-change' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.verdict.coverageOfChange, false);
  assert.deepEqual(result.verdict.uncoveredChangedLines, ['src/x.js:1']);
});

test('AC3: required mutation accepts a nonzero all-killed population', async () => {
  const root = repo();
  commitBase(root, { 'mutation.mjs': 'console.log(JSON.stringify({killed:2,total:2,survived:[]}))\n' });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac3-log-')), adapters: { mock: adapter },
    requireMutation: true, watchdog: { stallMs: 0 },
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

test('AC3: required mutation rejects survivors and records their identities', async () => {
  const root = repo();
  commitBase(root, { 'mutation.mjs': 'console.log(JSON.stringify({killed:1,total:2,survived:["m2"]}))\n' });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'export const x = 1;\n' }] } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac3b-log-')), adapters: { mock: adapter },
    requireMutation: true, watchdog: { stallMs: 0 },
  });
  const h = await coordinator.spawn('mock', brief({
    command: 'test -f src/x.js', expectExit: 0, mutationCommand: 'node mutation.mjs',
  }), { taskId: 'mutation-weak' });
  await until(async () => (await coordinator.result(h.id)).ready);
  const result = await coordinator.result(h.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.verdict.mutationPassed, false);
  assert.deepEqual(result.verdict.survivedMutants, ['m2']);
});

test('AC4: independent oracle receives immutable spec/git evidence and unlocks required integration', async () => {
  const root = repo();
  commitBase(root, { 'README.md': 'base\n' });
  const implementer = familyAdapter('family-a', {
    outcome: 'completed', summary: 'untrusted implementer prose',
    edits: [{ path: 'src/reviewed.txt', content: 'accepted\n' }],
  });
  const oracle = familyAdapter('family-b', { outcome: 'completed', summary: 'independent oracle prose' });
  const { coordinator, log } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac4-log-')),
    adapters: { implementer, oracle }, requireIndependentOracle: true, watchdog: { stallMs: 0 },
  });
  const parent = await coordinator.spawn('implementer', brief({ command: 'test -f src/reviewed.txt', expectExit: 0 }), { taskId: 'review-parent' });
  await until(async () => (await coordinator.result(parent.id)).ready);

  await assert.rejects(
    coordinator.integrate(parent.id),
    (error) => error instanceof IntegrationError && error.code === 'independent_oracle_required',
  );
  const reviewer = await coordinator.spawnReview(parent.id, 'oracle', {
    taskId: 'oracle-child', kind: 'oracle', verification: { command: 'true', expectExit: 0 },
  });
  await until(async () => (await coordinator.result(reviewer.id)).ready);
  const reviewResult = await coordinator.result(reviewer.id);
  assert.equal(reviewResult.status, 'completed');
  assert.equal(reviewResult.review.independent, true);
  assert.equal(reviewResult.review.implementerFamily, 'family-a');
  assert.equal(reviewResult.review.reviewerFamily, 'family-b');
  const spawned = log.read(reviewer.id).find((entry) => entry.kind === 'lifecycle.spawned');
  assert.equal(spawned.payload.brief.reviewTarget.parentTaskId, 'review-parent');
  assert.equal(spawned.payload.brief.reviewTarget.resultSha, reviewResult.review.resultSha);
  assert.equal(spawned.payload.brief.reviewTarget.spec.goal, 'make the pinned check newly pass');
  assert.equal(JSON.stringify(spawned.payload.brief).includes('untrusted implementer prose'), false);
  assert.equal(log.read(parent.id).some((entry) => entry.kind === 'review.completed' && entry.payload.independent === true), true);

  const integrated = await coordinator.integrate(parent.id);
  assert.equal(integrated.ok, true);
  assert.equal(existsSync(join(root, 'src/reviewed.txt')), true);
});

test('AC4: visible same-family fallback cannot satisfy a required independent oracle', async () => {
  const root = repo();
  commitBase(root);
  const implementer = familyAdapter('shared-family', { outcome: 'completed', edits: [{ path: 'src/x.js', content: 'ok\n' }] });
  const fallback = familyAdapter('shared-family', { outcome: 'completed' });
  const { coordinator, log } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac4-fallback-log-')),
    adapters: { implementer, fallback }, requireIndependentOracle: true, watchdog: { stallMs: 0 },
  });
  const parent = await coordinator.spawn('implementer', brief({ command: 'test -f src/x.js', expectExit: 0 }), { taskId: 'same-family-parent' });
  await until(async () => (await coordinator.result(parent.id)).ready);
  const reviewer = await coordinator.spawnReview(parent.id, 'fallback', {
    taskId: 'same-family-oracle', verification: { command: 'true', expectExit: 0 },
  });
  await until(async () => (await coordinator.result(reviewer.id)).ready);
  assert.equal((await coordinator.result(reviewer.id)).review.independent, false);
  assert.equal(log.read(parent.id).some((entry) => entry.kind === 'review.completed' && entry.payload.independent === false), true);
  await assert.rejects(
    coordinator.integrate(parent.id),
    (error) => error instanceof IntegrationError && error.code === 'independent_oracle_required',
  );
});

test('CK8/CK9: review task creation failure reaches no reviewer adapter and preserves parent evidence', async () => {
  const root = repo();
  commitBase(root);
  const implementer = familyAdapter('family-a', { outcome: 'completed', edits: [{ path: 'src/reviewed.txt', content: 'review me\n' }] });
  const reviewer = familyAdapter('family-b', { outcome: 'completed' });
  let reviewerSpawns = 0;
  const rawSpawn = reviewer.spawn.bind(reviewer);
  reviewer.spawn = async (...args) => { reviewerSpawns += 1; return rawSpawn(...args); };
  const driver = createDriver({ repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-review-fault-log-')), adapters: { implementer, reviewer }, watchdog: { stallMs: 0 } });
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

test('AC5: ff-only integration reaps the worker/worktree/branch and records exact SHAs', async () => {
  const root = repo();
  commitBase(root, { 'README.md': 'base\n' });
  const beforeSha = git(['rev-parse', 'HEAD'], root);
  const { coordinator, coordination, log, handle, logDir } = await completedTask(root);
  const taskWorktree = coordinator.list().find((worker) => worker.id === handle.id)?.worktree;
  assert.equal(typeof taskWorktree, 'string');

  const response = await coordinator.integrate(handle.id, { strategy: 'ff-only', actor: 'test-orchestrator' });
  assert.equal(response.ok, true);
  assert.equal(response.result, 'integrated');
  assert.equal(response.integration.beforeSha, beforeSha);
  assert.equal(response.integration.afterSha, response.integration.resultSha);
  assert.equal(git(['rev-parse', 'HEAD'], root), response.integration.resultSha);
  assert.equal(existsSync(join(root, 'src/integrated.txt')), true);
  assert.equal(coordinator.list().find((worker) => worker.id === handle.id)?.status, 'dead');
  assert.equal(existsSync(taskWorktree), false);
  assert.equal(git(['branch', '--list', 'baton/integrate-me'], root), '');
  assert.equal(git(['for-each-ref', '--format=%(refname)', `refs/baton/results/${response.integration.resultSha}`], root), `refs/baton/results/${response.integration.resultSha}`);
  assert.deepEqual((await coordinator.result(handle.id)).integration, response.integration);
  const event = log.read(handle.id).find((entry) => entry.kind === 'integration.completed');
  assert.equal(event.actor, 'test-orchestrator');
  assert.equal(event.payload.afterSha, response.integration.afterSha);
  assert.equal(coordination.snapshot().artifacts.some((artifact) => artifact.mediaType === 'application/vnd.baton.integration+json'), true);
  assert.equal(coordination.events().some((entry) => entry.kind === 'driver.recorded' && entry.payload.kind === 'integration.completed'), true);
  assert.equal(coordination.queryKnowledge({ types: ['Decision'] }).some((node) => node.id.startsWith('decision:integrate:')), true);
  assert.equal(coordination.events().some((entry) => entry.kind === 'knowledge.promoted' && entry.payload.promotion?.trigger === 'integration'), true);

  await closeForReplay(coordinator, coordination); const replay = createDriver({
    repoRoot: root, logDir, coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) }, watchdog: { stallMs: 0 },
  });
  assert.deepEqual((await replay.coordinator.result(handle.id)).integration, response.integration);
  assert.equal((await replay.coordinator.result(handle.id)).retainedResultRef, `refs/baton/results/${response.integration.resultSha}`);
});

test('CK9: post-merge authority-batch failure poisons and replay refuses integration success', async () => {
  const root = repo();
  commitBase(root, { 'README.md': 'base\n' });
  const { coordinator, coordination, handle, logDir } = await completedTask(root, 'integration-post-effect-failure');
  const resultSha = coordinator._tasks.get('integration-post-effect-failure').capturedSha;
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"kind":"knowledge.promoted"') && body.includes('"trigger":"integration"')) throw new Error('integration authority disk full');
    return rawAppend(file, body, encoding);
  };

  await assert.rejects(coordinator.integrate(handle.id), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(git(['rev-parse', 'HEAD'], root), resultSha, 'the local merge happened before authority storage failed');
  assert.throws(() => coordinator.list(), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(coordination.queryKnowledge({ types: ['Decision'] }).some((node) => node.id.startsWith('decision:integrate:')), false);

  coordination._appendFile = rawAppend;
  await closeForReplay(coordinator, coordination); const replay = createDriver({
    repoRoot: root, logDir, coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) }, watchdog: { stallMs: 0 },
  });
  assert.equal((await replay.coordinator.result(handle.id)).integration, null);
});

test('CK9: replay rejects an asymmetric integration decision without driver and artifact authority', async () => {
  const root = repo();
  commitBase(root, { 'README.md': 'base\n' });
  const { coordinator, coordination, log, handle, logDir } = await completedTask(root, 'integration-split-authority');
  const sha = coordinator._tasks.get('integration-split-authority').capturedSha;
  const integration = { beforeSha: git(['rev-parse', 'HEAD'], root), resultSha: sha, afterSha: sha, strategy: 'ff-only', actor: 'test' };
  const operational = log.append({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: coordinator.list()[0].turnEpoch,
    kind: 'integration.completed', actor: 'human', payload: integration,
  });
  const mapped = coordination.mapOperationalEvent(operational, { actor: 'policy', key: `split-integration:evidence:${operational.seq}` });
  coordination.promoteKnowledgeNode({
    id: `decision:integrate:integration-split-authority:${operational.seq}`, type: 'Decision',
    body: 'asymmetric integration decision', grounding: 'observed', informedBy: ['task:integration-split-authority'],
    evidence: [{ coordinationSeq: mapped.evidence.coordinationSeq }],
  }, { kind: 'Decision', trigger: 'integration' }, { actor: 'human', key: `split-integration:decision:${operational.seq}` });

  await closeForReplay(coordinator, coordination); const replay = createDriver({
    repoRoot: root, logDir, coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) }, watchdog: { stallMs: 0 },
  });
  assert.equal((await replay.coordinator.result(handle.id)).integration, null);
});

test('AC5: a non-fast-forward main refuses without rewriting either tip', async () => {
  const root = repo();
  commitBase(root, { 'README.md': 'base\n' });
  const { coordinator, coordination, log, handle } = await completedTask(root, 'diverged-task');
  writeFileSync(join(root, 'main-only.txt'), 'main advanced\n');
  git(['add', 'main-only.txt'], root);
  git(['commit', '-q', '-m', 'advance main independently'], root);
  const mainBefore = git(['rev-parse', 'HEAD'], root);
  const taskSha = (await coordinator.result(handle.id)).integration?.resultSha
    ?? log.read(handle.id).find((entry) => entry.kind === 'verify.reverified')?.payload?.capture?.sha;

  await assert.rejects(
    coordinator.integrate(handle.id),
    (error) => error instanceof IntegrationError && error.code === 'non_fast_forward_or_dirty',
  );
  assert.equal(git(['rev-parse', 'HEAD'], root), mainBefore);
  assert.notEqual(mainBefore, taskSha);
  assert.equal(git(['show', '-s', '--format=%s', 'HEAD'], root), 'advance main independently');
  assert.equal(log.read(handle.id).at(-1).kind, 'integration.refused');
  const refusedResult = await coordinator.result(handle.id);
  assert.equal(refusedResult.integration, null);
  assert.equal(refusedResult.retainedResultRef, `refs/baton/results/${taskSha}`);
  assert.equal(git(['show-ref', '--verify', refusedResult.retainedResultRef], root).split(' ')[0], taskSha);
  assert.equal(coordination.events().some((entry) => entry.kind === 'driver.recorded' && entry.payload.kind === 'integration.refused'), true);
});

test('AC5: a dirty main refuses without touching the index or working tree', async () => {
  const root = repo();
  commitBase(root, { 'README.md': 'base\n' });
  const { coordinator, log, handle } = await completedTask(root, 'dirty-main-task');
  writeFileSync(join(root, 'README.md'), 'uncommitted user edit\n');
  const headBefore = git(['rev-parse', 'HEAD'], root);
  const statusBefore = git(['status', '--porcelain=v1'], root);

  await assert.rejects(coordinator.integrate(handle.id), IntegrationError);
  assert.equal(git(['rev-parse', 'HEAD'], root), headBefore);
  assert.equal(git(['status', '--porcelain=v1'], root), statusBefore);
  assert.equal(log.read(handle.id).at(-1).kind, 'integration.refused');
  const retained = (await coordinator.result(handle.id)).retainedResultRef;
  assert.equal(git(['show-ref', '--verify', retained], root).endsWith(` ${retained}`), true);
});

test('AC5: integration refuses an unaccepted captured result', async () => {
  const root = repo();
  commitBase(root);
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const { coordinator } = createDriver({
    repoRoot: root, logDir: mkdtempSync(join(tmpdir(), 'baton-ac5-reject-log-')), adapters: { mock: adapter },
    watchdog: { stallMs: 0 },
  });
  const handle = await coordinator.spawn('mock', brief({ command: 'false', expectExit: 0 }), { taskId: 'rejected-result' });
  await until(async () => (await coordinator.result(handle.id)).ready);
  assert.equal((await coordinator.result(handle.id)).status, 'failed');
  await assert.rejects(
    coordinator.integrate(handle.id),
    (error) => error instanceof IntegrationError && error.code === 'result_not_accepted',
  );
});

test('CK8/CK9: integration intent append failure leaves Git and worker ownership untouched', async () => {
  const root = repo();
  commitBase(root);
  const { coordinator, coordination, handle } = await completedTask(root, 'integration-intent-failure');
  const headBefore = git(['rev-parse', 'HEAD'], root);
  const workerBefore = coordinator._workers.get(handle.id);
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"kind":"integration.requested"')) throw new Error('integration intent disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(coordinator.integrate(handle.id), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(git(['rev-parse', 'HEAD'], root), headBefore);
  assert.equal(workerBefore.status, 'idle');
  assert.equal(existsSync(workerBefore.worktree), true);
  assert.equal(coordination.events().some((event) => event.kind === 'driver.recorded' && event.payload.kind === 'integration.requested'), false);
});

test('AC6: publication has no side effect before approval and allow publishes the exact integrated SHA once', async () => {
  const { coordinator, coordination, log, handle, calls, root, logDir } = await integratedPublicationTask();
  const requested = coordinator.requestPublication(handle.id, { remote: 'origin', ref: 'refs/heads/main' }, 'test-user');
  assert.equal(calls.length, 0);
  assert.deepEqual(requested.target, {
    remote: 'origin', ref: 'refs/heads/main', sha: (await coordinator.result(handle.id)).integration.afterSha,
  });
  const event = log.read(handle.id).at(-1);
  assert.equal(event.kind, 'publication.requested');
  assert.equal(JSON.stringify(event).includes('credential'), false);

  const [a, b] = await Promise.all([
    coordinator.respond(requested.requestId, { decision: 'allow', fence: requested.fence }, 'test-user'),
    coordinator.respond(requested.requestId, { decision: 'allow', fence: requested.fence }, 'other-user'),
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], requested.target);
  assert.deepEqual(new Set([a.result, b.result]), new Set(['published', 'already_resolved']));
  assert.equal((await coordinator.result(handle.id)).publication.sha, requested.target.sha);
  assert.equal(log.read(handle.id).filter((entry) => entry.kind === 'publication.completed').length, 1);
  assert.equal(coordination.events().some((entry) => entry.kind === 'driver.recorded' && entry.payload.kind === 'publication.completed'), true);
  assert.equal(coordination.queryKnowledge({ types: ['Decision'] }).some((node) => node.id.startsWith('decision:publish:')), true);
  assert.equal(coordination.events().some((entry) => entry.kind === 'knowledge.promoted' && entry.payload.promotion?.trigger === 'publication'), true);

  await closeForReplay(coordinator, coordination); const replay = createDriver({
    repoRoot: root, logDir, coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) },
    publisher: async () => { throw new Error('replay must never republish'); }, watchdog: { stallMs: 0 },
  });
  assert.deepEqual((await replay.coordinator.result(handle.id)).publication, { requestId: requested.requestId, ...requested.target, actor: 'test-user' });
});

test('CK9: replay rejects an asymmetric publication decision without its paired driver completion', async () => {
  const { coordinator, coordination, log, handle, root, logDir, calls } = await integratedPublicationTask();
  const task = await coordinator.result(handle.id);
  const publication = { requestId: 'split-publication', remote: 'origin', ref: 'refs/heads/main', sha: task.integration.afterSha, actor: 'test-user' };
  const operational = log.append({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: coordinator.list()[0].turnEpoch,
    kind: 'publication.completed', actor: 'human', payload: publication,
  });
  const mapped = coordination.mapOperationalEvent(operational, { actor: 'policy', key: `split:evidence:${operational.seq}` });
  coordination.promoteKnowledgeNode({
    id: `decision:publish:publish-task:${operational.seq}`, type: 'Decision',
    body: 'asymmetric publication decision', grounding: 'observed', informedBy: ['task:publish-task'],
    evidence: [{ coordinationSeq: mapped.evidence.coordinationSeq }],
  }, { kind: 'Decision', trigger: 'publication' }, { actor: 'human', key: `split:decision:${operational.seq}` });

  await closeForReplay(coordinator, coordination); const replay = createDriver({
    repoRoot: root, logDir, coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) },
    publisher: async () => { throw new Error('replay must never republish'); }, watchdog: { stallMs: 0 },
  });
  assert.equal((await replay.coordinator.result(handle.id)).publication, null);
  assert.equal(calls.length, 0);
});

test('CK8/CK9: publication authorization append failure invokes no publisher', async () => {
  const { coordinator, coordination, handle, calls } = await integratedPublicationTask();
  const requested = coordinator.requestPublication(handle.id, { remote: 'origin', ref: 'refs/heads/main' }, 'test-user');
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"kind":"publication.authorized"')) throw new Error('publication authorization disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(
    coordinator.respond(requested.requestId, { decision: 'allow', fence: requested.fence }, 'test-user'),
    (error) => error.code === 'coordination_write_unavailable',
  );
  assert.equal(calls.length, 0);
  assert.equal(coordinator._pending.get(requested.requestId).state, 'pending');
  assert.equal(coordination.events().some((event) => event.kind === 'driver.recorded' && event.payload.kind === 'publication.completed'), false);
});

test('CK8/CK9: post-publish completion failure is bounded and preserves prior authorization', async () => {
  const { coordinator, coordination, handle, calls, root, logDir } = await integratedPublicationTask();
  const requested = coordinator.requestPublication(handle.id, { remote: 'origin', ref: 'refs/heads/main' }, 'test-user');
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"kind":"publication.completed"')) throw new Error('publication completion disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(
    coordinator.respond(requested.requestId, { decision: 'allow', fence: requested.fence }, 'test-user'),
    (error) => error.code === 'coordination_write_unavailable',
  );
  assert.equal(calls.length, 1);
  assert.equal(coordinator._pending.get(requested.requestId).state, 'resolved');
  assert.deepEqual(coordinator._pending.get(requested.requestId).resolution, { decision: 'allow', outcome: 'unknown' });
  assert.equal(coordination.events().some((event) => event.kind === 'driver.recorded' && event.payload.kind === 'publication.authorized'), true);
  assert.equal(coordination.events().some((event) => event.kind === 'driver.recorded' && event.payload.kind === 'publication.completed'), false);
  assert.equal(coordination.queryKnowledge({ types: ['Decision'] }).some((node) => node.id.startsWith('decision:publish:')), false);
  assert.throws(() => coordinator.list(), (error) => error.code === 'coordination_write_unavailable');

  coordination._appendFile = rawAppend;
  await closeForReplay(coordinator, coordination); const replay = createDriver({
    repoRoot: root, logDir, coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) },
    publisher: async () => { throw new Error('replay must never republish'); }, watchdog: { stallMs: 0 },
  });
  const replayed = await replay.coordinator.result(handle.id);
  assert.equal(replayed.status, 'completed', 'publication ambiguity does not rewrite the already integrated task');
  assert.equal(replayed.publication, null, 'operational completion without atomic coordination authority is not success');
});

test('AC6: deny and timeout are fail-closed and never call the publisher', async () => {
  let now = 1000;
  const denied = await integratedPublicationTask({ now: () => now, approvalTimeoutMs: 10 });
  const explicit = denied.coordinator.requestPublication(denied.handle.id, { remote: 'origin', ref: 'refs/heads/main' });
  const deniedResult = await denied.coordinator.respond(explicit.requestId, { decision: 'deny', fence: explicit.fence }, 'test-user');
  assert.equal(deniedResult.result, 'denied');
  assert.equal(denied.calls.length, 0);

  const timed = timedPublicationRequest(denied.coordinator, denied.handle.id);
  now += 11;
  denied.coordinator.list();
  assert.equal(denied.log.read(denied.handle.id).some((entry) => entry.kind === 'publication.denied' && entry.payload.requestId === timed.requestId), false, 'observational reads never execute deadline policy');
  denied.coordinator.tick();
  await until(() => denied.log.read(denied.handle.id).some((entry) => entry.kind === 'publication.denied' && entry.payload.requestId === timed.requestId));
  assert.equal(denied.calls.length, 0);
});

function timedPublicationRequest(coordinator, workerId) {
  return coordinator.requestPublication(workerId, { remote: 'origin', ref: 'refs/heads/main' });
}

test('AC6: a newer authority fence invalidates an older publication approval', async () => {
  const { coordinator, handle, calls } = await integratedPublicationTask();
  const oldRequest = coordinator.requestPublication(handle.id, { remote: 'origin', ref: 'refs/heads/main' });
  const currentRequest = coordinator.requestPublication(handle.id, { remote: 'upstream', ref: 'refs/heads/reviewed' });
  const stale = await coordinator.respond(oldRequest.requestId, { decision: 'allow', fence: oldRequest.fence }, 'test-user');
  assert.equal(stale.result, 'stale_fence');
  assert.equal(calls.length, 0);
  await coordinator.respond(currentRequest.requestId, { decision: 'deny', fence: currentRequest.fence }, 'test-user');
  assert.equal(calls.length, 0);
});

test('AC6: restart drops a pending approval and cannot publish it by replay', async () => {
  const first = await integratedPublicationTask();
  const request = first.coordinator.requestPublication(first.handle.id, { remote: 'origin', ref: 'refs/heads/main' });
  const replayCalls = [];
  // This case models process loss, not a graceful handoff. A graceful close must refuse while it
  // still owns the pending publication decision; the crashed writer lease is the restart fence.
  assert.equal(first.coordination.releaseWriterLease({ requireOwned: true }), true);
  const replay = createDriver({
    repoRoot: first.root, logDir: first.logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed' } }) },
    publisher: async (target) => { replayCalls.push(target); }, watchdog: { stallMs: 0 },
  });
  const response = await replay.coordinator.respond(request.requestId, { decision: 'allow', fence: request.fence }, 'test-user');
  assert.equal(response.result, 'not_found');
  assert.equal(replayCalls.length, 0);
});

test('AC6: credential-bearing remotes and mismatched SHAs are rejected before logging', async () => {
  const { coordinator, log, handle } = await integratedPublicationTask();
  const before = log.read(handle.id).length;
  assert.throws(
    () => coordinator.requestPublication(handle.id, { remote: 'https://token@example.com/repo.git', ref: 'refs/heads/main' }),
    (error) => error instanceof PublicationError && error.code === 'invalid_remote',
  );
  assert.throws(
    () => coordinator.requestPublication(handle.id, { remote: 'origin', ref: 'refs/heads/main', sha: 'deadbeef' }),
    (error) => error instanceof PublicationError && error.code === 'sha_mismatch',
  );
  assert.equal(log.read(handle.id).length, before);
});
