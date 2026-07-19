import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  BatonWebApplicationFacade,
  BatonWebClient,
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
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function authority(kind, actionId = `phase87-${kind}`) {
  const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
  const payload = {
    schemaVersion: 1, actionId, kind, effect: definition.effect,
    requiredCapabilities: [...definition.requiredCapabilities],
  };
  return Object.freeze({ ...payload, authorityDigest: digest(payload) });
}
function appPrincipal(id = 'phase87-user') {
  return { actor: `test:${id}`, principalId: id, sessionId: `${id}-session` };
}
function trustedContext(value, capabilities) {
  return {
    transport: 'web', requestId: `request-${value.kind}`,
    idempotencyKey: `key-${value.kind}`,
    capabilityAuthority: northboundCapabilityToken('web'),
    capabilities,
    semanticAuthority: value,
  };
}
function prototypeApplication() {
  const application = Object.create(BatonApplication.prototype);
  application.repoId = 'repo-phase87';
  application.authorize = async () => true;
  return application;
}
function tempRoot(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }

test('SA1/SA3: every semantic action kind has canonical capability authority and replay fails closed', async () => {
  const application = prototypeApplication();
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['run.act'].capabilities, []);
  assert.equal(APPLICATION_COMMAND_DEFINITIONS['run.act'].semanticCapabilities, true);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.act'].destructive, true);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.version, '1.2.0');

  for (const [kind, definition] of Object.entries(APPLICATION_SEMANTIC_REGISTRY.actions)) {
    assert.ok(definition.requiredCapabilities.length > 0, `${kind} lacks semantic capabilities`);
    assert.deepEqual(definition.requiredCapabilities, [...definition.requiredCapabilities].sort(),
      `${kind} capabilities are not canonical`);
    const resolved = authority(kind);
    await application.authorizeReplay(
      'run.act', { runId: 'run-phase87', actionId: resolved.actionId, inputs: {} },
      appPrincipal(), trustedContext(resolved, resolved.requiredCapabilities),
    );
    for (const missing of resolved.requiredCapabilities) {
      await assert.rejects(
        application.authorizeReplay(
          'run.act', { runId: 'run-phase87', actionId: resolved.actionId, inputs: {} },
          appPrincipal(), trustedContext(
            resolved, resolved.requiredCapabilities.filter((capability) => capability !== missing),
          ),
        ),
        (error) => error?.code === 'application_unauthorized',
        `${kind} admitted without ${missing}`,
      );
    }
  }

  const unknownPayload = {
    schemaVersion: 1, actionId: 'phase87-unknown', kind: 'unknown_action',
    effect: 'unknown_effect', requiredCapabilities: ['observe'],
  };
  const unknown = { ...unknownPayload, authorityDigest: digest(unknownPayload) };
  await assert.rejects(
    application.authorizeReplay(
      'run.act', { runId: 'run-phase87', actionId: unknown.actionId, inputs: {} },
      appPrincipal(), trustedContext(unknown, ['observe']),
    ),
    (error) => error?.code === 'application_action_authority_invalid',
  );
  const approve = authority('approve_plan');
  await assert.rejects(
    application.authorizeReplay(
      'run.act', { runId: 'run-phase87', actionId: approve.actionId, inputs: {} },
      appPrincipal(), { ...trustedContext(approve, approve.requiredCapabilities), capabilityAuthority: {} },
    ),
    (error) => error?.code === 'application_context_invalid',
  );
  await assert.rejects(
    application.authorizeReplay(
      'run.act', { runId: 'run-phase87', actionId: approve.actionId, inputs: {} },
      appPrincipal(), {
        ...trustedContext(approve, approve.requiredCapabilities),
        transport: 'mcp', capabilityAuthority: northboundCapabilityToken('web'),
      },
    ),
    (error) => error?.code === 'application_context_invalid',
  );
});

test('SA3: a semantic action consumed while authorization yields is rechecked before effect', async () => {
  const application = prototypeApplication();
  const definition = APPLICATION_SEMANTIC_REGISTRY.actions.approve_plan;
  const resolved = authority('approve_plan', 'phase87-racing-approval');
  const action = {
    ...resolved,
    label: definition.label, summary: definition.summary,
    inputSchema: definition.inputSchema, serverDerived: definition.serverDerived,
    destructive: definition.destructive, irreversible: definition.irreversible,
    idempotent: definition.idempotent, priority: definition.priority,
  };
  const current = { goal: { runId: 'run-phase87-race' }, plan: { digest: 'a'.repeat(64) } };
  let available = true;
  let effects = 0;
  application.authorize = async ({ command }) => {
    if (command === 'run.act') available = false;
    return true;
  };
  application._resolveSemanticAction = async () => ({ current, view: {}, action });
  application.principals = { observer: appPrincipal('observer') };
  application._buildView = async () => ({});
  application._withContextProjection = (_current, view) => view;
  application._semanticActions = () => (available ? [action] : []);
  application.approve = async () => { effects += 1; };
  application.inspect = async () => ({});

  await assert.rejects(
    application.act(
      { runId: 'run-phase87-race', actionId: action.actionId, inputs: {} },
      appPrincipal(),
    ),
    (error) => error?.code === 'application_action_scope_mismatch',
  );
  assert.equal(effects, 0);
});

function webPrincipal(capabilities) {
  return {
    userId: 'web-user', sessionId: 'web-session', credentialId: 'web-credential',
    authMethod: 'cookie', csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z',
    revoked: false, capabilities, repoIds: ['repo-phase87'],
  };
}
function webContext(capabilities) {
  return {
    principal: webPrincipal(capabilities), origin: 'https://baton.example.test',
    csrfToken: 'csrf', remoteAddress: 'local', transport: 'https',
  };
}
function webEnvelope(actionId, idempotencyKey = 'phase87-web-key') {
  return {
    schemaVersion: 1, commandId: `command-${idempotencyKey}`, idempotencyKey,
    command: 'run_act', args: { runId: 'run-phase87', actionId, inputs: {} },
    repoId: 'repo-phase87', runId: 'run-phase87', origin: 'https://baton.example.test',
  };
}

test('SA2/SA3: Web denies semantic authority before quota/admission and persists the trusted winner', async () => {
  const resolved = authority('approve_plan');
  const calls = [];
  let authorityAvailable = true;
  const application = {
    repoId: 'repo-phase87',
    card: () => ({ repoId: 'repo-phase87', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async actionAuthority() {
      calls.push('authority');
      if (!authorityAvailable) throw Object.assign(new Error('gone'), { code: 'application_action_scope_mismatch' });
      return resolved;
    },
    async authorizeReplay(_name, _args, _principal, context) {
      calls.push({ replay: context.semanticAuthority.authorityDigest });
      return true;
    },
    async command(_name, _args, _principal, context) {
      calls.push({ command: context.semanticAuthority.authorityDigest, capabilities: context.capabilities });
      return { schemaVersion: 1, runId: 'run-phase87', phase: 'running' };
    },
  };
  const coordination = new CoordinationStore(tempRoot('baton-phase87-web-'));
  const web = new WebNorthbound({
    coordinator: {}, coordination, application,
    repoIds: ['repo-phase87'], allowedOrigins: ['https://baton.example.test'],
    now: () => Date.parse('2026-07-18T12:00:00.000Z'),
  });
  let quotaCalls = 0;
  web.edge = {
    admitting: true,
    digest: (value) => digest(value),
    takeCommand() { quotaCalls += 1; return { ok: true }; },
  };

  const denied = await web.execute(webContext(['observe']), webEnvelope(resolved.actionId));
  assert.equal(denied.status, 403);
  assert.equal(quotaCalls, 0);
  assert.equal(coordination.events().some((event) => event.kind === 'web.command_admitted'), false);
  assert.equal(calls.filter((entry) => typeof entry === 'object').length, 0);

  const granted = await web.execute(
    webContext(resolved.requiredCapabilities), webEnvelope(resolved.actionId),
  );
  assert.equal(granted.status, 200);
  assert.equal(quotaCalls, 1);
  const admitted = coordination.webCommand('command-phase87-web-key');
  assert.equal(admitted.semanticAuthority.authorityDigest, resolved.authorityDigest);
  assert.deepEqual(calls.find((entry) => entry.command)?.capabilities,
    resolved.requiredCapabilities);

  authorityAvailable = false;
  const replayed = await web.execute(
    webContext(resolved.requiredCapabilities),
    { ...webEnvelope(resolved.actionId), commandId: 'command-phase87-web-replay' },
  );
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(calls.filter((entry) => entry === 'authority').length, 2,
    'completed replay uses persisted authority instead of live action lookup');

  const downgradedQuota = quotaCalls;
  const downgraded = await web.execute(
    webContext(['observe']),
    { ...webEnvelope(resolved.actionId), commandId: 'command-phase87-web-downgraded' },
  );
  assert.equal(downgraded.status, 403);
  assert.equal(quotaCalls, downgradedQuota);
});

async function readyMcp(server) {
  await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
function mcpPrincipal(capabilities) {
  return {
    userId: 'mcp-user', sessionId: 'mcp-session', expiresAt: '2099-01-01T00:00:00.000Z',
    revoked: false, capabilities, repoIds: ['repo-phase87'],
  };
}
function mcpCall(id, actionId, idempotencyKey = 'phase87-mcp-key') {
  return {
    jsonrpc: '2.0', id, method: 'tools/call', params: {
      name: 'baton_run_act', arguments: {
        repoId: 'repo-phase87', idempotencyKey,
        runId: 'run-phase87', actionId, inputs: {},
      },
    },
  };
}

test('SA2/SA4: MCP denies before quota/admission, marks run.act destructive, and forwards trusted authority', async () => {
  const resolved = authority('approve_plan');
  const coordination = new CoordinationStore(tempRoot('baton-phase87-mcp-'));
  const calls = [];
  let quotaCalls = 0;
  const application = {
    repoId: 'repo-phase87',
    card: () => ({ repoId: 'repo-phase87', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { calls.push('replay'); return true; },
    async actionAuthority() { calls.push('authority'); return resolved; },
    async command(_name, _args, _principal, context) {
      calls.push(context);
      return { schemaVersion: 1, runId: 'run-phase87', phase: 'running' };
    },
  };
  const makeServer = (capabilities) => new McpFleetServer({
    coordinator: {}, coordination, application, applicationOwned: false,
    surface: 'application', principal: mcpPrincipal(capabilities), repoIds: ['repo-phase87'],
    now: () => Date.parse('2026-07-18T12:00:00.000Z'), maxWaitMs: 1_000,
    maxMessageBytes: 64 * 1024,
    async takeToolQuota() { quotaCalls += 1; return { ok: true }; },
  });

  const deniedServer = makeServer(['observe']);
  await readyMcp(deniedServer);
  const denied = await deniedServer.handle(mcpCall(2, resolved.actionId));
  assert.equal(denied.result.structuredContent.error.code, 'forbidden');
  assert.equal(quotaCalls, 0);
  assert.equal(coordination.events().some((event) => event.kind === 'mcp.call_admitted'), false);

  const grantedServer = makeServer(resolved.requiredCapabilities);
  await readyMcp(grantedServer);
  const listed = await grantedServer.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(listed.result.tools.find((tool) => tool.name === 'baton_run_act')
    .annotations.destructiveHint, true);
  const granted = await grantedServer.handle(mcpCall(4, resolved.actionId));
  assert.equal(granted.result.isError, false);
  assert.equal(quotaCalls, 1);
  const admission = coordination.events().find((event) => event.kind === 'mcp.call_admitted');
  assert.equal(admission.payload.semanticAuthority.authorityDigest, resolved.authorityDigest);
  const context = calls.find((entry) => entry && typeof entry === 'object');
  assert.equal(context.semanticAuthority.authorityDigest, resolved.authorityDigest);
  assert.deepEqual(context.capabilities, resolved.requiredCapabilities);

  const quotaBeforeDowngrade = quotaCalls;
  const downgradedServer = makeServer(['observe']);
  await readyMcp(downgradedServer);
  const downgraded = await downgradedServer.handle(mcpCall(5, resolved.actionId));
  assert.equal(downgraded.result.structuredContent.error.code, 'forbidden');
  assert.equal(quotaCalls, quotaBeforeDowngrade);
});

test('SA4: Web client and MCP bridge preflight use the exact remote semantic mutation scope', async () => {
  const resolved = authority('approve_plan');
  let request = null;
  const webClient = new BatonWebClient({
    baseUrl: 'https://baton.example.test', origin: 'https://control.example.test',
    repoId: 'repo-phase87', token: 'private-test-token', commandTimeoutMs: 1_000,
    pollMs: 10, clock: () => Date.parse('2026-07-18T12:00:00.000Z'),
    sleep: async () => {},
    async fetchImpl(url, options) {
      request = { url, options };
      return { ok: true, async json() { return { ok: true, semanticAuthority: resolved }; } };
    },
  });
  const fromClient = await webClient.actionAuthority(
    { runId: 'run-phase87', actionId: resolved.actionId, inputs: {} }, 'remote-key',
  );
  assert.equal(fromClient.authorityDigest, resolved.authorityDigest);
  assert.equal(request.url, 'https://baton.example.test/v1/action-authority');
  assert.deepEqual(JSON.parse(request.options.body), {
    schemaVersion: 1, repoId: 'repo-phase87', idempotencyKey: 'remote-key',
    args: { runId: 'run-phase87', actionId: resolved.actionId, inputs: {} },
  });

  const session = {
    schemaVersion: 1,
    identity: {
      userId: 'bridge-user', sessionId: 'bridge-session',
      capabilities: resolved.requiredCapabilities, repoIds: ['repo-phase87'],
    },
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const remoteKeys = [];
  const client = {
    repoId: 'repo-phase87',
    async session() { return session; },
    async doctor() {
      return { ready: true, application: {
        repoId: 'repo-phase87', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
        agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
      } };
    },
    async actionAuthority(_args, key) { remoteKeys.push(['authority', key]); return resolved; },
    async command(_name, _args, key) {
      remoteKeys.push(['command', key]);
      return { schemaVersion: 1, runId: 'run-phase87', phase: 'running' };
    },
  };
  const facade = new BatonWebApplicationFacade(client, {
    repoId: 'repo-phase87', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
    agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
  }, session);
  const principal = {
    actor: 'mcp:bridge-user:bridge-session',
    principalId: 'bridge-user', sessionId: 'bridge-session',
  };
  const args = { runId: 'run-phase87', actionId: resolved.actionId, inputs: {} };
  await facade.actionAuthority(args, principal);
  await facade.command('run.act', args, principal, {
    transport: 'mcp', requestId: 'bridge-call', idempotencyKey: 'mcp.call:bridge-call',
  });
  assert.equal(remoteKeys[0][1], remoteKeys[1][1]);
  const replayContext = {
    transport: 'mcp', requestId: 'bridge-replay', idempotencyKey: 'mcp.call:bridge-replay',
    capabilityAuthority: northboundCapabilityToken('mcp'),
    capabilities: resolved.requiredCapabilities,
    semanticAuthority: resolved,
  };
  await facade.authorizeReplay('run.act', args, principal, replayContext);
  const driftedCapabilityPayload = {
    schemaVersion: 1, actionId: resolved.actionId, kind: resolved.kind,
    effect: resolved.effect, requiredCapabilities: ['observe'],
  };
  const driftedEffectPayload = {
    schemaVersion: 1, actionId: resolved.actionId, kind: resolved.kind,
    effect: 'provider_control', requiredCapabilities: resolved.requiredCapabilities,
  };
  const swappedActionPayload = {
    schemaVersion: 1, actionId: 'phase87-swapped-action', kind: resolved.kind,
    effect: resolved.effect, requiredCapabilities: resolved.requiredCapabilities,
  };
  for (const invalidContext of [
    { ...replayContext, capabilities: ['observe'] },
    { ...replayContext, capabilities: [...resolved.requiredCapabilities, 'control'] },
    { ...replayContext, capabilityAuthority: {} },
    { ...replayContext, semanticAuthority: { ...resolved, authorityDigest: '0'.repeat(64) } },
    { ...replayContext, semanticAuthority: {
      ...driftedCapabilityPayload, authorityDigest: digest(driftedCapabilityPayload),
    } },
    { ...replayContext, semanticAuthority: {
      ...driftedEffectPayload, authorityDigest: digest(driftedEffectPayload),
    } },
    { ...replayContext, semanticAuthority: {
      ...swappedActionPayload, authorityDigest: digest(swappedActionPayload),
    } },
  ]) {
    await assert.rejects(
      facade.authorizeReplay('run.act', args, principal, invalidContext),
      (error) => error?.code === 'application_unauthorized',
    );
  }
});
