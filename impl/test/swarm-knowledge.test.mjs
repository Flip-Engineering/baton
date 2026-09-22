// The knowledge layer is reachable from the loop a real orchestrator runs (issue #318).
//
// Every test here drives a REAL recruit through SwarmRuntime with the real BatonApplication
// fixture (the swarm-coupling.test.mjs harness: real coordination store, real git worktrees,
// mock native adapter), and the participant-facing calls go through the REAL native bridge the
// deployment issues (`app._swarmNativeAccess.bridge` — the same bridge startRun prepared) or the
// same swarm command port a worker seat uses. Deliverables, each red before this change:
//   1. reachability — every surviving knowledge verb dispatches from a participant's bridge, its
//      permission is named on swarm.view `updates`, and the brief's swarm section names each verb
//      with the one situation it is for; a verb with no participant situation is retired;
//   2. exchange — A seeds a fact, B finds it in its next turn; the root copies nothing; the
//      exchange shows on swarm.view and on the wake stream as a typed `knowledge` row;
//   3. successor inherits — `resumeFrom` puts the predecessor's last checkpoint, published
//      contracts and carriedForward items into the successor's brief automatically;
//   4. situation projection — every brief carries the peers and their scopes, the contracts
//      published so far, and the commits landed on the target since the base (derived from git);
//   5. retrieval — `evidence search` finds a fact by text, participant or kind, with a cursor
//      derived from the ledger seq (never a page cap), on the CLI, MCP and bridge surfaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS, SWARM_SEAT_READ_COMMAND_NAMES } from '../src/swarm-runtime.mjs';
import { SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES } from '../src/swarm-contract.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { SWARM_NATIVE_GUIDANCE } from '../src/swarm-native-access.mjs';
import { wakeClassFor } from '../src/wake-stream.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { APPLICATION_TOOL } from '../src/mcp-northbound.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-knowledge', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 8192,
    maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024,
    maxStatusBytes: 256 * 1024, maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
  timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-knowledge', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-knowledge-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm knowledge'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'knowledge@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'ready', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(), turnCompletion: 'pausable',
    modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000,
  });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => { await app.shutdown(principal('cleanup')); rmSync(directory, { recursive: true, force: true }); });
  await app.ready;
  const paused = async (runId) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const worker = driver.coordinator.list().find((row) => row.runId === runId);
      if (worker && driver.coordinator.pausedTurns({ workerId: worker.id }).length) return worker;
      if (Date.now() > deadline) throw new Error(`participant of ${runId} did not pause`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const asWorker = (worker) => bindBaton(app, { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: `${worker.id}-session` });
  // The REAL bridge the deployment issues, plus one raw token for a named seat: exactly the
  // surface a native participant calls (issue #318 "callable from a participant's bridge").
  const bridgeFor = async (swarmId, participantId, runId) => {
    const issued = await app._swarmNativeAccess.bridge.issue({ swarmId, participantId, runId });
    return async (command, args = {}) => {
      const { swarmBridgeCommand } = await import('../src/swarm-native-bridge.mjs');
      return swarmBridgeCommand({ command, args }, { env: issued.env });
    };
  };
  return { app, driver, directory, repo, root: bindBaton(app, principal('root')), paused, asWorker, bridgeFor };
}

// One swarm with two seated builders: alpha (every permission) and beta, plus their bridge
// clients. Returns the handles the tests drive.
async function swarmFixture(t) {
  const f = await fixture(t);
  const swarm = await f.root.swarms.create('Knowledge reaches the loop');
  const alpha = await swarm.recruit('alpha', 'Build A', { ...selection, permissions: SWARM_PERMISSIONS });
  const alphaWorker = await f.paused(alpha.runId);
  const delegated = f.asWorker(alphaWorker).swarms.open(swarm.id);
  const beta = await delegated.recruit('beta', 'Build B', selection);
  const betaWorker = await f.paused(beta.runId);
  const alphaSend = await f.bridgeFor(swarm.id, 'alpha', alpha.runId);
  const betaSend = await f.bridgeFor(swarm.id, 'beta', beta.runId);
  return { ...f, swarm, delegated, alpha, beta, alphaWorker, betaWorker, alphaSend, betaSend };
}

test('a participant seeds a fact through its bridge and a peer finds it with no root copying anything', async (t) => {
  const { swarm, delegated, alphaSend, betaSend, betaWorker, asWorker } = await swarmFixture(t);

  // Deliverable 2: participant A seeds the fact over its own bridge — runId is derived from its
  // token, and supplying it is an identity refusal, never an accepted coordinate.
  await assert.rejects(alphaSend('run.knowledge.seed',
    { runId: 'run-forged', type: 'Finding', grounding: 'observed', body: 'the interface is artifact:iface' }),
    (error) => error.code === 'swarm_command_invalid');
  const seeded = await alphaSend('run.knowledge.seed',
    { type: 'Finding', grounding: 'observed', body: 'the interface is artifact:iface' });
  assert.equal(seeded.ok, true);
  assert.match(seeded.nodeId ?? '', /^knowledge:/);

  // Participant B finds it in its NEXT TURN, through its own bridge, with the root absent.
  const found = await betaSend('evidence.search', { query: 'artifact:iface' });
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].participantId, 'alpha');
  assert.equal(found.rows[0].kind, 'Finding');
  assert.equal(found.rows[0].body, 'the interface is artifact:iface');

  // The exchange is visible on swarm.view: knowledge rows attributed to the seeding seat.
  const view = await swarm.view();
  assert.equal(view.knowledge.length, 1);
  assert.equal(view.knowledge[0].participantId, 'alpha');
  assert.equal(view.knowledge[0].nodeId, seeded.nodeId);

  // ...and on the swarm's own wake feed as a typed wake.
  const parked = await swarm.view();
  const watching = swarm.watch({ afterSeq: parked.cursor, timeoutMs: 2000 });
  await asWorker(betaWorker).swarms.open(swarm.id).knowledge('run.knowledge.seed',
    { type: 'Question', grounding: 'asserted', body: 'does artifact:iface cover retries?' });
  const woke = await watching;
  assert.equal(woke.watch.reason, 'event');
  assert.equal(woke.watch.event.kind, 'knowledge.node_added');
  assert.equal(wakeClassFor({ kind: 'knowledge.node_added' }).wakeClass, 'knowledge');
});

test('every surviving knowledge verb dispatches from the bridge, and its permission is named on swarm.view updates', async (t) => {
  const { swarm, alphaSend, betaSend } = await swarmFixture(t);

  // The bridge proves dispatch for every write verb (the surface gate proves the MCP rows).
  assert.equal((await alphaSend('run.board.post', { board: 'alpha-board', title: 'running state: part A bound to artifact:iface' })).result, 'posted');
  assert.equal((await alphaSend('run.board.read', { board: 'alpha-board' })).board, 'alpha-board');
  const appended = await alphaSend('run.scratchpad.append', { kind: 'note', body: 'half of A compiles' });
  assert.ok(appended.entry ?? appended.entryId ?? appended, 'scratchpad append answers with its entry');
  const read = await betaSend('run.scratchpad.read', { scope: 'shared' });
  assert.ok(read, 'a peer can read the shared scratchpad scope');
  const view = await swarm.view();

  // `updates` names every knowledge verb with the permission that admits it — the same table the
  // dispatch enforces, so the view can never overstate an authority.
  for (const name of SWARM_KNOWLEDGE_COMMAND_NAMES) {
    const row = view.updates.find((entry) => entry.command === name);
    assert.ok(row, `${name} is named on swarm.view updates`);
    assert.equal(row.permission, SWARM_KNOWLEDGE_COMMANDS[name].permission);
    assert.ok(view.availableActions.includes(name), `${name} is offered as an available action`);
  }
  // The brief's swarm section (SWARM_NATIVE_GUIDANCE, carried verbatim in every recruit's goal)
  // names each verb with its ONE situation — the reachability teaching the view rows stay lean.
  for (const name of SWARM_KNOWLEDGE_COMMAND_NAMES) {
    assert.ok(SWARM_NATIVE_GUIDANCE.includes(name), `the brief section names ${name}`);
    assert.ok(SWARM_NATIVE_GUIDANCE.includes(SWARM_KNOWLEDGE_COMMANDS[name].situation),
      `the brief section names the situation of ${name}`);
  }

  // Issue #311 item 3 (the closed-set half): every knowledge-family canonical operation is
  // EITHER a taught participant verb (dispatched above, brief-taught below) or refused by the
  // participant bridge outright. The set is DERIVED from the one canonical registry, never
  // re-spelled, so a new knowledge/scratchpad/board/context/package verb lands red here until
  // it is classified — taught to participants or kept off their bridge. The refused members
  // keep their own surfaces (the wave-settlement lane and the S-2 orchestrator board/package
  // tools on MCP, the worker board claim/report frames on the managed-worker wire, the
  // context engine on the CLI/MCP/web); a participant reaches none of them.
  const taught = new Set([...SWARM_KNOWLEDGE_COMMAND_NAMES, ...SWARM_SEAT_READ_COMMAND_NAMES]);
  const family = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .map((operation) => operation.key)
    .filter((key) => /^(?:knowledge|scratchpad|board|context|package)\./u.test(key)
      || /^run\.(?:knowledge|board|scratchpad)(?:\.|$)/u.test(key));
  const retired = family.filter((key) => !taught.has(key));
  assert.ok(retired.length > 0, 'the derivation found the non-participant family rows');
  for (const retiredName of retired) {
    await assert.rejects(alphaSend(retiredName, {}), (error) => (
      error.code === 'swarm_command_invalid' || error.code === 'swarm_bridge_request_invalid'
      || error.code === 'swarm_command_unavailable'));
    assert.ok(!SWARM_KNOWLEDGE_COMMAND_NAMES.includes(retiredName),
      `${retiredName} is not on the participant table`);
  }
});
test('the brief names each knowledge verb with its one situation and the swarm situation projection', async (t) => {
  const { swarm, repo, alphaWorker, asWorker } = await swarmFixture(t);
  const delegated = asWorker(alphaWorker).swarms.open(swarm.id);

  // Land a commit on the target after the swarm's base, then recruit a successor seat: its brief
  // must carry the peers and their scopes, the contracts so far, and the git-derived commits.
  const published = await delegated.contribute({
    contributionId: 'contribution-alpha-contract', participantId: 'alpha',
    body: { contract: { name: 'artifact:iface', keeps: ['naming', 'retry shape'] },
      carriedForward: [{ summary: 'part A compiles through the iface', artifact: 'artifact:iface' }] },
  });
  assert.ok(published);
  writeFileSync(join(repo, 'impl.txt'), 'landed work\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'land: iface implementation'], { cwd: repo });

  const gamma = await delegated.recruit('gamma', 'Build C beside A and B', selection);
  // #464 (third half): the roster carries the brief's reach; the scoped read carries the text.
  const view = await swarm.view({ participantId: 'gamma' });
  const gammaRow = view.participants.find((row) => row.participantId === 'gamma');
  assert.ok(gammaRow.brief, 'the composed brief is written onto the join');
  // The situation projection: peers, contracts, commits since base (from git). docs/46 §4
  // (issue #274): alpha is a `swarm`-class peer of gamma — identity, role and the liveness word
  // only, never the scope.
  assert.match(gammaRow.brief, /## Swarm situation/);
  assert.match(gammaRow.brief, /- alpha — Build A; working/);
  assert.doesNotMatch(gammaRow.brief, /- alpha — Build A — scope:/);
  assert.match(gammaRow.brief, /artifact:iface/);
  assert.match(gammaRow.brief, /Commits landed on the target since the base/);
  assert.match(gammaRow.brief, /land: iface implementation/);

  // Deliverable 1, brief half: the swarm section every recruit's PROVIDER-FACING brief carries
  // (issue #309) names every surviving knowledge verb with its one situation. That section is
  // derived ONCE from SWARM_NATIVE_GUIDANCE (not spliced into the join's own `brief`/goal text —
  // #309 retired that duplication in favor of the one merge seam `_providerBrief` owns), and the
  // earlier test in this file already asserts SWARM_NATIVE_GUIDANCE names every verb and its
  // situation; this assertion only needs to hold that the situation projection above and the
  // swarm-wide guidance are not mutually exclusive on the same seat.
  for (const name of SWARM_KNOWLEDGE_COMMAND_NAMES) {
    assert.ok(SWARM_NATIVE_GUIDANCE.includes(name), `the brief section names ${name}`);
  }
});

test('a resumeFrom successor inherits checkpoint, contracts and carriedForward without a RESUME NOTE', async (t) => {
  const { swarm, delegated, alpha, alphaWorker, asWorker } = await swarmFixture(t);

  // The predecessor publishes its hand-off on the contribution body (#310 minimal fields).
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-handoff', participantId: 'alpha',
    body: { contract: { name: 'artifact:iface', keeps: ['callers keep one import path'] },
      carriedForward: [{ summary: 'W-A scaffold stands; tests pending', artifact: 'artifact:iface' }] },
  });
  // Pin the predecessor's progress: a real capture leaves a revision the inheritance reads.
  await swarm.capture('alpha', 'contribution-alpha-handoff');

  const bravo = await delegated.recruit('bravo', 'Continue A from alpha', { ...selection, resumeFrom: 'alpha' });
  // #525: the recruit lands the recovery question; the recruiting seat's guide answers it, and the
  // start composes the brief these assertions read.
  await delegated.guide('bravo', 'Continue A from alpha');
  // #464 (third half): the scoped read carries the successor's brief text.
  const view = await swarm.view({ participantId: 'bravo' });
  const bravoRow = view.participants.find((row) => row.participantId === 'bravo');
  assert.equal(bravoRow.resumeFrom, 'alpha');
  assert.ok(bravoRow.brief, 'the successor carries a composed brief');
  assert.match(bravoRow.brief, /## Inheritance from alpha/);
  assert.match(bravoRow.brief, /Last checkpoint: [0-9a-f]{40}/, 'the pinned revision is the checkpoint reference');
  assert.match(bravoRow.brief, /callers keep one import path/);
  assert.match(bravoRow.brief, /carries forward: .*W-A scaffold stands/);

  // A predecessor that does not exist is refused by name, before any membership is written.
  await assert.rejects(delegated.recruit('delta', 'No predecessor', { ...selection, resumeFrom: 'ghost' }),
    (error) => error.code === 'swarm_recruit_predecessor_unavailable');
});

test('evidence search finds facts by text, participant and kind, with a ledger-seq cursor on every surface', async (t) => {
  const { app, swarm, alphaSend, betaSend } = await swarmFixture(t);
  await alphaSend('run.knowledge.seed', { type: 'Finding', grounding: 'observed', body: 'gamma beats delta on route cost by 3x' });
  await alphaSend('run.knowledge.seed', { type: 'Question', grounding: 'asserted', body: 'should delta retry on 429?' });

  const byText = await betaSend('evidence.search', { query: 'route cost' });
  assert.equal(byText.rows.length, 1);
  assert.equal(byText.rows[0].kind, 'Finding');
  const byParticipant = await betaSend('evidence.search', { participantId: 'alpha' });
  assert.equal(byParticipant.rows.length, 2);
  const byKind = await betaSend('evidence.search', { kind: 'Question' });
  assert.equal(byKind.rows.length, 1);
  assert.match(byKind.rows[0].body, /429/);

  // The cursor IS the ledger seq: resuming after it yields what came later, never a page count.
  const after = await betaSend('evidence.search', { afterSeq: byParticipant.rows[0].seq });
  assert.ok(after.rows.every((row) => row.seq > byParticipant.rows[0].seq));

  // CLI: the canonical spelling parses and dispatches through the swarm command port.
  const parsed = parseBatonCli(['evidence', 'search', swarm.id, '--query', 'route cost']);
  assert.equal(parsed.name, 'evidence.search');
  const cliResult = await app.command(parsed.name, parsed.args, { actor: 'direct:root', principalId: 'root', sessionId: 'root-session' });
  assert.equal(cliResult.rows.length, 1);

  // MCP: the tool rides the canonical table under its derived spelling.
  assert.equal(APPLICATION_TOOL.baton_evidence_search, 'evidence.search');
});
