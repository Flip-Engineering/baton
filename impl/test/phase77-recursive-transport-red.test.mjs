// Phase 77 transport RED gate — Web derives recursive authority from server state while
// MCP carries the proof installed on its authenticated principal.
// No credential token, lease coordinate, or session authority field may enter the public schemas.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  CoordinationStore,
  McpFleetServer,
  WebNorthbound,
} from '../src/index.mjs';
import { northboundCapabilityToken } from '../src/northbound-capability-authority.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase77-recursive-transport-${label}-`));
const NOW = '2026-07-18T08:00:00.000Z';
const EXPIRES = '2026-07-18T09:00:00.000Z';
const REPO = 'repo-phase77-transport';
const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4,
  maxDescendantsPerRoot: 16, leaseTtlMs: 60_000,
});

function workingParent(store, label, principalId, sessionId) {
  const runId = `run-${label}-parent`;
  const taskId = `task-${label}-parent`;
  const workerId = `worker-${label}-parent`;
  store.createTask({
    id: taskId,
    brief: { objective: 'Serve authenticated recursive Baton commands', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3', modelPolicy: null, effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
  const session = {
    principalId, sessionId,
    authorityDigest: digest({ kind: 'authenticated-transport-session', principalId, sessionId }),
    expiresAt: EXPIRES,
  };
  const identity = {
    repoId: REPO, parentRunId: runId, parentTaskId: taskId,
    parentTaskVersion: task.version, workerId, principalId, sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  const lease = store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO,
    parentTask: { id: taskId, version: task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
  return { lease, runId, task };
}

function applicationRecorder(calls, replays = []) {
  return {
    repoId: REPO,
    card: () => ({
      schemaVersion: 1, repoId: REPO,
      commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
    }),
    async authorizeReplay(name, args, principal, context) {
      replays.push({
        name, args: structuredClone(args), principal: structuredClone(principal),
        context: { ...structuredClone(context), capabilityAuthority: context.capabilityAuthority },
      });
      return true;
    },
    async command(name, args, principal, context) {
      calls.push({
        name, args: structuredClone(args), principal: structuredClone(principal),
        context: { ...structuredClone(context), capabilityAuthority: context.capabilityAuthority },
      });
      return { schemaVersion: 1, runId: args.intent?.runId ?? args.runId, phase: 'awaiting_plan_approval' };
    },
  };
}

function expectedSessionAuthority(lease) {
  return {
    schemaVersion: 1,
    authorityDigest: lease.session.authorityDigest,
    expiresAt: lease.session.expiresAt,
    orchestratorLeaseId: lease.leaseId,
  };
}

const recursiveIntent = (runId) => ({
  runId, objective: 'Recursively improve Baton through Baton', profile: 'standard',
  route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
  scope: ['impl/**'],
});

function mutableClock(initial = NOW) {
  let value = initial;
  return {
    now: () => value,
    set(next) { value = next; },
  };
}

function admitRecipientHistory(store, parent, label) {
  const childRunId = `run-${label}-history-child`;
  const request = {
    schemaVersion: 1,
    repoId: REPO,
    childRunId,
    intentDigest: digest({ childRunId, objective: 'Establish durable recursive recipient history' }),
  };
  store.admitRunLineage(request, {
    actor: `transport:${parent.lease.session.principalId}:${parent.lease.session.sessionId}`,
    key: `run.lineage:${childRunId}`,
    principalId: parent.lease.session.principalId,
    sessionId: parent.lease.session.sessionId,
    sessionAuthorityDigest: parent.lease.session.authorityDigest,
    orchestratorLeaseId: parent.lease.leaseId,
  });
  return childRunId;
}

function stopParentRun(store, parent, label) {
  const reason = `Stop the ${label} recursive recipient parent`;
  const core = { repoId: REPO, runId: parent.runId, reasonDigest: digest(reason) };
  store.admitRunStop({ schemaVersion: 1, ...core, requestDigest: digest(core) }, {
    actor: 'operator:phase77-transport', key: `run.stop:${parent.runId}`,
  });
}

function revokeRecipientLease(store, parent) {
  store.revokeRunOrchestratorLease({
    schemaVersion: 1,
    leaseId: parent.lease.leaseId,
    leaseDigest: parent.lease.leaseDigest,
    reason: 'operator',
  }, {
    actor: 'operator:phase77-transport',
    key: `run.orchestrator_lease.revoke:${parent.lease.leaseId}`,
  });
}

const inactiveRecipientCases = Object.freeze([
  Object.freeze({
    label: 'expired', code: 'run_orchestrator_lease_expired',
    inactivate({ clock }) { clock.set('2026-07-18T08:01:00.001Z'); },
  }),
  Object.freeze({
    label: 'revoked', code: 'run_orchestrator_lease_revoked',
    inactivate({ coordination, parent }) { revokeRecipientLease(coordination, parent); },
  }),
  Object.freeze({
    label: 'stopped', code: 'run_stopping',
    inactivate({ coordination, parent, label }) { stopParentRun(coordination, parent, label); },
  }),
]);

test('RT1 RED: Web derives private recursive context from the authenticated durable session', async (t) => {
  const directory = root('web');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordination = new CoordinationStore(directory, {
    repoId: REPO, clock: () => NOW, runLineagePolicy,
  });
  const calls = [];
  const replays = [];
  const parent = workingParent(coordination, 'web', 'web-recipient', 'web-session');
  const application = applicationRecorder(calls, replays);
  const web = new WebNorthbound({
    coordinator: {}, coordination, application,
    repoIds: [REPO], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse(NOW),
  });
  const principal = {
    userId: 'web-recipient', sessionId: 'web-session', credentialId: 'credential-private',
    authMethod: 'cookie', csrfToken: 'csrf-private', expiresAt: EXPIRES, revoked: false,
    capabilities: ['control', 'observe'], repoIds: [REPO],
  };
  const commandId = 'recursive-web-command';
  const response = await web.execute({
    principal, origin: 'https://control.example.test', csrfToken: 'csrf-private',
    remoteAddress: '127.0.0.1', transport: 'https',
  }, {
    schemaVersion: 1, commandId, idempotencyKey: commandId, command: 'run_start',
    args: { intent: recursiveIntent('run-web-recursive-child') },
    repoId: REPO, runId: 'run-web-recursive-child', origin: 'https://control.example.test',
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, {
    transport: 'web', requestId: commandId,
    idempotencyKey: `web.command:${commandId}`,
    capabilityAuthority: northboundCapabilityToken('web'),
    capabilities: ['control', 'observe'],
    sessionAuthority: expectedSessionAuthority(parent.lease),
  });
  assert.deepEqual(Object.keys(calls[0].context).sort(), [
    'capabilities', 'capabilityAuthority', 'idempotencyKey', 'requestId',
    'sessionAuthority', 'transport',
  ]);
  assert.equal(JSON.stringify(calls[0]).includes('credential-private'), false);
  assert.equal(JSON.stringify(calls[0]).includes('csrf-private'), false);
  assert.equal(Object.hasOwn(calls[0].args, 'sessionAuthority'), false);
  const replay = await web.execute({
    principal, origin: 'https://control.example.test', csrfToken: 'csrf-private',
    remoteAddress: '127.0.0.1', transport: 'https',
  }, {
    schemaVersion: 1, commandId, idempotencyKey: commandId, command: 'run_start',
    args: { intent: recursiveIntent('run-web-recursive-child') },
    repoId: REPO, runId: 'run-web-recursive-child', origin: 'https://control.example.test',
  });
  assert.equal(replay.status, 200);
  assert.equal(replays.length, 1);
  assert.deepEqual(replays[0].context, calls[0].context,
    'replay rechecks the same server-derived recursive authority');
  assert.deepEqual(coordination.activeRunOrchestratorLeaseForSession({
    repoId: REPO, principalId: 'web-recipient', sessionId: 'web-session', expiresAt: EXPIRES,
  }), parent.lease);
  coordination.releaseWriterLease();
});

async function initialize(server) {
  const initialized = await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'phase77-recursive-test', version: '1.0.0' },
    },
  });
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

test('RT2 RED: MCP carries authenticated private authority without adding a tool input field', async (t) => {
  const directory = root('mcp');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordination = new CoordinationStore(directory, {
    repoId: REPO, clock: () => NOW, runLineagePolicy,
  });
  const calls = [];
  const replays = [];
  const parent = workingParent(coordination, 'mcp', 'mcp-recipient', 'mcp-session');
  const application = applicationRecorder(calls, replays);
  const server = new McpFleetServer({
    coordinator: {}, coordination, application, applicationOwned: false,
    principal: {
      userId: 'mcp-recipient', sessionId: 'mcp-session', expiresAt: EXPIRES,
      revoked: false, capabilities: ['control', 'observe'], repoIds: [REPO],
      sessionAuthority: expectedSessionAuthority(parent.lease),
    },
    repoIds: [REPO], surface: 'application', bindApplicationContext: true,
    now: () => Date.parse(NOW), maxWaitMs: 30_000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  await initialize(server);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const startTool = listed.result.tools.find((tool) => tool.name === 'baton_run_start');
  assert.ok(startTool);
  assert.equal(Object.hasOwn(startTool.inputSchema.properties, 'sessionAuthority'), false);
  assert.equal(Object.hasOwn(startTool.inputSchema.properties, 'orchestratorLeaseId'), false);
  assert.equal(Object.hasOwn(startTool.inputSchema.properties, 'authorityDigest'), false);

  const response = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'baton_run_start',
      arguments: { intent: recursiveIntent('run-mcp-recursive-child') },
    },
  });
  assert.equal(response.result.isError, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.transport, 'mcp');
  assert.match(calls[0].context.requestId, /^[A-Za-z0-9-]{16,}$/u);
  assert.equal(calls[0].context.idempotencyKey, `mcp.call:${calls[0].context.requestId}`);
  assert.equal(calls[0].context.capabilityAuthority, northboundCapabilityToken('mcp'));
  assert.deepEqual(calls[0].context.capabilities, ['control', 'observe']);
  assert.deepEqual(calls[0].context.sessionAuthority, expectedSessionAuthority(parent.lease));
  assert.deepEqual(Object.keys(calls[0].context).sort(), [
    'capabilities', 'capabilityAuthority', 'idempotencyKey', 'requestId',
    'sessionAuthority', 'transport',
  ]);
  assert.equal(JSON.stringify(calls[0]).includes('token'), false);
  assert.equal(Object.hasOwn(calls[0].args, 'sessionAuthority'), false);
  const replay = await server.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: {
      name: 'baton_run_start',
      arguments: { intent: recursiveIntent('run-mcp-recursive-child') },
    },
  });
  assert.equal(replay.result.isError, false);
  assert.equal(replays.length, 1);
  assert.deepEqual(replays[0].context, calls[0].context,
    'MCP replay rechecks the same authenticated recursive lease');
  assert.deepEqual(await server.close(), {
    schemaVersion: 1, state: 'transport_closed', applicationOwned: false,
  });
  coordination.releaseWriterLease();
});

test('RT3 RED: inactive or ambiguous authenticated lease lookup never projects authority', () => {
  const directory = root('lookup');
  const coordination = new CoordinationStore(directory, {
    repoId: REPO, clock: () => NOW, runLineagePolicy,
  });
  workingParent(coordination, 'lookup-one', 'lookup-recipient', 'lookup-session');
  assert.equal(coordination.activeRunOrchestratorLeaseForSession({
    repoId: REPO, principalId: 'lookup-recipient', sessionId: 'other-session', expiresAt: EXPIRES,
  }), null);
  assert.equal(coordination.activeRunOrchestratorLeaseForSession({
    repoId: REPO, principalId: 'lookup-recipient', sessionId: 'lookup-session',
    expiresAt: '2026-07-18T10:00:00.000Z',
  }), null);
  workingParent(coordination, 'lookup-two', 'lookup-recipient', 'lookup-session');
  assert.throws(() => coordination.activeRunOrchestratorLeaseForSession({
    repoId: REPO, principalId: 'lookup-recipient', sessionId: 'lookup-session', expiresAt: EXPIRES,
  }), (error) => error.code === 'run_orchestrator_lease_conflict');
  coordination.releaseWriterLease();
  rmSync(directory, { recursive: true, force: true });
});

test('RT4 RED: Web recipient history cannot downgrade after lease expiry, revocation, or parent stop', async (t) => {
  for (const inactiveCase of inactiveRecipientCases) {
    await t.test(inactiveCase.label, async (t) => {
      const directory = root(`web-no-downgrade-${inactiveCase.label}`);
      const clock = mutableClock();
      const coordination = new CoordinationStore(directory, {
        repoId: REPO, clock: clock.now, runLineagePolicy,
      });
      t.after(() => {
        coordination.releaseWriterLease();
        rmSync(directory, { recursive: true, force: true });
      });
      const calls = [];
      const replays = [];
      const principalId = `web-${inactiveCase.label}-recipient`;
      const sessionId = `web-${inactiveCase.label}-session`;
      const parent = workingParent(
        coordination, `web-${inactiveCase.label}`, principalId, sessionId,
      );
      assert.equal(
        coordination.runLineage(admitRecipientHistory(
          coordination, parent, `web-${inactiveCase.label}`,
        )).lease.id,
        parent.lease.leaseId,
      );
      const web = new WebNorthbound({
        coordinator: {}, coordination, application: applicationRecorder(calls, replays),
        repoIds: [REPO], allowedOrigins: ['https://control.example.test'],
        now: () => Date.parse(clock.now()),
      });
      const principal = {
        userId: principalId, sessionId, credentialId: `credential-${inactiveCase.label}`,
        authMethod: 'cookie', csrfToken: `csrf-${inactiveCase.label}`, expiresAt: EXPIRES,
        revoked: false, capabilities: ['control', 'observe'], repoIds: [REPO],
      };
      const context = {
        principal, origin: 'https://control.example.test',
        csrfToken: principal.csrfToken, remoteAddress: '127.0.0.1', transport: 'https',
      };
      const commandId = `recursive-web-${inactiveCase.label}-completed`;
      const completedEnvelope = {
        schemaVersion: 1, commandId, idempotencyKey: commandId, command: 'run_start',
        args: { intent: recursiveIntent(`run-web-${inactiveCase.label}-completed-child`) },
        repoId: REPO, runId: `run-web-${inactiveCase.label}-completed-child`,
        origin: 'https://control.example.test',
      };
      assert.equal((await web.execute(context, completedEnvelope)).status, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].context.sessionAuthority, expectedSessionAuthority(parent.lease));

      inactiveCase.inactivate({ clock, coordination, parent, label: inactiveCase.label });

      const completedReplay = await web.execute(context, completedEnvelope);
      assert.equal(completedReplay.status, 409);
      assert.equal(completedReplay.body.error.code, inactiveCase.code);
      assert.equal(replays.length, 0,
        'a completed recursive command cannot be replay-authorized as an ordinary command');

      const freshCommandId = `recursive-web-${inactiveCase.label}-fresh`;
      const fresh = await web.execute(context, {
        schemaVersion: 1, commandId: freshCommandId,
        idempotencyKey: freshCommandId, command: 'run_start',
        args: { intent: recursiveIntent(`run-web-${inactiveCase.label}-fresh-child`) },
        repoId: REPO, runId: `run-web-${inactiveCase.label}-fresh-child`,
        origin: 'https://control.example.test',
      });
      assert.equal(fresh.status, 409);
      assert.equal(fresh.body.error.code, inactiveCase.code);
      assert.equal(calls.length, 1,
        'durable recursive recipient history cannot fall through to ordinary application authority');
    });
  }
});

test('RT5 RED: MCP preserves caller-supplied authority after lease expiry, revocation, or parent stop', async (t) => {
  for (const inactiveCase of inactiveRecipientCases) {
    await t.test(inactiveCase.label, async (t) => {
      const directory = root(`mcp-no-downgrade-${inactiveCase.label}`);
      const clock = mutableClock();
      const coordination = new CoordinationStore(directory, {
        repoId: REPO, clock: clock.now, runLineagePolicy,
      });
      const calls = [];
      const replays = [];
      const principalId = `mcp-${inactiveCase.label}-recipient`;
      const sessionId = `mcp-${inactiveCase.label}-session`;
      const parent = workingParent(
        coordination, `mcp-${inactiveCase.label}`, principalId, sessionId,
      );
      assert.equal(
        coordination.runLineage(admitRecipientHistory(
          coordination, parent, `mcp-${inactiveCase.label}`,
        )).lease.id,
        parent.lease.leaseId,
      );
      const server = new McpFleetServer({
        coordinator: {}, coordination, application: applicationRecorder(calls, replays),
        applicationOwned: false,
        principal: {
          userId: principalId, sessionId, expiresAt: EXPIRES, revoked: false,
          capabilities: ['control', 'observe'], repoIds: [REPO],
          sessionAuthority: expectedSessionAuthority(parent.lease),
        },
        repoIds: [REPO], surface: 'application', bindApplicationContext: true,
        now: () => Date.parse(clock.now()), maxWaitMs: 30_000,
        maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }),
      });
      t.after(async () => {
        await server.close();
        coordination.releaseWriterLease();
        rmSync(directory, { recursive: true, force: true });
      });
      await initialize(server);
      const completedCall = {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'baton_run_start',
          arguments: { intent: recursiveIntent(`run-mcp-${inactiveCase.label}-completed-child`) },
        },
      };
      const completed = await server.handle(completedCall);
      assert.equal(completed.result.isError, false);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].context.sessionAuthority, expectedSessionAuthority(parent.lease));

      inactiveCase.inactivate({ clock, coordination, parent, label: inactiveCase.label });

      const completedReplay = await server.handle(completedCall);
      assert.equal(completedReplay.result.isError, false);
      assert.equal(replays.length, 1);
      assert.deepEqual(replays[0].context.sessionAuthority, expectedSessionAuthority(parent.lease),
        'the thin MCP adapter preserves proof for application replay authorization');

      const fresh = await server.handle({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: {
          name: 'baton_run_start',
          arguments: { intent: recursiveIntent(`run-mcp-${inactiveCase.label}-fresh-child`) },
        },
      });
      assert.equal(fresh.result.isError, false);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].context.sessionAuthority, expectedSessionAuthority(parent.lease),
        'lease-state validation belongs to application admission, not the MCP transport');
    });
  }
});
