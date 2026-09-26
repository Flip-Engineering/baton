import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createBrief, createDriver, MockAdapter } from '../src/index.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).trim();

async function fixture(t) {
  const world = fs.mkdtempSync(join(tmpdir(), 'baton-workspace-observation-'));
  const repo = join(world, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Workspace observation test', GIT_COMMITTER_NAME: 'Workspace observation test' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'workspace@example.invalid', GIT_COMMITTER_EMAIL: 'workspace@example.invalid' });
  fs.writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', 'base.txt'); git(repo, 'commit', '-qm', 'base');
  const adapter = new MockAdapter({ scenario: {
    outcome: 'completed', edits: [],
    ask: { kind: 'question', question: 'continue?', blocking: true, afterEditIndex: 0 },
  } });
  const driver = createDriver({ repoRoot: repo, logDir: join(world, 'deployment'), adapters: { mock: adapter } });
  const blocked = Promise.withResolvers();
  const onBlocked = (event) => {
    if (event.kind === 'question.asked') blocked.resolve();
  };
  adapter._addInternalListener(onBlocked);
  t.after(async () => {
    await driver.drainAndClose('workspace-observation-test');
    fs.rmSync(world, { recursive: true, force: true });
  });
  const handle = await driver.coordinator.spawn('mock', createBrief({
    goal: 'hold this checkout', constraints: [], pathScope: ['**'],
    definitionOfDone: 'wait for an addressed answer',
    verification: { command: 'test -f base.txt', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 },
  }), { taskId: 'observation-task', runId: 'observation-run' });
  await blocked.promise;
  adapter._removeInternalListener(onBlocked);
  const current = () => driver.coordinator.list().find((worker) => worker.id === handle.id);
  const context = current().sessionContext;
  const receipt = join(repo, '.git/baton/workspace-owners', `${context.ownerTaskId}.json`);
  return { driver, handle, current, context, receipt };
}

function fault(method, target, code) {
  const original = fs[method];
  const paths = new Set([resolve(target), fs.realpathSync(target)]);
  let hits = 0;
  fs[method] = (path, ...args) => {
    if (typeof path === 'string' && paths.has(resolve(path))) {
      hits += 1;
      throw Object.assign(new Error('injected filesystem observation failure'), { code });
    }
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  return {
    get hits() { return hits; },
    restore() { fs[method] = original; syncBuiltinESMExports(); },
  };
}

for (const observation of [
  { name: 'receipt content', method: 'readFileSync', target: (f) => f.receipt },
  { name: 'receipt metadata', method: 'lstatSync', target: (f) => f.receipt },
  { name: 'checkout metadata', method: 'lstatSync', target: (f) => f.context.worktree },
  { name: 'checkout resolution', method: 'realpathSync', target: (f) => f.context.worktree },
]) {
  test(`real driver preserves its worker when ${observation.name} cannot be observed`, async (t) => {
    const f = await fixture(t);
    const injected = fault(observation.method, observation.target(f), 'EACCES');
    try {
      for (let sample = 0; sample < 8; sample += 1) {
        f.driver.coordinator.tick();
        await Promise.resolve();
      }
      assert.ok(injected.hits >= 8, `the real filesystem seam was exercised repeatedly (${injected.hits} hits)`);
      assert.equal(f.current().worktreeObservation.state, 'unknown');
      assert.ok(['working', 'blocked'].includes(f.current().status), JSON.stringify({ status: f.current().status, cause: f.current().terminalCause, events: f.driver.log.read(f.handle.id).map((e) => [e.kind, e.payload?.code]) }));
      assert.equal(f.driver.log.read(f.handle.id).some((event) => event.kind === 'worktree.authority_lost'), false);
      assert.equal(fs.existsSync(f.context.worktree), true, 'the owned checkout stays present');
    } finally { injected.restore(); }
    f.driver.coordinator.tick();
    assert.equal(f.current().worktreeObservation.state, 'available');
    assert.ok(['working', 'blocked'].includes(f.current().status));
  });
}

test('the real driver still rejects an observed corrupted owner receipt', async (t) => {
  const f = await fixture(t);
  const original = fs.readFileSync(f.receipt);
  try {
    fs.writeFileSync(f.receipt, '{invalid JSON');
    assert.equal(f.driver.coordinator._worktrees.worktreeAvailable('observation-task', f.context), false);
    f.driver.coordinator.tick();
    assert.equal(f.driver.log.read(f.handle.id).filter((event) => event.kind === 'worktree.authority_lost').length, 1);
  } finally { fs.writeFileSync(f.receipt, original); }
});

test('the real driver distinguishes absent owner receipt from unreadable owner receipt', async (t) => {
  const f = await fixture(t);
  const moved = `${f.receipt}.test-held`;
  fs.renameSync(f.receipt, moved);
  try {
    assert.equal(f.driver.coordinator._worktrees.worktreeAvailable('observation-task', f.context), false);
  } finally { fs.renameSync(moved, f.receipt); }
});
