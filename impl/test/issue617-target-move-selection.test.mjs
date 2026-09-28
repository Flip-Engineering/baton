// Issue #617 — a landing whose target moved under its gate re-judges only the tests the moved
// commits can change.
//
// The 2026-09-27 window: seven landing gates ran at once, each 50-90 minutes, and one
// contribution's landing was refused twice because the target moved under the gate while it ran.
// #596 already re-bases the squash onto the head the target moved to and keeps the verdict the
// gate produced; what it could not do is judge the work the moved commits THEMSELVES added, so
// this row set pins the narrowed second call: the move's own paths go through the ONE selector
// (`selectFromRepository`), the result is intersected with the tests the first call judged, and
// anything left is judged once on the re-based squash before the second compare-and-swap.
//
// WHAT IS PINNED HERE, driving the production `SwarmRuntime.swarm.integrate` over the real
// `landContribution`, with a fixture `integration.runGates` that records `(dir, files, context)`
// and moves the target from inside its first call:
//
//   (a) an unrelated move — the moved commit carries a path no judged test imports — is handed
//       back as `reused`, the runner is invoked exactly once, the landing succeeds on the target's
//       new tip, the receipt names no re-judgment, and the landed tree carries both the lane's
//       change and the moved commit's file;
//   (b) an affected move — the base carries `impl/src/one.mjs` + `impl/test/one.test.mjs` and
//       `impl/src/two.mjs` + `impl/test/two.test.mjs`, the lane changes both modules, and the
//       moved commit changes `impl/src/two.mjs` alone — re-judges exactly the tests the moved
//       paths select among the judged ones, and the receipt names the file, the verdict line and
//       the commit that run judged;
//   (c) a red re-judgment refuses `integrate_gates_red` before the target moves, and the refusal
//       and the durable failure row name the re-judged file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';
import { selectFromRepository } from '../src/verification-selection.mjs';
import { gateRunnerFile, gateRunnerLayout } from '../src/coordinator.mjs';

const principal = { actor: 'direct:issue617-root', principalId: 'issue617-root', sessionId: 'issue617-root' };
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

/** The runner's own layout, read off the one runner path a deployment gates with, so the gate file
 * names this test expects ARE the names the runner takes (`<tests>/<file>` under the suite root). */
const GATE_LAYOUT = gateRunnerLayout('impl/scripts/run-suite.mjs');
const runnerName = (file) => gateRunnerFile(GATE_LAYOUT, file);

const ONE_MODULE = 'impl/src/one.mjs';
const TWO_MODULE = 'impl/src/two.mjs';
const ONE_TEST = 'impl/test/one.test.mjs';
const TWO_TEST = 'impl/test/two.test.mjs';
const MOVED_MODULE = 'impl/src/moved-617.mjs';
const LANE_CHANGED = Object.freeze([ONE_MODULE, TWO_MODULE].sort());

/** A module long enough that an edit at its first line and an edit at its last line merge without
 * a conflict — row (b) moves the target's end of `two.mjs` while the lane moves its head. */
const moduleSource = (name, first, last) => [
  `export const ${name} = ${first};`,
  ...Array.from({ length: 10 }, (_, index) => `export const ${name}${index} = ${index};`),
  `export const ${name}End = ${last};`,
].join('\n') + '\n';

const testSource = (name) => `import { ${name} } from '../src/${name}.mjs';\n\nexport const covered = ${name};\n`;

const contractBody = ({ subject, sha, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'probe-selection', status: 'delivered',
    change: 'Ship the two modules and their tests',
    files: [ONE_MODULE, TWO_MODULE], test: 'node --test test/issue617-target-move-selection.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * A real repository with this repository's layout, a lane branch that changes `one.mjs` and
 * `two.mjs` (each covered by its own test), a bare shared remote as the declared publish remote,
 * and a fixture gate runner that moves the target from inside its FIRST call.
 *
 * `move` is what that first call lands on the target: `{path, content}`. `rejudge` decides what
 * the second call answers — the default is `reused` with no files, which is what the #617 caller
 * determines for a move that touches none of the judged tests.
 */
async function world(t, { move, rejudge = null } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue617-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 617', GIT_COMMITTER_NAME: 'Issue 617' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue617@example.invalid', GIT_COMMITTER_EMAIL: 'issue617@example.invalid' });
  write(repo, 'README.md', 'base\n');
  write(repo, ONE_MODULE, moduleSource('one', 1, 0));
  write(repo, ONE_TEST, testSource('one'));
  write(repo, TWO_MODULE, moduleSource('two', 1, 0));
  write(repo, TWO_TEST, testSource('two'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, ONE_MODULE, moduleSource('one', 2, 0));
  write(repo, TWO_MODULE, moduleSource('two', 2, 0));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work: both modules (#617)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const resolver = { sources: new Map(), artifacts: new Map() };
  const store = new CoordinationStore(join(directory, 'ledger'), {
    repoId: 'repo-issue617', deploymentBaseSha: '1'.repeat(40),
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
    clock: () => '2026-09-27T12:30:00.000Z',
  });

  // One attempt through the landing's gate seam: `{dir, files, context}`, plus the moved head the
  // first call landed on the target.
  const gateCalls = [];
  let movedHead = null;
  const record = (path, content, message) => {
    write(repo, path, content);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', message);
    return git(repo, 'rev-parse', 'HEAD');
  };
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
      // The deployment's own regenerators are the fixture's no-op: `changed` stays exactly the
      // lane's delta, which is what the selection derivations are computed against.
      regenerate: async () => {},
      runGates: async (dir, files, context) => {
        let answer;
        if (gateCalls.length === 0) {
          // The race itself: the target moves while the first gate run is in flight.
          movedHead = record(move.path, move.content, 'target-side work');
          answer = { files: [], verdictLine: `green — ${files.length} file(s)`, unexpected: [] };
        } else {
          answer = rejudge === null
            ? { files: [], verdictLine: null, unexpected: [], reused: true }
            : rejudge(files, context);
        }
        gateCalls.push({ dir, files: [...files], context, answer });
        return answer;
      },
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane (#617)', idempotencyKey: 'i617:create' }, principal);
  const recordRow = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i617:${key}` });
  recordRow('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder', runId: 'run-issue617-seat' }, 'join');
  recordRow('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  recordRow('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({ subject: 'The landing re-judges the moved target', sha: tip, observedHead, rebasedOnto: targetHead }),
  }, 'contribution');
  recordRow('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  /** A detached worktree at `sha`, cached per sha — the tree a selection is derived from. */
  const trees = new Map();
  const treeAt = (sha) => {
    if (!trees.has(sha)) {
      const tree = join(directory, `tree-${trees.size}`);
      git(repo, 'worktree', 'add', '-q', '--detach', tree, sha);
      trees.set(sha, tree);
    }
    return trees.get(sha);
  };
  const selectionAt = (sha, changedPaths) => selectFromRepository({ root: treeAt(sha), changedPaths })
    .files.map(runnerName).sort();
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i617:integrate', ...args,
  }, principal);
  return {
    repo, tip, targetHead, gateCalls, integrate,
    movedHead: () => movedHead,
    failureRows: () => driverRows('swarm.integration_failed'),
    /** The landed tree's own content at `path`, read from the target branch (not the checkout). */
    landedFile: (path) => git(repo, 'show', `master:${path}`),
    selectionAt,
  };
}

// ── (a) a move that touches nothing judged re-runs nothing ───────────────────────────────────────

test('617a: an unrelated target move re-judges nothing and the landing holds both contributions', needsGit, async (t) => {
  const w = await world(t, {
    move: { path: MOVED_MODULE, content: 'export const moved = 1;\n' },
  });
  const judged = w.selectionAt(w.tip, [...LANE_CHANGED]);

  const answer = await w.integrate();
  const movedHead = w.movedHead();

  assert.ok(judged.length > 0, 'the lane selects at least one test to judge');
  assert.deepEqual(w.selectionAt(movedHead, [MOVED_MODULE]), [],
    'the moved commit carries a path no test imports and none names in a fixture path');
  assert.equal(w.gateCalls.length, 1, 'the fixture runner ran ONCE: the move re-judged no test');
  assert.deepEqual(w.gateCalls[0].files, judged, 'the first call judged the lane\'s own selection');
  assert.equal(answer.integration.targetHeadBefore, movedHead, 'the landing recorded the head it re-based onto');
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.integration.squashSha,
    'the target tip is the landed squash');
  assert.equal(Object.hasOwn(answer.integration.gates, 'rejudged'), false,
    'a move that re-judges nothing names no re-judgment');
  assert.equal(answer.integration.gates.reboundOnto, movedHead, 'the receipt still names the head the re-base took');
  assert.match(w.landedFile(ONE_MODULE), /export const one = 2;/u, 'the landed tree carries the lane\'s change');
  assert.match(w.landedFile(MOVED_MODULE), /export const moved = 1;/u,
    'and the moved commit\'s own file — the commit the re-base took is part of what landed');
});

// ── (b) a move that touches a judged test re-judges only that test ───────────────────────────────

test('617b: an affected move re-judges only the tests its own paths select', needsGit, async (t) => {
  const w = await world(t, {
    move: { path: TWO_MODULE, content: moduleSource('two', 1, 9) },
  });
  const judged = w.selectionAt(w.tip, [...LANE_CHANGED]);

  const answer = await w.integrate();
  const movedHead = w.movedHead();
  const affected = w.selectionAt(movedHead, [TWO_MODULE]).filter((file) => judged.includes(file));

  assert.equal(w.gateCalls.length, 2, 'the moved target cost exactly one narrowed call');
  assert.deepEqual(w.gateCalls[0].files, judged, 'the first call judged the lane\'s whole selection');
  assert.deepEqual(affected, [runnerName(TWO_TEST)], 'the moved path selects the test that imports it');
  assert.deepEqual(w.gateCalls[1].files, affected,
    'the second call was handed exactly the affected tests — the unaffected judged test did not re-run');
  assert.deepEqual(w.gateCalls[1].context.judged, judged, 'and it was told which tests the first call judged');
  assert.deepEqual(w.gateCalls[1].context.rebased, {
    from: w.targetHead, to: movedHead, movedPaths: [TWO_MODULE],
  }, 'with the heads and the paths the move carries');
  assert.equal(w.gateCalls[1].context.targetHeadBefore, movedHead,
    'the second run judged the re-based squash against the head the re-base took');
  assert.equal(w.gateCalls[1].context.squashSha, answer.integration.squashSha,
    'and it judged the squash that landed — the same revision the receipt\'s rejudged fact names');
  const rejudged = answer.integration.gates.rejudged;
  assert.deepEqual(rejudged.files, affected, 'the receipt names the re-judged file');
  assert.equal(rejudged.onto, movedHead, 'and the commit and head that run judged it on');
  assert.equal(rejudged.squashSha, answer.integration.squashSha, 'which is the squash that landed');
  assert.equal(rejudged.verdictLine, w.gateCalls[1].answer.verdictLine,
    'carrying the line the second call answered with');
  assert.equal(answer.integration.gates.verdictLine, w.gateCalls[0].answer.verdictLine,
    'while the receipt\'s own verdict line is still the first run\'s');
  assert.deepEqual(answer.integration.gates.selection.files, judged,
    'the landing\'s own selection is still the one the first call derived');
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.integration.squashSha);
  assert.match(w.landedFile(ONE_MODULE), /export const one = 2;/u, 'the landing holds the lane\'s change');
  assert.match(w.landedFile(TWO_MODULE), /export const twoEnd = 9;/u,
    'and the moved commit\'s change to the module the lane also touched');
});

// ── (c) a red re-judgment refuses before the target moves ────────────────────────────────────────

test('617c: a red re-judged set refuses integrate_gates_red and names the re-judged file', needsGit, async (t) => {
  const red = { row: 'test/two.test.mjs', test: 'two', kind: 'fail' };
  const w = await world(t, {
    move: { path: TWO_MODULE, content: moduleSource('two', 1, 9) },
    rejudge: (files) => ({
      files: [...files], verdictLine: 'red — passed 1, 1 blocking on the change', unexpected: [red],
    }),
  });

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refused rather than landing on a red re-judgment');
  assert.equal(error.code, 'integrate_gates_red', 'the refusal keeps the red-gate code');
  assert.equal(git(w.repo, 'rev-parse', 'master'), w.movedHead(),
    'the target did not move past the commit the re-base took');
  assert.equal(error.detail.reboundOnto, w.movedHead(), 'and the head the re-base took');
  assert.equal(error.detail.verdictLine, 'red — passed 1, 1 blocking on the change');
  assert.deepEqual(error.detail.unexpected, [red]);
  const failures = w.failureRows();
  assert.equal(failures.length, 1, 'the refusal left one durable failure row');
  assert.equal(failures[0].code, 'integrate_gates_red');
  assert.deepEqual(failures[0].detail.rejudged.files, [runnerName(TWO_TEST)],
    'and the durable row names the same re-judged file the refusal does');
});
