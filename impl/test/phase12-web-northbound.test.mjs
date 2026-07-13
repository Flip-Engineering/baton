import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { CoordinationStore, MockAdapter, WebNorthbound, createAuthenticatedWebServer, createDriver } from '../src/index.mjs';

const root = () => mkdtempSync(join(tmpdir(), 'baton-web-'));
const envelope = (overrides = {}) => ({
  schemaVersion: 1,
  commandId: 'cmd-1',
  idempotencyKey: 'retry-1',
  command: 'spawn',
  args: {
    harness: 'grok',
    model: 'grok-4-code',
    modelPolicy: { reasoningEffort: 'high' },
    brief: { goal: 'test', constraints: [], pathScope: ['x'], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10, usd: 1, wallMin: 1 } },
  },
  repoId: 'repo-a',
  runId: 'run-web-a',
  origin: 'https://control.example.test',
  ...overrides,
});
const principal = (overrides = {}) => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
  csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: ['repo-a'],
  ...overrides,
});
const context = (overrides = {}) => ({
  principal: principal(), origin: 'https://control.example.test', csrfToken: 'csrf-1',
  remoteAddress: '127.0.0.1', transport: 'https', ...overrides,
});

function fixture(overrides = {}) {
  const calls = [];
  const coordinator = {
    async spawn(harness, brief, opts) { calls.push({ op: 'spawn', harness, brief, opts }); return { id: 'w-1', taskId: opts.taskId, fence: 1 }; },
    list() { calls.push({ op: 'list' }); return [{ id: 'w-1', fence: 1, status: 'working' }]; },
    async result(workerId) { calls.push({ op: 'result', workerId }); return { ready: false, status: 'working' }; },
    async send(workerId, message, mode, opts) { calls.push({ op: 'send', workerId, message, mode, opts }); return { ok: true, result: 'ok' }; },
    async respond(requestId, answer, actor) { calls.push({ op: 'respond', requestId, answer, actor }); return { ok: true, result: 'applied' }; },
    async interrupt(workerId, then, actor, opts) { calls.push({ op: 'interrupt', workerId, then, actor, opts }); return { ok: true, result: 'confirmed' }; },
    async kill(workerId, actor, opts) { calls.push({ op: 'kill', workerId, actor, opts }); return { ok: true, result: 'confirmed' }; },
    async wait(timeoutMs) { calls.push({ op: 'wait', timeoutMs }); return { attention: [], facts: [] }; },
    capabilityCards() { calls.push({ op: 'capabilities' }); return [{ name: 'atlas', ops: { 'symbols.search': {} } }]; },
    async invokeCapability(name, op, args, ctx) { calls.push({ action: 'invoke', name, capabilityOp: op, args, ctx }); return { op, status: 'ok' }; },
    async resumeCapability(name, op, ref, cursor, ctx) { calls.push({ action: 'resume', name, capabilityOp: op, ref, cursor, ctx }); return { op, status: 'ok' }; },
    async reverifyCapability(name, op, claim, args, ctx) { calls.push({ action: 'reverify', name, capabilityOp: op, claim, args, ctx }); return { op, status: 'ok' }; },
    async orientWorker(workerId, args, note, ctx) { calls.push({ action: 'push', workerId, args, note, ctx }); return { ok: true, result: 'ok', sliceDigest: 'a'.repeat(64) }; },
    async decideReuse(request, ctx) { calls.push({ action: 'reuse_decide', request, ctx }); return { ok: true, result: 'recorded', decision: { id: 'reuse-decision:test' } }; },
    async recheckReuseDecision(request, ctx) { calls.push({ action: 'reuse_recheck', request, ctx }); return { ok: true, result: 'guarded', targets: [] }; },
    ...overrides.coordinator,
  };
  const coordination = new CoordinationStore(root());
  const web = new WebNorthbound({
    coordinator, coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-07-11T12:00:00.000Z'),
    ...(overrides.edgePolicy ? { edgePolicy: overrides.edgePolicy } : {}),
  });
  return { web, coordination, calls };
}

test('WN2/WN3/WN5: authentication, exact origin, CSRF, capability, and repo scope fail before dispatch', async () => {
  const { web, calls, coordination } = fixture();
  for (const [ctx, expected] of [
    [{ ...context(), principal: null }, 'unauthenticated'],
    [context({ origin: 'https://evil.test' }), 'forbidden'],
    [context({ csrfToken: 'wrong' }), 'forbidden'],
    [context({ principal: principal({ capabilities: ['observe'] }) }), 'forbidden'],
    [context({ principal: principal({ repoIds: ['repo-b'] }) }), 'forbidden'],
    [context({ principal: principal({ revoked: true }) }), 'unauthenticated'],
    [context({ principal: principal({ expiresAt: '2020-01-01T00:00:00.000Z' }) }), 'unauthenticated'],
    [context({ principal: principal({ expiresAt: 'not-a-date' }) }), 'unauthenticated'],
  ]) {
    const result = await web.execute(ctx, envelope());
    assert.equal(result.body.error.code, expected);
  }
  assert.equal(calls.length, 0);
  assert.equal(coordination.events().filter((event) => event.kind === 'web.command_admitted').length, 0);
});

test('WN1/WN4: spawn forwards harness and exact model independently and derives the audit actor from auth', async () => {
  const { web, calls, coordination } = fixture();
  const result = await web.execute(context(), envelope());
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(({ op }) => op), ['spawn']);
  assert.equal(calls[0].harness, 'grok');
  assert.equal(calls[0].opts.model, 'grok-4-code');
  assert.deepEqual(calls[0].opts.modelPolicy, { reasoningEffort: 'high' });
  assert.equal(calls[0].opts.actor, 'web:user-1:session-1');
  assert.equal(calls[0].opts.taskId, 'web-cmd-1');
  assert.equal(calls[0].opts.runId, 'run-web-a');
  const admitted = coordination.events().find((event) => event.kind === 'web.command_admitted');
  assert.equal(admitted.actor, 'web:user-1:session-1');
  assert.equal(admitted.payload.credentialId, 'cred-1');
  assert.equal(JSON.stringify(admitted).includes('csrf-1'), false);
});

test('RD10: authenticated web reuse decision preserves principal actor, repo, budget, and durable idempotency', async () => {
  const { web, calls } = fixture();
  const args = { need: 'JWT verification', choice: 'borrow', rationale: 'Exact green evidence.', dossier: { claim: {}, args: {} }, sbom: { claim: {}, args: {} }, budgetTokens: 4_000 };
  const response = await web.execute(context(), envelope({ commandId: 'reuse-web', idempotencyKey: 'reuse-web-idem', command: 'reuse_decide', args }));
  assert.equal(response.status, 200); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { action: 'reuse_decide', request: args, ctx: { actor: 'web:user-1:session-1', repoId: 'repo-a', budgetTokens: 4_000, idempotencyKey: 'web.command:reuse-web' } });
});

test('RD10/WN6: reuse decisions consume exact edge cost 20 and exhausted quota refuses before dispatch', async () => {
  const now = () => Date.parse('2026-07-11T12:00:00.000Z');
  const { web, calls } = fixture({ edgePolicy: {
    addressKey: 'phase38-address-key', now, limits: { cost: 20, principal: 10 },
  } });
  const args = { need: 'JWT verification', choice: 'borrow', rationale: 'Exact green evidence.', dossier: { claim: {}, args: {} }, sbom: { claim: {}, args: {} }, budgetTokens: 4_000 };
  const accepted = await web.execute(context(), envelope({ commandId: 'reuse-cost-20', idempotencyKey: 'reuse-cost-20', command: 'reuse_decide', args }));
  assert.equal(accepted.status, 200);
  assert.equal(calls.length, 1);

  const refused = await web.execute(context(), envelope({ commandId: 'after-reuse-cost', idempotencyKey: 'after-reuse-cost', command: 'list', args: {} }));
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, 'rate_limited');
  assert.equal(calls.length, 1, 'quota refusal occurs before coordinator dispatch');
});

test('RI10: authenticated web recheck preserves actor/repo/idempotency and accepts no advisory facts', async () => {
  const { web, calls } = fixture();
  const args = { decisionId: 'reuse-decision:test', expectedValidityVersion: 1, trigger: 'advisory_refresh', budgetTokens: 4_000 };
  const response = await web.execute(context(), envelope({ commandId: 'reuse-recheck-web', idempotencyKey: 'reuse-recheck-web', command: 'reuse_recheck', args }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ action: 'reuse_recheck', request: args, ctx: { actor: 'web:user-1:session-1', repoId: 'repo-a', budgetTokens: 4_000, idempotencyKey: 'web.command:reuse-recheck-web' } }]);
  const forged = await web.execute(context(), envelope({ commandId: 'reuse-recheck-forged', idempotencyKey: 'reuse-recheck-forged', command: 'reuse_recheck', args: { ...args, advisoryIds: ['forged'] } }));
  assert.equal(forged.status, 400); assert.equal(calls.length, 1);
});

test('CI6: capability cards require observe while bounded invocation requires control and forwards the authenticated actor', async () => {
  const { web, calls } = fixture();
  const cards = await web.execute(context({ principal: principal({ capabilities: ['observe'] }) }), envelope({
    commandId: 'cards-1', idempotencyKey: 'cards-1', command: 'capabilities', args: {},
  }));
  assert.equal(cards.status, 200);
  assert.deepEqual(cards.body.result, [{ name: 'atlas', ops: { 'symbols.search': {} } }]);

  const refused = await web.execute(context({ principal: principal({ capabilities: ['observe'] }) }), envelope({
    commandId: 'invoke-refused', idempotencyKey: 'invoke-refused', command: 'capability_invoke',
    args: { name: 'atlas', op: 'symbols.search', action: 'invoke', args: { query: 'Coordinator' }, budgetTokens: 80 },
  }));
  assert.equal(refused.status, 403);
  assert.deepEqual(calls.map((call) => call.op ?? call.action), ['capabilities']);

  const invoked = await web.execute(context(), envelope({
    commandId: 'invoke-1', idempotencyKey: 'invoke-1', command: 'capability_invoke',
    args: { name: 'atlas', op: 'symbols.search', action: 'invoke', args: { query: 'Coordinator' }, budgetTokens: 80 },
  }));
  assert.equal(invoked.status, 200);
  assert.deepEqual(calls.at(-1), {
    action: 'invoke', name: 'atlas', capabilityOp: 'symbols.search', args: { query: 'Coordinator' },
    ctx: { budgetTokens: 80, actor: 'web:user-1:session-1' },
  });
});

test('CI3/CI6: capability resume and reverify are strict durable control commands with actor and budget context', async () => {
  const { web, calls, coordination } = fixture();
  const resumed = await web.execute(context(), envelope({
    commandId: 'resume-1', idempotencyKey: 'resume-1', command: 'capability_invoke',
    args: { name: 'atlas', op: 'symbols.search', action: 'resume', ref: { digest: 'abc' }, cursor: 'next-1', budgetTokens: 40 },
  }));
  assert.equal(resumed.status, 200);
  assert.deepEqual(calls.at(-1), {
    action: 'resume', name: 'atlas', capabilityOp: 'symbols.search', ref: { digest: 'abc' }, cursor: 'next-1',
    ctx: { budgetTokens: 40, actor: 'web:user-1:session-1' },
  });

  const reverified = await web.execute(context(), envelope({
    commandId: 'reverify-1', idempotencyKey: 'reverify-1', command: 'capability_invoke',
    args: { name: 'atlas', op: 'symbols.search', action: 'reverify', claim: { digest: 'abc' }, args: { strict: true }, budgetTokens: 20 },
  }));
  assert.equal(reverified.status, 200);
  assert.deepEqual(calls.at(-1), {
    action: 'reverify', name: 'atlas', capabilityOp: 'symbols.search', claim: { digest: 'abc' }, args: { strict: true },
    ctx: { budgetTokens: 20, actor: 'web:user-1:session-1' },
  });
  assert.deepEqual(coordination.events().filter((event) => event.kind === 'web.command_admitted').map((event) => event.payload.command), ['capability_invoke', 'capability_invoke']);
});

test('OR9: authenticated web capability push requires a fence and forwards the derived actor', async () => {
  const { web, calls } = fixture();
  const args = { name: 'cartographer-quartermaster', op: 'orientation.slice', action: 'push', workerId: 'w-1', note: 'Stay in auth.', args: { indexEpoch: 'epoch', focus: 'auth', shape: 'brief' }, budgetTokens: 800 };
  const missing = await web.execute(context(), envelope({ commandId: 'push-missing', idempotencyKey: 'push-missing', command: 'capability_invoke', args }));
  assert.equal(missing.status, 400); assert.equal(calls.length, 0);
  const pushed = await web.execute(context(), envelope({ commandId: 'push-1', idempotencyKey: 'push-1', command: 'capability_invoke', expectedFence: 9, args }));
  assert.equal(pushed.status, 200);
  assert.deepEqual(calls, [{ action: 'push', workerId: 'w-1', args: { indexEpoch: 'epoch', focus: 'auth', shape: 'brief' }, note: 'Stay in auth.', ctx: { budgetTokens: 800, actor: 'web:user-1:session-1', expectedFence: 9 } }]);
});

test('CI2/CI3/CI6: capability command validation rejects malformed and action-ambiguous envelopes before admission', async () => {
  const { web, calls, coordination } = fixture();
  const invalidArgs = [
    { name: 'atlas', op: 'symbols.search', args: {}, budgetTokens: 0 },
    { name: 'atlas', op: 'symbols.search', action: 'other', args: {}, budgetTokens: 1 },
    { name: 'atlas', op: 'symbols.search', action: 'resume', ref: {}, cursor: '', budgetTokens: 1 },
    { name: 'atlas', op: 'symbols.search', action: 'resume', ref: {}, cursor: 'next', args: {}, budgetTokens: 1 },
    { name: 'atlas', op: 'symbols.search', action: 'reverify', claim: {}, budgetTokens: 1 },
    { name: 'atlas', op: 'symbols.search', args: {}, ref: {}, budgetTokens: 1 },
    { name: 'atlas', op: 'symbols.search', args: {}, budgetTokens: 1 },
  ];
  for (const [index, args] of invalidArgs.entries()) {
    const response = await web.execute(context(), envelope({
      commandId: `invalid-capability-${index}`, idempotencyKey: `invalid-capability-${index}`,
      command: 'capability_invoke', args,
    }));
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'invalid_command');
  }
  assert.deepEqual(calls, []);
  assert.equal(coordination.events().some((event) => event.kind === 'web.command_admitted'), false);
});

test('CI4/CI6: rejected capability output is a stable non-retryable web failure', async () => {
  const { web, coordination } = fixture({ coordinator: {
    async invokeCapability() { throw Object.assign(new Error('malicious module detail'), { code: 'capability_authority_forbidden' }); },
  } });
  const response = await web.execute(context(), envelope({
    commandId: 'capability-policy-refusal', idempotencyKey: 'capability-policy-refusal', command: 'capability_invoke',
    args: { name: 'atlas', op: 'symbols.search', action: 'invoke', args: { query: 'Coordinator' }, budgetTokens: 80 },
  }));
  assert.equal(response.status, 502); assert.equal(response.body.error.code, 'capability_refused');
  assert.equal(JSON.stringify(response).includes('malicious module detail'), false);
  assert.equal(coordination.webCommand('capability-policy-refusal').status, 'failed');
});

test('WN4: an identical retry executes once and a same-key different body conflicts without mutation', async () => {
  const { web, calls, coordination } = fixture();
  const first = await web.execute(context(), envelope());
  const replay = await web.execute(context(), envelope({ commandId: 'cmd-retry' }));
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(calls.length, 1);
  const before = coordination.events().filter((event) => event.kind === 'web.command_admitted').length;
  const conflict = await web.execute(context(), envelope({ commandId: 'cmd-conflict', args: { ...envelope().args, model: 'grok-3' } }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'idempotency_conflict');
  assert.equal(calls.length, 1);
  assert.equal(coordination.events().filter((event) => event.kind === 'web.command_admitted').length, before);
});

test('WN4/WN5/WN7: unknown fields, unknown model policy, and client-supplied audit identity are rejected before admission', async () => {
  const { web, calls, coordination } = fixture();
  for (const invalid of [
    envelope({ actor: 'admin' }),
    envelope({ runId: '../escape' }),
    envelope({ args: { ...envelope().args, credential: 'secret' } }),
    envelope({ args: { ...envelope().args, modelPolicy: { reasoningEffort: 'high', bypassSandbox: true } } }),
  ]) {
    const result = await web.execute(context(), invalid);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'invalid_command');
  }
  assert.equal(calls.length, 0);
  assert.equal(coordination.events().some((event) => event.kind === 'web.command_admitted'), false);
});

test('WN4/WN7: unknown-field refusals use fixed bounded codes and never retain client field names', async () => {
  const { web, calls, coordination } = fixture();
  const marker = `credential-shaped-marker-${'x'.repeat(60_000)}`;
  const cases = [
    [envelope({ [marker]: true }), 'unknown_top_level_field'],
    [envelope({ args: { ...envelope().args, [marker]: true } }), 'unknown_argument_field'],
    [envelope({ args: { ...envelope().args, modelPolicy: { reasoningEffort: 'high', [marker]: true } } }), 'unknown_model_policy_field'],
  ];
  for (const [invalid, expected] of cases) {
    const response = await web.execute(context(), invalid);
    assert.equal(response.status, 400); assert.equal(response.body.error.message, expected);
    assert.ok(JSON.stringify(response).length < 512); assert.equal(JSON.stringify(response).includes(marker), false);
  }
  const audits = coordination.events().filter((event) => event.payload?.kind === 'command_invalid');
  assert.deepEqual(audits.map((event) => event.payload.reason), cases.map(([, expected]) => expected));
  assert.equal(JSON.stringify(audits).includes(marker), false); assert.deepEqual(calls, []);
});

test('WN4: admitted and completed idempotency state survives coordination-store restart', async () => {
  const directory = root();
  const calls = [];
  const coordinator = { async spawn(_harness, _brief, opts) { calls.push(opts); return { id: 'w-1', taskId: opts.taskId }; } };
  const firstStore = new CoordinationStore(directory);
  const first = new WebNorthbound({ coordinator, coordination: firstStore, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => Date.parse('2026-07-11T12:00:00.000Z') });
  assert.equal((await first.execute(context(), envelope())).status, 200);
  firstStore.releaseWriterLease();
  const restartedStore = new CoordinationStore(directory);
  const restarted = new WebNorthbound({ coordinator, coordination: restartedStore, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => Date.parse('2026-07-11T12:00:00.000Z') });
  const replay = await restarted.execute(context(), envelope({ commandId: 'different-client-command-id' }));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(calls.length, 1);
});

test('WN1/WN4: fence-sensitive control forwards the expected fence and refuses a missing fence', async () => {
  const { web, calls } = fixture();
  const missing = await web.execute(context(), envelope({ commandId: 'kill-missing', idempotencyKey: 'kill-missing', command: 'kill', args: { workerId: 'w-1' } }));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'invalid_command');
  const killed = await web.execute(context(), envelope({ commandId: 'kill-1', idempotencyKey: 'kill-1', command: 'kill', expectedFence: 7, args: { workerId: 'w-1' } }));
  assert.equal(killed.status, 200);
  assert.deepEqual(calls.at(-1), { op: 'kill', workerId: 'w-1', actor: 'web:user-1:session-1', opts: { expectedFence: 7 } });
  const sent = await web.execute(context(), envelope({ commandId: 'send-1', idempotencyKey: 'send-1', command: 'send', expectedFence: 8, args: { workerId: 'w-1', message: 'continue', mode: 'nudge' } }));
  assert.equal(sent.status, 200);
  assert.deepEqual(calls.at(-1), { op: 'send', workerId: 'w-1', message: 'continue', mode: 'nudge', opts: { expectedFence: 8, actor: 'web:user-1:session-1' } });
});

test('WN4/WN7: durable completion append failure never returns a successful command result', async () => {
  let appends = 0;
  const coordination = new CoordinationStore(root(), {
    appendFile: (...args) => {
      appends += 1;
      if (appends === 2) throw new Error('audit disk unavailable');
      const [path, data] = args;
      appendFileSync(path, data, 'utf8');
    },
  });
  const calls = [];
  const web = new WebNorthbound({
    coordinator: { async spawn() { calls.push('spawn'); return { id: 'w-1' }; } }, coordination,
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => Date.parse('2026-07-11T12:00:00.000Z'),
  });
  const result = await web.execute(context(), envelope());
  assert.equal(calls.length, 1);
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'temporarily_unavailable');
});

test('WN7: coordinator precondition errors become typed, non-leaking invalid-command outcomes', async () => {
  const cause = new Error('exact provider inventory is secret');
  cause.name = 'ModelSelectionError';
  const { web } = fixture({ coordinator: { async spawn() { throw cause; } } });
  const response = await web.execute(context(), envelope());
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_command');
  assert.equal(JSON.stringify(response).includes('inventory is secret'), false);
});

test('WN1/WN2/WN5/WN8: the HTTP adapter authenticates a bounded JSON command and the server refuses missing TLS/auth', async () => {
  const calls = [];
  const web = new WebNorthbound({
    coordinator: { list() { calls.push('list'); return []; } }, coordination: new CoordinationStore(root()),
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    authenticate: async (req) => req.headers.authorization === 'Bearer opaque-test-value' ? principal({ authMethod: 'bearer' }) : null,
    now: () => Date.parse('2026-07-11T12:00:00.000Z'), maxBodyBytes: 4096,
  });
  const body = JSON.stringify(envelope({ commandId: 'list-http', idempotencyKey: 'list-http', command: 'list', args: {} }));
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, {
    method: 'POST', url: '/v1/commands',
    headers: { 'content-type': 'application/json', origin: 'https://control.example.test', authorization: 'Bearer opaque-test-value' },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' },
  });
  const observed = await new Promise((resolve, reject) => {
    const response = { status: null, headers: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(payload) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(payload) }); } };
    web.handle(req, response).catch(reject);
  });
  assert.equal(observed.status, 200);
  assert.equal(observed.headers['cache-control'], 'no-store');
  assert.equal(observed.headers['access-control-allow-origin'], 'https://control.example.test');
  assert.deepEqual(calls, ['list']);
  assert.throws(() => createAuthenticatedWebServer(web), /TLS key and certificate/);
  const noAuth = new WebNorthbound({ coordinator: {}, coordination: new CoordinationStore(root()) });
  assert.throws(() => createAuthenticatedWebServer(noAuth, { tls: { key: 'x', cert: 'y' } }), /authenticator/);
});

test('WN3/WN6: the HTTP adapter issues and consumes an authenticated SSE nonce for one repo authority', async () => {
  const web = new WebNorthbound({
    coordinator: { list() { return []; } }, coordination: new CoordinationStore(root()),
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    authenticate: async (req) => req.headers.authorization === 'Bearer opaque-test-value' ? principal({ authMethod: 'bearer' }) : null,
    now: () => Date.parse('2026-07-11T12:00:00.000Z'), maxBodyBytes: 4096,
  });
  const issueReq = Readable.from([Buffer.from(JSON.stringify({ repoId: 'repo-a' }))]);
  Object.assign(issueReq, {
    method: 'POST', url: '/v1/stream-tickets',
    headers: { 'content-type': 'application/json', origin: 'https://control.example.test', authorization: 'Bearer opaque-test-value' },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' },
  });
  const issued = await new Promise((resolve, reject) => {
    const response = { status: null, writeHead(status) { this.status = status; }, end(payload) { resolve({ status: this.status, body: JSON.parse(payload) }); } };
    web.handle(issueReq, response).catch(reject);
  });
  assert.equal(issued.status, 201);

  const eventReq = Readable.from([]);
  Object.assign(eventReq, {
    method: 'GET', url: `/v1/events?ticket=${encodeURIComponent(issued.body.ticket)}`,
    headers: { origin: 'https://control.example.test', authorization: 'Bearer opaque-test-value' },
    socket: { encrypted: true, remoteAddress: '127.0.0.1' },
  });
  class EventResponse extends Readable {
    constructor() { super({ read() {} }); this.output = ''; }
    writeHead(status, headers) { this.status = status; this.headers = headers; }
    write(value) { this.output += value; return true; }
    end(value = '') { this.output += value; this.ended = true; }
  }
  const eventResponse = new EventResponse();
  await web.handle(eventReq, eventResponse);
  assert.equal(eventResponse.status, 200);
  assert.equal(eventResponse.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.match(eventResponse.output, /event: snapshot/);
  eventResponse.emit('close');

  assert.throws(() => new WebNorthbound({
    coordinator: {}, coordination: new CoordinationStore(root()), stream: {},
    repoIds: ['repo-a', 'repo-b'], allowedOrigins: ['https://control.example.test'],
  }), /at most one repository/);
});

test('WN5/WN6: cookie ticket CSRF fails before issue and Last-Event-ID wins over query cursor', async () => {
  const calls = [];
  const stream = {
    authorizeIssue(candidate, origin, repoId) { return candidate?.capabilities?.includes('observe') && origin === 'https://control.example.test' && repoId === 'repo-a'; },
    issue(...args) { calls.push({ op: 'issue', args }); return { status: 201, body: { ok: true, ticket: 'ticket' } }; },
    open(args) { calls.push({ op: 'open', args }); return { status: 409, body: { ok: false, error: { code: 'snapshot_required' } } }; },
  };
  const web = new WebNorthbound({
    coordinator: {}, coordination: new CoordinationStore(root()), stream,
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    authenticate: async () => principal(), now: () => Date.parse('2026-07-11T12:00:00.000Z'),
  });
  const requestTicket = async (csrfToken) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ repoId: 'repo-a' }))]);
    Object.assign(req, {
      method: 'POST', url: '/v1/stream-tickets',
      headers: { 'content-type': 'application/json', origin: 'https://control.example.test', ...(csrfToken ? { 'x-baton-csrf': csrfToken } : {}) },
      socket: { encrypted: true },
    });
    return new Promise((resolve, reject) => {
      const res = { writeHead(status) { this.status = status; }, end(payload) { resolve({ status: this.status, body: JSON.parse(payload) }); } };
      web.handle(req, res).catch(reject);
    });
  };
  assert.equal((await requestTicket()).status, 403);
  assert.equal((await requestTicket('wrong')).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await requestTicket('csrf-1')).status, 201);
  assert.equal(calls.filter((call) => call.op === 'issue').length, 1);

  const req = Readable.from([]);
  Object.assign(req, {
    method: 'GET', url: '/v1/events?ticket=opaque&cursor=3',
    headers: { origin: 'https://control.example.test', 'last-event-id': '7' }, socket: { encrypted: true },
  });
  const res = { writeHead(status) { this.status = status; }, end() {} };
  await web.handle(req, res);
  assert.equal(calls.find((call) => call.op === 'open').args.cursor, '7');
});

test('WN4/WN9: the real coordinator rejects stale web stop fences before adapter mutation', async () => {
  const repo = root();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'slow.txt', content: 'slow\n', delayMs: 10000 }] } });
  const driver = createDriver({ repoRoot: repo, logDir: join(root(), 'log'), adapters: { mock: adapter }, watchdog: { stallMs: 0 } });
  const brief = envelope().args.brief;
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'fenced-web-stop' });
  const current = driver.coordinator.list().find((worker) => worker.id === handle.id);
  const stale = await driver.coordinator.kill(handle.id, 'web:user-1:session-1', { expectedFence: current.fence - 1 });
  assert.equal(stale.result, 'stale_fence');
  assert.equal(driver.coordinator.list().find((worker) => worker.id === handle.id).status, 'working');
  const stopped = await driver.coordinator.kill(handle.id, 'web:user-1:session-1', { expectedFence: current.fence });
  assert.equal(stopped.result, 'confirmed');
  assert.equal(driver.coordinator.list().find((worker) => worker.id === handle.id).status, 'dead');
});
