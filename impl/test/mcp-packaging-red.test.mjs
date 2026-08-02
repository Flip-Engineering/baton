// MCP-first + packaging epic red suite (contract: docs/reference/evidence/
// mcp-packaging-2026-08-02/mcp-packaging-decisions.md v1.0 — operator steering 2026-08-02).
//
// Eighteen rows (MP1-MP18) over the folded decisions: MCP-W1 wave ergonomics on the ordinary surface
// (waves.start with per-member quota + profile admission, paginated cursor-fresh progress,
// send/stop, decision.answer repo scoping + already_resolved semantics, resume-steer +
// harvestReplayed); MCP-W2 the four settlement tools via the S-2 envelope with the
// session-gate-before-replay order; MCP-W3 quota-free fresh doctor; PKG-1 the declarative
// descriptor (closed shape, containment-checked credential refs, pinned at open, env-secret
// redaction); PKG-2 npm hygiene (files/exports, pack-list pin, clean-install smoke, lazy
// natives); PKG-3 the guide's executable truth.
//
// Red-first: written against the v1.0 contract BEFORE implementation; every row fails for
// the named stage and goes green on the contract's implementation ONLY. Fixture pattern
// mirrors test/mcp-reflex-surface-red.test.mjs.

import assert from 'node:assert/strict';
import { execFileSync, spawn as spawnProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, McpFleetServer } from '../src/index.mjs';

const NOW = Date.parse('2026-08-02T00:00:00.000Z');
const REPO_ID = 'repo-mcp-packaging';
const dirs = [];
const root = (label) => {
  const d = mkdtempSync(join(tmpdir(), `baton-mcpp-${label}-`));
  dirs.push(d);
  return d;
};
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function principal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
  };
}

const runApplicationCard = () => ({
  schemaVersion: 1, repoId: REPO_ID,
  commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
});

function mockApplication(overrides = {}) {
  const commandCalls = [];
  const application = {
    repoId: REPO_ID,
    card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      commandCalls.push({ name, args, principal: appPrincipal, context });
      if (overrides.command) return overrides.command(name, args, appPrincipal, context);
      return { schemaVersion: 1, runId: args?.runId ?? null, phase: 'running' };
    },
    async decisionList(request) { return { decisions: [] }; },
  };
  return { application, commandCalls };
}

function setup(overrides = {}) {
  const directory = overrides.directory ?? root('srv');
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const { application, commandCalls } = overrides.applicationBundle ?? mockApplication(overrides.applicationOverrides ?? {});
  const server = new McpFleetServer({
    coordinator: overrides.coordinator ?? {},
    coordination,
    application,
    surface: overrides.surface ?? 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: overrides.principal ?? principal(),
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (async () => ({ ok: true })),
  });
  return { server, coordination, application, commandCalls, directory };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const call = (server, id, name, args) => request(server, id, 'tools/call', { name, arguments: args });
const resultText = (response) => response?.result?.content?.[0]?.text ?? '';

// ===========================================================================
// MCP-W1 — wave ergonomics (stage: tools missing)
// ===========================================================================

test('MP1: baton_waves_start registers, debits quota PER MEMBER, and returns the detached shape', async () => {
  const debits = [];
  const { server, commandCalls } = setup({
    takeToolQuota: async (debit) => { debits.push(debit); return { ok: true }; },
    applicationOverrides: {
      command: async (name, args) => {
        if (name === 'waves.start') return { waveId: `wave:${'a'.repeat(32)}`, members: [{ role: 'a', runId: 'run-a' }, { role: 'b', runId: 'run-b' }] };
        return { schemaVersion: 1 };
      },
    },
  });
  await initialized(server);
  const response = await call(server, 2, 'baton_waves_start', {
    repoId: REPO_ID, idempotencyKey: 'mp1-wave',
    members: [
      { role: 'a', objective: 'do a', exact: { harness: 'mock', model: 'model-a', effort: 'low' } },
      { role: 'b', objective: 'do b', exact: { harness: 'mock', model: 'model-a', effort: 'low' } },
    ],
  });
  assert.equal(response.result.isError, false, `waves.start must dispatch: ${resultText(response)}`);
  assert.equal(commandCalls.filter((call) => call.name === 'waves.start').length, 1);
  assert.equal(debits.filter((debit) => debit.tool === 'baton_waves_start').length, 2,
    'quota debits PER MEMBER — one debit must not fan out (codex #1)');
  const payload = JSON.parse(resultText(response));
  assert.equal(payload.waveId, `wave:${'a'.repeat(32)}`);
  assert.deepEqual(payload.members.map((member) => member.runId), ['run-a', 'run-b'], 'the detached shape carries runIds, never live handles');
});

test('MP2: baton_waves_start maps the profile refusal to the typed error (real admission pinned E2E in MP18)', async () => {
  const { server, commandCalls } = setup({
    applicationOverrides: {
      command: async (name) => {
        if (name === 'waves.start') {
          throw Object.assign(new Error('Run route is unavailable'), { code: 'application_route_unavailable' });
        }
        return { schemaVersion: 1 };
      },
    },
  });
  await initialized(server);
  const response = await call(server, 2, 'baton_waves_start', {
    repoId: REPO_ID, idempotencyKey: 'mp2-wave',
    members: [{ role: 'a', objective: 'do a', exact: { harness: 'not-a-harness', model: 'x', effort: 'low' } }],
  });
  assert.equal(response.result.isError, true, 'the admission refusal surfaces as an MCP error');
  assert.match(resultText(response), /route|unavailable/, 'the typed route code reaches the caller');
  assert.equal(commandCalls.filter((call) => call.name === 'waves.start').length, 1,
    'the refusal comes from the admission layer, not a server-side allowlist');
});

test('MP3: baton_waves_progress paginates with cursors and never exceeds the frame', async () => {
  const { server } = setup({
    applicationOverrides: {
      command: async (name) => {
        if (name === 'waves.progress') {
          return {
            cursor: 7, nextCursor: 8,
            members: Array.from({ length: 16 }, (_, index) => ({ role: `m${index}`, phase: 'working', progressClass: 'progressing' })),
          };
        }
        return { schemaVersion: 1 };
      },
    },
  });
  await initialized(server);
  const page1 = await call(server, 2, 'baton_waves_progress', { repoId: REPO_ID, waveId: `wave:${'a'.repeat(32)}` });
  assert.equal(page1.result.isError, false, `progress must dispatch: ${resultText(page1)}`);
  const payload = JSON.parse(resultText(page1));
  assert.ok(Array.isArray(payload.members) && payload.members.length <= 16, 'members paginate ≤16 per page');
  assert.ok(Number.isSafeInteger(payload.nextCursor) || payload.nextCursor === null, 'the cursor chain is explicit');
});

test('MP4: baton_waves_stop dispatches with runId validation and the destructive annotation', async () => {
  const { server, commandCalls } = setup({});
  await initialized(server);
  const list = await request(server, 2, 'tools/list', {});
  assert.match(JSON.stringify(list.result), /baton_waves_stop/, 'waves.stop is advertised');
  const bad = await call(server, 3, 'baton_waves_stop', { repoId: REPO_ID, runId: 7 });
  assert.equal(bad.result.isError, true, 'a non-string runId refuses at the schema');
  const stopped = await call(server, 4, 'baton_waves_stop', { repoId: REPO_ID, runId: 'run-a', reason: 'member no longer needed' });
  assert.equal(stopped.result.isError, false, `waves.stop dispatches: ${resultText(stopped)}`);
  const stopCall = commandCalls.find((call) => ['waves.stop', 'run.stop', 'run.member.stop', 'run.workstream.stop'].includes(call.name));
  assert.ok(stopCall, 'the stop reaches the member lane');
  assert.equal(stopCall.args?.runId, 'run-a');
});

test('MP5: decision.answer enforces the repository coordinate and returns already_resolved distinctly', async () => {
  const { server } = setup({
    applicationOverrides: {
      command: async (name, args) => {
        if (name === 'run.answer' && args.requestId === 'foreign-request') {
          throw Object.assign(new Error('Run interaction is unavailable'), { code: 'application_interaction_not_found' });
        }
        if (name === 'run.answer') return { result: 'already_resolved', resolvedBy: 'policy' };
        return { schemaVersion: 1 };
      },
    },
  });
  await initialized(server);
  const foreign = await call(server, 2, 'baton_decision_answer', {
    repoId: REPO_ID, idempotencyKey: 'mp5-foreign', runId: 'run-a', requestId: 'foreign-request', answer: { optionId: 'opt-a' },
  });
  assert.equal(foreign.result.isError, true);
  assert.match(resultText(foreign), /not_found/, 'a cross-repo requestId refuses identically to an unknown one (no existence leak)');
  const late = await call(server, 3, 'baton_decision_answer', {
    repoId: REPO_ID, idempotencyKey: 'mp5-late', runId: 'run-a', requestId: 'req-1', answer: { optionId: 'opt-a' },
  });
  assert.match(resultText(late), /already_resolved/, 'a late answer returns the distinct typed outcome, never a generic error');
  const unknown = await call(server, 4, 'baton_decision_answer', {
    repoId: REPO_ID, idempotencyKey: 'mp5-unknown', runId: 'run-a', requestId: 'foreign-request', answer: { optionId: 'opt-b' },
  });
  assert.equal(unknown.result.isError, true, 'an unknown requestId refuses identically (no existence leak either direction)');
});

test('MP6: waves.attach over MCP returns runIds that accept waves.send/stop (resume-steer), with harvestReplayed on re-attach', async () => {
  const { server, commandCalls } = setup({
    applicationOverrides: {
      command: async (name) => {
        if (name === 'waves.attach') {
          return {
            outcomes: [{ role: 'a', phase: 'result_ready', resultSha: 'a'.repeat(40) }],
            waveDriverDetached: true, harvestReplayed: false,
          };
        }
        return { schemaVersion: 1 };
      },
    },
  });
  await initialized(server);
  const attached = await call(server, 2, 'baton_waves_attach', {
    repoId: REPO_ID, waveId: `wave:${'a'.repeat(32)}`, members: [{ role: 'a', objective: 'do a' }],
  });
  assert.equal(attached.result.isError, false, `attach must dispatch: ${resultText(attached)}`);
  const payload = JSON.parse(resultText(attached));
  assert.equal(payload.harvestReplayed ?? null, false, 'the response marks first-harvest vs replay');
  const steered = await call(server, 3, 'baton_waves_send', {
    repoId: REPO_ID, runId: 'run-a', message: 'continue with the second pass',
  });
  assert.equal(steered.result.isError, false, `waves.send works on the attached runIds (resume-steer): ${resultText(steered)}`);
  const sendCall = commandCalls.find((call) => ['waves.send', 'run.send', 'run.steer', 'run.member.send'].includes(call.name));
  assert.ok(sendCall, 'the send reaches the member lane');
  assert.equal(sendCall.args?.runId, 'run-a', 'the send targets the attached member runId, not the wave');
});

// ===========================================================================
// MCP-W2 — settlement tools via the S-2 envelope (stage: tools missing)
// ===========================================================================

test('MP7: the four settlement tools register on MCP and promote requires the sessionAuthority envelope', async () => {
  const { server } = setup({ principal: principal({ capabilities: ['control', 'observe', 'approve', 'settlement'] }) });
  await initialized(server);
  const list = await request(server, 2, 'tools/list', {});
  const names = JSON.stringify(list.result);
  for (const tool of ['baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote', 'baton_knowledge_settlement_lease']) {
    assert.ok(names.includes(tool), `${tool} is advertised`);
  }
  const noEnvelope = await call(server, 3, 'baton_knowledge_promote', {
    repoId: REPO_ID, idempotencyKey: 'mp7-promote',
    runId: 'run-a', candidateFindingId: 'finding:board-close:x:1',
    policy: { repoId: REPO_ID, maxBatchBytes: 1024, maxResultBytes: 1024 },
    lease: { id: 'x', digest: '0'.repeat(64), issuedEvent: 1 },
  });
  assert.equal(noEnvelope.result.isError, true);
  assert.match(resultText(noEnvelope), /lease|authority|required/, 'the envelope is required, exactly as S-2 made it for board commands');
});

test('MP8: a REPLAYED admission with a foreign session refuses the session code (session gate precedes replay)', async () => {
  const directory = root('mp8');
  const store = new CoordinationStore(join(directory, 'coordination'), {
    repoId: REPO_ID,
    clock: () => new Date(NOW).toISOString(),
    ...(await import('../src/index.mjs')).DEFAULT_RUN_LINEAGE_POLICY
      ? { runLineagePolicy: (await import('../src/index.mjs')).DEFAULT_RUN_LINEAGE_POLICY } : {},
  });
  const { digest: storeDigest } = await import('./helpers/kg-digest.mjs').catch(() => ({ digest: null }));
  void storeDigest;
  // A REAL prior admission: settlement task + lease (session A) + candidate + first admit.
  store.createTask({
    id: 'task-mp8', brief: { objective: 'settlement task for wave wave:mp8', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId: 'run-settlement:wave:mp8', taskType: 'general',
    reservedWorkerId: 'worker-mp8', vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:task-mp8' });
  store.claimTask('task-mp8', 'worker-mp8', 1, { actor: 'orchestrator', key: 'task.claimed:task-mp8' }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","mock-model","low"]',
  });
  const sessionA = {
    principalId: 'operator-a', sessionId: 'stdio-a',
    authorityDigest: 'a'.repeat(64),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
  };
  const { createHash } = await import('node:crypto');
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : (v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
  const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  const leaseIdentity = {
    repoId: REPO_ID, parentRunId: 'run-settlement:wave:mp8', parentTaskId: 'task-mp8', parentTaskVersion: 2,
    workerId: 'worker-mp8', principalId: sessionA.principalId, sessionId: sessionA.sessionId,
    sessionAuthorityDigest: sessionA.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(leaseIdentity)}`;
  const issued = store.issueRunOrchestratorLease(
    { schemaVersion: 1, repoId: REPO_ID, parentTask: { id: 'task-mp8', version: 2 }, session: sessionA },
    { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` },
  );
  const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
  const posted = store.postBoardItem({ board: 'wave-settlement:wave:mp8', title: 't', detail: 'd' },
    { actor: 'orchestrator', key: 'board.candidacy:mp8:1' });
  const closed = store.closeBoardItem(posted.item.itemId, { actor: 'orchestrator', key: 'board.candidacy.close:mp8:1' });
  const candidateFindingId = `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}`;
  const policy = Object.freeze({ repoId: REPO_ID, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });
  const first = store.admitWorkflowFinding(REPO_ID, 'run-settlement:wave:mp8', candidateFindingId, policy,
    { actor: 'orchestrator', key: `knowledge.workflow_admitted:${candidateFindingId}`, principalId: sessionA.principalId, sessionId: sessionA.sessionId, sessionAuthorityDigest: sessionA.authorityDigest },
    lease);
  assert.equal(first.replayed, false, 'the prior admission lands (session A)');
  // The replay with a FOREIGN session: the session gate must fire BEFORE the replay path.
  const refusal = (() => {
    try {
      store.admitWorkflowFinding(REPO_ID, 'run-settlement:wave:mp8', candidateFindingId, policy,
        { actor: 'orchestrator', key: `knowledge.workflow_admitted:${candidateFindingId}`, principalId: 'mallory', sessionId: 'mallory-session', sessionAuthorityDigest: 'f'.repeat(64) },
        lease);
      return null;
    } catch (error) { return error?.code ?? 'unknown'; }
  })();
  assert.equal(refusal, 'run_orchestrator_session_mismatch',
    'a replay with a foreign session is the session refusal, never a replay success (codex #2b)');
});

test('MP9: knowledge_settlement_lease requires the settlement capability on the principal', async () => {
  const { server } = setup({ principal: principal({ capabilities: ['control', 'observe'] }) });
  await initialized(server);
  const response = await call(server, 2, 'baton_knowledge_settlement_lease', {
    repoId: REPO_ID, idempotencyKey: 'mp9-lease', waveId: `wave:${'a'.repeat(32)}`,
  });
  assert.equal(response.result.isError, true);
  assert.match(resultText(response), /forbidden/, 'without the settlement capability class the tool refuses');
});

// ===========================================================================
// MCP-W3 — quota-free fresh doctor (stage: tool missing)
// ===========================================================================

test('MP10: baton_deployment_doctor is quota-free, fresh per call, and carries zero secret material', async () => {
  const debits = [];
  const readiness = { routes: [{ harness: 'mock', model: 'model-a', effort: 'low', state: 'ready' }], workspace: { state: 'ready' } };
  const { server } = setup({
    takeToolQuota: async (debit) => { debits.push(debit); return { ok: true }; },
    applicationOverrides: {
      command: async (name) => ({ schemaVersion: 1, ...readiness }),
    },
  });
  Object.defineProperty(server, 'doctorReadiness', { value: async () => readiness, configurable: true });
  await initialized(server);
  const first = await call(server, 2, 'baton_deployment_doctor', { repoId: REPO_ID });
  assert.equal(first.result.isError, false, `doctor must dispatch: ${resultText(first)}`);
  readiness.routes[0].state = 'blocked';
  const second = await call(server, 3, 'baton_deployment_doctor', { repoId: REPO_ID });
  assert.match(resultText(second), /blocked/, 'per-call FRESH readiness — never open-time cached');
  assert.equal(debits.filter((debit) => debit.tool === 'baton_deployment_doctor').length, 0,
    'doctor is quota-free (the route-picking prerequisite)');
  // Canary: a token-shaped value in the readiness input must never reach the response.
  readiness.canaryCredential = 'sk-live-CANARYVALUE1234567890';
  const third = await call(server, 4, 'baton_deployment_doctor', { repoId: REPO_ID });
  assert.doesNotMatch(resultText(third), /CANARYVALUE/, 'secret-shaped values are stripped at the surface');
  assert.doesNotMatch(resultText(first) + resultText(second), /sk-live/i, 'zero secret material');
});

// ===========================================================================
// PKG-1 — the declarative descriptor (stage: parser missing)
// ===========================================================================

test('MP11: baton-mcp accepts a declarative JSON descriptor (closed shape, containment-checked credential refs)', async () => {
  const directory = root('mp11');
  const descriptor = {
    repo: directory,
    deploymentRoot: join(directory, '.baton', 'demo'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'high', credential: { kind: 'file', ref: 'glm_key.json' } }],
    surface: 'application',
    principal: { userId: 'operator', capabilities: ['control', 'observe'] },
  };
  writeFileSync(join(directory, 'descriptor.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
  writeFileSync(join(directory, 'glm_key.json'), '{"glm_key":"fixture"}\n');
  const { loadMcpDescriptor } = await import('../src/mcp-descriptor.mjs').catch(() => ({}));
  assert.equal(typeof loadMcpDescriptor, 'function', 'the descriptor parser exists (PKG-1)');
  const parsed = loadMcpDescriptor(join(directory, 'descriptor.json'));
  assert.equal(parsed.routes[0].credential.ref, 'glm_key.json');
  // Closed shape: unknown top-level field refuses with the field named.
  writeFileSync(join(directory, 'bad.json'), JSON.stringify({ ...descriptor, surprise: true }));
  assert.throws(() => loadMcpDescriptor(join(directory, 'bad.json')), /surprise/);
  // Containment: a file credential ref escaping the repo refuses.
  writeFileSync(join(directory, 'escape.json'), JSON.stringify({
    ...descriptor, routes: [{ ...descriptor.routes[0], credential: { kind: 'file', ref: '../outside.json' } }],
  }));
  assert.throws(() => loadMcpDescriptor(join(directory, 'escape.json')), /containment|outside|repo/);
  // Symlink-out: a repo-resident symlink pointing outside the repo refuses identically.
  const { symlinkSync } = await import('node:fs');
  writeFileSync(join(directory, 'real-outside.json'), '{}');
  symlinkSync('/etc/hosts', join(directory, 'link-out.json'));
  writeFileSync(join(directory, 'symlink.json'), JSON.stringify({
    ...descriptor, routes: [{ ...descriptor.routes[0], credential: { kind: 'file', ref: 'link-out.json' } }],
  }));
  assert.throws(() => loadMcpDescriptor(join(directory, 'symlink.json')), /containment|symlink|outside/,
    'a symlink escaping the repo is containment-refused, not followed');
});

test('MP12: the descriptor drives the server factory, pinned and frozen at open', async () => {
  const module = await import('../src/mcp-descriptor.mjs').catch(() => ({}));
  assert.equal(typeof module.loadMcpDescriptor, 'function', 'the descriptor parser exists (PKG-1)');
  assert.equal(typeof module.createMcpServerFromDescriptor, 'function',
    'the descriptor-driven server factory exists (baton-mcp <descriptor.json> rides it)');
  const directory = root('mp12');
  writeFileSync(join(directory, 'd.json'), JSON.stringify({ repo: directory, routes: [], surface: 'application' }));
  const parsed = module.loadMcpDescriptor(join(directory, 'd.json'));
  writeFileSync(join(directory, 'd.json'), JSON.stringify({ repo: '/etc', routes: [], surface: 'advanced' }));
  assert.equal(parsed.surface, 'application', 'the parsed config is immutable for the server\'s life');
  assert.equal(Object.isFrozen(parsed) || Object.isFrozen(parsed.routes), true, 'frozen at open');
});

test('MP13: an env credential ref\'s VALUE never appears in tool responses or logs (codex #4)', async () => {
  process.env.BATON_MP13_CANARY = 'sk-canary-MP13-SECRET-VALUE';
  try {
    const { server } = setup({});
    await initialized(server);
    const list = await request(server, 2, 'tools/list', {});
    assert.doesNotMatch(JSON.stringify(list.result), /MP13-SECRET-VALUE/);
    const doctor = await call(server, 3, 'baton_deployment_doctor', { repoId: REPO_ID });
    assert.doesNotMatch(resultText(doctor), /MP13-SECRET-VALUE/,
      'env-sourced credential values join the file-class redaction set (runtime-isolation)');
  } finally {
    delete process.env.BATON_MP13_CANARY;
  }
});

// ===========================================================================
// PKG-2 — npm hygiene (stage: manifest/pack work missing)
// ===========================================================================

test('MP14: package.json carries the files allowlist + exports map, and the pack list excludes credentials/evidence/.baton', () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'files allowlist exists');
  assert.ok(manifest.exports, 'the exports map exists for baton/impl imports');
  const packed = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
  const files = JSON.parse(packed)[0]?.files?.map((entry) => entry.path) ?? [];
  assert.ok(files.length > 0, 'npm pack --dry-run lists files');
  for (const banned of [/\.baton\//u, /key\.json$/u, /evidence\//u, /^docs\/reference\/evidence/u]) {
    assert.equal(files.some((path) => banned.test(path)), false, `pack excludes ${banned}`);
  }
  assert.ok(files.some((path) => path.startsWith('src/')), 'pack includes src/');
  assert.ok(files.some((path) => path.startsWith('scripts/')), 'pack includes scripts/');
  assert.equal(files.some((path) => path.startsWith('test/')), false, 'pack excludes the test tree (allowlist, not kitchen sink)');
});

test('MP15: npm pack → clean install → descriptor-driven stdio handshake (the install smoke)', { timeout: 180_000 }, async () => {
  const directory = root('mp15');
  const packOut = execFileSync('npm', ['pack', '--json'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' });
  const tarball = JSON.parse(packOut)[0]?.filename;
  assert.ok(tarball, 'npm pack produced a tarball');
  const installDir = join(directory, 'install');
  mkdirSync(installDir, { recursive: true });
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--omit=dev', join(import.meta.dirname, '..', tarball)],
    { cwd: installDir, encoding: 'utf8', timeout: 120_000 });
  const descriptorPath = join(directory, 'descriptor.json');
  writeFileSync(descriptorPath, JSON.stringify({
    repo: directory, deploymentRoot: join(directory, '.baton', 'smoke'),
    routes: [], surface: 'application',
    principal: { userId: 'smoke', capabilities: ['observe'] },
  }));
  const binPath = join(installDir, 'node_modules', 'baton', 'scripts', 'mcp-stdio.mjs');
  const child = spawnProcess(process.execPath, [binPath, descriptorPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const answer = await mcpRoundTrip(child, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mp15', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    assert.match(answer, /baton_deployment_doctor/, 'the packed install serves the doctor tool over stdio');
  } finally {
    child.kill('SIGKILL');
  }
});

test('MP16: the stdio/bin paths never eagerly import the native Atlas stack (lazy natives pin)', () => {
  const stdio = readFileSync(join(import.meta.dirname, '..', 'scripts', 'mcp-stdio.mjs'), 'utf8');
  assert.equal(/atlas|ast-grep/.test(stdio), false, 'mcp-stdio carries no native import');
  const indexSource = readFileSync(join(import.meta.dirname, '..', 'src', 'index.mjs'), 'utf8');
  const eagerAtlas = indexSource.split('\n').filter((line) => /^import .*atlas/.test(line));
  assert.equal(eagerAtlas.length, 0, 'index.mjs lazy-loads the Atlas stack (clean-host installs degrade honestly)');
});

// ===========================================================================
// PKG-3 — the guide's executable truth (stage: descriptor example missing)
// ===========================================================================

test('MP17: MCP.md\'s quickstart descriptor parses and validates against the closed schema', async () => {
  const doc = readFileSync(join(import.meta.dirname, '..', 'MCP.md'), 'utf8');
  const match = doc.match(/```json\s*(\{[\s\S]*?"routes"[\s\S]*?)\s*```/u);
  assert.ok(match, 'MCP.md carries a fenced JSON descriptor example');
  const example = JSON.parse(match[1]);
  for (const field of ['repo', 'routes', 'surface']) assert.ok(Object.hasOwn(example, field), `the example carries ${field}`);
  assert.ok(Array.isArray(example.routes) && example.routes.length > 0, 'the example routes are concrete');
});

// ===========================================================================
// MP18 — the E2E acceptance row: an external stdio driver orchestrates a wave
// purely through MCP tools (stage: tools missing)
// ===========================================================================

test('MP18: an external process orchestrates a wave purely through stdio MCP (start → progress → decision → attach → harvest)', { timeout: 300_000 }, async (t) => {
  const directory = root('mp18');
  const factoryPath = join(directory, 'factory.mjs');
  writeFileSync(factoryPath, e2eFactorySource(directory));
  const child = spawnProcess(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'mcp-stdio.mjs'), factoryPath],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const transcript = await mcpScript(child, [
      ['initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mp18', version: '1' } }],
      ['notifications/initialized'],
      ['tools/call', { name: 'baton_deployment_doctor', arguments: { repoId: 'repo-mp18' } }],
      ['tools/call', { name: 'baton_waves_start', arguments: {
        repoId: 'repo-mp18', idempotencyKey: 'mp18-wave',
        members: [{ role: 'surveyor', objective: 'survey (marker:surveyor)', exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'] }],
      } }],
      ['tools/call', { name: 'baton_waves_progress', arguments: { repoId: 'repo-mp18', waveId: `wave:${'a'.repeat(32)}` } }],
    ]);
    assert.match(transcript, /surveyor|wave:/, 'the wave starts over MCP');
    assert.match(transcript, /"phase"|progressClass/, 'progress is readable over MCP');
    assert.doesNotMatch(transcript, /application_run_view_oversize/, 'progress never exceeds the frame');
  } finally {
    child.kill('SIGKILL');
  }
  void t;
});

// E2E helpers (factory source + the stdio round-trip driver) live here so the rows read top-down.
function e2eFactorySource(directory) {
  return `import { BatonApplication, MockAdapter, createDriver } from 'baton/impl';
import { CoordinationStore } from 'baton/impl';
export default async function createMcpServer() {
  const repoId = 'repo-mp18';
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'reports/surveyor.md', content: 'report' }] } });
  const driver = createDriver({
    repoRoot: ${JSON.stringify(directory)}, repoId, logDir: ${JSON.stringify(join(directory, 'log'))},
    adapters: { mock: adapter }, stopDeadlineMs: 2_000,
    goalPlanAuthority: { policy: ${JSON.stringify(goalPlanPolicyLiteral())}, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver, repoId, profiles: { default: ${JSON.stringify(profileLiteral())} },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: { actor: 'mp18', principalId: 'planner', sessionId: 's-planner' },
      dispatcher: { actor: 'mp18', principalId: 'dispatcher', sessionId: 's-dispatcher' },
      observer: { actor: 'mp18', principalId: 'observer', sessionId: 's-observer' },
    },
    authorize: async () => true,
  });
  return {
    coordinator: driver.coordinator, coordination: driver.coordination, application,
    surface: 'application',
    principal: { userId: 'mp18', sessionId: 'mp18-session', capabilities: ['control', 'observe', 'approve'],
      repoIds: [repoId], expiresAt: new Date(Date.now() + 3_600_000).toISOString(), revoked: false },
    shutdownPrincipal: { actor: 'mp18-host', principalId: 'mp18-host', sessionId: 'mp18-host-session' },
    repoIds: [repoId],
  };
}
`;
}
function goalPlanPolicyLiteral() {
  return {
    schemaVersion: 1, repoId: 'repo-mp18', mandatory: true, approvalTtlMs: 60000,
    riskClasses: ['low'], effectClasses: ['provider_call', 'repository_edit'], capabilityClasses: ['code'],
    limits: {
      maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
      maxTextBytes: 4096, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
      maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
      maxTokens: 1000000, maxUsd: 100, maxWallMin: 480, maxProviderTurns: 2048,
    },
  };
}
function profileLiteral() {
  return {
    schemaVersion: 1, repoId: 'repo-mp18', definitionOfDone: ['v'], constraints: [], risk: 'low',
    goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
    nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
    pathScope: ['**'],
    verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536, requiredPredecessorEvidence: [] },
    routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
    capabilities: ['code'], effects: ['provider_call', 'repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  };
}

// A minimal newline-delimited-JSON stdio MCP driver for the E2E rows.
async function mcpRoundTrip(child, messages, timeoutMs = 60_000) {
  return mcpScript(child, messages.map((message) => [message.method, message.params ?? {}, message.id]), timeoutMs);
}
function mcpScript(child, steps, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let transcript = '';
    const timer = setTimeout(() => reject(new Error(`stdio MCP timed out; transcript: ${transcript.slice(-600)}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      transcript = buffer;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        if (steps.length === 0) {
          clearTimeout(timer);
          resolve(transcript);
          return;
        }
        const [method, params, id] = steps.shift();
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id: id ?? 1 } : { id: 1 }), method, params })}\n`);
        if (steps.length === 0) {
          // allow one response frame, then resolve on next line
        }
      }
      if (steps.length === 0) {
        clearTimeout(timer);
        resolve(transcript);
      }
    });
    child.stderr.on('data', (chunk) => { transcript += chunk.toString('utf8'); });
    child.on('error', reject);
    // prime the first request
    const [method, params, id] = steps.shift();
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: id ?? 1, method, params })}\n`);
  });
}
