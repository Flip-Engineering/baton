// Issue #490 — a recruit refused AFTER its Run was minted left those rows behind: the seat id could
// not be recruited again, and the next recruit of it met `goal_conflict`.
//
// The seam: `swarm.recruit` writes the seat's join and hands the deployment a Run id it spelled from
// the seat alone (`run-<hash([swarmId, participantId])>`, swarm-runtime.mjs `seatRunId`, #475). Run
// creation mints that Run's Goal under the fixed idempotency key `application:<runId>:goal:v1`
// (application.mjs `start`), whose request digest covers the Goal's OBJECTIVE — the seat's composed
// brief, a text that moves with the swarm. An attempt that refused after that mint (the live case:
// the leg AFTER the run start — the package attach, which rolled nothing back either) left a Goal
// bound to one request; the next recruit of the same seat spelled the same Run and the same key with
// a different digest, and the store refused `goal_conflict` ("goal idempotency key is bound
// differently"). #308's contract — a repeated recruit of the same id RESUMES the rolled-back join —
// therefore held only while the refusal landed before the mint.
//
// What this suite pins, on the REAL stack (a real driver with a real Goal/Plan authority and a real
// Context Program, a real BatonApplication and the swarm runtime the deployment builds, driven
// through the SDK):
//
//   490-a  a recruit refused at the package attach — AFTER the run start, so the Run's Goal and Plan
//          are minted — settles the seat and its Run together: one `swarm.participant_left
//          {reason: 'recruit_refused', code, runId}` row (#350's settle fold), the Run stopped with
//          the refusal as its cause, and the seat's projection carrying the Run's
//          `settledRun {runId, terminalCause {code, at}}`;
//   490-b  the SAME seat id is free: the next recruit is admitted, runs its OWN Run (the withdrawn
//          attempt keeps the one Goal it minted, under its own key), and its receipt names the
//          superseded Run (`supersedes {runId, refusedAt, code}`);
//   490-c  `goal_conflict` still fires when the Run the recruit names holds a Goal bound to another
//          request, and crosses TYPED as the family's `swarm_recruit_run_conflict`, naming the Run,
//          the Goal, the ledger row that holds them and the remedy in `next` — never the bare store
//          code, and never the web layer's fixed "goal/plan state conflict" text alone;
//   490-d  each attempt names the Run its own operation identity keys (so a lost response re-admits
//          one Run, never two), an ordinary leave (a stop) is still un-resumable, and a repeatedly
//          refused seat's third generation is a third Run;
//   490-e  the seat's Run is what the probe lane reads: a `route.probe_admitted` row names the Run it
//          admitted, and a row recorded before that field existed reads through the seat spelling.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git repositories, no provider
// process. Every await on a settle chain carries a declared bound (docs/42 §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { canonicalJson } from '../src/canonical-order.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue490',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    // #362: a recruit's run objective IS its whole composed brief, and the deployment's own
    // policy draws this bound from the objective lane (application-deployment.mjs). The brief's
    // age-scaling situation blocks are each bounded by `brief.situation.bytes` (8192 bytes), so a
    // literal below the brief's own budget cannot admit the objective this fixture composes.
    maxTextBytes: FRAME_LIMITS['run.objective'].value, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-issue490',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
/** A second route, so a hand-staged episode is its own: the probe lane keys an episode by route. */
const ROUTE_B = Object.freeze({ harness: 'mock', model: 'model-b', effort: 'low' });
const OWNER = Object.freeze({ actor: 'direct:orchestrator', principalId: 'orchestrator', sessionId: 'orchestrator-session' });
const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

const selection = { exact: { ...ROUTE }, scope: ['impl/**'] };

function configuredAdapter(scenario) {
  const adapter = new MockAdapter({ harness: 'mock', scenario });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

/** The deployment's own `applicationError` shape (application.mjs): a coded Error, so an injected
 * refusal is spelled the way the deployment spells its own. */
const codedError = (message, code) => Object.assign(new Error(message), { code });

/** docs/42 §8: an await that outlives its declared bound fails the row naming the wait it abandoned,
 * rather than leaving a promise hanging over every row after it. */
const bound = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_resolve, reject) => setTimeout(() => reject(Object.assign(
    new Error(`fixture_wait_unsettled: ${label} never settled within ${ms}ms`),
    { code: 'fixture_wait_unsettled' },
  )), ms).unref?.()),
]);

/** Wait for a dispatched participant to reach its paused seat. */
async function seated(driver, runId) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const worker = driver.coordinator.list().find((row) => row.runId === runId);
    if (worker && driver.coordination.eventsView().some((event) => event.payload?.kind === 'swarm.turn_reported' && event.payload.workerId === worker.id)) return worker;
    if (Date.now() >= deadline) {
      throw Object.assign(new Error(`fixture_wait_unsettled: a seat for ${runId} within 5000ms`),
        { code: 'fixture_wait_unsettled' });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// ── the Context Program the package-attach leg needs ───────────────────────────────────────────

/** The content resolver: each branch ref resolves exactly once at admission and every read
 * revalidates through it (the reflex3-packages-red.test.mjs shape, as issue441 reuses it). */
const sources = new Map();
const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value);
const digestOf = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const contextProgram = Object.freeze({
  environmentDigest: '2'.repeat(64),
  policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  referenceIdentity: '3'.repeat(64),
  referenceRead: (reference) => {
    const fromSource = reference.kind === 'context_source';
    const key = fromSource ? reference.ref : reference.handle;
    const table = fromSource ? sources : new Map();
    if (!table.has(key)) {
      throw Object.assign(new Error('context package content is unavailable'),
        { code: 'context_artifact_unavailable' });
    }
    return table.get(key);
  },
  sourceAttest: () => { throw new Error('this fixture attests no context source'); },
});

/** ONE admitted ContextPackage whose only branch is a source value the resolver holds — what the
 * root's own `package.admit` port leaves in the ledger before a recruit names its digest. */
function admitPackage(driver) {
  const content = ['Issue #490 — a refused recruit settles its Run', '', 'The attach leg.'];
  const contentDigest = digestOf(content);
  const ref = `ctx:sha256:${contentDigest}`;
  sources.set(ref, content);
  const admitted = driver.coordination.admitContextPackage({
    schemaVersion: 1,
    kind: 'baton.context_package',
    branches: [{
      name: 'issue:490', artifact: null, valueRef: null, schema: null,
      source: { kind: 'context_source', ref, digest: contentDigest,
        mediaType: 'application/vnd.baton.context-value+json', itemCount: content.length },
    }],
    provenance: { runId: 'run-root', principalId: OWNER.principalId },
    policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
  }, { actor: OWNER.actor, key: 'admit-issue:490' });
  return admitted.package.packageDigest;
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue490-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Issue 490 test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue490@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = configuredAdapter({ outcome: 'completed', delayMs: 5, summary: 'Contribution ready', files: {} });
  const driver = createDriver({ repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    deploymentBaseSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    contextProgram,
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000 });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => {
    await bound(app.shutdown(principal('cleanup')), 20_000, 'application.shutdown');
    rmSync(directory, { force: true, recursive: true });
  });
  await bound(app.ready, 20_000, 'application.ready');
  return { app, driver, adapter, runtime: app._swarmRuntime(),
    baton: bindBaton(app, principal('orchestrator')) };
}

const ledger = (driver) => driver.coordination.eventsView();
const ofKind = (driver, kind) => ledger(driver).filter((event) => event.kind === kind);
const driverRows = (driver, kind) => ledger(driver).filter((event) => event.kind === 'driver.recorded'
  && event.payload?.kind === kind).map((event) => event.payload);
const goalsOfRun = (driver, runId) => ofKind(driver, 'goal.version_defined')
  .filter((event) => event.payload?.goal?.runId === runId);
const seatRow = (driver, swarmId, participantId) =>
  driver.coordination.swarm(swarmId)?.participants?.[participantId] ?? null;
/** The repository's canonical digest, so a row can name the Run one recruit attempt uses without
 * reading its join row: the runtime keys a seat's Run by the attempt's own operation identity —
 * `seatRunId(swarmId, participantId, swarm-operation:<hash([command, swarmId, principalId,
 * idempotencyKey])>)` — which a same-key replay re-derives identically. */
const hashOf = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
const attemptRunId = (swarmId, participantId, idempotencyKey) => `run-${hashOf([swarmId, participantId,
  `swarm-operation:${hashOf(['swarm.recruit', swarmId, OWNER.principalId, idempotencyKey])}`,
]).slice(0, 32)}`;

/** The spelling a seat's Run carried before #490 — what a `route.probe_admitted` row recorded
 * without a `runId` reads as, because it is the only spelling in use then. */
const legacySeatSpelling = (swarmId, participantId) =>
  `run-${hashOf([swarmId, participantId]).slice(0, 32)}`;

const recruit = (swarm, participantId, objective, { selection: extra = null, idempotencyKey } = {}) =>
  swarm.recruit(participantId, objective, {
    ...(extra === null ? { ...selection } : { options: { ...selection, ...extra } }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }).then((answer) => ({ answer }), (error) => ({ error }));

/** The Goal an EARLIER attempt minted for one Run, defined the way the deployment defines it: the
 * same `application:<runId>:goal:v1` idempotency key, the deployment's own profile constraint, and a
 * different request. This is the ledger state a re-recruit met before #490 — and the state a
 * re-attempt of an attempt that never rolled back meets still. */
const mintGoalFor = (app, driver, runId, objective) => driver.coordinator.defineGoal({
  objective,
  definitionOfDone: [...profile.definitionOfDone],
  constraints: [...profile.constraints,
    `Baton deployment profile standard@${app._profile('standard').digest}`],
  risk: profile.risk,
  budget: { ...profile.goalBudget },
  predecessor: null,
}, { ...OWNER, powers: ['goal:define'], repoId: policy.repoId, runId,
  idempotencyKey: `application:${runId}:goal:v1` });

// ── 490-a: a refused recruit settles the seat and its Run ──────────────────────────────────────

test('490-a: a recruit refused at the package attach settles its Run through the ONE leave row', async (t) => {
  const { driver, baton } = await fixture(t);
  const packageDigest = admitPackage(driver);
  // The refusal this issue is about lands at the leg AFTER the run start: the run's Goal and Plan are
  // minted, the seat is bound, and the attach of the context package the recruit named refuses.
  const attach = driver.coordination.attachContextPackage.bind(driver.coordination);
  let attachRefusals = 1;
  driver.coordination.attachContextPackage = (...args) => {
    if (attachRefusals > 0) {
      attachRefusals -= 1;
      throw codedError('Context package is unavailable', 'context_package_not_found');
    }
    return attach(...args);
  };
  const swarm = await baton.swarms.create('A refused recruit settles its Run', { swarmId: 's-490' });
  const refused = await recruit(swarm, 'ghost', 'first attempt',
    { selection: { contextPackage: { digest: packageDigest } } });
  assert.equal(refused.error?.code, 'context_package_not_found', 'the caller reads the refusal that settled it');
  const runId = seatRow(driver, 's-490', 'ghost').runId;
  assert.equal(goalsOfRun(driver, runId).length, 1,
    'the refused attempt had already minted its Run\'s Goal — the state every leg past the run start leaves');
  // ONE row settles both: the seat's membership (#350's fold) and the Run it names.
  const withdrawn = seatRow(driver, 's-490', 'ghost');
  assert.equal(withdrawn.status, 'left', 'the join was rolled back');
  assert.equal(withdrawn.leftReason, 'recruit_refused', 'as the #308 rollback spells it');
  assert.equal(withdrawn.leftCode, 'context_package_not_found', 'the leave carries the typed refusal');
  assert.equal(withdrawn.runId, runId, 'and the seat still holds the Run it was admitted under');
  assert.equal(withdrawn.settledRun?.runId, runId, 'the leave SETTLED that Run');
  assert.equal(withdrawn.settledRun?.terminalCause?.code, 'context_package_not_found',
    'the Run\'s terminal cause is the refusal (#490: `terminalCause {code, at}`)');
  assert.equal(typeof withdrawn.settledRun?.terminalCause?.at, 'string', 'with the instant the row carries');
  assert.equal(withdrawn.settledRun.terminalCause.at, withdrawn.ts, 'which is the leave row\'s own ts');
  const leaveRows = ofKind(driver, 'swarm.participant_left').filter((event) => event.payload?.runId === runId);
  assert.equal(leaveRows.length, 1, 'exactly ONE row carried the settlement — never a second cleanup path');
  // The Run is stopped, and the stop names the refusal as its cause.
  const stop = driver.coordination.runStop(runId);
  assert.equal(stop?.status, 'stopped', 'the withdrawn Run reads stopped');
});

// ── 490-b: the seat id is free, and the receipt names what it superseded ───────────────────────

test('490-b: the same seat id admits on its own Run, and the receipt names the withdrawn one', async (t) => {
  const { driver, baton } = await fixture(t);
  const packageDigest = admitPackage(driver);
  const attach = driver.coordination.attachContextPackage.bind(driver.coordination);
  let attachRefusals = 1;
  driver.coordination.attachContextPackage = (...args) => {
    if (attachRefusals > 0) {
      attachRefusals -= 1;
      throw codedError('Context package is unavailable', 'context_package_not_found');
    }
    return attach(...args);
  };
  const swarm = await baton.swarms.create('The seat id is free', { swarmId: 's-490b' });
  const refused = await recruit(swarm, 'ghost', 'first attempt',
    { selection: { contextPackage: { digest: packageDigest } } });
  assert.equal(refused.error?.code, 'context_package_not_found');
  const withdrawnRun = seatRow(driver, 's-490b', 'ghost').runId;
  const refusedAt = seatRow(driver, 's-490b', 'ghost').ts;

  // The next recruit of the SAME seat id — a different objective, a new attempt — is admitted. It
  // never meets `goal_conflict`: its Run is its own, so the withdrawn Run keeps the one Goal its
  // attempt minted.
  const admitted = await recruit(swarm, 'ghost', 'second attempt');
  assert.equal(admitted.error, undefined,
    `the seat id is free: ${admitted.error?.code ?? ''} ${admitted.error?.message ?? ''}`);
  assert.notEqual(admitted.answer.runId, withdrawnRun, 'the re-joined seat runs its own Run');
  assert.deepEqual(admitted.answer.supersedes,
    { runId: withdrawnRun, refusedAt, code: 'context_package_not_found' },
    'the receipt names the Run it superseded, the instant its refusal was recorded, and its code');
  await bound(seated(driver, admitted.answer.runId), 10_000, 'the re-joined seat');
  const withdrawnGoals = goalsOfRun(driver, withdrawnRun);
  assert.equal(withdrawnGoals.length, 1, 'the withdrawn Run keeps exactly the Goal it minted');
  assert.equal(withdrawnGoals[0].idempotencyKey, `application:${withdrawnRun}:goal:v1`);
  const newGoals = goalsOfRun(driver, admitted.answer.runId);
  assert.equal(newGoals.length, 1, 'the re-joined seat minted its own Goal');
  assert.equal(newGoals[0].idempotencyKey, `application:${admitted.answer.runId}:goal:v1`);
  assert.match(newGoals[0].payload.goal.objective, /second attempt/);
  assert.equal(seatRow(driver, 's-490b', 'ghost').runId, admitted.answer.runId,
    'and the seat row names the Run it runs');
});

// ── 490-c: a Run that already holds a Goal crosses typed ───────────────────────────────────────

test('490-c: a `goal_conflict` at recruit names the Run, the Goal, the row and the remedy', async (t) => {
  const { app, driver, baton } = await fixture(t);
  const swarm = await baton.swarms.create('A Run whose Goal is bound elsewhere', { swarmId: 's-490c' });
  const idempotencyKey = 'issue490-conflict';
  const runId = attemptRunId('s-490c', 'ghost', idempotencyKey);
  // An earlier attempt minted this Run's Goal under the deployment's own key, for another request.
  const minted = await mintGoalFor(app, driver, runId, 'the request this Run is bound to');
  const refused = await recruit(swarm, 'ghost', 'the recruit that meets it', { idempotencyKey });
  assert.equal(refused.error?.code, 'swarm_recruit_run_conflict',
    'the conflict crosses as the swarm family\'s own spelling of the store\'s rule');
  assert.notEqual(refused.error?.code, 'goal_conflict', 'never the bare store code');
  const detail = refused.error?.detail ?? {};
  assert.equal(detail.runId, runId, 'the refusal names the Run');
  assert.deepEqual(detail.goal,
    { goalId: minted.goal.goalId, version: 1, digest: minted.goal.digest },
    'the Goal the Run holds');
  assert.equal(detail.row?.kind, 'goal.version_defined', 'and the ledger row that holds them');
  assert.equal(detail.row?.idempotencyKey, `application:${runId}:goal:v1`, 'by its own key');
  const row = ledger(driver).find((event) => event.seq === detail.row?.seq);
  assert.equal(row?.payload?.goal?.goalId, minted.goal.goalId, 'the row the refusal names is the row');
  assert.deepEqual(detail.next,
    { command: 'swarm.stop', args: { swarmId: 's-490c', participantId: 'ghost' },
      alternative: 'recruit the work under a fresh participant id' },
    'the remedy is the caller\'s own');
  const rolled = seatRow(driver, 's-490c', 'ghost');
  assert.equal(rolled.status, 'left', 'and the refused join was rolled back, so no active phantom stays');
  assert.equal(rolled.leftReason, 'recruit_refused', 'the identity may re-join, on a Run of its own');
  assert.equal(rolled.settledRun?.terminalCause?.code, 'goal_conflict',
    'the Run the seat named reads settled by the conflict the deployment gave');
  // The row the #430 derivation pin reads: the family's closed set holds the code with the runtime
  // as its raiser, at the conflict class.
  assert.equal(SWARM_REFUSAL_CODES.swarm_recruit_run_conflict?.status, 409);
  assert.deepEqual([...SWARM_REFUSAL_CODES.swarm_recruit_run_conflict.raisedBy], ['runtime']);
});

// ── 490-d: the identity rules around it are unchanged ─────────────────────────────────────────

test('490-d: one Run per attempt, a stop stays un-resumable, and every generation is its own', async (t) => {
  const { app, driver, baton } = await fixture(t);
  const swarm = await baton.swarms.create('Leaves and re-joins', { swarmId: 's-490d' });
  // A seat that LEFT through an ordinary stop keeps the incumbent rule: the identity is taken.
  const settled = await recruit(swarm, 'stopped', 'Do the work', { idempotencyKey: 'stopped-1' });
  assert.equal(settled.error, undefined);
  assert.equal(settled.answer.runId, attemptRunId('s-490d', 'stopped', 'stopped-1'),
    'a recruit names the Run its own operation identity keys');
  await bound(seated(driver, settled.answer.runId), 10_000, 'the first seat');
  await bound(swarm.stop('stopped', 'No longer needed'), 20_000, 'swarm.stop');
  const again = await recruit(swarm, 'stopped', 'Do the work again', { idempotencyKey: 'stopped-2' });
  assert.equal(again.error?.code, 'swarm_participant_exists', 'a stopped seat is not resumed by a recruit');
  assert.equal(again.error?.detail?.status, 'left');
  // Three attempts of one seat, three Runs: each attempt names the Run its own operation keys.
  const approve = app.approve.bind(app);
  let refusals = 2;
  app.approve = async (...args) => {
    if (refusals > 0) {
      refusals -= 1;
      throw codedError('Participant planning has not completed', 'application_run_incomplete');
    }
    return approve(...args);
  };
  const first = await recruit(swarm, 'ghost', 'attempt one', { idempotencyKey: 'ghost-1' });
  assert.equal(first.error?.code, 'application_run_incomplete');
  const second = await recruit(swarm, 'ghost', 'attempt two', { idempotencyKey: 'ghost-2' });
  assert.equal(second.error?.code, 'application_run_incomplete',
    'the second attempt is refused by the deployment, never by its own withdrawn rows');
  const secondRefusedAt = seatRow(driver, 's-490d', 'ghost').ts;
  assert.equal(seatRow(driver, 's-490d', 'ghost').settledRun?.terminalCause?.at, secondRefusedAt,
    'the second attempt settled its Run with the refusal the deployment gave');
  const third = await recruit(swarm, 'ghost', 'attempt three', { idempotencyKey: 'ghost-3' });
  assert.equal(third.error, undefined, `the third generation is admitted: ${third.error?.code ?? ''}`);
  const joins = ofKind(driver, 'swarm.participant_joined')
    .filter((event) => event.payload?.participantId === 'ghost' && event.payload?.swarmId === 's-490d')
    .map((event) => event.payload.runId);
  assert.deepEqual(joins,
    ['ghost-1', 'ghost-2', 'ghost-3'].map((key) => attemptRunId('s-490d', 'ghost', key)),
    'each attempt names the Run its own operation keys, and no two attempts share one');
  assert.equal(joins[2], third.answer.runId, 'the admitted generation is the join the ledger holds');
  assert.deepEqual(third.answer.supersedes,
    { runId: joins[1], refusedAt: secondRefusedAt, code: 'application_run_incomplete' },
    'and the third generation names the second one it superseded');
  assert.equal(refusals, 0);
});

// ── 490-e: the probe lane reads the Run the admission names ────────────────────────────────────

/** One degraded route row in the shape the deployment's own route table publishes (#316/#456): the
 * episode is DUE (its clear instant has passed), so the next recruit on the route is its probe. */
const degradedRow = (at) => Object.freeze({
  route: Object.freeze({ ...ROUTE }),
  state: 'degraded',
  degraded: Object.freeze({
    route: Object.freeze({ ...ROUTE }), faultClass: 'quota',
    participants: Object.freeze(['w-1', 'w-2', 'w-3']), count: 3,
    since: new Date(at).toISOString(), clearsAt: new Date(at).toISOString(),
    window: Object.freeze({ from: new Date(at).toISOString(), to: new Date(at).toISOString() }),
    next: Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...ROUTE }) }),
  }),
});

test('490-e: a probe admission names the Run it admitted, and a pre-#490 row keeps the seat spelling', async (t) => {
  const { app, driver, baton, runtime } = await fixture(t);
  const approve = app.approve.bind(app);
  let refusals = 1;
  app.approve = async (...args) => {
    if (refusals > 0) {
      refusals -= 1;
      throw codedError('Participant planning has not completed', 'application_run_incomplete');
    }
    return approve(...args);
  };
  const episodeAt = new Date(Date.now() - 60_000).toISOString();
  runtime.deploymentSummary = () => ({
    workspace: null, hostCapacity: null, served: null, routeUsage: [degradedRow(episodeAt)],
  });
  const swarm = await baton.swarms.create('Probe admissions name their Run', { swarmId: 's-490e' });
  // The first probe is admitted and the deployment then refuses that recruit, so the episode's next
  // attempt is free again.
  const refused = await recruit(swarm, 'probe-seat', 'probe the route');
  assert.equal(refused.error?.code, 'application_run_incomplete');
  const firstAdmission = driverRows(driver, 'route.probe_admitted').at(-1);
  assert.equal(firstAdmission.participantId, 'probe-seat');
  assert.equal(firstAdmission.runId, seatRow(driver, 's-490e', 'probe-seat').runId,
    'the admission names the Run it admitted');
  // The re-join mints its own Run, and its own probe admission names THAT Run.
  const rejoined = await recruit(swarm, 'probe-seat', 'probe the route again');
  assert.equal(rejoined.error, undefined, `${rejoined.error?.code ?? ''} ${rejoined.error?.message ?? ''}`);
  const secondAdmission = driverRows(driver, 'route.probe_admitted').at(-1);
  assert.equal(secondAdmission.runId, rejoined.answer.runId,
    'the second admission names the re-joined generation\'s Run');
  assert.notEqual(secondAdmission.runId, firstAdmission.runId,
    'which is not the withdrawn generation\'s Run');
  // A row recorded BEFORE this change carries no Run on its payload: the lane resolves it through the
  // seat spelling, which is the Run every such row was admitted on.
  const legacyRunId = legacySeatSpelling('s-490e', 'legacy-seat');
  const legacyEpisode = new Date(Date.now() - 20 * 60_000).toISOString();
  driver.coordination.recordDriver('route.probe_admitted', {
    route: { ...ROUTE_B }, at: new Date(Date.now() - 10 * 60_000).toISOString(), reason: 'probe_due',
    episodeAt: legacyEpisode, attempt: 1, clearsAt: null, probeAfter: null,
    swarmId: 's-490e', participantId: 'legacy-seat',
  }, { actor: 'policy', key: 'route.probe_admitted:legacy' });
  driver.coordination.recordSwarm('swarm.participant_joined', {
    swarmId: 's-490e', participantId: 'legacy-seat', role: 'legacy', runId: legacyRunId,
    permissions: ['read'], brief: 'legacy',
  }, { actor: 'test', key: 'swarm-participant:legacy' });
  const list = driver.coordinator.list.bind(driver.coordinator);
  runtime.coordinator.list = () => [...list(), { id: 'w-legacy', runId: legacyRunId, status: 'working' }];
  try {
    const held = runtime._routeProbeHold({ route: { ...ROUTE_B }, clearsAt: legacyEpisode });
    assert.ok(held !== null, 'the legacy admission holds its episode');
    assert.equal(held.participantId, 'legacy-seat');
    assert.equal(held.inFlight, false, 'its instant is past the probe deadline');
    assert.equal(held.released, false,
      'and the live seat still holds it: the lane read the seat spelling the row was admitted under');
  } finally { runtime.coordinator.list = list; }
});
