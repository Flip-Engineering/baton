// Issue #441 lane B — the seat's READ verbs, driven through the REAL bridge a seated participant
// calls (the light SwarmRuntime harness of swarm-runtime.test.mjs: a real coordination store, a
// coordinator double, a real checkout on disk; plus the bridge `swarm-native-bridge.test.mjs`
// exercises). Deliverables, each red before this change:
//   (a) `run.package.read` — a package attached to the seat's run is readable by digest (the branch
//       list) and by branch name (one branch's text, through the ONE projection the MCP leg serves);
//       a digest that is not attached to the caller's run or swarm refuses typed, and a branch that
//       does not exist on an attached package names itself;
//   (b) `run.contributions.read` — the swarm's contributions since a seq, in ledger order, each
//       carrying its files and the review state the durable rows derive; nothing at or before the
//       seq it names, and the cursor it answers with walks the list with no gap;
//   (c) `run.peers.read` — the other seats that can act, with what they hold and their last
//       checkpoint, and never the caller; it spawns NO process (the control below proves the same
//       runtime really does spawn for the live workspace reads, #438);
//   (d) the closed seat verb set and the brief's Swarm section teach exactly the three new verbs,
//       with one usage row each;
//   (e) every verb runs contract admission BEFORE any runtime effect: an unknown argument key (and
//       an identity-shaped one) refuses typed, with the admitted fields on the refusal.
//
// The spawn guard must be installed before ANY import that reads `child_process.spawnSync` by name:
// this file's own imports below are dynamic for exactly that reason (an ESM namespace snapshots a
// builtin's named exports when the module is first linked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const realSpawnSync = childProcess.spawnSync;
let spawns = 0;
childProcess.spawnSync = (...args) => { spawns += 1; return realSpawnSync(...args); };
const spawnCount = () => spawns;

const { CoordinationStore } = await import('../src/coordination-store.mjs');
const { DEFAULT_CONTEXT_PROGRAM_POLICY } = await import('../src/context-program-policy.mjs');
const { createSwarmNativeBridge, swarmBridgeCommand } = await import('../src/swarm-native-bridge.mjs');
const { SWARM_KNOWLEDGE_COMMAND_NAMES } = await import('../src/swarm-contract.mjs');
const runtimeModule = await import('../src/swarm-runtime.mjs');
const accessModule = await import('../src/swarm-native-access.mjs');
const { SwarmRuntime } = runtimeModule;
// Red-before: at the pre-landing HEAD neither the verb table nor the advertised seat verb set
// exists, so the rows assert their existence themselves instead of failing to import the file.
const SWARM_SEAT_READ_COMMAND_NAMES = runtimeModule.SWARM_SEAT_READ_COMMAND_NAMES ?? null;
const SWARM_SEAT_READ_COMMANDS = runtimeModule.SWARM_SEAT_READ_COMMANDS ?? null;
const SWARM_SEAT_VERB_NAMES = accessModule.SWARM_SEAT_VERB_NAMES ?? null;
const { SWARM_NATIVE_GUIDANCE, SWARM_BRIEF_SECTION } = accessModule;

const SWARM_ID = 'swarm-441b';
const WORKER_SHA = 'a'.repeat(40);
const owner = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
const workerPrincipal = (workerId) => Object.freeze({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: `${workerId}-session`,
});
const policy = DEFAULT_CONTEXT_PROGRAM_POLICY;

const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const digestOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function git(cwd, args) {
  const ran = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr ?? ''}`);
  return ran.stdout ?? '';
}

/** One branch whose content is an artifact the resolver holds: {name, digest, bytes} is what the
 * digest read projects, and the artifact is what the branch read projects. */
function artifactBranch(name, res, content) {
  const artifactDigest = digestOf(content);
  const handle = `art:sha256:${artifactDigest}`;
  res.artifacts.set(handle, content);
  return {
    name, source: null, valueRef: null, schema: null,
    artifact: { kind: 'context_value', digest: artifactDigest, handle,
      mediaType: 'application/vnd.baton.context-value+json',
      bytes: Buffer.byteLength(JSON.stringify(content)) },
  };
}

const packageFields = (branches) => ({
  schemaVersion: 1, kind: 'baton.context_package', branches,
  provenance: { runId: 'run-root', principalId: 'owner' },
  policyDigest: policy.policyDigest,
});

async function fixture(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue441b-${label}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // A real checkout per seat: the live workspace reads really do spawn git against it, so the
  // zero-spawn assertion in (c) is measured against a runtime that CAN spawn.
  const repo = join(directory, 'checkout');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 441b']);
  git(repo, ['config', 'user.email', 'issue441b@example.invalid']);
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'seed']);
  // The deployment's content resolver (reflex3-packages-red.test.mjs's shape): the package
  // admission resolves every branch ref exactly once through it, and resolve-time revalidates.
  const resolver = { sources: new Map(), artifacts: new Map() };
  const store = new CoordinationStore(join(directory, 'coordination'), {
    repoId: 'repo-issue441b', deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: policy,
    contextEnvironmentDigest: '2'.repeat(64), contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: (reference) => {
      const fromSource = reference.kind === 'context_source';
      const key = fromSource ? reference.ref : reference.handle;
      const table = fromSource ? resolver.sources : resolver.artifacts;
      if (!table.has(key)) {
        throw Object.assign(new Error('context package content is unavailable'),
          { code: 'context_artifact_unavailable' });
      }
      return table.get(key);
    },
    contextSourceAttest: () => { throw new Error('the seat read verbs never attest a source'); },
    clock: () => '2026-09-18T00:00:00.000Z',
  });
  const workers = [];
  const captures = new Map();
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused
      ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    captureContribution: async (workerId, { contributionId }) => {
      const captured = { contributionId, workerId, sha: WORKER_SHA, ref: `refs/baton/checkpoints/${WORKER_SHA}` };
      captures.set(`${workerId}:${contributionId}`, captured);
      return captured;
    },
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    // The prepared intent the deployment resolves: the route and scope a seat was recruited under
    // (what the view and the peers read project from the join).
    prepareRun: async (request) => ({ ...request,
      route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] }),
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', paused: true, sessionContext: { worktree: repo, repoRoot: repo } });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => runtime.command(command, args, principal, context),
  });
  t.after(() => bridge.close());
  const command = (name, args, caller = owner) => runtime.command(name, args, caller);
  const bridgeFor = async (participantId, runId) => {
    const issued = await bridge.issue({ swarmId: SWARM_ID, participantId, runId });
    return (name, args = {}) => swarmBridgeCommand({ command: name, args }, { env: issued.env });
  };
  return { directory, repo, store, runtime, bridge, command, bridgeFor, workers, resolver };
}

/** One swarm, two seats, one accepted contribution by beta (with a captured revision), work held
 * by beta: the world a seat reads. Returns the handles the rows drive. */
async function swarmFixture(t, label) {
  const f = await fixture(t, label);
  await f.command('swarm.create', { swarmId: SWARM_ID, purpose: 'Read the world the seat works in', idempotencyKey: 'create' });
  await f.command('swarm.recruit', { swarmId: SWARM_ID, participantId: 'alpha', objective: 'Read it',
    permissions: ['read', 'communicate', 'contribute', 'review'], idempotencyKey: 'recruit-alpha' });
  await f.command('swarm.recruit', { swarmId: SWARM_ID, participantId: 'beta', objective: 'Write it',
    permissions: ['read', 'contribute'], idempotencyKey: 'recruit-beta' });
  const swarm = f.store.swarm(SWARM_ID);
  const alphaRunId = swarm.participants.alpha.runId;
  const betaRunId = swarm.participants.beta.runId;
  const betaWorker = f.workers.find((row) => row.runId === betaRunId);
  const alphaWorker = f.workers.find((row) => row.runId === alphaRunId);
  const update = (event, payload, caller, idempotencyKey) => f.command('swarm.update',
    { swarmId: SWARM_ID, event, payload, idempotencyKey }, caller);
  // beta's landed work, with the files it names and a captured revision (the checkpoint).
  await update('swarm.contribution_recorded', { contributionId: 'c-1', participantId: 'beta',
    body: {
      subject: 'Lane scope guard holds on shared checkouts',
      base: { observedHead: WORKER_SHA, rebasedOnto: WORKER_SHA },
      commit: null,
      items: [{ id: 'scope-guard', status: 'delivered', change: 'Hold the scope guard',
        files: ['impl/src/kept.mjs'], test: 'node --test test/scope.test.mjs', evidence: 'suite green' }],
      verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
      carriedForward: ['the writer lease is released by the seat that took it'],
      needsFromOthers: [],
    } }, workerPrincipal(betaWorker.id), 'record-c-1');
  await update('swarm.contribution_recorded', { contributionId: 'c-2', participantId: 'beta',
    body: 'A second finding, still unreviewed.' }, workerPrincipal(betaWorker.id), 'record-c-2');
  await f.command('swarm.capture', { swarmId: SWARM_ID, participantId: 'beta', contributionId: 'c-1' },
    workerPrincipal(betaWorker.id));
  await update('swarm.contribution_reviewed', { contributionId: 'c-1', decision: 'accept',
    reason: 'Ready for integration.' }, workerPrincipal(alphaWorker.id), 'review-c-1');
  await update('swarm.work_updated', { workId: 'work-1', objective: 'Hold the scope guard' }, owner, 'work-1');
  await update('swarm.assignment_updated', { assignmentId: 'a-1', participantId: 'beta',
    workId: 'work-1', status: 'active' }, owner, 'assign-1');
  return { ...f, alphaRunId, betaRunId, alphaWorker, betaWorker };
}

test('441b-a: a package attached to the seat run reads by digest and by branch; an unattached digest refuses typed', async (t) => {
  const f = await swarmFixture(t, 'package');
  const beta = await f.bridgeFor('beta', f.betaRunId);
  const admitted = f.store.admitContextPackage(
    packageFields([artifactBranch('issue:441', f.resolver, { title: 'the reading half' })]),
    { actor: 'owner', key: 'admit-441' },
  );
  const packageDigest = admitted.package.packageDigest;
  f.store.attachContextPackage({ packageDigest, runId: f.betaRunId, scope: 'worker:beta' },
    { actor: 'owner', key: `package.attach:${packageDigest}:${f.betaRunId}:worker:beta` });
  // The branch list, by digest: name, digest and bytes — what the brief renders a digest of.
  const list = await beta('run.package.read', { packageDigest });
  assert.equal(list.swarmId, SWARM_ID);
  assert.equal(list.packageDigest, packageDigest);
  assert.deepEqual(list.branches, [{ name: 'issue:441',
    kind: 'artifact', digest: digestOf({ title: 'the reading half' }),
    bytes: Buffer.byteLength(JSON.stringify({ title: 'the reading half' })) }]);
  assert.equal(list.provenance.principalId, 'owner');

  // ONE branch's text, by name, through the ONE projection the MCP leg also serves: the untrusted
  // prose marker rides the answer, unread prose is never returned raw.
  const branch = await beta('run.package.read', { packageDigest, branchName: 'issue:441' });
  assert.equal(branch.branch.name, 'issue:441');
  assert.equal(branch.branch.provenance, 'untrusted');
  assert.match(branch.branch.artifact, /the reading half/u);

  // A digest nobody attached to this run or this swarm refuses typed — and does so without
  // disclosing whether the deployment holds it at all. (A runtime refusal crosses the bridge
  // verbatim: the "Nothing was recorded:" first line is the BRIDGE's own refusals' contract, and
  // this read's refusals are the runtime's — typed, with the correction that resolves them.)
  await assert.rejects(beta('run.package.read', { packageDigest: 'f'.repeat(64) }),
    (error) => error.code === 'package_not_attached_to_run'
      && error.detail?.participantId === 'beta' && /ask the root to attach/u.test(error.detail?.correction ?? ''));
  // A branch the attached package does not carry names itself.
  await assert.rejects(beta('run.package.read', { packageDigest, branchName: 'doc:missing' }),
    (error) => error.code === 'swarm_context_package_branch_not_found');

  // The seat's own run is the scope: a seat whose run never carried it cannot read it either.
  const alpha = await f.bridgeFor('alpha', f.alphaRunId);
  const crossRead = await alpha('run.package.read', { packageDigest });
  assert.equal(crossRead.branches.length, 1,
    'the scope is the CALLER run or its swarm: a peer of the same swarm reads the same package');
});

test('441b-b: contributions.read answers the swarm fold since a seq, in order, and nothing before it', async (t) => {
  const f = await swarmFixture(t, 'contributions');
  const beta = await f.bridgeFor('beta', f.betaRunId);

  const all = await beta('run.contributions.read');
  assert.deepEqual(all.rows.map((row) => row.contributionId), ['c-1', 'c-2'], 'ledger order');
  assert.deepEqual(all.rows.map((row) => row.seq), [...all.rows.map((row) => row.seq)].sort((a, b) => a - b));
  assert.deepEqual(all.rows.map((row) => row.participantId), ['beta', 'beta']);
  // The accepted row carries what it names and the review state the durable rows derive.
  assert.equal(all.rows[0].reviewState, 'accepted');
  assert.equal(all.rows[0].decision, 'accept');
  assert.equal(all.rows[0].summary, 'Lane scope guard holds on shared checkouts');
  assert.deepEqual(all.rows[0].files,
    ['impl/src/kept.mjs', `refs/baton/checkpoints/${WORKER_SHA}`],
    'the files the row names: its contract items\u2019 files plus the refs it carries');
  // The unreviewed one says so rather than reading as accepted.
  assert.equal(all.rows[1].reviewState, 'unreviewed');
  assert.equal(all.rows[1].decision, null);
  assert.equal(all.rows[1].summary, 'A second finding, still unreviewed.');
  assert.equal(all.cursor, all.rows[1].seq, 'the cursor is the last carried row seq');
  assert.equal(all.truncated, false);

  // Strictly after the seq it names: the row at that seq is NOT in the answer, so walking the
  // cursor pages the list with no gap and no duplicate.
  const after = await beta('run.contributions.read', { since: all.rows[0].seq });
  assert.deepEqual(after.rows.map((row) => row.contributionId), ['c-2']);
  const drained = await beta('run.contributions.read', { since: all.cursor });
  assert.deepEqual(drained.rows, []);
  assert.equal(drained.cursor, all.cursor);
});

test('441b-c: peers.read lists the other live seat with its checkpoint, never the caller, and spawns nothing', async (t) => {
  const f = await swarmFixture(t, 'peers');
  const alpha = await f.bridgeFor('alpha', f.alphaRunId);

  const before = spawnCount();
  const peers = await alpha('run.peers.read');
  assert.equal(spawnCount(), before, 'a peers read spawns NO process (#438: no live workspace read)');

  assert.equal(peers.caller.participantId, 'alpha');
  assert.deepEqual(peers.peers.map((row) => row.participantId), ['beta'], 'the caller is never its own peer');
  const [beta] = peers.peers;
  assert.equal(beta.status, 'active');
  assert.equal(beta.runtime.live, true, 'the liveness word is the ONE derivation');
  assert.deepEqual(beta.runtime.state, 'working');
  assert.deepEqual(beta.scope, ['impl/**']);
  assert.equal(beta.route.harness, 'mock');
  // The checkpoint the captured revision pinned, with its ledger-distance age (never a clock).
  assert.equal(beta.lastCheckpoint.sha, WORKER_SHA);
  assert.equal(beta.lastCheckpoint.ref, `refs/baton/checkpoints/${WORKER_SHA}`);
  assert.equal(beta.lastCheckpoint.summary, 'Lane scope guard holds on shared checkouts');
  assert.ok(beta.lastCheckpoint.age.seqs >= 0 && peers.at.seq >= beta.lastCheckpoint.seq);
  // What the seat holds NOW, from the fold's assignments and couplings.
  assert.deepEqual(beta.holds.filter((row) => row.kind === 'work'), [
    { kind: 'work', assignmentId: 'a-1', workId: 'work-1' },
  ]);
  // The control for the zero above: the SAME runtime, the same seats, the same bridge — the view's
  // live workspace reads really do spawn (branch, HEAD, status, base per seat), so the peers read's
  // silence is a measured property of that read and not of an inert fixture.
  const viewBefore = spawnCount();
  await alpha('swarm.view', { swarmId: SWARM_ID, projection: 'workspace' });
  assert.ok(spawnCount() > viewBefore, 'the live workspace reads still spawn (the control)');
});

test('441b-d: the closed seat verb set and the brief teach exactly the three new read verbs', () => {
  assert.ok(SWARM_SEAT_READ_COMMAND_NAMES !== null && SWARM_SEAT_READ_COMMANDS !== null,
    'the seat read verb table must exist in swarm-runtime.mjs (issue #441 lane B)');
  assert.ok(SWARM_SEAT_VERB_NAMES !== null,
    'the advertised seat verb set must exist in swarm-native-access.mjs (issue #441 lane B)');
  const names = [...SWARM_SEAT_READ_COMMAND_NAMES].sort();
  assert.deepEqual(names, ['run.contributions.read', 'run.package.read', 'run.peers.read']);
  assert.deepEqual([...SWARM_SEAT_VERB_NAMES].sort(),
    [...SWARM_KNOWLEDGE_COMMAND_NAMES, ...names].sort(),
    'the advertised seat verb set is the knowledge verbs plus exactly these three');
  for (const name of names) {
    assert.equal(SWARM_SEAT_READ_COMMANDS[name].permission, 'read', `${name} is a read verb`);
    assert.match(SWARM_NATIVE_GUIDANCE, new RegExp(`\\n- ${name} \\[read\\] — \\S`, 'u'),
      `${name} rides the brief's Swarm section with one usage row`);
    assert.ok(SWARM_BRIEF_SECTION.includes(name), `${name} is in the rendered brief section`);
  }
  assert.equal(SWARM_BRIEF_SECTION.startsWith(SWARM_NATIVE_GUIDANCE), true,
    'the section stays the ONE derivation of the guidance');
});

test('441b-e: every seat read verb refuses an unknown argument key typed, before any runtime effect', async (t) => {
  const f = await swarmFixture(t, 'contract');
  const beta = await f.bridgeFor('beta', f.betaRunId);
  const cases = [
    ['run.package.read', { packageDigest: 'a'.repeat(64), branch: 'issue:441' }, 'branch', 'branchName'],
    ['run.contributions.read', { afterSeq: 3 }, 'afterSeq', 'since'],
    ['run.peers.read', { participantId: 'beta' }, 'participantId', null],
  ];
  for (const [name, args, field, admitted] of cases) {
    await assert.rejects(beta(name, args), (error) => {
      assert.equal(error.code, 'swarm_command_invalid', `${name} refuses the unknown key by code`);
      assert.equal(error.detail?.rule, 'unknown-field');
      assert.equal(error.detail?.field, field);
      assert.ok(error.detail?.admitted?.includes('swarmId'), `${name} names the admitted fields`);
      if (admitted !== null) assert.ok(error.detail.admitted.includes(admitted), `${name} admits ${admitted}`);
      assert.match(error.message, /^Nothing was recorded: remove /u,
        'the refusal is actionable and says nothing was recorded');
      return true;
    });
  }
  // The run identity is the TOKEN's: a seat never supplies its own runId, and a foreign swarm is
  // refused by the token scope before any effect.
  await assert.rejects(beta('run.peers.read', { runId: 'run-forged' }),
    (error) => error.detail?.rule === 'identity-field');
  await assert.rejects(beta('run.peers.read', { swarmId: 'swarm-other' }),
    (error) => error.code === 'swarm_bridge_swarm_mismatch');
  // Contract admission precedes the runtime: the validators the bridge runs ARE the runtime's.
  await assert.rejects(beta('run.contributions.read', { since: 'soon' }),
    (error) => error.code === 'swarm_command_invalid' && error.detail?.rule === 'field-predicate');
});

test('441b-f: the bridge guidance states the contribution-id mechanism the fold enforces', async (t) => {
  const f = await swarmFixture(t, 'guidance');
  const publish = (idempotencyKey) => f.command('swarm.update', { swarmId: SWARM_ID,
    event: 'swarm.contribution_recorded',
    payload: { contributionId: 'finding-1', participantId: 'beta', body: 'the interface is artifact:iface' },
    idempotencyKey }, workerPrincipal(f.betaWorker.id));
  await publish('first');
  // The guidance a seat reads must state the mechanism the fold enforces: an id the swarm already
  // holds REFUSES, it never extends — so a correction is its own contribution (finding raised by
  // kimi-441 while reviewing this lane; the sentence shipped saying the opposite).
  await assert.rejects(publish('second'), (error) => error.code === 'contribution_duplicate',
    'a second record under the same contributionId refuses');
  assert.match(SWARM_NATIVE_GUIDANCE, /never extends/u);
  assert.match(SWARM_NATIVE_GUIDANCE, /`contribution_duplicate`/u);
  assert.doesNotMatch(SWARM_NATIVE_GUIDANCE, /name the same contributionId to extend/u);
});
