import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// #227/#233 pin — the bridge facade's ordinary floor is the wire card's own derivation.
// Measured 2026-08-15 (mcp-web-local-resident-red regression): the #227 widening made
// BatonWebApplicationFacade require 41 ORDINARY_COMMANDS, but the resident wire card
// advertised only 33 — the workflow-surface verbs (run.message.send, run.attention.watch,
// run.scratchpad.read/elevate, run.board.post/read, run.knowledge.seed) are semantics-
// registered (embedded+mcp+cli) yet absent from the web admission tables, so ANY real
// resident's card failed the facade constructor: 'Baton Web application facade is invalid'.
// The bridge was unreachable against a real deployment — the exact proxy-retirement blocker.
//
// The repair (2026-09-21): the floor is DERIVED from the served card's own command source
// (`webCardCommandNames`, the U-N4 export — the exact command list the /v1/application-card
// route serves) instead of a hand literal, so a real resident's card passes by construction and
// the hand list can never drift behind the served card again. GREEN = the floor is the
// served-card derivation, and the wire admission tables cover every workflow verb the
// regression was about.

const WORKFLOW_EIGHT = Object.freeze([
  'run.message.send', 'run.message.receipt', 'run.attention.watch',
  'run.scratchpad.read', 'run.scratchpad.elevate',
  'run.board.post', 'run.board.read', 'run.knowledge.seed',
]);

test('WIRE-CARD-COVERAGE: the bridge floor is the served card derivation, never a hand list', async () => {
  // The floor must stay derived: parse the module source and refuse a return of the hand list.
  const src = readFileSync(new URL('../src/mcp-web-bridge.mjs', import.meta.url), 'utf8');
  assert.match(src,
    /const ORDINARY_COMMANDS = Object\.freeze\(webCardCommandNames\(\)\);/u,
    'the facade floor is webCardCommandNames() — the wire card is the authority (#227)');
  assert.doesNotMatch(src, /const ORDINARY_COMMANDS = Object\.freeze\(\[\u/,
    'a hand-kept floor literal is the drift that broke every bridge open');
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
