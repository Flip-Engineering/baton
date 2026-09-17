// Deployment-wide evidence and contribution search (issue #312).
//
// #318 landed `evidence.search` over ONE swarm (knowledge rows only, swarmId required).
// #312 retrieves across the deployment: knowledge AND contributions, filtered by swarm,
// participant, kind, path and free text, with a cursor that pages by the ledger's own seq —
// backed by a per-deployment index rebuilt from the coordination ledger (never a second store
// of truth), served on the CLI, the MCP tool and the participant bridge alike from ONE
// canonical operation (impl/src/evidence-search.mjs).
//
// Fixture pattern from swarm-view-slices.test.mjs: a real CoordinationStore under a real
// SwarmRuntime with a controllable coordinator — two swarms, knowledge seeds against the
// participants' real runIds, and contributions recorded through swarm.update, including
// contributions that name paths. The #338 row at the end of the file drives that same operation
// over a real resident: parser → authenticated Web host → the application's own validator and
// dispatch → the canonical search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { EVIDENCE_SEARCH_FILTERS, searchDeploymentEvidence, searchEvidenceIndex } from '../src/evidence-search.mjs';
import { canonicalOperationForCommand } from '../src/application-semantics.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { BatonWebClient, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { APPLICATION_TOOL, McpFleetServer } from '../src/mcp-northbound.mjs';
import { mockApplicationCard } from '../scripts/surface-truth.mjs';
import { swarmBridgeMain } from '../src/swarm-native-bridge.mjs';
// Issue #338: the real resident deployment the CLI row drives — the real application behind the
// real authenticated Web host, on the same fixture pattern read-lane-229-red.test.mjs uses.
import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { WebNorthbound, createLocalAuthenticatedWebServer } from '../src/web-northbound.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { BatonWebHost } from '../src/application-host.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-evidence-search-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async (workerId) => { workers.find((row) => row.id === workerId).paused = false; return { ok: true }; },
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  let key = 0;
  const nextKey = () => `evidence-search-${++key}`;
  return { store, runtime, workers, directory, nextKey };
}

// Two swarms with seated participants, knowledge seeds against their real runIds, and
// contributions that name paths — the #312 fixture ledger.
async function twoSwarms(f) {
  await f.runtime.command('swarm.create', { swarmId: 'swarm-east', purpose: 'East build', idempotencyKey: f.nextKey() }, owner);
  await f.runtime.command('swarm.create', { swarmId: 'swarm-west', purpose: 'West build', idempotencyKey: f.nextKey() }, owner);
  await f.runtime.command('swarm.recruit', { swarmId: 'swarm-east', participantId: 'ada', objective: 'Build east', idempotencyKey: f.nextKey() }, owner);
  await f.runtime.command('swarm.recruit', { swarmId: 'swarm-west', participantId: 'grace', objective: 'Build west', idempotencyKey: f.nextKey() }, owner);
  const adaRunId = f.store.swarm('swarm-east').participants.ada.runId;
  const graceRunId = f.store.swarm('swarm-west').participants.grace.runId;
  assert.ok(adaRunId && graceRunId, 'both recruits hold real run identities');

  f.store.addKnowledgeNode({ type: 'Finding', grounding: 'observed', body: 'east route costs less; see impl/search/index.mjs', runId: adaRunId, evidence: [] }, { actor: 'test', key: 'seed-east-finding' });
  f.store.addKnowledgeNode({ type: 'Question', grounding: 'asserted', body: 'should east retry on 429?', runId: adaRunId, evidence: [] }, { actor: 'test', key: 'seed-east-question' });
  f.store.addKnowledgeNode({ type: 'Finding', grounding: 'observed', body: 'west export packs via impl/export/tarball.mjs', runId: graceRunId, evidence: [] }, { actor: 'test', key: 'seed-west-finding' });

  await f.runtime.command('swarm.update', { swarmId: 'swarm-east', event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-east-search', participantId: 'ada', body: 'landed cursor paging in impl/search/index.mjs', refs: ['impl/search/index.mjs'] },
    idempotencyKey: f.nextKey() }, owner);
  await f.runtime.command('swarm.update', { swarmId: 'swarm-west', event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-west-export', participantId: 'grace',
      body: { kind: 'Report', summary: 'reworked the tarball export', paths: ['impl/export/tarball.mjs'] },
      refs: ['impl/export/tarball.mjs'] },
    idempotencyKey: f.nextKey() }, owner);
  return { adaRunId, graceRunId };
}

test('deployment search returns knowledge and contributions across both swarms in ledger order with a head cursor', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const found = searchDeploymentEvidence(f.store, {});
  assert.equal(found.rows.length, 5, 'three knowledge rows plus two contributions');
  assert.deepEqual(found.rows.map((row) => row.source), ['knowledge', 'knowledge', 'knowledge', 'contribution', 'contribution']);
  const seqs = found.rows.map((row) => row.seq);
  assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, 'rows read in ledger order');
  assert.equal(found.cursor, f.store.ledgerHeadSeq(), 'the cursor IS the ledger head seq');
  assert.equal(found.truncated, false);
  for (const row of found.rows) {
    assert.ok(Number.isSafeInteger(row.seq) && row.seq > 0, 'every row carries its ledger seq');
    assert.ok(typeof row.ts === 'string', 'every row carries its ts');
    assert.ok(row.swarmId === 'swarm-east' || row.swarmId === 'swarm-west', 'every row names its swarm');
    assert.ok(typeof row.participantId === 'string', 'every row names its participant');
  }
  const contribution = found.rows.find((row) => row.contributionId === 'c-east-search');
  assert.equal(contribution?.swarmId, 'swarm-east');
  assert.equal(contribution?.participantId, 'ada');
  assert.deepEqual(contribution?.refs, ['impl/search/index.mjs']);
});

test('deployment search filters by swarm', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const east = searchDeploymentEvidence(f.store, { swarmId: 'swarm-east' });
  assert.equal(east.rows.length, 3, 'two east knowledge rows plus the east contribution');
  assert.ok(east.rows.every((row) => row.swarmId === 'swarm-east'));
  assert.equal(east.cursor, f.store.ledgerHeadSeq(), 'a filtered read still cursors at the ledger head');
  const west = searchDeploymentEvidence(f.store, { swarmId: 'swarm-west' });
  assert.equal(west.rows.length, 2);
  assert.ok(west.rows.every((row) => row.swarmId === 'swarm-west'));
});

test('deployment search filters by participant', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const grace = searchDeploymentEvidence(f.store, { participantId: 'grace' });
  assert.equal(grace.rows.length, 2, 'the west finding plus the west contribution');
  assert.ok(grace.rows.every((row) => row.participantId === 'grace'));
  const ada = searchDeploymentEvidence(f.store, { participantId: 'ada' });
  assert.equal(ada.rows.length, 3);
});

test('deployment search filters by kind across knowledge types and named contribution kinds', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const questions = searchDeploymentEvidence(f.store, { kind: 'Question' });
  assert.equal(questions.rows.length, 1, 'only the east Question; contributions without that kind are excluded');
  assert.equal(questions.rows[0].kind, 'Question');
  const findings = searchDeploymentEvidence(f.store, { kind: 'Finding' });
  assert.equal(findings.rows.length, 2, 'both Finding knowledge rows; the Report contribution stays out');
  assert.ok(findings.rows.every((row) => row.source === 'knowledge'));
  const reports = searchDeploymentEvidence(f.store, { kind: 'Report' });
  assert.equal(reports.rows.length, 1, 'a contribution that names its kind in the body is found by it');
  assert.equal(reports.rows[0].contributionId, 'c-west-export');
});

test('deployment search filters by path over refs, work and body text', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const searchPath = searchDeploymentEvidence(f.store, { path: 'impl/search' });
  assert.equal(searchPath.rows.length, 2, 'the east finding (body names the path) plus the east contribution (body and refs)');
  assert.ok(searchPath.rows.every((row) => row.swarmId === 'swarm-east'));
  const tarball = searchDeploymentEvidence(f.store, { path: 'impl/export/tarball.mjs' });
  assert.equal(tarball.rows.length, 2, 'the west finding plus the west contribution');
  assert.ok(tarball.rows.every((row) => row.swarmId === 'swarm-west'));
  const missing = searchDeploymentEvidence(f.store, { path: 'impl/nowhere' });
  assert.equal(missing.rows.length, 0, 'a path nothing names answers empty, cursor still at the head');
  assert.equal(missing.cursor, f.store.ledgerHeadSeq());
});

test('deployment search matches free text case-insensitively across both sources', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const tarball = searchDeploymentEvidence(f.store, { query: 'TARBALL' });
  assert.equal(tarball.rows.length, 2, 'the west finding plus the west contribution, whatever the case');
  const retry = searchDeploymentEvidence(f.store, { query: '429' });
  assert.equal(retry.rows.length, 1);
  assert.equal(retry.rows[0].kind, 'Question');
  const contribution = searchDeploymentEvidence(f.store, { query: 'c-west-export' });
  assert.equal(contribution.rows.length, 1, 'a contribution is found by its identity too');
});

test('deployment search pages by the ledger seq cursor, alone and beside filters', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  const full = searchDeploymentEvidence(f.store, {});
  assert.ok(full.rows.length > 2, 'the fixture holds enough rows to page across');
  const second = searchDeploymentEvidence(f.store, { afterSeq: full.rows[1].seq });
  assert.deepEqual(second.rows.map((row) => row.seq), full.rows.slice(2).map((row) => row.seq),
    'resuming after a seq yields exactly what came later');
  assert.equal(second.cursor, full.cursor, 'paging never moves the cursor off the ledger head');
  const west = searchDeploymentEvidence(f.store, { swarmId: 'swarm-west' });
  const westPaged = searchDeploymentEvidence(f.store, { swarmId: 'swarm-west', afterSeq: west.rows[0].seq });
  assert.deepEqual(westPaged.rows.map((row) => row.seq), west.rows.slice(1).map((row) => row.seq),
    'the cursor composes with the filters');
  const head = searchDeploymentEvidence(f.store, { afterSeq: full.cursor });
  assert.equal(head.rows.length, 0, 'a cursor at the head answers empty');
  assert.equal(head.cursor, full.cursor);
  assert.equal(head.truncated, false);
});

test('deployment search frames pages under the wire.frame ceiling and always keeps the first row', (t) => {
  const big = (seq, marker) => ({ seq, ts: '2026-09-16T00:00:00.000Z', source: 'knowledge', swarmId: 'swarm-east',
    participantId: 'ada', runId: 'run-a', nodeId: `knowledge:Finding:${seq}`, kind: 'Finding', grounding: 'observed',
    body: `${marker}${'x'.repeat(600 * 1024)}` });
  const index = { headSeq: 12, rows: [big(10, 'first-'), big(11, 'second-'),
    { seq: 12, ts: '2026-09-16T00:00:00.000Z', source: 'contribution', swarmId: 'swarm-east', participantId: 'ada',
      contributionId: 'c-small', workId: null, refs: null, kind: null, body: 'small' }] };
  const page = searchEvidenceIndex(index, {});
  assert.equal(page.rows.length, 1, 'two 600 KiB rows cannot share a 1 MiB wire frame');
  assert.match(page.rows[0].body, /^first-/, 'the first row is always kept, never dropped for size');
  assert.equal(page.truncated, true);
  assert.equal(page.cursor, 12, 'a truncated page still cursors at the ledger head');
});

test('deployment search refuses unknown fields and invalid shapes with a typed code', async (t) => {
  const f = fixture(t);
  await twoSwarms(f);
  for (const args of [{ nope: 1 }, { afterSeq: -1 }, { afterSeq: 1.5 }, { query: 42 }, { swarmId: '' }, { path: '' }, { kind: 7 }]) {
    assert.throws(() => searchDeploymentEvidence(f.store, args),
      (error) => error.code === 'evidence_search_invalid',
      `invalid shape refuses typed: ${JSON.stringify(args)}`);
  }
  const blank = searchDeploymentEvidence(f.store, { query: '   ' });
  assert.equal(blank.rows.length, 5, 'a blank query is no text filter, like the single-swarm read');
});

test('the CLI parses the deployment-wide evidence search spelling: swarm optional, path beside every filter', () => {
  let parsed = parseBatonCli(['evidence', 'search', '--query', 'tarball', '--path', 'impl/export']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'evidence.search');
  assert.deepEqual(parsed.args, { query: 'tarball', path: 'impl/export' }, 'no swarm names the whole deployment');

  parsed = parseBatonCli(['evidence', 'search', 'swarm-east', '--kind', 'Question', '--after-seq', '4']);
  assert.equal(parsed.name, 'evidence.search');
  assert.deepEqual(parsed.args, { swarmId: 'swarm-east', kind: 'Question', afterSeq: 4 });

  parsed = parseBatonCli(['evidence', 'search', 'swarm-east', '--query', 'route cost', '--participant', 'ada', '--path', 'impl/search']);
  assert.deepEqual(parsed.args,
    { swarmId: 'swarm-east', query: 'route cost', participantId: 'ada', path: 'impl/search' },
    'the #318 spelling keeps parsing, with the new filters beside it');
});

test('the MCP evidence search tool carries the canonical deployment-wide schema', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-evidence-search-mcp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(APPLICATION_TOOL.baton_evidence_search, 'evidence.search');
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const application = {
    repoId: 'repo-evidence-search', card: () => mockApplicationCard('repo-evidence-search'),
    async authorizeReplay() { return true; },
    async command() { return { schemaVersion: 1 }; },
  };
  const server = new McpFleetServer({
    coordinator: {}, coordination, application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: { userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: ['repo-evidence-search'], expiresAt: new Date(Date.now() + 60_000).toISOString(), revoked: false },
    repoIds: ['repo-evidence-search'], maxWaitMs: 1_000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tool = listed.result.tools.find((row) => row.name === 'baton_evidence_search');
  assert.ok(tool, 'the evidence search tool is advertised');
  for (const field of ['swarmId', 'participantId', 'kind', 'path', 'query', 'afterSeq']) {
    assert.ok(tool.inputSchema.properties[field], `the tool schema carries ${field}`);
  }
  assert.deepEqual(tool.inputSchema.required, ['repoId'], 'the swarm filter is optional: absent names the deployment');
  // Issue #338: ONE field contract. The canonical operation's own vocabulary (evidence-search.mjs,
  // the module every surface derives from) is the registry schema the web/MCP/envelope validation
  // reads, the tool schema the MCP caller sees, and the flags the CLI parses — asserted as a set,
  // so a filter added to one surface alone refuses here instead of at a user's call.
  const operation = canonicalOperationForCommand('evidence.search');
  assert.deepEqual(Object.keys(operation.inputSchema.properties).sort(),
    [...EVIDENCE_SEARCH_FILTERS].sort(), 'the canonical schema IS the operation field contract');
  assert.deepEqual(operation.inputSchema.required, [],
    'no filter is required: the swarm is a filter, never a scope');
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(),
    [...EVIDENCE_SEARCH_FILTERS, 'repoId'].sort(),
    'the advertised tool carries exactly those filters plus its repository scope');
  assert.deepEqual([...APPLICATION_COMMAND_DEFINITIONS['evidence.search'].args].sort(),
    [...EVIDENCE_SEARCH_FILTERS].sort(), 'the application command table declares exactly those filters');
});

test('the participant bridge documents the canonical evidence search arguments', async () => {
  let out = '';
  const code = await swarmBridgeMain(['evidence.search', '--help'], {},
    { out: { write: (text) => { out += text; } }, err: { write: () => {} } });
  assert.equal(code, 0);
  for (const field of ['swarmId', 'participantId', 'kind', 'path', 'query', 'afterSeq']) {
    assert.match(out, new RegExp(field), `bridge help names ${field}`);
  }
  assert.match(out, /ledger seq|cursor/i, 'bridge help teaches the seq cursor');
});

// ── issue #338: the CLI reaches the deployment through a real resident ─────────────────────────
//
// `baton evidence search` was refused by the APPLICATION on every form ('evidence.search has
// unknown or missing fields') because the field contract was stated twice: the parser, the MCP
// tool and the operation's own validator all send only the filters the caller named, while the
// application command table demanded the whole declared set present. The row below drives the
// whole path — parser → authenticated Web host → the application's own validator and dispatch →
// the canonical search — on a fixture deployment, so no layer can disagree about the contract
// again. Only the repository and the provider adapter are fixtures; every layer of the path is
// production code, which is what the MCP tool (invalid_run_command) and the CLI both ride.

const RESIDENT_REPO = 'repo-evidence-resident';
const RESIDENT_ORIGIN = 'https://baton.local';
const residentPrincipal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

/** A real resident deployment: the real BatonApplication over a driver + MockAdapter, behind the
 * real authenticated Web host on an owner-only socket, driven by the real CLI client. The socket
 * root stays short because the host refuses a bound path over 103 bytes. */
async function residentDeployment(t) {
  const directory = mkdtempSync('/tmp/baton-evidence-resident-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Evidence test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'evidence@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'ready', files: {} } });
  const adapterCard = adapter.card.bind(adapter);
  adapter.card = () => ({ ...adapterCard(), modelSelection: { mode: 'exact', configuredDefault: 'model-a',
    available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [],
    reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  const driver = createDriver({
    repoRoot: repo, repoId: RESIDENT_REPO, logDir: join(directory, 'log'), adapters: { mock: adapter },
    goalPlanAuthority: {
      policy: { schemaVersion: 1, repoId: RESIDENT_REPO, mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
        limits: { maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 65_536,
          maxPlanBytes: 262_144, maxStatusBytes: 262_144, maxTokens: 1_000_000, maxUsd: 100,
          maxWallMin: 1_440, maxProviderTurns: 10_000 } },
      authorize: async () => true,
    },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: RESIDENT_REPO,
    profiles: { standard: { schemaVersion: 1, repoId: RESIDENT_REPO, definitionOfDone: ['verification passes'],
      constraints: [], risk: 'low',
      goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
      nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
      pathScope: ['**'],
      verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
        expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 65_536, requiredPredecessorEvidence: [] },
      routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
      capabilities: ['code'], effects: ['repository_edit'],
      resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' } } },
    principals: { planner: residentPrincipal('planner'), dispatcher: residentPrincipal('dispatcher'),
      observer: residentPrincipal('observer') },
    authorize: async () => true,
  });
  await application.ready;
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({ userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control', 'approve', 'emergency_stop', 'export_result'],
    repoIds: [RESIDENT_REPO], ttlMs: 60_000 }, { actor: 'deployment:resident' });
  const web = new WebNorthbound({ coordinator: driver.coordinator, coordination: driver.coordination,
    sessions, application, repoIds: [RESIDENT_REPO], allowedOrigins: [RESIDENT_ORIGIN] });
  const server = createLocalAuthenticatedWebServer(web);
  const socketPath = join(directory, 'resident.sock');
  const host = new BatonWebHost({
    application, server,
    shutdownPrincipal: { actor: 'deployment:resident', principalId: 'local-owner', sessionId: 'local-owner-session' },
    listen: { path: socketPath }, webDrainMs: 2_000,
  });
  t.after(async () => {
    try { await host.shutdown(); } catch { /* the fixture is already down */ }
    try { await application.shutdown(residentPrincipal('cleanup')); } catch { /* already closed */ }
  });
  await host.start();
  const client = new BatonWebClient({
    baseUrl: RESIDENT_ORIGIN, origin: RESIDENT_ORIGIN, repoId: RESIDENT_REPO, token: issued.token,
    commandTimeoutMs: 15_000, pollMs: 10,
    fetchImpl: createLocalSocketFetch({ socketPath, baseUrl: RESIDENT_ORIGIN }),
    clock: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return { application, client };
}

test('the CLI finds deployment evidence through the resident application: every filter, unset optionals omitted (issue #338)', async (t) => {
  const { client } = await residentDeployment(t);
  const created = await client.command('swarm.create',
    { purpose: 'Evidence search fixture', idempotencyKey: 'evidence-resident-create' });
  const swarmId = created.swarmId;
  assert.ok(swarmId, 'the fixture swarm exists');
  await client.command('swarm.update', {
    swarmId, event: 'swarm.contribution_recorded',
    payload: { contributionId: 'contribution-resident-search',
      body: 'landed cursor paging in impl/search/index.mjs', refs: ['impl/search/index.mjs'] },
    idempotencyKey: 'evidence-resident-update',
  });
  const watch = async (argv) => runBatonCli(parseBatonCli(argv), client);

  // The swarm filter, with every unset optional simply ABSENT — the form that answered 'unknown or
  // missing fields' before the contract was decided once.
  const bySwarm = await watch(['evidence', 'search', swarmId]);
  assert.deepEqual(bySwarm.rows.map((row) => row.contributionId), ['contribution-resident-search']);

  // The participant filter: the runtime attributed the contribution to the caller's own seat.
  const participantId = bySwarm.rows[0].participantId;
  assert.ok(participantId, 'the recorded contribution names its author seat');
  const byParticipant = await watch(['evidence', 'search', swarmId, '--participant', participantId]);
  assert.deepEqual(byParticipant.rows.map((row) => row.contributionId), ['contribution-resident-search']);
  const byOtherSeat = await watch(['evidence', 'search', swarmId, '--participant', 'nobody']);
  assert.equal(byOtherSeat.rows.length, 0);

  // The deployment-wide form: the swarm is a filter, so its absence names the whole deployment.
  const deploymentWide = await watch(['evidence', 'search', '--query', 'index.mjs']);
  assert.deepEqual(deploymentWide.rows.map((row) => row.contributionId), ['contribution-resident-search']);
  assert.equal(deploymentWide.cursor, bySwarm.cursor, 'the cursor is the ledger head on both forms');

  // Free text (case-insensitive), the path filter over refs, and the seq cursor — the same contract
  // the operation's own validator states.
  const byQuery = await watch(['evidence', 'search', swarmId, '--query', 'CURSOR PAGING']);
  assert.equal(byQuery.rows.length, 1);
  const byPath = await watch(['evidence', 'search', swarmId, '--path', 'impl/search']);
  assert.equal(byPath.rows.length, 1);
  const miss = await watch(['evidence', 'search', swarmId, '--query', 'nothing-here']);
  assert.equal(miss.rows.length, 0);
  const resume = await watch(['evidence', 'search', swarmId, '--after-seq', String(bySwarm.cursor)]);
  assert.equal(resume.rows.length, 0);

  // A field outside the canonical vocabulary is still refused, typed, by the same validator.
  await assert.rejects(watch(['evidence', 'search', swarmId, '--nope', '1']),
    (error) => error.code === 'cli_invalid' || error.code === 'application_evidence_search_invalid');
});
