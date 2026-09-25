// Issue #505 — the quarantine remedy `baton doctor` renders named a verb that did not exist:
// the dispatch table had no `quarantine` entry, so an operator whose resident could not start
// had no path forward beyond reading deployment source and calling
// quarantineCoordinationLedgerEvent by hand. The verb exists now — `baton quarantine <SEQ>
// --reason TEXT [--restart]`, a host verb like doctor and serve — and these rows drive it
// through the real CLI argv path over a poisoned fixture ledger:
//   505-a — doctor renders the runnable command; the quarantine records its entry beside the
//           ledger without touching the ledger bytes; a real `baton serve` over the same
//           checkout then publishes.
//   505-b — `--restart` does both from one argv: the quarantine lands and the resident it
//           starts publishes.
//   505-c — the typed refusals: a seq the poison did not name, a ledger that replays clean,
//           an absent ledger (which must not create directories), and the closed argv
//           (missing --reason, a seq that is not one, an unknown flag).
//   505-d — the verb joined the closed set: the parse, `baton --help`, the unknown-verb
//           refusal and the doctor remedy all teach the same row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseBatonCli } from '../src/application-cli.mjs';
import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
// The stop every row waits for is the deployment's own ordinary stop; its bound is a few
// seconds on an idle fixture, so this wait is generous by an order of magnitude.
const STOP_BOUND_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A fixture world: the repository the resident serves plus the HOME/XDG roots its connection
 * is published under. The verification is declared through the fixture package.json's test
 * script (an unnamed one is ambiguous, and the resident refuses to open over it), and the git
 * identity is a fixture's — never the operator's. */
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt505-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  for (const directory of [repo, home, configRoot]) mkdirSync(directory, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'issue505@example.invalid']);
  git(['config', 'user.name', 'Issue505']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return { root, repo, home, configRoot };
}

/** The deployment coordination root: the git common dir's own layout (application-deployment.mjs). */
function coordinationRoot(repo) {
  return join(repo, '.git', 'baton', 'application-v3', 'state', 'coordination');
}

/** The #304 poisoned ledger: a two-row coordination ledger whose second row cannot fold (a
 * contribution naming a participant that was never recorded), so startup refuses at seq 2
 * with participant_not_found. */
function writePoisonedLedger(directory) {
  mkdirSync(directory, { recursive: true });
  const rows = [
    { schemaVersion: 1, seq: 1, ts: '2026-09-14T12:00:00.000Z', kind: 'swarm.created', actor: 'owner', idempotencyKey: 'k1', payload: { swarmId: 'sw-x', purpose: 'typed-replay-failure' } },
    { schemaVersion: 1, seq: 2, ts: '2026-09-14T12:00:01.000Z', kind: 'swarm.contribution_recorded', actor: 'owner', idempotencyKey: 'k2', payload: { swarmId: 'sw-x', contributionId: 'c-ghost', participantId: 'ghost', body: 'no such participant' } },
  ];
  writeFileSync(join(directory, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

/** `baton …`, exactly as an operator runs it: the real CLI entry in its own process, over this
 * checkout's scripts, in the fixture's repository with the fixture's environment. */
function runBaton(args, { repo, env }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo, encoding: 'utf8', env, timeout: 60_000,
  });
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

/** A fixture resident (its own process group, ended by the helper on every runner exit) whose
 * readiness is its own publication: the connection file appears and the serve log names the
 * published state. */
function startResident(t, { args, repo, env }) {
  const child = spawnFixtureResident(t, { args, cwd: repo, env });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  return {
    child, state,
    async untilReady(timeoutMs = 60_000) {
      await until(() => state.exited !== null
        || (existsSync(join(repo, '.git', 'baton', 'connection.json'))
          && state.stderr.includes('"state":"published"')),
      'the resident to publish', timeoutMs);
      assert.equal(state.exited, null, `the resident exited before it published: ${state.stderr.slice(-2_000)}`);
    },
    async signal(signal = 'SIGTERM') {
      child.kill(signal);
      await until(() => state.exited !== null, 'the resident to stop');
      return state.exited;
    },
  };
}

test('505-a: the rendered remedy closes the loop — quarantine, then the resident starts', async (t) => {
  const { repo, home, configRoot } = world('quarantine-verb');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  writePoisonedLedger(coordinationRoot(repo));

  const diagnosed = runBaton(['doctor'], { repo, env });
  assert.equal(diagnosed.status, 1, `the doctor exits 1 in the refused state (stderr: ${diagnosed.stderr})`);
  const verdict = JSON.parse(diagnosed.stdout);
  assert.equal(verdict.coordination.seq, 2);
  assert.equal(verdict.next[0].action, 'quarantine');
  assert.equal(verdict.next[0].command, 'baton quarantine 2 --reason participant_not_found --restart',
    'the remedy is the runnable command, not prose');

  const ledgerBefore = readFileSync(join(coordinationRoot(repo), 'events.jsonl'), 'utf8');
  const repaired = runBaton(['quarantine', '2', '--reason', 'participant_not_found'], { repo, env });
  assert.equal(repaired.status, 0, `the quarantine exits 0 (stderr: ${repaired.stderr})`);
  const outcome = JSON.parse(repaired.stdout);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result, 'quarantined');
  assert.equal(outcome.entry.seq, 2);
  assert.equal(outcome.entry.causeCode, 'participant_not_found');

  // The repair is recorded durably beside the ledger; the ledger bytes are untouched.
  const recorded = JSON.parse(readFileSync(join(coordinationRoot(repo), 'coordination-quarantine.json'), 'utf8'));
  assert.deepEqual(recorded.entries.map((entry) => entry.seq), [2]);
  assert.equal(readFileSync(join(coordinationRoot(repo), 'events.jsonl'), 'utf8'), ledgerBefore);

  // The point of the repair: a resident over this checkout actually starts.
  const resident = startResident(t, { args: [SCRIPT, 'serve'], repo, env });
  await resident.untilReady();
  const stopped = await resident.signal();
  assert.equal(stopped.code, 0, `the resident stops cleanly (exit: ${stopped.code})`);
});

test('505-b: --restart quarantines and brings the resident up from the same argv', async (t) => {
  const { repo, home, configRoot } = world('quarantine-restart');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  writePoisonedLedger(coordinationRoot(repo));

  const resident = startResident(t, {
    args: [SCRIPT, 'quarantine', '2', '--reason', 'participant_not_found', '--restart'],
    repo, env,
  });
  await resident.untilReady();

  const recorded = JSON.parse(readFileSync(join(coordinationRoot(repo), 'coordination-quarantine.json'), 'utf8'));
  assert.deepEqual(recorded.entries.map((entry) => entry.seq), [2],
    'the quarantine of this argv is what the started resident stands on');

  const stopped = await resident.signal();
  assert.equal(stopped.code, 0, `the resident stops cleanly (exit: ${stopped.code})`);
});

test('505-c: the verb refuses typed through the real argv path', (t) => {
  const wrong = world('quarantine-wrong-seq');
  const env = { ...process.env, HOME: wrong.home, XDG_CONFIG_HOME: wrong.configRoot };
  writePoisonedLedger(coordinationRoot(wrong.repo));
  const ledgerBefore = readFileSync(join(coordinationRoot(wrong.repo), 'events.jsonl'), 'utf8');

  // A seq the poison did not name: the probe's own discovery wins over the operator's guess.
  const mismatch = runBaton(['quarantine', '1', '--reason', 'a guess'], { repo: wrong.repo, env });
  assert.equal(mismatch.status, 1, `the wrong-seq quarantine exits 1 (stdout: ${mismatch.stdout})`);
  assert.match(mismatch.stderr, /coordination_quarantine_refused/u);
  assert.match(mismatch.stderr, /seq 2/u, 'the refusal names the seq the replay actually refuses at');
  assert.equal(readFileSync(join(coordinationRoot(wrong.repo), 'events.jsonl'), 'utf8'), ledgerBefore);
  assert.equal(existsSync(join(coordinationRoot(wrong.repo), 'coordination-quarantine.json')), false,
    'a refused quarantine records nothing');

  // A ledger that replays clean: quarantine is not warranted.
  const clean = world('quarantine-clean-ledger');
  const cleanEnv = { ...process.env, HOME: clean.home, XDG_CONFIG_HOME: clean.configRoot };
  mkdirSync(coordinationRoot(clean.repo), { recursive: true });
  writeFileSync(join(coordinationRoot(clean.repo), 'events.jsonl'), '');
  const cleanRun = runBaton(['quarantine', '1', '--reason', 'nothing is wrong'], { repo: clean.repo, env: cleanEnv });
  assert.equal(cleanRun.status, 1);
  assert.match(cleanRun.stderr, /coordination_quarantine_replays_clean/u);

  // No ledger at all: a machine with no deployment never has directories created under it.
  const absent = world('quarantine-no-ledger');
  const absentEnv = { ...process.env, HOME: absent.home, XDG_CONFIG_HOME: absent.configRoot };
  const absentRun = runBaton(['quarantine', '1', '--reason', 'nothing there'], { repo: absent.repo, env: absentEnv });
  assert.equal(absentRun.status, 1);
  assert.match(absentRun.stderr, /coordination_quarantine_no_ledger/u);
  assert.equal(existsSync(coordinationRoot(absent.repo)), false, 'the refusal creates no coordination root');

  // The closed argv: every bad form refuses at the parse, naming the usage.
  const parseCases = [
    { args: ['quarantine', '2'], message: /--reason/u },
    { args: ['quarantine', 'abc', '--reason', 'x'], message: /usage: baton quarantine/u },
    { args: ['quarantine', '2', '--reason', 'x', '--force'], message: /unexpected argument --force/u },
  ];
  for (const item of parseCases) {
    const run = runBaton(item.args, { repo: wrong.repo, env });
    assert.equal(run.status, 2, `${item.args.join(' ')} refuses at the parse (stderr: ${run.stderr})`);
    assert.match(run.stderr, item.message);
  }
});

test('505-d: the verb joined the closed set — parse, help and refusal teach one row', (t) => {
  const parsed = parseBatonCli(['quarantine', '2', '--reason', 'the startup probe reported this seq']);
  assert.equal(parsed.kind, 'quarantine');
  assert.equal(parsed.seq, 2);
  assert.equal(parsed.reason, 'the startup probe reported this seq');
  assert.equal(parsed.restart, false);

  const restarting = parseBatonCli(['quarantine', '--restart', '--reason', 'r', '2']);
  assert.equal(restarting.restart, true, 'flags parse in any order around the positional seq');
  assert.equal(restarting.seq, 2);

  const helpDir = mkdtempSync(join(tmpdir(), 'bt505-help-'));
  roots.push(helpDir);
  const help = runBaton(['quarantine', '--help'], { repo: helpDir, env: {} });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /baton quarantine <SEQ> --reason TEXT \[--restart\]/u,
    'the help teaches the verb row');

  const refusal = (() => { try { parseBatonCli(['bogus']); return null; } catch (error) { return error; } })();
  assert.ok(refusal, 'an unknown verb refuses');
  assert.match(refusal.message, /quarantine/u, 'the unknown-verb refusal names the closed set the parser dispatches');
});
