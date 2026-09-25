// Issue #325 — the goal/plan fold-admission gate row. The #304 class in the goal/plan
// fold: a replay rule that judges RECORDED rows by the LIVE policy bricks every resident
// reopening history recorded under an earlier policy digest. The gate makes the class
// impossible to land: the replay fold (`_applyGoalPlanEvent` and the validators replay
// reaches through it) may verify a row against the digest it carries, and may read the
// live policy only through the pinned fields below — anything else fails with the
// pattern and the line named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGoalPlanFoldAdmission } from '../scripts/surface-gate.mjs';

const TAIL = [
  '  _goalSuccessorWeakeningReplay(prior, next) {',
  '  }',
  '  _validateGoalPlanDispatchPair(a, b, integrity = false) {',
  '    if (p.binding.policyDigest !== approval.policyDigest) fail anchored;',
  '    if (g.repoId !== this._goalPlanPolicy.repoId) fail identity;',
  '  }',
  '  _validateGoalPlanRecoveryTriple(a, b, c, integrity = false) {',
  '  }',
  '  _workflowRevisionAuthority(plan, node) {',
  '    if (lineage.length >= this._goalPlanPolicy.limits.maxPlanVersions) fail cap;',
  '  }',
  '  _derivePlanBudgetSettlement(taskId) {',
  '    const ceiling = this._goalPlanPolicy.limits.maxProviderTurns * 1_024;',
  '  }',
  '}',
].join('\n');
const withApplyBody = (body) => [
  'class CoordinationStore {',
  '  _applyGoalPlanEvent(event) {',
  ...body.split('\n'),
  '  }',
  ...TAIL.split('\n'),
].join('\n');

test('the real goal/plan fold is recorded-anchored: every live-policy read is pinned', () => {
  const findings = checkGoalPlanFoldAdmission();
  assert.deepEqual(findings, [],
    `the goal/plan fold judges recorded history by the live policy somewhere:\n${findings.join('\n')}`);
});

test('a live digest comparison in the fold fails the gate with the pattern and the line named', () => {
  const source = withApplyBody('    if (g.policyDigest !== this._goalPlanPolicy.policyDigest) malformed();');
  const findings = checkGoalPlanFoldAdmission({ source });
  assert.equal(findings.filter((finding) => finding.includes('live policy')).length, 1,
    'the live digest comparison is named');
  assert.match(findings[0], /coordination-store\.mjs:3/u, 'the finding names the line the comparison is on');
});

test('a live re-normalisation of recorded content fails the gate', () => {
  for (const call of ['normalizeGoalRequest', 'normalizePlanRequest', 'assertGoalSuccessor']) {
    const source = withApplyBody(`    const normalized = ${call}(fields, this._goalPlanPolicy);`);
    const findings = checkGoalPlanFoldAdmission({ source });
    assert.equal(findings.filter((finding) => finding.includes(call)).length, 1,
      `${call} on recorded content is named`);
  }
});

test('an unpinned live-policy field fails the gate', () => {
  const source = withApplyBody('    if (x > this._goalPlanPolicy.maxTokens) malformed();');
  const findings = checkGoalPlanFoldAdmission({ source });
  assert.equal(findings.length, 1, `one finding, not ${JSON.stringify(findings)}`);
  assert.match(findings[0], /unpinned live-policy field/u);
  assert.match(findings[0], /maxTokens/u);
});

test('recorded-anchored checks, pinned reads, and comments naming the pattern pass', () => {
  const source = withApplyBody([
    '    // recorded, never this._goalPlanPolicy.policyDigest: the row carries its digest.',
    '    if (p.binding.policyDigest !== approval.policyDigest) malformed();',
    "    const text = 'this._goalPlanPolicy.policyDigest is not read here';",
  ].join('\n'));
  const findings = checkGoalPlanFoldAdmission({ source });
  assert.deepEqual(findings, [],
    `anchored and pinned sites pass, comments and strings ignored: ${findings.join(' | ')}`);
});

test('a pin the fold no longer reads is refused as stale — the pins can only shrink knowingly', () => {
  const source = [
    'class CoordinationStore {',
    '  _applyGoalPlanEvent(event) {',
    '    if (g.repoId !== this._goalPlanPolicy.repoId) malformed();',
    '  }',
    '  _goalSuccessorWeakeningReplay(prior, next) {',
    '  }',
    '  _validateGoalPlanDispatchPair(a, b, integrity = false) {',
    '    if (!integrity && t > this._goalPlanPolicy.approvalTtlMs) fail ttl;',
    '  }',
    '  _validateGoalPlanRecoveryTriple(a, b, c, integrity = false) {',
    '  }',
    '  _workflowRevisionAuthority(plan, node) {',
    '  }',
    '  _derivePlanBudgetSettlement(taskId) {',
    '  }',
    '}',
  ].join('\n');
  const findings = checkGoalPlanFoldAdmission({ source });
  assert.ok(findings.some((finding) => finding.includes("stale goal-plan fold pin 'limits'")),
    'a pin whose field the scanned fold never reads is named stale');
  assert.ok(!findings.some((finding) => finding.includes("stale goal-plan fold pin 'repoId'")),
    'a pin the fold still reads is not stale');
});
