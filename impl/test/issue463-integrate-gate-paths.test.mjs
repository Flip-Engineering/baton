// Issue #463 — `swarm.integrate`'s derived gate set never reached the runner as PATHS. The gate
// set is derived as test-file BASENAMES (`impl/src/landing-table.mjs`), the child was spawned with
// the SCRATCH CHECKOUT ROOT as its working directory (`runSupervisedGateRun` in
// `impl/src/coordinator.mjs`), and the runner resolved a positional name against its own
// `process.cwd()`. Every name therefore became `<scratch>/<file>` — a path that does not exist in
// this repository's layout, where the tests live at `impl/test/<file>` and the runner is run from
// `impl` (its suite root). `node --test` on each answered "exited 1 without reporting" (the
// 2026-09-18 live run: `passed 0, unexpected 192`, every row one of those, `verdictLine` the only
// other fact the refusal carried), and the caller could not tell "192 files were SELECTED for a
// change" from "192 files ran red": the refusal carried no selection, no runner stderr tail (#451's
// derivation existed but was never wired onto the red path) and no regenerated artifacts.
//
// WHAT THE LIVE 192 WAS. Not a fall-back. `swarm.integrate` squashes the range
// `merge-base(target, tip)..tip`, and the resident's target (`master`, c82cadce) did not yet carry
// the work the seat's base (a684b8fe) did, so the live squash (efd2e0a4) carried 46 files — the
// already-landed #443/#446/#452…#459 work — and THIS repository's landing table derives exactly
// those 192 gate files from them (regions application, coordination, custody, swarm). The
// derivation was right for the change it was given; the shape the names reached the runner in was
// wrong, which is why every one of the 192 "exited 1 without reporting". The fall-back that DOES
// exist is the empty one, pinned by (b) below: with no gate files derived, no positional arguments
// reach the runner — and "no file arguments" is how the whole suite gets selected.
//
// FIVE facts are pinned here, on a fixture with THIS repository's layout (`impl/test/<file>`, the
// runner at `impl/scripts/run-suite.mjs`, the three tracked regenerators):
//
//   (a) the derived gate set reaches the runner as `<tests>/<file>` names with the SUITE ROOT as
//       the child's working directory, every name resolving to a real file, and the dry run lands
//       naming the selection it ran (the target unmoved). The set is derived from
//       `selectFromRepository` in `impl/src/verification-selection.mjs`;
//   (b) a change that touches no gate file RUNS NO GATE and the receipt says
//       `skipped: 'no_affected_tests'` (the #300 / docs-42 §6 vocabulary) instead of silently
//       widening an empty derivation into the whole suite;
//   (c) a red gate's refusal — and the durable `swarm.integration_failed` row behind it — carries
//       the selection (`{files, reason, provenance}`), the runner's bounded stderr tail and the
//       regenerated artifacts;
//   (d) the runner itself takes suite-root-relative names from ANY working directory: the caller's
//       `cwd` was never part of its contract, and reading names against it is what turned a caller's
//       wrong root into 192 silent rows;
//   (e) the operator reading the refusal sees the step that spoke and its words under the refusal
//       line (#451's rendering, which reads exactly `detail.{stderrTail, script, exit}`).
//
// Red-before (observed against a clean `git worktree add … a684b8fe` baseline of this same file,
// before any implementation: FIVE of five rows red). (a) refuses `integrate_gates_red`
// "1 unexpected row(s)" — the fixture's runner says the derived names are not under the checkout
// root it was run in, instead of judging anything; (b) also refuses a red gate for a change that
// selects NOTHING, because the empty derivation reaches the runner as no names at all and the
// whole-suite stand-in runs; (c) refuses with only `verdictLine`/`unexpected` — `verdictLine` is
// not even set on that path, and no `selection`, `stderrTail` or `regenerated` row exists; (d)
// `node --test` judges nothing, because the named file is resolved against the caller's working
// directory; (e) the refusal the CLI prints is one bare line — "Landing did not complete: the
// derived gate set ran red: 1 unexpected row(s)" — with nothing under it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SupervisedProcesses } from '../src/coordinator.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { selectFromRepository } from '../src/verification-selection.mjs';

const IMPL = join(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');
const principal = { actor: 'direct:issue463-root', principalId: 'issue463-root', sessionId: 'issue463-root' };
const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (repo, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

// The two scripts a landing regenerates with (`INTEGRATION_REGENERATORS`), TRACKED on the base
// commit: the landing checks them out and runs them for real. The seam inventory is not one of
// them (E02 of the #598 audit): the committed artifact is deleted and the landing table derives
// the map live from the collector.
const REGENERATORS = Object.freeze([
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);

/** A regenerator that writes the artifact its own name implies — the files a landing's
 * `regenerated` row is read back from. */
function regeneratorSource(artifact) {
  return "import { mkdirSync, writeFileSync } from 'node:fs';\n"
    + "mkdirSync(new URL('../data/', import.meta.url), { recursive: true });\n"
    + `writeFileSync(new URL('../data/${artifact}', import.meta.url), 'ok\\n');\n`;
}

/** The artifacts the three regenerators above write, as the receipt's `regenerated` reads them. */
const REGENERATED = Object.freeze(REGENERATORS.map((script) => (
  `impl/data/${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`
)).sort());

const RED_ROW = 'test/red-gate.test.mjs :: 463c: the derived gate set ran red';
const RED_TAIL = 'issue463 fixture runner: the derived gate set ran red';

/**
 * The runner this fixture installs AT `impl/scripts/run-suite.mjs` — the seam a deployment's gate
 * run uses. It records the working directory and the names it was handed (the two facts #463 says
 * were wrong), REFUSES to judge when a named file is not under its working directory (the exact
 * live failure, said out loud instead of `exited 1 without reporting`), and otherwise writes the
 * verdict document the landing judges: green, or red with the row the red row below asserts. No
 * names at all is the whole suite — the stand-in for an empty derivation reaching the runner, which
 * the row below refuses to let the landing do.
 */
function runnerSource({ mode, recordPath }) {
  const lines = [
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const names = process.argv.slice(2);',
    `writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ cwd: process.cwd(), names }) + '\\n');`,
    'const missing = names.filter((name) => !existsSync(join(process.cwd(), name)));',
    'if (missing.length > 0) {',
    "  process.stderr.write(`issue463 fixture runner: ${missing.length} of ${names.length} named"
      + " file(s) are not under ${process.cwd()}: ${missing.slice(0, 3).join(', ')}\\n`);",
    '  process.exit(1);',
    '}',
    'const verdict = process.env.BATON_SUITE_VERDICT_FILE;',
    'if (names.length === 0) {',
    "  writeFileSync(verdict, JSON.stringify({ green: false, passed: 0, expectedRed: 0,"
      + " unexpected: ['(no file names — the whole suite ran)'] }));",
    '  process.exit(1);',
    '}',
  ];
  if (mode === 'red-shared' || mode === 'red-change-only') {
    // Issue #580: the runner fails the first named test file. 'red-shared' fails it on every tree,
    // so the target fails it too; 'red-change-only' fails it only where the lane's change is
    // present (src/coordinator.mjs carries 'lane = 2' on the lane and 'lane = 1' on the target).
    lines.push("const { readFileSync } = await import('node:fs');");
    lines.push("const laneChange = (() => { try { return readFileSync(join(process.cwd(), 'src/coordinator.mjs'), 'utf8').includes('lane = 2'); } catch { return false; } })();");
    lines.push(`const failing = ${JSON.stringify(mode)} === 'red-shared' || laneChange;`);
    lines.push("const key = `${names[0]} :: 580 fixture test`;");
    lines.push("const failures = failing ? [{ key, file: names[0], name: '580 fixture test', failureType: 'testCodeFailure' }] : [];");
    lines.push("writeFileSync(verdict, JSON.stringify({ schemaVersion: 2, green: !failing, passed: names.length - failures.length, failures, unexpected: failures.map((row) => row.key) }));");
    lines.push('process.exit(failing ? 1 : 0);');
  } else if (mode === 'red-flake') {
    // Issue #593: the row is reported only by this checkout's FIRST gate run. The counter file
    // lives in the checkout (the landing switches trees inside it but never clears it), so the
    // base run and the confirmation pass both see a row that does not reproduce.
    lines.push("const counter = join(process.cwd(), '.gate-runs');");
    lines.push('const first = !existsSync(counter);');
    lines.push("writeFileSync(counter, 'ran\\n');");
    lines.push('const key = `${names[0]} :: 593 fixture flake`;');
    lines.push("const failures = first ? [{ key, file: names[0], name: '593 fixture flake', failureType: 'testCodeFailure' }] : [];");
    lines.push('writeFileSync(verdict, JSON.stringify({ schemaVersion: 2, green: !first,'
      + ' passed: names.length - failures.length, failures, unexpected: failures.map((row) => row.key) }));');
    lines.push('process.exit(first ? 1 : 0);');
  } else if (mode === 'red') {
    lines.push(`process.stderr.write(${JSON.stringify(`${RED_TAIL}\n`)});`);
    lines.push('writeFileSync(verdict, JSON.stringify({ green: false, passed: 0, expectedRed: 0,'
      + ` unexpected: [${JSON.stringify(RED_ROW)}] }));`);
    lines.push('process.exit(1);');
  } else {
    lines.push('writeFileSync(verdict, JSON.stringify({ green: true, passed: names.length,'
      + ' expectedRed: 0, unexpected: [] }));');
  }
  return lines.join('\n');
}

const contractBody = ({ subject, sha, observedHead, rebasedOnto, files }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'gate-paths', status: 'delivered',
    change: 'Deliver the derived gate set at the layout the runner takes', files,
    test: 'node --test test/issue463-integrate-gate-paths.test.mjs', evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * A real repository with the REAL layout: the tests at `impl/test/<file>`, the runner at
 * `impl/scripts/run-suite.mjs`, the three tracked regenerators and a sub-directory install (#451).
 * The lane commit moves exactly ONE file — `change` — and the fixture materializes the gate files
 * THIS repository's landing table derives for it, read off the table itself so no selection is
 * spelled by hand here. The runtime is wired the way a resident wires one: the deployment names the
 * repository alone, so the DEFAULT regenerators, the DEFAULT supervised gate run and the
 * deployment's own pool are what the rows below measure.
 */
async function world(t, { change = 'impl/src/coordinator.mjs', gate = {} } = {}) {
  const { mode = 'green' } = gate;
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue463-'));
  const repo = join(directory, 'repo');
  const recordPath = join(directory, 'gate-run.json');
  // The host lease namespace this landing admits through: a directory of its own, so no row here
  // ever queues in the machine's shared verdict namespace.
  const capacityRoot = join(directory, 'host-capacity');
  const hostedEnv = { root: process.env.BATON_HOST_CAPACITY_ROOT, wait: process.env.BATON_HOST_CAPACITY_WAIT_MS };
  process.env.BATON_HOST_CAPACITY_ROOT = capacityRoot;
  process.env.BATON_HOST_CAPACITY_WAIT_MS = '300';
  t.after(() => {
    for (const [key, value] of [['BATON_HOST_CAPACITY_ROOT', hostedEnv.root],
      ['BATON_HOST_CAPACITY_WAIT_MS', hostedEnv.wait]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 463', GIT_COMMITTER_NAME: 'Issue 463' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue463@example.invalid', GIT_COMMITTER_EMAIL: 'issue463@example.invalid' });
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATORS) {
    write(repo, script, regeneratorSource(`${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`));
  }
  write(repo, 'impl/scripts/run-suite.mjs', runnerSource({ mode, recordPath }));
  write(repo, 'impl/package.json', '{"name":"fixture-app","private":true}\n');
  write(repo, 'impl/node_modules/fixture-dep/package.json',
    '{"name":"fixture-dep","version":"1.0.0","type":"module","exports":"./index.js"}\n');
  write(repo, 'impl/node_modules/fixture-dep/index.js', 'export const fixtureMarker = "installed";\n');
  // A test file that imports the changed module, so selectFromRepository selects it through the
  // import graph. For a prose/markdown change, no test file is created and selectFromRepository
  // returns nothing — the correct derivation for test 463b.
  if (change.startsWith('impl/src/') && change.endsWith('.mjs')) {
    const moduleName = change.split('/').pop();
    write(repo, `impl/test/fixture-${moduleName.replace('.mjs', '.test.mjs')}`,
      `import '../src/${moduleName}';\n`);
  }
  write(repo, change, change.endsWith('.md') ? 'the lane writes prose\n' : 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');
  // The gate set is derived from selectFromRepository: the import-graph selector that reads the
  // tree under test and selects every test file that imports or names the changed path.
  const expected = selectFromRepository({ root: repo, changedPaths: [change] })
    .files.map((f) => f.replace(/^impl\/test\//, ''));

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, change, change.endsWith('.md') ? 'the lane writes prose, once more\n' : 'export const lane = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `lane work: ${change}`);
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  // Issue #558: the deployment's declared shared remote — a bare repository this landing
  // publishes the landed ref to after the fast-forward.
  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const store = new CoordinationStore(join(directory, 'ledger'));
  const pool = new SupervisedProcesses();
  const G = 1024 ** 3;
  const hostCapacity = new HostCapacityAuthority({
    root: capacityRoot, residentId: 'issue463-resident', pollMs: 10,
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

  // Neither the purpose nor the contract names an issue number: the landing then derives the gate
  // set from the changed paths alone, which is the derivation these rows assert against.
  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane', idempotencyKey: 'i463:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i463:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'The derived gate set reaches the runner, at the layout the runner takes', sha: tip,
      observedHead, rebasedOnto: targetHead, files: [change],
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integration = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i463:integrate', ...args,
  }, principal);
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));
  return {
    directory, repo, store, runtime, pool, integration, recordPath, expected, change,
    integrateDriverRows: () => driverRows('swarm.integration_started'),
    failureRows: () => driverRows('swarm.integration_failed'),
    /** What the gate runner was handed: `{cwd, names}` — null when no gate run was ever spawned. */
    recorded: () => (existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null),
  };
}

// ── (a) the derived gate set reaches the runner as suite-root-relative paths ─────────────────────

test('463a: the derived gate set reaches the runner as test/<file> under the suite root, and the dry run lands', needsGit, async (t) => {
  const w = await world(t, { change: 'impl/src/coordinator.mjs' });
  assert.ok(w.expected.length > 0, 'the fixture change is one the landing table classifies');
  const expectedNames = w.expected.map((name) => `test/${name}`);
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const answer = await w.integration({ dryRun: true });

  const started = w.integrateDriverRows()[0];
  assert.ok(started, 'the landing opened its scratch checkout');
  assert.equal(started.scratch.includes('.baton/wt/integrate-'), true, 'the start row names the scratch checkout');
  assert.equal(existsSync(started.scratch), false, 'and that checkout is gone when the landing settles');

  const run = w.recorded();
  assert.ok(run, 'the gate runner was spawned');
  // The scratch checkout is gone by now, so the comparison goes through the directory that
  // survived it — the same real path the child's own `process.cwd()` reports.
  const scratch = join(realpathSync(dirname(started.scratch)), basename(started.scratch));
  assert.equal(run.cwd, join(scratch, 'impl'),
    'the child ran in the SUITE ROOT — the directory the runner resolves its own names against');
  assert.deepEqual(run.names, expectedNames,
    'the names handed to the runner are <tests>/<file> relative to the suite root, never bare basenames');
  assert.deepEqual(answer.integration.gates.files, expectedNames,
    'the receipt names the gate set exactly as the runner took it');
  assert.deepEqual(answer.integration.gates.selection.files, expectedNames,
    'and carries the same selection with it');
  assert.match(answer.integration.gates.selection.reason,
    new RegExp(`^${answer.integration.changedPaths.length} changed path\\(s\\) select`
      + ` ${expectedNames.length} test file\\(s\\)`, 'u'),
    'the selection account names the change it derived from, not the rows the runner judged');
  assert.equal(answer.integration.gates.selection.provenance.length, expectedNames.length,
    'every gate file carries why it is in the set');
  assert.deepEqual(
    answer.integration.gates.selection.provenance.map((row) => row.path).sort(),
    [...expectedNames].sort(),
    'the provenance names exactly the gate files that ran');
  for (const row of answer.integration.gates.selection.provenance) {
    assert.ok(typeof row.reason === 'string' && row.reason.length > 0, 'each row names a reason');
    assert.equal(row.via, 'impl/src/coordinator.mjs', 'and the changed path that selected it');
  }
  assert.equal(answer.integration.dryRun, true);
  assert.equal(answer.integration.targetHeadAfter, null, 'a dry run leaves the target alone');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'master did not move');
});

// ── (b) a change that touches no gate file runs nothing, and says so ─────────────────────────────

test('463b: a change that touches no gate file runs no gate and the receipt says no_affected_tests', needsGit, async (t) => {
  const w = await world(t, { change: 'NOTES-463.md' });
  assert.deepEqual(w.expected, [], 'a root markdown change selects no gate file');

  const headBefore = git(w.repo, 'rev-parse', 'master');
  const answer = await w.integration({ dryRun: true });

  assert.equal(w.recorded(), null,
    'no gate runner was spawned: an empty derivation is not "no file arguments", so the whole suite never runs');
  assert.deepEqual(answer.integration.gates.files, [], 'the receipt lands no gate files');
  assert.equal(answer.integration.gates.skipped, 'no_affected_tests',
    'and names the closed reason docs/42 §6 uses for exactly this');
  assert.equal(answer.integration.gates.verdictLine, 'skipped — no_affected_tests',
    'the verdict line says the gate set was skipped, never that it ran');
  assert.match(answer.landingComment, /no_affected_tests/u,
    'the landing comment the target\'s history would keep says so too');
  assert.equal(answer.integration.dryRun, true);
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'master did not move');
});

// ── (c) a red gate's refusal names the selection, the tail and the regenerated artifacts ─────────

test('463c: a red gate refuses naming the selection, the runner tail and the regenerated artifacts', needsGit, async (t) => {
  const w = await world(t, { change: 'impl/src/coordinator.mjs', gate: { mode: 'red' } });
  const expectedNames = w.expected.map((name) => `test/${name}`);

  const error = await w.integration({ dryRun: true }).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  const detail = error.detail;
  assert.match(detail.verdictLine ?? '', /^red — passed 0, 1 failing only with the change/u,
    'the verdict line is still the verdict line');
  assert.deepEqual(detail.unexpected, [RED_ROW], 'and the rows the runner judged are still the rows');
  assert.ok(detail.selection, 'the refusal carries the selection those rows came from');
  assert.deepEqual(detail.selection.files, expectedNames, 'which is the gate set the runner ran');
  assert.match(detail.selection.reason, /changed path\(s\) select/u, 'with the account a caller reads');
  assert.equal(detail.selection.provenance.length, expectedNames.length,
    'and a per-file cause for every gate file');
  assert.match(detail.stderrTail ?? '', new RegExp(RED_TAIL, 'u'),
    "the runner's own words ride the refusal (#451's bounded, redacted tail — on the red path)");
  assert.equal(detail.script, 'impl/scripts/run-suite.mjs', 'named with the step that spoke');
  assert.equal(detail.exit, 1, 'and the exit status it spoke with');
  assert.deepEqual(detail.regenerated, REGENERATED, 'and the artifacts the landing regenerated');

  const row = w.failureRows().at(-1);
  assert.ok(row, 'the durable row a caller who is gone reads back');
  assert.equal(row.code, 'integrate_gates_red');
  assert.deepEqual(row.detail.selection, detail.selection, 'carries the same selection the refusal names');
  assert.equal(row.detail.stderrTail, detail.stderrTail, 'the same tail');
  assert.deepEqual(row.detail.regenerated, detail.regenerated, 'and the same regenerated artifacts');
});

// ── (d) the runner takes suite-root-relative names from any working directory ────────────────────

test('463d: the runner takes suite-root-relative names from any working directory', needsGit, async (t) => {
  const away = mkdtempSync(join(tmpdir(), 'baton-issue463-away-'));
  t.after(() => rmSync(away, { recursive: true, force: true }));
  const verdictPath = join(away, 'verdict.json');
  const env = {
    ...process.env,
    BATON_SUITE_VERDICT_FILE: verdictPath,
    BATON_TEST_TMP_PARENT: away,
    // The host lease is not what this row measures, and the machine's verdict namespace is shared.
    BATON_HOST_CAPACITY_DISABLED: '1',
  };
  delete env.NODE_TEST_CONTEXT;

  const outcome = spawnSync(process.execPath, [RUNNER, 'test/suite-verdict.test.mjs'], {
    // NOT the suite root: #463's child ran with the scratch checkout root as its working directory,
    // and the name was read against it. The runner's names are its own suite's, whatever the caller's
    // cwd — a name is resolved from the suite root the runner itself lives in.
    cwd: away,
    env, encoding: 'utf8', timeout: 120_000,
  });

  assert.equal(outcome.status, 0,
    `the named suite file ran from an unrelated working directory: ${outcome.stderr?.slice(-2000)}`);
  const document = JSON.parse(readFileSync(verdictPath, 'utf8'));
  assert.deepEqual(document.coverage, {
    kind: 'subset', files: 1,
    canonical: readdirSync(join(IMPL, 'test')).filter((name) => name.endsWith('.test.mjs')).length,
  }, 'exactly one file ran — the named one, resolved against the suite root');
});

// ── (e) what the operator reads: the refusal line, and the runner's words under it ───────────────

test('463e: the refusal the operator reads names the selection and the runner\'s own words', needsGit, async (t) => {
  const w = await world(t, { change: 'impl/src/coordinator.mjs', gate: { mode: 'red' } });
  const client = { command: (name, args, key) => w.runtime.command(name, args, principal, null, key) };
  const parsed = parseBatonCli(['--idempotency-key', 'i463:cli', 'swarm', 'integrate', 's1',
    'contribution:1', '--onto', 'master']);

  const printed = await runBatonCli(parsed, client).then(() => null, (thrown) => thrown);

  assert.equal(printed.code, 'integrate_gates_red', 'with the code the landing stopped under');
  // #451's rendering, which reads exactly `detail.{stderrTail, script, exit}`: the step that spoke
  // and the words it spoke, under the refusal line — the reason #463 says a red gate is unreadable
  // without them. The selection rides the same detail the client unwraps.
  assert.match(printed.message, /impl\/scripts\/run-suite\.mjs exited 1/u,
    'the failing step is named under the refusal line');
  assert.match(printed.message, new RegExp(RED_TAIL, 'u'), "with the runner's own last words");
  assert.deepEqual(printed.detail?.selection?.files, w.expected.map((name) => `test/${name}`),
    'and the refusal the CLI read carries the selection, not only its rows');
});

// ── #580: the gate compares the change with its target ──────────────────────────────────────────

test('580a: a test that fails on the target too does not block, and the landing lands naming it', needsGit, async (t) => {
  const w = await world(t, { change: 'impl/src/coordinator.mjs', gate: { mode: 'red-shared' } });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  await w.integration();

  assert.equal(w.failureRows().length, 0, 'no landing failure is recorded');
  assert.notEqual(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target moved: the change landed');
  const landed = w.store.eventsView().filter((event) => event.kind === 'swarm.contribution_integrated' || event.payload?.kind === 'swarm.contribution_integrated').at(-1);
  assert.ok(landed, 'the landing recorded its integration');
});

test('580b: a test that passes on the target and fails with the change blocks, naming it', needsGit, async (t) => {
  const w = await world(t, { change: 'impl/src/coordinator.mjs', gate: { mode: 'red-change-only' } });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integration().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  assert.equal(error.detail.unexpected.length, 1, 'exactly the one test the change broke');
  assert.match(String(error.detail.unexpected[0]), / :: 580 fixture test$/u);
  assert.match(error.detail.verdictLine ?? '', /1 failing only with the change, 0 failing on the target too/u);
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'a red gate never moves the target');
});

test('593i: a blocking row the change run does not reproduce does not block the landing, and is named', needsGit, async (t) => {
  const w = await world(t, { change: 'impl/src/coordinator.mjs', gate: { mode: 'red-flake' } });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const answer = await w.integration();

  assert.equal(w.failureRows().length, 0, 'no landing failure is recorded: the row did not reproduce');
  assert.notEqual(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target moved: the change landed');
  assert.match(answer.integration.gates.verdictLine ?? '', /green — .*1 not reproduced/u,
    'the verdict line names the row that did not reproduce');
  assert.deepEqual(answer.integration.gates.unconfirmed, [`test/${w.expected[0]} :: 593 fixture flake`],
    'and the receipt carries the row itself');
  assert.deepEqual(w.recorded().names, [`test/${w.expected[0]}`],
    'the confirmation pass re-ran exactly the blocking file');
});
