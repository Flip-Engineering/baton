// Issue #489 — on a long-lived swarm EVERY Run view crossed the deployment's projection ceiling,
// so `run show` refused at every depth (including the `--depth outline` its own refusal prescribed)
// and every `recruit --issue` refused `application_run_view_oversize` at the participant's start.
//
// Measured on the primary when the issue was filed: a seat's rendered brief was 170 996 B, of
// which the `## Swarm situation` section was 158 233 B — and the Run view then carried that
// objective more than once (`objective`, `planPreview.objective`, `planPreview.node.objective`,
// plus one copy per Plan node), which is how a 171 KB brief crosses a 512 KiB ceiling.
//
// The rows below pin the four repairs on the REAL seams — the fold behind the recruit brief, and a
// real BatonApplication behind the transport entry every surface (`web-northbound`, the CLI, MCP)
// funnels into:
//
//   489-a  the brief's `## Swarm situation` section draws ONE registry budget
//          (`brief.situation.bytes`) for the lists that grow with the swarm's AGE — the published
//          contracts and the commits since the base — whatever the swarm's history, and the settled
//          seats ride ONE line that counts them per reason and names the roster read;
//   489-b  the Run view carries the objective ONCE (`objective` + `objectiveBytes`), and the plan
//          preview and every Plan node carry only its REACH (the bounded first line + the pointer);
//   489-c  narrowing runs BEFORE the ceiling: `run show --depth outline|index|section|item` answers
//          for a run whose full view is over the ceiling, and the full read refuses naming the
//          section, its bytes and a narrowing that works;
//   489-d  the recruit's start and its package attach never depend on the full Run view: a seat is
//          admitted with a brief whose view exceeds the ceiling, and the attach answers from the
//          coordination store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication, CoordinationStore, MockAdapter, createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';

const MAX_RUN_VIEW_BYTES = FRAME_LIMITS['view.run.bytes'].value;
// The situation budget is a registry row this issue adds; read it tolerantly so a baseline without
// the row reports the rows below RED individually instead of failing the whole file on import.
const SITUATION_BYTES = FRAME_LIMITS['brief.situation.bytes']?.value
  ?? FRAME_LIMITS['context_package.brief_bytes'].value;
const ROLE_HEAD_BYTES = FRAME_LIMITS['view.role.head'].value;
const REPO_ID = 'repo-issue489';
const SWARM = 's-issue489';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const OWNER = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
const principal = (id) => Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue489-${label}-`));
  roots.push(root);
  return root;
}

// ── the brief fixture: a real store and the real runtime; only the native run is stubbed ────────

/** A swarm whose history can be inflated the way a long-lived swarm's really is: seats that joined
 * and settled, contracts published, commits landed on the target since the base. The runtime is the
 * production one (fold, brief composer, recruit); only the native run is stubbed, exactly as every
 * other brief-composition suite does. */
function briefingFixture(t, { commits = [], baseCommit = null } = {}) {
  const directory = scratch('brief');
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator,
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working' });
    },
    stopRun: async (runId) => {
      const worker = workers.find((row) => row.runId === runId);
      if (worker) worker.status = 'dead';
      return { state: 'closed' };
    },
    lastCrash: () => null,
    // The deployment's git authority (#318): the commits landed on the target since the base. A
    // fixture states them, so the block's own bound is what 489-a measures.
    situationGit: baseCommit === null ? null
      : { head: () => commits[0]?.sha ?? baseCommit, commitsSince: () => commits },
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'list' ? {} : { swarmId: SWARM }),
    ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `issue489-${++key}` }),
    ...args,
  }, OWNER);
  return { store, workers, runtime, call, baseCommit, participants: () => store.swarm(SWARM).participants };
}

/** One published contract — the shape the closed validator admits and the brief renders verbatim. */
function contractBody(label, itemBytes) {
  const filler = 'c'.repeat(itemBytes);
  return {
    subject: `Issue #489 fixture contract ${label}`,
    base: { observedHead: 'a'.repeat(40), rebasedOnto: 'a'.repeat(40) },
    commit: null,
    items: [{
      id: `item-${label}`, status: 'delivered', change: `Land the fixture item ${label} ${filler}`,
      files: [`impl/src/fixture-${label}.mjs`], test: `node --test test/fixture-${label}.test.mjs`,
      evidence: `suite green ${filler}`,
    }],
    verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
    carriedForward: [`carried-forward ${label} ${filler}`],
    needsFromOthers: [{ to: 'root', ask: `needs-from-others ${label} ${filler}` }],
  };
}

async function swarmWithHistory(f, { seats = 45, settled = 40, contracts = 40, itemBytes = 900 } = {}) {
  // The swarm's base is what the deployment's own git authority reports at create time (#318).
  await f.call('create', { purpose: 'Issue #489 brief budget' });
  for (let index = 0; index < seats; index += 1) {
    await f.call('recruit', { participantId: `seat-${String(index).padStart(2, '0')}`, objective: `Lane ${index}` });
  }
  for (let index = 0; index < settled; index += 1) {
    await f.call('stop', {
      participantId: `seat-${String(index).padStart(2, '0')}`,
      reason: index % 2 === 0 ? 'completed' : 'stopped',
    });
  }
  for (let index = 0; index < contracts; index += 1) {
    await f.call('update', {
      event: 'swarm.contribution_recorded',
      payload: {
        participantId: `seat-${String(index % seats).padStart(2, '0')}`,
        contributionId: `contribution-489-${index}`,
        body: contractBody(String(index), itemBytes),
      },
    });
  }
}

const situationSection = (brief) => {
  const start = brief.indexOf('## Swarm situation');
  assert.ok(start >= 0, 'the brief carries a ## Swarm situation section');
  const next = brief.indexOf('\n## ', start + 1);
  return next === -1 ? brief.slice(start) : brief.slice(start, next);
};

// ── 489-a: the situation section is bounded by the registry row, not by the swarm's age ─────────

test('489-a: a 45-seat swarm with 40 settled seats renders a bounded situation section that names the count', async (t) => {
  const f = briefingFixture(t, {
    baseCommit: 'e'.repeat(40),
    commits: Array.from({ length: 60 }, (_, index) => ({
      sha: String(index).padStart(2, '0').repeat(20), subject: `Landed change ${index} ${'m'.repeat(120)}`,
    })),
  });
  await swarmWithHistory(f);
  await f.call('recruit', { participantId: 'probe', objective: 'Read the situation' });
  const brief = f.participants().probe.brief;
  const situation = situationSection(brief);
  const bytes = Buffer.byteLength(situation, 'utf8');

  // The two age-scaling blocks draw ONE registry budget each (`brief.situation.bytes`); everything
  // else in the section is bounded by the seats that can act (#464's row budget per line), the one
  // settled line, the one contributions line and the route table — the 4096-byte slack. Measured
  // 17 208 B here against the 20 480 B bound, of which 16 250 B are the two bounded blocks.
  assert.ok(bytes <= SITUATION_BYTES * 2 + 4_096,
    `the situation section is ${bytes} bytes, over the ${SITUATION_BYTES * 2 + 4_096}-byte bound its `
    + 'two age-scaling blocks draw from brief.situation.bytes — the section must not grow with the '
    + 'age of the swarm');

  // The settled seats are ONE line, counted per reason, and the roster that holds them is named.
  const settledLine = situation.split('\n').find((line) => line.includes('since the base')) ?? '(none)';
  assert.match(settledLine,
    /^40 seats have completed or stopped since the base; their contributions are on the view — \d+ completed, \d+ stopped; read the seats with swarm view s-issue489 --projection participants$/u,
    'the settled history is one line, counted per reason, with the participants projection named');
  const counted = settledLine.match(/— (\d+) completed, (\d+) stopped;/u);
  assert.equal(Number(counted[1]) + Number(counted[2]), 40,
    'the per-reason counts add up to the settled seats the line names');
  // Seats that can act still render in full; a settled seat is never presented as a live peer.
  for (let index = 40; index < 45; index += 1) {
    assert.ok(situation.includes(`- seat-${String(index).padStart(2, '0')}`),
      `the seat that can act seat-${index} renders in full`);
  }
  assert.equal(situation.includes('- seat-00'), false, 'a settled seat is not a live peer');

  // The contract block is bounded, counts what it did not carry, and names the read that does.
  const contracts = situation.slice(situation.indexOf('Contracts published so far'));
  assert.match(contracts, /newest first/u, 'the block says the order its bound keeps');
  assert.match(contracts, /further contracts? not shown/u, 'the block counts what it did not show');
  assert.match(contracts, /bounded by brief\.situation\.bytes = \d+ bytes/u, 'the block names the registry row it draws');
  assert.match(contracts, /run\.contributions\.read/u, 'the block names the read that answers the rest');

  // The commits since the base are the deployment's fact, bounded by the same one row.
  const commitBlock = situation.slice(situation.indexOf('Commits landed on the target since the base'));
  assert.match(commitBlock, /further commits? not shown/u, 'the commit block counts what it did not show');
  assert.match(commitBlock, /bounded by brief\.situation\.bytes/u);
  assert.match(commitBlock, /git log [0-9a-f]{40}\.\.HEAD/u,
    'the commit block names the read a seat can run in its own checkout');
});

test('489-a2: the section does not grow with the swarm history it carries', async (t) => {
  const small = briefingFixture(t);
  await swarmWithHistory(small, { seats: 8, settled: 6, contracts: 3 });
  await small.call('recruit', { participantId: 'probe', objective: 'Read the situation' });

  const large = briefingFixture(t);
  await swarmWithHistory(large, { seats: 45, settled: 40, contracts: 40 });
  await large.call('recruit', { participantId: 'probe', objective: 'Read the situation' });

  const smallBytes = Buffer.byteLength(situationSection(small.participants().probe.brief), 'utf8');
  const largeBytes = Buffer.byteLength(situationSection(large.participants().probe.brief), 'utf8');
  assert.ok(largeBytes <= SITUATION_BYTES * 2,
    `the 45-seat section is ${largeBytes} bytes — bounded by the registry row, not by the 40 `
    + 'contracts and 40 settled seats the brief no longer spells out');
  assert.ok(largeBytes - smallBytes < SITUATION_BYTES,
    `the section grew ${largeBytes - smallBytes} bytes from 3 contracts to 40 and 6 settled seats to `
    + '40 — a bound that moves with the history is not a bound');
});

// ── the run-view fixture: a real application behind the transport entry ─────────────────────────

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 3_600_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    // #358: the objective lanes carry no head cap of their own — the fixture mirrors production so
    // the sizes below are admitted by the SAME policy the deployment publishes.
    maxTextBytes: FRAME_LIMITS['run.objective'].value, maxItems: 128, maxScopePaths: 128,
    maxRouteValues: 64, maxGoalBytes: 4 * 1024 * 1024, maxPlanBytes: 4 * 1024 * 1024,
    maxStatusBytes: 4 * 1024 * 1024, maxTokens: 1_000_000, maxUsd: 100,
    maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

function profile(definitionOfDone) {
  return Object.freeze({
    schemaVersion: 1, repoId: REPO_ID, definitionOfDone, constraints: [], risk: 'low',
    goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
    nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
    pathScope: ['**'],
    verification: {
      command: 'true', arguments: [], cwd: '.', envAllowlist: [],
      expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65_536,
      requiredPredecessorEvidence: [],
    },
    routes: [ROUTE], capabilities: ['code', 'test'],
    effects: ['provider_call', 'repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  });
}

async function applicationFixture(t, { definitionOfDone = ['the deployment verification passes'] } = {}) {
  const repo = scratch('repo');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'i489@example.invalid', GIT_COMMITTER_EMAIL: 'i489@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 489', GIT_COMMITTER_NAME: 'Issue 489' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'done', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: ['mock-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'issue489', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir: scratch('log'), adapters: { mock: adapter },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO_ID, profiles: { default: profile(definitionOfDone) },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'), dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  t.after(() => { application.shutdown(principal('shutdown')).catch(() => {}); });
  return { application, driver, repo };
}

/** The transport entry every surface funnels into — `web-northbound` and `mcp-northbound` both
 * call `application.command`, and the CLI client is a thin shape over it. */
const transport = (application) => {
  let calls = 0;
  return {
    command: (name, args, idempotencyKey = null) => {
      calls += 1;
      return application.command(name, args, principal('i489-operator'), {
        idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.length > 0
          ? idempotencyKey : `issue489:${name}:${calls}`,
        requestId: `issue489-request-${calls}`,
        transport: 'web',
      });
    },
    doctor: async () => application.doctorReadiness(),
  };
};

/** The seat's run, created through the REAL participant admission leg (start + approve), which is
 * the leg the issue's `recruit --issue` refused on. */
async function recruitedSeat(t, { briefBytes, definitionOfDone }) {
  const { application, driver } = await applicationFixture(t, { definitionOfDone });
  const runtime = application._swarmRuntime();
  await runtime.command('swarm.create', { swarmId: SWARM, purpose: 'Issue #489', idempotencyKey: 'issue489:create' }, OWNER);
  const objective = `Recruit brief ${'b'.repeat(briefBytes)}`;
  const receipt = await runtime.command('swarm.recruit', {
    swarmId: SWARM, participantId: 'seat-489', objective, idempotencyKey: 'issue489:recruit',
  }, OWNER);
  const seat = driver.coordination.swarm(SWARM).participants['seat-489'];
  return { application, driver, runtime, receipt, seat, objective };
}

// ── 489-b: the Run view carries the objective ONCE ──────────────────────────────────────────────

test('489-b: a 200 KB objective projects once — the preview and the nodes carry its reach, never a copy', async (t) => {
  const { application } = await applicationFixture(t);
  const objective = `OBJECTIVE-489 ${'o'.repeat(200_000)}`;
  const view = await application.start({
    runId: 'run-489-b', objective, profile: 'default', route: ROUTE, scope: ['**'],
  }, principal('owner'));

  assert.ok(Buffer.byteLength(JSON.stringify(view), 'utf8') <= MAX_RUN_VIEW_BYTES,
    `a ${Buffer.byteLength(objective, 'utf8')}-byte objective must project under the ${MAX_RUN_VIEW_BYTES}-byte ceiling`);
  assert.equal(view.objective, objective, 'the view carries the goal objective verbatim, once');
  assert.equal(view.objectiveBytes, Buffer.byteLength(objective, 'utf8'),
    'the view publishes the length a reader compares against');
  assert.equal(JSON.stringify(view).split(objective).length - 1, 1,
    'the objective text appears EXACTLY ONCE in the serialized view — never a second copy');

  const expectedLine = objective.slice(0, ROLE_HEAD_BYTES);
  const reach = { ref: 'goal.objective', bytes: Buffer.byteLength(objective, 'utf8') };
  assert.equal(view.planPreview.objective, expectedLine,
    'the preview carries the objective first line, bounded by the one view.role.head row');
  assert.deepEqual(view.planPreview.objectiveRef, reach,
    'the preview names where the whole text lives and how long it is');
  assert.equal(Object.hasOwn(view.planPreview.node, 'objective'), false,
    "the node's own copy of the text is dropped");
  assert.deepEqual(view.planPreview.node.objectiveRef, reach, 'the preview node carries the reach');
  assert.deepEqual(view.nodes[0].objectiveRef, reach, 'the node row carries the same reach');
  assert.equal(view.nodes[0].objective, expectedLine,
    'the node row carries the bounded first line, never the text');

  assert.ok(Buffer.byteLength(view.nodes[0].objective, 'utf8') <= ROLE_HEAD_BYTES);
});

// ── 489-c: narrowing runs BEFORE the ceiling ────────────────────────────────────────────────────

test('489-c: run show answers at every depth for a run whose full view is over the ceiling, and the refusal prescribes a narrowing that works', async (t) => {
  // The plan's definition of done — carried by the goal, the preview and the node, and carried by
  // NONE of the narrowed reads — is what pushes the FULL view over: the objective stays readable at
  // 360 KB, and two 160 KB definition-of-done copies cross the ceiling.
  const definitionOfDone = Array.from({ length: 40 }, (_, index) => `DOD-${index} ${'d'.repeat(3_990)}`);
  const { application, seat } = await recruitedSeat(t, { briefBytes: 360_000, definitionOfDone });
  const runId = seat.runId;
  const client = transport(application);

  // The full read refuses — naming the section that dominates its own bytes and a remedy that works.
  const full = await client.command('run.status', { runId }).then(() => null, (error) => error);
  assert.ok(full, 'the full Run view is over the ceiling and refuses');
  assert.equal(full.code, 'application_run_view_oversize');
  assert.match(full.message, /the largest section is \w+ \(\d+ bytes\)/u,
    'the refusal names the section and its bytes');
  assert.match(full.message, new RegExp(`baton run show ${runId} --depth outline`, 'u'),
    'the refusal prescribes the narrowing that works');
  assert.equal(full.detail?.field, 'depth');
  assert.equal(full.detail?.cap, MAX_RUN_VIEW_BYTES);
  assert.ok(Number.isSafeInteger(full.detail?.actual) && full.detail.actual > MAX_RUN_VIEW_BYTES,
    'the refusal carries the true byte count');
  assert.equal(full.detail?.gracefulPath, 'depth:outline');

  // Every rung of the ladder answers, through the CLI's own parser and client shape.
  for (const argv of [
    ['run', 'show', runId, '--depth', 'outline'],
    ['run', 'show', runId, '--depth', 'index'],
    ['run', 'show', runId, '--depth', 'section', '--section', 'execution'],
    ['run', 'show', runId, '--depth', 'item', '--section', 'execution', '--item', 'execution:progress'],
  ]) {
    const result = await runBatonCli(parseBatonCli(argv), client);
    assert.equal(result.runId, runId, `\`${argv.join(' ')}\` answers`);
  }

  // The plan section answers too: the section the shed preview names really serves the preview.
  const planSection = await client.command('run.inspect', { runId, depth: 'section', section: 'plan' });
  assert.equal(planSection.section.id, 'plan');

  // And the narrowed view SAYS what it shed, what each section cost and the read that serves it.
  const narrowed = await application._buildView(
    application._findRun(runId), application.principals.observer, { narrow: true },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(narrowed), 'utf8') <= MAX_RUN_VIEW_BYTES,
    'the narrowed view fits the ceiling it was judged against');
  assert.equal(narrowed.narrowed.ceiling, MAX_RUN_VIEW_BYTES);
  assert.ok(narrowed.narrowed.sections.length > 0, 'the view names the sections it shed');
  for (const row of narrowed.narrowed.sections) {
    assert.equal(typeof row.section, 'string');
    assert.ok(row.bytes > 0, `${row.section} cost bytes the view names`);
    assert.equal(typeof row.read, 'string');
  }
  assert.match(narrowed.narrowed.read, new RegExp(`baton run show ${runId} --depth outline`, 'u'));
});

// ── 489-d: the recruit admits, and its attach answers from the store ────────────────────────────

test('489-d: a recruit whose brief projects over the ceiling is admitted, and its package attach never reads the view', async (t) => {
  // The brief the root composes is the seat's whole objective: the deployment admits it up to the
  // run.objective lane, and the view built for the participant's own start is over the ceiling.
  const { application, driver, receipt, seat } = await recruitedSeat(t, { briefBytes: 600_000 });

  assert.equal(receipt.refusal ?? null, null, 'the recruit is admitted — never recruit_refused');
  assert.equal(seat.status, 'active', 'the seat joined');
  assert.equal(seat.leftReason ?? null, null, 'no admission refusal left a settled row behind');
  assert.equal(driver.coordination.eventsView()
    .filter((event) => event.kind === 'swarm.participant_left'
      && event.payload?.reason === 'recruit_refused').length, 0,
    'no rollback row was written — the start never refused on a view it does not read');

  // The attach leg binds through the coordination store and answers its receipt: an unknown digest
  // refuses as the STORE's own context_package_not_found. A read of the Run view would have refused
  // application_run_view_oversize first, so the refusal's identity is the proof that no view was read.
  const refusal = await application.attachContextPackage({
    packageDigest: 'f'.repeat(64), runId: seat.runId, scope: 'worker:seat-489',
  }, principal('owner')).then(() => null, (error) => error);
  assert.ok(refusal, 'an unattached digest refuses');
  assert.equal(refusal.code, 'context_package_not_found',
    'the attach resolves against the store — never against the Run view the ceiling refuses');

  // The ceiling still holds for a caller that asks for the whole view: the admission did not come
  // from raising it.
  const full = await application.status(seat.runId, principal('observer')).then(() => null, (error) => error);
  assert.equal(full?.code, 'application_run_view_oversize',
    'the ceiling still holds for a caller that asks for the whole view');
});
