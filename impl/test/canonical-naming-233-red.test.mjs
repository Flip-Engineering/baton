import { test } from 'node:test';
import assert from 'node:assert/strict';

// #233 red-first enforcement suite (canonical naming unification, 2026-08-15).
// Methodology: every pin here was RED at the pre-implementation HEAD (verified by run) and
// GREEN after. The suite permanently enforces the ONE-admission-derivation contract — AI-written
// code is mutable; these pins are not.
//
// RED-state facts verified at HEAD (2026-08-15 run):
//   1. The web lane admitted ONLY underscore transports: COMMAND_CAPABILITY carries no dot
//      spelling anywhere, so `deployment.doctor` AND `deployment_doctor` both refused with
//      'unsupported command' (doctor existed on MCP as baton_deployment_doctor and in the
//      semantic registry, but 404'd on the web wire — the measured surface split).
//   2. `waves.run` (canonical dot) refused 'unsupported command' while `waves_run` admitted.
//   3. webAdmittedCommandNames / canonicalAndTransportNames did not exist (the seam itself is
//      part of the change); the MCP dispatch table carried zero dot names.
//
// Scope notes (issue #233 is naming/admission ONLY):
//   - The legacy underscore/baton_*/fleet_* spellings REMAIN admitted byte-identically beside
//     the canonical dot-names (the grammar-m3-red byte-stable pins on
//     Object.keys(APPLICATION_COMMAND_DEFINITIONS) and the retained transport tables must stay
//     green — removals are forbidden, additions only).
//   - Header policy (the sec-fetch-site same-site posture on /v1/application-card and friends)
//     is a REAL but SEPARATE defect; it is deliberately not asserted here.

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import {
  applicationOperationAliasMap,
  canonicalAndTransportNames,
  deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import { validateWebCommandEnvelope, webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { mcpCombinedToolNames, mcpDispatchToolNames } from '../src/mcp-northbound.mjs';

// The coordinator-lane kernel commands — hand-registered web literals predating the application
// command table. Pinned frozen: the closed-set pin below must fail if one is removed silently.
const KERNEL_WEB_COMMANDS = Object.freeze([
  'spawn', 'scratch_oracle', 'send', 'interrupt', 'kill', 'drain', 'respond',
  'list', 'result', 'wait', 'capabilities', 'provider_status', 'capability_invoke',
  'reuse_decide', 'reuse_recheck',
  'goal_define', 'plan_propose', 'plan_approve', 'goal_plan_status',
  'run_scratchpad_append',
]);

// The web direct ports (wave lane + the folded scratchpad write + deployment.doctor): each row
// is admitted under BOTH its canonical dot-name and its derived underscore transport. The dot
// names are pinned frozen here; the transports are derived through the ONE seam.
const WEB_DIRECT_PORT_OPERATIONS = Object.freeze([
  'waves.start', 'waves.progress', 'waves.send', 'waves.stop', 'waves.list',
  'waves.run', 'waves.compile', 'run.scratchpad.append', 'deployment.doctor',
  // #227 wire-card coverage (2026-08-15): the workflow-surface direct ports — the MCP web
  // bridge facade requires them on the resident card; the web lane now admits them.
  'run.message.send', 'run.message.receipt', 'run.attention.watch',
  'run.scratchpad.read', 'run.scratchpad.elevate',
  'run.board.post', 'run.board.read', 'run.knowledge.seed',
]);

// The retained legacy MCP spellings for mcp:true definitions (hand baton_* ordinary tools).
// Pinned frozen: removal is a regression (byte-stable legacy admission).
const RETAINED_MCP_LEGACY_TOOLS = Object.freeze([
  ['baton_help', 'application.help'],
  ['baton_runs', 'runs.list'],
  ['baton_run_start', 'run.start'],
  ['baton_run_inspect', 'run.inspect'],
  ['baton_run_episode', 'run.episode'],
  ['baton_run_workstreams', 'run.workstreams'],
  ['baton_workstream_notify', 'run.workstream.notify'],
  ['baton_workstream_stop', 'run.workstream.stop'],
  ['baton_run_act', 'run.act'],
  ['baton_run_stop', 'run.stop'],
  ['baton_waves_attach', 'waves.attach'],
]);

// The M4b canonical-grammar sibling keys (docs/36 §9 M4b): each renders beside its legacy
// baton_* sibling under the ONE shared deriveSurfaceNames. Key set pinned; names derived.
const M4B_SIBLING_KEYS = Object.freeze([
  'run.do', 'run.view', 'run.member.view', 'run.member.send', 'run.member.stop',
  'application.help',
]);

function envelopeFor(command, args = {}) {
  return {
    schemaVersion: 1,
    commandId: `cmd-233-${command.replaceAll('.', '_')}`,
    idempotencyKey: `idem-233-${command.replaceAll('.', '_')}`,
    command,
    args,
    repoId: 'repo-233',
    origin: 'https://baton.test',
  };
}

// ---------------------------------------------------------------------------
// Case 1: deployment.doctor — the measured split — is admitted on the web lane
// ---------------------------------------------------------------------------

test('ADMISSION: deployment.doctor is admitted on the web lane — not refused as unknown', () => {
  // Fixture honesty: an actually-unknown command still refuses at the admission gate.
  assert.equal(
    validateWebCommandEnvelope(envelopeFor('definitely.not_admitted')),
    'unsupported command',
  );
  const { canonical, web } = canonicalAndTransportNames('deployment.doctor');
  assert.equal(canonical, 'deployment.doctor');
  assert.equal(web, 'deployment_doctor');
  for (const command of [canonical, web]) {
    const refusal = validateWebCommandEnvelope(envelopeFor(command));
    assert.equal(refusal, null, `${command} must pass web admission cleanly`);
  }
});

// ---------------------------------------------------------------------------
// Case 2: waves.run and waves_run BOTH admit (regression guard)
// ---------------------------------------------------------------------------

test('ADMISSION: waves.run and waves_run BOTH admit on the web lane', () => {
  const { canonical, web } = canonicalAndTransportNames('waves.run');
  assert.equal(canonical, 'waves.run');
  assert.equal(web, 'waves_run');
  for (const command of [canonical, web]) {
    assert.equal(
      validateWebCommandEnvelope(envelopeFor(command, { specPath: 'wave.wavefile' })),
      null,
      `${command} must pass web admission cleanly`,
    );
  }
});

// ---------------------------------------------------------------------------
// Case 3: the web closed set — admitted names == the ONE derivation, exactly
// ---------------------------------------------------------------------------

test('CLOSED SET: web-admitted command names equal exactly the ONE derivation', () => {
  const admitted = webAdmittedCommandNames();
  const expected = new Set(KERNEL_WEB_COMMANDS);
  for (const [name, definition] of Object.entries(APPLICATION_COMMAND_DEFINITIONS)) {
    if (!definition.web) continue;
    const { canonical, web } = canonicalAndTransportNames(name);
    expected.add(canonical);
    expected.add(web);
  }
  // M4b canonical-grammar transports (registry aliases admitted beside their legacy spelling).
  for (const [canonicalAlias, legacy] of Object.entries(applicationOperationAliasMap())) {
    if (!Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, legacy)) continue;
    if (!APPLICATION_COMMAND_DEFINITIONS[legacy].web) continue;
    expected.add(canonicalAlias.replaceAll('.', '_'));
  }
  // Direct ports: both spellings of every pinned row.
  for (const name of WEB_DIRECT_PORT_OPERATIONS) {
    const { canonical, web } = canonicalAndTransportNames(name);
    expected.add(canonical);
    expected.add(web);
  }
  assert.deepEqual(admitted, [...expected].sort(), 'no extra literals, none missing');
});

// ---------------------------------------------------------------------------
// Case 4: the MCP closed set — application dispatch names == the ONE derivation
// ---------------------------------------------------------------------------

test('CLOSED SET: MCP application dispatch names equal exactly the ONE derivation', () => {
  const dispatch = mcpDispatchToolNames();
  const expected = new Set(RETAINED_MCP_LEGACY_TOOLS.map(([tool]) => tool));
  for (const key of M4B_SIBLING_KEYS) expected.add(deriveSurfaceNames(key).mcp);
  for (const [name, definition] of Object.entries(APPLICATION_COMMAND_DEFINITIONS)) {
    if (!definition.mcp) continue;
    const { canonical, mcp } = canonicalAndTransportNames(name);
    expected.add(canonical);
    expected.add(mcp);
  }
  assert.deepEqual(dispatch, [...expected].sort(), 'no extra literals, none missing');

  // Callable-beside: wherever an mcp:true definition is advertised under any retained
  // spelling, its canonical dot-name is admitted for CALL too (the tools/call gate reads the
  // advertised tool table, not just the dispatch map).
  const combined = new Set(mcpCombinedToolNames());
  for (const [name, definition] of Object.entries(APPLICATION_COMMAND_DEFINITIONS)) {
    if (!definition.mcp) continue;
    const { canonical, mcp } = canonicalAndTransportNames(name);
    const advertised = combined.has(mcp)
      || RETAINED_MCP_LEGACY_TOOLS.some(([tool, command]) => command === name && combined.has(tool));
    assert.equal(
      combined.has(canonical),
      advertised,
      `${canonical} dot admission must track its command's advertised spellings`,
    );
  }
});
