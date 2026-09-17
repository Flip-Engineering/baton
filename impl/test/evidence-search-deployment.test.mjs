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
// contributions that name paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { searchDeploymentEvidence, searchEvidenceIndex } from '../src/evidence-search.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { APPLICATION_TOOL, McpFleetServer } from '../src/mcp-northbound.mjs';
import { mockApplicationCard } from '../scripts/surface-truth.mjs';
import { swarmBridgeMain } from '../src/swarm-native-bridge.mjs';

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
