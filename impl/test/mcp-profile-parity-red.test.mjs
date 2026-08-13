// MCP profile-parity red suite — the folded #156 contract (v1.1).
// [attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-156]
// Source of truth: docs/reference/evidence/mcp-profile-parity-2026-08-13/
//   mcp-profile-parity-contract.md (v1.1 FOLDED) + fold-156.md + redteam-156.md.
//
// The rung: the default MCP application profile becomes a superset of the web bus, per op,
// mechanically derived from the two admission maps (D1/D3 — never a hand list); the two hard-missing
// fleet tools land (D2); the doc half renders the final shape (D4: 5 alias rows + the renderer's
// canonical-miss fallback + the regenerated artifact). Every capability row below is RED at HEAD
// (the exports, siblings, fleet tools, alias rows, and fallback are absent from this tree) and
// fails at a NAMED stage; the PIN rows are green today and must stay green under a correct impl.
//
// Row inventory (21 rows — 13 RED / 8 PIN):
//   RG-01  RED  mcpApplicationCommandNames + mcpApplicationDispatch exports exist       (stage: served-set export)
//   RG-02  RED  application tools/list = 49 including every D3 sibling                  (stage: application-tools-count-49)
//   RG-03  RED  bus − served = [] (the D3 law, per op) + construction-order anchors     (stage: uncovered-set-empty)
//   RG-04  RED  combined includes fleet_run_resume_work / _retry_verification           (stage: combined-includes-fleet-resume-retry)
//   RG-05  RED  dispatch binds every sibling tool to its bus command                    (stage: dispatch-binds-siblings)
//   RG-06  RED  12 inherited siblings byte-inherit the fleet_run_* wire schema          (stage: sibling-schema-inherits-source)
//   RG-07  RED  wait/follow lists admit the siblings + invalid_run_wait bounds          (stage: wait-follow-lists-admit-siblings)
//   RG-08  RED  fleet resume/retry dispatch, typed refusal, idem required, replay       (stage: fleet-resume-retry-dispatch)
//   RG-09  RED  combined tools/list = 102, the 14 siblings lead the ordinary prefix     (stage: combined-102-includes-siblings)
//   RG-10a RED  5 non-canonical mcp.baton surfaceAlias rows registered                  (stage: alias-rows-registered)
//   RG-10b RED  renderer canonical-miss fallback byte-string present in source          (stage: renderer-fallback-absent)
//   RG-10c RED  renderMcpToolInventory resolves the 5 ops to their operation keys       (stage: non-canonical-ops-render-operation-keys)
//   RG-11R RED  surface-inventory-artifact encodes mcp.application 49 / mcp.combined 102 (stage: artifact-counts-49-102)
//   RG-P1  PIN  surface-conformance main stays green                                    (stage: conformance-main-green)
//   RG-P2  PIN  committed artifact mcp.application count == live application surface    (stage: artifact-application-count-pin)
//   RG-P3  PIN  committed artifact mcp.combined count == live combined surface          (stage: artifact-combined-count-pin)
//   RG-P4  PIN  phase16 application tool list == mcpApplicationToolNames()              (stage: phase16-application-tool-list-pin)
//   RG-P5  PIN  mcp-reflex application tool list == mcpApplicationToolNames()           (stage: mcp-reflex-application-tool-list-pin)
//   RG-P6  PIN  phase67 application tool list == mcpApplicationToolNames()              (stage: phase67-application-tool-list-pin)
//   RG-P7  PIN  phase72 application tool list == mcpApplicationToolNames()              (stage: phase72-application-tool-list-pin)
//   RG-P8  PIN  phase16 combined-count pin == mcpCombinedToolNames().length             (stage: phase16-combined-count-pin)
//
// Invented surfaces (every one absent at HEAD — the first assertion on each is a behavior
// assertion so the row fails at the NAMED stage, never on a vacuous shape assertion):
//   mcpNorthbound.mcpApplicationCommandNames()        — the served-command set export (D1 step 1, D3)
//   mcpNorthbound.mcpApplicationDispatch()            — the frozen APPLICATION_TOOL map export (D1 step 1, D3)
//   the 14 baton_run_* lifecycle siblings             — derived from deriveSurfaceNames(c).mcp over the
//     uncovered set, never a hand list (#159); the 14 names are the contract's §3 closed literal
//   fleet_run_resume_work / _retry_verification       — the two D2 fleet definitions
//   the 5 mcp.baton surfaceAlias rows                 — D4 item 1 (['run.status','mcp.baton','baton_run_status'], …)
//   the renderer canonical-miss fallback              — D4 item 1, byte-string `?? { key: alias.canonical, profile: 'ordinary' }`
//   LIFECYCLE_ORDINARY_SIBLINGS + uncoveredCommands() — D1 construction-order mechanism (ORDER/EXISTENCE anchors)
//   the extended wait/follow list                     — D1 item 4, byte-string
//     ['fleet_run_wait', 'fleet_run_follow', 'baton_run_wait', 'baton_run_follow'] at both gates
//
// The D1 mechanism (construction order): uncoveredCommands() snapshots the hand-rows-only served
// set BEFORE the LIFECYCLE spread, so the pre-spread snapshot is exactly 14 and the siblings are
// created by .map over that snapshot — never hand-inlined. The ORDER anchor below pins that the
// uncovered derivation precedes the LIFECYCLE table in mcp-northbound.mjs.
//
// Suite-law hygiene: hermetic (mkdtemp fixtures, test.after cleanup, no network, no provider
// spawns, no host state); fixed clock; sorted-key literals in ACTUAL byte order (`localeCompare`
// banned); namespace import for the invented mcp-northbound exports (the source file is NUL-free
// and read whole only for the byte-string/ORDER anchors — never line-window anchors); no clocks as
// controls (maxWaitMs is the deployment-approved wait bound, not a test timer). The fixtures build
// an McpFleetServer with a stub coordinator ({}) — no real Coordinator is constructed, so no
// watchdog knob exists in these fixtures (the suite law's watchdog.stallMs clause is vacuous here).
// Verified split is recorded below after two consecutive runs from the repo root.
//
// VERIFIED SPLIT — two consecutive runs from the repo root (`node --test impl/test/mcp-profile-parity-red.test.mjs`):
//   run 1: tests 21 · pass 8 · fail 13 · cancelled 0 · skipped 0 · todo 0
//   run 2: tests 21 · pass 8 · fail 13 · cancelled 0 · skipped 0 · todo 0
//   stable — the identical 13 rows fail at their NAMED stages on both runs; the 8 PIN rows
//   (RG-P1..RG-P8) stay green.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY, deriveSurfaceNames } from '../src/application-semantics.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';
import * as mcpNorthbound from '../src/mcp-northbound.mjs';
import { renderMcpToolInventory } from '../scripts/render-surface-docs.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const conformanceScript = fileURLToPath(
  new URL('../scripts/surface-conformance.mjs', import.meta.url),
);

// The bus side of the parity law: the same admission map the web bus derives from (D3). The
// served side is the new mcpApplicationCommandNames() export — never a hand list. webCommands
// preserves APPLICATION_COMMAND_DEFINITIONS iteration order (the contract's `webCommands` at
// mcp-profile-parity-contract.md:110-113), so the derived uncovered set — and therefore the
// LIFECYCLE_ORDINARY_SIBLINGS order — is definition order, not sorted.
const webCommands = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
  .filter(([, definition]) => definition.web)
  .map(([name]) => name);

// The 5 non-canonical ops (D4 item 1): the contract's closed literal for the alias rows — they are
// NOT canonicalOperations keys (the G11 9/5 split), so the rows alone cannot resolve them without
// the renderer's canonical-miss fallback.
const NON_CANONICAL_OPS = ['run.status', 'run.follow', 'run.wait', 'run.resume_work', 'run.retry_verification'];

const NOW = Date.parse('2026-08-13T00:00:00.000Z');
const REPO_ID = 'repo-profile-parity';
const MAX_WAIT_MS = 25_000;
const dirs = [];
function fixtureDir() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-profile-parity-'));
  dirs.push(directory);
  return directory;
}
test.after(() => { for (const directory of dirs) rmSync(directory, { recursive: true, force: true }); });

const runApplicationCard = () => ({
  schemaVersion: 1,
  repoId: REPO_ID,
  commands: [
    'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams',
    'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow',
    'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer',
    'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work',
    'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown',
  ],
});

function principal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a',
    capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review',
      'integrate_result', 'resume_work', 'retry_verification', 'export_result'],
    repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
  };
}

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
  };
  return { application, commandCalls };
}

function setup(overrides = {}) {
  const directory = overrides.directory ?? fixtureDir();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const { application, commandCalls } = overrides.applicationBundle
    ?? mockApplication(overrides.applicationOverrides ?? {});
  const server = new McpFleetServer({
    coordinator: overrides.coordinator ?? {},
    coordination,
    application,
    surface: overrides.surface ?? 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: overrides.principal ?? principal(),
    repoIds: [REPO_ID],
    now: () => NOW,
    maxWaitMs: MAX_WAIT_MS,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (async () => ({ ok: true })),
  });
  return { server, coordination, application, commandCalls, directory };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

// Set equality in ACTUAL sorted order (localeCompare banned, per the suite law). The pinned test
// sites and the live tools/list are in the definition order; mcpApplicationToolNames() is sorted.
const sortedSet = (list) => [...new Set(list)].sort();

// ── RG-01 — the two exports land (D1 step 1 / D3) ─────────────────────────────────────────────

test('RG-01 RED: mcpApplicationCommandNames and mcpApplicationDispatch are exported (stage: served-set export)', () => {
  assert.equal(typeof mcpNorthbound.mcpApplicationCommandNames, 'function',
    'mcpApplicationCommandNames export exists (stage: served-set export)');
  assert.equal(typeof mcpNorthbound.mcpApplicationDispatch, 'function',
    'mcpApplicationDispatch export exists (stage: dispatch-map export)');
  const served = mcpNorthbound.mcpApplicationCommandNames();
  assert.deepEqual(served, [...served].sort(), 'served command set is ACTUAL sorted order');
  assert.deepEqual(served, [...new Set(served)], 'served command set is duplicate-free');
  const dispatch = mcpNorthbound.mcpApplicationDispatch();
  assert.equal(Object.isFrozen(dispatch), true, 'dispatch map is frozen');
});

// ── RG-02 — the application profile tools/list closure (D1) ───────────────────────────────────

test('RG-02 RED: application tools/list is 49 and includes every D3-uncovered sibling (stage: application-tools-count-49)', async () => {
  const { server } = setup({ surface: 'application' });
  await initialized(server);
  const names = (await request(server, 2, 'tools/list', {})).result.tools.map((tool) => tool.name);
  assert.equal(names.length, 49, 'application tools/list count 49 (stage: application-tools-count-49)');
  const served = mcpNorthbound.mcpApplicationCommandNames();
  const uncovered = webCommands.filter((command) => !served.includes(command));
  const siblingTools = uncovered.map((command) => deriveSurfaceNames(command).mcp).sort();
  const missing = siblingTools.filter((tool) => !names.includes(tool));
  assert.deepEqual(missing, [],
    'every D3-uncovered bus command has its sibling tool on the application profile (stage: application-tools-include-lifecycle-siblings)');
  assert.deepEqual(sortedSet(names), mcpNorthbound.mcpApplicationToolNames(),
    'tools/list set equals mcpApplicationToolNames() (ACTUAL sorted order)');
});

// ── RG-03 — the D3 parity derivation, per op, no hand list (D3) ────────────────────────────────

test('RG-03 RED: the D3 parity derivation reports no uncovered web-bus command (stage: uncovered-set-empty)', () => {
  assert.equal(typeof mcpNorthbound.mcpApplicationCommandNames, 'function',
    'mcpApplicationCommandNames export exists (stage: served-set export)');
  const served = mcpNorthbound.mcpApplicationCommandNames();
  const uncovered = webCommands.filter((command) => !served.includes(command));
  assert.deepEqual(uncovered, [], 'every web-bus command is a served application command (stage: uncovered-set-empty)');
  const missingSibling = uncovered
    .map((command) => deriveSurfaceNames(command).mcp)
    .filter((tool) => !mcpNorthbound.mcpApplicationToolNames().includes(tool));
  assert.deepEqual(missingSibling, [], 'every uncovered bus command has a default-profile sibling tool');

  // Construction-order + mechanism pins (fold record, Amendment 2): uncoveredCommands() snapshots
  // the served set BEFORE the LIFECYCLE sibling spread, and the table is derived (.map), never a
  // hand list. ORDER/EXISTENCE anchors only — never line-window anchors.
  const source = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const uncoveredDef = source.indexOf('uncoveredCommands');
  const lifecycleTable = source.indexOf('LIFECYCLE_ORDINARY_SIBLINGS');
  assert.ok(uncoveredDef >= 0, 'mcp-northbound defines uncoveredCommands() (stage: uncovered-command-derivation)');
  assert.ok(lifecycleTable >= 0, 'mcp-northbound defines LIFECYCLE_ORDINARY_SIBLINGS (stage: lifecycle-sibling-table)');
  assert.ok(uncoveredDef < lifecycleTable,
    'uncoveredCommands() precedes the LIFECYCLE spread — the pre-spread snapshot is the 14-row source (construction order)');
  assert.ok(source.slice(lifecycleTable, lifecycleTable + 160).includes('.map'),
    'LIFECYCLE_ORDINARY_SIBLINGS is built by .map over the uncovered snapshot (never hand-inlined)');
});

// ── RG-04 — the two D2 fleet tools land (D2) ──────────────────────────────────────────────────

test('RG-04 RED: fleet_run_resume_work and fleet_run_retry_verification are served on combined (stage: combined-includes-fleet-resume-retry)', () => {
  const combined = mcpNorthbound.mcpCombinedToolNames();
  assert.ok(combined.includes('fleet_run_resume_work'),
    'combined serves fleet_run_resume_work (stage: combined-includes-fleet-resume-retry)');
  assert.ok(combined.includes('fleet_run_retry_verification'),
    'combined serves fleet_run_retry_verification (stage: combined-includes-fleet-resume-retry)');
  const application = mcpNorthbound.mcpApplicationToolNames();
  assert.ok(application.includes('baton_run_resume_work'),
    'the application profile reaches run.resume_work via baton_run_resume_work');
  assert.ok(application.includes('baton_run_retry_verification'),
    'the application profile reaches run.retry_verification via baton_run_retry_verification');
});

// ── RG-05 — the dispatch binding (D1 step 1 / D3 third pin) ────────────────────────────────────

test('RG-05 RED: every uncovered bus command has its sibling tool bound in the ordinary dispatch map (stage: dispatch-binds-siblings)', () => {
  assert.equal(typeof mcpNorthbound.mcpApplicationDispatch, 'function',
    'mcpApplicationDispatch export exists (stage: dispatch-map export)');
  const dispatch = mcpNorthbound.mcpApplicationDispatch();
  assert.equal(Object.isFrozen(dispatch), true, 'dispatch map is frozen');
  const served = mcpNorthbound.mcpApplicationCommandNames();
  const uncovered = webCommands.filter((command) => !served.includes(command));
  const unbound = uncovered
    .map((command) => ({ command, tool: deriveSurfaceNames(command).mcp }))
    .filter(({ command, tool }) => dispatch[tool] !== command);
  assert.deepEqual(unbound, [],
    'each uncovered lifecycle op\'s sibling dispatches to its bus command through APPLICATION_TOOL (stage: dispatch-binds-siblings)');
});

// ── RG-06 — the schema-inheritance claim (M4b, D1 registration spread 3) ───────────────────────

test('RG-06 RED: the 12 inherited siblings byte-inherit the fleet_run_* wire schema, taskSupport forbidden, _meta stamped (stage: sibling-schema-inherits-source)', async () => {
  const { server } = setup({ surface: 'combined' });
  await initialized(server);
  const tools = (await request(server, 2, 'tools/list', {})).result.tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  // The inherited rows: web-bus commands whose fleet_run_* source is already served. At HEAD the
  // sibling spellings do not exist — no schema-inheritance claim can be made (RG-06's red state).
  const inherited = webCommands.filter((command) => byName.has(`fleet_${command.replaceAll('.', '_')}`));
  const missingSibling = inherited
    .map((command) => deriveSurfaceNames(command).mcp)
    .filter((tool) => !byName.has(tool));
  assert.deepEqual(missingSibling, [],
    'every inherited lifecycle sibling spelling is served on the combined surface (stage: sibling-schema-inherits-source)');
  assert.ok(inherited.length >= 12, `the 12 inherited rows are derived from the uncovered set (stage: inherited-source-set)`);
  for (const command of inherited) {
    const siblingName = deriveSurfaceNames(command).mcp;
    const sourceName = `fleet_${command.replaceAll('.', '_')}`;
    const sibling = byName.get(siblingName);
    const source = byName.get(sourceName);
    assert.deepEqual(sibling.inputSchema, source.inputSchema, `${siblingName} wire schema byte-equals ${sourceName}'s`);
    assert.deepEqual(sibling.annotations, source.annotations, `${siblingName} annotations inherit ${sourceName}'s`);
    assert.equal(sibling.execution.taskSupport, 'forbidden', `${siblingName} execution.taskSupport is forbidden`);
    assert.equal(typeof sibling._meta?.['baton/registryDigest'], 'string', `${siblingName} carries _meta['baton/registryDigest']`);
  }
});

// ── RG-07 — the wait/follow sibling bound (D1 item 4) ──────────────────────────────────────────

test('RG-07 RED: the wait/follow sibling list admits the siblings and invalid_run_wait bounds (stage: wait-follow-lists-admit-siblings)', async () => {
  const source = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const extendedList = "['fleet_run_wait', 'fleet_run_follow', 'baton_run_wait', 'baton_run_follow']";
  assert.ok(source.includes(extendedList),
    'the extended wait/follow list is present (a shared constant satisfies this; the two gates below prove both sites behaviorally) (stage: wait-follow-lists-admit-siblings)');

  // Gate A — validateArguments bound (D1 item 4, :954-955): the sibling spelling is a registered
  // tool and inherits the maxWaitMs bound.
  const gateA = setup({ surface: 'application' });
  await initialized(gateA.server);
  const overBound = await request(gateA.server, 2, 'tools/call', {
    name: 'baton_run_wait',
    arguments: { repoId: REPO_ID, runId: 'run-a', timeoutMs: MAX_WAIT_MS + 1 },
  });
  assert.ok(!overBound.error || overBound.error.code !== -32602,
    'baton_run_wait is a registered tool (stage: wait-follow-sibling-registered)');
  assert.equal(overBound.result.isError, true, 'baton_run_wait over the maxWaitMs bound is refused');
  assert.match(overBound.result.content[0].text, /invalid_run_wait/, 'the typed code is invalid_run_wait');

  // Gate B — observe-path post-dispatch _authority gate (D1 item 4, :1510): baton_run_follow is
  // registered AND the gate admits it, so a principal without the follow capability is refused with
  // forbidden AFTER dispatch (the observe path never bypasses the bounded-wait semantics).
  const gateB = setup({ surface: 'application', principal: principal({ capabilities: ['control'] }) });
  await initialized(gateB.server);
  const noFollow = await request(gateB.server, 2, 'tools/call', {
    name: 'baton_run_follow',
    arguments: { repoId: REPO_ID, runId: 'run-a', timeoutMs: 1_000 },
  });
  assert.ok(!noFollow.error || noFollow.error.code !== -32602,
    'baton_run_follow is a registered tool (stage: wait-follow-sibling-registered)');
  assert.equal(noFollow.result?.isError, true,
    'the observe-path gate admits baton_run_follow and refuses a principal without the follow capability');
  assert.match(noFollow.result?.content?.[0]?.text ?? '', /forbidden/,
    'the observe-path gate refuses with forbidden');
});

// ── RG-08 — the two D2 fleet tools dispatch (D2) ───────────────────────────────────────────────

test('RG-08 RED: fleet_run_resume_work/_retry_verification dispatch, typed refusal, idempotencyKey required, replay reconciles (stage: fleet-resume-retry-dispatch)', async () => {
  const { server, commandCalls } = setup({
    surface: 'combined',
    applicationOverrides: {
      command(name, args) {
        if (name === 'run.resume_work' && args?.runId === 'run-bad') {
          throw Object.assign(new Error('Run resume request is invalid'), { code: 'application_resume_invalid' });
        }
        return { schemaVersion: 1, runId: args?.runId ?? null, phase: 'running' };
      },
    },
  });
  await initialized(server);
  const names = mcpNorthbound.mcpCombinedToolNames();
  assert.ok(names.includes('fleet_run_resume_work'),
    'combined serves fleet_run_resume_work (stage: combined-includes-fleet-resume-retry)');
  assert.ok(names.includes('fleet_run_retry_verification'),
    'combined serves fleet_run_retry_verification (stage: combined-includes-fleet-resume-retry)');

  // idempotencyKey required (stateful): a call without it is refused before dispatch.
  const missingKey = await request(server, 2, 'tools/call', {
    name: 'fleet_run_resume_work',
    arguments: { repoId: REPO_ID, runId: 'run-a', reason: 'resume' },
  });
  assert.equal(missingKey.result.isError, true, 'a stateful resume_work call without idempotencyKey is refused');
  assert.match(missingKey.result.content[0].text, /invalid_idempotency_key/, 'the refusal is invalid_idempotency_key');

  // The command-lane typed refusal reaches the wire typed (stateFailureCode passthrough).
  const malformed = await request(server, 3, 'tools/call', {
    name: 'fleet_run_resume_work',
    arguments: { repoId: REPO_ID, idempotencyKey: 'resume-1', runId: 'run-bad', reason: 'resume' },
  });
  assert.equal(malformed.result.isError, true, 'the command-lane refusal is surfaced as a tool error');
  assert.match(malformed.result.content[0].text, /application_resume_invalid/,
    'application_resume_invalid reaches the wire typed (stage: fleet-resume-retry-dispatch)');

  // Reconcilable replay: an exact retry replays the prior outcome without re-dispatching.
  const args = { repoId: REPO_ID, idempotencyKey: 'resume-2', runId: 'run-a', reason: 'resume' };
  const first = await request(server, 4, 'tools/call', { name: 'fleet_run_resume_work', arguments: args });
  const replay = await request(server, 5, 'tools/call', { name: 'fleet_run_resume_work', arguments: args });
  assert.equal(first.result.isError, false, 'a valid resume_work call dispatches');
  assert.deepEqual(replay.result, first.result, 'an exact retry replays the prior outcome');
  assert.equal(commandCalls.filter((call) => call.name === 'run.resume_work' && call.args?.runId === 'run-a').length, 1,
    'the reconcilable retry never re-dispatches to application.command');
});

// ── RG-09 — the combined profile closure (D1 + D2) ─────────────────────────────────────────────

test('RG-09 RED: combined tools/list is 102 with the 14 siblings leading the ordinary prefix (stage: combined-102-includes-siblings)', async () => {
  const { server } = setup({ surface: 'combined' });
  await initialized(server);
  const names = (await request(server, 2, 'tools/list', {})).result.tools.map((tool) => tool.name);
  assert.equal(names.length, 102, 'combined tools/list count 102 (stage: combined-102-includes-siblings)');
  assert.ok(names.includes('fleet_run_resume_work'), 'combined serves fleet_run_resume_work');
  assert.ok(names.includes('fleet_run_retry_verification'), 'combined serves fleet_run_retry_verification');
  const served = mcpNorthbound.mcpApplicationCommandNames();
  const uncovered = webCommands.filter((command) => !served.includes(command));
  const siblingTools = uncovered.map((command) => deriveSurfaceNames(command).mcp);
  assert.deepEqual(siblingTools.filter((tool) => !names.includes(tool)), [],
    'the 14 baton_* siblings are served on the combined surface');
  assert.deepEqual(names.slice(0, siblingTools.length), siblingTools,
    'the 14 baton_* siblings lead the ordinary prefix in definition order (the contract\'s webCommands iteration order)');
  assert.deepEqual(sortedSet(names), mcpNorthbound.mcpCombinedToolNames(),
    'tools/list set equals mcpCombinedToolNames() (ACTUAL sorted order)');
});

// ── RG-10a — the 5 non-canonical alias rows (D4 item 1) ────────────────────────────────────────

test('RG-10a RED: the 5 non-canonical ops have mcp.baton surfaceAlias rows naming the sibling tool (stage: alias-rows-registered)', () => {
  const aliases = APPLICATION_SEMANTIC_REGISTRY.surfaceAliases;
  const missing = NON_CANONICAL_OPS.filter((command) => !aliases.some((row) => (
    row.surface === 'mcp.baton' && row.canonical === command
    && row.name === deriveSurfaceNames(command).mcp
  )));
  assert.deepEqual(missing, [],
    'each non-canonical op has a [canonical, mcp.baton, sibling-tool] surfaceAlias row (stage: alias-rows-registered)');
});

// ── RG-10b — the renderer canonical-miss fallback (D4 item 1) ──────────────────────────────────

test('RG-10b RED: renderMcpToolInventory has the canonical-miss fallback byte-string (stage: renderer-fallback-absent)', () => {
  const source = readFileSync(new URL('../scripts/render-surface-docs.mjs', import.meta.url), 'utf8');
  const fallback = "?? { key: alias.canonical, profile: 'ordinary' }";
  assert.ok(source.includes(fallback),
    'renderMcpToolInventory resolves an alias whose canonical key has no canonicalOperations entry via the fallback (stage: renderer-fallback-absent)');
});

// ── RG-10c — the doc half end-to-end (D4) ──────────────────────────────────────────────────────

test('RG-10c RED: renderMcpToolInventory renders the 5 non-canonical ops to their operation keys (stage: non-canonical-ops-render-operation-keys)', () => {
  const rows = renderMcpToolInventory().split('\n');
  for (const command of NON_CANONICAL_OPS) {
    const tool = deriveSurfaceNames(command).mcp;
    const row = rows.find((line) => line.includes(`\`${tool}\``));
    assert.ok(row, `${tool} appears in the generated MCP.md inventory (stage: non-canonical-ops-render-operation-keys)`);
    const cells = row.split('|').map((cell) => cell.trim());
    assert.equal(cells[1], `\`${command}\``,
      `${tool} renders under the operation key ${command}, not the tool name`);
  }
});

// ── RG-11-R — the regenerated artifact encodes the final counts (D4 item 3) ────────────────────

test('RG-11-R RED: the surface-inventory artifact encodes mcp.application 49 / mcp.combined 102 (stage: artifact-counts-49-102)', () => {
  const artifact = JSON.parse(readFileSync(new URL('../scripts/surface-inventory-artifact.json', import.meta.url), 'utf8'));
  assert.equal(artifact.counts.mcpApplicationTools, 49, 'artifact mcp.application count 49 (stage: artifact-counts-49-102)');
  assert.equal(artifact.counts.mcpCombinedTools, 102, 'artifact mcp.combined count 102 (stage: artifact-counts-49-102)');
});

// ── RG-P1 (PIN) — the conformance gate stays a citizen ──────────────────────────────────────────

test('RG-P1 PIN: surface-conformance.mjs executable main is green (stage: conformance-main-green)', () => {
  const result = execFileSync(process.execPath, [conformanceScript], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(String(result), /surface-conformance: ok/,
    'surface-conformance main is green (stage: conformance-main-green)');
});

// ── RG-P2/RG-P3 (PIN) — the committed artifact matches the live counts (D4 item 3) ──────────────

test('RG-P2 PIN: committed artifact mcp.application count equals the live application surface (stage: artifact-application-count-pin)', () => {
  const artifact = JSON.parse(readFileSync(new URL('../scripts/surface-inventory-artifact.json', import.meta.url), 'utf8'));
  assert.equal(artifact.counts.mcpApplicationTools, mcpNorthbound.mcpApplicationToolNames().length,
    'artifact mcp.application count equals the live application surface (stage: artifact-application-count-pin)');
});

test('RG-P3 PIN: committed artifact mcp.combined count equals the live combined surface (stage: artifact-combined-count-pin)', () => {
  const artifact = JSON.parse(readFileSync(new URL('../scripts/surface-inventory-artifact.json', import.meta.url), 'utf8'));
  assert.equal(artifact.counts.mcpCombinedTools, mcpNorthbound.mcpCombinedToolNames().length,
    'artifact mcp.combined count equals the live combined surface (stage: artifact-combined-count-pin)');
});

// ── RG-P4..RG-P7 (PIN) — the four hand-pinned application tool lists equal the live outputs ─────

function extractToolList(filePath, marker) {
  const source = readFileSync(filePath, 'utf8');
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `${filePath} contains the pinned tool-list marker`);
  const start = source.indexOf('[', markerIndex);
  let depth = 0;
  let inString = false;
  let end = start;
  for (; end < source.length; end++) {
    const ch = source[end];
    if (inString) {
      if (ch === '\\') end += 1;
      else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') { depth -= 1; if (depth === 0) break; }
  }
  const literal = source.slice(start, end + 1);
  return [...literal.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const PINNED_TOOL_LIST_SITES = [
  ['phase16', join(repoRoot, 'impl', 'test', 'phase16-mcp-northbound.test.mjs'),
    "assert.deepEqual(response.result.tools.map((tool) => tool.name), [\n    'baton_help'"],
  ['mcp-reflex', join(repoRoot, 'impl', 'test', 'mcp-reflex-surface-red.test.mjs'),
    'assert.deepEqual(response.result.tools.map((tool) => tool.name), ['],
  ['phase67', join(repoRoot, 'impl', 'test', 'phase67-progressive-agent-experience.test.mjs'),
    'assert.deepEqual(ordinary.toolDefinitions.map((tool) => tool.name), ['],
  ['phase72', join(repoRoot, 'impl', 'test', 'phase72-kimi-orchestrator-mcp.test.mjs'),
    'assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['],
];

test('RG-P4 PIN: phase16 application tool list equals mcpApplicationToolNames() (stage: phase16-application-tool-list-pin)', () => {
  const [, file, marker] = PINNED_TOOL_LIST_SITES[0];
  assert.deepEqual(sortedSet(extractToolList(file, marker)), mcpNorthbound.mcpApplicationToolNames(),
    'phase16 pinned application tool list equals mcpApplicationToolNames() (stage: phase16-application-tool-list-pin)');
});

test('RG-P5 PIN: mcp-reflex application tool list equals mcpApplicationToolNames() (stage: mcp-reflex-application-tool-list-pin)', () => {
  const [, file, marker] = PINNED_TOOL_LIST_SITES[1];
  assert.deepEqual(sortedSet(extractToolList(file, marker)), mcpNorthbound.mcpApplicationToolNames(),
    'mcp-reflex pinned application tool list equals mcpApplicationToolNames() (stage: mcp-reflex-application-tool-list-pin)');
});

test('RG-P6 PIN: phase67 application tool list equals mcpApplicationToolNames() (stage: phase67-application-tool-list-pin)', () => {
  const [, file, marker] = PINNED_TOOL_LIST_SITES[2];
  assert.deepEqual(sortedSet(extractToolList(file, marker)), mcpNorthbound.mcpApplicationToolNames(),
    'phase67 pinned application tool list equals mcpApplicationToolNames() (stage: phase67-application-tool-list-pin)');
});

test('RG-P7 PIN: phase72 application tool list equals mcpApplicationToolNames() (stage: phase72-application-tool-list-pin)', () => {
  const [, file, marker] = PINNED_TOOL_LIST_SITES[3];
  assert.deepEqual(sortedSet(extractToolList(file, marker)), mcpNorthbound.mcpApplicationToolNames(),
    'phase72 pinned application tool list equals mcpApplicationToolNames() (stage: phase72-application-tool-list-pin)');
});

// ── RG-P8 (PIN) — the phase16 combined-count pin equals the live output ─────────────────────────

test('RG-P8 PIN: phase16 combined-count pin equals mcpCombinedToolNames().length (stage: phase16-combined-count-pin)', () => {
  const phase16Source = readFileSync(join(repoRoot, 'impl', 'test', 'phase16-mcp-northbound.test.mjs'), 'utf8');
  const countMarker = 'assert.equal(combined.result.tools.length, ';
  const countIndex = phase16Source.indexOf(countMarker);
  assert.ok(countIndex >= 0, 'phase16 combined-count pin marker present (stage: phase16-combined-count-pin)');
  const countStart = countIndex + countMarker.length;
  const countEnd = phase16Source.indexOf(')', countStart);
  const pinnedCount = Number(phase16Source.slice(countStart, countEnd).trim());
  assert.equal(pinnedCount, mcpNorthbound.mcpCombinedToolNames().length,
    'phase16 combined-count pin equals mcpCombinedToolNames().length (stage: phase16-combined-count-pin)');
});
