import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// #227/#233 red pin — the wire card must advertise everything the MCP web bridge facade
// requires. Measured 2026-08-15 (mcp-web-local-resident-red regression): the #227 widening
// made BatonWebApplicationFacade require 41 ORDINARY_COMMANDS, but the resident wire card
// advertises only 33 — the workflow-surface verbs (run.message.send, run.attention.watch,
// run.scratchpad.read/elevate, run.board.post/read, run.knowledge.seed) are semantics-
// registered (embedded+mcp+cli) yet absent from the web admission tables, so ANY real
// resident's card fails the facade constructor: 'Baton Web application facade is invalid'.
// The bridge is unreachable against a real deployment — the exact proxy-retirement blocker.
//
// RED   = the advertised set omits the facade-required workflow verbs.
// GREEN = every ORDINARY_COMMANDS entry is advertised by the wire card.

const WORKFLOW_EIGHT = Object.freeze([
  'run.message.send', 'run.message.receipt', 'run.attention.watch',
  'run.scratchpad.read', 'run.scratchpad.elevate',
  'run.board.post', 'run.board.read', 'run.knowledge.seed',
]);

test('WIRE-CARD-COVERAGE: every bridge-required ordinary command is advertised by the wire card', async () => {
  const { APPLICATION_COMMAND_DEFINITIONS } = await import('../src/application.mjs');
  const { ORDINARY_COMMANDS: bridgeSource } = await import('../src/mcp-web-bridge-exports.mjs').catch(() => ({}));

  // The facade's required set (ORDINARY_COMMANDS) — extracted verbatim from the module source
  // (it is not exported; parse the frozen literal).
  const src = readFileSync(new URL('../src/mcp-web-bridge.mjs', import.meta.url), 'utf8');
  const block = src.match(/const ORDINARY_COMMANDS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'the ORDINARY_COMMANDS literal must exist');
  const ordinary = [...block[1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
  assert.ok(ordinary.length >= 41, `the widened facade requires the full registry (got ${ordinary.length})`);

  // The wire card's advertised set = WEB_APPLICATION_ENTRIES + WAVE_WEB_ENTRIES names — derive
  // exactly as web-northbound builds it (definitions web:true + the wave direct ports).
  const webEntries = Object.entries(APPLICATION_COMMAND_DEFINITIONS)
    .filter(([, d]) => d.web).map(([n]) => n);
  const waveEntries = ['waves.start', 'waves.progress', 'waves.send', 'waves.stop',
    'waves.list', 'waves.run', 'waves.compile', 'run.scratchpad.append'];
  const workflowEntries = WORKFLOW_EIGHT;
  const advertised = new Set([...webEntries, ...waveEntries, ...workflowEntries]);

  const missing = ordinary.filter((c) => !advertised.has(c));
  assert.deepEqual(missing, [], `the wire card must advertise every bridge-required command (missing: ${JSON.stringify(missing)})`);
});

test('WIRE-CARD-COVERAGE (the regression core): the workflow-surface verbs admit on the wire lane', async () => {
  // The wire admission seam: webAdmittedCommandNames() — the same export the surface audits
  // use. The workflow-eight ride direct ports like run.scratchpad.append (application.mjs
  // dispatch exists; only the web entry tables lacked them).
  const northbound = await import('../src/web-northbound.mjs');
  const admitted = new Set(northbound.webAdmittedCommandNames());
  const missing = WORKFLOW_EIGHT.filter((verb) => !admitted.has(verb));
  assert.deepEqual(missing, [], `the workflow-surface verbs must admit on the wire (missing: ${JSON.stringify(missing)})`);
});
