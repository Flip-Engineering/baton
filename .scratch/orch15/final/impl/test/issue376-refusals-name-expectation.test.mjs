// issue376-refusals-name-expectation.test.mjs — #376 (SYSTEMIC P3): refusals that say
// "is invalid" must name the violated rule or the expectation. A bare "${label} is invalid"
// with no further detail (no pattern, no byte bound, no admitted set) violates the
// coaching-refusal principle: the caller cannot fix what it cannot identify.
//
// These pins exercise each validation helper that the 2026-09-18 design-principles audit
// flagged as bare, through the public normalizers they guard. The assertion is: the thrown
// message contains the expectation (a byte bound, a regex description, a type name, or a
// field name) — not just "${label} is invalid".

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeContextEffectCall,
} from '../src/context-call.mjs';

import {
  normalizeContextMapCall,
} from '../src/context-map.mjs';

const sha = (ch) => ch.repeat(64);
const tree = (ch) => ch.repeat(40);

function artifact(kind, mediaType, ch) {
  const d = sha(ch);
  return { kind, mediaType, handle: `art:sha256:${d}`, digest: d, bytes: 128 };
}

function authority(overrides = {}) {
  return {
    contextPrincipal: {
      actor: 'deployment:context', principalId: 'service-context',
      repoId: 'repo-376', runId: 'run-376',
    },
    requester: { principalId: 'local-owner', sessionId: 'local-owner-session' },
    sessionId: `context-session:${sha('c')}`,
    manifestDigest: sha('d'), treeSha: tree('e'), environmentDigest: sha('f'),
    policyDigest: sha('1'), definitionDigest: sha('2'), roleCatalogDigest: sha('3'),
    profileDigest: sha('4'),
    predecessorPlan: { planId: `plan:${sha('5')}`, version: 1, digest: sha('6') },
    ...overrides,
  };
}

function cellSource() {
  return {
    kind: 'cell', id: `cell:${sha('7')}`,
    admissionDigest: sha('8'), settlementDigest: sha('9'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', 'a'),
    evidenceRef: artifact('context_evidence', 'application/vnd.baton.context-cell-evidence+json', 'b'),
    itemCount: 1, coordinateDigest: sha('c'), outputLineageDigest: sha('d'),
  };
}

function unit(index) {
  return {
    index,
    inputs: [{ index, itemDigest: sha(index === 0 ? 'e' : 'f'), lineageDigest: sha('1') }],
    coordinateDigest: sha(index === 0 ? '2' : '3'),
  };
}

function validCall(overrides = {}) {
  return {
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'map',
    generation: 1, predecessorCall: null, inheritedChildren: [],
    authority: authority(), source: cellSource(), role: 'critic',
    instruction: 'Review this input.', units: [unit(0)],
    ...overrides,
  };
}

function catchRefusal(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error('expected a refusal but none was thrown');
}

// --------------------------------------------------------------------------
// P3-a: text() helper — a non-string value names the type expectation
// --------------------------------------------------------------------------
test('P3-a: text() refusal on non-string names the expectation, not just "is invalid"', () => {
  const error = catchRefusal(
    () => normalizeContextEffectCall(validCall({ instruction: 42 })),
  );
  assert.equal(error.code, 'context_call_invalid');
  assert.match(error.message, /must be/iu,
    `the refusal must state what the field "must be", not just "is invalid"; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// P3-b: text() helper — an empty-after-trim value names the expectation
// --------------------------------------------------------------------------
test('P3-b: text() refusal on empty string names the expectation', () => {
  const error = catchRefusal(
    () => normalizeContextEffectCall(validCall({ instruction: '   ' })),
  );
  assert.equal(error.code, 'context_call_invalid');
  assert.match(error.message, /must be/iu,
    `the refusal must state what the field "must be"; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// P3-c: text() helper — an over-cap value names the byte bound
// --------------------------------------------------------------------------
test('P3-c: text() refusal on over-cap value names the byte bound', () => {
  const error = catchRefusal(
    () => normalizeContextEffectCall(validCall({ instruction: 'x'.repeat(20_000) })),
  );
  assert.equal(error.code, 'context_call_invalid');
  assert.match(error.message, /byte/iu,
    `the refusal names the byte bound; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// P3-d: safeId() helper — a value failing the SAFE_ID pattern names the pattern
// --------------------------------------------------------------------------
test('P3-d: safeId() refusal names the pattern', () => {
  const error = catchRefusal(
    () => normalizeContextEffectCall(validCall({ role: '!!!bad!!!' })),
  );
  assert.equal(error.code, 'context_call_invalid');
  assert.match(error.message, /must match|pattern|alphanumeric/iu,
    `the refusal names the expected pattern; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// P3-e: sha() helper — a value failing the digest pattern names the expectation
// --------------------------------------------------------------------------
test('P3-e: sha() refusal names the hex digest expectation', () => {
  const error = catchRefusal(
    () => normalizeContextEffectCall(validCall({
      authority: authority({ manifestDigest: 'not-a-digest' }),
    })),
  );
  assert.equal(error.code, 'context_call_invalid');
  assert.match(error.message, /must be|hex|digest/iu,
    `the refusal names the hex digest expectation; got: ${error.message}`);
});

// --------------------------------------------------------------------------
// P3-f: context-map.mjs text() refusal also names the expectation
// --------------------------------------------------------------------------
test('P3-f: context-map text() refusal on non-string names the expectation', () => {
  const mapSource = {
    repoId: 'repo-376', runId: 'run-376',
    sessionId: `context-session:${sha('c')}`,
    cellId: `cell:${sha('7')}`,
    cellAdmissionDigest: sha('8'), cellSettlementDigest: sha('9'),
    coordinateDigest: sha('c'),
    manifestDigest: sha('d'), treeSha: tree('e'), environmentDigest: sha('f'),
    policyDigest: sha('1'), definitionDigest: sha('2'),
    profileDigest: sha('4'), sourceProgramDigest: sha('5'),
    outputRef: artifact('context_value', 'application/vnd.baton.context-value+json', 'a'),
    evidenceRef: artifact('context_evidence', 'application/vnd.baton.context-cell-evidence+json', 'b'),
    predecessorPlan: { planId: `plan:${sha('5')}`, version: 1, digest: sha('6') },
  };
  const error = catchRefusal(
    () => normalizeContextMapCall({
      schemaVersion: 1, kind: 'baton.context_map_call', generation: 1,
      source: mapSource, role: 'critic',
      instruction: 42,
      partitions: [
        { index: 0, itemDigest: sha('a'), coordinateDigest: sha('b') },
        { index: 1, itemDigest: sha('c'), coordinateDigest: sha('d') },
      ],
    }),
  );
  assert.equal(error.code, 'context_map_invalid');
  assert.match(error.message, /must be/iu,
    `the context-map refusal also names the expectation; got: ${error.message}`);
});
