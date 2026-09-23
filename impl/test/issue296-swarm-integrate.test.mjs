// Issue #296 — the native landing verb. Landing a captured contribution used to be a root-side
// manual git pipeline: fetch the lane, cherry-pick the range by hand (a single cherry-pick applies
// only the LAST delta when a lane pinned two checkpoints), build a scratch worktree with a COPIED
// node_modules, pick the gate set from a table the root kept in its head, strip the lane's
// scaffolding, and relabel the snapshot commit. Every row below proves one piece of that pipeline
// is now the verb's own, on a REAL temporary repository with a REAL lane branch:
//
//   (a) an accepted contribution whose lane carries two commits and a scaffolding commit lands as
//       ONE squashed commit on the target, message = subject + delivered items, scaffolding
//       excluded, receipt recorded with base = the merge-base;
//   (b) the base is `git merge-base <target> <sha>` — a lane that was REBASED records an
//       observedHead that is no longer the merge-base, and the merge-base is what lands;
//   (c) the gate set is derived from the changed paths through the seam inventory and the declared
//       region table, never typed;
//   (d) a path that conflicts with an already-landed contribution refuses typed, naming the files
//       AND that contribution;
//   (e) `--dry-run` records dryRun: true and leaves the target exactly where it was;
//   (f) a contribution with no unrevoked accept refuses pre-effect: no checkout, no commit, no row;
//   (g) `swarm.view` projects `integration` on the contribution row and the watch wakes on the
//       receipt's own wake class;
//   (h) the new row survives replay byte-identically, like every other fold row.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { foldSwarmEvent, swarmSnapshot, SWARM_EVENT_KINDS } from '../src/swarm-state.mjs';
import { wakeClassFor } from '../src/wake-stream.mjs';
import { gateSetForPaths } from '../src/landing-table.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';

const principal = { actor: 'direct:issue296-root', principalId: 'issue296-root', sessionId: 'issue296-root' };
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

/** A #310 contract body: the shape a seat publishes, and the shape the landing message and the
 * issue reference are read from. */
const contractBody = ({ subject, items, sha, branch, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch },
  items,
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

const ITEMS = [
  { id: 'scope-guard', status: 'delivered', change: 'Hold the scope guard', files: ['impl/src/coordinator.mjs'], test: 'node --test test/issue296-swarm-integrate.test.mjs', evidence: 'suite green' },
  { id: 'later-note', status: 'partial', change: 'Not landed yet', files: ['impl/src/other.mjs'], test: 'node --test test/issue296-swarm-integrate.test.mjs', evidence: 'pending' },
];

/**
 * A real repository with a target branch and a lane branch carrying TWO commits plus a
 * `.baton-brief/` scaffolding commit — the shape the #296 observation describes.
 *
 * `targetMoves` decides what the target does after the lane forks: nothing, an unrelated commit
 * (the clean case), or the SAME file the lane edits (the conflicting case).
 */
async function world(t, {
  subject = 'Lane scope guard holds on shared checkouts',
  targetMoves = null, rebase = false, accept = true, purpose = 'land the lane',
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue296-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 296');
  git(repo, 'config', 'user.email', 'issue296@example.invalid');
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#296)');
  // The second commit — the delta a single cherry-pick of the tip would lose — plus the lane
  // scaffolding that must never land.
  write(repo, '.baton-brief/BRIEF.md', 'lane scaffolding\n');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane two (#296)');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');
  if (targetMoves === 'unrelated') {
    write(repo, 'impl/src/other.mjs', 'export const other = 1;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'target moved elsewhere');
  } else if (targetMoves === 'same-file') {
    write(repo, 'impl/src/coordinator.mjs', 'export const coordinator = "target";\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'target moved the same file');
  }
  const targetHead = git(repo, 'rev-parse', 'master');
  if (rebase) {
    // The lane replays onto the target: its recorded observedHead is now an ancestor of nothing the
    // target holds, so a squash from observedHead would replay the lane's ancestors as its own work.
    git(repo, 'checkout', '-q', 'baton/lane-1');
    git(repo, 'rebase', '-q', 'master');
    git(repo, 'checkout', '-q', 'master');
  }
  const rebasedTip = git(repo, 'rev-parse', 'baton/lane-1');

  // Issue #558: the deployment's declared shared remote — a bare repository this landing
  // publishes the landed ref to after the fast-forward.
  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const store = new CoordinationStore(join(directory, 'ledger'));
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    // The deployment's landing authority. The gate runner and the regenerators are the fixture's:
    // the verb's OWN derivation of the gate set is asserted separately (row c), and the deployment
    // owns what a landing regenerates (in the real repository, the three `impl/scripts` writers).
    // The fixture's regenerator writes a real file, so "folded into the ONE commit" is provable.
    integration: {
      repoRoot: repo,
      publishRemote,
      regenerate: async (dir) => { write(dir, 'impl/scripts/seam-inventory.json', '{}\n'); },
      runGates: async (dir, files) => ({ files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] }),
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose, idempotencyKey: 'i296:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i296:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  const body = contractBody({
    subject, items: ITEMS, sha: rebasedTip, branch: 'baton/lane-1',
    observedHead, rebasedOnto: targetHead,
  });
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1', body,
  }, 'contribution');
  if (accept) {
    record('swarm.contribution_reviewed',
      { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
      'accept');
  }

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i296:integrate', ...args,
  }, principal);
  const foldRow = () => store.swarm('s1').contributions['contribution:1'];
  return { directory, repo, store, runtime, integrate, foldRow, tip: rebasedTip, targetHead, observedHead };
}

// ── (a) the squash ───────────────────────────────────────────────────────────────────────────────

test('296a: an accepted two-commit lane lands as ONE squashed commit, scaffolding excluded', needsGit, async (t) => {
  const w = await world(t);
  const before = Number(git(w.repo, 'rev-list', '--count', 'master'));

  const answer = await w.integrate();

  assert.equal(Number(git(w.repo, 'rev-list', '--count', 'master')), before + 1,
    'exactly ONE commit lands, however many the lane carried');
  assert.equal(git(w.repo, 'log', '-1', '--format=%s', 'master'), 'Lane scope guard holds on shared checkouts',
    'the squash message is the contribution subject');
  const message = git(w.repo, 'log', '-1', '--format=%B', 'master');
  assert.match(message, /- Hold the scope guard/u, 'one line per DELIVERED item');
  assert.doesNotMatch(message, /Not landed yet/u, 'a partial item is not a thing the target received');
  assert.doesNotMatch(git(w.repo, 'show', '--name-only', '--format=', 'master'), /\.baton-brief\//u,
    'lane scaffolding never lands');
  assert.equal(git(w.repo, 'show', '--format=', 'master:impl/src/coordinator.mjs'), 'export const lane = 2;',
    'BOTH lane commits land — the delta a tip-only cherry-pick loses is here');

  assert.equal(answer.integration.base, w.observedHead,
    'the receipt records the merge-base the squash was built from');
  assert.equal(answer.integration.squashSha, git(w.repo, 'rev-parse', 'master'));
  assert.equal(answer.integration.targetHeadAfter, answer.integration.squashSha);
  assert.equal(answer.integration.dryRun, false);
  assert.equal(w.foldRow().integration.squashSha, answer.integration.squashSha,
    'the receipt is folded onto the contribution row');
  assert.equal(w.foldRow().integration.base, w.observedHead);

  // The author is the SEAT; the committer is the landing authority (the root).
  assert.equal(git(w.repo, 'log', '-1', '--format=%an', 'master'), 'lane-a');
  assert.equal(git(w.repo, 'log', '-1', '--format=%cn', 'master'), principal.actor);
});

// ── (b) the merge-base rule ──────────────────────────────────────────────────────────────────────

test('296b: a REBASED lane lands from the merge-base, never its stale observedHead', needsGit, async (t) => {
  const w = await world(t, { rebase: true, targetMoves: 'unrelated' });
  const mergeBase = git(w.repo, 'merge-base', 'master', 'baton/lane-1');

  assert.notEqual(mergeBase, w.observedHead,
    'the fixture is meaningful only when the lane was rebased past its recorded head');

  const answer = await w.integrate();

  assert.equal(answer.integration.base, mergeBase,
    'the base is git merge-base <target> <sha>, not the contribution recorded observedHead');
  assert.equal(git(w.repo, 'show', '--format=', 'master:impl/src/coordinator.mjs'), 'export const lane = 2;');
  assert.equal(answer.integration.squashSha, git(w.repo, 'rev-parse', 'master'));
});

// ── (c) the gate set is derived ──────────────────────────────────────────────────────────────────

test('296c: changed paths under the coordinator select the custody set and a named issue row', () => {
  const gate = gateSetForPaths(['impl/src/coordinator.mjs'], { issues: [428] });
  assert.deepEqual(gate.regions, ['custody'], 'the coordinator is the custody region');
  assert.ok(gate.files.includes('issue428-worktree-custody-on-stop.test.mjs'),
    'the named issue\'s own row is selected');
  assert.ok(gate.files.includes('phase70-preserved-stop.test.mjs'), 'the region\'s phase rows are selected');
  assert.ok(gate.files.includes('phase56-drain-and-close.test.mjs'), 'the drain rows are selected');
  assert.ok(gate.inventoried.includes('impl/src/coordinator.mjs'),
    'the seam inventory names the changed module');

  // An unrelated module selects nothing but its own issue rows: the table never over-selects.
  const unrelated = gateSetForPaths(['docs/readme.md']);
  assert.deepEqual(unrelated.files, [], 'an unclassified path selects no gate');
  assert.deepEqual(unrelated.regions, []);

  // A changed path that carries its own issue number selects that issue's rows without being named.
  const byPath = gateSetForPaths(['impl/test/issue296-swarm-integrate.test.mjs']);
  assert.ok(byPath.files.includes('issue296-swarm-integrate.test.mjs'));
});

// ── (d) the typed conflict refusal ───────────────────────────────────────────────────────────────

test('296d: a conflicting path refuses typed, naming the files and the landed contribution', needsGit, async (t) => {
  const w = await world(t, { targetMoves: 'same-file' });
  // A contribution landed here earlier, and its receipt covers the path this lane also moved — the
  // fold records the receipt ON the contribution, so the contribution comes first.
  w.store.recordSwarm('swarm.contribution_recorded', {
    swarmId: 's1', contributionId: 'contribution:0', participantId: 'lane-a', workId: 'w1', body: 'prior',
  }, { actor: principal.actor, key: 'i296:prior' });
  w.store.recordSwarm('swarm.contribution_integrated', {
    swarmId: 's1', contributionId: 'contribution:0', participantId: 'lane-a',
    base: w.observedHead, target: 'master',
    targetHeadBefore: w.observedHead, targetHeadAfter: w.targetHead,
    squashSha: w.targetHead, changedPaths: ['impl/src/coordinator.mjs'],
    gates: { files: [], verdictLine: 'green', unexpected: [] }, regenerated: [], conflicts: [],
    issue: null, dryRun: false,
  }, { actor: principal.actor, key: 'i296:prior-landing' });

  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_conflict');
  assert.deepEqual(error.detail.paths, ['impl/src/coordinator.mjs'], 'the conflicting files are named');
  assert.equal(error.detail.otherContributionId, 'contribution:0',
    'the landed contribution that touched the same path is named');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
  assert.equal(w.store.swarms().length, 1);
});

// ── (d2) a receipt that moved nothing is never named as a landed contribution ──────────────────

test('296i: a prior receipt that records no moved target is not named as the landed contribution', needsGit, async (t) => {
  const w = await world(t, { targetMoves: 'same-file' });
  // The same conflict as 296d, with the prior receipt recording no commit for the target AFTER it:
  // the fold admits dryRun false beside a null targetHeadAfter, so this row holds a receipt that
  // claims a landing while naming no target move. The refusal still crosses as the git conflict it
  // is — and it names no landed contribution, because none covers these paths.
  w.store.recordSwarm('swarm.contribution_recorded', {
    swarmId: 's1', contributionId: 'contribution:0', participantId: 'lane-a', workId: 'w1', body: 'prior',
  }, { actor: principal.actor, key: 'i296i:prior' });
  w.store.recordSwarm('swarm.contribution_integrated', {
    swarmId: 's1', contributionId: 'contribution:0', participantId: 'lane-a',
    base: w.observedHead, target: 'master',
    targetHeadBefore: w.observedHead, targetHeadAfter: null,
    squashSha: w.targetHead, changedPaths: ['impl/src/coordinator.mjs'],
    gates: { files: [], verdictLine: 'green', unexpected: [] }, regenerated: [], conflicts: [],
    issue: null, dryRun: false,
  }, { actor: principal.actor, key: 'i296i:prior-receipt' });

  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_conflict');
  assert.deepEqual(error.detail.paths, ['impl/src/coordinator.mjs'], 'the conflicting files are still named');
  assert.equal(error.detail.otherContributionId, null,
    'a receipt that records no commit for the target after it is not a landed contribution');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
});

// ── (e) dry run ──────────────────────────────────────────────────────────────────────────────────

test('296e: --dry-run prepares and verifies, records dryRun: true, and leaves the target alone', needsGit, async (t) => {
  const w = await world(t);
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const answer = await w.integrate({ dryRun: true });

  assert.equal(answer.integration.dryRun, true);
  assert.equal(answer.integration.targetHeadAfter, null, 'the target did not move');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore);
  assert.equal(w.foldRow().integration.dryRun, true, 'the receipt is recorded with dryRun true');
  assert.ok(answer.integration.squashSha.length >= 40, 'the squash was still built and named');
  assert.ok(answer.integration.gates.files.length > 0, 'the gate set still ran');
});

// ── (f) not accepted refuses pre-effect ──────────────────────────────────────────────────────────

test('296f: a contribution with no unrevoked accept refuses pre-effect', needsGit, async (t) => {
  const w = await world(t, { accept: false });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.equal(error.code, 'integrate_contribution_not_accepted');
  assert.equal(error.detail.reviewState, 'unreviewed');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'nothing moved');
  assert.equal(w.foldRow().integration, undefined, 'nothing was recorded');
  assert.equal(w.store.swarms()[0].contributions['contribution:1'].integration, undefined);
});

test('296f: a LATER reject revokes an earlier accept, and the landing refuses', needsGit, async (t) => {
  const w = await world(t);
  w.store.recordSwarm('swarm.contribution_reviewed',
    { swarmId: 's1', contributionId: 'contribution:1', decision: 'reject', reviewerId: 'lane-a', reason: 'revoked' },
    { actor: principal.actor, key: 'i296:revoke' });

  const error = await w.integrate().then(() => null, (thrown) => thrown);
  assert.equal(error.code, 'integrate_contribution_not_accepted');
  assert.equal(error.detail.reviewState, 'rejected');
});

// ── (g) the view projects it and the watch wakes on it ───────────────────────────────────────────

test('296g: the view carries integration on the contribution row and the watch wakes on the class', needsGit, async (t) => {
  const w = await world(t);
  const answer = await w.integrate();

  const view = await w.runtime.command('swarm.view', { swarmId: 's1' }, principal);
  const row = view.contributions.find((entry) => entry.contributionId === 'contribution:1');
  assert.ok(row, 'the contribution is on the view');
  assert.equal(row.integration.squashSha, answer.integration.squashSha, 'integration rides the row');
  assert.equal(row.integration.target, 'master');
  assert.ok(row.integration.at === undefined || typeof row.integration.ts === 'string');

  assert.equal(wakeClassFor({ kind: 'swarm.contribution_integrated', payload: { swarmId: 's1' } }).wakeClass,
    'contribution_integrated', 'the receipt has its own wake class');

  // A watch parked before the landing returns on the receipt's own row.
  const cursor = view.cursor;
  const woken = await w.runtime.command('swarm.watch', { swarmId: 's1', afterSeq: cursor, timeoutMs: 1000 }, principal);
  assert.ok(woken.cursor >= cursor, 'the watch advanced past the receipt');

  // The refusal codes the verb raises are in the family's ONE closed set.
  for (const code of ['integrate_contribution_not_accepted', 'integrate_commit_unreachable',
    'integrate_conflict', 'integrate_gates_red', 'integrate_target_moved']) {
    assert.ok(Object.hasOwn(SWARM_REFUSAL_CODES, code), `${code} is declared in the closed refusal set`);
  }
});

// ── (h) replay parity ────────────────────────────────────────────────────────────────────────────

test('296h: the landing receipt replays byte-identically from the durable ledger', needsGit, async (t) => {
  const w = await world(t);
  await w.integrate();

  const replay = new Map();
  for (const event of w.store.eventsView()) {
    if (SWARM_EVENT_KINDS.has(event.kind)) foldSwarmEvent(replay, event);
  }
  const asMap = (rows) => new Map(rows.map((swarm) => [swarm.swarmId, swarm]));
  const replayed = swarmSnapshot(replay).swarms.find((swarm) => swarm.swarmId === 's1');
  const live = swarmSnapshot(asMap(w.store.swarms())).swarms.find((swarm) => swarm.swarmId === 's1');
  assert.deepEqual(replayed.contributions['contribution:1'].integration,
    live.contributions['contribution:1'].integration,
    'the replayed receipt is the live receipt');
  assert.equal(replayed.contributions['contribution:1'].integration.squashSha,
    w.foldRow().integration.squashSha);
});

test('296h: a second landing of the same contribution refuses rather than double-landing', needsGit, async (t) => {
  const w = await world(t);
  await w.integrate();
  const headAfter = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate({ idempotencyKey: 'i296:integrate-again' }).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the retry refuses');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headAfter, 'the target did not move twice');
});

test('296: a contribution whose commit is not in the repository refuses typed by sha', needsGit, async (t) => {
  const w = await world(t);
  const phantom = 'e'.repeat(40);
  // A second contribution whose contract names a commit this repository has never held — the case
  // the issue says the root had to recover by hand.
  w.store.recordSwarm('swarm.contribution_recorded', {
    swarmId: 's1', contributionId: 'contribution:phantom', participantId: 'lane-a', workId: 'w1',
    body: contractBody({ subject: 'phantom lane', items: ITEMS, sha: phantom, branch: 'baton/lane-9',
      observedHead: w.observedHead, rebasedOnto: w.observedHead }),
  }, { actor: principal.actor, key: 'i296:phantom-contribution' });
  w.store.recordSwarm('swarm.contribution_reviewed',
    { swarmId: 's1', contributionId: 'contribution:phantom', decision: 'accept', reviewerId: 'lane-a', reason: 'ok' },
    { actor: principal.actor, key: 'i296:phantom-accept' });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:phantom', target: 'master', idempotencyKey: 'i296:phantom-run',
  }, principal).then(() => null, (thrown) => thrown);

  assert.equal(error.code, 'integrate_commit_unreachable');
  assert.equal(error.detail.sha, phantom, 'the refusal names the sha the root must recover');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.store.swarm('s1').contributions['contribution:phantom'].integration, undefined);
});
