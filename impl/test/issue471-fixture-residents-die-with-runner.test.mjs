// Issue #471 — a fixture resident dies with the test process, however that process ends.
//
// Ten `baton serve` processes aged 26-42 minutes were found on 2026-09-18, every one a fixture
// resident whose runner had been ended by `timeout`, by a seat's suite lease, by a crash or by
// Ctrl-C before its `t.after` hook could run; each held a listener, a writer lease and a share of
// the host capacity. The repair has two halves, and this file measures both ends of it:
//
//   471a — the RESIDENT side. `baton serve` under a declared parent (`BATON_SERVE_PARENT_PID`,
//          set by the fixture helper and by nothing else) stops through its ordinary stop path
//          when that parent is gone, and the ledger says why:
//          `host.stop_requested {trigger: 'parent_exited', parentPid}` then `host.stopped`.
//          This is the row for a runner that was SIGKILLed — no handler of its own can run.
//   471b — the negative. A resident started WITHOUT the declaration is untouched by a stranger's
//          exit: the variable is the whole switch, and a resident started by hand (or by a
//          successor that inherited nothing) behaves exactly as it did before #471.
//   471c — the FIXTURE side. A runner that is SIGTERMed leaves no resident its helper spawned:
//          the helper ends the child's whole process GROUP (SIGTERM, then SIGKILL at the bound)
//          and re-raises the signal, so the runner still dies with the disposition it was sent.
//
// Hermetic: temp repositories and temp HOME/XDG roots under os.tmpdir(), no network, no provider,
// no real harness. The residents are real `baton serve` children over real deployment roots —
// the same shape the nine migrated fixture files spawn.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
const HELPER_URL = new URL('./fixtures/fixture-resident.mjs', import.meta.url).href;

// The stop every row waits for is the deployment's own ordinary stop; its bound is declared by the
// deployment's rows (the 351s fixture derives that bound exactly) and is a few seconds on an idle
// fixture, so this wait is generous by an order of magnitude.
const STOP_BOUND_MS = 30_000;
// Comfortably past the declared-parent watch's poll (100 ms): a resident that was going to react
// to a stranger's exit would have reacted by now.
const WATCH_SETTLE_MS = 1_500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A fixture world: the repository the resident serves plus the HOME/XDG roots its connection is
 * published under. The verification is declared (an unnamed one is ambiguous, and the resident
 * refuses to open over it), and the git identity is a fixture's — never the operator's. */
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt471-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  for (const directory of [repo, home, configRoot]) mkdirSync(directory, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue471@example.invalid', GIT_COMMITTER_EMAIL: 'issue471@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue471', GIT_COMMITTER_NAME: 'Issue471' });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return { root, repo, home, configRoot };
}

function selectorPath(repo) { return join(repo, '.git', 'baton', 'connection.json'); }
/** The plain `baton serve` deployment root: the git common dir's own layout. */
function ledgerPath(repo) { return join(repo, '.git', 'baton', 'application-v3', 'state', 'coordination', 'events.jsonl'); }

/** The resident's own rows, by the kind the resident names them with. */
function hostRows(repo) {
  const file = ledgerPath(repo);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === 'driver.recorded'
      && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
}

async function until(predicate, label, timeoutMs = STOP_BOUND_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

/** A long-lived child used as the declared parent (or the stranger) of a row. */
function bystander(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return child;
}

/** A real `baton serve` child over the fixture repository, waited for by its own publication. The
 * declaration is the row's subject, so it is the helper's `parentPid` — every resident this file
 * starts is also registered with the helper, and ends with the test process either way. */
function startResident(t, { repo, home, configRoot, parentPid = process.pid }) {
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve'],
    cwd: repo,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot },
    parentPid,
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });
  return {
    child, state,
    async untilReady(timeoutMs = 60_000) {
      await until(() => state.exited !== null || (existsSync(selectorPath(repo)) && state.stderr.includes('"state":"published"')),
        'the resident to publish', timeoutMs);
      assert.equal(state.exited, null, `the resident exited before it published: ${state.stderr.slice(-2_000)}`);
    },
    async signal(signal = 'SIGTERM', timeoutMs = STOP_BOUND_MS) {
      const signalAt = Date.now();
      child.kill(signal);
      await until(() => state.exited !== null, 'the resident to stop', timeoutMs);
      return { exit: state.exited, stderr: state.stderr, msAfterSignal: Date.now() - signalAt };
    },
  };
}

test('471a: a resident whose declared parent is killed stops by itself, and its ledger names why', async (t) => {
  const { repo, home, configRoot } = world('parent-exit');
  const runner = bystander(t);
  const resident = startResident(t, { repo, home, configRoot, parentPid: runner.pid });
  await resident.untilReady();

  // The runner dies the way a `timeout`ed or lease-killed gate runner does: nothing of its own
  // runs afterwards, so only the resident's own watch can end it.
  runner.kill('SIGKILL');
  const killedAt = Date.now();
  await until(() => resident.state.exited !== null, 'the resident to stop by itself', STOP_BOUND_MS);

  assert.deepEqual(
    { code: resident.state.exited.code, signal: resident.state.exited.signal },
    { code: 0, signal: null },
    `a resident under a gone parent takes its ordinary stop, never a crash: ${resident.state.stderr.slice(-2_000)}`,
  );
  assert.ok(Date.now() - killedAt < STOP_BOUND_MS, 'the stop ran inside its bound');

  const rows = hostRows(repo);
  const requested = rows.findIndex((row) => row.payload.kind === 'host.stop_requested');
  const stopped = rows.findIndex((row) => row.payload.kind === 'host.stopped');
  assert.notEqual(requested, -1, 'the ledger names the stop request');
  assert.notEqual(stopped, -1, 'the ledger names the stop');
  assert.ok(requested < stopped, 'the pair reads in the order the facts happened');
  assert.equal(rows[requested].payload.trigger, 'parent_exited',
    `the trigger names WHY the resident ended: ${JSON.stringify(rows[requested].payload)}`);
  assert.equal(rows[requested].payload.parentPid, runner.pid,
    'and the pid whose absence the resident observed');
});

test('471b: a resident started without the declaration is untouched by a stranger\'s exit', async (t) => {
  const { repo, home, configRoot } = world('no-declaration');
  const stranger = bystander(t);
  const resident = startResident(t, { repo, home, configRoot, parentPid: null });
  await resident.untilReady();

  stranger.kill('SIGKILL');
  await sleep(WATCH_SETTLE_MS);

  assert.equal(resident.state.exited, null,
    `the resident outlives the stranger: ${resident.state.stderr.slice(-2_000)}`);
  assert.equal(existsSync(selectorPath(repo)), true, 'the resident is still published');
  assert.deepEqual(hostRows(repo).filter((row) => row.payload.kind === 'host.stop_requested'), [],
    'a stranger\'s exit is not this resident\'s stop');

  // …and the stop it WAS asked for is the one its ledger names: the signal path is unchanged.
  const stop = await resident.signal('SIGTERM');
  assert.deepEqual({ code: stop.exit.code, signal: stop.exit.signal }, { code: 0, signal: null },
    `${stop.stderr.slice(-2_000)}`);
  assert.equal(hostRows(repo).find((row) => row.payload.kind === 'host.stop_requested')?.payload.trigger, 'SIGTERM',
    'the signal it was sent is the trigger it records');
});

test('471c: a runner that is SIGTERMed leaves no resident its helper spawned', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bt471-runner-'));
  roots.push(root);
  const runnerPath = join(root, 'runner.mjs');
  writeFileSync(runnerPath, [
    `import { spawnFixtureResident } from ${JSON.stringify(HELPER_URL)};`,
    '// A stand-in long-lived child: this row measures the HELPER\'s cleanup (the group kill and the',
    '// re-raise), while the resident-side stop is 471a/471b.',
    "const resident = spawnFixtureResident(null, { args: ['-e', 'setInterval(() => {}, 1000);'] });",
    'process.stdout.write(`${resident.pid}\\n`);',
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'));
  const runner = spawn(process.execPath, [runnerPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  runner.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  t.after(() => { if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL'); });

  const residentPid = Number(await until(() => {
    const [line] = stdout.split('\n');
    return line.length > 0 ? line : null;
  }, 'the helper-spawned resident pid'));
  assert.ok(Number.isSafeInteger(residentPid) && residentPid > 0, `the runner named its resident: ${JSON.stringify(stdout)}`);
  t.after(() => { if (alive(residentPid)) { try { process.kill(-residentPid, 'SIGKILL'); } catch { /* gone */ } } });
  await until(() => alive(residentPid), 'the helper-spawned resident to be running');
  assert.ok(runner.pid !== residentPid, 'the resident is the runner\'s own child, not the runner');

  runner.kill('SIGTERM');
  await until(() => runner.exitCode !== null || runner.signalCode !== null, 'the runner to end');
  assert.equal(runner.signalCode, 'SIGTERM',
    'the helper re-raises the signal it was sent, so the runner still dies by it');

  await until(() => !alive(residentPid), 'the helper-spawned resident to be gone', STOP_BOUND_MS);
  assert.equal(alive(residentPid), false, 'no resident survives the runner that spawned it');
});
