// Issue #466 — the landing's gate set IS the runner's selection, and its `issue` is the
// contribution's own. The 2026-09-18 live landing (the first real one through `swarm integrate`)
// shipped a module and its new test, and the receipt named ONE gate file — the region's issue row,
// derived from the changed path's own `463` — while the contribution's OWN test never ran. The
// landing derived its set from a table that reads the RESIDENT's test directory (`landing-table.mjs`
// lists `impl/test/` beside itself), so a test file the lane had just added was invisible to it;
// the runner's own selection (`impl/src/verification-selection.mjs`, the ONE selector docs/42 §6
// names) reads the tree under test and selects every changed test file itself. The same landing
// also attributed `issue: 443` — the swarm's purpose — to a contribution whose seat carried no
// context package at all.
//
// WHAT IS PINNED HERE, on a fixture with THIS repository's layout (`impl/src`, `impl/test`):
//
//   (a) a contribution that adds a module and a test runs the TEST ITSELF as a gate (`test/<file>`,
//       provenance reason `changed` — the runner's own spelling for "this changed test file selects
//       itself"), beside the region gates the landing table declares;
//   (b) a seat recruited WITHOUT a context package lands with `issue: null`, and the landing comment
//       names no issue and carries no `gh issue close` guidance; a seat whose admitted package
//       carries `issue:<n>` lands with that number, on the receipt AND on the durable
//       `swarm.contribution_integrated` row AND in the comment's close guidance — never the swarm's
//       purpose, which the fixtures deliberately point at OTHER issue numbers;
//   (c) for the same changed paths, the landing's selection EQUALS
//       `selectFromRepository` (the function `node impl/scripts/run-suite.mjs --changed` calls)
//       UNIONED with `gateSetForPaths` — through those two shared functions, so a second
//       derivation anywhere in the landing fails this row.
//
// Red-before (observed on this file against the HEAD of the lane's base, before any implementation:
// (a) red — the probe test is absent from `gates.files` and the gate runner is handed the region
// gates alone; (b) red — the no-package seat's receipt reads `issue: 443` (the purpose), and the
// package seat's receipt reads the purpose's number instead of its package's; (c) red — the union
// carries `test/issue466-probe.test.mjs` and the landing's set does not).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';
import { gateSetForPaths } from '../src/landing-table.mjs';
import { selectFromRepository } from '../src/verification-selection.mjs';

const principal = { actor: 'direct:issue466-root', principalId: 'issue466-root', sessionId: 'issue466-root' };
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

// The lane's delta: the new module, and the new test that imports it — byte-for-byte the shape the
// 2026-09-18 live landing carried (`impl/src/probe-463.mjs` + `impl/test/issue463-probe-landing…`).
const PROBE_MODULE = 'impl/src/probe-466.mjs';
const PROBE_TEST = 'impl/test/issue466-probe.test.mjs';
const LANE_CHANGED = Object.freeze([PROBE_MODULE, PROBE_TEST].sort());

/** One gate file as the runner takes it: `<tests>/<file>` relative to the suite root the runner
 * runs from (`gateRunnerFile` in coordinator.mjs, read off `impl/scripts/run-suite.mjs`). */
const runnerName = (file) => `test/${basename(file)}`;

const contractBody = ({ subject, sha, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'probe-selection', status: 'delivered',
    change: 'Ship the probe module and its test',
    files: [PROBE_MODULE, PROBE_TEST],
    test: 'node --test test/issue466-landing-selection.test.mjs', evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

// ── the context package machinery (the issue441 fixture shape) ───────────────────────────────────

const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const digestOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** One branch whose content the resolver holds as a context SOURCE ref — the shape the root's
 * `--issue` admission writes (`application-cli.mjs`: `name: \`issue:${request.issue}\``). */
function sourceBranch(name, resolver, content) {
  const contentDigest = digestOf(content);
  const ref = `ctx:sha256:${contentDigest}`;
  resolver.sources.set(ref, content);
  return {
    name, artifact: null, valueRef: null, schema: null,
    source: { kind: 'context_source', ref, digest: contentDigest,
      mediaType: 'application/vnd.baton.context-value+json', itemCount: content.length },
  };
}

const packageFields = (branches) => ({
  schemaVersion: 1, kind: 'baton.context_package', branches,
  provenance: { runId: 'run-root', principalId: 'owner' },
  policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
});

/**
 * A real repository with the REAL layout: runtime source and tests under `impl/`, a lane branch
 * that adds ONE module and ONE test that imports it, and a seat bound to a durable run id.
 *
 * `packageIssue` decides the seat's context leg: null is a seat recruited WITHOUT a package (the
 * 2026-09-18 case); a number admits a package whose branch is `issue:<n>` and attaches it to the
 * seat's run. `purpose` is the swarm's own purpose — both fixtures point it at issue numbers the
 * contribution never carried, so an attribution read from the swarm cannot pass row (b) by luck.
 */
async function world(t, { purpose = 'land the lane (#443)', packageIssue = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue466-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 466');
  git(repo, 'config', 'user.email', 'issue466@example.invalid');
  write(repo, 'README.md', 'base\n');
  // The base tree's own source and tests: a test that imports a module, and one that only NAMES a
  // module in a fixture path. Neither is changed by the lane, so neither may be selected — the
  // negative control (c) asserts.
  write(repo, 'impl/src/alpha.mjs', 'export const alpha = 1;\n');
  write(repo, 'impl/test/alpha.test.mjs', "import { alpha } from '../src/alpha.mjs';\n\nexport const seen = alpha;\n");
  write(repo, 'impl/src/beta.mjs', 'export const beta = 1;\n');
  write(repo, 'impl/test/beta-fixture.test.mjs', "export const fixturePath = 'impl/src/beta.mjs';\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, PROBE_MODULE, 'export const probe = 2;\n');
  write(repo, PROBE_TEST, "import { probe } from '../src/probe-466.mjs';\n\nexport const covered = probe;\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work: the probe module and its test (#466)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  // Issue #558: the deployment's declared shared remote — a bare repository this landing
  // publishes the landed ref to after the fast-forward.
  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const resolver = { sources: new Map(), artifacts: new Map() };
  const store = new CoordinationStore(join(directory, 'ledger'), {
    repoId: 'repo-issue466', deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: '2'.repeat(64), contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => {
      const table = reference.kind === 'context_source' ? resolver.sources : resolver.artifacts;
      const key = reference.kind === 'context_source' ? reference.ref : reference.handle;
      if (!table.has(key)) {
        throw Object.assign(new Error('context package content is unavailable'),
          { code: 'context_artifact_unavailable' });
      }
      return table.get(key);
    },
    contextSourceAttest: () => { throw new Error('this fixture attests no context source'); },
    clock: () => '2026-09-18T00:00:00.000Z',
  });
  // What the landing's gate seam was handed, per attempt: `{dir, files, context}`.
  const gateCalls = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: {
      repoRoot: repo,
      publishRemote,
      // The deployment's regenerators are the fixture's no-op: `changed` stays exactly the lane's
      // delta, which is what the shared-function comparison in (c) is computed against.
      regenerate: async () => {},
      runGates: async (dir, files, context) => {
        gateCalls.push({ dir, files, context });
        return { files: [], verdictLine: `green — ${files.length} file(s)`, unexpected: [] };
      },
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose, idempotencyKey: 'i466:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i466:${key}` });
  const seatRun = 'run-issue466-seat';
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder', runId: seatRun }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'The landing runs the contribution\'s own test', sha: tip, observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');
  if (packageIssue !== null) {
    const admitted = store.admitContextPackage(packageFields([
      sourceBranch(`issue:${packageIssue}`, resolver,
        ['The landing selects its own work', '', `Issue ${packageIssue}.`]),
    ]), { actor: principal.actor, key: `i466:admit:${packageIssue}` });
    const digest = admitted.package.packageDigest;
    store.attachContextPackage({ packageDigest: digest, runId: seatRun, scope: 'worker:lane-a' },
      { actor: principal.actor, key: `package.attach:${digest}:${seatRun}:worker:lane-a` });
  }

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i466:integrate', ...args,
  }, principal);
  /** The runner's OWN selection for the landed change, read from a detached worktree at the lane
   * tip through the function `node impl/scripts/run-suite.mjs --changed` calls. */
  const runnerSelection = () => {
    const tree = join(directory, 'tip');
    git(repo, 'worktree', 'add', '-q', '--detach', tree, tip);
    return selectFromRepository({ root: tree, changedPaths: [...LANE_CHANGED] });
  };
  return {
    directory, repo, store, runtime, tip, targetHead, gateCalls, integrate, runnerSelection,
    receiptRow: () => store.swarm('s1').contributions['contribution:1'].integration,
    /** The region gates the landing table derives for the lane's change, in the runner's shape. */
    regionGates: () => gateSetForPaths([...LANE_CHANGED], { issues: [] }).files.map(runnerName),
  };
}

// ── (a) the contribution's own test runs as a gate ───────────────────────────────────────────────

test('466a: a lane that adds a module and a test runs the test itself beside the region gate', needsGit, async (t) => {
  const w = await world(t);
  const region = w.regionGates();

  const answer = await w.integrate({ dryRun: true });

  const files = answer.integration.gates.files;
  assert.ok(files.includes(runnerName(PROBE_TEST)),
    'the contribution\'s OWN new test is in the gate set the landing ran');
  assert.ok(w.gateCalls.length > 0, 'the gate runner was handed the derived set');
  assert.deepEqual(w.gateCalls.at(-1).files, files,
    'the set the runner took is the set the receipt names — no second derivation between them');
  for (const name of region) {
    assert.ok(files.includes(name), `the region gate ${name} ran beside it`);
  }
  const provenance = answer.integration.gates.selection.provenance;
  assert.deepEqual(provenance.map((row) => row.path), files, 'every gate file carries its cause');
  const probeRow = provenance.find((row) => row.path === runnerName(PROBE_TEST));
  assert.equal(probeRow.reason, 'changed',
    'a changed test file selects ITSELF under the runner\'s own reason vocabulary');
  assert.equal(probeRow.via, null, 'and needs no other file to say why');
  const moduleRow = provenance.find((row) => row.path === runnerName(PROBE_MODULE));
  assert.equal(moduleRow, undefined, 'the module is not a gate file — its TEST is');
  assert.match(answer.integration.gates.selection.reason, /changed test file/u,
    'the account names the changed test file among the causes');
});

// ── (b) the issue belongs to the contribution, never to the swarm or a region ────────────────────

test('466b: a seat without a package lands issue: null and a comment naming no issue', needsGit, async (t) => {
  const w = await world(t, { purpose: 'land the lane (#443)' });

  const answer = await w.integrate();

  assert.equal(answer.integration.issue, null,
    'a contribution whose seat carried no context package is attributed NO issue');
  assert.equal(w.receiptRow().issue, null, 'the durable receipt row says the same');
  assert.equal(w.receiptRow().issue === 443, false, 'never the swarm purpose\'s number');
  assert.doesNotMatch(answer.landingComment, /gh issue close/u,
    'the landing comment carries no close guidance for an issue nobody named');
  assert.doesNotMatch(answer.landingComment, /#\d+/u, 'and names no issue at all');
});

test('466b: a seat whose package names issue:466 lands that number, not the purpose\'s', needsGit, async (t) => {
  const w = await world(t, { purpose: 'land the lane (#443)', packageIssue: 466 });

  const answer = await w.integrate({ dryRun: true });

  assert.equal(answer.integration.issue, 466,
    'the issue the seat\'s admitted context package carries is the landing\'s attribution');
  assert.equal(w.receiptRow().issue, 466, 'the durable receipt row carries it too');
  assert.match(answer.landingComment, /#466/u, 'and the comment names it');
  assert.match(answer.landingComment, /gh issue close 466/u,
    'with the close guidance the comment is posted under');
  assert.doesNotMatch(answer.landingComment, /#443/u, 'never the purpose\'s number');
});

// ── (c) ONE derivation: the landing equals the runner's selection plus the region gates ──────────

test('466c: the landing\'s selection is the runner\'s selection unioned with the region gates', needsGit, async (t) => {
  const w = await world(t);
  const runner = w.runnerSelection();
  const region = w.regionGates();

  const answer = await w.integrate({ dryRun: true });

  assert.deepEqual(answer.integration.changedPaths, [...LANE_CHANGED],
    'the change the landing derived from is the lane\'s delta');
  assert.deepEqual(runner.files.map(runnerName), [runnerName(PROBE_TEST)],
    'the runner selects the changed test file itself');
  assert.ok(!runner.files.includes('impl/test/beta-fixture.test.mjs'),
    'and nothing the change does not touch — the fixture-path test stays out');
  const expected = [...new Set([...runner.files.map(runnerName), ...region])].sort();
  assert.deepEqual(answer.integration.gates.files, expected,
    'the landing\'s gate set IS the runner\'s selection plus the region gates');
  assert.deepEqual(answer.integration.gates.selection.files, expected,
    'the receipt\'s selection names the same set');
  const reasons = new Map(answer.integration.gates.selection.provenance
    .map((row) => [row.path, row.reason]));
  assert.equal(reasons.get(runnerName(PROBE_TEST)), 'changed', 'the runner\'s cause rides along');
  for (const name of region) {
    assert.equal(reasons.get(name), 'region', `${name} is attributed to the region table`);
  }
  assert.ok(!expected.includes(runnerName('impl/test/beta-fixture.test.mjs')),
    'an untouched base test is in neither half of the derivation');
});
