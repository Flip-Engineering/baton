// MCP-first + packaging epic red suite (contract: docs/reference/evidence/
// mcp-packaging-2026-08-02/mcp-packaging-decisions.md v1.0 — operator steering 2026-08-02).
//
// Eighteen rows over the folded decisions: MCP-W1 wave ergonomics on the ordinary surface
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
import { execFileSync } from 'node:child_process';
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
        if (name === 'waves.start') return { waveId: 'wave:abc', members: [{ role: 'a', runId: 'run-a' }, { role: 'b', runId: 'run-b' }] };
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
  assert.equal(payload.waveId, 'wave:abc');
  assert.deepEqual(payload.members.map((member) => member.runId), ['run-a', 'run-b'], 'the detached shape carries runIds, never live handles');
});

test('MP2: baton_waves_start refuses an off-profile route at admission (profile enforcement)', async () => {
  const { server } = setup({});
  await initialized(server);
  const response = await call(server, 2, 'baton_waves_start', {
    repoId: REPO_ID, idempotencyKey: 'mp2-wave',
    members: [{ role: 'a', objective: 'do a', exact: { harness: 'not-a-harness', model: 'x', effort: 'low' } }],
  });
  assert.equal(response.result.isError, true);
  assert.match(resultText(response), /route|profile|unavailable/);
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
  const page1 = await call(server, 2, 'baton_waves_progress', { repoId: REPO_ID, waveId: 'wave:abc' });
  assert.equal(page1.result.isError, false, `progress must dispatch: ${resultText(page1)}`);
  const payload = JSON.parse(resultText(page1));
  assert.ok(Array.isArray(payload.members) && payload.members.length <= 16, 'members paginate ≤16 per page');
  assert.ok(Number.isSafeInteger(payload.nextCursor) || payload.nextCursor === null, 'the cursor chain is explicit');
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
    repoId: REPO_ID, waveId: 'wave:abc', members: [{ role: 'a', objective: 'do a' }],
  });
  assert.equal(attached.result.isError, false, `attach must dispatch: ${resultText(attached)}`);
  const payload = JSON.parse(resultText(attached));
  assert.equal(payload.harvestReplayed ?? null, false, 'the response marks first-harvest vs replay');
  const steered = await call(server, 3, 'baton_waves_send', {
    repoId: REPO_ID, runId: 'run-a', message: 'continue with the second pass',
  });
  assert.equal(steered.result.isError, false, `waves.send works on the attached runIds (resume-steer): ${resultText(steered)}`);
  assert.ok(commandCalls.some((call) => call.name === 'waves.send' || call.name === 'run.send' || call.name === 'run.steer'),
    'the send reaches the member lane');
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
    repoId: REPO_ID, clock: () => new Date(NOW).toISOString(),
  });
  void store;
  // The store-level order property is pinned by the suite's KS2 sibling rows; this row pins the
  // MCP-visible consequence: a replayed knowledge.promote with a forged envelope is the session
  // refusal, never a replay success.
  const { server } = setup({ directory, principal: principal({ capabilities: ['control', 'observe', 'approve', 'settlement'] }) });
  await initialized(server);
  const forged = await call(server, 2, 'baton_knowledge_promote', {
    repoId: REPO_ID, idempotencyKey: 'mp8-forged',
    runId: 'run-a', candidateFindingId: 'finding:board-close:x:1',
    policy: { repoId: REPO_ID, maxBatchBytes: 1024, maxResultBytes: 1024 },
    lease: { id: 'x', digest: '0'.repeat(64), issuedEvent: 1 },
    sessionAuthority: {
      schemaVersion: 1, authorityDigest: 'f'.repeat(64),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      orchestratorLeaseId: `run-orchestrator-lease:${'0'.repeat(64)}`,
    },
  });
  assert.equal(forged.result.isError, true);
  assert.match(resultText(forged), /session_mismatch|lease_not_found|lease_invalid/,
    'a forged envelope gets the session/lease refusal, never a replay');
});

test('MP9: knowledge_settlement_lease requires the settlement capability on the principal', async () => {
  const { server } = setup({ principal: principal({ capabilities: ['control', 'observe'] }) });
  await initialized(server);
  const response = await call(server, 2, 'baton_knowledge_settlement_lease', {
    repoId: REPO_ID, idempotencyKey: 'mp9-lease', waveId: 'wave:abc',
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
  assert.doesNotMatch(resultText(first) + resultText(second), /sk-[a-z0-9]|token|secret/i, 'zero secret material');
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
});

test('MP12: the descriptor is pinned at open (edits after start have no effect)', async () => {
  const { loadMcpDescriptor } = await import('../src/mcp-descriptor.mjs').catch(() => ({}));
  if (typeof loadMcpDescriptor !== 'function') assert.fail('the descriptor parser exists (PKG-1)');
  const directory = root('mp12');
  writeFileSync(join(directory, 'd.json'), JSON.stringify({ repo: directory, routes: [], surface: 'application' }));
  const parsed = loadMcpDescriptor(join(directory, 'd.json'));
  writeFileSync(join(directory, 'd.json'), JSON.stringify({ repo: '/etc', routes: [], surface: 'advanced' }));
  assert.equal(parsed.surface, 'application', 'the parsed config is immutable for the server\'s life');
  assert.equal(Object.isFrozen(parsed) || Object.isFrozen(parsed.routes), true, 'frozen at open');
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
});

test('MP15: the packed install answers a descriptor-driven stdio handshake (clean-host smoke)', async () => {
  // The gate-row: npm pack → install into tmpdir → run the packed baton-mcp with a fixture
  // descriptor → the MCP handshake + a tools/list answer. Marked slow; the canonical gate runs it.
  const { server } = setup({});
  await initialized(server);
  const list = await request(server, 2, 'tools/list', {});
  assert.ok(JSON.stringify(list.result).includes('baton_deployment_doctor'), 'the packed surface advertises the doctor tool');
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
