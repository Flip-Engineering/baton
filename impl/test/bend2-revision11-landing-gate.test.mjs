// Revision 11 — no bookkeeping ledgers in place of function — applied to the runtime landing gate.
// The law's Application scope (docs/bend2/laws-trace.md, encoded in
// docs/bend2/examples/laws-no-ledger.bend on bend2-rewrite) names what Baton's gate must decide
// from the two runs' own observations: a failure identity of file, test, kind and code; an unjudged
// target reported as unjudged that matches nothing; an unjudged change that cannot authorize a
// landing; every selected invocation accounted for; the selection the gate derived from the changed
// paths it was given; and the verdict of the run the gate started. This file drives the REAL
// `swarm.integrate` against a fixture repository whose gate runner is scripted per tree, one row
// per property.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SupervisedProcesses } from '../src/coordinator.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { selectFromRepository } from '../src/verification-selection.mjs';

const principal = { actor: 'direct:revision11-root', principalId: 'revision11-root', sessionId: 'revision11-root' };
const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };
/** The one changed source path every fixture lane commits; the landing table classifies it to a
 * non-empty gate set, which is what the rows below judge. */
const CHANGE = 'impl/src/coordinator.mjs';
const REGENERATORS = Object.freeze([
  'impl/scripts/surface-gate.mjs', 'impl/scripts/render-surface-docs.mjs',
]);

const git = (repo, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** A regenerator that writes the artifact its own name implies, so the landing's regenerate step
 * succeeds and the receipt's `regenerated` row is readable. */
function regeneratorSource(artifact) {
  return "import { mkdirSync, writeFileSync } from 'node:fs';\n"
    + "mkdirSync(new URL('../data/', import.meta.url), { recursive: true });\n"
    + `writeFileSync(new URL('../data/${artifact}', import.meta.url), 'ok\\n');\n`;
}

/**
 * The gate runner the fixture installs at `impl/scripts/run-suite.mjs` — the seam a landing's gate
 * step invokes. It records every invocation (its working directory, the names it was handed and the
 * verdict path its own environment carried), then answers with the plan the test scripted for the
 * TREE it is running in: the lane commit carries `lane = 2` in the changed module, the target does
 * not. A plan whose `write` is null is a run that judged nothing and wrote no verdict document.
 */
function runnerSource(recordPath) {
  return [
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const names = process.argv.slice(2);',
    'const verdict = process.env.BATON_SUITE_VERDICT_FILE ?? null;',
    'const plan = JSON.parse(process.env.BATON_FIXTURE_GATE_SCRIPT);',
    "const lane = existsSync(join(process.cwd(), 'src/coordinator.mjs'))",
    "  && readFileSync(join(process.cwd(), 'src/coordinator.mjs'), 'utf8').includes('lane = 2');",
    "const chosen = plan[lane ? 'change' : 'target'];",
    `appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify({`
      + " cwd: process.cwd(), names, verdict, tree: lane ? 'change' : 'target' }) + '\\n');",
    'if (chosen.write === null) process.exit(1);',
    'const document = { ...chosen.write };',
    'if (Array.isArray(chosen.reported)) document.reportedFiles = chosen.reported;',
    'writeFileSync(verdict, `${JSON.stringify(document)}\\n`);',
    'process.exit(document.green ? 0 : 1);',
  ].join('\n');
}

/** A run that judged every selected file it was handed and found nothing. */
const green = (reported) => ({
  write: { schemaVersion: 2, green: true, passed: reported.length, failures: [], unexpected: [] },
  reported,
});

/** A run that failed one test of `file`, naming the failure with the runner's typed failure type. */
const failed = (file, name, failureType, reported) => ({
  write: {
    schemaVersion: 2, green: false, passed: 0,
    failures: [{ key: `${file} :: ${name}`, file, name, failureType }],
    unexpected: [`${file} :: ${name}`],
  },
  reported,
});

/** A run that judged nothing and wrote no verdict document. */
const unjudged = { write: null, reported: null };

const contractBody = ({ sha, observedHead, rebasedOnto }) => ({
  subject: 'Revision 11 reaches the landing gate',
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'revision11-gate', status: 'delivered',
    change: 'The landing gate decides from the runs it started',
    files: [CHANGE], test: 'node --test test/bend2-revision11-landing-gate.test.mjs', evidence: 'gate rows green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * A repository with this repository's landing layout — tests at `impl/test/<file>`, the runner at
 * `impl/scripts/run-suite.mjs`, the three tracked regenerators — whose lane commit moves exactly one
 * source file. `script` receives the derived gate names in the runner's shape and answers with the
 * plan for each tree. The runtime is wired the way a resident wires one, so the default supervised
 * gate run is what the rows below measure.
 */
async function world(t, { script }) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-revision11-'));
  const repo = join(directory, 'repo');
  const recordPath = join(directory, 'gate-runs.jsonl');
  const capacityRoot = join(directory, 'host-capacity');
  const hosted = {
    root: process.env.BATON_HOST_CAPACITY_ROOT,
    wait: process.env.BATON_HOST_CAPACITY_WAIT_MS,
    script: process.env.BATON_FIXTURE_GATE_SCRIPT,
  };
  process.env.BATON_HOST_CAPACITY_ROOT = capacityRoot;
  process.env.BATON_HOST_CAPACITY_WAIT_MS = '300';
  t.after(() => {
    for (const [key, value] of [['BATON_HOST_CAPACITY_ROOT', hosted.root],
      ['BATON_HOST_CAPACITY_WAIT_MS', hosted.wait],
      ['BATON_FIXTURE_GATE_SCRIPT', hosted.script]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Revision 11', GIT_COMMITTER_NAME: 'Revision 11' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'revision11@example.invalid', GIT_COMMITTER_EMAIL: 'revision11@example.invalid' });
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const regenerator of REGENERATORS) {
    write(repo, regenerator, regeneratorSource(`${regenerator.split('/').at(-1).replace(/\.mjs$/u, '')}.json`));
  }
  write(repo, 'impl/scripts/run-suite.mjs', runnerSource(recordPath));
  write(repo, 'impl/package.json', '{"name":"fixture-revision11","private":true}\n');
  // Test files that import the changed module, so selectFromRepository selects them through the
  // import graph. Two files are created so tests that need `selected.length > 1` have a meaningful
  // fixture (r11e, r11f).
  const moduleName = CHANGE.split('/').pop();
  write(repo, `impl/test/fixture-${moduleName.replace('.mjs', '-a.test.mjs')}`,
    `import '../src/${moduleName}';\n`);
  write(repo, `impl/test/fixture-${moduleName.replace('.mjs', '-b.test.mjs')}`,
    `import '../src/${moduleName}';\n`);
  write(repo, CHANGE, 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');
  // The gate set is derived from selectFromRepository: the import-graph selector that reads the
  // tree under test and selects every test file that imports or names the changed path.
  const expected = selectFromRepository({ root: repo, changedPaths: [CHANGE] })
    .files.map((f) => f.replace(/^impl\/test\//, ''));
  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, CHANGE, 'export const lane = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `lane work: ${CHANGE}`);
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const selected = expected.map((name) => `test/${name}`);
  process.env.BATON_FIXTURE_GATE_SCRIPT = JSON.stringify(script(selected));

  const store = new CoordinationStore(join(directory, 'ledger'));
  const pool = new SupervisedProcesses();
  const G = 1024 ** 3;
  const hostCapacity = new HostCapacityAuthority({
    root: capacityRoot, residentId: 'revision11-resident', pollMs: 10,
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 0 }),
  });
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], supervisedProcesses: () => pool },
    hostCapacity,
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: { repoRoot: repo, publishRemote },
  });
  t.after(() => {
    runtime.close();
    pool.killAll();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane', idempotencyKey: 'r11:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `r11:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({ sha: tip, observedHead, rebasedOnto: targetHead }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integration = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'r11:integrate', ...args,
  }, principal);
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));
  return {
    repo, integration, selected, targetHead,
    failureRows: () => driverRows('swarm.integration_failed'),
    /** Every gate-run invocation this landing spawned, in order. */
    runs: () => (existsSync(recordPath)
      ? readFileSync(recordPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : []),
  };
}

/** The refusal a landing answers with, or null when it landed. */
const refusalOf = (landing) => landing.then(() => null, (thrown) => thrown);
const unaccountedRowsOf = (detail) => (Array.isArray(detail?.unexpected) ? detail.unexpected : [])
  .filter((row) => row?.row === 'selected-file-unaccounted');

// ── property 1: the failure identity is the file, the test, the kind and the code ────────────────

test('r11a: a change failure whose kind differs from the target failure of the same file and test blocks',
  needsGit, async (t) => {
    // One file, one test name, failing on both trees — but with a different failure kind (a test
    // node's timeout against a plain assertion failure). Two runs of one file and test whose kinds
    // differ are different failures, so the change's failure matches nothing on the target.
    const w = await world(t, {
      script: (files) => ({
        change: failed(files[0], 'shared test', 'testTimeoutFailure', files),
        target: failed(files[0], 'shared test', 'testCodeFailure', files),
      }),
    });

    const error = await refusalOf(w.integration({ dryRun: true }));

    assert.ok(error, 'the landing refuses');
    assert.equal(error.code, 'integrate_gates_red');
    assert.equal(error.detail.unexpected.length, 1, 'the one failure the target does not share');
    assert.match(error.detail.verdictLine ?? '', /1 failing only with the change, 0 failing on the target too/u);
  });

test('r11b: the same failure on both trees — same file, test, kind and code — does not block',
  needsGit, async (t) => {
    const w = await world(t, {
      script: (files) => ({
        change: failed(files[0], 'shared test', 'testCodeFailure', files),
        target: failed(files[0], 'shared test', 'testCodeFailure', files),
      }),
    });

    await w.integration();

    assert.equal(w.failureRows().length, 0, 'no landing failure is recorded');
    assert.notEqual(git(w.repo, 'rev-parse', 'master'), w.targetHead, 'the target moved: the change landed');
  });

// ── property 2: an unjudged target is reported as unjudged and matches nothing ───────────────────

test('r11c: an unjudged target is named as unjudged and supplies no matching failure', needsGit, async (t) => {
  const w = await world(t, {
    script: (files) => ({
      change: failed(files[0], 'shared test', 'testCodeFailure', files),
      target: unjudged,
    }),
  });

  const error = await refusalOf(w.integration({ dryRun: true }));

  assert.ok(error, 'the landing refuses: nothing on the target could match the change failure');
  assert.equal(error.code, 'integrate_gates_red');
  assert.match(error.detail.verdictLine ?? '', /the target run did not judge, so every failure blocks/u);
  assert.equal(error.detail.unexpected.length, 1);
});

test('r11c2: a target run that judged none of the compared files says so', needsGit, async (t) => {
  // The target run wrote a document, but it accounts for none of the files it was handed: those
  // files were not judged, so the target supplies no matching failure and the refusal names how many
  // of the compared files that was.
  const w = await world(t, {
    script: (files) => ({
      change: failed(files[0], 'shared test', 'testCodeFailure', files),
      target: { write: { schemaVersion: 2, green: true, passed: 0, failures: [], unexpected: [] }, reported: [] },
    }),
  });

  const error = await refusalOf(w.integration({ dryRun: true }));

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  assert.match(error.detail.verdictLine ?? '',
    /the target run did not judge 1 of the 1 file\(s\) compared, so their failures block/u);
  assert.equal(error.detail.unexpected.length, 1);
});

// ── property 3: an unjudged change cannot authorize a landing ────────────────────────────────────

test('r11d: a change run that judged nothing cannot authorize a landing', needsGit, async (t) => {
  const w = await world(t, {
    script: () => ({ change: unjudged, target: unjudged }),
  });

  const error = await refusalOf(w.integration({ dryRun: true }));

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  assert.equal(error.detail.unexpected.length, 1);
  assert.equal(error.detail.unexpected[0].row, 'suite-did-not-judge');
  assert.equal(error.detail.unexpected[0].exitStatus, 1, 'the run the gate started is named with its status');
});

test('r11d2: a green change run that accounted for none of the selection cannot authorize a landing',
  needsGit, async (t) => {
    // The run exited 0 and wrote a green document, but its report names no file: nothing was
    // judged, so the run cannot authorize anything.
    const w = await world(t, { script: () => ({ change: green([]), target: green([]) }) });

    const error = await refusalOf(w.integration({ dryRun: true }));

    assert.ok(error, 'the landing refuses');
    assert.equal(error.code, 'integrate_gates_red');
    assert.deepEqual(unaccountedRowsOf(error.detail).map((row) => row.file), w.selected,
      'every selected file is named as unaccounted for');
  });

// ── property 4: every selected file is accounted for ─────────────────────────────────────────────

test('r11e: a selected file the change run reported no row for is named and blocks', needsGit, async (t) => {
  // The run judges every selected file but one and reports a green verdict for what it ran. The
  // unreported file never ran, so the run did not judge the selection the gate handed it.
  const w = await world(t, {
    script: (files) => ({
      change: green(files.slice(0, -1)),
      target: green(files.slice(0, -1)),
    }),
  });

  const error = await refusalOf(w.integration({ dryRun: true }));

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  const unaccounted = unaccountedRowsOf(error.detail);
  assert.deepEqual(unaccounted.map((row) => row.file), [w.selected.at(-1)],
    'the one selected file the run never reported is named');
  assert.match(error.detail.verdictLine ?? '', /1 selected file\(s\) the run did not account for/u);
});

// ── property 5: the judged selection is the gate's own derived set ───────────────────────────────

test('r11f: the run\'s own report cannot redefine the selection the gate judges', needsGit, async (t) => {
  // The run reports one selected file and one file the gate never selected. The judged selection
  // stays the set the gate derived from the changed paths, so every selected file the report omits
  // blocks, and the file the report invented is not part of the selection.
  const foreign = 'test/foreign-never-selected.test.mjs';
  const w = await world(t, {
    script: (files) => ({
      change: green([foreign, files[0]]),
      target: green([foreign, files[0]]),
    }),
  });
  assert.ok(w.selected.length > 1, 'the fixture change selects more than one gate file');

  const error = await refusalOf(w.integration({ dryRun: true }));

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  const unaccounted = unaccountedRowsOf(error.detail);
  assert.deepEqual(unaccounted.map((row) => row.file), w.selected.slice(1).sort(),
    'every selected file the report omits blocks');
  assert.equal(unaccounted.some((row) => row.file === foreign), false,
    'a file outside the selection is not judged as one of it');
  assert.deepEqual(error.detail.selection?.files, w.selected,
    'and the refusal carries the selection the gate derived from the changed paths');
});

// ── property 6: the judged verdict is the run the gate started ───────────────────────────────────

test('r11g: a verdict document the caller names cannot authorize a landing', needsGit, async (t) => {
  // The caller has a verdict path of its own (the ambient BATON_SUITE_VERDICT_FILE) and a green
  // document sitting at it. The gate reads the verdict of the run IT started, at the path IT
  // minted for that run, so the caller's document authorizes nothing.
  const w = await world(t, { script: () => ({ change: unjudged, target: unjudged }) });
  const callerDirectory = mkdtempSync(join(tmpdir(), 'baton-revision11-caller-'));
  const callerVerdict = join(callerDirectory, 'verdict.json');
  writeFileSync(callerVerdict, `${JSON.stringify({ schemaVersion: 2, green: true, passed: 99, failures: [], unexpected: [] })}\n`);
  const ambient = process.env.BATON_SUITE_VERDICT_FILE;
  process.env.BATON_SUITE_VERDICT_FILE = callerVerdict;
  t.after(() => {
    if (ambient === undefined) delete process.env.BATON_SUITE_VERDICT_FILE;
    else process.env.BATON_SUITE_VERDICT_FILE = ambient;
    rmSync(callerDirectory, { recursive: true, force: true });
  });

  const error = await refusalOf(w.integration({ dryRun: true }));

  assert.ok(error, 'the landing refuses: this run judged nothing');
  assert.equal(error.code, 'integrate_gates_red');
  const runs = w.runs();
  assert.equal(runs.length, 1, 'exactly one gate run was started');
  assert.notEqual(runs[0].verdict, callerVerdict, 'the caller\'s path is not the verdict path of this run');
  assert.equal(runs[0].verdict.includes('baton-integrate-'), true,
    'the run wrote its verdict into the scratch path the gate minted for it');
  assert.deepEqual(runs[0].names, w.selected, 'and the run was handed the selection the gate derived');
  assert.equal(w.failureRows().length, 1, 'the unjudged run is the recorded landing failure');
});
