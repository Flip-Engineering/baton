// Error actionability red suite, binding contract: docs/reference/evidence/
// error-actionability-2026-08-13/contract-fold.md (v1.1) §4 RED-FIRST ACCEPTANCE PINS.
// [attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 row-suite-160]
//
// The suite law binds you — red-first, named stages, hermetic, split-twice, the attempt-echo law.
// Each row asserts the POST-D4 wire triple (typed code + offending field/class + next action or
// graceful path) at the transport edge. Fixtures construct the refusal AT the edge (over-cap
// objective / decision text, unknown field, malformed spec, authorize precondition denial,
// network refusal) against real transport surfaces — WebNorthbound, McpFleetServer,
// parseBatonCli / BatonWebClient — with a stub `application.command` throwing refusals built with
// the coaching/workflow/authorize shapes the contract (§3) closes. Application-layer helpers
// (coachingApplicationError, normalizeIntent, ...) are covered by frame-economics-red.test.mjs;
// this file never re-derives them.
//
// ROW INVENTORY (contract-fold.md §4; every pin becomes a row at its named stage):
//   W1  F1 × web   — unknown_top_level_field body names the offending key in `field`
//   W2  F1 × web   — unknown_argument_field body names the offending arg key
//   W3  F1 × web   — a run.act exactObject refusal surfaces the named validator refusal
//                    (application_action_invalid), not application_command_arguments_invalid
//   W4  F6 × web   — over-spill run.objective → 400/413 (not 503), field: objective,
//                    {actual, cap, unit, gracefulPath} present, assertNoBodyContent passes
//   W5  F5 × web   — waves.run malformed spec → workflow_spec_invalid (not invalid_command)
//                    with the spec field named
//   W6  F3 × web   — _authorize denial per precondition → 403 + field ∈ {origin, csrf, repoId,
//                    capability}
//   W7  F2 × web   — the 503 fallback stays reachable ONLY by untyped internal throws: an untyped
//                    throw maps to temporarily_unavailable; every typed vocabulary code maps to
//                    its triple arm, none degrades to the fallback (the general form of W4/W5)
//   W8  F1 × web   — a route-shape ValidationError with NO vocabulary code stays invalid_command;
//                    a vocabulary-code validator failure passes through its named code (R4)
//   M1  F1 × MCP   — over-cap objective → the coaching code (not invalid_run_command) + {cap, actual}
//   M2  F6 × MCP   — over-cap decision.text → decision_text_exceeded (not command_outcome_unknown)
//                    + {cap, actual, unit, gracefulPath} in detail
//   M3  F7 × MCP   — invalid_wave_start carries the offending member (index/role) in field
//   M4  F7/E4×MCP  — observe-path waves.progress refusal carries the same detail as the stateful path
//   M5  F6 × MCP replay — over-cap decision.text replayed on a same-idempotencyKey retry of
//                    baton_decision_answer (RECONCILABLE, mcp-northbound.mjs:141) →
//                    decision_text_exceeded with the coaching triple in detail on the replay path
//   C1  F4 × CLI   — cli_transport_failed message names the transport class + a next action
//   C2  F8 × CLI   — baton run shwo → cli_command_unavailable + closed verb set (no silent run.start)
//   C3  F9 × CLI   — the 20 CLI-local tooling codes (§3) are ledgered deliberately code-only in
//                    surface-divergence-ledger.json
//   X1  sanitization negative — a triple-absent refusal (code-only, no field, no next action)
//                    fails the assertion helper
//   X2  sanitization negative — a coaching refusal quoting a value/secret fails assertNoBodyContent
//   X3  sanitization carve-out (fold B4) — a lane-authored workflow_* refusal quoting the caller's
//                    own field value passes the sanitization negative; a lane-authored refusal
//                    quoting a secret- or third-party-shaped value still fails
//   S1  static — node impl/scripts/surface-conformance.mjs prints `surface-conformance: ok` (exit 0)
//   S2  static — a novel unledgered cli_* tooling code is a red conformance finding (closure)
//   S3  static — the scanner/assertion apparatus is shape-only: it never quotes body content
//
// INVENTED SURFACES — stub `application.command` on the real transport surfaces. The web and MCP
// rows share one mock application facade (repoId + card + authorizeReplay + command); each row's
// `command` override throws the refusal the lane would raise at the edge.
//
// PIN LIST — every acceptance-pin row is below, one test per row. X1-X3 are assertion-apparatus
// self-pins (green by construction once the helpers are correct); S1 is executable; S2 is a
// source-scan closure pin; S3 mirrors the scanner law on the suite's own helper.
//
// VERIFIED SPLIT (split-twice, measured at HEAD e371f70, `node impl/scripts/run-suite.mjs`):
//   Run 1: 22 tests — pass 5 / fail 17 (suite exit 1)
//   Run 2: 22 tests — pass 5 / fail 17 (suite exit 1)
//   RED rows (behavioral): W1 W2 W3 W4 W5 W6 W7 W8 M1 M2 M3 M4 M5 C1 C2 C3 S2
//   GREEN rows (apparatus / static-now): X1 X2 X3 S1 S3
//
// FOLDED per blue-team-2026-08-13-a/blueteam-160.md (§6/§7; QA UPHOLD) — the fold hardens
// rows against gaming, never makes a row pass at HEAD (the impls don't exist):
//   W3  fixture corrected to reach the exactObject seam (a missing required arg key, not an
//       extra key the envelope closure rejects first) + `field: 'inputs'` pin (kills the
//       run_act-only remap).
//   M3  `field` now names the offending member identity (index 1 / role designer), not any
//       non-empty string.
//   M5  stage marker relaxed to accept the post-R2 first-call code; the replay-sink pin is
//       the row's true discriminator (line 494-496).
//   Re-run split at HEAD after fold: Run 1 22/5/17, Run 2 22/5/17 (unchanged — RED honesty
//   preserved; every folded row still fails at HEAD at a named stage).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_COMMAND_DEFINITIONS, BatonWebClient, CoordinationStore,
  McpFleetServer, WebNorthbound, parseBatonCli,
} from '../src/index.mjs';

// -------------------------------------------------------------------------------------------
// Fixed fixtures (hermetic — injected clocks everywhere; no wall-clock control anywhere).
// -------------------------------------------------------------------------------------------

const NOW = Date.parse('2026-08-13T00:00:00.000Z');
const REPO_ID = 'repo-error-actionability';
const ORIGIN = 'https://control.example.test';
const root = (label) => mkdtempSync(join(tmpdir(), `baton-error-act-${label}-`));

const runApplicationCard = () => ({
  schemaVersion: 1,
  repoId: REPO_ID,
  commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
});

// The coaching refusal the application lane raises (contract §3 coaching family shape:
// {code, field: <lane>, cap, actual, unit: 'bytes', gracefulPath}). Composed here exactly as
// coachingApplicationError would — cap+actual numbers only, never body content (AS-4/G9).
function coachingRefusal({ code, lane, cap, actual }) {
  const pathPhrase = lane === 'run.objective'
    ? 'over-cap bodies spill to a durable artifact - resend with a digest-citable head'
    : `resend within the ${cap}-byte cap`;
  const message = `${lane} is ${actual} bytes (cap ${cap}); ${pathPhrase}`;
  return Object.assign(new Error(message), {
    code, field: lane, cap, actual, unit: 'bytes', gracefulPath: pathPhrase,
  });
}

function workflowRefusal({ fieldKey, code = 'workflow_spec_invalid' }) {
  return Object.assign(
    new TypeError(`the workflow spec field "${fieldKey}" is unknown (the closed schema is schemaVersion, idempotencyKey, members, steering, harvest)`),
    { code },
  );
}

function waveMemberRefusal(message = 'wave member admission refused: role "coder" is not on the allowed roster') {
  return Object.assign(new Error(message), {
    code: 'wave_member_invalid',
    detail: { actual: 1, cap: 0, cause: 'role_not_roster', role: 'coder' },
  });
}

function mockWebApplication({ command } = {}) {
  return {
    repoId: REPO_ID,
    card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, principal, context) {
      if (command) return command(name, args, principal, context);
      return { schemaVersion: 1, ok: true };
    },
  };
}

function webPrincipal(overrides = {}) {
  return {
    userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
    csrfToken: 'csrf-1', expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: [REPO_ID],
    ...overrides,
  };
}

function webContext(overrides = {}) {
  return {
    principal: webPrincipal(), origin: ORIGIN, csrfToken: 'csrf-1',
    remoteAddress: '127.0.0.1', transport: 'https', ...overrides,
  };
}

function webEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    commandId: 'cmd-1', idempotencyKey: 'ik-1',
    command: 'run_status', args: { runId: 'run-web-a' },
    repoId: REPO_ID, origin: ORIGIN,
    ...overrides,
  };
}

function webFixture(t, overrides = {}) {
  const directory = overrides.directory ?? root('web');
  const application = overrides.application ?? mockWebApplication({ command: overrides.command });
  const web = new WebNorthbound({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    repoIds: [REPO_ID],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    application,
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { web, directory };
}

function mcpPrincipal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
  };
}

function mockMcpApplication({ command } = {}) {
  return {
    repoId: REPO_ID,
    card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      if (command) return command(name, args, appPrincipal, context);
      return { schemaVersion: 1, runId: args.runId, phase: 'running' };
    },
  };
}

function mcpFixture(t, overrides = {}) {
  const directory = overrides.directory ?? root('mcp');
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const server = new McpFleetServer({
    coordinator: {},
    coordination,
    application: overrides.application ?? mockMcpApplication({ command: overrides.command }),
    surface: overrides.surface ?? 'combined',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: overrides.principal ?? mcpPrincipal(),
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (async () => ({ ok: true })),
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { server, coordination, directory };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

// -------------------------------------------------------------------------------------------
// Assertion helpers (the frame-economics idiom verbatim where possible; X1-X3 pin these).
// -------------------------------------------------------------------------------------------

function assertActionableTriple(refusal, { code, field, label = 'refusal' } = {}) {
  assert.ok(refusal && typeof refusal.code === 'string' && refusal.code.length > 0,
    `${label}: a typed code is present`);
  if (code !== undefined) assert.equal(refusal.code, code, `${label}: expected code ${code}`);
  if (field !== undefined) assert.equal(refusal.field, field, `${label}: the offending field/class is named`);
  const detail = refusal?.detail && typeof refusal.detail === 'object' && !Array.isArray(refusal.detail)
    ? refusal.detail : refusal;
  const hasNextAction = (typeof detail?.gracefulPath === 'string' && detail.gracefulPath.length > 0)
    || (typeof detail?.message === 'string' && detail.message.length > 0)
    || (typeof detail?.nextAction === 'string' && detail.nextAction.length > 0);
  assert.ok(hasNextAction, `${label}: a next action or graceful path is present`);
  return refusal;
}

function assertCoachingTriple(error, { cap, actual, label = 'coaching refusal' } = {}) {
  const detail = error?.detail && typeof error.detail === 'object' && !Array.isArray(error.detail)
    ? error.detail : error;
  if (cap !== undefined) assert.equal(detail.cap, cap, `${label}: the cap is named`);
  if (actual !== undefined) assert.equal(detail.actual, actual, `${label}: the actual byte count is named`);
  assert.equal(detail.unit, 'bytes', `${label}: the unit is bytes`);
  assert.ok(typeof detail.gracefulPath === 'string' && detail.gracefulPath.length > 0,
    `${label}: a graceful path is present`);
}

function assertNoBodyContent(text, body, label) {
  const marker = body.slice(0, 48);
  assert.ok(!String(text).includes(marker), `${label}: the refusal never quotes body content (AS-4)`);
}

function mcpError(response) {
  assert.ok(response?.result?.isError === true, 'expected an MCP tool error');
  return JSON.parse(response.result.content[0].text).error;
}

// -------------------------------------------------------------------------------------------
// W1-W8 — F1/F2/F3/F5/F6 × web
// -------------------------------------------------------------------------------------------

test('W1 (F1 × web): unknown_top_level_field body names the offending key in field (R4)', async (t) => {
  const { web } = webFixture(t);
  const response = await web.execute(webContext(), webEnvelope({ bogusTopLevelField: 'x' }));
  assert.equal(response.status, 400, 'a malformed envelope refuses 400');
  assertActionableTriple(response.body.error, { code: 'unknown_top_level_field', field: 'bogusTopLevelField', label: 'W1' });
});

test('W2 (F1 × web): unknown_argument_field body names the offending arg key (R4)', async (t) => {
  const { web } = webFixture(t);
  const response = await web.execute(webContext(), webEnvelope({
    command: 'run_status', args: { runId: 'run-web-a', bogusArg: 1 },
  }));
  assert.equal(response.status, 400, 'a malformed envelope refuses 400');
  assertActionableTriple(response.body.error, { code: 'unknown_argument_field', field: 'bogusArg', label: 'W2' });
});

test('W3 (F1 × web): a run.act exactObject refusal surfaces the named validator refusal, not application_command_arguments_invalid (R4)', async (t) => {
  const { web } = webFixture(t);
  // Fold (blueteam-160 §7.3): the original fixture (`extraField: 1`) never reached the
  // application-command validator — validateEnvelope's own unknown-arg closure rejects the extra
  // key first (verified at HEAD: the row reddened as `invalid_command`/`unknown_argument_field`,
  // the WRONG seam). A MISSING required arg key (`inputs`) passes the envelope arg closure and
  // reaches the run.act exactObject validator, which throws `application_action_invalid`
  // (application.mjs run.act arm). The offending key is `inputs`.
  const response = await web.execute(webContext(), webEnvelope({
    command: 'run_act', args: { runId: 'run-web-a', actionId: 'act-1' },
  }));
  assert.equal(response.status, 400, 'a malformed run.act envelope refuses 400');
  // The field pin (fold B1 hardening) defeats a run_act-only remap: a canned
  // `error(400, 'application_action_invalid', validation)` never names the offending arg key.
  assertActionableTriple(response.body.error, { code: 'application_action_invalid', field: 'inputs', label: 'W3' });
  assert.notEqual(response.body.error.code, 'application_command_arguments_invalid',
    'W3: the validator\'s own named code must survive, not the anonymous collapse');
});

test('W4 (F6 × web): over-spill run.objective -> 400/413 (not 503) with field objective and the coaching triple (R3/OQ2)', async (t) => {
  const objective = `spill me ${'x'.repeat(5_000)}`;
  const actual = Buffer.byteLength(objective);
  const refusal = coachingRefusal({ code: 'spill_body_exceeded', lane: 'run.objective', cap: 4096, actual });
  const { web } = webFixture(t, {
    command: async (name) => {
      if (name === 'run.start') throw refusal;
      return { schemaVersion: 1, ok: true };
    },
  });
  const response = await web.execute(webContext(), webEnvelope({
    command: 'run_start',
    args: { intent: { runId: 'run-web-a', objective, profile: 'standard' } },
  }));
  assert.ok([400, 413].includes(response.status), `W4: a coaching refusal is 400/413, never 503 (got ${response.status})`);
  assertActionableTriple(response.body.error, { code: 'spill_body_exceeded', field: 'objective', label: 'W4' });
  assertCoachingTriple(response.body.error, { cap: 4096, actual, label: 'W4' });
  assertNoBodyContent(JSON.stringify(response.body), objective, 'W4');
});

test('W5 (F5 × web): waves.run malformed spec -> workflow_spec_invalid (not invalid_command) with the spec field named (R3)', async (t) => {
  const { web } = webFixture(t, {
    command: async (name) => {
      if (name === 'waves.run') throw workflowRefusal({ fieldKey: 'members' });
      return { schemaVersion: 1, ok: true };
    },
  });
  const response = await web.execute(webContext(), webEnvelope({
    command: 'waves_run',
    args: { idempotencyKey: 'ik-waves-1', spec: { members: [] } },
  }));
  assert.notEqual(response.body.error.code, 'invalid_command', 'W5: a workflow_* refusal never degrades to invalid_command');
  assertActionableTriple(response.body.error, { code: 'workflow_spec_invalid', label: 'W5' });
  assert.ok(String(response.body.error.message ?? '').includes('members'),
    'W5: the refusal names the offending spec field');
});

test('W6 (F3 × web): _authorize denial per precondition -> 403 + field in {origin, csrf, repoId, capability} (R5)', async (t) => {
  const cases = [
    [webContext({ origin: 'https://evil.test' }), webEnvelope(), 'origin'],
    [webContext({ csrfToken: 'wrong-csrf' }), webEnvelope(), 'csrf'],
    [webContext(), webEnvelope({ repoId: 'repo-foreign' }), 'repoId'],
    [webContext({ principal: webPrincipal({ capabilities: [] }) }), webEnvelope(), 'capability'],
  ];
  for (const [ctx, envelope, expectedField] of cases) {
    const { web } = webFixture(t);
    const response = await web.execute(ctx, envelope);
    assert.equal(response.status, 403, `W6: ${expectedField} precondition denies 403`);
    assertActionableTriple(response.body.error, { code: 'forbidden', field: expectedField, label: `W6:${expectedField}` });
  }
});

test('W7 (F2 × web): the 503 fallback stays reachable ONLY by untyped internal throws; typed vocabulary codes never degrade to it (B5)', async (t) => {
  // Leg A (holds at HEAD): an untyped internal throw maps to the sanitized 503 fallback.
  const untyped = { web: webFixture(t, { command: async () => { throw new Error('internal provider exploded'); } }).web };
  const fallback = await untyped.web.execute(webContext(), webEnvelope());
  assert.equal(fallback.status, 503, 'W7-A: an untyped internal throw reaches the fallback');
  assert.equal(fallback.body.error.code, 'temporarily_unavailable', 'W7-A: the fallback is the sanitized code');
  assert.equal(fallback.body.error.message, 'command dispatch failed', 'W7-A: the internal message never leaks');
  assert.equal(String(fallback.body.error.message ?? '').includes('internal provider exploded'), false, 'W7-A: MN8 — no private provider detail');
  // Leg B (RED at HEAD): a typed coaching code maps to its triple arm, never the 503 fallback.
  const refusal = coachingRefusal({ code: 'decision_text_exceeded', lane: 'decision.text', cap: 4096, actual: 5_000 });
  const typed = webFixture(t, {
    command: async (name) => {
      if (name === 'run.answer') throw refusal;
      return { schemaVersion: 1, ok: true };
    },
  });
  const typedResponse = await typed.web.execute(webContext(), webEnvelope({
    command: 'run_answer', args: { runId: 'run-web-a', requestId: 'q-1', answer: { decision: 'allow' } },
  }));
  assert.notEqual(typedResponse.status, 503, 'W7-B: a typed vocabulary code never degrades to the fallback');
  assertActionableTriple(typedResponse.body.error, { code: 'decision_text_exceeded', field: 'decision.text', label: 'W7-B' });
  assertCoachingTriple(typedResponse.body.error, { cap: 4096, actual: 5_000, label: 'W7-B' });
});

test('W8 (F1 × web boundary): a route-shape ValidationError stays invalid_command; a vocabulary-code validator failure passes through its named code (R4)', async (t) => {
  // Leg 1 (holds at HEAD): a route-shape ValidationError with NO vocabulary code keeps invalid_command.
  const routeShape = webFixture(t);
  const fenceResponse = await routeShape.web.execute(webContext(), webEnvelope({
    command: 'kill', args: { workerId: 'w-1' },
  }));
  assert.equal(fenceResponse.status, 400, 'W8-1: a fence-shaped ValidationError refuses 400');
  assert.equal(fenceResponse.body.error.code, 'invalid_command', 'W8-1: no code -> invalid_command (phase12 pins hold)');
  assert.equal(String(fenceResponse.body.error.message ?? '').includes('expectedFence'), true, 'W8-1: the reason names the missing precondition');
  // Leg 2 (RED at HEAD): a validator failure carrying its own named code passes through (R4).
  const coded = webFixture(t);
  const inspectResponse = await coded.web.execute(webContext(), webEnvelope({
    command: 'run_inspect', args: { runId: 'run-web-a', pageCursor: 'bad cursor!' },
  }));
  assert.equal(inspectResponse.status, 400, 'W8-2: a coded validator failure refuses 400');
  assertActionableTriple(inspectResponse.body.error, { code: 'application_inspect_invalid', label: 'W8-2' });
  assert.notEqual(inspectResponse.body.error.code, 'application_command_arguments_invalid',
    'W8-2: the validator\'s named code passes through, not the anonymous collapse');
});

// -------------------------------------------------------------------------------------------
// M1-M5 — F1/F6/F7/E4 × MCP (including the RECONCILABLE replay path)
// -------------------------------------------------------------------------------------------

test('M1 (F1 × MCP): over-cap objective on baton_run_start -> the coaching code (not invalid_run_command) + {cap, actual} (R1/R2)', async (t) => {
  const objective = `spill me ${'x'.repeat(5_000)}`;
  const actual = Buffer.byteLength(objective);
  const refusal = coachingRefusal({ code: 'spill_body_exceeded', lane: 'run.objective', cap: 4096, actual });
  const { server } = mcpFixture(t, {
    command: async (name) => {
      if (name === 'run.start') throw refusal;
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_run_start',
    arguments: { repoId: REPO_ID, idempotencyKey: 'm1-ik', intent: { runId: 'run-a', objective, profile: 'standard' } },
  });
  const error = mcpError(response);
  assert.notEqual(error.code, 'invalid_run_command', 'M1: the validator never collapses the coaching refusal');
  assert.notEqual(error.code, 'command_outcome_unknown', 'M1: the coaching code is allowlisted, not the fallthrough');
  assertActionableTriple(error, { code: 'spill_body_exceeded', label: 'M1' });
  assertCoachingTriple(error, { cap: 4096, actual, label: 'M1' });
});

test('M2 (F6 × MCP): over-cap decision.text on baton_decision_answer -> decision_text_exceeded + {cap, actual, unit, gracefulPath} in detail (R2)', async (t) => {
  const refusal = coachingRefusal({ code: 'decision_text_exceeded', lane: 'decision.text', cap: 4096, actual: 5_000 });
  const { server } = mcpFixture(t, {
    command: async (name) => {
      if (name === 'run.answer') throw refusal;
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_decision_answer',
    arguments: {
      repoId: REPO_ID, idempotencyKey: 'm2-ik', runId: 'run-a', requestId: 'req-1',
      answer: { optionId: 'opt-1' },
    },
  });
  const error = mcpError(response);
  assert.notEqual(error.code, 'command_outcome_unknown', 'M2: the coaching code is allowlisted, not the fallthrough');
  assertActionableTriple(error, { code: 'decision_text_exceeded', label: 'M2' });
  assertCoachingTriple(error, { cap: 4096, actual: 5_000, label: 'M2' });
});

test('M3 (F7 × MCP): invalid_wave_start carries the offending member (index/role) in field (R2)', async (t) => {
  const { server } = mcpFixture(t);
  await initialized(server);
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_waves_start',
    arguments: {
      repoId: REPO_ID, idempotencyKey: 'm3-ik',
      members: [
        { role: 'coder', objective: 'ship', exact: { harness: 'mock', model: 'mock-model', effort: 'low' } },
        { role: 'designer', objective: 'sketch' }, // missing exact -> invalid_wave_start
      ],
    },
  });
  const error = mcpError(response);
  assertActionableTriple(error, { code: 'invalid_wave_start', label: 'M3' });
  // Fold (blueteam-160 §7.2): the row was SHALLOW — any non-empty field passed. The offending
  // member is the SECOND in the list (index 1, role 'designer' — the one missing `exact`); the
  // FIRST member (index 0, role 'coder') is valid. A constant field / canned-message remap must
  // fail: the field names THIS member's identity (index 1 and/or role designer), never a generic
  // pointer and never the valid first member.
  const field = String(error.field ?? '');
  assert.ok(field.includes('1') || field.includes('designer'),
    `M3: the offending member (index 1 / role designer) is named in field — got ${JSON.stringify(error.field)}`);
});

test('M4 (F7/E4 × MCP): observe-path waves.progress refusal carries the same detail as the stateful path (R7)', async (t) => {
  const { server } = mcpFixture(t, {
    command: async (name) => {
      if (name === 'waves.progress') throw waveMemberRefusal();
      if (name === 'waves.start') throw waveMemberRefusal('wave member admission refused: role "designer" is not on the allowed roster');
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const observe = await request(server, 2, 'tools/call', {
    name: 'baton_waves_progress',
    arguments: { repoId: REPO_ID, waveId: `wave:${'a'.repeat(32)}` },
  });
  const observeError = mcpError(observe);
  assertActionableTriple(observeError, { code: 'wave_member_invalid', label: 'M4-observe' });
  assert.ok(observeError.detail && typeof observeError.detail === 'object',
    'M4: the observe path carries the same {actual, cap, cause, role} detail as the stateful path');
  assert.deepEqual(
    { actual: observeError.detail.actual, cap: observeError.detail.cap, cause: observeError.detail.cause, role: observeError.detail.role },
    { actual: 1, cap: 0, cause: 'role_not_roster', role: 'coder' },
    'M4: the observe-path detail matches the stateful-path payload exactly');
});

test('M5 (F6 × MCP replay, B3/B5): over-cap decision.text replayed on a same-idempotencyKey retry of baton_decision_answer -> decision_text_exceeded with the coaching triple in detail (R2)', async (t) => {
  const refusal = coachingRefusal({ code: 'decision_text_exceeded', lane: 'decision.text', cap: 4096, actual: 5_000 });
  const { server, coordination } = mcpFixture(t, {
    command: async (name) => {
      if (name === 'run.answer') throw refusal;
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const args = {
    repoId: REPO_ID, idempotencyKey: 'm5-ik', runId: 'run-a', requestId: 'req-1',
    answer: { optionId: 'opt-1' },
  };
  const first = await request(server, 2, 'tools/call', { name: 'baton_decision_answer', arguments: args });
  // Fold (blueteam-160 §7.1): the row was BROKEN — this stage marker hard-coded the HEAD-red
  // stateful-sink fallthrough, but M1/M2 force the SAME sink to allowlist the coaching code, so
  // after the R2 repair the first call carries `decision_text_exceeded` and the old equality
  // failed. Relaxed to accept both: the row's TRUE pin is the replay-sink assertions below,
  // which must never lose the coaching code on a same-idempotencyKey retry.
  assert.ok(['command_outcome_unknown', 'decision_text_exceeded'].includes(mcpError(first).code),
    'stage: the first call fails at HEAD via command_outcome_unknown and carries decision_text_exceeded after the R2 repair');
  // Same idempotencyKey retry — RECONCILABLE (mcp-northbound.mjs:141): the replayed call MUST
  // carry the coaching code + triple on the replay sink (mcp-northbound.mjs:1587-1591), never
  // command_outcome_unknown.
  const replay = await request(server, 3, 'tools/call', { name: 'baton_decision_answer', arguments: args });
  const replayError = mcpError(replay);
  assert.notEqual(replayError.code, 'command_outcome_unknown', 'M5: the replay path carries the typed coaching code');
  assertActionableTriple(replayError, { code: 'decision_text_exceeded', label: 'M5' });
  assertCoachingTriple(replayError, { cap: 4096, actual: 5_000, label: 'M5' });
  assert.ok(coordination.events().some((event) => event.kind === 'mcp.call_admitted'),
    'M5: the first call admitted an mcp.call ledger row');
});

// -------------------------------------------------------------------------------------------
// C1-C3 — F4/F8/F9 × CLI
// -------------------------------------------------------------------------------------------

test('C1 (F4 × CLI): cli_transport_failed message names the transport class + a next action (R6)', async () => {
  const client = new BatonWebClient({
    baseUrl: 'https://baton.example.test/', origin: 'https://baton.example.test/',
    repoId: REPO_ID, token: 'test-token',
    commandTimeoutMs: 30_000, pollMs: 1_000,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    clock: () => new Date(NOW).toISOString(),
    sleep: async () => {},
  });
  await assert.rejects(
    client.doctor(),
    (error) => error?.code === 'cli_transport_failed'
      && /web/i.test(error?.message ?? '')
      && /(check|verify|ensure|confirm|retry)/i.test(error?.message ?? ''),
    'C1: the transport failure names the web-transport class and a next action (R6)',
  );
});

test('C2 (F8 × CLI): baton run shwo -> cli_command_unavailable + the closed verb set, never a silent run.start (R6)', () => {
  assert.throws(
    () => parseBatonCli(['run', 'shwo']),
    (error) => error?.code === 'cli_command_unavailable'
      && /start/i.test(error?.message ?? ''),
    'C2: an unknown run verb refuses with the closed verb set (copy the waves branch, application-cli.mjs:1319-1320/1384)',
  );
});

test('C3 (F9 × CLI, B1/B5): the 20 CLI-local tooling codes are ledgered deliberately code-only in surface-divergence-ledger.json', () => {
  const ledgerUrl = new URL('../scripts/surface-divergence-ledger.json', import.meta.url);
  const ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));
  const serialized = JSON.stringify(ledger);
  for (const code of CLI_LOCAL_TOOLING_CODES) {
    assert.ok(serialized.includes(code), `C3: ${code} must be ledgered as deliberately code-only (S2 escape hatch)`);
  }
});

const CLI_LOCAL_TOOLING_CODES = Object.freeze([
  'cli_invalid', 'cli_config_invalid', 'cli_setup_remote_unavailable', 'cli_setup_remote_invalid',
  'cli_setup_remote_refused', 'cli_setup_conflict', 'cli_setup_failed',
  'cli_export_archive_invalid', 'cli_export_archive_digest_mismatch', 'cli_export_destination_exists',
  'cli_export_destination_invalid', 'cli_export_extract_failed', 'cli_export_delivery_invalid',
  'cli_export_download_failed', 'cli_command_host_local', 'cli_command_pending', 'cli_command_failed',
  'cli_protocol_failed', 'cli_action_inputs_invalid', 'cli_connection_incompatible',
]);

// -------------------------------------------------------------------------------------------
// X1-X3 — sanitization negatives / carve-out (assertion-apparatus pins)
// -------------------------------------------------------------------------------------------

test('X1 (sanitization negative): a triple-absent refusal (code-only, no field, no next action) fails the assertion helper', () => {
  assert.throws(
    () => assertActionableTriple({ code: 'command_outcome_unknown' }),
    /next action or graceful path/u,
    'X1: a code-only refusal must never pass the actionability helper',
  );
});

test('X2 (sanitization negative): a coaching refusal quoting a value/secret fails assertNoBodyContent (AS-4)', () => {
  const secret = 'sk-live-abc123secretpayload';
  const message = `refused near ${secret}`;
  assert.throws(
    () => assertNoBodyContent(message, secret, 'X2'),
    /body content/u,
    'X2: the negative catches a refusal that quotes body content',
  );
});

test('X3 (sanitization carve-out, B4): a lane-authored workflow_* refusal quoting the caller\'s own field value passes; a secret-shaped quote still fails', () => {
  // The lane-authored message quotes the caller's OWN field key (workflow-interpreter.mjs:137) —
  // a shape identifier, never body content: the negative must PASS.
  const spec = JSON.stringify({ members: [{ role: 'coder', objective: 'ship it' }] });
  const laneMessage = 'the workflow spec field "members" is unknown (the closed schema is schemaVersion, idempotencyKey, members, steering, harvest)';
  assertNoBodyContent(laneMessage, spec, 'X3-positive');
  // A lane-authored refusal quoting a secret-shaped VALUE that sits at the body head still fails
  // the negative — the carve-out never authorizes leaking body content (AS-4).
  const secretSpec = JSON.stringify({ token: 'sk-live-abc123secretpayload', members: [{ role: 'coder', objective: 'ship it' }] });
  const secretQuote = `the workflow spec field "token" is unknown; body near ${secretSpec.slice(0, 48)}`;
  assert.throws(
    () => assertNoBodyContent(secretQuote, secretSpec, 'X3-negative'),
    /body content/u,
    'X3: a lane-authored refusal quoting a secret-shaped body value is still a sanitization failure',
  );
});

// -------------------------------------------------------------------------------------------
// S1-S3 — static pins
// -------------------------------------------------------------------------------------------

test('S1 (static): node impl/scripts/surface-conformance.mjs prints `surface-conformance: ok` and exits 0', () => {
  const script = new URL('../scripts/surface-conformance.mjs', import.meta.url);
  const result = execFileSync(process.execPath, [script.pathname], { encoding: 'utf8', timeout: 30_000 });
  assert.match(result, /surface-conformance:\s*ok/u, 'S1: the conformance main prints its ok line');
});

test('S2 (static closure): a novel unledgered cli_* tooling code is a red conformance finding — every cli_* code in the CLI source is ledgered or in-scope', () => {
  const cliSource = readFileSync(new URL('../src/application-cli.mjs', import.meta.url), 'utf8');
  const ledger = JSON.parse(readFileSync(new URL('../scripts/surface-divergence-ledger.json', import.meta.url), 'utf8'));
  const serialized = JSON.stringify(ledger);
  const inScope = new Set(['cli_command_unavailable', 'cli_transport_failed']);
  const found = new Set([...cliSource.matchAll(/['"](cli_[a-z0-9_]+)['"]/gu)].map((match) => match[1]));
  for (const code of found) {
    assert.ok(inScope.has(code) || serialized.includes(code),
      `S2: ${code} is thrown in the CLI source but is neither in-scope nor ledgered — a red conformance finding (S2)`);
  }
});

test('S3 (static): the assertion apparatus is shape-only — its failure messages never quote body content', () => {
  const secret = 'sk-live-abc123secretpayload';
  let message = '';
  try { assertNoBodyContent(`refused near ${secret}`, secret, 'S3'); }
  catch (error) { message = String(error.message); }
  assert.ok(message.length > 0, 'S3: the negative must fail');
  assert.equal(message.includes(secret), false,
    'S3: the helper\'s own failure message names the shape violation, never the marker content');
});
