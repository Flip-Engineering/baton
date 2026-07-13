import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { AtlasRepresentationReview, createDriver } from '../src/index.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..'); const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); const root = (name) => mkdtempSync(join(tmpdir(), `baton-representation-review-${name}-`)); const limits = { maxArtifactBytes: 128 * 1024, maxFileBytes: 512 * 1024, maxFiles: 20, maxRows: 7 }; const make = (overrides = {}) => new AtlasRepresentationReview({ repoRoot: REPO, artifactRoot: root('artifacts'), limits, ...overrides }); const ctx = { actor: 'orchestrator', budgetTokens: 20_000 };

test('RP1-RP3: fixed packet attests every representation rung with honest closed status', async () => {
  const result = await make().invoke('representation.review', { treeSha: HEAD }, ctx); assert.equal(result.status, 'ok'); assert.deepEqual(result.payload.map((row) => row.rung), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']); assert.deepEqual(result.payload.map((row) => row.status), ['shipped_proposal', 'shipped_bounded', 'shipped_bounded', 'decision_ceiling_r3', 'shipped_observational', 'shipped_structured', 'decision_retired_native']); assert.ok(result.payload.every((row) => row.sources.length > 0 && row.sources.every((source) => /^[a-f0-9]{64}$/.test(source.digest)))); const encoded = JSON.stringify(result); assert.equal(encoded.includes('equivalence_proven'), false); assert.equal(encoded.includes('compiler_ir_built'), false);
});

test('RP4/RP6/RP7: packet is bounded, inventory-only, and preserves every missing rung', async () => {
  const review = make(); const result = await review.invoke('representation.review', { treeSha: HEAD }, ctx); for (const field of ['editAuthority', 'verificationAuthority', 'mergeAuthority', 'approvalAuthority', 'publicationAuthority', 'routingMutationAuthority', 'proofAuthority', 'policyAuthoringAuthority']) assert.equal(result.provenance[field], false); const document = JSON.parse(readFileSync(result.refs[0].path, 'utf8')); assert.deepEqual(document.missingStillPlanned, ['live-lsp', 'ssa-pdg-path-solving', 'aliases-heap-implicit-flow', 'exceptions-interprocedural-returns', 'external-ir-translation-validation', 'true-semantic-merge', 'conditional-expression-kernel-egraphs']); await assert.rejects(make({ limits: { ...limits, maxFileBytes: 32 } }).invoke('representation.review', { treeSha: HEAD }, ctx), (error) => error.code === 'representation_review_oversize');
});

test('RP2/RP5: tree drift, cancellation, claim substitution, and occupied artifacts fail closed', async () => {
  const review = make(); await assert.rejects(review.invoke('representation.review', { treeSha: '0'.repeat(40) }, ctx), (error) => error.code === 'representation_tree_changed'); const abort = new AbortController(); abort.abort(); await assert.rejects(review.invoke('representation.review', { treeSha: HEAD }, { ...ctx, signal: abort.signal }), (error) => error.code === 'cancelled'); const result = await review.invoke('representation.review', { treeSha: HEAD }, ctx); assert.equal((await review.reverify(result, 'representation.review', { treeSha: HEAD }, ctx)).ok, true); assert.equal((await review.reverify({ refs: [{ digest: '0'.repeat(64) }] }, 'representation.review', { treeSha: HEAD }, ctx)).ok, false); writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')} `); await assert.rejects(review.invoke('representation.review', { treeSha: HEAD }, ctx), (error) => error.code === 'artifact_integrity');
});

test('RP6: public createDriver reaches the packet only through the audited ACI registry', async () => {
  const review = make(); const driver = createDriver({ repoRoot: REPO, logDir: root('log'), adapters: {}, capabilities: { 'atlas-representation-review': review }, maxCapabilityBudgetTokens: 30_000, maxCapabilityEnvelopeBytes: 256 * 1024 }); const result = await driver.coordinator.invokeCapability('atlas-representation-review', 'representation.review', { treeSha: HEAD }, ctx); assert.equal(result.payload.length, 7); assert.deepEqual(driver.log.read('hub-capability').filter((event) => event.kind.startsWith('capability.op.')).map((event) => event.kind), ['capability.op.started', 'capability.op.completed']); assert.equal(driver.close(), true);
});
