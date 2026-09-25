import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AtlasEGraphEvaluation } from '../src/index.mjs';

const artifactRoot = () => mkdtempSync(join(tmpdir(), 'baton-egraph-evaluation-'));
const make = (opts = {}) => new AtlasEGraphEvaluation({ artifactRoot: artifactRoot(), maxArtifactBytes: 64 * 1024, ...opts });
const ctx = { budgetTokens: 2000 };

test('EG1/EG2: card and all domains preserve the explicit retire/redirect/research Decision', async () => {
  const atlas = make(); const card = atlas.card();
  assert.deepEqual(Object.keys(card.ops), ['egraph.evaluate']); assert.equal(card.limitations.includes('builds no e-graph'), true);
  const expected = { whole_repo: 'retired_native', whole_function: 'redirected_behavioral', expression_kernel: 'conditional_external_research' };
  for (const [domain, decision] of Object.entries(expected)) {
    assert.equal(card.domains[domain].nativeEngine, false);
    const result = await atlas.invoke('egraph.evaluate', { domain }, ctx); assert.equal(result.payload[0].decision, decision); assert.equal(result.payload[0].nativeEngine, false);
  }
});

test('EG3/EG7: every false build/proof/bypass/merge operation refuses typed in every domain', async () => {
  const atlas = make(); const codes = { whole_repo: 'r7_domain_retired', whole_function: 'r7_redirect', expression_kernel: 'r7_reopening_required' };
  for (const domain of Object.keys(codes)) for (const op of ['egraph.build', 'egraph.saturate', 'equivalence.prove', 'verification.skip', 'semantic_merge.authorize']) {
    await assert.rejects(atlas.invoke(op, { domain }, ctx), (error) => error.code === codes[domain] && error.decisionId === 'phase27-r7-egraph-retire-redirect' && error.domain === domain && error.redirect.length > 0 && typeof error.reopeningGates === 'object');
  }
  for (const domain of [undefined, '', 'source_file', { injected: true }]) {
    await assert.rejects(atlas.invoke('egraph.build', { domain }, ctx), (error) => error.code === 'r7_domain_retired' && error.decisionId === 'phase27-r7-egraph-retire-redirect' && error.supportedDomains.length === 3);
  }
});

test('EG4: reopening thresholds are exact, domain-specific, and never auto-enable capability', async () => {
  const atlas = make();
  const repo = (await atlas.invoke('egraph.evaluate', { domain: 'whole_repo' }, ctx)).payload[0];
  assert.equal(repo.reopeningGates.pinnedRealRepoTasksMin, 3); assert.equal(repo.reopeningGates.falseCleanCounterexamplesMin, 2);
  const fn = (await atlas.invoke('egraph.evaluate', { domain: 'whole_function' }, ctx)).payload[0];
  assert.equal(fn.reopeningGates.disjointOracleCorpusMultiplierMin, 10); assert.equal(fn.reopeningGates.extractedPureKernelOnly, true);
  const kernel = (await atlas.invoke('egraph.evaluate', { domain: 'expression_kernel' }, ctx)).payload[0];
  assert.equal(kernel.reopeningGates.realTaskKernelPairsMin, 5); assert.equal(kernel.reopeningGates.independentlyLabeledPairsMin, 20); assert.equal(kernel.reopeningGates.measuredFalsePositiveRateMax, 0); assert.equal(kernel.reopeningGates.incrementalValueBeyondFingerprintPairsMin, 3);
  assert.match(kernel.reopeningMeaning, /does_not_enable_capability/);
});

test('EG5/EG7: ACI artifact is a policy Decision with no proof or authority claim', async () => {
  const result = await make().invoke('egraph.evaluate', { domain: 'expression_kernel' }, ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.refs[0].kind, 'egraph_evaluation_policy'); assert.match(result.refs[0].mediaType, /policy/);
  assert.equal(result.provenance.meaning, 'policy_decision_not_equivalence_or_semantic_proof'); assert.equal(result.provenance.mergeAuthority, false); assert.equal(result.provenance.verificationAuthority, false);
  const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8')); assert.equal(artifact.schemaVersion, 1); assert.equal(artifact.decisionId, 'phase27-r7-egraph-retire-redirect');
});

test('EG6: deployment bounds, cancellation, domain validation, and unsupported ops fail typed', async () => {
  assert.throws(() => new AtlasEGraphEvaluation({ artifactRoot: artifactRoot() }), /maxArtifactBytes/);
  await assert.rejects(make({ maxArtifactBytes: 32 }).invoke('egraph.evaluate', { domain: 'whole_repo' }, ctx), (error) => error.code === 'artifact_too_large');
  const abort = new AbortController(); abort.abort(); await assert.rejects(make().invoke('egraph.evaluate', { domain: 'whole_repo' }, { ...ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
  await assert.rejects(make().invoke('egraph.evaluate', { domain: 'source_file' }, ctx), (error) => error.code === 'unsupported_domain');
  await assert.rejects(make().invoke('egraph.magic', { domain: 'whole_repo' }, ctx), (error) => error.code === 'unsupported_op');
});

test('EG6: bounded result resumes, tamper refuses, and reverify is deterministic', async () => {
  const atlas = make(); const args = { domain: 'whole_repo' };
  const bounded = await atlas.invoke('egraph.evaluate', args, { budgetTokens: 1 }); assert.equal(bounded.status, 'needs_resume'); assert.deepEqual(bounded.payload, []);
  const resumed = await atlas.resume(bounded.refs[0], bounded.cursor, ctx); assert.equal(resumed.status, 'ok'); assert.equal(resumed.payload[0].decision, 'retired_native');
  assert.equal((await atlas.reverify(bounded, 'egraph.evaluate', args, ctx)).ok, true);
  const outside = join(artifactRoot(), 'substituted.json'); writeFileSync(outside, readFileSync(bounded.refs[0].path));
  await assert.rejects(atlas.resume({ ...bounded.refs[0], path: outside }, bounded.cursor, ctx), (error) => error.code === 'artifact_integrity');
  writeFileSync(bounded.refs[0].path, `${readFileSync(bounded.refs[0].path, 'utf8')} `);
  await assert.rejects(atlas.resume(bounded.refs[0], bounded.cursor, ctx), (error) => error.code === 'artifact_integrity');
});
