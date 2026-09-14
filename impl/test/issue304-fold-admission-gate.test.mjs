// Issue #304 — the fold-admission gate row. The #304 class: a fold-time admissibility rule
// that can refuse a RECORDED row bricks every resident replaying history that predates the
// rule (the #292 regression, fixed once by hand in c6253838's `admission` flag). The gate
// makes the class impossible to land: every integrity site inside foldSwarmEvent must be a
// shape refusal (raised by validateSwarmEvent, the lane both admission and replay run), an
// admission-guarded refusal (fires only on the prospective fold), or a pinned, justified
// replay invariant — anything else fails with the code and the line named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkSwarmFoldAdmission } from '../scripts/surface-gate.mjs';

const SWARM_STATE_SOURCE = readFileSync(fileURLToPath(new URL('../src/swarm-state.mjs', import.meta.url)), 'utf8');

test('every integrity site in foldSwarmEvent is shape, admission-guarded, or a pinned replay invariant', () => {
  const findings = checkSwarmFoldAdmission();
  assert.deepEqual(findings, [],
    `the swarm fold refuses recorded history somewhere:\n${findings.join('\n')}`);
});

test('an unguarded fold-only integrity site fails the gate with the code and the line named', () => {
  const source = [
    'export function validateSwarmEvent(kind, payload) {',
    "  refuse('bad', 'invalid_payload');",
    '}',
    'export function foldSwarmEvent(swarms, event, { admission = false } = {}) {',
    "  integrity('a new admissibility rule', 'swarm_row_unacceptable');",
    '}',
  ].join('\n');
  const findings = checkSwarmFoldAdmission({ source });
  assert.equal(findings.filter((finding) => finding.includes('swarm_row_unacceptable')).length, 1,
    'the unguarded fold-only rule is named');
  assert.match(findings.find((finding) => finding.includes('swarm_row_unacceptable')), /swarm-state\.mjs:5/u,
    'the finding names the line the refusal is raised on');
});

test('an admission-guarded site and a shape-raised code pass the gate', () => {
  const source = [
    'export function validateSwarmEvent(kind, payload) {',
    "  refuse('bad', 'invalid_payload');",
    '}',
    'export function foldSwarmEvent(swarms, event, { admission = false } = {}) {',
    "  if (admission && !WORKSPACE_ID.test(holder.workspaceId ?? '')) {",
    "    integrity('no recorded checkout', 'swarm_writer_workspace_unrecorded');",
    '  }',
    '  if (admission) {',
    "    integrity('another tightening', 'new_rule_code');",
    '  }',
    "  integrity('shape refusal', 'invalid_payload');",
    '}',
  ].join('\n');
  const findings = checkSwarmFoldAdmission({ source });
  assert.equal(findings.filter((finding) => finding.includes('swarm_writer_workspace_unrecorded')
    || finding.includes('new_rule_code') || finding.includes('invalid_payload')).length, 0,
    `guarded and shape sites pass: ${findings.join(' | ')}`);
});

test('a pin the fold no longer raises is refused as stale — the pins can only shrink knowingly', () => {
  const source = [
    'export function validateSwarmEvent(kind, payload) {',
    '}',
    'export function foldSwarmEvent(swarms, event, { admission = false } = {}) {',
    "  integrity('gone', 'swarm_not_found');",
    '}',
  ].join('\n');
  const findings = checkSwarmFoldAdmission({ source });
  assert.ok(findings.some((finding) => finding.includes("stale fold-admission pin 'participant_not_found'")),
    'pins whose codes the scanned fold never raises are named stale');
  assert.ok(!findings.some((finding) => finding.includes("stale fold-admission pin 'swarm_not_found'")),
    'a pin the fold still raises is not stale');
});
