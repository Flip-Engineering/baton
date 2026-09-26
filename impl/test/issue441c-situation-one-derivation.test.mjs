// Issue #441 lane C — the `## Swarm situation` brief section and the seat's peer/contribution
// reads derive from ONE contributions derivation (docs/47 §3 row 3, §6 "No second contributions
// derivation. The #433 view projection and run.contributions.read share ONE exported function; a
// second spelling is a bug"; docs/46 §7 "No per-view scans or spawns").
//
// What the issue observes: the `contributions` projection built its rows inline in `inspect()`
// while `run.contributions.read` answered `contributionLedgerRows` — two spellings of one row, so
// the two answers could drift (the read carried `summary`/`files`/`decision`, the projection
// carried the fold's `body`/`refs`/`revision`, and neither carried the other's fields); and the
// brief's `## Swarm situation` section named the swarm's contributions nowhere, so a recruited
// seat could not read from its own brief how much of the swarm's work was reviewed, landed, or
// still waiting.
//
// The rows (each red at the pre-landing HEAD unless noted):
//   (a) the `contributions` projection and `run.contributions.read` answer the ONE derivation's
//       rows: for a swarm holding an accepted, an unreviewed and an integrated contribution, the
//       projection's row for each contribution carries the derivation's fields the fold row does
//       not already spell (`reviewState`, `files`, `decision`) BYTE-FOR-BYTE, and every other
//       derivation field is asserted against the fold row's own fuller spelling (`body`/`contract`
//       for `summary`/`subject`/`items`/`commit`, the fold's `integration` for `integration`) —
//       the row is priced by the bridge's frame budget, so a second copy of a body is not free;
//   (b) the `## Swarm situation` section of a composed brief names the peers and the contribution
//       counts FROM the folds, composes with ZERO process spawns (the #438 instrument: a PATH shim
//       that counts OS-level git spawns, with a live-checkout control proving the count is real),
//       and scans no ledger of its own;
//   (c) `run.peers.read` and the brief's `Peers now:` rows are identical — one derivation, one
//       renderer (`renderPeerNowLine`, exported so no reader re-spells a peer line);
//   (d) a brief for a swarm holding no contribution renders its section BYTE-IDENTICALLY to the
//       pre-#441c composition (docs/47 §7, the migration rule) — GREEN at HEAD by construction,
//       because "byte-identical to today" IS today's behaviour; it is the guard that goes red if
//       the new count line is rendered for an empty swarm.
//
// Fixture: the light SwarmRuntime harness the #441b rows use (a real coordination store, a
// coordinator double, a real checkout on disk) plus the #438 PATH shim, so the zero-spawn row is
// measured against a runtime that really can spawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import * as runtimeModule from '../src/swarm-runtime.mjs';

const { SwarmRuntime, SWARM_REVIEW_STATES, contributionLedgerRows } = runtimeModule;
// The ONE peer renderer the brief's `Peers now:` block and the `run.peers.read` parity both name.
// Red-before: at the pre-landing HEAD it is not exported, so row (c) asserts its existence itself
// instead of failing to import the file (the #441b pattern).
const renderPeerNowLine = runtimeModule.renderPeerNowLine ?? null;

const SWARM_ID = 'swarm-441c';
const WORKER_SHA = 'a'.repeat(40);
const SQUASH_SHA = 'b'.repeat(40);
const BASE_SHA = 'c'.repeat(40);
const owner = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
const workerPrincipal = (workerId) => Object.freeze({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: `${workerId}-session`,
});

const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };
/** The real git the shim forwards to, resolved BEFORE any shim is on PATH (#438). */
const REAL_GIT = (() => {
  const found = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  const path = (found.stdout ?? '').trim();
  return path.length > 0 ? path : null;
})();

/** The #310 contract shape the validator admits, built from the (id, status) pairs a row names. */
const contractBody = ({ subject, items, files }) => ({
  subject,
  base: { observedHead: WORKER_SHA, rebasedOnto: WORKER_SHA },
  commit: null,
  items: items.map(([id, status]) => ({ id, status, change: `Do ${id}`, files,
    test: 'node --test impl/test/issue441c-situation-one-derivation.test.mjs', evidence: 'green' })),
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/** A real checkout (so the spawn control can really spawn) behind a PATH shim that counts every
 * OS-level git spawn, plus the light SwarmRuntime the #441b rows use. No `situationGit` and no
 * `integration` authority: the brief's commits block derives nothing, so the composed section is
 * exactly the folds' own text. */
function fixture(t, label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue441c-${label}-`));
  const repo = join(world, 'repo');
  const bin = join(world, 'bin');
  const spool = join(world, 'git-spawns.log');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(spool, '');
  const git = (args) => execFileSync(REAL_GIT, args, {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 441c', GIT_COMMITTER_NAME: 'Issue 441c' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue441c@example.invalid', GIT_COMMITTER_EMAIL: 'issue441c@example.invalid' });
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']);
  git(['commit', '-qm', 'seed']);
  const shim = join(bin, 'git');
  writeFileSync(shim, `#!/bin/sh
printf 'spawn\\n' >> ${JSON.stringify(spool)}
exec ${JSON.stringify(REAL_GIT)} "$@"
`);
  chmodSync(shim, 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}:${priorPath ?? ''}`;
  t.after(() => {
    process.env.PATH = priorPath;
    rmSync(world, { recursive: true, force: true });
  });
  const gitSpawns = () => (readFileSync(spool, 'utf8').match(/^spawn$/gmu) ?? []).length;

  const store = new CoordinationStore(join(world, 'coordination'));
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused
      ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) => ({
      contributionId, workerId, sha: WORKER_SHA, ref: `refs/baton/checkpoints/${WORKER_SHA}`,
    }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    // The prepared intent the deployment resolves: the route and scope a seat was recruited under
    // (what the view and the peers read project from the join).
    prepareRun: async (request) => ({ ...request,
      route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] }),
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working',
        sessionContext: { worktree: repo, repoRoot: repo } });
    },
    stopRun: async (runId) => {
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM_ID,
      ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args },
    caller);
  const seatCall = (verb, args = {}, caller) => runtime.command(verb, { swarmId: SWARM_ID, ...args }, caller);
  // The recruit's own words: the objective is the seat's ROLE on the join, so the section's peer
  // lines render it verbatim — the fixture keeps it short and stable.
  const recruit = (participantId, permissions) => call('recruit', {
    participantId, objective: `${participantId} lane`,
    ...(permissions ? { permissions } : {}),
  });
  /** The principal of a recruited seat: its worker's identity, the token's own spelling. */
  const principalFor = (participantId) => {
    const runId = store.swarm(SWARM_ID).participants[participantId].runId;
    const worker = workers.find((row) => row.runId === runId);
    return workerPrincipal(worker.id);
  };
  /** The brief a seat was composed with — the durable join row IS the record (the recruit's own
  * answer carries the same text; every other reader renders from the fold). */
  const briefOf = (participantId) => store.swarm(SWARM_ID).participants[participantId].brief;
  return { world, repo, store, runtime, workers, gitSpawns, call, seatCall, recruit, principalFor, briefOf };
}

/** One swarm whose world a seat reads: alpha (reviewer) and beta (author) with an ACCEPTED
 * contribution, an UNREVIEWED one, and an INTEGRATED one — the three states the ONE derivation
 * must agree on. Returns the handles the rows drive. */
async function situationFixture(t, label) {
  const f = await fixture(t, label);
  await f.call('create', { purpose: 'The situation derives from the folds (#441 lane C)' });
  await f.recruit('alpha', ['read', 'communicate', 'contribute', 'review']);
  await f.recruit('beta', ['read', 'contribute']);
  const alpha = f.principalFor('alpha');
  const beta = f.principalFor('beta');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c-accepted', participantId: 'beta',
    body: contractBody({ subject: 'Lane scope guard holds on shared checkouts',
      items: [['scope-guard', 'delivered']], files: ['impl/src/kept.mjs'] }),
  } }, beta);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c-unreviewed', participantId: 'beta', body: 'A second finding, still unreviewed.',
  } }, beta);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c-integrated', participantId: 'beta',
    body: contractBody({ subject: 'The landed slice',
      items: [['landed-slice', 'delivered']], files: ['impl/src/landed.mjs'] }),
  } }, beta);
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c-accepted', decision: 'accept', reason: 'Ready for integration.',
  } }, alpha);
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'c-integrated', decision: 'accept', reason: 'Ready to land.',
  } }, alpha);
  // What the peer HOLDS, so the parity row below exercises the holds clause the brief renders
  // (the work it is assigned, and the paths it claims on a checkout it never recorded).
  await f.call('update', { event: 'swarm.work_updated', payload: {
    workId: 'work-1', objective: 'Hold the scope guard',
  } }, owner);
  await f.call('update', { event: 'swarm.assignment_updated', payload: {
    assignmentId: 'a-1', participantId: 'beta', workId: 'work-1', status: 'active',
  } }, owner);
  await f.call('update', { event: 'swarm.claim_updated', payload: {
    claimId: 'cl-1', participantId: 'beta', paths: ['impl/src/claimed.mjs'],
  } }, beta);
  // The landing receipt the `swarm.integrate` verb writes — recorded here as the fold row it is,
  // so the integrated state is exercised without a git authority in the fixture.
  f.store.recordSwarm('swarm.contribution_integrated', {
    swarmId: SWARM_ID, contributionId: 'c-integrated', participantId: 'beta',
    base: BASE_SHA, target: 'master', targetHeadBefore: BASE_SHA, targetHeadAfter: SQUASH_SHA,
    squashSha: SQUASH_SHA, changedPaths: ['impl/src/landed.mjs'],
    gates: { files: ['impl/scripts/surface-gate.mjs'], verdictLine: 'green', unexpected: [] },
    regenerated: [], conflicts: [], issue: null, dryRun: false,
  }, { actor: 'issue441c-root', key: 'integrate-c-integrated' });
  return { ...f, alpha, beta };
}

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));

/** The composed `## Swarm situation` section of a brief, verbatim, up to the next section. */
function situationOf(brief) {
  const start = brief.indexOf('## Swarm situation');
  assert.ok(start >= 0, 'the brief carries a ## Swarm situation section');
  const end = brief.indexOf('\n## ', start + 1);
  return brief.slice(start, end === -1 ? undefined : end).trimEnd();
}

/** The lines under the section's `Peers now:` heading — the bounded list, stopping before any
 * omitted-count row. */
function peersNowLines(section) {
  const lines = section.split('\n');
  const at = lines.indexOf('Peers now:');
  if (at === -1) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('- ') || line.includes('further seat')) break;
    out.push(line);
  }
  return out;
}

// ── (a) the projection and the read answer the ONE derivation's rows ────────────────────────────

test('441c-a: the contributions projection and run.contributions.read answer the ONE derivation rows', async (t) => {
  const f = await situationFixture(t, 'parity');
  const projection = await f.call('view', { projection: 'contributions' });
  const read = await f.seatCall('run.contributions.read', {}, f.alpha);

  assert.deepEqual(read.rows.map((row) => row.contributionId),
    ['c-accepted', 'c-unreviewed', 'c-integrated'], 'the read answers the fold in ledger order');
  assert.deepEqual(read.rows.map((row) => row.reviewState), ['accepted', 'unreviewed', 'accepted'],
    'the review state is derived per contribution: an unrevoked accept, no review, an unrevoked accept');
  assert.ok(read.rows.every((row) => SWARM_REVIEW_STATES.includes(row.reviewState)),
    `every row carries one of the closed set ${SWARM_REVIEW_STATES.join(' | ')} (docs/46 §2.1)`);

  // The parity: for every contribution the read answers, the `contributions` projection's row
  // CARRIES that row — one derivation, so a reader can never see two spellings of the same fact
  // (docs/47 §6). The row is priced by the bridge's frame budget (swarm-bridge-truth prices it),
  // so the projection carries the derivation's fields the fold row does not already spell —
  // `reviewState`, `files`, `decision` — and the other derivation fields are the SAME facts the
  // fold row already carries in their fuller spelling; the loop below asserts that
  // correspondence field by field, so a divergence in either direction is red.
  const projected = new Map(projection.contributions.map((row) => [row.contributionId, row]));
  const carried = ['seq', 'ts', 'participantId', 'contributionId', 'workId', 'reviewState', 'files', 'decision'];
  // The fold row's own spelling of the derived `summary`: a contract body's subject, else the
  // recorded string body, else null — the rule the derivation applies, read off the view row.
  const summaryOnView = (rowOnView) => (typeof rowOnView.body === 'string' ? rowOnView.body
    : rowOnView.contract?.subject ?? null);
  for (const row of read.rows) {
    const rowOnView = projected.get(row.contributionId);
    assert.ok(rowOnView, `the contributions projection carries ${row.contributionId}`);
    assert.deepEqual(pick(rowOnView, carried), pick(row, carried),
      `the projection row for ${row.contributionId} carries the derivation's fields byte-for-byte`);
    assert.equal(summaryOnView(rowOnView), row.summary,
      `${row.contributionId}: the summary the read answers IS the fact the fold row carries as body/subject`);
    assert.equal(rowOnView.contract?.subject ?? null, row.subject, `${row.contributionId}: the contract subject`);
    assert.deepEqual(rowOnView.contract?.items ?? [], row.items, `${row.contributionId}: the contract items`);
    assert.deepEqual(rowOnView.contract?.commit ?? null, row.commit, `${row.contributionId}: the contract commit`);
    assert.deepEqual(rowOnView.integration ?? null, row.integration,
      `${row.contributionId}: the landing receipt the fold row carries`);
  }

  // The exported function IS that derivation: the read's rows are its rows, and the projection
  // reads the same facts off it.
  const swarm = f.store.swarm(SWARM_ID);
  assert.deepEqual(contributionLedgerRows(swarm), read.rows,
    'run.contributions.read answers exactly contributionLedgerRows — the ONE exported derivation');
  for (const row of contributionLedgerRows(swarm)) {
    const rowOnView = projected.get(row.contributionId);
    assert.equal(rowOnView.reviewState, row.reviewState, `${row.contributionId} reviewState agrees`);
    assert.deepEqual(rowOnView.files, row.files, `${row.contributionId} files agree`);
    assert.equal(rowOnView.decision, row.decision, `${row.contributionId} decision agrees`);
  }

  // The row's own facts: the contract the author published (subject, items, commit) and the
  // landing receipt an integration leaves — read from the SAME projection the view renders.
  const accepted = read.rows.find((row) => row.contributionId === 'c-accepted');
  assert.equal(accepted.subject, 'Lane scope guard holds on shared checkouts');
  assert.deepEqual(accepted.items, [{ id: 'scope-guard', status: 'delivered' }]);
  assert.equal(accepted.commit, null, 'a commit-null publish reads as commit null');
  assert.deepEqual(accepted.files, ['impl/src/kept.mjs'], 'the files come from the contract items');
  assert.equal(accepted.decision, 'accept');
  const integrated = read.rows.find((row) => row.contributionId === 'c-integrated');
  assert.equal(integrated.integration.squashSha, SQUASH_SHA, 'the landing receipt rides the row');
  assert.deepEqual(integrated.integration.changedPaths, ['impl/src/landed.mjs']);
  const unreviewed = read.rows.find((row) => row.contributionId === 'c-unreviewed');
  assert.equal(unreviewed.subject, null, 'a string body carries no contract subject');
  assert.equal(unreviewed.summary, 'A second finding, still unreviewed.',
    'the summary is the contract subject, else the recorded string body');
  assert.equal(unreviewed.decision, null, 'nothing settled it');
  assert.equal(unreviewed.integration, null, 'recorded absence, never a guess');

  // The cursor walks the list with no gap and no duplicate (the #312/#343 vocabulary).
  const paged = await f.seatCall('run.contributions.read', { since: read.rows[1].seq }, f.alpha);
  assert.deepEqual(paged.rows.map((row) => row.contributionId), ['c-integrated']);
  assert.equal(paged.cursor, read.rows[2].seq);
  assert.equal(paged.truncated, false);
  assert.deepEqual((await f.seatCall('run.contributions.read', { since: read.cursor }, f.alpha)).rows, []);
});

// ── (b) the brief's section: peers and contribution counts from the folds, zero spawns ─────────

test('441c-b: the Swarm situation section counts the folds, composes with zero spawns, and scans no ledger', needsGit, async (t) => {
  const f = await situationFixture(t, 'situation');
  const before = f.gitSpawns();
  await f.recruit('gamma', ['read', 'contribute']);
  assert.equal(f.gitSpawns(), before,
    'composing a brief spawns NO process: the peers and contribution folds are the durable rows (docs/46 §7, #438)');
  const section = situationOf(f.briefOf('gamma'));

  for (const peer of ['alpha', 'beta']) {
    assert.match(section, new RegExp(`^- ${peer} —`, 'mu'), `the section names the live peer ${peer}`);
  }
  assert.match(section, /^Peers now:$/mu, 'the section carries the peers-now block');
  // The counts come from the ONE derivation: the same three rows the read answers, counted by
  // their closed reviewState — never a second fold of the contributions.
  assert.match(section,
    /^3 contributions recorded on this swarm: 1 unreviewed, 2 accepted, 0 rejected — read the rows with run\.contributions\.read$/mu,
    'the section counts the swarm\'s contributions by the derivation\'s reviewState');

  // No ledger scan of its own: the composer reads the fold, not the event log. (The recruit path
  // around it may read the ledger for parked guidance — #337 — so the guard is taken around the
  // compose itself, the seam this lane owns.)
  const swarm = f.store.swarm(SWARM_ID);
  const eventsView = f.store.eventsView.bind(f.store);
  let scans = 0;
  f.store.eventsView = (...args) => { scans += 1; return eventsView(...args); };
  let composed;
  try {
    composed = f.runtime._composeRecruitBrief(swarm,
      { participantId: 'gamma', objective: 'Read the folds', permissions: ['read', 'contribute'] },
      null, null, [], null);
  } finally {
    f.store.eventsView = eventsView;
  }
  assert.equal(scans, 0, 'the composer scans no ledger — the folds answer every fact it renders');
  assert.equal(composed.includes('3 contributions recorded on this swarm'), true,
    'the section the composer renders IS the section the recruit composed');

  // The control: the same runtime, the same shim, the same repository — the whole-record view
  // still reads the repository at read time (#301), so the zero above is a measured property of
  // the compose path and not of an inert fixture.
  const control = f.gitSpawns();
  await f.call('view', {});
  assert.ok(f.gitSpawns() > control, 'the whole-record view still spawns: the shim counts real spawns');
});

// ── (c) run.peers.read and the brief's peer rows are identical ──────────────────────────────────

test('441c-c: run.peers.read and the brief\'s Peers now rows are the same derivation', async (t) => {
  const f = await situationFixture(t, 'peers');
  assert.ok(renderPeerNowLine !== null,
    'export the ONE peer renderer (swarm-runtime.mjs) so the brief and the read cannot spell a peer line twice');
  await f.recruit('gamma', ['read', 'contribute']);
  const lines = peersNowLines(situationOf(f.briefOf('gamma')));
  assert.deepEqual(lines.map((line) => line.slice(2, line.indexOf(' —'))), ['alpha', 'beta'],
    'the brief renders one line per peer that can act, in the read\'s own order');

  const read = await f.seatCall('run.peers.read', {}, f.principalFor('gamma'));
  assert.deepEqual(read.peers.map((row) => row.participantId), ['alpha', 'beta'],
    'the read answers the other seats that can act, never the caller');
  assert.deepEqual(lines, read.peers.map((row) => renderPeerNowLine(row)),
    'every brief line IS the read\'s own row through the ONE renderer');
  const [alphaRow, betaRow] = read.peers;
  assert.deepEqual([alphaRow.status, betaRow.status], ['active', 'active']);
  assert.deepEqual(read.peers.map((row) => row.scope), [['impl/**'], ['impl/**']]);
  assert.ok(read.peers.every((row) => row.route.harness === 'mock'),
    'the route each seat was recruited under rides the row the brief rendered');
  assert.deepEqual(alphaRow.holds, [], 'a seat holding nothing reads holds [] — "holds nothing"');
  assert.deepEqual(betaRow.holds.map((row) => row.kind), ['work', 'claim'],
    'what the peer holds: the work it is assigned and the paths it claims');
  assert.match(lines[1], /holds work-1 \(assigned\)/u,
    'the brief renders the assignment the read answers');
  assert.match(lines[1], /claims impl\/src\/claimed\.mjs \(no recorded checkout\)/u,
    'the brief renders the claim the read answers, naming the checkout it is held on');
});

// ── (d) no contributions: the section is byte-identical to the pre-#441c composition ───────────

test('441c-d: a swarm with no contributions renders the section byte-identically to today\'s', async (t) => {
  const f = await fixture(t, 'migration');
  await f.call('create', { purpose: 'The migration rule (#441 lane C)' });
  await f.recruit('alpha', ['read', 'contribute']);
  await f.recruit('beta', ['read', 'contribute']);
  assert.deepEqual(contributionLedgerRows(f.store.swarm(SWARM_ID)), [],
    'a swarm that contributed nothing has no rows to count — the derivation invents none');
  await f.recruit('gamma', ['read', 'contribute']);
  const section = situationOf(f.briefOf('gamma'));
  // Today's bytes, exactly, above the wake block: the two peer blocks, the two peer rows, and no
  // contribution count line for an empty swarm (docs/47 §7, the migration rule). Issue #529 adds
  // the one section after them — the seat's own ledger rows since the reference point — so the
  // pinned prefix is what "byte-identical" means now, and the block below it is composed from the
  // rows themselves (its timestamps are the ledger's, never a fixture constant).
  const [peers, wakeBlock] = section.split('\nRecent wake events (since seq ');
  assert.equal(peers, [
    '## Swarm situation',
    'Peers (the seats already working beside you):',
    '- alpha — alpha lane — scope: impl/**',
    '- beta — beta lane — scope: impl/**',
    'Peers now:',
    '- alpha — holds nothing; last checkpoint: none recorded',
    '- beta — holds nothing; last checkpoint: none recorded',
  ].join('\n'), 'a pre-#441 brief composes byte-identically above the #529 wake block');
  assert.ok(wakeBlock !== undefined, 'the wake block is the only section the peers are followed by');
  assert.match(wakeBlock, /^1, newest first\):\n- \[seq \d+ · [a-z_]+ · ts \S+\]:/u,
    'and it is this swarm\'s own rows, newest first from the reference point');
  assert.doesNotMatch(section, /contributions recorded on this swarm/u,
    'the count line is absent — not zero — for a swarm with no contributions');
});
